import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake of the Upstash REST API.
const store = new Map<string, string>()
const realFetch = globalThis.fetch
vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
  if (!String(url).startsWith('https://redis.test')) return realFetch(url, init)
  const [cmd, key, val] = JSON.parse(String(init.body)) as string[]
  let result: unknown = 'OK'
  if (cmd === 'GET') result = store.get(key) ?? null
  else if (cmd === 'SET') store.set(key, val)
  else if (cmd === 'INCR') store.set(key, String(Number(store.get(key) ?? 0) + 1)), (result = Number(store.get(key)))
  return new Response(JSON.stringify({ result }))
})
process.env.KV_REST_API_URL = 'https://redis.test'
process.env.KV_REST_API_TOKEN = 't'
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
    await req('PUT', A, { envelope: env(), baseRev: 0, setupToken: 'setup-secret' })
    for (let i = 0; i < 10; i++) await req('GET', B)
    expect((await req('GET', A)).status).toBe(429)
  })
})
