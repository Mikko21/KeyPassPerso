import { useId, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, CloudDownload, FileUp, Fingerprint, Loader2, ShieldCheck } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { estimateStrength } from '../lib/generator'
import { Button, Field, PasswordInput, StrengthBar } from './ui'

type Mode = 'unlock' | 'create' | 'cloud' | 'import'

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="animate-drift absolute -top-1/3 left-1/2 h-[80vh] w-[80vh] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(207,168,101,0.18),transparent)] blur-2xl" />
      <div className="animate-drift absolute -right-1/4 bottom-[-30%] h-[70vh] w-[70vh] rounded-full bg-[radial-gradient(closest-side,rgba(120,110,170,0.12),transparent)] blur-2xl [animation-delay:-8s]" />
      <div className="noise absolute inset-0 opacity-[0.035] mix-blend-overlay" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(8,8,10,0.6))]" />
    </div>
  )
}

export function Logo({ className = 'size-10' }: { className?: string }) {
  // Unique gradient id: a shared id breaks when the first instance is display:none.
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8efd9" />
          <stop offset="1" stopColor="#b38a4c" />
        </linearGradient>
      </defs>
      <path d="M32 8l18 6.5v13c0 11.5-7.7 20.6-18 25-10.3-4.4-18-13.5-18-25v-13z" fill="none" stroke={`url(#${id})`} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="32" cy="28" r="5" fill={`url(#${id})`} />
      <path d="M32 33v9" stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function LockScreen() {
  const vault = useVault()
  const [mode, setMode] = useState<Mode>(vault.status === 'locked' ? 'unlock' : 'create')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const strength = estimateStrength(password)
  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setPassword('')
    setConfirm('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'create') {
      if (password.length < 12) return setError('12 caractères minimum — une phrase de passe est idéale.')
      if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    }
    if (mode === 'import' && !file) return setError('Choisis un fichier de sauvegarde.')
    setBusy(true)
    try {
      if (mode === 'create') await vault.create(password)
      else if (mode === 'unlock') await vault.unlock(password)
      else if (mode === 'cloud') await vault.restoreFromCloud(password)
      else if (file) await vault.importBackup(file, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<Mode, [string, string]> = {
    unlock: ['Bon retour.', 'Saisis ton mot de passe maître pour ouvrir le coffre.'],
    create: ['Ton coffre privé.', 'Choisis un mot de passe maître. Il ne quitte jamais cet appareil et ne peut pas être récupéré.'],
    cloud: ['Restaurer.', 'Récupère ton coffre chiffré depuis ta synchronisation Vercel.'],
    import: ['Importer.', 'Ouvre un fichier de sauvegarde chiffré (.kpp.json).'],
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop />
      <div className="animate-rise relative w-full max-w-[420px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="mb-6 size-14 drop-shadow-[0_0_24px_rgba(207,168,101,0.35)]" />
          <p className="mb-3 text-[11px] font-medium tracking-[0.35em] text-gold-300/80 uppercase">KeyPassPerso</p>
          <h1 className="font-display text-5xl leading-none text-ink-100 sm:text-6xl">
            {titles[mode][0].split(' ').slice(0, -1).join(' ')}{' '}
            <em className="text-gold-gradient">{titles[mode][0].split(' ').slice(-1)}</em>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-300">{titles[mode][1]}</p>
        </div>

        <form onSubmit={submit} className="glass space-y-4 rounded-3xl p-6 shadow-2xl shadow-black/50 sm:p-7">
          {mode === 'import' && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" className="w-full" onClick={() => fileRef.current?.click()}>
                <FileUp className="size-4" />
                {file ? file.name : 'Choisir un fichier'}
              </Button>
            </>
          )}

          <Field label="Mot de passe maître">
            <PasswordInput
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            />
          </Field>

          {mode === 'create' && (
            <>
              <StrengthBar score={strength.score} label={strength.label} />
              <Field label="Confirmation">
                <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
              </Field>
            </>
          )}

          {error && (
            <p role="alert" className="animate-fade-in rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className="h-12 w-full text-[15px]" disabled={busy || !password}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Dérivation de la clé…
              </>
            ) : (
              <>
                {mode === 'create' ? 'Créer le coffre' : mode === 'unlock' ? 'Déverrouiller' : 'Ouvrir'}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-1 text-sm">
          {vault.status === 'locked' && mode !== 'unlock' && (
            <Button variant="ghost" onClick={() => switchMode('unlock')}>
              <Fingerprint className="size-4" /> Déverrouiller
            </Button>
          )}
          {vault.status === 'new' && mode !== 'create' && (
            <Button variant="ghost" onClick={() => switchMode('create')}>
              <ShieldCheck className="size-4" /> Nouveau coffre
            </Button>
          )}
          {mode !== 'cloud' && (
            <Button variant="ghost" onClick={() => switchMode('cloud')}>
              <CloudDownload className="size-4" /> Depuis le cloud
            </Button>
          )}
          {mode !== 'import' && (
            <Button variant="ghost" onClick={() => switchMode('import')}>
              <FileUp className="size-4" /> Importer
            </Button>
          )}
        </div>

        {(mode === 'cloud' || mode === 'import') && vault.status === 'locked' && (
          <p className="mt-3 text-center text-xs text-ink-400">Le coffre local actuel sera remplacé.</p>
        )}

        <p className="mt-10 flex items-center justify-center gap-2 text-[11px] tracking-wide text-ink-400">
          <ShieldCheck className="size-3.5 text-gold-400/70" />
          AES-256-GCM · PBKDF2 600 000 itérations · chiffré sur l’appareil
        </p>
      </div>
    </main>
  )
}
