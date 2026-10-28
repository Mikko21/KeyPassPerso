import { Star } from 'lucide-react'
import { CATEGORIES, hostOf } from '../lib/categories'
import type { Entry } from '../lib/types'
import { cx } from './ui'

// Deterministic hue per title so monograms are stable but varied.
function hueOf(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function Monogram({ entry, size = 'md' }: { entry: Entry; size?: 'md' | 'lg' }) {
  const Icon = CATEGORIES[entry.category].icon
  const letter = entry.title.trim()[0]?.toUpperCase()
  const hue = hueOf(entry.title || entry.id)
  return (
    <div
      className={cx(
        'relative flex shrink-0 items-center justify-center overflow-hidden border border-white/[0.08] font-display text-ink-100',
        size === 'lg' ? 'size-16 rounded-2xl text-3xl' : 'size-10 rounded-xl text-lg',
      )}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 30% 22%), hsl(${(hue + 40) % 360} 25% 12%))`,
      }}
    >
      {letter ?? <Icon className="size-4" />}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_60%)]" />
    </div>
  )
}

export function EntryList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: Entry[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-1 p-2">
      {entries.map((e, i) => {
        const sub = e.username || hostOf(e.url) || CATEGORIES[e.category].label
        const active = e.id === selectedId
        return (
          <li key={e.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
            <button
              onClick={() => onSelect(e.id)}
              className={cx(
                'group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200',
                active
                  ? 'bg-gradient-to-r from-gold-400/[0.12] to-gold-400/[0.03] ring-1 ring-gold-400/25'
                  : 'hover:bg-white/[0.04]',
              )}
            >
              <Monogram entry={e} />
              <div className="min-w-0 flex-1">
                <div className={cx('truncate text-[15px]', active ? 'text-gold-100' : 'text-ink-100')}>{e.title}</div>
                <div className="truncate text-[13px] text-ink-400">{sub}</div>
              </div>
              {e.favorite && <Star className="size-3.5 shrink-0 fill-gold-300/80 text-gold-300/80" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
