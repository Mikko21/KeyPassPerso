// RFC 6238 TOTP generation (HMAC-SHA1/256/512) via WebCrypto.

interface TotpConfig {
  secret: Uint8Array<ArrayBuffer>
  digits: number
  period: number
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512'
}

function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    const idx = alphabet.indexOf(c)
    if (idx === -1) throw new Error('Secret TOTP invalide')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function parseTotp(raw: string): TotpConfig {
  const trimmed = raw.trim()
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    const url = new URL(trimmed)
    const algo = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
    return {
      secret: base32Decode(url.searchParams.get('secret') ?? ''),
      digits: Number(url.searchParams.get('digits') ?? 6),
      period: Number(url.searchParams.get('period') ?? 30),
      algorithm: algo === 'SHA256' ? 'SHA-256' : algo === 'SHA512' ? 'SHA-512' : 'SHA-1',
    }
  }
  return { secret: base32Decode(trimmed), digits: 6, period: 30, algorithm: 'SHA-1' }
}

export async function generateTotp(raw: string, now = Date.now()): Promise<{ code: string; remaining: number; period: number }> {
  const cfg = parseTotp(raw)
  if (cfg.secret.length === 0) throw new Error('Secret TOTP vide')
  const counter = Math.floor(now / 1000 / cfg.period)
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const key = await crypto.subtle.importKey('raw', cfg.secret, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const offset = mac[mac.length - 1] & 0x0f
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  const code = (bin % 10 ** cfg.digits).toString().padStart(cfg.digits, '0')
  const remaining = cfg.period - (Math.floor(now / 1000) % cfg.period)
  return { code, remaining, period: cfg.period }
}
