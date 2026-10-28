// Local persistence: only the encrypted envelope ever touches localStorage.

import { isEnvelope, type VaultEnvelope } from './crypto'

const VAULT_KEY = 'kpp:vault'
const SYNC_KEY = 'kpp:sync'

export interface SyncState {
  enabled: boolean
  remoteRev: number // last remote revision this device saw
  lastSyncAt: number | null
  dirty: boolean // local changes not yet pushed
}

const DEFAULT_SYNC: SyncState = { enabled: false, remoteRev: 0, lastSyncAt: null, dirty: false }

export function loadEnvelope(): VaultEnvelope | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveEnvelope(env: VaultEnvelope): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(env))
}

export function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_KEY)
    if (raw) return { ...DEFAULT_SYNC, ...JSON.parse(raw) }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_SYNC }
}

export function saveSyncState(s: SyncState): void {
  localStorage.setItem(SYNC_KEY, JSON.stringify(s))
}

export function wipeLocal(): void {
  localStorage.removeItem(VAULT_KEY)
  localStorage.removeItem(SYNC_KEY)
}

export function downloadBackup(env: VaultEnvelope): void {
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `coffre-${d}.kpp.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readBackupFile(file: File): Promise<VaultEnvelope> {
  const parsed: unknown = JSON.parse(await file.text())
  if (!isEnvelope(parsed)) throw new Error('Fichier de sauvegarde invalide')
  return parsed
}
