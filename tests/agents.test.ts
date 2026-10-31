import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake of the private Vercel Blob store.
const store = new Map<string, { body: string; etag: string }>()
let etagSeq = 0
vi.mock('@vercel/blob', () => {
  class BlobPreconditionFailedError extends Error {}
  class BlobNotFoundError extends Error {}
  return {
    BlobPreconditionFailedError,
    BlobNotFoundError,
    head: async (p: string) => {
      const it = store.get(p)
      if (!it) throw new BlobNotFoundError()
      return { etag: it.etag }
    },
    get: async (p: string) => {
      const it = store.get(p)
      return it ? { statusCode: 200, stream: new Response(it.body).body, blob: { etag: 'cdn' } } : null
    },
    put: async (p: string, body: string, o: { ifMatch?: string; allowOverwrite?: boolean }) => {
      const cur = store.get(p)
      if (o.ifMatch && cur?.etag !== o.ifMatch) throw new BlobPreconditionFailedError()
      if (!o.ifMatch && cur && !o.allowOverwrite) throw new Error('This blob already exists')
      store.set(p, { body, etag: `"${++etagSeq}"` })
      return {}
    },
    list: async () => ({ blobs: [] }),
    del: async (paths: string | string[]) => [paths].flat().forEach((p) => store.delete(p)),
  }
})

// Fake booking site (classic PHP-style form login + session cookie).
const PASSWORD = 'S3cr3t-Padel!'
const realFetch = globalThis.fetch
vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (url.hostname !== 'club.test' && !url.hostname.endsWith('.club.test')) return realFetch(input, init)
  const cookie = new Headers(init.headers).get('cookie') ?? ''
  const logged = cookie.includes('SID=abc123')
  if (url.pathname === '/reservations.php' && init.method !== 'POST') {
    return new Response(
      logged
        ? `<html><body><a href="/logout.php">Abmelden</a><table><tr><td class="available">09:30 - 11:00</td><td class="ordered">11:00 - 12:30</td></tr></table>
           <form action="/reservations.php" method="post"><input type="hidden" name="action" value="showOrder"><input type="checkbox" name="slot[]" value="35_0930"></form></body></html>`
        : `<html><body><form id="login-form" method="post" action="login.php"><input type="hidden" name="action" value="logIn"><input type="text" name="username"><input type="password" name="password"></form></body></html>`,
      { headers: { 'content-type': 'text/html' } },
    )
  }
  if (url.pathname === '/login.php' && init.method === 'POST') {
    const body = new URLSearchParams(String(init.body))
    if (body.get('username') === 'nico' && body.get('password') === PASSWORD && body.get('action') === 'logIn') {
      return new Response(null, { status: 302, headers: { location: '/welcome.php', 'set-cookie': 'SID=abc123; Path=/; HttpOnly' } })
    }
    return new Response('<form method="post" action="login.php"><input name="username"><input type="password" name="password"></form>', { status: 200 })
  }
  if (url.pathname === '/welcome.php') {
    // A careless site echoing the password back must still never leak it to the agent.
    return new Response(`<html><body>Willkommen nico ! (debug: ${PASSWORD}) <a href="/logout.php">Abmelden</a></body></html>`)
  }
  if (url.pathname === '/reservations.php' && init.method === 'POST') {
    const body = new URLSearchParams(String(init.body))
    return new Response(logged ? `<p>Reservierung bestätigt: ${body.getAll('slot[]').join(',')}</p>` : '<p>Bitte anmelden</p>')
  }
  return new Response('not found', { status: 404 })
})

process.env.BLOB_STORE_ID = 'store_test'

const { default: mcp } = await import('../api/mcp')
const { updateGrants, openBox, tokenHash } = await import('../api/_lib/agents')
const { buildGrant, generateAgentToken, sealForAgent } = await import('../src/lib/agents')
const { newEntry } = await import('../src/lib/types')

const entry = { ...newEntry(), id: 'e1', title: 'CK Sportcenter', username: 'nico', password: PASSWORD, url: 'https://club.test/reservations.php' }
const other = { ...newEntry(), id: 'e2', title: 'Banque', username: 'x', password: 'bank-pw', url: 'https://bank.test' }

