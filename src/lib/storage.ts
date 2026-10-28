// Browser persistence. The vault itself lives on the server; locally we only keep session tokens
// and, transiently, a legacy v1 local vault until it is migrated.

import { isEnvelope, type VaultEnvelope } from './crypto'
import type { Session } from './api'

const LEGACY_VAULT_KEY = 'kpp:vault'
const LEGACY_SYNC_KEY = 'kpp:sync'
const SESSION_KEY = 'kpp:session' // sessionStorage: dies with the tab
const TRUSTED_KEY = 'kpp:trusted' // localStorage: "trust this device for 30 days"

function read(storage: Storage, key: string): Session | null {
  try {
    const s = JSON.parse(storage.getItem(key) ?? 'null') as Session | null
    if (s && typeof s.token === 'string' && s.expiresAt > Date.now()) return s
    storage.removeItem(key)
  } catch {
    // ignore unavailable or corrupted storage
  }
  return null
}

export const sessionStore = {
  get(): Session | null {
    return read(sessionStorage, SESSION_KEY) ?? read(localStorage, TRUSTED_KEY)
  },
  isTrusted(): boolean {
    return read(localStorage, TRUSTED_KEY) !== null
  },
  set(s: Session, trusted: boolean): void {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    if (trusted) localStorage.setItem(TRUSTED_KEY, JSON.stringify(s))
  },
  /** Replaces the token wherever it is stored (after password change or revocation). */
  update(s: Session): void {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    if (read(localStorage, TRUSTED_KEY)) localStorage.setItem(TRUSTED_KEY, JSON.stringify(s))
  },
  forgetTrusted(): void {
    localStorage.removeItem(TRUSTED_KEY)
  },
  clear(): void {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(TRUSTED_KEY)
  },
}

export function loadLegacyEnvelope(): VaultEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_VAULT_KEY) ?? 'null')
    return isEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearLegacy(): void {
  localStorage.removeItem(LEGACY_VAULT_KEY)
  localStorage.removeItem(LEGACY_SYNC_KEY)
}

export function downloadBackup(env: VaultEnvelope): void {
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `coffre-${new Date().toISOString().slice(0, 10)}.kpp.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readBackupFile(file: File): Promise<VaultEnvelope> {
  const parsed: unknown = JSON.parse(await file.text())
  if (!isEnvelope(parsed)) throw new Error('Fichier de sauvegarde invalide')
  return parsed
}
