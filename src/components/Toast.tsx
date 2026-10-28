import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Check, AlertTriangle } from 'lucide-react'

interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="glass animate-rise flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm text-ink-100 shadow-2xl shadow-black/50"
          >
            {t.tone === 'ok' ? (
              <Check className="size-4 text-gold-300" />
            ) : (
              <AlertTriangle className="size-4 text-rose-400" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
