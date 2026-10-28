import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, ExternalLink, Eye, EyeOff, Pencil, Star, Trash2 } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { CATEGORIES, hostOf, safeHref } from '../lib/categories'
import { copySecret } from '../lib/clipboard'
import { estimateStrength } from '../lib/generator'
import { generateTotp } from '../lib/totp'
import type { Entry } from '../lib/types'
import { Monogram } from './EntryList'
import { useToast } from './Toast'
import { Button, cx, IconButton, Modal, StrengthBar } from './ui'

function useCopy() {
  const { data } = useVault()
  const toast = useToast()
  const seconds = data?.settings.clipboardClearSeconds ?? 30
  return async (value: string, what: string) => {
    try {
      await copySecret(value, seconds)
      toast(seconds > 0 ? `${what} copié · effacé dans ${seconds} s` : `${what} copié`)
    } catch {
      toast('Copie impossible', 'error')
    }
  }
}

function Row({ label, children, actions }: { label: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="group flex items-center gap-3 border-b hairline px-1 py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-medium tracking-[0.12em] text-ink-400 uppercase">{label}</div>
        <div className="min-w-0 text-[15px] break-words text-ink-100">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  )
}

function Totp({ secret }: { secret: string }) {
  const copy = useCopy()
  const [state, setState] = useState<{ code: string; remaining: number; period: number } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = () =>
      generateTotp(secret)
        .then((s) => alive && (setState(s), setFailed(false)))
        .catch(() => alive && setFailed(true))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [secret])

  if (failed) return <Row label="Code 2FA">Secret invalide</Row>
  if (!state) return null
  const pct = state.remaining / state.period
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <Row
      label="Code 2FA"
      actions={
        <IconButton label="Copier le code" onClick={() => copy(state.code, 'Code')}>
          <Copy className="size-4" />
        </IconButton>
      }
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-2xl tracking-[0.25em] text-gold-200">
          {state.code.slice(0, 3)} {state.code.slice(3)}
        </span>
        <svg viewBox="0 0 24 24" className="size-6 -rotate-90">
          <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke={state.remaining <= 5 ? '#fb7185' : '#e3c788'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <span className="text-xs text-ink-400">{state.remaining}s</span>
      </div>
    </Row>
  )
}

export function EntryDetail({ entry, onEdit, onBack }: { entry: Entry; onEdit: () => void; onBack: () => void }) {
  const { upsert, remove } = useVault()
  const copy = useCopy()
  const toast = useToast()
  const [reveal, setReveal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cat = CATEGORIES[entry.category]
  const href = safeHref(entry.url)
  const strength = estimateStrength(entry.password)

  useEffect(() => setReveal(false), [entry.id])

  return (
    <article key={entry.id} className="animate-fade-in flex h-full flex-col">
      <header className="flex items-center gap-2 px-5 pt-5 sm:px-8 sm:pt-8">
        <IconButton label="Retour" onClick={onBack} className="lg:hidden">
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="flex-1" />
        <IconButton
          label={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={() => upsert({ ...entry, favorite: !entry.favorite })}
        >
          <Star className={cx('size-4', entry.favorite && 'fill-gold-300 text-gold-300')} />
        </IconButton>
        <IconButton label="Supprimer" onClick={() => setConfirmDelete(true)} className="hover:text-rose-300">
          <Trash2 className="size-4" />
        </IconButton>
        <Button onClick={onEdit} className="ml-1">
          <Pencil className="size-3.5" /> Modifier
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 sm:px-8">
        <div className="mt-6 mb-8 flex items-center gap-5">
          <Monogram entry={entry} size="lg" />
          <div className="min-w-0">
            <h2 className="font-display truncate text-4xl leading-tight text-ink-100">{entry.title}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-400">
              <cat.icon className="size-3.5" /> {cat.label}
              {entry.url && <span className="text-ink-600">·</span>}
              {entry.url && hostOf(entry.url)}
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl px-4">
          {entry.username && (
            <Row
              label={entry.category === 'wifi' ? 'SSID' : 'Identifiant'}
              actions={
                <IconButton label="Copier l’identifiant" onClick={() => copy(entry.username, 'Identifiant')}>
                  <Copy className="size-4" />
                </IconButton>
              }
            >
              <span className="font-mono text-[14px]">{entry.username}</span>
            </Row>
          )}
          {entry.password && (
            <Row
              label="Mot de passe"
              actions={
                <>
                  <IconButton label={reveal ? 'Masquer' : 'Afficher'} onClick={() => setReveal((v) => !v)}>
                    {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </IconButton>
                  <IconButton label="Copier le mot de passe" onClick={() => copy(entry.password, 'Mot de passe')}>
                    <Copy className="size-4" />
                  </IconButton>
                </>
              }
            >
              <span className={cx('font-mono text-[14px] tracking-wider', !reveal && 'text-ink-300')}>
                {reveal ? entry.password : '•'.repeat(Math.min(entry.password.length, 18))}
              </span>
              <div className="mt-2.5 max-w-xs">
                <StrengthBar score={strength.score} label={strength.label} />
              </div>
            </Row>
          )}
          {entry.totp && <Totp secret={entry.totp} />}
          {entry.url && (
            <Row
              label="Site web"
              actions={
                href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Ouvrir le site"
                    className="inline-flex size-9 items-center justify-center rounded-lg text-ink-300 hover:bg-white/[0.06] hover:text-gold-200"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )
              }
            >
              <span className="text-ink-200">{entry.url}</span>
            </Row>
          )}
          {entry.notes && (
            <Row
              label="Notes"
              actions={
                <IconButton label="Copier les notes" onClick={() => copy(entry.notes, 'Notes')}>
                  <Copy className="size-4" />
                </IconButton>
              }
            >
              <p className="whitespace-pre-wrap text-ink-200 leading-relaxed">{entry.notes}</p>
            </Row>
          )}
          {!entry.username && !entry.password && !entry.url && !entry.notes && !entry.totp && (
            <p className="py-8 text-center text-sm text-ink-400">Entrée vide.</p>
          )}
        </div>

        <p className="mt-6 text-xs text-ink-400">
          Créée le {new Date(entry.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })} · modifiée le{' '}
          {new Date(entry.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Supprimer ?">
        <p className="mb-6 text-sm leading-relaxed text-ink-300">
          « {entry.title} » sera supprimée définitivement de ce coffre et de tes appareils synchronisés.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              remove(entry.id)
              setConfirmDelete(false)
              toast('Entrée supprimée')
              onBack()
            }}
          >
            Supprimer
          </Button>
        </div>
      </Modal>
    </article>
  )
}
