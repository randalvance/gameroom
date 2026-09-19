import { describe, expect, it } from "vitest"
import type { ExLeaderboardRow } from "./exchange-types"
import { teamRanksByIndex, teamRanksById } from "./team-ranks"

const row = (teamId: string, totalPnL: number): ExLeaderboardRow => ({
  label: teamId,
  teamId,
  totalValue: 100000 + totalPnL,
  totalPnL,
})

describe("team ranks", () => {
  it("ranks by P&L, best first", () => {
    const ranks = teamRanksById([row("a", -50), row("b", 900), row("c", 120)])
    expect(ranks.get("b")).toBe(1)
    expect(ranks.get("c")).toBe(2)
    expect(ranks.get("a")).toBe(3)
  })

  it("does not trust the wire order", () => {
    // The server sorts today. A leaderboard that arrives unsorted (or from a
    // cache, or a different endpoint) must not silently renumber the room.
    const ranks = teamRanksById([row("a", 10), row("b", 900)])
    expect(ranks.get("b")).toBe(1)
  })

  it("shares a placing between ties and skips the placings they used up", () => {
    // Standard competition ranking: two firsts, then third. Two desks wearing
    // a 1 is the truth; calling one of them 2 on a tiebreak nobody agreed is
    // not.
    const ranks = teamRanksById([row("a", 500), row("b", 500), row("c", 10)])
    expect(ranks.get("a")).toBe(1)
    expect(ranks.get("b")).toBe(1)
    expect(ranks.get("c")).toBe(3)
  })

  it("gives every team a placing before trading opens, when nobody has moved", () => {
    const ranks = teamRanksById([row("a", 0), row("b", 0)])
    expect(ranks.get("a")).toBe(1)
    expect(ranks.get("b")).toBe(1)
  })

  it("has nothing to say about an empty leaderboard", () => {
    expect(teamRanksById([]).size).toBe(0)
  })

  it("maps onto the room's desk order by team id", () => {
    const teams = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const ranks = teamRanksByIndex(teams, [row("a", -50), row("b", 900), row("c", 120)])
    expect(ranks).toEqual([3, 1, 2])
  })

  it("leaves a team the exchange has never heard of unranked, not last", () => {
    // A team registered on the web but with no exchange result yet has no
    // placing at all — a numeral there would be a claim about a team that has
    // not traded.
    const teams = [{ id: "a" }, { id: "unregistered" }]
    expect(teamRanksByIndex(teams, [row("a", 10)])).toEqual([1, null])
  })

  it("ignores exchange accounts with no desk in this room", () => {
    const ranks = teamRanksByIndex([{ id: "a" }], [row("bot-1", 9000), row("a", 10)])
    // The bot still occupies first place on the real leaderboard: the room
    // reports placings, it does not recompute them from who is standing in it.
    expect(ranks).toEqual([2])
  })
})
