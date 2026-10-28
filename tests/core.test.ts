import { describe, expect, it } from 'vitest'
import { decryptVault, deriveKeys, encryptVault, type KdfParams } from '../src/lib/crypto'
import { estimateStrength, generatePassword } from '../src/lib/generator'
import { mergeVaults } from '../src/lib/merge'
import { generateTotp } from '../src/lib/totp'
import { emptyVault, newEntry } from '../src/lib/types'

// Low iteration count keeps tests fast; production uses 600k.
const kdf: KdfParams = { name: 'PBKDF2-SHA256', iterations: 1000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }

describe('crypto', () => {
  it('round-trips a vault', async () => {
    const keys = await deriveKeys('correct horse battery staple', kdf)
    const data = emptyVault()
    data.entries.push({ ...newEntry(), title: 'Kraken', password: 's3cr3t' })
    const env = await encryptVault(data, keys, 1)
    expect(env.ct).not.toContain('Kraken')
    expect(await decryptVault(env, keys)).toEqual(data)
  })

  it('rejects a wrong password and tampered ciphertext', async () => {
    const keys = await deriveKeys('right', kdf)
    const env = await encryptVault(emptyVault(), keys, 1)
    await expect(decryptVault(env, await deriveKeys('wrong', kdf))).rejects.toThrow()
    const bytes = Buffer.from(env.ct, 'base64')
    bytes[0] ^= 1
    await expect(decryptVault({ ...env, ct: bytes.toString('base64') }, keys)).rejects.toThrow()
  })

  it('derives a deterministic auth key distinct per password', async () => {
    const a = await deriveKeys('pw', kdf)
    const b = await deriveKeys('pw', kdf)
    const c = await deriveKeys('pw2', kdf)
    expect(a.authKey).toMatch(/^[0-9a-f]{64}$/)
    expect(a.authKey).toBe(b.authKey)
    expect(a.authKey).not.toBe(c.authKey)
  })
})

describe('totp', () => {
  it('matches RFC 6238 SHA-1 test vector', async () => {
    // Secret "12345678901234567890" in base32, T = 59s -> 94287082 (8 digits).
    const uri = 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8'
    expect((await generateTotp(uri, 59_000)).code).toBe('94287082')
    expect((await generateTotp(uri, 1111111109_000)).code).toBe('07081804')
  })
})

describe('generator', () => {
  it('honours length and character classes', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ length: 20, lower: true, upper: true, digits: true, symbols: false, avoidAmbiguous: true })
      expect(pw).toHaveLength(20)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[0-9]/)
      expect(pw).not.toMatch(/[Il1O0o]/)
    }
  })
  it('rates weak vs strong', () => {
    expect(estimateStrength('azerty').score).toBe(0)
    expect(estimateStrength('vX9#qL2!mR7$wT4&zK8@').score).toBe(4)
  })
})

describe('merge', () => {
  it('keeps newest edit and honours tombstones', () => {
    const a = { ...newEntry(), id: 'a', title: 'old', updatedAt: 1 }
    const b = { ...newEntry(), id: 'b', title: 'b', updatedAt: 5 }
    const local = { ...emptyVault(), entries: [{ ...a, title: 'new', updatedAt: 10 }, b] }
    const remote = { ...emptyVault(), entries: [a, b], deleted: { b: Date.now() } }
    const merged = mergeVaults(local, remote)
    expect(merged.entries.map((e) => [e.id, e.title])).toEqual([['a', 'new']])
  })
})
