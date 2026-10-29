import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, KeyRound, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react'
import { LegacyMismatchError, useVault } from '../hooks/useVault'
import { ApiError } from '../lib/api'
import { estimateStrength } from '../lib/generator'
import { generateRecoveryCodes, generateTotpSecret } from '../lib/mfa'
import { CodeInput, RecoveryCodes, TotpEnroll } from './mfa'
import { useToast } from './Toast'
import { Button, cx, Field, Input, PasswordInput, StrengthBar } from './ui'

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
        {/* userSpaceOnUse: an objectBoundingBox gradient is invisible on the zero-width keyhole stem */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="14" y1="8" x2="50" y2="53">
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

function Shell({ title, accent, subtitle, children, wide }: { title: string; accent: string; subtitle: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop />
      <div className={cx('animate-rise relative w-full', wide ? 'max-w-[560px]' : 'max-w-[420px]')}>
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="mb-6 size-14 drop-shadow-[0_0_24px_rgba(207,168,101,0.35)]" />
          <p className="mb-3 text-[11px] font-medium tracking-[0.35em] text-gold-300/80 uppercase">KeyPassPerso</p>
          <h1 className="font-display text-5xl leading-none text-ink-100 sm:text-6xl">
            {title} <em className="text-gold-gradient">{accent}</em>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-300">{subtitle}</p>
        </div>
        <div className="glass rounded-3xl p-6 shadow-2xl shadow-black/50 sm:p-7">{children}</div>
        <p className="mt-10 flex items-center justify-center gap-2 text-center text-[11px] tracking-wide text-ink-400">
          <ShieldCheck className="size-3.5 shrink-0 text-gold-400/70" />
          AES-256-GCM · PBKDF2 600 000 itérations · 2FA TOTP · chiffré sur l’appareil
        </p>
      </div>
    </main>
  )
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="animate-fade-in rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
      {children}
    </p>
  )
}

