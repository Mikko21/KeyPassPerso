// Minimal server-side "browser" over plain HTTP: cookie jar, redirects, form login and a compact
// text rendering of pages for the agent. Works for classic server-rendered sites (forms + cookies);
// sites that log in through JavaScript are out of scope.

import { parse, type HTMLElement } from 'node-html-parser'

const MAX_REDIRECTS = 10
const MAX_TEXT = 14_000
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export class WebError extends Error {}

/** Allows the entry's domain and its subdomains, over https only. */
export function assertAllowed(url: URL, host: string): void {
  const h = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') throw new WebError('Seules les URL https sont autorisées')
  if (h !== host && !h.endsWith(`.${host}`)) throw new WebError(`Domaine non autorisé pour cette entrée : ${h}`)
}

export interface PageResult {
  url: string
  status: number
  html: string
}

function storeCookies(res: Response, jar: Record<string, string>): void {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) < Date.now()))
    if (expired || value === '' || value === 'deleted') delete jar[name]
    else jar[name] = value
  }
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** Fetches with the jar, following redirects manually so every Set-Cookie is captured. */
export async function request(
  input: string,
  host: string,
  jar: Record<string, string>,
  init: { method?: 'GET' | 'POST'; form?: Record<string, string | string[]> } = {},
): Promise<PageResult> {
  let url = new URL(input)
  let method = init.method ?? 'GET'
  let body: string | undefined
  if (init.form) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(init.form)) for (const one of Array.isArray(v) ? v : [v]) params.append(k, one)
    body = params.toString()
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertAllowed(url, host)
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'fr,en;q=0.8,de;q=0.6',
        ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    storeCookies(res, jar)
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url)
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    const html = (await res.text()).slice(0, 2_000_000)
    return { url: url.toString(), status: res.status, html }
  }
  throw new WebError('Trop de redirections')
}

// ---------- Login ----------

interface LoginForm {
  action: string
  method: 'GET' | 'POST'
  fields: Record<string, string>
  userField: string | null
  passField: string
}

function formFields(form: HTMLElement): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const input of form.querySelectorAll('input')) {
    const name = input.getAttribute('name')
    const type = (input.getAttribute('type') ?? 'text').toLowerCase()
    if (!name || type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue
    if ((type === 'checkbox' || type === 'radio') && !input.hasAttribute('checked')) continue
    fields[name] = input.getAttribute('value') ?? (type === 'checkbox' ? 'on' : '')
  }
  for (const sel of form.querySelectorAll('select')) {
    const name = sel.getAttribute('name')
    if (!name) continue
    const opt = sel.querySelector('option[selected]') ?? sel.querySelector('option')
    fields[name] = opt?.getAttribute('value') ?? opt?.text.trim() ?? ''
  }
  return fields
}

export function findLoginForm(html: string, pageUrl: string): LoginForm | null {
  const root = parse(html)
  for (const form of root.querySelectorAll('form')) {
    const pass = form.querySelector('input[type="password"]')
    const passField = pass?.getAttribute('name')
    if (!passField) continue
    // A registration form has two password fields; skip it.
    if (form.querySelectorAll('input[type="password"]').length > 1) continue
    const candidates = form
      .querySelectorAll('input')
      .filter((i) => ['text', 'email', 'tel', ''].includes((i.getAttribute('type') ?? '').toLowerCase()) && i.getAttribute('name'))
    const preferred = candidates.find((i) => /user|login|mail|ident|account|benutzer/i.test(`${i.getAttribute('name')} ${i.getAttribute('id') ?? ''}`))
    const userField = (preferred ?? candidates[0])?.getAttribute('name') ?? null
    return {
      action: new URL(form.getAttribute('action') || pageUrl, pageUrl).toString(),
      method: (form.getAttribute('method') ?? 'get').toLowerCase() === 'post' ? 'POST' : 'GET',
      fields: formFields(form),
      userField,
      passField,
    }
  }
  return null
}

