// Vercel Function: stores the single encrypted vault in a private Vercel Blob store.
// The server never sees the master password or plaintext: only ciphertext + sha256(authKey).
//
// Env vars:
//   BLOB_READ_WRITE_TOKEN   injected when a private Blob store is connected to the project
//   KPP_SETUP_TOKEN         one-time secret required to create the remote vault

import { createHash, timingSafeEqual } from 'node:crypto'
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'

const BLOB_PATH = 'kpp/vault.json'
const MAX_FAILS = 10
const FAIL_WINDOW_MS = 15 * 60 * 1000
const MAX_BODY_BYTES = 5 * 1024 * 1024

interface Envelope {
  format: 'keypassperso'
  v: 1
  kdf: { name: string; iterations: number; salt: string }
  iv: string
  ct: string
  rev: number
  updatedAt: number
}

interface StoredRecord {
  envelope: Envelope
  authHash: string
}

async function loadRecord(): Promise<{ record: StoredRecord; etag: string } | null> {
  // useCache:false reads from origin so a fresh write (e.g. rotated auth hash) is never served stale.
  const res = await get(BLOB_PATH, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  const text = await new Response(res.stream).text()
  return { record: JSON.parse(text) as StoredRecord, etag: res.blob.etag }
}

/** Atomic compare-and-swap: create-only when etag is null, otherwise ifMatch. Returns false on conflict. */
async function saveRecord(record: StoredRecord, etag: string | null): Promise<boolean> {
  try {
    await put(BLOB_PATH, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
    })
    return true
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) return false
    // Create-only put on an existing pathname also means someone else won the race.
    if (!etag && err instanceof Error && /already exists/i.test(err.message)) return false
    throw err
  }
}

// Best-effort, per-instance brute-force throttle. Pair it with a Vercel WAF rate-limit rule
// on /api/vault for a global limit (see README).
const fails = new Map<string, { n: number; until: number }>()

function isRateLimited(ip: string): boolean {
  const f = fails.get(ip)
  if (!f) return false
  if (Date.now() > f.until) {
    fails.delete(ip)
    return false
  }
  return f.n >= MAX_FAILS
}

function recordFailure(ip: string): void {
  const f = fails.get(ip)
  if (!f || Date.now() > f.until) fails.set(ip, { n: 1, until: Date.now() + FAIL_WINDOW_MS })
  else f.n++
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
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

function authenticate(req: Request, record: StoredRecord, ip: string): Response | null {
  if (isRateLimited(ip)) return json({ error: 'Trop de tentatives, réessaie dans 15 minutes' }, 429)
  const key = bearer(req)
  if (!key || !safeEqual(sha256(key), record.authHash)) {
    recordFailure(ip)
    return json({ error: 'Mot de passe maître incorrect pour le coffre distant' }, 401)
  }
  return null
}

async function handleGet(req: Request): Promise<Response> {
  const loaded = await loadRecord()
  if (!loaded) return json({ error: 'Aucun coffre distant' }, 404)
  const { record } = loaded

  // Salt + iterations are not secret; a new device needs them to derive its keys.
  if (new URL(req.url).searchParams.has('params')) {
    return json({ kdf: record.envelope.kdf, rev: record.envelope.rev })
  }
  const denied = authenticate(req, record, clientIp(req))
  if (denied) return denied
  return json({ envelope: record.envelope })
}

async function handlePut(req: Request): Promise<Response> {
  const ip = clientIp(req)
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Coffre trop volumineux' }, 413)

  let body: { envelope?: unknown; baseRev?: unknown; setupToken?: unknown; newAuthKey?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'JSON invalide' }, 400)
  }
  if (!isEnvelope(body.envelope) || !Number.isInteger(body.baseRev)) {
    return json({ error: 'Requête invalide' }, 400)
  }
  const baseRev = body.baseRev as number
  const loaded = await loadRecord()
  const record = loaded?.record

  let authHash: string
  if (!record) {
    // First upload: protected by the deployment-level setup token.
    const setup = process.env.KPP_SETUP_TOKEN
    if (!setup) return json({ error: 'KPP_SETUP_TOKEN non configuré sur Vercel' }, 503)
    if (isRateLimited(ip)) return json({ error: 'Trop de tentatives, réessaie dans 15 minutes' }, 429)
    if (typeof body.setupToken !== 'string' || !safeEqual(sha256(body.setupToken), sha256(setup))) {
      recordFailure(ip)
      return json({ error: 'Jeton d’initialisation invalide' }, 401)
    }
    const key = bearer(req)
    if (!key) return json({ error: 'Clé d’authentification manquante' }, 400)
    authHash = sha256(key)
  } else {
    const denied = authenticate(req, record, ip)
    if (denied) return denied
    if (record.envelope.rev !== baseRev) {
      return json({ error: 'Conflit de version', envelope: record.envelope }, 409)
    }
    authHash = record.authHash
  }

  // Master password change: rotate the stored auth hash.
  if (typeof body.newAuthKey === 'string') {
    if (!/^[0-9a-f]{64}$/.test(body.newAuthKey)) return json({ error: 'Nouvelle clé invalide' }, 400)
    authHash = sha256(body.newAuthKey)
  }

  const rev = (record?.envelope.rev ?? 0) + 1
  const envelope: Envelope = { ...body.envelope, rev, updatedAt: Date.now() }
  if (!(await saveRecord({ envelope, authHash }, loaded?.etag ?? null))) {
    const latest = await loadRecord()
    return json({ error: 'Conflit de version', envelope: latest?.record.envelope }, 409)
  }
  return json({ rev })
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      return json({ error: 'Stockage Blob non configuré' }, 503)
    }
    try {
      if (req.method === 'GET') return await handleGet(req)
      if (req.method === 'PUT') return await handlePut(req)
      return json({ error: 'Méthode non autorisée' }, 405)
    } catch (err) {
      console.error(err)
      return json({ error: 'Erreur serveur' }, 500)
    }
  },
}
