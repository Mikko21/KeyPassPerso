// Agent access: credentials shared with an AI agent, sealed under a key derived from the agent's
// access token. The server stores only sha256(token) and ciphertext, so it can open a shared entry
// only while serving a request that carries the token. The main vault is never involved.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { readJson, removeJson, writeJson } from './store.js'

const AGENTS_PATH = 'kpp/agents.json'
const LOG_PATH = 'kpp/agent-log.json'
const SESSION_PREFIX = 'kpp/agent-sessions/'
const LOG_KEEP = 300
export const SESSION_TTL_MS = 30 * 60 * 1000

export interface SealedBox {
  iv: string
  ct: string
}

export interface SharedEntry {
  entryId: string
  title: string
  host: string // allowed domain (subdomains included)
  sealed: SealedBox // { username, password, url, totp } as JSON
}

export interface AgentGrant {
  id: string
  name: string
  tokenHash: string
  createdAt: number
  expiresAt: number | null
  entries: SharedEntry[]
}

export interface Credential {
  username: string
  password: string
  url: string
  totp: string
}

export interface LogEvent {
  at: number
  agentId: string
  agentName: string
  tool: string
  entry?: string
  url?: string
  ok: boolean
  detail?: string
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Must match src/lib/agents.ts: HKDF-SHA256(token bytes, zero salt, "kpp-agent-v1") -> AES-256-GCM. */
function agentKey(token: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(token, 'utf8'), Buffer.alloc(32), 'kpp-agent-v1', 32))
}

export function openBox<T>(box: SealedBox, token: string): T {
  const buf = Buffer.from(box.ct, 'base64')
  const d = createDecipheriv('aes-256-gcm', agentKey(token), Buffer.from(box.iv, 'base64'))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')) as T
}

export function sealBox(value: unknown, token: string): SealedBox {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', agentKey(token), iv)
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final(), c.getAuthTag()])
  return { iv: iv.toString('base64'), ct: ct.toString('base64') }
}

// ---------- Grants ----------

export async function loadGrants() {
  const loaded = await readJson<{ agents: AgentGrant[] }>(AGENTS_PATH)
  return { agents: loaded?.value.agents ?? [], etag: loaded?.etag ?? null }
}

export async function updateGrants(fn: (agents: AgentGrant[]) => AgentGrant[]): Promise<AgentGrant[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { agents, etag } = await loadGrants()
    const next = fn(agents)
    if (await writeJson(AGENTS_PATH, { agents: next }, etag)) return next
  }
  throw new Error('Conflit, réessaie')
}

export async function findGrant(token: string): Promise<AgentGrant | null> {
  const h = tokenHash(token)
  const { agents } = await loadGrants()
  const grant = agents.find((a) => a.tokenHash === h)
  if (!grant || (grant.expiresAt && grant.expiresAt < Date.now())) return null
  return grant
}

// ---------- Usage log ----------

export async function loadLog(): Promise<LogEvent[]> {
  return (await readJson<{ events: LogEvent[] }>(LOG_PATH))?.value.events ?? []
}

/** Best-effort append; logging must never break a tool call. */
export async function appendLog(ev: LogEvent): Promise<void> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await readJson<{ events: LogEvent[] }>(LOG_PATH)
      const events = [ev, ...(loaded?.value.events ?? [])].slice(0, LOG_KEEP)
      if (await writeJson(LOG_PATH, { events }, loaded?.etag ?? null)) return
    }
  } catch (err) {
    console.error('agent log failed', err)
  }
}

// ---------- Browsing sessions (cookie jars), sealed under the agent key ----------

export interface SiteSession {
  agentId: string
  entryId: string
  host: string
  cookies: Record<string, string>
  password: string // kept only to redact it from any page returned to the agent
  expiresAt: number
}

function sessionPath(handle: string): string {
  return `${SESSION_PREFIX}${tokenHash(handle)}.json`
}

export function newHandle(): string {
  return `kps_${randomBytes(18).toString('base64url')}`
}

export async function saveSession(handle: string, s: SiteSession, token: string): Promise<void> {
  const path = sessionPath(handle)
  const existing = await readJson<SealedBox>(path)
  await writeJson(path, sealBox(s, token), existing?.etag ?? null)
}

export async function loadSession(handle: string, token: string): Promise<SiteSession | null> {
  const loaded = await readJson<SealedBox>(sessionPath(handle))
  if (!loaded) return null
  try {
    const s = openBox<SiteSession>(loaded.value, token)
    if (s.expiresAt < Date.now()) {
      await removeJson(sessionPath(handle))
      return null
    }
    return s
  } catch {
    return null // sealed for another agent
  }
}
