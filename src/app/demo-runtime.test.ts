import { describe, expect, it } from "vitest"
import { AGENT_STATUSES, type Agent } from "~/lib/agents"
import { DEMO_MAX_AGENTS, initialDemoWorld, stepDemoWorld, type DemoWorld } from "./demo-runtime"

/** A seeded roll, so a run is the same run every time. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function expectWellFormed(agents: readonly Agent[]) {
  const ids = new Set(agents.map((agent) => agent.id))
  expect(ids.size).toBe(agents.length)
  for (const agent of agents) {
    expect(AGENT_STATUSES).toContain(agent.status)
    if (agent.parentId !== undefined) expect(ids.has(agent.parentId)).toBe(true)
  }
}

describe("stepDemoWorld", () => {
  it("keeps the room well formed and bounded over a long run", () => {
    const roll = seeded(7)
    let world = initialDemoWorld()
    let peak = 0
    for (let i = 0; i < 2_000; i++) {
      world = stepDemoWorld(world, roll)
      expectWellFormed(world.agents)
      expect(world.agents.length).toBeLessThanOrEqual(DEMO_MAX_AGENTS)
      peak = Math.max(peak, world.agents.length)
    }
    // Helpers came and went: the room grew past its starting eight at some point.
    expect(peak).toBeGreaterThan(8)
  })

  it("is deterministic for the same rolls, and never mutates its input", () => {
    const start = initialDemoWorld()
    const snapshot = JSON.stringify(start)
    const a = stepDemoWorld(stepDemoWorld(start, seeded(3)), seeded(4))
    const b = stepDemoWorld(stepDemoWorld(start, seeded(3)), seeded(4))
    expect(a).toEqual(b)
    expect(JSON.stringify(start)).toBe(snapshot)
  })

  it("visits every status given enough time", () => {
    const roll = seeded(11)
    let world = initialDemoWorld()
    const seen = new Set<string>()
    for (let i = 0; i < 1_000; i++) {
      world = stepDemoWorld(world, roll)
      for (const agent of world.agents) seen.add(agent.status)
    }
    expect([...seen].sort()).toEqual([...AGENT_STATUSES].sort())
  })

  it("puts a new helper right behind its parent, and lets a finished one go with its own helpers", () => {
    // Force the spawn branch: the first roll picks the event, the rest pick
    // the parent and its words.
    const rolls = [0.3, 0, 0, 0]
    const world: DemoWorld = { agents: [{ id: "a", name: "A", status: "working" }, { id: "b", name: "B", status: "idle" }], seq: 0 }
    const spawned = stepDemoWorld(world, () => rolls.shift() ?? 0)
    expect(spawned.agents.map((agent) => agent.id)).toEqual(["a", "a-helper-1", "b"])
    expect(spawned.agents[1]).toMatchObject({ parentId: "a", status: "working" })
    expect(spawned.seq).toBe(1)

    // A helper that is done, with a helper of its own, retires with it.
    const nested: DemoWorld = {
      agents: [
        { id: "a", name: "A", status: "working" },
        { id: "h", name: "H", status: "done", parentId: "a" },
        { id: "hh", name: "HH", status: "working", parentId: "h" },
      ],
      seq: 2,
    }
    const retired = stepDemoWorld(nested, () => 0)
    expect(retired.agents.map((agent) => agent.id)).toEqual(["a"])
  })

  it("leaves an empty room alone", () => {
    const world: DemoWorld = { agents: [], seq: 0 }
    expect(stepDemoWorld(world, seeded(1))).toBe(world)
  })
})
