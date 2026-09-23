import { describe, expect, it } from "vitest"
import {
  buildAllPlayers,
  resolveSelectedPlayerIndex,
  type TeamDTO,
} from "./event-types"

describe("participant identity", () => {
  it("derives seatIdx from array position", () => {
    const teams: TeamDTO[] = [{
      id: "TEAM_01", name: "TEAM 01",
      players: [
        { id: "user_a", name: "Alex", spriteId: null, spriteSheet: null },
        { id: "user_b", name: "Blair", spriteId: null, spriteSheet: null },
      ],
    }]
    expect(buildAllPlayers(teams)[0]).toMatchObject({ id: "user_a", seatIdx: 0, teamIdx: 0 })
    expect(buildAllPlayers(teams)[1]).toMatchObject({ id: "user_b", seatIdx: 1, teamIdx: 0 })
  })

  it("resolves mentor selection within a non-five-person roster", () => {
    const teams: TeamDTO[] = [
      {
        id: "TEAM_01", name: "TEAM 01",
        players: [
          { id: "user_11", name: "A", spriteId: null, spriteSheet: null },
          { id: "user_12", name: "B", spriteId: null, spriteSheet: null },
        ],
      },
      {
        id: "TEAM_02", name: "TEAM 02",
        players: [
          { id: "user_21", name: "C", spriteId: null, spriteSheet: null },
          { id: "user_22", name: "D", spriteId: null, spriteSheet: null },
          { id: "user_23", name: "E", spriteId: null, spriteSheet: null },
        ],
      },
    ]
    const allPlayers = buildAllPlayers(teams)

    expect(resolveSelectedPlayerIndex(allPlayers, teams[1], 2)).toBe(4)
    expect(resolveSelectedPlayerIndex(allPlayers, teams[1], 3)).toBe(-1)
  })
})

// The optimistic update has to replace the SAME mentor's earlier vote and
// nobody else's. Matching on the display name would merge two mentors who
// happen to share one — the class of bug this whole change removes.
