import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake of the private Vercel Blob store with ETag compare-and-swap.
const store = new Map<string, { body: string; etag: string }>()
let etagSeq = 0
vi.mock('@vercel/blob', () => {
  class BlobPreconditionFailedError extends Error {}
  return {
    BlobPreconditionFailedError,
    get: async (path: string) => {
      const item = store.get(path)
      if (!item) return null
      return { statusCode: 200, stream: new Response(item.body).body, blob: { etag: item.etag } }
    },
    put: async (path: string, body: string, opts: { ifMatch?: string; allowOverwrite?: boolean }) => {
      const cur = store.get(path)
      if (opts.ifMatch && cur?.etag !== opts.ifMatch) throw new BlobPreconditionFailedError()
      if (!opts.ifMatch && cur && !opts.allowOverwrite) throw new Error('This blob already exists')
      store.set(path, { body, etag: `"${++etagSeq}"` })
      return {}
    },
  }
})
process.env.BLOB_READ_WRITE_TOKEN = 't'
process.env.KPP_SETUP_TOKEN = 'setup-secret'

const { default: handler } = await import('../api/vault')

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const env = (rev = 0) => ({
  format: 'keypassperso', v: 1, iv: 'x', ct: 'y', rev, updatedAt: 0,
  kdf: { name: 'PBKDF2-SHA256', iterations: 600000, salt: 's' },
})
const req = (method: string, auth?: string, body?: unknown, q = '') =>
  handler.fetch(
    new Request(`https://app.test/api/vault${q}`, {
      method,
      headers: { 'x-forwarded-for': '1.2.3.4', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )

describe('api/vault', () => {
  beforeEach(() => store.clear())

  it('requires the setup token for the first upload', async () => {
    expect((await req('PUT', A, { envelope: env(), baseRev: 0 })).status).toBe(401)
    expect((await req('PUT', A, { envelope: env(), baseRev: 0, setupToken: 'setup-secret' })).status).toBe(200)
  })

  it('authenticates reads and writes, detects conflicts, rotates keys', async () => {
    await req('PUT', A, { envelope: env(), baseRev: 0, setupToken: 'setup-secret' })
    const params = await (await req('GET', undefined, undefined, '?params=1')).json()
    expect(params.rev).toBe(1)
    expect(params).not.toHaveProperty('envelope')
    expect((await req('GET', B)).status).toBe(401)
    expect((await req('GET', A)).status).toBe(200)
    expect((await req('PUT', A, { envelope: env(), baseRev: 0 })).status).toBe(409)
    expect((await req('PUT', A, { envelope: env(), baseRev: 1, newAuthKey: B })).status).toBe(200)
    expect((await req('GET', A)).status).toBe(401)
    expect((await req('GET', B)).status).toBe(200)
  })

  it('rate-limits after repeated failures', async () => {
    store.clear()
    await req('PUT', A, { envelope: env(), baseRev: 0, setupToken: 'setup-secret' })
    for (let i = 0; i < 10; i++) await req('GET', B)
    expect((await req('GET', A)).status).toBe(429)
  })
})
