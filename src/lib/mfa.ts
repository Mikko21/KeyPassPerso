// Client-side TOTP enrollment material and one-time recovery codes.

import { randomBytes } from './crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

/** 160-bit secret, as recommended by RFC 4226 (32 base32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function otpauthUri(secret: string): string {
  const label = encodeURIComponent('KeyPassPerso:Coffre')
  return `otpauth://totp/${label}?secret=${secret}&issuer=KeyPassPerso&algorithm=SHA1&digits=6&period=30`
}

/** Ten codes like "K7QM-2XRP-9WTD" (~60 bits each, unambiguous alphabet). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12)
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('')
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
  })
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function downloadRecoveryCodes(codes: string[]): void {
  const text = [
    'KeyPassPerso — codes de secours 2FA',
    `Générés le ${new Date().toLocaleString('fr-FR')}`,
    'Chaque code ne fonctionne qu’une seule fois. Conserve ce fichier hors ligne.',
    '',
    ...codes,
    '',
  ].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'keypassperso-codes-de-secours.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
