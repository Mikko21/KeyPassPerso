import { useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, CloudAlert, Layers, Lock, Plus, RefreshCw, Search, Settings, Star } from 'lucide-react'
import { useVault } from '../hooks/useVault'
import { CATEGORIES, CATEGORY_ORDER } from '../lib/categories'
import { newEntry, type Category, type Entry } from '../lib/types'
import { EntryDetail } from './EntryDetail'
import { EntryEditor } from './EntryEditor'
import { EntryList } from './EntryList'
import { Backdrop, Logo, SecondFactorForm } from './LockScreen'
import { SettingsDialog } from './SettingsDialog'
import { Button, cx, IconButton, Modal } from './ui'

type Filter = 'all' | 'favorites' | Category

function SaveBadge() {
  const { save, refresh } = useVault()
  const map = {
    saved: [Cloud, 'Enregistré'],
    saving: [RefreshCw, 'Enregistrement…'],
    error: [CloudAlert, 'Échec — réessayer'],
    reauth: [CloudAlert, '2FA requise'],
  } as const
  const [Icon, label] = map[save.status]
  return (
    <button
      onClick={() => void refresh()}
      title={save.error ?? (save.lastSavedAt ? `Dernier enregistrement ${new Date(save.lastSavedAt).toLocaleString('fr-FR')}` : '')}
      className={cx(
        'flex items-center gap-2 text-xs',
        save.status === 'error' || save.status === 'reauth' ? 'text-rose-300' : 'text-ink-300 hover:text-gold-200',
      )}
    >
      <Icon className={cx('size-3.5', save.status === 'saving' && 'animate-spin')} /> {label}
    </button>
  )
}

function ReauthDialog() {
  const vault = useVault()
  return (
    <Modal open onClose={vault.lock} title="Session expirée">
      <p className="mb-5 text-sm leading-relaxed text-ink-300">
        Ta session 2FA a expiré. Saisis un code pour continuer : tes modifications en attente seront enregistrées.
      </p>
      <SecondFactorForm submitLabel="Continuer" onSubmit={vault.reauth} />
    </Modal>
  )
}

