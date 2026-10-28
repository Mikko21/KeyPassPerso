// Private Vercel Blob persistence: the vault record plus a rolling history of previous envelopes.

import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob'
import type { Sealed } from './security.js'

const RECORD_PATH = 'kpp/vault.json'
const HISTORY_PREFIX = 'kpp/history/'
export const HISTORY_KEEP = 30

export interface Envelope {
  format: 'keypassperso'
  v: 1
  kdf: { name: string; iterations: number; salt: string }
  iv: string
  ct: string
  rev: number
  updatedAt: number
}

export interface StoredRecord {
  v: 2
  envelope: Envelope
  authHash: string // sha256(authKey)
  totp: Sealed // base32 secret sealed under authKey
  totpLastStep: number // anti-replay
  recovery: string[] // sha256 of normalized one-time recovery codes
  sessionSecret: string // rotate to revoke all sessions / trusted devices
  mfaFails: number
  lockUntil: number
}

async function readJson<T>(path: string): Promise<{ value: T; etag: string } | null> {
  // useCache:false reads from origin so a fresh write (e.g. rotated auth hash) is never served stale.
  const res = await get(path, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  return { value: JSON.parse(await new Response(res.stream).text()) as T, etag: res.blob.etag }
}

export function loadRecord() {
  return readJson<StoredRecord>(RECORD_PATH)
}

/** Atomic compare-and-swap: create-only when etag is null, otherwise ifMatch. Returns false on conflict. */
export async function saveRecord(record: StoredRecord, etag: string | null): Promise<boolean> {
  try {
    await put(RECORD_PATH, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
    })
    return true
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) return false
    if (!etag && err instanceof Error && /already exists/i.test(err.message)) return false
    throw err
  }
}

function historyPath(rev: number): string {
  return `${HISTORY_PREFIX}${String(rev).padStart(10, '0')}.json`
}

/** Archives an envelope and prunes old versions. Best-effort: never blocks a save. */
export async function archive(envelope: Envelope): Promise<void> {
  try {
    await put(historyPath(envelope.rev), JSON.stringify(envelope), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    })
    const { blobs } = await list({ prefix: HISTORY_PREFIX, limit: 1000 })
    const sorted = blobs.map((b) => b.pathname).sort()
    const excess = sorted.slice(0, Math.max(0, sorted.length - HISTORY_KEEP))
    if (excess.length) await del(excess)
  } catch (err) {
    console.error('history archive failed', err)
  }
}

export async function listHistory(): Promise<{ rev: number; at: number; size: number }[]> {
  const { blobs } = await list({ prefix: HISTORY_PREFIX, limit: 1000 })
  return blobs
    .map((b) => ({
      rev: Number(b.pathname.slice(HISTORY_PREFIX.length).replace('.json', '')),
      at: new Date(b.uploadedAt).getTime(),
      size: b.size,
    }))
    .filter((h) => Number.isInteger(h.rev))
    .sort((a, b) => b.rev - a.rev)
}

export async function loadVersion(rev: number): Promise<Envelope | null> {
  return (await readJson<Envelope>(historyPath(rev)))?.value ?? null
}
