// Client for /api/vault. Only ciphertext, the derived authKey and second-factor material are sent.

import type { KdfParams, VaultEnvelope } from './crypto'

export type ApiErrorCode = 'bad_password' | 'mfa_required' | 'bad_code' | 'locked' | 'conflict' | 'not_found' | 'invalid' | 'server' | 'network'

export class ApiError extends Error {
  status: number
  code: ApiErrorCode
  remote?: VaultEnvelope
  constructor(message: string, status: number, code: ApiErrorCode, remote?: VaultEnvelope) {
    super(message)
    this.status = status
    this.code = code
    this.remote = remote
  }
}

export interface AgentLogEvent {
  at: number
  agentId: string
  agentName: string
  tool: string
  entry?: string
  url?: string
  ok: boolean
  detail?: string
}

export interface Session {
  token: string
  expiresAt: number
}

interface CallOptions {
  method: 'GET' | 'POST' | 'PUT'
  action?: string
  query?: Record<string, string>
  authKey?: string
  session?: string
  body?: unknown
}

async function call<T>(o: CallOptions): Promise<T> {
  const qs = new URLSearchParams({ ...(o.action ? { action: o.action } : {}), ...o.query }).toString()
  let res: Response
  try {
    res = await fetch(`/api/vault${qs ? `?${qs}` : ''}`, {
      method: o.method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(o.authKey ? { Authorization: `Bearer ${o.authKey}` } : {}),
        ...(o.session ? { 'x-kpp-session': o.session } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    })
  } catch {
    throw new ApiError('Serveur injoignable, vérifie ta connexion', 0, 'network')
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: ApiErrorCode; envelope?: VaultEnvelope }
  if (!res.ok) throw new ApiError(body.error ?? `Erreur ${res.status}`, res.status, body.code ?? 'server', body.envelope)
  return body as T
}

export const api = {
  params: () => call<{ kdf: KdfParams }>({ method: 'GET', action: 'params' }),

  setup: (authKey: string, body: { setupToken: string; envelope: VaultEnvelope; totpSecret: string; code: string; recovery: string[] }) =>
    call<{ session: Session; rev: number }>({ method: 'POST', action: 'setup', authKey, body }),

  login: (authKey: string, body: { code?: string; recoveryCode?: string; trust: boolean }) =>
    call<{ session: Session; envelope: VaultEnvelope; recoveryLeft: number; recoveryUsed: boolean }>({
      method: 'POST',
      action: 'login',
      authKey,
      body,
    }),

  fetch: (authKey: string, session?: string) =>
    call<{ envelope: VaultEnvelope; recoveryLeft: number }>({ method: 'GET', authKey, session }),

  save: (authKey: string, session: string, body: { envelope: VaultEnvelope; baseRev: number; newAuthKey?: string }) =>
    call<{ rev: number; session?: Session }>({ method: 'PUT', authKey, session, body }),

  updateMfa: (authKey: string, session: string, body: { totpSecret?: string; code?: string; recovery?: string[] }) =>
    call<{ recoveryLeft: number }>({ method: 'POST', action: 'mfa', authKey, session, body }),

  revoke: (authKey: string, session: string) => call<{ session: Session }>({ method: 'POST', action: 'revoke', authKey, session }),

  history: (authKey: string, session: string) =>
    call<{ versions: { rev: number; at: number; size: number }[] }>({ method: 'GET', action: 'history', authKey, session }),

  agents: (authKey: string, session: string) =>
    call<{ agents: { id: string; name: string; entries: string[] }[]; log: AgentLogEvent[] }>({ method: 'GET', action: 'agents', authKey, session }),

  agentSave: (authKey: string, session: string, agent: unknown) =>
    call<{ ok: true }>({ method: 'POST', action: 'agent-save', authKey, session, body: { agent } }),

  agentRevoke: (authKey: string, session: string, id: string) =>
    call<{ ok: true }>({ method: 'POST', action: 'agent-revoke', authKey, session, body: { id } }),

  version: (authKey: string, session: string, rev: number) =>
    call<{ envelope: VaultEnvelope }>({ method: 'GET', action: 'version', query: { rev: String(rev) }, authKey, session }),
}
