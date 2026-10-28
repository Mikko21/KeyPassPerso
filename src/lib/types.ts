export type Category = 'login' | 'bank' | 'crypto' | 'wifi' | 'note' | 'other'

export interface Entry {
  id: string
  title: string
  category: Category
  username: string
  password: string
  url: string
  notes: string
  totp: string // base32 secret or otpauth:// URI
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface Settings {
  autoLockMinutes: number
  clipboardClearSeconds: number
}

export interface VaultData {
  entries: Entry[]
  // Tombstones (id -> deletion timestamp) so deletions survive multi-device merges.
  deleted: Record<string, number>
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
}

export function emptyVault(): VaultData {
  return { entries: [], deleted: {}, settings: { ...DEFAULT_SETTINGS } }
}

export function newEntry(category: Category = 'login'): Entry {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: '',
    category,
    username: '',
    password: '',
    url: '',
    notes: '',
    totp: '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }
}
