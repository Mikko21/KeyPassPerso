import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Bot, Download, FileUp, History, KeyRound, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Smartphone, Timer } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { estimateStrength } from '../lib/generator'
import { generateRecoveryCodes, generateTotpSecret } from '../lib/mfa'
import { AgentsDialog } from './AgentsDialog'
import { HistoryDialog } from './HistoryDialog'
import { CodeInput, RecoveryCodes, TotpEnroll } from './mfa'
import { useToast } from './Toast'
import { Button, Field, Modal, PasswordInput, StrengthBar } from './ui'

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border-t hairline py-6 first:border-0 first:pt-0">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gold-200">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Select<T extends number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as T)}
      className="h-10 rounded-xl border border-white/[0.08] bg-ink-900 px-3 text-sm text-ink-100 focus:border-gold-400/50 focus:outline-none"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function ReconfigureTotp({ onClose }: { onClose: () => void }) {
  const vault = useVault()
  const toast = useToast()
  const [secret] = useState(generateTotpSecret)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await vault.reconfigureTotp(secret, code)
      toast('Nouvelle application 2FA enregistrée')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nouvelle 2FA" wide>
      <form onSubmit={submit} className="space-y-5">
        <TotpEnroll secret={secret} />
        <p className="text-xs text-ink-400">L’ancienne entrée dans ton application cessera de fonctionner dès la validation.</p>
        <Field label="Code affiché">
          <CodeInput value={code} onChange={setCode} autoFocus />
        </Field>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <Button type="submit" variant="primary" className="h-12 w-full" disabled={code.length !== 6 || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Valider
        </Button>
      </form>
    </Modal>
  )
}

