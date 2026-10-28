import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  decryptVault,
  deriveKeys,
  encryptVault,
  newKdfParams,
  type SessionKeys,
} from '../lib/crypto'
import { mergeVaults } from '../lib/merge'
import {
  downloadBackup,
  loadEnvelope,
  loadSyncState,
  readBackupFile,
  saveEnvelope,
  saveSyncState,
  wipeLocal,
  type SyncState,
} from '../lib/storage'
import { fetchRemote, fetchRemoteParams, pushRemote, SyncError } from '../lib/sync'
import { DEFAULT_SETTINGS, emptyVault, type Entry, type Settings, type VaultData } from '../lib/types'

type Status = 'new' | 'locked' | 'unlocked'
type SyncStatus = 'off' | 'idle' | 'syncing' | 'error'

interface VaultApi {
  status: Status
  data: VaultData | null
  sync: SyncState & { status: SyncStatus; error: string | null }
  create(password: string): Promise<void>
  unlock(password: string): Promise<void>
  restoreFromCloud(password: string): Promise<void>
  importBackup(file: File, password: string): Promise<void>
  lock(): void
  upsert(entry: Entry): void
  remove(id: string): void
  updateSettings(patch: Partial<Settings>): void
  enableSync(password: string, setupToken: string): Promise<void>
  disableSync(): void
  syncNow(): Promise<void>
  changePassword(current: string, next: string): Promise<void>
  exportBackup(): void
  wipe(): void
}

const VaultContext = createContext<VaultApi | null>(null)

const WRONG_PASSWORD = 'Mot de passe maître incorrect'

