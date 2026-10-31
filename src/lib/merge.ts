import type { AgentAccess, Entry, VaultData } from './types'

/** Last-writer-wins merge per entry, with tombstones so deletions propagate across devices. */
export function mergeVaults(local: VaultData, remote: VaultData): VaultData {
  const deleted: Record<string, number> = { ...remote.deleted }
  for (const [id, ts] of Object.entries(local.deleted)) deleted[id] = Math.max(ts, deleted[id] ?? 0)

  const byId = new Map<string, Entry>()
  for (const e of [...remote.entries, ...local.entries]) {
    const prev = byId.get(e.id)
    if (!prev || e.updatedAt > prev.updatedAt) byId.set(e.id, e)
  }
  const entries = [...byId.values()].filter((e) => !(deleted[e.id] && deleted[e.id] >= e.updatedAt))

  // Drop tombstones older than 180 days to keep the vault small.
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000
  for (const [id, ts] of Object.entries(deleted)) if (ts < cutoff) delete deleted[id]

  const agentsById = new Map<string, AgentAccess>()
  for (const a of [...(remote.agents ?? []), ...(local.agents ?? [])]) {
    const prev = agentsById.get(a.id)
    if (!prev || a.updatedAt > prev.updatedAt) agentsById.set(a.id, a)
  }
  const agents = [...agentsById.values()].filter((a) => !(deleted[a.id] && deleted[a.id] >= a.updatedAt))

  return { entries, agents, deleted, settings: local.settings }
}
