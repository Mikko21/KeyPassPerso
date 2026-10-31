// Agent access tokens and credential sealing. Must stay byte-compatible with api/_lib/agents.ts:
// key = HKDF-SHA256(token as UTF-8, 32 zero bytes salt, "kpp-agent-v1"), cipher = AES-256-GCM.

import { hostOf } from './categories'
import { randomBytes, toB64 } from './crypto'
import type { AgentAccess, Entry } from './types'

const enc = new TextEncoder()

export function generateAgentToken(): string {
  const b64 = toB64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `kpa_${b64}`
}

export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(token))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function agentKey(token: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('kpp-agent-v1') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
}

export async function sealForAgent(value: unknown, token: string): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await agentKey(token), enc.encode(JSON.stringify(value)))
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
}

/** Entries an agent can log in with: they need a site and a password. */
export function isShareable(e: Entry): boolean {
  return !!e.password && !!hostOf(e.url)
}

/** Server-side grant: only sealed credentials and the token hash, never the token itself. */
export async function buildGrant(access: AgentAccess, entries: Entry[]) {
  const shared = entries.filter((e) => access.entryIds.includes(e.id) && isShareable(e))
  return {
    id: access.id,
    name: access.name,
    tokenHash: await hashToken(access.token),
    createdAt: access.createdAt,
    expiresAt: access.expiresAt,
    entries: await Promise.all(
      shared.map(async (e) => ({
        entryId: e.id,
        title: e.title,
        host: hostOf(e.url).toLowerCase(),
        sealed: await sealForAgent({ username: e.username, password: e.password, url: e.url, totp: e.totp }, access.token),
      })),
    ),
  }
}

/** Changes to this signature mean the server-side grant must be re-sealed. */
export function grantSignature(access: AgentAccess, entries: Entry[]): string {
  const parts = access.entryIds.map((id) => `${id}:${entries.find((e) => e.id === id)?.updatedAt ?? 0}`)
  return `${access.name}|${access.expiresAt}|${parts.join(',')}`
}

export const MCP_URL = `${typeof location !== 'undefined' ? location.origin : 'https://keypassperso.vercel.app'}/api/mcp`
