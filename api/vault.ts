// Vercel Function: stores the single encrypted vault in Upstash Redis (REST API, no SDK).
// The server never sees the master password or plaintext: only ciphertext + sha256(authKey).
//
// Env vars:
//   KV_REST_API_URL / KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
//   KPP_SETUP_TOKEN                       one-time secret required to create the remote vault

import { createHash, timingSafeEqual } from 'node:crypto'

const RECORD_KEY = 'kpp:vault'
const MAX_FAILS = 10
const FAIL_WINDOW_S = 15 * 60
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

const REDIS_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  const res = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  const body = (await res.json()) as { result?: T; error?: string }
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error ?? res.status}`)
  return body.result as T
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

async function loadRecord(): Promise<StoredRecord | null> {
  const raw = await redis<string | null>('GET', RECORD_KEY)
  return raw ? (JSON.parse(raw) as StoredRecord) : null
}

async function isRateLimited(ip: string): Promise<boolean> {
  const n = Number((await redis<string | null>('GET', `kpp:fail:${ip}`)) ?? 0)
  return n >= MAX_FAILS
}

async function recordFailure(ip: string): Promise<void> {
  const n = await redis<number>('INCR', `kpp:fail:${ip}`)
  if (n === 1) await redis('EXPIRE', `kpp:fail:${ip}`, FAIL_WINDOW_S)
}

async function authenticate(req: Request, record: StoredRecord, ip: string): Promise<Response | null> {
  if (await isRateLimited(ip)) return json({ error: 'Trop de tentatives, réessaie dans 15 minutes' }, 429)
  const key = bearer(req)
  if (!key || !safeEqual(sha256(key), record.authHash)) {
    await recordFailure(ip)
    return json({ error: 'Mot de passe maître incorrect pour le coffre distant' }, 401)
  }
  return null
}

async function handleGet(req: Request): Promise<Response> {
  const record = await loadRecord()
  if (!record) return json({ error: 'Aucun coffre distant' }, 404)

  // Salt + iterations are not secret; a new device needs them to derive its keys.
  if (new URL(req.url).searchParams.has('params')) {
    return json({ kdf: record.envelope.kdf, rev: record.envelope.rev })
  }
  const denied = await authenticate(req, record, clientIp(req))
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
  const record = await loadRecord()

  let authHash: string
  if (!record) {
    // First upload: protected by the deployment-level setup token.
    const setup = process.env.KPP_SETUP_TOKEN
    if (!setup) return json({ error: 'KPP_SETUP_TOKEN non configuré sur Vercel' }, 503)
    if (await isRateLimited(ip)) return json({ error: 'Trop de tentatives, réessaie dans 15 minutes' }, 429)
    if (typeof body.setupToken !== 'string' || !safeEqual(sha256(body.setupToken), sha256(setup))) {
      await recordFailure(ip)
      return json({ error: 'Jeton d’initialisation invalide' }, 401)
    }
    const key = bearer(req)
    if (!key) return json({ error: 'Clé d’authentification manquante' }, 400)
    authHash = sha256(key)
  } else {
    const denied = await authenticate(req, record, ip)
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
  await redis('SET', RECORD_KEY, JSON.stringify({ envelope, authHash } satisfies StoredRecord))
  return json({ rev })
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (!REDIS_URL || !REDIS_TOKEN) return json({ error: 'Stockage distant non configuré' }, 503)
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
