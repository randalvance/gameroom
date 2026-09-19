import { describe, expect, it } from "vitest"
import { CH, CW, PARTICIPANT_TABLES, WALL_Y } from "../gameRoom/constants"
import {
  EMPTY_TABLE_LABEL,
  isExhibitionDesk,
  tableHasTeam,
  tableLegColorForCompetition,
  tableLabelText,
  tableTopColorForCompetition,
} from "./team-tables"

/** What staging had when the drops went missing: four teams, ten desks. */
const TEAMS = ["TEAM_01", "TEAM_02", "TEAM_03", "TEAM_04"]

describe("team tables", () => {
  it("marks only exhibition team desks for a special accent", () => {
    expect(isExhibitionDesk(1, [true, false])).toBe(true)
    expect(isExhibitionDesk(0, [true, false])).toBe(false)
    expect(isExhibitionDesk(0)).toBe(false)
    expect(isExhibitionDesk(-1, [false])).toBe(false)
  })

  it("uses a warm-white tabletop only for exhibition teams", () => {
    expect(tableTopColorForCompetition(false)).toBe(0xf4f3ea)
    expect(tableTopColorForCompetition(true)).toBe(0xd8c8a6)
    expect(tableTopColorForCompetition()).toBe(0xd8c8a6)
  })

  it("uses a pale leg finish only for exhibition teams", () => {
    expect(tableLegColorForCompetition(false)).toBe(0xdeddd6)
    expect(tableLegColorForCompetition(true)).toBe(0x8b7f66)
    expect(tableLegColorForCompetition()).toBe(0x8b7f66)
  })

  it("counts a desk as a team only while the roster has one for it", () => {
    expect(tableHasTeam(0, TEAMS.length)).toBe(true)
    expect(tableHasTeam(3, TEAMS.length)).toBe(true)
    expect(tableHasTeam(4, TEAMS.length)).toBe(false)
    expect(tableHasTeam(9, TEAMS.length)).toBe(false)
    expect(tableHasTeam(-1, TEAMS.length)).toBe(false)
  })

  // CODE2IMPACT2026-16: staging had more teams than the room has desks. The
  // presentation spotlight landed on a team past the last desk, this said yes,
  // and the scene read `.x` off PARTICIPANT_TABLES[13].
  it("has no team behind a desk the room does not have, however big the roster", () => {
    const last = PARTICIPANT_TABLES.length - 1
    const roster = PARTICIPANT_TABLES.length + 5
    expect(tableHasTeam(last, roster)).toBe(true)
    expect(tableHasTeam(last + 1, roster)).toBe(false)
    expect(tableHasTeam(roster - 1, roster)).toBe(false)
  })

  it("leaves the room's spare desks teamless when the event is smaller", () => {
    // The room lays out its desks whatever the roster looks like, so there are
    // always spares to get this wrong about.
    const spares = PARTICIPANT_TABLES.filter((_, i) => !tableHasTeam(i, TEAMS.length))
    expect(spares.length).toBe(PARTICIPANT_TABLES.length - TEAMS.length)
    expect(spares.length).toBeGreaterThan(0)
  })

  it("never invents a team name for a desk that has none", () => {
    // The bug wore a "TEAM 5" label, which is why dropping there looked fine.
    for (const idx of [4, 7, 9]) {
      const label = tableLabelText(idx, TEAMS, { count: 0, showCount: true })
      expect(label).toBe(EMPTY_TABLE_LABEL)
      expect(label).not.toMatch(/TEAM[ _]?\d/)
    }
  })

  it("never puts a headcount on an unused desk", () => {
    // "(0)" would read as a real team nobody has joined yet.
    expect(tableLabelText(6, TEAMS, { count: 0, showCount: true })).not.toContain("(")
  })

  it("keeps a real team's name, and its headcount while assigning", () => {
    expect(tableLabelText(0, TEAMS, { count: 4, showCount: true })).toBe("TEAM_01 (4)")
    expect(tableLabelText(0, TEAMS, { count: 4, showCount: false })).toBe("TEAM_01")
    expect(tableLabelText(3, TEAMS, { showCount: true })).toBe("TEAM_04 (0)")
  })

  it("treats a gap in the team list as no team rather than an empty name", () => {
    const ragged = ["TEAM_01", undefined as unknown as string, "TEAM_03"]
    expect(tableLabelText(1, ragged, { showCount: true })).toBe(EMPTY_TABLE_LABEL)
  })
})

