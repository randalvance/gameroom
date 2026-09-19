// Pins the trading authorization rule. Before this existed, `teamCode` came
// straight from the client and was checked only for existence — any student
// could trade as any team. These cases are the regression guard.
import { describe, expect, it } from "vitest"
import { assertTeamAccess } from "./team-access"

function status(fn: () => void): number | "no-throw" {
  try {
    fn()
    return "no-throw"
  } catch (e) {
    if (e instanceof Response) return e.status
    throw e
  }
}

describe("assertTeamAccess", () => {
  it("lets a student act for the team they hold a seat on", () => {
    expect(status(() => assertTeamAccess("student", "TEAM_03", "TEAM_03"))).toBe("no-throw")
  })

  it("refuses a student acting for another team", () => {
    expect(status(() => assertTeamAccess("student", "TEAM_03", "TEAM_07"))).toBe(403)
  })

  it("refuses a student who holds no seat — rosters are organizer-assigned", () => {
    expect(status(() => assertTeamAccess("student", null, "TEAM_01"))).toBe(403)
  })

  it("lets an admin act for any team, seat or not", () => {
    expect(status(() => assertTeamAccess("admin", null, "TEAM_09"))).toBe("no-throw")
    expect(status(() => assertTeamAccess("admin", "TEAM_01", "TEAM_09"))).toBe("no-throw")
  })

  it.each(["viewer", "mentor", "judge"] as const)(
    "refuses %s outright — trading is students only",
    (role) => {
      expect(status(() => assertTeamAccess(role, null, "TEAM_01"))).toBe(403)
      // Even if a seat somehow existed for them.
      expect(status(() => assertTeamAccess(role, "TEAM_01", "TEAM_01"))).toBe(403)
    },
  )

  it("does not treat a team code as a prefix or substring match", () => {
    expect(status(() => assertTeamAccess("student", "TEAM_01", "TEAM_010"))).toBe(403)
    expect(status(() => assertTeamAccess("student", "TEAM_1", "TEAM_01"))).toBe(403)
  })
})
