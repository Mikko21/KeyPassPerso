import { useMemo, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { encode } from 'uqr'
import { downloadRecoveryCodes, otpauthUri } from '../lib/mfa'
import { useToast } from './Toast'
import { Button, cx } from './ui'

export function QrCode({ value, className }: { value: string; className?: string }) {
  const path = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)))
    return { d, size: data.length }
  }, [value])
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={path.size} height={path.size} fill="#f8efd9" />
      <path d={path.d} fill="#0b0b0d" />
    </svg>
  )
}

export function CodeInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      aria-label="Code à 6 chiffres"
      className="h-14 w-full rounded-xl border border-white/[0.08] bg-ink-900/80 text-center font-mono text-3xl tracking-[0.5em] text-gold-100 placeholder:text-ink-600 focus:border-gold-400/50 focus:outline-none focus:ring-4 focus:ring-gold-400/10"
    />
  )
}

export function TotpEnroll({ secret }: { secret: string }) {
  const toast = useToast()
  const grouped = secret.match(/.{1,4}/g)!.join(' ')
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-2xl bg-gold-100 p-2 shadow-[0_0_40px_-10px_rgba(207,168,101,0.6)]">
        <QrCode value={otpauthUri(secret)} className="size-44" />
      </div>
      <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-300">
        <p>
          Scanne ce QR code avec ton application d’authentification (Aegis, Google Authenticator, 2FAS, Authy…). Ne l’ajoute pas
          dans ce coffre lui-même.
        </p>
        <p className="text-xs text-ink-400">Impossible de scanner ? Saisis cette clé manuellement :</p>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(secret).then(() => toast('Clé copiée'))}
          className="flex w-full items-center justify-between gap-2 rounded-lg bg-ink-950/70 px-3 py-2 text-left font-mono text-[13px] tracking-wide break-all text-gold-200 hover:bg-ink-950"
        >
          {grouped}
          <Copy className="size-3.5 shrink-0 text-ink-400" />
        </button>
      </div>
    </div>
  )
}

export function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-ink-300">
        Si tu perds ton téléphone, chacun de ces codes remplace <strong className="text-ink-100">une fois</strong> le code 2FA.
        Imprime-les ou garde-les hors ligne. Ils ne seront plus affichés.
      </p>
      <ol className="grid grid-cols-2 gap-2 rounded-2xl border border-gold-400/15 bg-ink-950/60 p-4 font-mono text-[14px] tracking-wider text-gold-100">
        {codes.map((c, i) => (
          <li key={c} className="flex gap-2">
            <span className="w-5 text-right text-ink-600">{i + 1}</span>
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => downloadRecoveryCodes(codes)}>
          <Download className="size-4" /> Télécharger (.txt)
        </Button>
        <Button type="button" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Codes copiés'))}>
          <Copy className="size-4" /> Copier
        </Button>
      </div>
      <button type="button" onClick={() => setSaved((v) => !v)} className="flex items-center gap-3 text-left text-sm text-ink-200">
        <span
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
            saved ? 'border-gold-400 bg-gold-400 text-ink-950' : 'border-white/20',
          )}
        >
          {saved && <Check className="size-3.5" />}
        </span>
        J’ai mis ces codes en lieu sûr
      </button>
      <Button type="button" variant="primary" className="h-12 w-full" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