describe("the room's desk grid", () => {
  it("offers thirteen desks on an even grid, inside the room", () => {
    expect(PARTICIPANT_TABLES.length).toBe(13)

    const rowYs = [...new Set(PARTICIPANT_TABLES.map((t) => t.y))].sort((a, b) => a - b)
    const colXs = [...new Set(PARTICIPANT_TABLES.map((t) => t.x))].sort((a, b) => a - b)
    expect(rowYs.length).toBe(3)
    expect(colXs.length).toBe(5)

    // Even aisles: every gap between neighbouring rows (and columns) matches.
    const gaps = (vs: number[]) => vs.slice(1).map((v, i) => v - vs[i]!)
    expect(new Set(gaps(rowYs)).size).toBe(1)
    expect(new Set(gaps(colXs)).size).toBe(1)

    // Thirteen does not divide into the grid, so the rows fill row-major and
    // the last one is short — full rows first, never a gap in the middle.
    const perRow = rowYs.map((y) => PARTICIPANT_TABLES.filter((t) => t.y === y).length)
    expect(perRow).toEqual([5, 5, 3])
    // Every desk sits on a column of the same grid, short row included.
    for (const t of PARTICIPANT_TABLES) expect(colXs).toContain(t.x)

    // The desks stop short of the south end, and that clear band is the
    // room's open floor where visitors arrive. Its exact depth is a look
    // decision that has changed more than once; what must hold is that it is
    // real standing room rather than a margin. How much of it the arrivals
    // band needs is asserted where that band is defined, in the hub.
    const lastDeskBottom = Math.max(...PARTICIPANT_TABLES.map((t) => t.y + t.h))
    expect(CH - lastDeskBottom).toBeGreaterThan(PARTICIPANT_TABLES[0]!.h * 2)
    for (const t of PARTICIPANT_TABLES) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(CW)
      expect(t.y).toBeGreaterThan(WALL_Y)
      expect(t.y + t.h).toBeLessThanOrEqual(CH)
    }
  })

  it("leaves a walking lane between neighbouring desks", () => {
    // Chairs sit 3.3 world units (52.8px) off a desk's centre, so desks pitched
    // tighter than their own width plus two chairs would box the cast in.
    const CHAIR_REACH_PX = 60
    const colXs = [...new Set(PARTICIPANT_TABLES.map((t) => t.x))].sort((a, b) => a - b)
    const pitch = colXs[1]! - colXs[0]!
    const deskWidth = PARTICIPANT_TABLES[0]!.w
    expect(pitch - deskWidth).toBeGreaterThan(2 * (CHAIR_REACH_PX - deskWidth / 2))
  })

  it("keeps desk index order row-major, so existing teams keep their desks", () => {
    // Team idx maps straight onto desk idx: the desks must read left to right
    // along each row, top row first, so a team never jumps rows behind a
    // later layout change.
    for (let i = 1; i < PARTICIPANT_TABLES.length; i++) {
      const prev = PARTICIPANT_TABLES[i - 1]!
      const next = PARTICIPANT_TABLES[i]!
      expect(next.y > prev.y || (next.y === prev.y && next.x > prev.x)).toBe(true)
    }
  })
})

describe("the strip under the wall screen", () => {
  // The judges' desks used to stand here. Nothing does now, and the screen's
  // interact point lives in the middle of it — so the first row of desks has
  // to keep its distance or a player cannot back up far enough to see the
  // screen they are standing under.
  it("keeps the first row of desks off the front wall", () => {
    expect(Math.min(...PARTICIPANT_TABLES.map((t) => t.y))).toBeGreaterThan(140)
  })
})