function RegenerateRecovery({ onClose }: { onClose: () => void }) {
  const vault = useVault()
  const [codes] = useState(() => generateRecoveryCodes())
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setState('busy')
    try {
      await vault.regenerateRecovery(codes)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setState('idle')
    }
  }

  return (
    <Modal open onClose={onClose} title="Codes de secours" wide>
      {state === 'done' ? (
        <RecoveryCodes codes={codes} onDone={onClose} doneLabel="Terminé" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-300">Les anciens codes de secours seront invalidés et remplacés par 10 nouveaux.</p>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <Button variant="primary" className="w-full" disabled={state === 'busy'} onClick={() => void generate()}>
            {state === 'busy' && <Loader2 className="size-4 animate-spin" />} Générer de nouveaux codes
          </Button>
        </div>
      )}
    </Modal>
  )
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vault = useVault()
  const toast = useToast()
  const settings = vault.data!.settings
  const [sub, setSub] = useState<'totp' | 'recovery' | 'history' | 'agents' | null>(null)

  // Pull fresh server state (e.g. recovery codes used on another device) when settings open.
  const { refresh } = vault
  useEffect(() => {
    void refresh()
  }, [refresh])

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState<string | null>(null)

  const [importPw, setImportPw] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importErr, setImportErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    setPwErr(null)
    if (next.length < 12) return setPwErr('12 caractères minimum.')
    if (next !== next2) return setPwErr('Les mots de passe ne correspondent pas.')
    setPwBusy(true)
    try {
      await vault.changePassword(cur, next)
      setCur('')
      setNext('')
      setNext2('')
      toast('Mot de passe maître modifié')
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setPwBusy(false)
    }
  }

  async function importBackup(e: FormEvent) {
    e.preventDefault()
    if (!importFile) return
    setImportBusy(true)
    setImportErr(null)
    try {
      const n = await vault.importBackup(importFile, importPw)
      toast(`${n} entrée${n > 1 ? 's' : ''} fusionnée${n > 1 ? 's' : ''}`)
      setImportFile(null)
      setImportPw('')
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setImportBusy(false)
    }
  }

  async function revoke() {
    try {
      await vault.revokeSessions()
      toast('Tous les autres appareils devront refaire la 2FA')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    }
  }

  const strength = estimateStrength(next)
  const left = vault.recoveryLeft

  return (
    <>
      <Modal open={open && !sub} onClose={onClose} title="Réglages" wide>
        <Section icon={<Timer className="size-4" />} title="Sécurité de session">
          <div className="space-y-3 text-sm text-ink-200">
            <div className="flex items-center justify-between gap-4">
              <span>Verrouillage automatique</span>
              <Select
                value={settings.autoLockMinutes}
                onChange={(v) => vault.updateSettings({ autoLockMinutes: v })}
                options={[
                  [1, '1 minute'],
                  [5, '5 minutes'],
                  [15, '15 minutes'],
                  [30, '30 minutes'],
                  [60, '1 heure'],
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Effacer le presse-papiers</span>
              <Select
                value={settings.clipboardClearSeconds}
                onChange={(v) => vault.updateSettings({ clipboardClearSeconds: v })}
                options={[
                  [15, 'après 15 s'],
                  [30, 'après 30 s'],
                  [60, 'après 1 min'],
                  [0, 'jamais'],
                ]}
              />
            </div>
          </div>
        </Section>

        <Section icon={<ShieldCheck className="size-4" />} title="Double authentification">
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="text-xs text-ink-400">Codes de secours restants</div>
                <div className={`mt-1 font-display text-3xl ${left !== null && left <= 3 ? 'text-rose-300' : 'text-ink-100'}`}>{left ?? '—'}</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="text-xs text-ink-400">Cet appareil</div>
                <div className="mt-1 text-ink-100">{vault.trusted ? 'De confiance (30 jours)' : '2FA à chaque nouvelle session'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setSub('totp')}>
                <Smartphone className="size-4" /> Changer d’application 2FA
              </Button>
              <Button onClick={() => setSub('recovery')}>
                <RefreshCw className="size-4" /> Nouveaux codes de secours
              </Button>
              {vault.trusted && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    vault.forgetDevice()
                    toast('Cet appareil n’est plus de confiance')
                  }}
                >
                  <MonitorSmartphone className="size-4" /> Oublier cet appareil
                </Button>
              )}
              <Button variant="ghost" onClick={() => void revoke()}>
                <LogOut className="size-4" /> Déconnecter tous les appareils
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<KeyRound className="size-4" />} title="Mot de passe maître">
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Actuel">
              <PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nouveau">
                <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirmation">
                <PasswordInput value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            {next && <StrengthBar score={strength.score} label={strength.label} />}
            <p className="text-xs text-ink-400">Les autres appareils devront se reconnecter avec le nouveau mot de passe et la 2FA.</p>
            {pwErr && <p className="text-sm text-rose-300">{pwErr}</p>}
            <Button type="submit" disabled={!cur || !next || pwBusy}>
              {pwBusy && <Loader2 className="size-4 animate-spin" />} Changer le mot de passe
            </Button>
          </form>
        </Section>

        <Section icon={<Bot className="size-4" />} title="Accès agents (IA)">
          <p className="mb-4 text-sm leading-relaxed text-ink-300">
            Laisse une routine IA se connecter à certains sites avec tes identifiants, sans jamais les voir. {vault.data?.agents?.length ? `${vault.data.agents.length} accès actif(s).` : ''}
          </p>
          <Button onClick={() => setSub('agents')}>
            <Bot className="size-4" /> Gérer les accès agents
          </Button>
        </Section>

        <Section icon={<History className="size-4" />} title="Historique">
          <p className="mb-4 text-sm leading-relaxed text-ink-300">Les 30 dernières versions du coffre sont conservées (chiffrées) sur ton serveur.</p>
          <Button onClick={() => setSub('history')}>
            <History className="size-4" /> Parcourir les versions
          </Button>
        </Section>

        <Section icon={<Download className="size-4" />} title="Sauvegarde hors ligne">
          <p className="mb-4 text-sm leading-relaxed text-ink-300">
            Copie chiffrée qui s’ouvre avec le mot de passe maître seul (sans 2FA). Garde-la hors ligne : clé USB, coffre physique.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void vault.exportBackup()}>
              <Download className="size-4" /> Exporter
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> {importFile ? importFile.name : 'Importer et fusionner…'}
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
          </div>
          {importFile && (
            <form onSubmit={importBackup} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field label="Mot de passe de cette sauvegarde">
                  <PasswordInput value={importPw} onChange={(e) => setImportPw(e.target.value)} autoComplete="off" />
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={!importPw || importBusy}>
                {importBusy && <Loader2 className="size-4 animate-spin" />} Fusionner
              </Button>
            </form>
          )}
          {importErr && <p className="mt-2 text-sm text-rose-300">{importErr}</p>}
        </Section>
      </Modal>

      {sub === 'totp' && <ReconfigureTotp onClose={() => setSub(null)} />}
      {sub === 'recovery' && <RegenerateRecovery onClose={() => setSub(null)} />}
      {sub === 'history' && <HistoryDialog onClose={() => setSub(null)} />}
      {sub === 'agents' && <AgentsDialog onClose={() => setSub(null)} />}
    </>
  )
}
