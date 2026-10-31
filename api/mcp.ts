// Remote MCP server (Streamable HTTP, stateless JSON responses) for AI routines.
// Authenticated with an agent access token sent as "Authorization: Bearer kpa_…" by the connector,
// so the token never appears in the model's context. Tools log in and browse on the server side:
// passwords and cookies stay here; the agent only receives page text, forms and links.

import {
  appendLog,
  findGrant,
  loadSession,
  newHandle,
  openBox,
  saveSession,
  SESSION_TTL_MS,
  type AgentGrant,
  type Credential,
  type SharedEntry,
} from './_lib/agents.js'
import { assertAllowed, login, request, summarize, WebError } from './_lib/web.js'

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'keypassperso', title: 'KeyPassPerso', version: '1.0.0' }

const INSTRUCTIONS = `Coffre KeyPassPerso : connexions à des sites web sans jamais exposer les mots de passe.
1. list_logins pour voir les entrées partagées avec toi.
2. site_login avec le nom de l'entrée : le serveur se connecte et renvoie un identifiant de session + la page obtenue.
3. site_get / site_submit avec cet identifiant pour naviguer et remplir des formulaires (réservations, etc.).
Tu ne recevras jamais le mot de passe ni les cookies. Les sessions expirent après 30 minutes d'inactivité.`

const TOOLS = [
  {
    name: 'list_logins',
    title: 'Lister les connexions disponibles',
    description: 'Liste les entrées du coffre partagées avec cet agent (nom et domaine autorisé). Aucun secret renvoyé.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'site_login',
    title: 'Se connecter à un site',
    description:
      "Se connecte au site d'une entrée partagée en remplissant son formulaire de connexion côté serveur. Renvoie un identifiant de session et le contenu de la page après connexion. Le mot de passe n'est jamais renvoyé.",
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: "Nom de l'entrée (voir list_logins)" },
        url: { type: 'string', description: "Optionnel : page contenant le formulaire de connexion (sinon l'URL de l'entrée)" },
      },
      required: ['entry'],
      additionalProperties: false,
    },
  },
  {
    name: 'site_get',
    title: 'Ouvrir une page',
    description: 'Charge une page du site avec la session connectée et renvoie son texte, ses formulaires et ses liens.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Identifiant renvoyé par site_login' },
        url: { type: 'string', description: 'URL absolue sur le domaine autorisé' },
      },
      required: ['session', 'url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'site_submit',
    title: 'Envoyer un formulaire',
    description:
      'Envoie un formulaire du site avec la session connectée (champs tels que listés dans FORMULAIRES). Pour une case à cocher multiple, passer un tableau de valeurs.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        url: { type: 'string', description: 'Action du formulaire (URL absolue)' },
        method: { type: 'string', enum: ['POST', 'GET'], default: 'POST' },
        fields: {
          type: 'object',
          additionalProperties: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        },
      },
      required: ['session', 'url', 'fields'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
]

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> }

