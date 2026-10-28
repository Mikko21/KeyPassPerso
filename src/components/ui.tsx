import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'

export function Button({
  variant = 'subtle',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary:
      'bg-gradient-to-b from-gold-200 to-gold-400 text-ink-950 font-medium shadow-[0_1px_0_0_rgba(255,255,255,0.5)_inset,0_8px_24px_-8px_rgba(207,168,101,0.55)] hover:from-gold-100 hover:to-gold-300',
    subtle: 'bg-white/[0.05] text-ink-100 border border-white/[0.07] hover:bg-white/[0.09]',
    ghost: 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.05]',
    danger: 'bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20',
  }
  return (
    <button
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

const inputBase =
  'w-full rounded-xl border border-white/[0.08] bg-ink-900/80 px-3.5 text-[15px] text-ink-100 placeholder:text-ink-400 transition-colors focus:border-gold-400/50 focus:outline-none focus:ring-4 focus:ring-gold-400/10'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[11px] font-medium tracking-[0.12em] text-ink-300 uppercase">
        {label}
        {hint}
      </span>
      {children}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputBase, 'h-11', className)} {...props} />
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputBase, 'min-h-28 resize-y py-3 leading-relaxed', className)} {...props} />
}

export function PasswordInput({
  className,
  trailing,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { trailing?: ReactNode }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        className={cx(inputBase, 'h-11 pr-24 font-mono tracking-wide', className)}
        {...props}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {trailing}
        <IconButton type="button" label={visible ? 'Masquer' : 'Afficher'} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal aria-labelledby={id}>
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cx(
          'glass animate-rise relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl p-6 shadow-2xl shadow-black/60 sm:rounded-3xl sm:p-8',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id={id} className="font-display text-3xl text-ink-100">
            {title}
          </h2>
          <IconButton label="Fermer" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StrengthBar({ score, label }: { score: number; label: string }) {
  const colors = ['bg-rose-500', 'bg-orange-400', 'bg-amber-300', 'bg-emerald-400', 'bg-gold-300']
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cx('h-1 flex-1 rounded-full transition-colors duration-300', i <= score ? colors[score] : 'bg-white/[0.07]')}
          />
        ))}
      </div>
      <span className="w-20 text-right text-xs text-ink-300">{label}</span>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-sm text-ink-200"
    >
      {label}
      <span
        className={cx(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-gold-400' : 'bg-white/[0.1]',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

export { cx }
