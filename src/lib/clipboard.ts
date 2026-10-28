let clearTimer: number | undefined

/** Copies a secret and wipes the clipboard after `clearAfterS` seconds if it still holds it. */
export async function copySecret(value: string, clearAfterS: number): Promise<void> {
  await navigator.clipboard.writeText(value)
  window.clearTimeout(clearTimer)
  if (clearAfterS <= 0) return
  clearTimer = window.setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText()
      if (current === value) await navigator.clipboard.writeText('')
    } catch {
      // readText needs focus/permission; clear anyway since the secret is likely still there.
      await navigator.clipboard.writeText('').catch(() => {})
    }
  }, clearAfterS * 1000)
}
