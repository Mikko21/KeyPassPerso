// Vercel Function: zero-knowledge vault API with mandatory TOTP second factor.
//
// The server never sees the master password or plaintext. It stores the encrypted envelope,
// sha256(authKey), and the TOTP secret sealed under authKey.
//
//   GET  /api/vault?action=params           public KDF params (salt, iterations)
//   POST /api/vault?action=setup            create the vault (setup token + TOTP enrollment)
//   POST /api/vault?action=login            authKey + TOTP or recovery code -> session + envelope
//   GET  /api/vault                         authKey + session -> envelope
//   PUT  /api/vault                         authKey + session -> save (optimistic concurrency)
//   POST /api/vault?action=mfa              authKey + session -> replace TOTP and/or recovery codes
//   POST /api/vault?action=revoke           authKey + session -> invalidate all other sessions
//   GET  /api/vault?action=history          authKey + session -> archived versions
//   GET  /api/vault?action=version&rev=N    authKey + session -> archived envelope
//
// Env: BLOB_STORE_ID (OIDC) or BLOB_READ_WRITE_TOKEN, KPP_SETUP_TOKEN.

import {
  issueSession,
  newSecret,
  normalizeRecoveryCode,
  safeEqual,
  seal,
  SESSION_TTL_MS,
  sessionExpiry,
  sha256,
  TRUSTED_TTL_MS,
  unseal,
  verifySession,
  verifyTotp,
} from './_lib/security.js'
import { archive, listHistory, loadRecord, loadVersion, saveRecord, type Envelope, type StoredRecord } from './_lib/store.js'

const MAX_BODY_BYTES = 5 * 1024 * 1024
const IP_MAX_FAILS = 10
const IP_WINDOW_MS = 15 * 60 * 1000
const MFA_MAX_FAILS = 5
const MFA_LOCK_MS = 15 * 60 * 1000

type ErrorCode = 'bad_password' | 'mfa_required' | 'bad_code' | 'locked' | 'conflict' | 'not_found' | 'invalid' | 'server'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

function fail(status: number, code: ErrorCode, error: string, extra?: object): Response {
  return json({ code, error, ...extra }, status)
}

// Best-effort per-instance throttle on wrong passwords. Pair with a Vercel WAF rate-limit rule.
const ipFails = new Map<string, { n: number; until: number }>()

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

function ipLimited(ip: string): boolean {
  const f = ipFails.get(ip)
  if (f && Date.now() > f.until) ipFails.delete(ip)
  return (ipFails.get(ip)?.n ?? 0) >= IP_MAX_FAILS
}

function ipFailure(ip: string): void {
  const f = ipFails.get(ip)
  if (!f || Date.now() > f.until) ipFails.set(ip, { n: 1, until: Date.now() + IP_WINDOW_MS })
  else f.n++
}

function bearer(req: Request): string | null {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope
  return (
    !!e &&
    e.format === 'keypassperso' &&
    e.v === 1 &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string' &&
    typeof e.kdf?.salt === 'string' &&
    Number.isInteger(e.kdf?.iterations) &&
    e.kdf.iterations >= 100_000
  )
}

function isHashList(x: unknown): x is string[] {
  return Array.isArray(x) && x.length >= 5 && x.length <= 20 && x.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))
}

