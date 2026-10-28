// Zero-knowledge vault cryptography, built only on the browser WebCrypto API.
//
// masterPassword --PBKDF2-SHA256(600k)--> masterBits --HKDF--> encKey (AES-256-GCM, non-extractable)
//                                                     \-HKDF--> authKey (sent to the sync server, never the password)
// The server only ever sees the ciphertext and a hash of authKey.

import type { VaultData } from './types'

export const KDF_ITERATIONS = 600_000
const AAD = new TextEncoder().encode('keypassperso/v1')

export interface KdfParams {
  name: 'PBKDF2-SHA256'
  iterations: number
  salt: string // base64
}

export interface VaultEnvelope {
  format: 'keypassperso'
  v: 1
  kdf: KdfParams
  iv: string // base64
  ct: string // base64
  rev: number
  updatedAt: number
}

export interface SessionKeys {
  encKey: CryptoKey
  authKey: string // hex, used as bearer secret for the sync API
  kdf: KdfParams
}

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function newKdfParams(): KdfParams {
  return { name: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: toB64(randomBytes(16)) }
}

export async function deriveKeys(password: string, kdf: KdfParams): Promise<SessionKeys> {
  const pwKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(kdf.salt), iterations: kdf.iterations },
    pwKey,
    256,
  )
  const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const salt = new Uint8Array(32)
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('kpp-enc') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('kpp-auth') },
    hkdfKey,
    256,
  )
  return { encKey, authKey: toHex(new Uint8Array(authBits)), kdf }
}

export async function encryptVault(
  data: VaultData,
  keys: SessionKeys,
  rev: number,
): Promise<VaultEnvelope> {
  const iv = randomBytes(12)
  const plain = new TextEncoder().encode(JSON.stringify(data))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, keys.encKey, plain)
  return {
    format: 'keypassperso',
    v: 1,
    kdf: keys.kdf,
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
    rev,
    updatedAt: Date.now(),
  }
}

/** Throws if the password is wrong or the ciphertext was tampered with (GCM auth tag). */
export async function decryptVault(env: VaultEnvelope, keys: SessionKeys): Promise<VaultData> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(env.iv), additionalData: AAD },
    keys.encKey,
    fromB64(env.ct),
  )
  return JSON.parse(new TextDecoder().decode(plain)) as VaultData
}

export function isEnvelope(x: unknown): x is VaultEnvelope {
  const e = x as VaultEnvelope
  return !!e && e.format === 'keypassperso' && e.v === 1 && typeof e.ct === 'string' && !!e.kdf?.salt
}
