import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { DEFAULT_GENERATOR, estimateStrength, generatePassword, type GeneratorOptions } from '../lib/generator'
import { Button, StrengthBar, Toggle } from './ui'

export function Generator({ onUse }: { onUse: (pw: string) => void }) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_GENERATOR)
  const [value, setValue] = useState(() => generatePassword(DEFAULT_GENERATOR))
  const strength = estimateStrength(value)

  useEffect(() => setValue(generatePassword(opts)), [opts])

  const set = (patch: Partial<GeneratorOptions>) => setOpts((o) => ({ ...o, ...patch }))

  return (
    <div className="animate-rise space-y-4 rounded-2xl border border-gold-400/15 bg-gradient-to-b from-gold-400/[0.06] to-transparent p-4">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-950/70 px-3 py-2.5 font-mono text-[15px] tracking-wide text-gold-100">
          {value || '—'}
        </code>
        <Button type="button" variant="ghost" className="px-3" onClick={() => setValue(generatePassword(opts))} aria-label="Régénérer">
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <StrengthBar score={strength.score} label={`${strength.bits} bits`} />
      <div>
        <div className="mb-1 flex justify-between text-xs text-ink-300">
          <span>Longueur</span>
          <span className="font-mono text-gold-200">{opts.length}</span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          value={opts.length}
          onChange={(e) => set({ length: Number(e.target.value) })}
          className="w-full accent-gold-400"
        />
      </div>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Toggle label="Minuscules" checked={opts.lower} onChange={(v) => set({ lower: v })} />
        <Toggle label="Majuscules" checked={opts.upper} onChange={(v) => set({ upper: v })} />
        <Toggle label="Chiffres" checked={opts.digits} onChange={(v) => set({ digits: v })} />
        <Toggle label="Symboles" checked={opts.symbols} onChange={(v) => set({ symbols: v })} />
        <Toggle label="Éviter les ambigus (l, 1, O, 0)" checked={opts.avoidAmbiguous} onChange={(v) => set({ avoidAmbiguous: v })} />
      </div>
      <Button type="button" variant="primary" className="w-full" disabled={!value} onClick={() => onUse(value)}>
        Utiliser ce mot de passe
      </Button>
    </div>
  )
}