/** Opens the login page, fills the first single-password form and submits it. */
export async function login(
  loginUrl: string,
  host: string,
  username: string,
  password: string,
  jar: Record<string, string>,
): Promise<{ ok: boolean; page: PageResult }> {
  const first = await request(loginUrl, host, jar)
  const form = findLoginForm(first.html, first.url)
  if (!form) throw new WebError('Aucun formulaire de connexion trouvé sur cette page (site en JavaScript ?)')
  const fields = { ...form.fields, [form.passField]: password }
  if (form.userField) fields[form.userField] = username
  const page = await request(form.action, host, jar, { method: form.method, form: fields })
  // Success heuristic: the returned page no longer asks for this password field.
  const stillLoginForm = findLoginForm(page.html, page.url)
  const hasLogout = /logout|log out|abmelden|déconnexion|se déconnecter|sign out/i.test(page.html)
  return { ok: hasLogout || !stillLoginForm, page }
}

// ---------- Compact rendering for the agent ----------

const STATE_CLASS = /\b(available|free|booked|ordered|reserved|occupied|disabled|selected|full|closed|libre|frei|belegt)\b/i
const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'head', 'template', 'iframe'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'li', 'tr', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'form', 'header', 'footer', 'nav', 'main'])

function renderText(node: HTMLElement, out: string[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // .text decodes HTML entities (&ouml; -> ö).
      const t = decode(child.text).replace(/\s+/g, ' ')
      if (t.trim()) out.push(t)
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as HTMLElement
    const tag = el.tagName?.toLowerCase() ?? ''
    if (SKIP.has(tag)) continue
    const cls = el.getAttribute('class') ?? ''
    const state = cls.match(STATE_CLASS)?.[1]
    if (BLOCK.has(tag)) out.push('\n')
    if (tag === 'td' || tag === 'th') out.push(' | ')
    if (state) out.push(`[${state.toLowerCase()}] `)
    renderText(el, out)
    if (BLOCK.has(tag)) out.push('\n')
  }
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/** Text, forms and links of a page, with the given secrets redacted. */
export function summarize(page: PageResult, secrets: string[]): string {
  const root = parse(page.html)
  const title = root.querySelector('title')?.text.trim() ?? ''
  const parts: string[] = []
  renderText(root.querySelector('body') ?? root, parts)
  let text = parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n… (tronqué)`

  const forms = root.querySelectorAll('form').slice(0, 25).map((form, i) => {
    const action = new URL(form.getAttribute('action') || page.url, page.url).toString()
    const method = (form.getAttribute('method') ?? 'get').toUpperCase()
    const inputs = form.querySelectorAll('input, select, textarea').map((el) => {
      const name = el.getAttribute('name')
      if (!name) return null
      const type = el.tagName.toLowerCase() === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : el.tagName.toLowerCase()
      if (type === 'password') return `    - ${name} (password, rempli par le coffre)`
      if (type === 'select') {
        const opts = el.querySelectorAll('option').slice(0, 30).map((o) => `${o.getAttribute('value') ?? ''}=${o.text.trim()}`)
        return `    - ${name} (select): ${opts.join(', ')}`
      }
      const checked = el.hasAttribute('checked') ? ' checked' : ''
      return `    - ${name} (${type}${checked}) = ${JSON.stringify(el.getAttribute('value') ?? '')}`
    })
    return `  #${i + 1} ${method} ${action}\n${inputs.filter(Boolean).join('\n')}`
  })

  const seen = new Set<string>()
  const links: string[] = []
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue
    let abs: string
    try {
      abs = new URL(href, page.url).toString()
    } catch {
      continue
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    links.push(`  - ${a.text.replace(/\s+/g, ' ').trim().slice(0, 60) || '(sans texte)'} → ${abs}`)
    if (links.length >= 120) break
  }

  let out = [
    `URL: ${page.url}`,
    `HTTP ${page.status}${title ? ` · ${title}` : ''}`,
    '',
    'TEXTE:',
    text,
    '',
    `FORMULAIRES (${forms.length}):`,
    forms.join('\n') || '  (aucun)',
    '',
    `LIENS (${links.length}):`,
    links.join('\n') || '  (aucun)',
  ].join('\n')
  for (const s of secrets) if (s && s.length >= 3) out = out.split(s).join('[secret masqué]')
  return out
}
