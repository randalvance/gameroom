import { describe, expect, it } from "vitest"
import {
  agentBoardSummary,
  bubbleTextFor,
  countByStatus,
  DEFAULT_STATUS_STYLES,
  effectiveStatus,
  hashAgentId,
  styleFor,
  type Agent,
} from "./agents"

const agent = (id: string, status: Agent["status"], over: Partial<Agent> = {}): Agent => ({ id, name: id, status, ...over })

describe("styleFor", () => {
  it("returns the defaults untouched when nothing is overridden", () => {
    expect(styleFor("working")).toBe(DEFAULT_STATUS_STYLES.working)
    expect(styleFor("working", {})).toBe(DEFAULT_STATUS_STYLES.working)
  })

  it("lays a host's overrides over the defaults, field by field", () => {
    const style = styleFor("waiting", { waiting: { bubble: "Needs approval", pulse: false } })
    expect(style).toEqual({ ...DEFAULT_STATUS_STYLES.waiting, bubble: "Needs approval", pulse: false })
  })

  it("lets null hide a bubble or a halo, which undefined does not", () => {
    expect(styleFor("working", { working: { bubble: null } }).bubble).toBeNull()
    expect(styleFor("working", { working: { bubble: undefined } }).bubble).toBe("Working…")
    expect(styleFor("idle", { idle: { halo: null } }).halo).toBeNull()
  })
})

describe("bubbleTextFor", () => {
  it("prefers the agent's activity over the status line", () => {
    expect(bubbleTextFor({ activity: "Reading the diff" }, DEFAULT_STATUS_STYLES.working)).toBe("Reading the diff")
    expect(bubbleTextFor({ activity: "  " }, DEFAULT_STATUS_STYLES.working)).toBe("Working…")
    expect(bubbleTextFor({}, DEFAULT_STATUS_STYLES.idle)).toBeNull()
  })
})

describe("effectiveStatus", () => {
  it("is the agent's own status with no children", () => {
    const agents = [agent("a", "waiting")]
    expect(effectiveStatus(agents[0]!, agents)).toBe("waiting")
  })

  it("is working when any descendant is working", () => {
    const agents = [
      agent("a", "idle"),
      agent("b", "idle", { parentId: "a" }),
      agent("c", "working", { parentId: "b" }),
    ]
    expect(effectiveStatus(agents[0]!, agents)).toBe("working")
    expect(effectiveStatus(agents[1]!, agents)).toBe("working")
    expect(effectiveStatus(agents[2]!, agents)).toBe("working")
  })

  it("leaves other statuses alone", () => {
    const agents = [agent("a", "waiting"), agent("b", "error", { parentId: "a" })]
    expect(effectiveStatus(agents[0]!, agents)).toBe("waiting")
  })

  it("survives a cycle", () => {
    const agents = [agent("a", "idle", { parentId: "b" }), agent("b", "idle", { parentId: "a" })]
    expect(effectiveStatus(agents[0]!, agents)).toBe("idle")
  })
})

describe("the board summary", () => {
  it("counts by effective status", () => {
    const agents = [
      agent("a", "idle"),
      agent("b", "working", { parentId: "a" }),
      agent("c", "waiting"),
      agent("d", "error"),
    ]
    expect(countByStatus(agents)).toEqual({ idle: 0, working: 2, waiting: 1, done: 0, error: 1, offline: 0 })
    expect(agentBoardSummary(agents)).toEqual({
      title: "4 AGENTS",
      lines: ["2 WORKING · 1 WAITING FOR YOU · 1 IN TROUBLE", "0 IDLE"],
    })
  })

  it("says so for an empty room", () => {
    expect(agentBoardSummary([])).toEqual({ title: "0 AGENTS", lines: ["NO AGENTS IN THE ROOM"] })
  })

  it("keeps the quiet lines short", () => {
    expect(agentBoardSummary([agent("a", "idle")])).toEqual({ title: "1 AGENT", lines: ["0 WORKING", "1 IDLE"] })
  })
})

describe("hashAgentId", () => {
  it("is stable and spreads", () => {
    expect(hashAgentId("agent-1")).toBe(hashAgentId("agent-1"))
    expect(hashAgentId("agent-1")).not.toBe(hashAgentId("agent-2"))
    expect(hashAgentId("")).toBe(0x811c9dc5)
  })
})
