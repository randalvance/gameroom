import { describe, expect, it } from "vitest"
import type { TeamDTO } from "./event-types"
import { projectGameRoomMenuData, projectGameRoomMenuIdentity, teamRosterFor } from "./game-room-menu"

const teams: TeamDTO[] = [{
  id: "team-1",
  name: "TEAM ALPHA",
  players: [
    { id: "student-1", name: "Ada", role: "student", spriteId: 4, spriteSheet: null },
    { id: "student-2", name: "Lin", role: "student", spriteId: null, spriteSheet: null },
  ],
}]

describe("projectGameRoomMenuData", () => {
  it("shows a student's team and excludes them from teammates", () => {
    const result = projectGameRoomMenuData({
      userId: "student-1", role: "student",
      me: { id: "student-1", name: "Ada Mirror", role: "student", spriteId: 4, spriteSheet: null, teamName: "TEAM ALPHA" },
      teams, mentors: [],
    })
    expect(result.me).toMatchObject({ id: "student-1", name: "Ada", teamName: "TEAM ALPHA", playerIdx: 0, teamIdx: 0 })
    expect(result.peers.map((person) => person.id)).toEqual(["student-2"])
  })

  it("shows other linked mentors and excludes the signed-in mentor", () => {
    const result = projectGameRoomMenuData({
      userId: "mentor-1", role: "mentor",
      me: { id: "mentor-1", name: "Grace", role: "mentor", spriteId: 8, spriteSheet: null, teamName: null },
      teams,
      mentors: [
        { id: "mentor-1", name: "Grace", role: "mentor", spriteId: 8, spriteSheet: null, teamName: null },
        { id: "mentor-2", name: "Edsger", role: "mentor", spriteId: null, spriteSheet: "sheet", teamName: null },
      ],
    })
    expect(result.me).toMatchObject({ id: "mentor-1", role: "mentor", teamName: null })
    expect(result.peers.map((person) => person.id)).toEqual(["mentor-2"])
  })

  it("falls back to the id and returns no peers for an unassigned non-participant", () => {
    const result = projectGameRoomMenuData({
      userId: "judge-1", role: "judge",
      me: { id: "judge-1", name: "", role: "judge", spriteId: null, spriteSheet: null, teamName: null },
      teams, mentors: [],
    })
    expect(result.me.name).toBe("judge-1")
    expect(result.peers).toEqual([])
  })
})

describe("projectGameRoomMenuIdentity", () => {
  it("ignores a username and falls back to the stable user id", () => {
    const source = {
      id: "mentor-1",
      displayName: null,
      directoryName: null,
      username: "private-handle",
      role: "mentor" as const,
      spriteId: null,
      spriteSheet: null,
      teamName: null,
    }

    expect(projectGameRoomMenuIdentity(source)).toEqual({
      id: "mentor-1",
      name: "mentor-1",
      role: "mentor",
      spriteId: null,
      spriteSheet: null,
      teamName: null,
    })
  })

  it("prefers a public display name and then a directory name", () => {
    const base = {
      id: "mentor-1",
      role: "mentor" as const,
      spriteId: null,
      spriteSheet: null,
      teamName: null,
    }

    expect(projectGameRoomMenuIdentity({
      ...base,
      displayName: "Grace Hopper",
      directoryName: "Directory Grace",
    }).name).toBe("Grace Hopper")
    expect(projectGameRoomMenuIdentity({
      ...base,
      displayName: null,
      directoryName: "Directory Grace",
    }).name).toBe("Directory Grace")
  })
})

describe("teamRosterFor", () => {
  const teams: TeamDTO[] = [
    { id: "t0", name: "ALPHA", players: [
      { id: "a0", name: "Ada", role: "student", spriteId: null, spriteSheet: null },
      { id: "a1", name: "Ben", role: "student", spriteId: null, spriteSheet: null },
    ] },
    { id: "t1", name: "BETA", players: [
      { id: "b0", name: "Cai", role: "mentor", spriteId: 4, spriteSheet: null },
    ] },
  ]

  it("names the team every member belongs to", () => {
    expect(teamRosterFor(teams, 1).map((p) => p.teamName)).toEqual(["BETA"])
  })

  // resolveSprite hashes an unassigned player on their index across EVERY
  // team, so BETA's first member is playerIdx 2 — the same character the room
  // stands at the desk. A per-team index would draw somebody else.
  it("carries each member's index across all teams, not their seat", () => {
    expect(teamRosterFor(teams, 1)[0]?.playerIdx).toBe(2)
    expect(teamRosterFor(teams, 0).map((p) => p.playerIdx)).toEqual([0, 1])
  })

  it("keeps the sprite and role the roster gave them", () => {
    const cai = teamRosterFor(teams, 1)[0]!
    expect(cai.spriteId).toBe(4)
    expect(cai.role).toBe("mentor")
  })

  it("is empty for a desk with no team behind it", () => {
    expect(teamRosterFor(teams, 7)).toEqual([])
  })
})
