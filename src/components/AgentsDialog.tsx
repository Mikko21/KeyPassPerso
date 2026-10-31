import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Bot, Check, Copy, Loader2, Pencil, Plus, ScrollText, ShieldOff, X } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { isShareable, MCP_URL } from '../lib/agents'
import type { AgentLogEvent } from '../lib/api'
import { hostOf } from '../lib/categories'
import type { AgentAccess } from '../lib/types'
import { Monogram } from './EntryList'
import { useToast } from './Toast'
import { Button, cx, Field, IconButton, Input, Modal } from './ui'

type View = { kind: 'list' } | { kind: 'edit'; agent?: AgentAccess } | { kind: 'created'; name: string; token: string } | { kind: 'log' }

const EXPIRY: [number | null, string][] = [
  [30, '30 jours'],
  [90, '90 jours'],
  [365, '1 an'],
  [null, 'Jamais'],
]

function fmt(t: number) {
  return new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const toast = useToast()
  return (
    <Field label={label}>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast(`${label} copié`))}
        className={cx(
          'flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left font-mono text-[13px] break-all',
          secret ? 'border-gold-400/30 bg-gold-400/[0.06] text-gold-100' : 'border-white/[0.08] bg-ink-900/80 text-ink-100',
        )}
      >
        {value}
        <Copy className="size-4 shrink-0 text-ink-400" />
      </button>
    </Field>
  )
}

