import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api } from '../lib/api'
import { decryptVault, deriveKeys, encryptVault, newKdfParams, type KdfParams, type SessionKeys, type VaultEnvelope } from '../lib/crypto'
import { mergeVaults } from '../lib/merge'
import { hashRecoveryCode } from '../lib/mfa'
import { clearLegacy, downloadBackup, loadLegacyEnvelope, readBackupFile, sessionStore } from '../lib/storage'
import { DEFAULT_SETTINGS, emptyVault, type Entry, type Settings, type VaultData } from '../lib/types'

type Status = 'loading' | 'unreachable' | 'setup' | 'locked' | 'mfa' | 'unlocked'
type SaveStatus = 'saved' | 'saving' | 'error' | 'reauth'

export class LegacyMismatchError extends Error {
  constructor() {
    super('Ce mot de passe n’ouvre pas l’ancien coffre local détecté sur cet appareil.')
  }
}

export class NeedsPasswordError extends Error {
  constructor() {
    super('Cette version a été chiffrée avec un ancien mot de passe maître.')
  }
}

export interface SecondFactor {
  code?: string
  recoveryCode?: string
  trust: boolean
}

export interface SetupInput {
  password: string
  setupToken: string
  totpSecret: string
  code: string
  recoveryCodes: string[]
  ignoreLegacy: boolean
}

interface VaultApi {
  status: Status
  bootError: string | null
  data: VaultData | null
  recoveryLeft: number | null
  trusted: boolean
  hasLegacy: boolean
  save: { status: SaveStatus; error: string | null; lastSavedAt: number | null }
  retryBootstrap(): void
  setup(input: SetupInput): Promise<() => void>
  unlock(password: string): Promise<void>
  verifyMfa(f: SecondFactor): Promise<{ recoveryUsed: boolean; recoveryLeft: number }>
  cancelMfa(): void
  reauth(f: SecondFactor): Promise<void>
  lock(): void
  upsert(entry: Entry): void
  remove(id: string): void
  updateSettings(patch: Partial<Settings>): void
  refresh(): Promise<void>
  changePassword(current: string, next: string): Promise<void>
  reconfigureTotp(secret: string, code: string): Promise<void>
  regenerateRecovery(codes: string[]): Promise<void>
  revokeSessions(): Promise<void>
  forgetDevice(): void
  listHistory(): Promise<{ rev: number; at: number; size: number }[]>
  openVersion(rev: number, oldPassword?: string): Promise<VaultData>
  restore(data: VaultData): void
  exportBackup(): Promise<void>
  importBackup(file: File, password: string): Promise<number>
}

const VaultContext = createContext<VaultApi | null>(null)

function normalize(data: VaultData): VaultData {
  return {
    entries: data.entries ?? [],
    deleted: data.deleted ?? {},
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
  }
}

