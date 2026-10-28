import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { totpAt } from '../api/_lib/security'

// In-memory fake of the private Vercel Blob store with ETag compare-and-swap.
const store = new Map<string, { body: string; etag: string; at: Date }>()
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
      store.set(path, { body, etag: `"${++etagSeq}"`, at: new Date() })
      return {}
    },
    list: async ({ prefix }: { prefix: string }) => ({
      blobs: [...store.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([pathname, v]) => ({ pathname, uploadedAt: v.at, size: v.body.length })),
    }),
    del: async (paths: string[]) => paths.forEach((p) => store.delete(p)),
  }
})
process.env.BLOB_STORE_ID = 'store_test'
process.env.KPP_SETUP_TOKEN = 'setup-secret'

const { default: handler } = await import('../api/vault')

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const RECOVERY = Array.from({ length: 10 }, (_, i) => `CODE${i}AAAA`)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const step = () => Math.floor(Date.now() / 30000)
const code = (offset = 0) => totpAt(SECRET, step() + offset)
const env = () => ({
  format: 'keypassperso', v: 1, iv: 'x', ct: 'y', rev: 0, updatedAt: 0,
  kdf: { name: 'PBKDF2-SHA256', iterations: 600000, salt: 's' },
})

let ipSeq = 0
async function call(method: string, action: string, opts: { auth?: string; session?: string; body?: unknown; ip?: string } = {}) {
  const res = await handler.fetch(
    new Request(`https://app.test/api/vault${action ? `?action=${action}` : ''}`, {
      method,
      headers: {
        'x-forwarded-for': opts.ip ?? `10.0.0.${++ipSeq % 250}`,
        ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}),
        ...(opts.session ? { 'x-kpp-session': opts.session } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
  )
  return { status: res.status, body: await res.json() }
}

async function setupVault() {
  const r = await call('POST', 'setup', {
    auth: A,
    body: { setupToken: 'setup-secret', envelope: env(), totpSecret: SECRET, code: code(-1), recovery: RECOVERY.map(sha) },
  })
  expect(r.status).toBe(200)
  return r.body.session.token as string
}

describe('api/vault', () => {
  beforeEach(() => store.clear())

  it('setup requires the setup token and a valid TOTP code', async () => {
    const base = { envelope: env(), totpSecret: SECRET, recovery: RECOVERY.map(sha) }
    expect((await call('POST', 'setup', { auth: A, body: { ...base, setupToken: 'nope', code: code() } })).status).toBe(401)
    expect((await call('POST', 'setup', { auth: A, body: { ...base, setupToken: 'setup-secret', code: '000000' } })).body.code).toBe('bad_code')
    await setupVault()
    expect((await call('POST', 'setup', { auth: A, body: { ...base, setupToken: 'setup-secret', code: code() } })).status).toBe(409)
  })

  it('does not store the TOTP secret in clear', async () => {
    await setupVault()
    expect(store.get('kpp/vault.json')!.body).not.toContain(SECRET)
  })

  it('requires password AND second factor to read', async () => {
    await setupVault()
    expect((await call('GET', 'params')).body.kdf.salt).toBe('s')
    expect((await call('GET', '', { auth: B })).body.code).toBe('bad_password')
    expect((await call('GET', '', { auth: A })).body.code).toBe('mfa_required')
    expect((await call('GET', '', { auth: A, session: '9999999999999.forged' })).body.code).toBe('mfa_required')
    expect((await call('POST', 'login', { auth: B, body: { code: code() } })).body.code).toBe('bad_password')

    const login = await call('POST', 'login', { auth: A, body: { code: code() } })
    expect(login.status).toBe(200)
    expect(login.body.envelope.ct).toBe('y')
    expect((await call('GET', '', { auth: A, session: login.body.session.token })).status).toBe(200)
  })

  it('rejects replayed TOTP codes', async () => {
    await setupVault()
    const c = code()
    expect((await call('POST', 'login', { auth: A, body: { code: c } })).status).toBe(200)
    expect((await call('POST', 'login', { auth: A, body: { code: c } })).body.code).toBe('bad_code')
  })

  it('accepts each recovery code once', async () => {
    await setupVault()
    const r = await call('POST', 'login', { auth: A, body: { recoveryCode: 'code3-aaaa' } })
    expect(r.status).toBe(200)
    expect(r.body.recoveryLeft).toBe(9)
    expect((await call('POST', 'login', { auth: A, body: { recoveryCode: 'CODE3AAAA' } })).body.code).toBe('bad_code')
  })

  it('locks the second factor after 5 wrong codes', async () => {
    await setupVault()
    for (let i = 0; i < 5; i++) await call('POST', 'login', { auth: A, body: { code: '123456' } })
    expect((await call('POST', 'login', { auth: A, body: { code: code() } })).status).toBe(429)
  })

  it('saves with optimistic concurrency, archives history, rotates keys on password change', async () => {
    const session = await setupVault()
    const ok = await call('PUT', '', { auth: A, session, body: { envelope: env(), baseRev: 1 } })
    expect(ok.body.rev).toBe(2)
    expect((await call('PUT', '', { auth: A, session, body: { envelope: env(), baseRev: 1 } })).status).toBe(409)

    const hist = await call('GET', 'history', { auth: A, session })
    expect(hist.body.versions.map((v: { rev: number }) => v.rev)).toEqual([1])
    expect((await call('GET', 'version', { auth: A, session })).status).toBe(404)

    const changed = await call('PUT', '', { auth: A, session, body: { envelope: env(), baseRev: 2, newAuthKey: B } })
    expect(changed.status).toBe(200)
    const newSession = changed.body.session.token
    expect((await call('GET', '', { auth: A, session })).body.code).toBe('bad_password')
    expect((await call('GET', '', { auth: B, session })).body.code).toBe('mfa_required')
    expect((await call('GET', '', { auth: B, session: newSession })).status).toBe(200)
    // TOTP secret was re-sealed under the new key and still verifies.
    expect((await call('POST', 'login', { auth: B, body: { code: code(1) } })).status).toBe(200)
  })

  it('revokes all sessions', async () => {
    const session = await setupVault()
    const r = await call('POST', 'revoke', { auth: A, session })
    expect((await call('GET', '', { auth: A, session })).body.code).toBe('mfa_required')
    expect((await call('GET', '', { auth: A, session: r.body.session.token })).status).toBe(200)
  })

  it('throttles repeated wrong passwords per IP', async () => {
    await setupVault()
    for (let i = 0; i < 10; i++) await call('GET', '', { auth: B, ip: '9.9.9.9' })
    expect((await call('GET', '', { auth: A, ip: '9.9.9.9' })).status).toBe(429)
  })
})
