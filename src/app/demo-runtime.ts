// The demo's stand-in for an agent runtime.
//
// A real host has agents that do things and reports what they are up to. The
// demo has a timer: every few seconds one agent changes its mind — starts
// working, asks for approval, finishes, breaks, spawns a helper, lets one go
// — so the room is alive without anything behind it. The step is pure and
// seeded in the tests; the hook rolls real dice.

import { useEffect, useState } from "react"
import type { Agent, AgentStatus } from "~/lib/agents"
import { demoAgents } from "./demo-agents"

/** How often the pretend runtime does something. */
export const DEMO_STEP_MS = 3_500
/** The room stops growing here: enough to fill the desks, not the aisles. */
export const DEMO_MAX_AGENTS = 14
/** How many helpers one agent will spawn before it stops asking for more. */
const MAX_CHILDREN = 2

export interface DemoWorld {
  agents: Agent[]
  /** Runs up with every helper spawned, so ids never repeat within a session. */
  seq: number
}

const WORKING_LINES = [
  "Reading the diff",
  "Running the tests",
  "Searching the codebase",
  "Drafting a reply",
  "Comparing two approaches",
  "Writing the migration",
  "Checking the docs",
  "Summarising the thread",
]
const WAITING_LINES = [
  "Needs approval to run tests",
  "Waiting for a decision",
  "Can I delete the old branch?",
  "Which option do you want?",
]
const DONE_LINES = ["All checks passed", "Report ready", "Draft sent for review", "Migration applied"]
const ERROR_LINES = ["502 from the registry", "Timed out after 30 s", "Permission denied", "Rate limited"]
const HELPER_NAMES = ["Fetcher", "Linter", "Scout", "Runner", "Scribe", "Indexer", "Prober", "Sorter"]

const pick = <T,>(items: readonly T[], roll: () => number): T => items[Math.floor(roll() * items.length) % items.length]!

/** Where an agent goes from where it is, on this roll. */
function nextStatus(status: AgentStatus, roll: () => number): AgentStatus {
  const r = roll()
  switch (status) {
    case "idle":
      return "working"
    case "working":
      return r < 0.3 ? "waiting" : r < 0.75 ? "done" : r < 0.85 ? "error" : "working"
    case "waiting":
      return "working" // the approval came through
    case "done":
      return r < 0.7 ? "idle" : "working"
    case "error":
      return r < 0.8 ? "working" : "offline" // a retry, or it gave up
    case "offline":
      return r < 0.4 ? "idle" : "offline"
  }
}

function activityFor(status: AgentStatus, roll: () => number): string | undefined {
  switch (status) {
    case "working":
      return pick(WORKING_LINES, roll)
    case "waiting":
      return pick(WAITING_LINES, roll)
    case "done":
      return pick(DONE_LINES, roll)
    case "error":
      return pick(ERROR_LINES, roll)
    default:
      return undefined
  }
}

const descendantsOf = (id: string, agents: readonly Agent[]): Set<string> => {
  const gone = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const agent of agents) {
      if (agent.parentId !== undefined && gone.has(agent.parentId) && !gone.has(agent.id)) {
        gone.add(agent.id)
        grew = true
      }
    }
  }
  return gone
}

/**
 * One beat of the pretend runtime: one agent changes status, or a working
 * agent spawns a helper, or a finished helper is let go. Pure — the same
 * world and the same rolls give the same next world — and never mutates
 * what it is given.
 */
export function stepDemoWorld(world: DemoWorld, roll: () => number): DemoWorld {
  const { agents } = world
  if (agents.length === 0) return world
  const event = roll()

  // A helper that has finished goes home.
  if (event < 0.25) {
    const finished = agents.filter((agent) => agent.parentId !== undefined && (agent.status === "done" || agent.status === "idle"))
    if (finished.length > 0) {
      const gone = descendantsOf(pick(finished, roll).id, agents)
      return { ...world, agents: agents.filter((agent) => !gone.has(agent.id)) }
    }
  }

  // Someone busy asks for a hand.
  if (event < 0.4 && agents.length < DEMO_MAX_AGENTS) {
    const parents = agents.filter(
      (agent) => agent.status === "working" && agents.filter((child) => child.parentId === agent.id).length < MAX_CHILDREN,
    )
    if (parents.length > 0) {
      const parent = pick(parents, roll)
      const seq = world.seq + 1
      const helper: Agent = {
        id: `${parent.id}-helper-${seq}`,
        name: pick(HELPER_NAMES, roll),
        status: "working",
        activity: pick(WORKING_LINES, roll),
        parentId: parent.id,
      }
      // Beside its parent in the list, so siblings line up together.
      const at = agents.findIndex((agent) => agent.id === parent.id)
      return { seq, agents: [...agents.slice(0, at + 1), helper, ...agents.slice(at + 1)] }
    }
  }

  // Otherwise: one agent moves on.
  const agent = pick(agents, roll)
  const status = nextStatus(agent.status, roll)
  const activity = activityFor(status, roll)
  const next: Agent = { ...agent, status }
  if (activity === undefined) delete next.activity
  else next.activity = activity
  return { ...world, agents: agents.map((candidate) => (candidate === agent ? next : candidate)) }
}

export function initialDemoWorld(): DemoWorld {
  return { agents: demoAgents(), seq: 0 }
}

/** The demo's agents, changing on their own while `running`. */
export function useDemoRuntime(running: boolean): Agent[] {
  const [world, setWorld] = useState<DemoWorld>(initialDemoWorld)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setWorld((current) => stepDemoWorld(current, Math.random)), DEMO_STEP_MS)
    return () => window.clearInterval(id)
  }, [running])
  return world.agents
}
