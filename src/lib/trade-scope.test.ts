import { describe, expect, it } from "vitest"
import { tradeScopeFor } from "./trade-scope"

describe("tradeScopeFor", () => {
  describe("student", () => {
    it("scopes the tape to the seat they hold", () => {
      expect(tradeScopeFor({ role: "student", membershipTeamId: "team-a" }))
        .toEqual({ kind: "team", teamId: "team-a" })
    })

    it("shows nothing before they are linked to a team", () => {
      expect(tradeScopeFor({ role: "student", membershipTeamId: null }))
        .toEqual({ kind: "none" })
    })

    // The acting team is a CLIENT-supplied value. Honouring it for a student
    // would let one team read another's tape by asking for its id.
    it("ignores an acting team the client asked for", () => {
      expect(tradeScopeFor({ role: "student", membershipTeamId: "team-a", actingTeamId: "team-b" }))
        .toEqual({ kind: "team", teamId: "team-a" })
    })

    it("still shows nothing when an unlinked student asks for a team", () => {
      expect(tradeScopeFor({ role: "student", membershipTeamId: null, actingTeamId: "team-b" }))
        .toEqual({ kind: "none" })
    })
  })

  describe("admin", () => {
    it("follows the team switcher, so the tape matches orders and positions", () => {
      expect(tradeScopeFor({ role: "admin", membershipTeamId: null, actingTeamId: "team-b" }))
        .toEqual({ kind: "team", teamId: "team-b" })
    })

    it("shows the whole market when no team is selected", () => {
      expect(tradeScopeFor({ role: "admin", membershipTeamId: null })).toEqual({ kind: "all" })
      expect(tradeScopeFor({ role: "admin", membershipTeamId: null, actingTeamId: "" }))
        .toEqual({ kind: "all" })
    })
  })

  // Unfiltered by ROLE, not by absence of a team: a mentor who happens to hold
  // a seat must not be silently narrowed to it.
  describe.each(["mentor", "judge", "viewer"] as const)("%s", (role) => {
    it("sees the whole market", () => {
      expect(tradeScopeFor({ role, membershipTeamId: null })).toEqual({ kind: "all" })
    })

    it("sees the whole market even holding a seat or naming a team", () => {
      expect(tradeScopeFor({ role, membershipTeamId: "team-a", actingTeamId: "team-b" }))
        .toEqual({ kind: "all" })
    })
  })
})
