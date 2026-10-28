// Server-side crypto helpers: hashing, TOTP verification, session tokens, TOTP secret sealing.
// Files under api/_lib are not exposed as Vercel Functions.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    const idx = B32.indexOf(c)
    if (idx === -1) throw new Error('invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', base32Decode(secretB32)).update(msg).digest()
  const o = mac[mac.length - 1] & 0x0f
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]
  return (bin % 1_000_000).toString().padStart(6, '0')
}

/**
 * Returns the matching time step (±1 step of clock drift), or null.
 * Steps <= lastStep are rejected so a code can never be replayed.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(now / 1000 / 30)
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && safeEqual(totpAt(secretB32, step), code)) return step
  }
  return null
}

// ---------- TOTP secret sealing ----------
// The TOTP secret is stored encrypted under a key derived from the client's authKey, so a leaked
// Blob alone does not reveal it; the server can only open it while serving an authenticated request.

export interface Sealed {
  iv: string
  ct: string
}

function sealKey(authKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(authKey, 'hex'), Buffer.alloc(32), 'kpp-totp-seal', 32))
}

export function seal(plain: string, authKey: string): Sealed {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', sealKey(authKey), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
  return { iv: iv.toString('base64'), ct: ct.toString('base64') }
}

export function unseal(s: Sealed, authKey: string): string {
  const buf = Buffer.from(s.ct, 'base64')
  const d = createDecipheriv('aes-256-gcm', sealKey(authKey), Buffer.from(s.iv, 'base64'))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')
}

// ---------- Session tokens ----------
// Stateless HMAC token "<exp>.<sig>", bound to the current authHash: changing the master password
// or rotating sessionSecret invalidates every outstanding session.

export const SESSION_TTL_MS = 12 * 3600 * 1000
export const TRUSTED_TTL_MS = 30 * 24 * 3600 * 1000

export function newSecret(): string {
  return randomBytes(32).toString('base64')
}

function sign(exp: number, authHash: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64')).update(`${exp}.${authHash}`).digest('base64url')
}

export function issueSession(authHash: string, secret: string, ttlMs: number): { token: string; expiresAt: number } {
  const exp = Date.now() + ttlMs
  return { token: `${exp}.${sign(exp, authHash, secret)}`, expiresAt: exp }
}

export function verifySession(token: string | null, authHash: string, secret: string): boolean {
  if (!token) return false
  const [expStr, sig] = token.split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false
  return safeEqual(sig, sign(exp, authHash, secret))
}

export function sessionExpiry(token: string): number {
  return Number(token.split('.')[0])
}
