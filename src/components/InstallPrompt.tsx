import { useEffect, useState } from 'react'
import { EllipsisVertical, PlusSquare, Share, X } from 'lucide-react'
import { Button } from './ui'

// Chrome/Edge/Samsung Internet fire this event when the PWA is installable.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'kpp:install-dismissed'
const SNOOZE_MS = 14 * 24 * 3600 * 1000

type Platform = 'ios' | 'android' | null

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return null
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function recentlyDismissed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < SNOOZE_MS
  } catch {
    return false
  }
}

/** Bottom sheet inviting mobile visitors to add the app to their home screen. */
export function InstallPrompt() {
  const [platform] = useState(detectPlatform)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!platform || isStandalone() || recentlyDismissed()) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setVisible(false)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    const t = window.setTimeout(() => setVisible(true), 1200)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.clearTimeout(t)
    }
  }, [platform])

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // storage unavailable: the prompt will simply show again next time
    }
    setVisible(false)
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === 'accepted') setVisible(false)
    else dismiss()
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div role="dialog" aria-label="Installer l’application" className="animate-rise pointer-events-auto w-full max-w-md rounded-3xl border border-white/[0.08] bg-ink-900/[0.97] p-5 shadow-2xl shadow-black/80 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <img src="/icons/icon-192.png" alt="" className="size-14 shrink-0 rounded-2xl border border-white/10" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-tight text-ink-100">
              Installe <em className="text-gold-gradient">Coffre</em>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-300">Plein écran, icône sur ton écran d’accueil, ouverture instantanée.</p>
          </div>
          <button onClick={dismiss} aria-label="Fermer" className="-mt-1 -mr-1 rounded-lg p-1.5 text-ink-400 hover:text-ink-100">
            <X className="size-4" />
          </button>
        </div>

        {deferred ? (
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={dismiss}>
              Plus tard
            </Button>
            <Button variant="primary" className="flex-[2]" onClick={() => void install()}>
              Installer l’application
            </Button>
          </div>
        ) : (
          <ol className="mt-5 space-y-3 text-sm text-ink-200">
            {platform === 'ios' ? (
              <>
                <li className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-gold-200">
                    <Share className="size-4" />
                  </span>
                  <span>
                    Touche <strong className="text-ink-100">Partager</strong> dans la barre de Safari
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-gold-200">
                    <PlusSquare className="size-4" />
                  </span>
                  <span>
                    Puis <strong className="text-ink-100">Sur l’écran d’accueil</strong>
                  </span>
                </li>
              </>
            ) : (
              <>
                <li className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-gold-200">
                    <EllipsisVertical className="size-4" />
                  </span>
                  <span>
                    Ouvre le <strong className="text-ink-100">menu</strong> du navigateur
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-gold-200">
                    <PlusSquare className="size-4" />
                  </span>
                  <span>
                    Puis <strong className="text-ink-100">Installer l’application</strong> ou <strong className="text-ink-100">Ajouter à l’écran d’accueil</strong>
                  </span>
                </li>
              </>
            )}
            <li>
              <Button variant="ghost" className="mt-1 w-full" onClick={dismiss}>
                Plus tard
              </Button>
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}
