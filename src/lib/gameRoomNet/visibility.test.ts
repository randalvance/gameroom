// Who a game-room viewer may see before the doors open: their own team and
// the staff, nobody else. One rule for the hub (which frames reach a
// connection) and the room's loader (which desks are drawn populated), so
// the two cannot disagree about who is in the room.
import { describe, expect, it } from "vitest"
import type { TeamDTO } from "~/lib/event-types"
import { inRoomScope, roomScopeFor, scopeTeams, scopeTeamsForViewer, unseatedScope } from "./visibility"

const TEAMS: TeamDTO[] = [
  {
    id: "team-a",
    name: "TEAM 01",
    players: [
      { id: "user-ada", name: "Ada Lovelace", spriteId: null, spriteSheet: null },
      { id: "user-bob", name: "Bob Tan", spriteId: null, spriteSheet: null },
    ],
  },
  {
    id: "team-b",
    name: "TEAM 02",
    players: [{ id: "user-cyn", name: "Cynthia Lee", spriteId: null, spriteSheet: null }],
  },
]

describe("roomScopeFor", () => {
  it("is the whole room for everyone once the doors are open", () => {
    expect(roomScopeFor({ role: "student", teamIdx: 1 }, false)).toBeNull()
    expect(roomScopeFor({ role: "admin", teamIdx: -1 }, false)).toBeNull()
    expect(roomScopeFor(null, false)).toBeNull()
  })

  it("is the whole room for staff before the doors open", () => {
    for (const role of ["admin", "mentor", "judge"] as const) {
      expect(roomScopeFor({ role, teamIdx: -1 }, true)).toBeNull()
    }
  })

  it("is a participant's own desk before the doors open, whatever their role says", () => {
    expect(roomScopeFor({ role: "student", teamIdx: 1 }, true)).toBe(1)
    // A seated participant whose role was never promoted is not staff.
    expect(roomScopeFor({ role: "viewer", teamIdx: 1 }, true)).toBe(1)
  })

  it("gives a deskless non-staff character a scope of their own", () => {
    expect(roomScopeFor({ role: "student", teamIdx: -1, idx: 4 }, true)).toBe(unseatedScope(4))
    expect(unseatedScope(4)).not.toBe(unseatedScope(5))
    expect(unseatedScope(0)).toBeLessThan(-1)
  })

  it("is the whole room for a deskless viewer — the big screen — before the doors open", () => {
    expect(roomScopeFor({ role: "viewer", teamIdx: -1, idx: 5 }, true)).toBeNull()
    expect(roomScopeFor({ role: "viewer", teamIdx: -1 }, true)).toBeNull()
  })

  it("leaves a viewer with no character, or no desk to find, the staff only", () => {
    expect(roomScopeFor({ role: "student", teamIdx: -1 }, true)).toBe(-1)
    expect(roomScopeFor(null, true)).toBe(-1)
  })
})

describe("inRoomScope", () => {
  const seated = (teamIdx: number) => ({ guest: false, teamIdx, role: "student" as const, idx: 0 })
  const visitor = (role: "admin" | "mentor" | "judge" | "student" | "viewer", idx = 7) =>
    ({ guest: true, teamIdx: -1, role, idx })

  it("lets the whole room through when there is no scope", () => {
    expect(inRoomScope(null, seated(0))).toBe(true)
    expect(inRoomScope(null, visitor("student"))).toBe(true)
  })

  it("lets teammates and staff through a team scope, and nobody else", () => {
    expect(inRoomScope(0, seated(0))).toBe(true)
    for (const role of ["admin", "mentor", "judge"] as const) expect(inRoomScope(0, visitor(role)), role).toBe(true)
    expect(inRoomScope(0, seated(1))).toBe(false)
  })

  it("keeps a deskless student or viewer out of every team's room", () => {
    for (const role of ["student", "viewer"] as const) {
      expect(inRoomScope(0, visitor(role)), role).toBe(false)
      expect(inRoomScope(-1, visitor(role)), role).toBe(false)
      // …and out of another deskless character's scope.
      expect(inRoomScope(unseatedScope(3), visitor(role, 7)), role).toBe(false)
    }
  })

  it("lets a deskless character see themselves and the staff", () => {
    const scope = unseatedScope(7)
    expect(inRoomScope(scope, visitor("student", 7))).toBe(true)
    expect(inRoomScope(scope, visitor("admin", 3))).toBe(true)
    expect(inRoomScope(scope, seated(0))).toBe(false)
  })
})

describe("scopeTeams", () => {
  it("returns the teams untouched when there is no scope", () => {
    expect(scopeTeams(TEAMS, null)).toBe(TEAMS)
  })

  it("empties every other team's desk but keeps the desks, in order", () => {
    // Desks are laid out by array position and the hub numbers characters
    // by the same order, so the other teams must stay as (empty) entries
    // rather than disappear.
    const scoped = scopeTeams(TEAMS, 1)
    expect(scoped.map((t) => t.name)).toEqual(["TEAM 01", "TEAM 02"])
    expect(scoped[0]!.players).toEqual([])
    expect(scoped[1]!.players).toEqual(TEAMS[1]!.players)
  })

  it("empties every desk for a viewer with no team", () => {
    expect(scopeTeams(TEAMS, -1).every((t) => t.players.length === 0)).toBe(true)
  })
})

describe("scopeTeamsForViewer", () => {
  it("finds a student's own desk by their id and scopes the teams to it", () => {
    const scoped = scopeTeamsForViewer(TEAMS, { userId: "user-cyn", role: "student" }, true)
    expect(scoped[0]!.players).toEqual([])
    expect(scoped[1]!.players.map((p) => p.id)).toEqual(["user-cyn"])
  })

  it("leaves a student with no desk an empty room", () => {
    const scoped = scopeTeamsForViewer(TEAMS, { userId: "user-nobody", role: "student" }, true)
    expect(scoped.every((t) => t.players.length === 0)).toBe(true)
  })

  it("gives the staff, and everyone after the doors open, the whole room", () => {
    expect(scopeTeamsForViewer(TEAMS, { userId: "user-admin", role: "admin" }, true)).toBe(TEAMS)
    expect(scopeTeamsForViewer(TEAMS, { userId: "user-screen", role: "viewer" }, true)).toBe(TEAMS)
    expect(scopeTeamsForViewer(TEAMS, { userId: "user-cyn", role: "student" }, false)).toBe(TEAMS)
  })
})