export function VaultView() {
  const vault = useVault()
  const entries = vault.data!.entries
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ entry: Entry; isNew: boolean } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length, favorites: 0 }
    for (const e of entries) {
      c[e.category] = (c[e.category] ?? 0) + 1
      if (e.favorite) c.favorites++
    }
    return c
  }, [entries])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => (filter === 'all' ? true : filter === 'favorites' ? e.favorite : e.category === filter))
      .filter((e) => !q || [e.title, e.username, e.url, e.notes].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'fr'))
  }, [entries, filter, query])

  const selected = entries.find((e) => e.id === selectedId) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        vault.lock()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vault])

  const create = () => {
    const cat = filter !== 'all' && filter !== 'favorites' ? filter : 'login'
    setEditing({ entry: newEntry(cat), isNew: true })
  }

  const nav: { id: Filter; label: string; icon: typeof Layers }[] = [
    { id: 'all', label: 'Tout le coffre', icon: Layers },
    { id: 'favorites', label: 'Favoris', icon: Star },
    ...CATEGORY_ORDER.map((c) => ({ id: c as Filter, label: CATEGORIES[c].label, icon: CATEGORIES[c].icon })),
  ]

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <Backdrop />

      {/* Sidebar — desktop */}
      <aside className="relative z-10 hidden w-64 shrink-0 flex-col border-r hairline bg-ink-950/40 p-4 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2 pt-2">
          <Logo className="size-8" />
          <div>
            <div className="font-display text-2xl leading-none text-ink-100">Coffre</div>
            <div className="mt-1 text-[10px] tracking-[0.3em] text-gold-300/70 uppercase">KeyPassPerso</div>
          </div>
        </div>
        <Button variant="primary" className="mb-6 w-full" onClick={create}>
          <Plus className="size-4" /> Nouvelle entrée
        </Button>
        <nav className="space-y-0.5">
          {nav.map(({ id, label, icon: Icon }, i) => (
            <div key={id}>
              {i === 2 && <div className="mx-3 my-3 border-t hairline" />}
              <button
                onClick={() => setFilter(id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                  filter === id ? 'bg-white/[0.06] text-gold-100' : 'text-ink-300 hover:bg-white/[0.03] hover:text-ink-100',
                )}
              >
                <Icon className={cx('size-4', filter === id ? 'text-gold-300' : 'text-ink-400')} />
                <span className="flex-1 text-left">{label}</span>
                <span className="text-xs tabular-nums text-ink-400">{counts[id] ?? 0}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="space-y-3 border-t hairline px-2 pt-4">
          <SaveBadge />
          <div className="flex gap-1">
            <Button variant="ghost" className="flex-1 justify-start px-2" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" /> Réglages
            </Button>
            <IconButton label="Verrouiller (Ctrl+Maj+L)" onClick={vault.lock}>
              <Lock className="size-4" />
            </IconButton>
          </div>
        </div>
      </aside>

      {/* List column */}
      <section
        className={cx(
          'relative z-10 flex w-full flex-col border-r hairline lg:w-[380px] lg:shrink-0',
          selected && 'hidden lg:flex',
        )}
      >
        <header className="space-y-3 p-4 pb-2">
          <div className="flex items-center gap-2 md:hidden">
            <Logo className="size-7" />
            <span className="font-display flex-1 text-2xl">Coffre</span>
            <IconButton label="Réglages" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" />
            </IconButton>
            <IconButton label="Verrouiller" onClick={vault.lock}>
              <Lock className="size-4" />
            </IconButton>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher"
              className="h-11 w-full rounded-xl border border-white/[0.07] bg-white/[0.03] pr-14 pl-10 text-[15px] placeholder:text-ink-400 focus:border-gold-400/40 focus:outline-none"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:block">
              ⌘K
            </kbd>
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:hidden">
            {nav.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={cx(
                  'shrink-0 rounded-full border px-3 py-1 text-xs',
                  filter === id ? 'border-gold-400/40 bg-gold-400/10 text-gold-200' : 'border-white/[0.07] text-ink-300',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pb-24 md:pb-4">
          {visible.length > 0 ? (
            <EntryList entries={visible} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div className="animate-fade-in flex flex-col items-center px-8 pt-20 text-center">
              <div className="mb-5 rounded-2xl border border-gold-400/15 bg-gold-400/[0.05] p-4">
                <Layers className="size-6 text-gold-300" />
              </div>
              <p className="font-display text-2xl text-ink-100">{query ? 'Aucun résultat' : 'Rien ici pour l’instant'}</p>
              <p className="mt-2 text-sm text-ink-400">
                {query ? 'Essaie un autre terme.' : 'Ajoute ta première entrée, elle sera chiffrée instantanément.'}
              </p>
              {!query && (
                <Button variant="primary" className="mt-6" onClick={create}>
                  <Plus className="size-4" /> Nouvelle entrée
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="border-t hairline px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden">
          <SaveBadge />
        </div>
        <button
          onClick={create}
          aria-label="Nouvelle entrée"
          className="fixed right-5 bottom-14 z-20 flex size-14 items-center justify-center rounded-full bg-gradient-to-b from-gold-200 to-gold-400 text-ink-950 shadow-[0_12px_32px_-8px_rgba(207,168,101,0.7)] md:hidden"
        >
          <Plus className="size-6" />
        </button>
      </section>

      {/* Detail column */}
      <main className={cx('relative z-10 min-w-0 flex-1', !selected && 'hidden lg:block')}>
        {selected ? (
          <EntryDetail
            entry={selected}
            onBack={() => setSelectedId(null)}
            onEdit={() => setEditing({ entry: selected, isNew: false })}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Logo className="mb-6 size-16 opacity-40" />
            <p className="font-display text-3xl text-ink-300">
              Sélectionne une <em className="text-gold-gradient">entrée</em>
            </p>
            <p className="mt-2 text-sm text-ink-400">{entries.length} éléments chiffrés dans ton coffre</p>
          </div>
        )}
      </main>

      {editing && (
        <EntryEditor
          entry={editing.entry}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            vault.upsert(e)
            setSelectedId(e.id)
            setEditing(null)
          }}
        />
      )}
      {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} />}
      {vault.save.status === 'reauth' && <ReauthDialog />}
    </div>
  )
}