function rpcResult(id: JsonRpc['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function text(t: string, isError = false) {
  return { content: [{ type: 'text', text: t }], isError }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function findEntry(grant: AgentGrant, name: unknown): SharedEntry | null {
  const q = String(name ?? '').trim().toLowerCase()
  return grant.entries.find((e) => e.entryId === q || e.title.toLowerCase() === q) ?? grant.entries.find((e) => e.title.toLowerCase().includes(q)) ?? null
}

async function callTool(grant: AgentGrant, token: string, name: string, args: Record<string, unknown>) {
  const log = (ok: boolean, extra: { entry?: string; url?: string; detail?: string } = {}) =>
    appendLog({ at: Date.now(), agentId: grant.id, agentName: grant.name, tool: name, ok, ...extra })

  switch (name) {
    case 'list_logins': {
      await log(true)
      if (!grant.entries.length) return text('Aucune entrée partagée avec cet agent.')
      return text(grant.entries.map((e) => `- ${e.title} (domaine autorisé : ${e.host})`).join('\n'))
    }

    case 'site_login': {
      const entry = findEntry(grant, args.entry)
      if (!entry) return text(`Entrée inconnue : ${String(args.entry)}. Utilise list_logins.`, true)
      const cred = openBox<Credential>(entry.sealed, token)
      const loginUrl = typeof args.url === 'string' && args.url ? args.url : cred.url.includes('://') ? cred.url : `https://${cred.url}`
      const jar: Record<string, string> = {}
      try {
        assertAllowed(new URL(loginUrl), entry.host)
        const { ok, page } = await login(loginUrl, entry.host, cred.username, cred.password, jar)
        if (!ok) {
          await log(false, { entry: entry.title, url: page.url, detail: 'login refusé' })
          return text(`Connexion refusée par le site (identifiants invalides ou étape supplémentaire).\n\n${summarize(page, [cred.password])}`, true)
        }
        const handle = newHandle()
        await saveSession(
          handle,
          { agentId: grant.id, entryId: entry.entryId, host: entry.host, cookies: jar, password: cred.password, expiresAt: Date.now() + SESSION_TTL_MS },
          token,
        )
        await log(true, { entry: entry.title, url: page.url })
        return text(`Connecté à ${entry.title}. Session : ${handle}\n\n${summarize(page, [cred.password])}`)
      } catch (err) {
        await log(false, { entry: entry.title, url: loginUrl, detail: err instanceof Error ? err.message : 'erreur' })
        return text(`Échec de connexion : ${err instanceof Error ? err.message : 'erreur'}`, true)
      }
    }

    case 'site_get':
    case 'site_submit': {
      const handle = String(args.session ?? '')
      const session = await loadSession(handle, token)
      if (!session || session.agentId !== grant.id) return text('Session inconnue ou expirée : relance site_login.', true)
      const url = String(args.url ?? '')
      try {
        const page =
          name === 'site_get'
            ? await request(url, session.host, session.cookies)
            : await request(url, session.host, session.cookies, {
                method: args.method === 'GET' ? 'GET' : 'POST',
                form: Object.fromEntries(
                  Object.entries((args.fields as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v)]),
                ),
              })
        await saveSession(handle, { ...session, expiresAt: Date.now() + SESSION_TTL_MS }, token)
        await log(true, { url: page.url })
        return text(summarize(page, [session.password]))
      } catch (err) {
        await log(false, { url, detail: err instanceof Error ? err.message : 'erreur' })
        return text(`Échec : ${err instanceof WebError || err instanceof Error ? err.message : 'erreur'}`, true)
      }
    }

    default:
      return null
  }
}

async function handle(msg: JsonRpc, grant: AgentGrant, token: string) {
  const { id, method, params = {} } = msg
  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? '')
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS })
    case 'tools/call': {
      const result = await callTool(grant, token, String(params.name), (params.arguments as Record<string, unknown>) ?? {})
      return result ? rpcResult(id, result) : rpcError(id, -32602, `Outil inconnu : ${String(params.name)}`)
    }
    default:
      return rpcError(id, -32601, `Méthode non supportée : ${String(method)}`)
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'GET' || req.method === 'DELETE') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    if (req.method !== 'POST') return new Response(null, { status: 405 })

    const m = /^Bearer (kpa_[A-Za-z0-9_-]{20,})$/.exec(req.headers.get('authorization') ?? '')
    const grant = m ? await findGrant(m[1]).catch(() => null) : null
    if (!m || !grant) return json(rpcError(null, -32001, 'Accès agent invalide, expiré ou révoqué'), 401)
    const token = m[1]

    let body: JsonRpc | JsonRpc[]
    try {
      body = (await req.json()) as JsonRpc | JsonRpc[]
    } catch {
      return json(rpcError(null, -32700, 'JSON invalide'), 400)
    }
    const messages = Array.isArray(body) ? body : [body]
    const responses = []
    for (const msg of messages) {
      // Notifications (no id) get no response.
      if (msg.id === undefined || msg.id === null) continue
      try {
        responses.push(await handle(msg, grant, token))
      } catch (err) {
        console.error(err)
        responses.push(rpcError(msg.id, -32603, 'Erreur serveur'))
      }
    }
    if (!responses.length) return new Response(null, { status: 202 })
    return json(Array.isArray(body) ? responses : responses[0])
  },
}