function Stepper({ step }: { step: number }) {
  const labels = ['Mot de passe', '2FA', 'Codes de secours']
  return (
    <div className="mb-6 flex items-center gap-2">
      {labels.map((l, i) => (
        <div key={l} className="flex flex-1 items-center gap-2">
          <span
            className={cx(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
              i < step ? 'bg-gold-400 text-ink-950' : i === step ? 'border border-gold-400 text-gold-200' : 'border border-white/10 text-ink-400',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cx('hidden text-xs sm:inline', i === step ? 'text-ink-100' : 'text-ink-400')}>{l}</span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-white/10" />}
        </div>
      ))}
    </div>
  )
}

function SetupWizard() {
  const vault = useVault()
  const [step, setStep] = useState(0)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [code, setCode] = useState('')
  const [secret] = useState(generateTotpSecret)
  const [codes] = useState(() => generateRecoveryCodes())
  const [legacyMismatch, setLegacyMismatch] = useState(false)
  const [enter, setEnter] = useState<(() => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strength = estimateStrength(password)

  function next(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 12) return setError('12 caractères minimum — une phrase de passe est idéale.')
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    if (!setupToken.trim()) return setError('Renseigne le jeton d’initialisation (KPP_SETUP_TOKEN).')
    setStep(1)
  }

  async function create(ignoreLegacy = false) {
    setError(null)
    setBusy(true)
    try {
      const go = await vault.setup({ password, setupToken: setupToken.trim(), totpSecret: secret, code, recoveryCodes: codes, ignoreLegacy })
      setEnter(() => go)
      setStep(2)
    } catch (err) {
      if (err instanceof LegacyMismatchError) {
        setLegacyMismatch(true)
        setError(err.message)
      } else if (err instanceof ApiError && err.code === 'invalid' && /jeton/i.test(err.message)) {
        setStep(0)
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Erreur inattendue')
        setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  const subtitles = [
    'Choisis un mot de passe maître. Il ne quitte jamais ton appareil et ne peut pas être récupéré.',
    'Deuxième facteur : un code à 6 chiffres sera demandé à chaque nouvelle session.',
    'Dernière étape : tes codes de secours.',
  ]

  return (
    <Shell title={step === 2 ? 'Presque' : 'Ton coffre'} accent={step === 2 ? 'prêt.' : 'privé.'} subtitle={subtitles[step]} wide={step > 0}>
      <Stepper step={step} />
      {step === 0 && (
        <form onSubmit={next} className="space-y-4">
          {vault.hasLegacy && (
            <p className="rounded-xl border border-gold-400/20 bg-gold-400/[0.06] px-3.5 py-2.5 text-sm text-gold-100">
              Un coffre local existant a été détecté sur cet appareil : il sera importé si tu utilises le même mot de passe maître.
            </p>
          )}
          <Field label="Mot de passe maître">
            <PasswordInput autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
          </Field>
          <StrengthBar score={strength.score} label={strength.label} />
          <Field label="Confirmation">
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
          </Field>
          <Field label="Jeton d’initialisation" hint={<span className="font-mono normal-case tracking-normal text-ink-400">KPP_SETUP_TOKEN</span>}>
            <Input value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-sm" />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="h-12 w-full text-[15px]" disabled={!password || !confirm}>
            Continuer <ArrowRight className="size-4" />
          </Button>
        </form>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="space-y-5"
        >
          <TotpEnroll secret={secret} />
          <Field label="Code affiché dans l’application">
            <CodeInput value={code} onChange={setCode} autoFocus />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          {legacyMismatch && (
            <Button type="button" variant="danger" className="w-full" onClick={() => void create(true)}>
              Ignorer l’ancien coffre local et créer un coffre vide
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="size-4" /> Retour
            </Button>
            <Button type="submit" variant="primary" className="h-12 flex-1 text-[15px]" disabled={code.length !== 6 || busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Création…
                </>
              ) : (
                <>
                  Créer le coffre <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {step === 2 && enter && <RecoveryCodes codes={codes} onDone={enter} doneLabel="Ouvrir mon coffre" />}
    </Shell>
  )
}

function UnlockForm() {
  const vault = useVault()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await vault.unlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Bon" accent="retour." subtitle="Saisis ton mot de passe maître pour ouvrir le coffre.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Mot de passe maître">
          <PasswordInput autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" className="h-12 w-full text-[15px]" disabled={busy || !password}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Dérivation de la clé…
            </>
          ) : (
            <>
              Déverrouiller <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>
    </Shell>
  )
}

/** Second-factor form, shared by the lock screen and the in-session re-authentication dialog. */
export function SecondFactorForm({
  onSubmit,
  onCancel,
  submitLabel = 'Vérifier',
}: {
  onSubmit: (f: { code?: string; recoveryCode?: string; trust: boolean }) => Promise<void>
  onCancel?: () => void
  submitLabel?: string
}) {
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const [trust, setTrust] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = useRecovery ? recovery.replace(/[^a-z0-9]/gi, '').length >= 12 : code.length === 6

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSubmit(useRecovery ? { recoveryCode: recovery, trust } : { code, trust })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {useRecovery ? (
        <Field label="Code de secours">
          <Input
            autoFocus
            value={recovery}
            onChange={(e) => setRecovery(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="h-14 text-center font-mono text-xl tracking-widest"
          />
        </Field>
      ) : (
        <Field label="Code de ton application 2FA">
          <CodeInput value={code} onChange={setCode} autoFocus />
        </Field>
      )}
      <button type="button" onClick={() => setTrust((v) => !v)} className="flex items-center gap-3 text-left text-sm text-ink-300">
        <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-md border', trust ? 'border-gold-400 bg-gold-400 text-ink-950' : 'border-white/20')}>
          {trust && <Check className="size-3.5" />}
        </span>
        Faire confiance à cet appareil pendant 30 jours
      </button>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" variant="primary" className="h-12 w-full text-[15px]" disabled={!ready || busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : submitLabel}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            <ArrowLeft className="size-4" /> Retour
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setUseRecovery((v) => !v)
            setError(null)
          }}
        >
          {useRecovery ? <Smartphone className="size-4" /> : <KeyRound className="size-4" />}
          {useRecovery ? 'Utiliser l’application' : 'Utiliser un code de secours'}
        </Button>
      </div>
    </form>
  )
}

function MfaForm() {
  const vault = useVault()
  const toast = useToast()
  return (
    <Shell title="Double" accent="vérification." subtitle="Ouvre ton application d’authentification et saisis le code KeyPassPerso.">
      <SecondFactorForm
        submitLabel="Ouvrir le coffre"
        onCancel={vault.cancelMfa}
        onSubmit={async (f) => {
          const r = await vault.verifyMfa(f)
          if (r.recoveryUsed) {
            toast(`Code de secours utilisé · ${r.recoveryLeft} restant${r.recoveryLeft > 1 ? 's' : ''}`, r.recoveryLeft <= 3 ? 'error' : 'ok')
          }
        }}
      />
    </Shell>
  )
}

export function LockScreen() {
  const vault = useVault()
  switch (vault.status) {
    case 'setup':
      return <SetupWizard />
    case 'locked':
      return <UnlockForm />
    case 'mfa':
      return <MfaForm />
    case 'unreachable':
      return (
        <Shell title="Hors" accent="ligne." subtitle="Le coffre est stocké sur ton serveur Vercel et nécessite une connexion.">
          <div className="space-y-4">
            {vault.bootError && <ErrorNote>{vault.bootError}</ErrorNote>}
            <Button variant="primary" className="h-12 w-full" onClick={vault.retryBootstrap}>
              <RefreshCw className="size-4" /> Réessayer
            </Button>
          </div>
        </Shell>
      )
    default:
      return (
        <main className="relative flex min-h-dvh items-center justify-center">
          <Backdrop />
          <Logo className="size-14 animate-pulse" />
        </main>
      )
  }
}