function isTotpSecret(x: unknown): x is string {
  return typeof x === 'string' && /^[A-Z2-7]{32}$/.test(x)
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

interface AuthContext {
  record: StoredRecord
  etag: string
  authKey: string
}

/** Verifies the password-derived authKey; optionally also a valid session (second factor already passed). */
async function authenticate(req: Request, requireSession: boolean): Promise<AuthContext | Response> {
  const ip = clientIp(req)
  if (ipLimited(ip)) return fail(429, 'locked', 'Trop de tentatives, réessaie dans 15 minutes')
  const loaded = await loadRecord()
  if (!loaded) return fail(404, 'not_found', 'Aucun coffre distant')
  const authKey = bearer(req)
  if (!authKey || !safeEqual(sha256(authKey), loaded.value.authHash)) {
    ipFailure(ip)
    return fail(401, 'bad_password', 'Mot de passe maître incorrect')
  }
  if (requireSession && !verifySession(req.headers.get('x-kpp-session'), loaded.value.authHash, loaded.value.sessionSecret)) {
    return fail(401, 'mfa_required', 'Code 2FA requis')
  }
  return { record: loaded.value, etag: loaded.etag, authKey }
}

// ---------- Handlers ----------

async function params(): Promise<Response> {
  const loaded = await loadRecord()
  if (!loaded) return fail(404, 'not_found', 'Aucun coffre distant')
  return json({ kdf: loaded.value.envelope.kdf })
}

async function setup(req: Request): Promise<Response> {
  const ip = clientIp(req)
  if (ipLimited(ip)) return fail(429, 'locked', 'Trop de tentatives, réessaie dans 15 minutes')
  const expected = process.env.KPP_SETUP_TOKEN
  if (!expected) return fail(503, 'server', 'KPP_SETUP_TOKEN non configuré sur Vercel')

  const body = await readBody(req)
  const authKey = bearer(req)
  if (!body || !authKey || !isEnvelope(body.envelope) || !isTotpSecret(body.totpSecret) || !isHashList(body.recovery)) {
    return fail(400, 'invalid', 'Requête invalide')
  }
  if (typeof body.setupToken !== 'string' || !safeEqual(sha256(body.setupToken.trim()), sha256(expected))) {
    ipFailure(ip)
    return fail(401, 'invalid', 'Jeton d’initialisation invalide')
  }
  const step = verifyTotp(body.totpSecret, String(body.code ?? ''), 0)
  if (step === null) return fail(401, 'bad_code', 'Code 2FA invalide, vérifie l’heure de ton téléphone')

  const authHash = sha256(authKey)
  const record: StoredRecord = {
    v: 2,
    envelope: { ...body.envelope, rev: 1, updatedAt: Date.now() },
    authHash,
    totp: seal(body.totpSecret, authKey),
    totpLastStep: step,
    recovery: body.recovery,
    sessionSecret: newSecret(),
    mfaFails: 0,
    lockUntil: 0,
  }
  if (!(await saveRecord(record, null))) return fail(409, 'conflict', 'Un coffre distant existe déjà')
  return json({ session: issueSession(authHash, record.sessionSecret, SESSION_TTL_MS), rev: 1 })
}

async function login(req: Request): Promise<Response> {
  const ctx = await authenticate(req, false)
  if (ctx instanceof Response) return ctx
  const body = (await readBody(req)) ?? {}
  const trust = body.trust === true

  // Up to 3 attempts so a concurrent write (CAS conflict) does not drop the anti-replay update.
  let { record, etag } = ctx
  for (let attempt = 0; attempt < 3; attempt++) {
    if (record.lockUntil > Date.now()) {
      return fail(429, 'locked', '2FA verrouillée après trop d’échecs, réessaie dans 15 minutes')
    }
    const next: StoredRecord = { ...record }
    let ok = false
    let recoveryUsed = false

    if (typeof body.code === 'string') {
      const step = verifyTotp(unseal(record.totp, ctx.authKey), body.code.trim(), record.totpLastStep)
      if (step !== null) {
        ok = true
        next.totpLastStep = step
      }
    } else if (typeof body.recoveryCode === 'string') {
      const h = sha256(normalizeRecoveryCode(body.recoveryCode))
      const idx = record.recovery.findIndex((r) => safeEqual(r, h))
      if (idx !== -1) {
        ok = true
        recoveryUsed = true
        next.recovery = record.recovery.filter((_, i) => i !== idx)
      }
    } else {
      return fail(400, 'invalid', 'Code 2FA manquant')
    }

    if (ok) {
      next.mfaFails = 0
    } else {
      next.mfaFails = record.mfaFails + 1
      if (next.mfaFails >= MFA_MAX_FAILS) {
        next.mfaFails = 0
        next.lockUntil = Date.now() + MFA_LOCK_MS
      }
    }

    if (await saveRecord(next, etag)) {
      if (!ok) return fail(401, 'bad_code', 'Code invalide')
      return json({
        session: issueSession(next.authHash, next.sessionSecret, trust ? TRUSTED_TTL_MS : SESSION_TTL_MS),
        envelope: next.envelope,
        recoveryLeft: next.recovery.length,
        recoveryUsed,
      })
    }
    const reloaded = await loadRecord()
    if (!reloaded) return fail(404, 'not_found', 'Aucun coffre distant')
    record = reloaded.value
    etag = reloaded.etag
  }
  return fail(409, 'conflict', 'Conflit, réessaie')
}

async function fetchVault(req: Request): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  return json({ envelope: ctx.record.envelope, recoveryLeft: ctx.record.recovery.length })
}