function Editor({ agent, onDone, onCancel }: { agent?: AgentAccess; onDone: (token: string | null, name: string) => void; onCancel: () => void }) {
  const vault = useVault()
  const entries = useMemo(() => (vault.data?.entries ?? []).filter(isShareable).sort((a, b) => a.title.localeCompare(b.title, 'fr')), [vault.data])
  const [name, setName] = useState(agent?.name ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(agent?.entryIds ?? []))
  const [expiry, setExpiry] = useState<number | null>(agent ? null : 90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Donne un nom à cet accès (ex. « Routine padel »).')
    if (!selected.size) return setError('Choisis au moins une entrée.')
    setBusy(true)
    setError(null)
    try {
      const expiresAt = agent ? agent.expiresAt : expiry === null ? null : Date.now() + expiry * 24 * 3600 * 1000
      const token = await vault.saveAgent({ id: agent?.id, name: name.trim(), entryIds: [...selected], expiresAt })
      onDone(token, name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <form onSubmit={submit} className="space-y-5">
      <Button type="button" variant="ghost" onClick={onCancel}>
        <ArrowLeft className="size-4" /> Retour
      </Button>
      <Field label="Nom de l’accès">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Routine padel CK" />
      </Field>
      <Field label={`Entrées utilisables (${selected.size})`}>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.06] p-2">
          {entries.length === 0 && <p className="p-3 text-sm text-ink-400">Aucune entrée avec site web et mot de passe.</p>}
          {entries.map((e) => (
            <button
              type="button"
              key={e.id}
              onClick={() => toggle(e.id)}
              className={cx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', selected.has(e.id) ? 'bg-gold-400/[0.08]' : 'hover:bg-white/[0.03]')}
            >
              <Monogram entry={e} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-100">{e.title}</div>
                <div className="truncate text-xs text-ink-400">{hostOf(e.url)}</div>
              </div>
              <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-md border', selected.has(e.id) ? 'border-gold-400 bg-gold-400 text-ink-950' : 'border-white/20')}>
                {selected.has(e.id) && <Check className="size-3.5" />}
              </span>
            </button>
          ))}
        </div>
      </Field>
      {!agent && (
        <Field label="Expiration">
          <div className="flex flex-wrap gap-2">
            {EXPIRY.map(([v, l]) => (
              <button
                type="button"
                key={l}
                onClick={() => setExpiry(v)}
                className={cx('rounded-full border px-3 py-1.5 text-xs', expiry === v ? 'border-gold-400/40 bg-gold-400/10 text-gold-200' : 'border-white/[0.07] text-ink-300')}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>
      )}
      <p className="text-xs leading-relaxed text-ink-400">
        Seules ces entrées sont rechiffrées pour l’agent. Il pourra se connecter aux sites correspondants (et seulement à ces domaines), sans jamais
        recevoir les mots de passe.
      </p>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <Button type="submit" variant="primary" className="h-12 w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} {agent ? 'Enregistrer' : 'Créer l’accès'}
      </Button>
    </form>
  )
}

function LogView({ onBack }: { onBack: () => void }) {
  const vault = useVault()
  const [events, setEvents] = useState<AgentLogEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { agentLog } = vault
  useEffect(() => {
    agentLog()
      .then(setEvents)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erreur'))
  }, [agentLog])
  const labels: Record<string, string> = { list_logins: 'liste', site_login: 'connexion', site_get: 'page', site_submit: 'formulaire' }
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" /> Retour
      </Button>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!events && !error && <Loader2 className="mx-auto size-5 animate-spin text-ink-400" />}
      {events?.length === 0 && <p className="py-6 text-center text-sm text-ink-400">Aucune utilisation pour l’instant.</p>}
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
        {events?.map((e, i) => (
          <li key={i} className="rounded-xl px-3 py-2 text-sm hover:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ink-100">
                {e.ok ? <Check className="size-3.5 text-emerald-400" /> : <X className="size-3.5 text-rose-400" />}
                {e.agentName} · {labels[e.tool] ?? e.tool}
                {e.entry && <span className="text-gold-200">{e.entry}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-400">{fmt(e.at)}</span>
            </div>
            {(e.url || e.detail) && <div className="mt-0.5 truncate pl-5 text-xs text-ink-400">{e.detail ?? e.url}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AgentsDialog({ onClose }: { onClose: () => void }) {
  const vault = useVault()
  const toast = useToast()
  const [view, setView] = useState<View>({ kind: 'list' })
  const agents = vault.data?.agents ?? []
  const entries = vault.data?.entries ?? []

  async function revoke(a: AgentAccess) {
    try {
      await vault.revokeAgent(a.id)
      toast(`Accès « ${a.name} » révoqué`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title="Accès agents" wide>
      {view.kind === 'list' && (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-ink-300">
            Donne à une routine IA (tâche planifiée Claude…) le droit de se connecter à certains sites avec tes identifiants, sans qu’elle puisse les lire.
            Elle passe par le connecteur MCP de ton coffre.
          </p>
          {agents.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 py-8 text-center">
              <Bot className="mb-3 size-6 text-gold-300" />
              <p className="text-sm text-ink-300">Aucun accès agent.</p>
            </div>
          )}
          <ul className="space-y-2">
            {agents.map((a) => {
              const expired = a.expiresAt !== null && a.expiresAt < Date.now()
              const names = a.entryIds.map((id) => entries.find((e) => e.id === id)?.title).filter(Boolean)
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <Bot className={cx('size-5 shrink-0', expired ? 'text-ink-600' : 'text-gold-300')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-100">{a.name}</div>
                    <div className="truncate text-xs text-ink-400">
                      {names.join(', ') || 'aucune entrée'} · {expired ? 'expiré' : a.expiresAt ? `expire le ${new Date(a.expiresAt).toLocaleDateString('fr-FR')}` : 'sans expiration'}
                    </div>
                  </div>
                  <IconButton label="Modifier" onClick={() => setView({ kind: 'edit', agent: a })}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label="Révoquer" onClick={() => void revoke(a)} className="hover:text-rose-300">
                    <ShieldOff className="size-4" />
                  </IconButton>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setView({ kind: 'edit' })}>
              <Plus className="size-4" /> Nouvel accès
            </Button>
            <Button onClick={() => setView({ kind: 'log' })}>
              <ScrollText className="size-4" /> Journal d’utilisation
            </Button>
          </div>
        </div>
      )}

      {view.kind === 'edit' && (
        <Editor
          agent={view.agent}
          onCancel={() => setView({ kind: 'list' })}
          onDone={(token, name) => {
            if (token) setView({ kind: 'created', name, token })
            else {
              toast('Accès mis à jour')
              setView({ kind: 'list' })
            }
          }}
        />
      )}

      {view.kind === 'created' && (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-ink-300">
            Accès « {view.name} » créé. La clé n’est affichée qu’une fois : ajoute-la maintenant dans claude.ai.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-200">
            <li>claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé</li>
            <li>Nom : « KeyPassPerso », URL du serveur ci-dessous</li>
            <li>Paramètres avancés → En-têtes de requête : nom <code className="text-gold-200">Authorization</code>, valeur ci-dessous</li>
            <li>Active le connecteur dans ta tâche planifiée</li>
          </ol>
          <CopyField label="URL du serveur MCP" value={MCP_URL} />
          <CopyField label="Valeur de l’en-tête Authorization" value={`Bearer ${view.token}`} secret />
          <p className="text-xs leading-relaxed text-ink-400">
            Ne colle jamais cette clé dans une conversation : elle doit rester dans la configuration du connecteur. Tu peux la révoquer à tout moment ici.
          </p>
          <Button variant="primary" className="w-full" onClick={() => setView({ kind: 'list' })}>
            J’ai configuré le connecteur
          </Button>
        </div>
      )}

      {view.kind === 'log' && <LogView onBack={() => setView({ kind: 'list' })} />}
    </Modal>
  )
}