let token: string
let seq = 0
async function rpc(method: string, params: object = {}, auth = token) {
  const res = await mcp.fetch(
    new Request('https://kpp.test/api/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    }),
  )
  return { status: res.status, body: res.status === 202 ? null : await res.json() }
}
const call = async (name: string, args: object = {}) => {
  const r = await rpc('tools/call', { name, arguments: args })
  return { text: r.body.result.content[0].text as string, isError: r.body.result.isError as boolean }
}

describe('agent sealing', () => {
  it('browser-sealed credentials open on the server', async () => {
    const t = generateAgentToken()
    const box = await sealForAgent({ password: 'p@ss' }, t)
    expect(openBox<{ password: string }>(box, t).password).toBe('p@ss')
    expect(() => openBox(box, generateAgentToken())).toThrow()
  })
})

describe('MCP endpoint', () => {
  beforeEach(async () => {
    store.clear()
    token = generateAgentToken()
    const access = { id: 'a1', name: 'Routine padel', token, entryIds: ['e1'], expiresAt: null, createdAt: 1, updatedAt: 1 }
    const grant = await buildGrant(access, [entry, other])
    await updateGrants(() => [grant])
  })

  it('rejects unknown tokens and stores no plaintext', async () => {
    expect((await rpc('tools/list', {}, generateAgentToken())).status).toBe(401)
    const blob = store.get('kpp/agents.json')!.body
    expect(blob).not.toContain(PASSWORD)
    expect(blob).not.toContain(token)
    expect(blob).toContain(tokenHash(token))
  })

  it('speaks MCP: initialize, notifications, tools/list', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.body.result.protocolVersion).toBe('2025-06-18')
    const notif = await mcp.fetch(
      new Request('https://kpp.test/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
    )
    expect(notif.status).toBe(202)
    const tools = (await rpc('tools/list')).body.result.tools.map((t: { name: string }) => t.name)
    expect(tools).toEqual(['list_logins', 'site_login', 'site_get', 'site_submit'])
  })

  it('only lists shared entries', async () => {
    const r = await call('list_logins')
    expect(r.text).toContain('CK Sportcenter')
    expect(r.text).not.toContain('Banque')
  })

  it('logs in, browses and submits without ever returning the password or cookies', async () => {
    const login = await call('site_login', { entry: 'ck sportcenter' })
    expect(login.isError).toBe(false)
    expect(login.text).toContain('Connecté')
    expect(login.text).not.toContain(PASSWORD)
    expect(login.text).toContain('[secret masqué]')
    expect(login.text).not.toContain('abc123')
    const session = /Session : (kps_[\w-]+)/.exec(login.text)![1]

    const page = await call('site_get', { session, url: 'https://club.test/reservations.php' })
    expect(page.text).toContain('[available] 09:30 - 11:00')
    expect(page.text).toContain('[ordered] 11:00 - 12:30')
    expect(page.text).toContain('slot[] (checkbox)')

    const booked = await call('site_submit', { session, url: 'https://club.test/reservations.php', fields: { action: 'showOrder', 'slot[]': ['35_0930'] } })
    expect(booked.text).toContain('Reservierung bestätigt: 35_0930')

    const log = JSON.parse(store.get('kpp/agent-log.json')!.body).events
    expect(log.map((e: { tool: string }) => e.tool)).toEqual(['site_submit', 'site_get', 'site_login'])
  })

  it('refuses other domains and http', async () => {
    const login = await call('site_login', { entry: 'CK Sportcenter' })
    const session = /Session : (kps_[\w-]+)/.exec(login.text)![1]
    expect((await call('site_get', { session, url: 'https://evil.test/steal' })).isError).toBe(true)
    expect((await call('site_get', { session, url: 'http://club.test/reservations.php' })).isError).toBe(true)
    expect((await call('site_get', { session, url: 'https://www.club.test/reservations.php' })).isError).toBe(false)
  })

  it('stops working once revoked or expired', async () => {
    await updateGrants((list) => list.map((g) => ({ ...g, expiresAt: Date.now() - 1 })))
    expect((await rpc('tools/list')).status).toBe(401)
    await updateGrants(() => [])
    expect((await rpc('tools/list')).status).toBe(401)
  })

  it('a session handle is useless with another agent token', async () => {
    const login = await call('site_login', { entry: 'CK Sportcenter' })
    const session = /Session : (kps_[\w-]+)/.exec(login.text)![1]
    const t2 = generateAgentToken()
    const grant2 = await buildGrant({ id: 'a2', name: 'Autre', token: t2, entryIds: ['e1'], expiresAt: null, createdAt: 1, updatedAt: 1 }, [entry])
    await updateGrants((list) => [...list, grant2])
    token = t2
    expect((await call('site_get', { session, url: 'https://club.test/reservations.php' })).isError).toBe(true)
  })
})