function message(err: unknown, fallback = 'Erreur inattendue'): string {
  return err instanceof Error ? err.message : fallback
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [bootError, setBootError] = useState<string | null>(null)
  const [data, setData] = useState<VaultData | null>(null)
  const [recoveryLeft, setRecoveryLeft] = useState<number | null>(null)
  const [trusted, setTrusted] = useState(() => sessionStore.isTrusted())
  const [hasLegacy, setHasLegacy] = useState(() => loadLegacyEnvelope() !== null)
  const [saveState, setSaveState] = useState<VaultApi['save']>({ status: 'saved', error: null, lastSavedAt: null })

  // Secrets live only in memory, in refs, so they are never serialized or rendered.
  const kdfRef = useRef<KdfParams | null>(null)
  const keysRef = useRef<SessionKeys | null>(null)
  const pendingKeysRef = useRef<SessionKeys | null>(null)
  const sessionRef = useRef<string | null>(null)
  const dataRef = useRef<VaultData | null>(null)
  const revRef = useRef(0)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)

  const commitData = useCallback((d: VaultData) => {
    dataRef.current = d
    setData(d)
  }, [])

  const bootstrap = useCallback(async () => {
    setStatus('loading')
    setBootError(null)
    try {
      const { kdf } = await api.params()
      kdfRef.current = kdf
      setStatus('locked')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found') setStatus('setup')
      else {
        setBootError(message(err))
        setStatus('unreachable')
      }
    }
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const open = useCallback(
    async (keys: SessionKeys, env: VaultEnvelope, session: string) => {
      const d = await decryptVault(env, keys).catch(() => {
        throw new Error('Coffre illisible avec ce mot de passe')
      })
      keysRef.current = keys
      sessionRef.current = session
      revRef.current = env.rev
      dirtyRef.current = false
      commitData(normalize(d))
      setSaveState({ status: 'saved', error: null, lastSavedAt: env.updatedAt })
      setTrusted(sessionStore.isTrusted())
      setStatus('unlocked')
    },
    [commitData],
  )

  /** Pushes local changes; on version conflict, merges the remote vault and retries. */
  const flush = useCallback(async (): Promise<void> => {
    const keys = keysRef.current
    if (!keys || savingRef.current || !dirtyRef.current) return
    const session = sessionRef.current
    if (!session) {
      setSaveState((s) => ({ ...s, status: 'reauth' }))
      return
    }
    savingRef.current = true
    setSaveState((s) => ({ ...s, status: 'saving', error: null }))
    let succeeded = false
    try {
      for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
        dirtyRef.current = false
        const env = await encryptVault(dataRef.current!, keys, revRef.current + 1)
        try {
          const { rev } = await api.save(keys.authKey, session, { envelope: env, baseRev: revRef.current })
          revRef.current = rev
          succeeded = true
        } catch (err) {
          dirtyRef.current = true
          if (err instanceof ApiError && err.code === 'conflict' && err.remote) {
            const remote = await decryptVault(err.remote, keys).catch(() => {
              throw new Error('Le mot de passe maître a changé sur un autre appareil : verrouille puis déverrouille.')
            })
            commitData(mergeVaults(dataRef.current!, normalize(remote)))
            revRef.current = err.remote.rev
            continue
          }
          if (err instanceof ApiError && (err.code === 'mfa_required' || err.code === 'bad_password')) {
            sessionRef.current = null
            setSaveState((s) => ({ ...s, status: 'reauth', error: null }))
            return
          }
          throw err
        }
      }
      if (!succeeded) throw new Error('Conflit de synchronisation persistant')
      setSaveState({ status: 'saved', error: null, lastSavedAt: Date.now() })
    } catch (err) {
      setSaveState((s) => ({ ...s, status: 'error', error: message(err, 'Échec de l’enregistrement') }))
    } finally {
      savingRef.current = false
      if (succeeded && dirtyRef.current) timerRef.current = window.setTimeout(() => void flush(), 300)
    }
  }, [commitData])

  const scheduleFlush = useCallback(() => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void flush(), 700)
  }, [flush])

  const mutate = useCallback(
    (fn: (d: VaultData) => VaultData) => {
      if (!dataRef.current) return
      commitData(fn(dataRef.current))
      dirtyRef.current = true
      setSaveState((s) => (s.status === 'reauth' ? s : { ...s, status: 'saving' }))
      scheduleFlush()
    },
    [commitData, scheduleFlush],
  )

  const refresh = useCallback(async () => {
    const keys = keysRef.current
    if (!keys) return
    if (dirtyRef.current) return flush()
    try {
      const { envelope, recoveryLeft: left } = await api.fetch(keys.authKey, sessionRef.current ?? undefined)
      setRecoveryLeft(left)
      if (envelope.rev !== revRef.current && !dirtyRef.current) {
        commitData(mergeVaults(dataRef.current ?? emptyVault(), normalize(await decryptVault(envelope, keys))))
        revRef.current = envelope.rev
        setSaveState({ status: 'saved', error: null, lastSavedAt: envelope.updatedAt })
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'mfa_required' || err.code === 'bad_password')) {
        sessionRef.current = null
        setSaveState((s) => ({ ...s, status: 'reauth' }))
      }
    }
  }, [commitData, flush])

  const lock = useCallback(() => {
    const clear = () => {
      window.clearTimeout(timerRef.current)
      keysRef.current = null
      pendingKeysRef.current = null
      sessionRef.current = null
      dataRef.current = null
      dirtyRef.current = false
      setData(null)
      setStatus(kdfRef.current ? 'locked' : 'setup')
    }
    // Try to persist pending edits before wiping keys from memory.
    if (dirtyRef.current && keysRef.current) void flush().finally(clear)
    else clear()
  }, [flush])

  // Pull changes made on other devices when the tab regains focus.
  useEffect(() => {
    if (status !== 'unlocked') return
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) e.preventDefault()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [status, refresh])

  const setup = useCallback(
    async (input: SetupInput) => {
      const kdf = newKdfParams()
      const keys = await deriveKeys(input.password, kdf)
      let initial = emptyVault()
      const legacy = loadLegacyEnvelope()
      if (legacy && !input.ignoreLegacy) {
        try {
          initial = normalize(await decryptVault(legacy, await deriveKeys(input.password, legacy.kdf)))
        } catch {
          throw new LegacyMismatchError()
        }
      }
      const envelope = await encryptVault(initial, keys, 1)
      const recovery = await Promise.all(input.recoveryCodes.map(hashRecoveryCode))
      const { session, rev } = await api.setup(keys.authKey, {
        setupToken: input.setupToken,
        envelope,
        totpSecret: input.totpSecret,
        code: input.code,
        recovery,
      })
      sessionStore.set(session, false)
      clearLegacy()
      setHasLegacy(false)
      kdfRef.current = kdf
      setRecoveryLeft(recovery.length)
      return () => void open(keys, { ...envelope, rev }, session.token)
    },
    [open],
  )

  const unlock = useCallback(
    async (password: string) => {
      const kdf = kdfRef.current
      if (!kdf) throw new Error('Paramètres du coffre indisponibles')
      const keys = await deriveKeys(password, kdf)
      const session = sessionStore.get()
      try {
        const { envelope, recoveryLeft: left } = await api.fetch(keys.authKey, session?.token)
        setRecoveryLeft(left)
        await open(keys, envelope, session!.token)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'mfa_required') {
          pendingKeysRef.current = keys
          setStatus('mfa')
          return
        }
        throw err
      }
    },
    [open],
  )

  const login = useCallback(async (keys: SessionKeys, f: SecondFactor) => {
    const r = await api.login(keys.authKey, { code: f.code, recoveryCode: f.recoveryCode, trust: f.trust })
    sessionStore.set(r.session, f.trust)
    setRecoveryLeft(r.recoveryLeft)
    return r
  }, [])

  const verifyMfa = useCallback(
    async (f: SecondFactor) => {
      const keys = pendingKeysRef.current
      if (!keys) throw new Error('Session expirée, recommence')
      const r = await login(keys, f)
      pendingKeysRef.current = null
      await open(keys, r.envelope, r.session.token)
      return { recoveryUsed: r.recoveryUsed, recoveryLeft: r.recoveryLeft }
    },
    [login, open],
  )

  const reauth = useCallback(
    async (f: SecondFactor) => {
      const keys = keysRef.current
      if (!keys) return
      const r = await login(keys, f).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'bad_password') {
          throw new Error('Le mot de passe maître a été changé sur un autre appareil : ferme cette fenêtre pour verrouiller, puis déverrouille avec le nouveau.')
        }
        throw err
      })
      sessionRef.current = r.session.token
      setTrusted(sessionStore.isTrusted())
      setSaveState((s) => ({ ...s, status: dirtyRef.current ? 'saving' : 'saved' }))
      if (dirtyRef.current) await flush()
      else await refresh()
    },
    [flush, login, refresh],
  )

  const requireSession = () => {
    const keys = keysRef.current
    const session = sessionRef.current
    if (!keys || !session) throw new Error('Session expirée, déverrouille à nouveau')
    return { keys, session }
  }

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const { keys, session } = requireSession()
      const check = await deriveKeys(current, keys.kdf)
      if (check.authKey !== keys.authKey) throw new Error('Mot de passe actuel incorrect')
      await flush()
      if (dirtyRef.current) throw new Error('Enregistrement en attente, réessaie dans un instant')
      const newKeys = await deriveKeys(next, newKdfParams())
      const envelope = await encryptVault(dataRef.current!, newKeys, revRef.current + 1)
      try {
        const r = await api.save(keys.authKey, session, { envelope, baseRev: revRef.current, newAuthKey: newKeys.authKey })
        keysRef.current = newKeys
        kdfRef.current = newKeys.kdf
        revRef.current = r.rev
        if (r.session) {
          sessionRef.current = r.session.token
          sessionStore.update(r.session)
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict') {
          await refresh()
          throw new Error('Le coffre a changé entre-temps, réessaie')
        }
        throw err
      }
    },
    [flush, refresh],
  )

  const value = useMemo<VaultApi>(
    () => ({
      status,
      bootError,
      data,
      recoveryLeft,
      trusted,
      hasLegacy,
      save: saveState,
      retryBootstrap: () => void bootstrap(),
      setup,
      unlock,
      verifyMfa,
      cancelMfa: () => {
        pendingKeysRef.current = null
        setStatus('locked')
      },
      reauth,
      lock,
      upsert: (entry) =>
        mutate((d) => {
          const e = { ...entry, updatedAt: Date.now() }
          const exists = d.entries.some((x) => x.id === e.id)
          return { ...d, entries: exists ? d.entries.map((x) => (x.id === e.id ? e : x)) : [e, ...d.entries] }
        }),
      remove: (id) =>
        mutate((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== id), deleted: { ...d.deleted, [id]: Date.now() } })),
      updateSettings: (patch) => mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
      refresh,
      changePassword,
      reconfigureTotp: async (secret, code) => {
        const { keys, session } = requireSession()
        await api.updateMfa(keys.authKey, session, { totpSecret: secret, code })
      },
      regenerateRecovery: async (codes) => {
        const { keys, session } = requireSession()
        const r = await api.updateMfa(keys.authKey, session, { recovery: await Promise.all(codes.map(hashRecoveryCode)) })
        setRecoveryLeft(r.recoveryLeft)
      },
      revokeSessions: async () => {
        const { keys, session } = requireSession()
        const r = await api.revoke(keys.authKey, session)
        sessionStore.clear()
        sessionStore.set(r.session, false)
        sessionRef.current = r.session.token
        setTrusted(false)
      },
      forgetDevice: () => {
        sessionStore.forgetTrusted()
        setTrusted(false)
      },
      listHistory: async () => {
        const { keys, session } = requireSession()
        return (await api.history(keys.authKey, session)).versions
      },
      openVersion: async (rev, oldPassword) => {
        const { keys, session } = requireSession()
        const { envelope } = await api.version(keys.authKey, session, rev)
        try {
          return normalize(await decryptVault(envelope, keys))
        } catch {
          if (!oldPassword) throw new NeedsPasswordError()
          const oldKeys = await deriveKeys(oldPassword, envelope.kdf)
          return normalize(
            await decryptVault(envelope, oldKeys).catch(() => {
              throw new Error('Ancien mot de passe incorrect')
            }),
          )
        }
      },
      restore: (snapshot) =>
        mutate((d) => {
          // Restored entries must win any later merge; entries absent from the snapshot get tombstoned.
          const now = Date.now()
          const keep = new Set(snapshot.entries.map((e) => e.id))
          const deleted = { ...d.deleted }
          for (const e of d.entries) if (!keep.has(e.id)) deleted[e.id] = now
          for (const id of keep) delete deleted[id]
          return { ...d, entries: snapshot.entries.map((e) => ({ ...e, updatedAt: now })), deleted }
        }),
      exportBackup: async () => {
        const keys = keysRef.current
        if (!keys || !dataRef.current) return
        downloadBackup(await encryptVault(dataRef.current, keys, revRef.current))
      },
      importBackup: async (file, password) => {
        const env = await readBackupFile(file)
        const imported = normalize(
          await decryptVault(env, await deriveKeys(password, env.kdf)).catch(() => {
            throw new Error('Mot de passe incorrect pour cette sauvegarde')
          }),
        )
        mutate((d) => mergeVaults(d, imported))
        return imported.entries.length
      },
    }),
    // requireSession reads refs only, so it is safe to omit.
    [status, bootError, data, recoveryLeft, trusted, hasLegacy, saveState, bootstrap, setup, unlock, verifyMfa, reauth, lock, mutate, refresh, changePassword],
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