async function save(req: Request): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  const body = await readBody(req)
  if (!body || !isEnvelope(body.envelope) || !Number.isInteger(body.baseRev)) return fail(400, 'invalid', 'Requête invalide')
  const { record, etag, authKey } = ctx
  if (record.envelope.rev !== body.baseRev) {
    return fail(409, 'conflict', 'Conflit de version', { envelope: record.envelope })
  }

  const next: StoredRecord = {
    ...record,
    envelope: { ...body.envelope, rev: record.envelope.rev + 1, updatedAt: Date.now() },
  }
  let session: { token: string; expiresAt: number } | undefined
  if (typeof body.newAuthKey === 'string') {
    // Master password change: re-seal the TOTP secret and rebind sessions to the new auth hash.
    if (!/^[0-9a-f]{64}$/.test(body.newAuthKey)) return fail(400, 'invalid', 'Nouvelle clé invalide')
    next.authHash = sha256(body.newAuthKey)
    next.totp = seal(unseal(record.totp, authKey), body.newAuthKey)
    const current = req.headers.get('x-kpp-session') ?? ''
    session = issueSession(next.authHash, next.sessionSecret, Math.max(sessionExpiry(current) - Date.now(), 60_000))
  }

  if (!(await saveRecord(next, etag))) {
    const latest = await loadRecord()
    return fail(409, 'conflict', 'Conflit de version', { envelope: latest?.value.envelope })
  }
  await archive(record.envelope)
  return json({ rev: next.envelope.rev, session })
}

async function updateMfa(req: Request): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  const body = await readBody(req)
  if (!body) return fail(400, 'invalid', 'Requête invalide')
  const next: StoredRecord = { ...ctx.record }

  if (body.totpSecret !== undefined) {
    if (!isTotpSecret(body.totpSecret)) return fail(400, 'invalid', 'Secret invalide')
    const step = verifyTotp(body.totpSecret, String(body.code ?? ''), 0)
    if (step === null) return fail(401, 'bad_code', 'Code 2FA invalide')
    next.totp = seal(body.totpSecret, ctx.authKey)
    next.totpLastStep = step
  }
  if (body.recovery !== undefined) {
    if (!isHashList(body.recovery)) return fail(400, 'invalid', 'Codes invalides')
    next.recovery = body.recovery
  }
  if (!(await saveRecord(next, ctx.etag))) return fail(409, 'conflict', 'Conflit, réessaie')
  return json({ ok: true, recoveryLeft: next.recovery.length })
}

async function revoke(req: Request): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  const next: StoredRecord = { ...ctx.record, sessionSecret: newSecret() }
  if (!(await saveRecord(next, ctx.etag))) return fail(409, 'conflict', 'Conflit, réessaie')
  return json({ session: issueSession(next.authHash, next.sessionSecret, SESSION_TTL_MS) })
}

async function history(req: Request): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  return json({ versions: await listHistory() })
}

async function version(req: Request, rev: number): Promise<Response> {
  const ctx = await authenticate(req, true)
  if (ctx instanceof Response) return ctx
  const envelope = Number.isInteger(rev) ? await loadVersion(rev) : null
  return envelope ? json({ envelope }) : fail(404, 'not_found', 'Version introuvable')
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      return fail(503, 'server', 'Stockage Blob non configuré')
    }
    const url = new URL(req.url)
    const action = url.searchParams.get('action') ?? (url.searchParams.has('params') ? 'params' : '')
    try {
      switch (`${req.method} ${action}`) {
        case 'GET params':
          return await params()
        case 'POST setup':
          return await setup(req)
        case 'POST login':
          return await login(req)
        case 'GET ':
          return await fetchVault(req)
        case 'PUT ':
          return await save(req)
        case 'POST mfa':
          return await updateMfa(req)
        case 'POST revoke':
          return await revoke(req)
        case 'GET history':
          return await history(req)
        case 'GET version':
          return await version(req, Number(url.searchParams.get('rev')))
        default:
          return fail(405, 'invalid', 'Méthode non autorisée')
      }
    } catch (err) {
      console.error(err)
      return fail(500, 'server', 'Erreur serveur')
    }
  },
}
