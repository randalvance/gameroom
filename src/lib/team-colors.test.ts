import { describe, expect, it } from "vitest"
import { PARTICIPANT_TABLES } from "../components/gameRoom/constants"
import { TEAM_COLORS, teamColor } from "./team-colors"

describe("teamColor", () => {
  it("gives TEAM_nn the nn-th colour of the palette", () => {
    expect(teamColor("TEAM_01")).toBe(TEAM_COLORS[0])
    expect(teamColor("TEAM_10")).toBe(TEAM_COLORS[9])
  })

  it("reads a space as readily as an underscore", () => {
    expect(teamColor("TEAM 03")).toBe(teamColor("TEAM_03"))
  })

  it("hands the same label the same colour every time", () => {
    // The whole point of a fixed assignment: the projector, the wall screen
    // and the desk must agree on which team is which colour, and none of them
    // may re-cycle the palette as the standings move.
    const once = teamColor("Nasi Lemak Capital")
    expect(teamColor("Nasi Lemak Capital")).toBe(once)
  })

  it("never lands outside the palette, whatever the label", () => {
    const labels = ["", "TEAM_00", "TEAM_11", "BOT", "team_7", "…", "TEAM_-1"]
    for (const label of labels) {
      expect(TEAM_COLORS).toContain(teamColor(label))
    }
  })

  it("separates the full field — one colour per desk in the room", () => {
    const codes = Array.from({ length: 13 }, (_, i) => `TEAM_${String(i + 1).padStart(2, "0")}`)
    expect(new Set(codes.map(teamColor)).size).toBe(13)
    // The regression (#513): the eleventh and twelfth used to wrap onto the
    // first and second, so two pairs of teams shared a colour on the wall.
    // The thirteenth desk brought the same trap with it.
    expect(teamColor("TEAM_11")).not.toBe(teamColor("TEAM_01"))
    expect(teamColor("TEAM_12")).not.toBe(teamColor("TEAM_02"))
    expect(teamColor("TEAM_13")).not.toBe(teamColor("TEAM_01"))
  })

  it("has a colour for every desk the room lays out", () => {
    // The palette and the room plan have to grow together: a desk with no
    // colour of its own wears another team's, which is the #513 bug again.
    expect(TEAM_COLORS.length).toBeGreaterThanOrEqual(PARTICIPANT_TABLES.length)
  })

  it("keeps the established teams' colours as they were", () => {
    // Extending the palette must not repaint anyone: the swatch a team has
    // worn on every screen since registration is part of its identity.
    expect(TEAM_COLORS.slice(0, 12)).toEqual([
      "#B98E12", "#4390D1", "#E15554", "#35A167", "#D163B6",
      "#10A294", "#D0782F", "#9A6FD0", "#7F9615", "#6272E0",
      "#059CBB", "#D56188",
    ])
  })
})
