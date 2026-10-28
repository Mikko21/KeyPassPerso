// Client for the /api/vault sync endpoint. Only ciphertext and the derived authKey are sent.

import type { KdfParams, VaultEnvelope } from './crypto'

export class SyncError extends Error {
  status: number
  remote?: VaultEnvelope
  constructor(message: string, status: number, remote?: VaultEnvelope) {
    super(message)
    this.status = status
    this.remote = remote
  }
}

async function call<T>(init: RequestInit & { query?: string }): Promise<T> {
  const res = await fetch(`/api/vault${init.query ?? ''}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string; envelope?: VaultEnvelope }
  if (!res.ok) throw new SyncError(body.error ?? `Erreur ${res.status}`, res.status, body.envelope)
  return body as T
}

/** Public: KDF salt/iterations so a new device can derive keys before authenticating. */
export function fetchRemoteParams(): Promise<{ kdf: KdfParams; rev: number }> {
  return call({ method: 'GET', query: '?params=1' })
}

export function fetchRemote(authKey: string): Promise<{ envelope: VaultEnvelope }> {
  return call({ method: 'GET', headers: { Authorization: `Bearer ${authKey}` } })
}

export function pushRemote(args: {
  authKey: string
  envelope: VaultEnvelope
  baseRev: number
  setupToken?: string
  newAuthKey?: string
}): Promise<{ rev: number }> {
  return call({
    method: 'PUT',
    headers: { Authorization: `Bearer ${args.authKey}` },
    body: JSON.stringify({
      envelope: args.envelope,
      baseRev: args.baseRev,
      setupToken: args.setupToken,
      newAuthKey: args.newAuthKey,
    }),
  })
}
