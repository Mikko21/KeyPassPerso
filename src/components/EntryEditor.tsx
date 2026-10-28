import { useState, type FormEvent } from 'react'
import { Wand2 } from 'lucide-react'
import { CATEGORIES, CATEGORY_ORDER } from '../lib/categories'
import { estimateStrength } from '../lib/generator'
import { parseTotp } from '../lib/totp'
import type { Entry } from '../lib/types'
import { Generator } from './Generator'
import { Button, cx, Field, IconButton, Input, Modal, PasswordInput, StrengthBar, TextArea } from './ui'

export function EntryEditor({
  entry,
  isNew,
  onSave,
  onClose,
}: {
  entry: Entry
  isNew: boolean
  onSave: (e: Entry) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Entry>(entry)
  const [showGen, setShowGen] = useState(isNew && !entry.password)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Entry>) => setDraft((d) => ({ ...d, ...patch }))
  const strength = estimateStrength(draft.password)
  const isNote = draft.category === 'note'

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) return setError('Donne un nom à cette entrée.')
    if (draft.totp.trim()) {
      try {
        parseTotp(draft.totp)
      } catch {
        return setError('Le secret 2FA doit être en base32 ou une URI otpauth://')
      }
    }
    onSave({ ...draft, title: draft.title.trim(), url: draft.url.trim() })
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Nouvelle entrée' : 'Modifier'} wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((c) => {
            const { icon: Icon, label } = CATEGORIES[c]
            return (
              <button
                key={c}
                type="button"
                onClick={() => set({ category: c })}
                className={cx(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                  draft.category === c
                    ? 'border-gold-400/40 bg-gold-400/10 text-gold-200'
                    : 'border-white/[0.07] text-ink-300 hover:text-ink-100',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            )
          })}
        </div>

        <Field label="Nom">
          <Input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Kraken, Boursorama, Wi‑Fi maison…" />
        </Field>

        {!isNote && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={draft.category === 'wifi' ? 'SSID' : 'Identifiant'}>
                <Input value={draft.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" spellCheck={false} />
              </Field>
              <Field label="Site web">
                <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" autoComplete="off" spellCheck={false} />
              </Field>
            </div>

            <Field label="Mot de passe">
              <PasswordInput
                value={draft.password}
                onChange={(e) => set({ password: e.target.value })}
                trailing={
                  <IconButton type="button" label="Générateur" onClick={() => setShowGen((v) => !v)} className={showGen ? 'text-gold-300' : ''}>
                    <Wand2 className="size-4" />
                  </IconButton>
                }
              />
            </Field>
            {draft.password && <StrengthBar score={strength.score} label={strength.label} />}
            {showGen && (
              <Generator
                onUse={(pw) => {
                  set({ password: pw })
                  setShowGen(false)
                }}
              />
            )}

            <Field label="Secret 2FA (TOTP)" hint={<span className="normal-case tracking-normal text-ink-400">optionnel</span>}>
              <Input
                value={draft.totp}
                onChange={(e) => set({ totp: e.target.value })}
                placeholder="JBSWY3DPEHPK3PXP ou otpauth://…"
                className="font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        )}

        <Field label="Notes">
          <TextArea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className={isNote ? 'min-h-56' : ''} />
        </Field>

        {error && <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" className="px-6">
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  )
}
