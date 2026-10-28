import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react'
import { NeedsPasswordError, useVault } from '../hooks/useVault'
import type { VaultData } from '../lib/types'
import { useToast } from './Toast'
import { Button, Field, Modal, PasswordInput } from './ui'

interface Version {
  rev: number
  at: number
  size: number
}

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const vault = useVault()
  const toast = useToast()
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ v: Version; data: VaultData } | null>(null)
  const [needsPw, setNeedsPw] = useState<Version | null>(null)
  const [oldPw, setOldPw] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    vault
      .listHistory()
      .then(setVersions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erreur'))
    // Load once when the dialog opens.
  }, [])

  async function open(v: Version, password?: string) {
    setBusy(v.rev)
    setError(null)
    try {
      const data = await vault.openVersion(v.rev, password)
      setSelected({ v, data })
      setNeedsPw(null)
      setOldPw('')
    } catch (err) {
      if (err instanceof NeedsPasswordError) setNeedsPw(v)
      else setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(null)
    }
  }

  const current = new Set(vault.data?.entries.map((e) => e.id))
  const fmt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Modal open onClose={onClose} title="Historique" wide>
      {selected ? (
        <div className="space-y-5">
          <Button variant="ghost" onClick={() => setSelected(null)}>
            <ArrowLeft className="size-4" /> Toutes les versions
          </Button>
          <p className="text-sm text-ink-300">
            Version {selected.v.rev} du {fmt(selected.v.at)} · {selected.data.entries.length} entrées
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.06] p-2">
            {selected.data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
                <span className="truncate text-ink-100">{e.title}</span>
                {!current.has(e.id) && <span className="shrink-0 text-xs text-gold-300">supprimée depuis</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-400">La restauration remplace le contenu actuel. L’état actuel reste lui-même dans l’historique.</p>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              vault.restore(selected.data)
              toast(`Version ${selected.v.rev} restaurée`)
              onClose()
            }}
          >
            <RotateCcw className="size-4" /> Restaurer cette version
          </Button>
        </div>
      ) : needsPw ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void open(needsPw, oldPw)
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink-300">Cette version a été chiffrée avec un ancien mot de passe maître.</p>
          <Field label="Ancien mot de passe maître">
            <PasswordInput autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="off" />
          </Field>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setNeedsPw(null)}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={!oldPw || busy !== null}>
              {busy !== null && <Loader2 className="size-4 animate-spin" />} Ouvrir
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {!versions && !error && <Loader2 className="mx-auto size-5 animate-spin text-ink-400" />}
          {versions?.length === 0 && <p className="py-6 text-center text-sm text-ink-400">Aucune version antérieure pour l’instant.</p>}
          <ul className="space-y-1">
            {versions?.map((v) => (
              <li key={v.rev}>
                <button
                  onClick={() => void open(v)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.04]"
                >
                  <span className="text-ink-100">Version {v.rev}</span>
                  <span className="flex items-center gap-3 text-ink-400">
                    {fmt(v.at)}
                    {busy === v.rev && <Loader2 className="size-3.5 animate-spin" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
