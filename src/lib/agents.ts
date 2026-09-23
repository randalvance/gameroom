// The agents in the room: what a host hands in, and what the room makes of
// it. Pure and DOM-free — the scene reads these, and so do the tests.

/** The six things an agent can be doing, as far as the room cares. */
export type AgentStatus = "idle" | "working" | "waiting" | "done" | "error" | "offline"

export const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "waiting", "done", "error", "offline"]

export interface Agent {
  /** Stable across renders. Also seeds the derived character. */
  id: string
  name: string
  status: AgentStatus
  /** Bubble text. A working agent shows "Working…" when this is empty. */
  activity?: string
  /** This agent follows that one in a line, and its status rolls up to it. */
  parentId?: string
  /** A stock sheet index, or a URL to a 6×4 sheet. Absent derives one from the id. */
  sprite?: number | string
  /** Halo tint override, as a CSS hex colour. Absent follows the status. */
  color?: string
}

/** How an agent in a given status looks. Every field has a default. */
export interface StatusStyle {
  /** Walk laps around the desk, or stand where it is. */
  motion?: "laps" | "stand"
  /** The bubble over its head. null hides it; a string replaces the default.
   * An agent's own `activity` text wins over either. */
  bubble?: string | null
  /** The sheet pose held while standing: the walk cycle, or the hurt frame. */
  frame?: "walk" | "hurt"
  /** Halo colour as a CSS hex, or null for no halo. */
  halo?: string | null
  /** The halo breathes. */
  pulse?: boolean
  /** Sprite opacity, 0..1. */
  opacity?: number
}

export type ResolvedStatusStyle = Required<StatusStyle>

export const DEFAULT_STATUS_STYLES: Readonly<Record<AgentStatus, ResolvedStatusStyle>> = {
  idle: { motion: "stand", bubble: null, frame: "walk", halo: "#40FF88", pulse: false, opacity: 1 },
  working: { motion: "laps", bubble: "Working…", frame: "walk", halo: "#40FF88", pulse: false, opacity: 1 },
  waiting: { motion: "stand", bubble: "Waiting for you", frame: "walk", halo: "#FFB020", pulse: true, opacity: 1 },
  done: { motion: "stand", bubble: "Done", frame: "walk", halo: "#5090FF", pulse: false, opacity: 1 },
  error: { motion: "stand", bubble: "Error", frame: "hurt", halo: "#FF4040", pulse: false, opacity: 1 },
  offline: { motion: "stand", bubble: null, frame: "walk", halo: null, pulse: false, opacity: 0.6 },
}

export type StatusStyleOverrides = Partial<Record<AgentStatus, StatusStyle>>

/** The look for a status, with the host's overrides laid over the defaults. */
export function styleFor(status: AgentStatus, overrides?: StatusStyleOverrides): ResolvedStatusStyle {
  const base = DEFAULT_STATUS_STYLES[status]
  const over = overrides?.[status]
  if (!over) return base
  return {
    motion: over.motion ?? base.motion,
    bubble: over.bubble === undefined ? base.bubble : over.bubble,
    frame: over.frame ?? base.frame,
    halo: over.halo === undefined ? base.halo : over.halo,
    pulse: over.pulse ?? base.pulse,
    opacity: over.opacity ?? base.opacity,
  }
}

/** What the bubble over an agent says: its activity, else the style's line. */
export function bubbleTextFor(agent: Pick<Agent, "activity">, style: ResolvedStatusStyle): string | null {
  const activity = agent.activity?.trim()
  if (activity) return activity
  return style.bubble
}

/**
 * An agent's status once its descendants are counted: working when any of
 * them is working, else its own. The host's data is never mutated.
 *
 * Cycles in `parentId` are tolerated — each agent is visited once.
 */
export function effectiveStatus(agent: Agent, agents: readonly Agent[]): AgentStatus {
  if (agent.status === "working") return "working"
  const seen = new Set<string>([agent.id])
  const frontier = [agent.id]
  while (frontier.length > 0) {
    const parentId = frontier.pop()!
    for (const child of agents) {
      if (child.parentId !== parentId || seen.has(child.id)) continue
      if (child.status === "working") return "working"
      seen.add(child.id)
      frontier.push(child.id)
    }
  }
  return agent.status
}

/** How many agents are in each status. */
export function countByStatus(agents: readonly Agent[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = { idle: 0, working: 0, waiting: 0, done: 0, error: 0, offline: 0 }
  for (const agent of agents) counts[effectiveStatus(agent, agents)]++
  return counts
}

/**
 * The wall's own summary of the room, for a host that supplies no board:
 * how many agents there are, and how many are working, waiting or in
 * trouble. Lines the room has nothing to say for are left out.
 */
export function agentBoardSummary(agents: readonly Agent[]): { title: string; lines: string[] } {
  const counts = countByStatus(agents)
  const lines: string[] = []
  if (agents.length === 0) lines.push("NO AGENTS IN THE ROOM")
  else {
    const parts = [`${counts.working} WORKING`]
    if (counts.waiting > 0) parts.push(`${counts.waiting} WAITING FOR YOU`)
    if (counts.error > 0) parts.push(`${counts.error} IN TROUBLE`)
    lines.push(parts.join(" · "))
    const rest = [`${counts.idle} IDLE`]
    if (counts.done > 0) rest.push(`${counts.done} DONE`)
    if (counts.offline > 0) rest.push(`${counts.offline} OFFLINE`)
    lines.push(rest.join(" · "))
  }
  return { title: `${agents.length} ${agents.length === 1 ? "AGENT" : "AGENTS"}`, lines }
}

/** A stable small integer from an id, for seeding a character and its walk. */
export function hashAgentId(id: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
