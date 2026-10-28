// Password generator and strength estimation, using unbiased CSPRNG sampling.

export interface GeneratorOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  avoidAmbiguous: boolean
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 24,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
}
const AMBIGUOUS = /[Il1O0o]/g

/** Uniform random integer in [0, max) without modulo bias. */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

export function generatePassword(opts: GeneratorOptions): string {
  const pools = (['lower', 'upper', 'digits', 'symbols'] as const)
    .filter((k) => opts[k])
    .map((k) => (opts.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]))
  if (pools.length === 0) return ''
  const all = pools.join('')
  const length = Math.max(opts.length, pools.length)
  // Guarantee at least one char from each selected pool, then shuffle.
  const chars = pools.map((p) => p[randomInt(p.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  bits: number
  label: string
}

const LABELS = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Excellent']

/** Rough entropy estimate (charset size × length) with penalties for obvious patterns. */
export function estimateStrength(pw: string): Strength {
  if (!pw) return { score: 0, bits: 0, label: LABELS[0] }
  let charset = 0
  if (/[a-z]/.test(pw)) charset += 26
  if (/[A-Z]/.test(pw)) charset += 26
  if (/[0-9]/.test(pw)) charset += 10
  if (/[^a-zA-Z0-9]/.test(pw)) charset += 30
  let bits = pw.length * Math.log2(Math.max(charset, 1))
  if (/(.)\1{2,}/.test(pw)) bits *= 0.8
  if (/^(?:[a-z]+|[A-Z]+|[0-9]+)$/.test(pw)) bits *= 0.7
  if (/(password|motdepasse|azerty|qwerty|123456|admin|letmein)/i.test(pw)) bits *= 0.4
  bits = Math.round(bits)
  const score = (bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 90 ? 3 : 4) as Strength['score']
  return { score, bits, label: LABELS[score] }
}
