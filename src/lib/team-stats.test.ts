import { describe, expect, it } from "vitest"
import type { ExLeaderboardRow } from "./exchange-types"
import { teamStatsFor } from "./team-stats"

const ROWS: ExLeaderboardRow[] = [
  { label: "TEAM 02", teamId: "t2", totalValue: 10500, totalPnL: 500 },
  { label: "TEAM 01", teamId: "t1", totalValue: 10120, totalPnL: 120 },
  { label: "TEAM 03", teamId: "t3", totalValue: 9800, totalPnL: -200 },
]

describe("teamStatsFor", () => {
  it("ranks by position in the already-sorted list", () => {
    expect(teamStatsFor(ROWS, "t1")).toEqual({ rank: 2, totalValue: 10120, totalPnL: 120 })
  })

  it("gives the leader rank 1", () => {
    expect(teamStatsFor(ROWS, "t2")?.rank).toBe(1)
  })

  it("keeps a losing team's negative P&L", () => {
    expect(teamStatsFor(ROWS, "t3")?.totalPnL).toBe(-200)
  })

  it("returns null for a team with no row this window", () => {
    expect(teamStatsFor(ROWS, "nope")).toBeNull()
  })

  it("returns null when there is no window at all", () => {
    expect(teamStatsFor([], "t1")).toBeNull()
  })
})
