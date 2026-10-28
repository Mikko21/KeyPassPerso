import { useState, type FormEvent, type ReactNode } from 'react'
import { Cloud, CloudOff, Download, KeyRound, Loader2, RefreshCw, Timer, Trash2 } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { estimateStrength } from '../lib/generator'
import { useToast } from './Toast'
import { Button, Field, Input, Modal, PasswordInput, StrengthBar } from './ui'

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

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vault = useVault()
  const toast = useToast()
  const settings = vault.data!.settings

  const [syncPw, setSyncPw] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncErr, setSyncErr] = useState<string | null>(null)

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState<string | null>(null)

  const [confirmWipe, setConfirmWipe] = useState('')

  async function enableSync(e: FormEvent) {
    e.preventDefault()
    setSyncBusy(true)
    setSyncErr(null)
    try {
      await vault.enableSync(syncPw, setupToken.trim())
      setSyncPw('')
      setSetupToken('')
      toast('Synchronisation activée')
    } catch (err) {
      setSyncErr(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSyncBusy(false)
    }
  }

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

  const s = vault.sync
  const strength = estimateStrength(next)

  return (
    <Modal open={open} onClose={onClose} title="Réglages" wide>
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

      <Section icon={<Cloud className="size-4" />} title="Synchronisation chiffrée">
        {s.enabled ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-ink-300">
              Ton coffre chiffré est synchronisé avec ton déploiement Vercel. Le serveur ne voit jamais ton mot de passe ni tes données en clair.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-ink-400">
                {s.status === 'error'
                  ? `Erreur : ${s.error}`
                  : s.lastSyncAt
                    ? `Dernière synchro ${new Date(s.lastSyncAt).toLocaleTimeString('fr-FR', { timeStyle: 'short' })} · révision ${s.remoteRev}`
                    : 'Jamais synchronisé'}
              </span>
              <div className="flex-1" />
              <Button onClick={() => void vault.syncNow()} disabled={s.status === 'syncing'}>
                <RefreshCw className={`size-4 ${s.status === 'syncing' ? 'animate-spin' : ''}`} /> Synchroniser
              </Button>
              <Button variant="ghost" onClick={vault.disableSync}>
                <CloudOff className="size-4" /> Désactiver
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={enableSync} className="space-y-4">
            <p className="text-sm leading-relaxed text-ink-300">
              Synchronise ton coffre entre appareils via ton propre déploiement. Pour le premier appareil, renseigne le jeton{' '}
              <code className="rounded bg-white/5 px-1 font-mono text-gold-200">KPP_SETUP_TOKEN</code> défini dans Vercel.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mot de passe maître">
                <PasswordInput value={syncPw} onChange={(e) => setSyncPw(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="Jeton d’initialisation">
                <Input value={setupToken} onChange={(e) => setSetupToken(e.target.value)} placeholder="si premier appareil" autoComplete="off" className="font-mono text-sm" />
              </Field>
            </div>
            {syncErr && <p className="text-sm text-rose-300">{syncErr}</p>}
            <Button type="submit" variant="primary" disabled={!syncPw || syncBusy}>
              {syncBusy ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />} Activer
            </Button>
          </form>
        )}
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
          {pwErr && <p className="text-sm text-rose-300">{pwErr}</p>}
          <Button type="submit" disabled={!cur || !next || pwBusy}>
            {pwBusy && <Loader2 className="size-4 animate-spin" />} Changer le mot de passe
          </Button>
        </form>
      </Section>

      <Section icon={<Download className="size-4" />} title="Sauvegarde">
        <p className="mb-4 text-sm leading-relaxed text-ink-300">
          Exporte une copie chiffrée de ton coffre. Elle s’ouvre avec le mot de passe maître actuel. Garde-la hors ligne (clé USB, coffre physique).
        </p>
        <Button onClick={vault.exportBackup}>
          <Download className="size-4" /> Exporter la sauvegarde chiffrée
        </Button>
      </Section>

      <Section icon={<Trash2 className="size-4 text-rose-300" />} title="Zone sensible">
        <p className="mb-4 text-sm leading-relaxed text-ink-300">
          Efface le coffre de ce navigateur. Le coffre distant (si synchronisé) n’est pas supprimé. Tape <strong className="text-ink-100">EFFACER</strong> pour confirmer.
        </p>
        <div className="flex gap-2">
          <Input value={confirmWipe} onChange={(e) => setConfirmWipe(e.target.value)} placeholder="EFFACER" className="max-w-40" />
          <Button variant="danger" disabled={confirmWipe !== 'EFFACER'} onClick={vault.wipe}>
            Effacer ce coffre local
          </Button>
        </div>
      </Section>
    </Modal>
  )
}