function normalize(data: VaultData): VaultData {
  return {
    entries: data.entries ?? [],
    deleted: data.deleted ?? {},
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (loadEnvelope() ? 'locked' : 'new'))
  const [data, setData] = useState<VaultData | null>(null)
  const [syncState, setSyncState] = useState<SyncState>(loadSyncState)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (loadSyncState().enabled ? 'idle' : 'off'))
  const [syncError, setSyncError] = useState<string | null>(null)

  // Keys live only in memory, in a ref, so they are never serialized or rendered.
  const keysRef = useRef<SessionKeys | null>(null)
  const dataRef = useRef<VaultData | null>(null)
  const syncRef = useRef<SyncState>(syncState)
  const pushTimer = useRef<number | undefined>(undefined)

  const setSync = useCallback((s: SyncState) => {
    syncRef.current = s
    saveSyncState(s)
    setSyncState(s)
  }, [])

  const commitData = useCallback((d: VaultData) => {
    dataRef.current = d
    setData(d)
  }, [])

  const persistLocal = useCallback(async (d: VaultData, keys: SessionKeys) => {
    const env = await encryptVault(d, keys, syncRef.current.remoteRev)
    saveEnvelope(env)
    return env
  }, [])

  /** Push local state; on version conflict, pull + merge + retry once. */
  const push = useCallback(
    async (opts?: { newAuthKey?: string; authKey?: string }) => {
      const keys = keysRef.current
      const d = dataRef.current
      if (!keys || !d || !syncRef.current.enabled) return
      setSyncStatus('syncing')
      setSyncError(null)
      try {
        let current = d
        for (let attempt = 0; attempt < 2; attempt++) {
          const env = await encryptVault(current, keys, syncRef.current.remoteRev + 1)
          try {
            const { rev } = await pushRemote({
              authKey: opts?.authKey ?? keys.authKey,
              envelope: env,
              baseRev: syncRef.current.remoteRev,
              newAuthKey: opts?.newAuthKey,
            })
            setSync({ ...syncRef.current, remoteRev: rev, lastSyncAt: Date.now(), dirty: false })
            saveEnvelope({ ...env, rev })
            setSyncStatus('idle')
            return
          } catch (err) {
            if (!(err instanceof SyncError) || err.status !== 409 || !err.remote) throw err
            const remoteData = await decryptVault(err.remote, keys).catch(() => {
              throw new Error('Le mot de passe maître a changé sur un autre appareil : verrouille puis déverrouille.')
            })
            current = mergeVaults(current, normalize(remoteData))
            commitData(current)
            setSync({ ...syncRef.current, remoteRev: err.remote.rev })
          }
        }
        throw new Error('Conflit de synchronisation persistant')
      } catch (err) {
        setSyncStatus('error')
        setSyncError(err instanceof Error ? err.message : 'Erreur de synchronisation')
      }
    },
    [commitData, setSync],
  )

  /** Pull remote, merge into local, push back if this device has unsynced changes. */
  const pull = useCallback(async () => {
    const keys = keysRef.current
    if (!keys || !syncRef.current.enabled) return
    setSyncStatus('syncing')
    setSyncError(null)
    try {
      const { envelope } = await fetchRemote(keys.authKey)
      if (envelope.rev !== syncRef.current.remoteRev) {
        const remoteData = normalize(await decryptVault(envelope, keys))
        const merged = mergeVaults(dataRef.current ?? emptyVault(), remoteData)
        commitData(merged)
        setSync({ ...syncRef.current, remoteRev: envelope.rev, lastSyncAt: Date.now() })
        await persistLocal(merged, keys)
      } else {
        setSync({ ...syncRef.current, lastSyncAt: Date.now() })
      }
      if (syncRef.current.dirty) await push()
      else setSyncStatus('idle')
    } catch (err) {
      setSyncStatus('error')
      setSyncError(err instanceof Error ? err.message : 'Erreur de synchronisation')
    }
  }, [commitData, persistLocal, push, setSync])

  const schedulePush = useCallback(() => {
    if (!syncRef.current.enabled) return
    window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => void push(), 1200)
  }, [push])

  const mutate = useCallback(
    (fn: (d: VaultData) => VaultData) => {
      const keys = keysRef.current
      const d = dataRef.current
      if (!keys || !d) return
      const next = fn(d)
      commitData(next)
      if (syncRef.current.enabled) setSync({ ...syncRef.current, dirty: true })
      void persistLocal(next, keys)
      schedulePush()
    },
    [commitData, persistLocal, schedulePush, setSync],
  )

  const openSession = useCallback(
    (keys: SessionKeys, d: VaultData) => {
      keysRef.current = keys
      commitData(normalize(d))
      setStatus('unlocked')
    },
    [commitData],
  )

  const lock = useCallback(() => {
    window.clearTimeout(pushTimer.current)
    keysRef.current = null
    dataRef.current = null
    setData(null)
    setStatus(loadEnvelope() ? 'locked' : 'new')
  }, [])

  const create = useCallback(
    async (password: string) => {
      const keys = await deriveKeys(password, newKdfParams())
      const d = emptyVault()
      setSync({ enabled: false, remoteRev: 0, lastSyncAt: null, dirty: false })
      setSyncStatus('off')
      await persistLocal(d, keys)
      openSession(keys, d)
    },
    [openSession, persistLocal, setSync],
  )

  const unlock = useCallback(
    async (password: string) => {
      const env = loadEnvelope()
      if (!env) throw new Error('Aucun coffre local')
      const keys = await deriveKeys(password, env.kdf)
      const d = await decryptVault(env, keys).catch(() => {
        throw new Error(WRONG_PASSWORD)
      })
      openSession(keys, d)
      if (syncRef.current.enabled) void pull()
    },
    [openSession, pull],
  )

  const restoreFromCloud = useCallback(
    async (password: string) => {
      const { kdf } = await fetchRemoteParams()
      const keys = await deriveKeys(password, kdf)
      const { envelope } = await fetchRemote(keys.authKey)
      const d = await decryptVault(envelope, keys).catch(() => {
        throw new Error(WRONG_PASSWORD)
      })
      saveEnvelope(envelope)
      setSync({ enabled: true, remoteRev: envelope.rev, lastSyncAt: Date.now(), dirty: false })
      setSyncStatus('idle')
      openSession(keys, d)
    },
    [openSession, setSync],
  )

  const importBackup = useCallback(
    async (file: File, password: string) => {
      const env = await readBackupFile(file)
      const keys = await deriveKeys(password, env.kdf)
      const d = await decryptVault(env, keys).catch(() => {
        throw new Error(WRONG_PASSWORD)
      })
      saveEnvelope(env)
      setSync({ enabled: false, remoteRev: 0, lastSyncAt: null, dirty: false })
      setSyncStatus('off')
      openSession(keys, d)
    },
    [openSession, setSync],
  )

  const enableSync = useCallback(
    async (password: string, setupToken: string) => {
      const keys = keysRef.current
      if (!keys) return
      const check = await deriveKeys(password, keys.kdf)
      if (check.authKey !== keys.authKey) throw new Error(WRONG_PASSWORD)

      let remote: { kdf: SessionKeys['kdf']; rev: number } | null = null
      try {
        remote = await fetchRemoteParams()
      } catch (err) {
        if (!(err instanceof SyncError) || err.status !== 404) throw err
      }

      if (!remote) {
        // No remote vault yet: create it with this device's keys.
        const env = await encryptVault(dataRef.current ?? emptyVault(), keys, 1)
        const { rev } = await pushRemote({ authKey: keys.authKey, envelope: env, baseRev: 0, setupToken })
        saveEnvelope({ ...env, rev })
        setSync({ enabled: true, remoteRev: rev, lastSyncAt: Date.now(), dirty: false })
        setSyncStatus('idle')
        return
      }

      // A remote vault exists: adopt its salt (same master password expected), merge, push.
      const remoteKeys = await deriveKeys(password, remote.kdf)
      const { envelope } = await fetchRemote(remoteKeys.authKey)
      const remoteData = normalize(await decryptVault(envelope, remoteKeys))
      keysRef.current = remoteKeys
      const merged = mergeVaults(dataRef.current ?? emptyVault(), remoteData)
      commitData(merged)
      setSync({ enabled: true, remoteRev: envelope.rev, lastSyncAt: Date.now(), dirty: true })
      await persistLocal(merged, remoteKeys)
      await push()
    },
    [commitData, persistLocal, push, setSync],
  )

  const disableSync = useCallback(() => {
    setSync({ enabled: false, remoteRev: 0, lastSyncAt: null, dirty: false })
    setSyncStatus('off')
    setSyncError(null)
  }, [setSync])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const keys = keysRef.current
      const d = dataRef.current
      if (!keys || !d) return
      const check = await deriveKeys(current, keys.kdf)
      if (check.authKey !== keys.authKey) throw new Error('Mot de passe actuel incorrect')
      const newKeys = await deriveKeys(next, newKdfParams())
      if (syncRef.current.enabled) {
        await pull()
        setSync({ ...syncRef.current, dirty: true })
        // Re-encrypt under new keys, authenticate with the old authKey, rotate the server hash.
        keysRef.current = newKeys
        await push({ authKey: keys.authKey, newAuthKey: newKeys.authKey })
        if (syncRef.current.dirty) {
          keysRef.current = keys
          throw new Error('Impossible de mettre à jour le coffre distant, mot de passe inchangé')
        }
      }
      keysRef.current = newKeys
      await persistLocal(d, newKeys)
    },
    [persistLocal, pull, push, setSync],
  )

  const value = useMemo<VaultApi>(
    () => ({
      status,
      data,
      sync: { ...syncState, status: syncStatus, error: syncError },
      create,
      unlock,
      restoreFromCloud,
      importBackup,
      lock,
      upsert: (entry) =>
        mutate((d) => {
          const e = { ...entry, updatedAt: Date.now() }
          const exists = d.entries.some((x) => x.id === e.id)
          return { ...d, entries: exists ? d.entries.map((x) => (x.id === e.id ? e : x)) : [e, ...d.entries] }
        }),
      remove: (id) =>
        mutate((d) => ({
          ...d,
          entries: d.entries.filter((x) => x.id !== id),
          deleted: { ...d.deleted, [id]: Date.now() },
        })),
      updateSettings: (patch) => mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
      enableSync,
      disableSync,
      syncNow: pull,
      changePassword,
      exportBackup: () => {
        const env = loadEnvelope()
        if (env) downloadBackup(env)
      },
      wipe: () => {
        wipeLocal()
        keysRef.current = null
        dataRef.current = null
        setData(null)
        setSync({ enabled: false, remoteRev: 0, lastSyncAt: null, dirty: false })
        setSyncStatus('off')
        setStatus('new')
      },
    }),
    [status, data, syncState, syncStatus, syncError, create, unlock, restoreFromCloud, importBackup, lock, mutate, enableSync, disableSync, pull, changePassword, setSync],
  )

  useAutoLock(status === 'unlocked', (data?.settings.autoLockMinutes ?? 5) * 60_000, lock)

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

/** Locks after inactivity; activity = pointer, key, scroll, focus. */
function useAutoLock(active: boolean, ms: number, lock: () => void) {
  useEffect(() => {
    if (!active || ms <= 0) return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const id = window.setInterval(() => {
      if (Date.now() - last >= ms) lock()
    }, 5_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      window.clearInterval(id)
    }
  }, [active, ms, lock])
}

export function useVault(): VaultApi {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used inside VaultProvider')
  return ctx
}
