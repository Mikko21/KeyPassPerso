import { Bitcoin, KeyRound, Landmark, NotebookPen, Shapes, Wifi, type LucideIcon } from 'lucide-react'
import type { Category } from './types'

export const CATEGORIES: Record<Category, { label: string; icon: LucideIcon }> = {
  login: { label: 'Identifiants', icon: KeyRound },
  bank: { label: 'Banque', icon: Landmark },
  crypto: { label: 'Crypto', icon: Bitcoin },
  wifi: { label: 'Wi‑Fi', icon: Wifi },
  note: { label: 'Notes sécurisées', icon: NotebookPen },
  other: { label: 'Autre', icon: Shapes },
}

export const CATEGORY_ORDER: Category[] = ['login', 'bank', 'crypto', 'wifi', 'note', 'other']


export function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function safeHref(url: string): string | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
