import { describe, expect, it } from "vitest"
import {
  isDeskDone,
  ordinal,
  parseDoneInput,
  parseSpotlightInput,
  presentationBoard,
  presentationSlotsByTeamIdx,
  REVEAL_LEAD_MS,
  REVEAL_STEP_MS,
  REVEAL_TAIL_MS,
  houseDimGoal,
  revealDurationMs,
  revealProgress,
  SPOT_OUT_LEVEL,
  roomPresentation,
  shuffleTeams,
  type PresentationState,
} from "./presentation-order"

const TEAMS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

const state = (over: Partial<PresentationState> = {}): PresentationState => ({
  order: ["c", "a", "d", "b"],
  revealedAt: 1_000_000,
  nonce: 1,
  spotlight: null,
  ...over,
})

describe("shuffleTeams", () => {
  it("is a permutation of the teams — nobody dropped, nobody twice", () => {
    const order = shuffleTeams(TEAMS)
    expect([...order].sort()).toEqual(["a", "b", "c", "d"])
  })

  it("is driven by the injected random source", () => {
    // Every draw picks index 0: each step swaps the current tail with the
    // head, so the first element walks down the list.
    expect(shuffleTeams(TEAMS, () => 0)).toEqual(["b", "c", "d", "a"])
    // Every draw picks the tail itself: nothing moves.
    expect(shuffleTeams(TEAMS, () => 0.999)).toEqual(["a", "b", "c", "d"])
  })

  it("does not touch the input", () => {
    const teams = [{ id: "x" }, { id: "y" }]
    shuffleTeams(teams, () => 0)
    expect(teams.map((t) => t.id)).toEqual(["x", "y"])
  })
})

describe("revealProgress", () => {
  // The room is dark and nothing is up until the lead-in has passed — the
  // house lights going down IS the cue that something is about to happen.
  it("shows nothing during the lead-in", () => {
    const at = state().revealedAt + REVEAL_LEAD_MS - 1
    expect(revealProgress(state(), at)).toEqual({ revealed: 0, sweepSlot: null, dark: true, done: false })
  })

  it("lands the spotlight on one slot at a time, first presenter first", () => {
    const s = state()
    const first = s.revealedAt + REVEAL_LEAD_MS
    expect(revealProgress(s, first)).toMatchObject({ revealed: 1, sweepSlot: 0, dark: true })
    expect(revealProgress(s, first + REVEAL_STEP_MS * 2 + 10)).toMatchObject({ revealed: 3, sweepSlot: 2, dark: true })
    expect(revealProgress(s, first + REVEAL_STEP_MS * 3 + 10)).toMatchObject({ revealed: 4, sweepSlot: 3, dark: true })
  })

  it("holds the room dark through the tail, then brings the lights up", () => {
    const s = state()
    const sweepEnd = s.revealedAt + REVEAL_LEAD_MS + REVEAL_STEP_MS * 4
    expect(revealProgress(s, sweepEnd)).toEqual({ revealed: 4, sweepSlot: null, dark: true, done: false })
    expect(revealProgress(s, sweepEnd + REVEAL_TAIL_MS)).toEqual({ revealed: 4, sweepSlot: null, dark: false, done: true })
  })

  // A client that connects an hour later must land on the finished board,
  // not a private reveal: the sweep is a function of the state's clock.
  it("is finished for a late arrival", () => {
    const s = state()
    expect(revealProgress(s, s.revealedAt + 60 * 60 * 1000)).toMatchObject({ revealed: 4, done: true, dark: false })
  })

  it("keeps the room dark while a team is under the spotlight", () => {
    const s = state({ spotlight: "a" })
    const late = s.revealedAt + revealDurationMs(4) + 1
    expect(revealProgress(s, late)).toMatchObject({ dark: true, done: true, revealed: 4 })
  })

  it("agrees with revealDurationMs about when it is over", () => {
    const s = state()
    expect(revealProgress(s, s.revealedAt + revealDurationMs(4) - 1).done).toBe(false)
    expect(revealProgress(s, s.revealedAt + revealDurationMs(4)).done).toBe(true)
  })
})

describe("houseDimGoal", () => {
  // The bug this exists for: the house lights and the spotlight used to fade
  // in opposite directions at the same time, so for a second either side of
  // every handover the room had BOTH — a flash, not a handover.
  it("holds the house down until the spotlight is out", () => {
    // Reveal over (target 0 = full), room still dark, spot still lit.
    expect(houseDimGoal(1, 0, 0.6)).toBe(1)
    expect(houseDimGoal(1, 0, SPOT_OUT_LEVEL)).toBe(0)
    expect(houseDimGoal(1, 0, 0)).toBe(0)
  })

  it("dims immediately, spotlight or not — the dark IS the cue", () => {
    expect(houseDimGoal(0, 1, 0)).toBe(1)
    expect(houseDimGoal(0, 1, 1)).toBe(1)
    expect(houseDimGoal(0.5, 1, 0.9)).toBe(1)
  })

  it("stays put once it is where it was going", () => {
    expect(houseDimGoal(1, 1, 1)).toBe(1)
    expect(houseDimGoal(0, 0, 0)).toBe(0)
  })
})

describe("roomPresentation", () => {
  it("resolves team ids to the desks the room seats them at", () => {
    const room = roomPresentation(state({ spotlight: "d" }), TEAMS)
    expect(room).toEqual({
      order: [2, 0, 3, 1],
      revealedAt: 1_000_000,
      nonce: 1,
      spotlightTeamIdx: 3,
      doneTeamIdxs: [],
    })
  })

  // A team the room has no desk for is not a slot the room can point a light
  // at — it is dropped rather than left as a hole.
  it("drops ids the room does not know", () => {
    const room = roomPresentation(state({ order: ["c", "ghost", "a"], spotlight: "ghost" }), TEAMS)
    expect(room?.order).toEqual([2, 0])
    expect(room?.spotlightTeamIdx).toBeNull()
  })

  it("is null when there is no order", () => {
    expect(roomPresentation(null, TEAMS)).toBeNull()
  })
})

describe("presentationSlotsByTeamIdx", () => {
  it("lines the 1-based slots up with the desks", () => {
    const room = roomPresentation(state(), TEAMS)!
    expect(presentationSlotsByTeamIdx(room, 4)).toEqual([2, 4, 1, 3])
  })

  it("leaves a desk with no slot bare", () => {
    const one = { order: [1], revealedAt: 0, nonce: 1, spotlightTeamIdx: null, doneTeamIdxs: [] }
    expect(presentationSlotsByTeamIdx(one, 3)).toEqual([null, 1, null])
  })

  // The exhibition desks: they are seated in the room but not in the draw, so
  // they get no slot and go on wearing their placing through the
  // presentations. The room must not renumber them or blank them.
  it("leaves the desks that are not presenting out of the numbering", () => {
    const presenting = roomPresentation(
      { order: ["c", "a"], revealedAt: 0, nonce: 1, spotlight: null },
      TEAMS,
    )!
    expect(presentationSlotsByTeamIdx(presenting, 4)).toEqual([2, null, 1, null])
  })
})

describe("marking a team off", () => {
  it("resolves the finished teams to their desks", () => {
    const room = roomPresentation(state({ done: ["a", "d"] }), TEAMS)!
    expect(room.doneTeamIdxs.sort()).toEqual([0, 3])
    expect(isDeskDone(room, 0)).toBe(true)
    expect(isDeskDone(room, 2)).toBe(false)
  })

  // A state stamped before the field existed must not crash a room that has
  // reconnected into it mid-afternoon.
  it("reads an order that predates the field as nobody done", () => {
    const room = roomPresentation(state(), TEAMS)!
    expect(room.doneTeamIdxs).toEqual([])
    expect(isDeskDone(room, 0)).toBe(false)
  })

  it("ignores a finished team the room has no desk for", () => {
    const room = roomPresentation(state({ done: ["ghost", "c"] }), TEAMS)!
    expect(room.doneTeamIdxs).toEqual([2])
  })
})

describe("parseDoneInput", () => {
  it("defaults to marking a team off — the press that happens most", () => {
    expect(parseDoneInput({ teamId: "team-3" })).toEqual({ teamId: "team-3", done: true })
    expect(parseDoneInput({ teamId: "team-3", done: false })).toEqual({ teamId: "team-3", done: false })
  })

  it("refuses a request with no team, or a done that is not a boolean", () => {
    expect(() => parseDoneInput({})).toThrow(/INVALID_INPUT/)
    expect(() => parseDoneInput({ teamId: " " })).toThrow(/INVALID_INPUT/)
    expect(() => parseDoneInput({ teamId: "t", done: "yes" })).toThrow(/INVALID_INPUT/)
  })
})

describe("presentationBoard", () => {
  const labels = ["TEAM 01", "TEAM 02", "TEAM 03", "TEAM 04"]

  it("names each slot and reads ? for the ones the sweep has not reached", () => {
    const room = roomPresentation(state(), TEAMS)!
    const midSweep = room.revealedAt + REVEAL_LEAD_MS + REVEAL_STEP_MS + 1
    const board = presentationBoard(room, labels, midSweep)
    expect(board.entries.map((e) => [e.slot, e.label, e.revealed])).toEqual([
      [1, "TEAM 03", true],
      [2, "TEAM 01", true],
      [3, "TEAM 04", false],
      [4, "TEAM 02", false],
    ])
    expect(board.spotlight).toBeNull()
  })

  it("ticks and counts the teams that have presented", () => {
    const room = roomPresentation(state({ done: ["c", "d"] }), TEAMS)!
    const board = presentationBoard(room, labels, room.revealedAt + revealDurationMs(4))
    expect(board.entries.map((e) => [e.slot, e.label, e.done])).toEqual([
      [1, "TEAM 03", true],
      [2, "TEAM 01", false],
      [3, "TEAM 04", true],
      [4, "TEAM 02", false],
    ])
    expect(board.doneCount).toBe(2)
    expect(board.total).toBe(4)
  })

  // A slot the sweep has not reached still reads "?" — ticking it would give
  // away which team is in it before the reveal does.
  it("does not tick a slot the reveal has not reached", () => {
    const room = roomPresentation(state({ done: ["b"] }), TEAMS)!
    const board = presentationBoard(room, labels, room.revealedAt + REVEAL_LEAD_MS + 1)
    expect(board.entries[3]).toMatchObject({ revealed: false, done: false })
    expect(board.doneCount).toBe(0)
  })

  it("leads with the team under the spotlight", () => {
    const room = roomPresentation(state({ spotlight: "d" }), TEAMS)!
    const board = presentationBoard(room, labels, room.revealedAt + revealDurationMs(4))
    expect(board.spotlight).toEqual({ slot: 3, label: "TEAM 04" })
    expect(board.entries.find((e) => e.live)?.label).toBe("TEAM 04")
  })
})

describe("parseSpotlightInput", () => {
  it("takes a team id, or null for lights up", () => {
    expect(parseSpotlightInput({ teamId: "team-3" })).toBe("team-3")
    expect(parseSpotlightInput({ teamId: null })).toBeNull()
    expect(parseSpotlightInput({})).toBeNull()
  })

  it("refuses anything that is not a team id", () => {
    expect(() => parseSpotlightInput({ teamId: 7 })).toThrow(/INVALID_INPUT/)
    expect(() => parseSpotlightInput({ teamId: "  " })).toThrow(/INVALID_INPUT/)
  })
})

describe("ordinal", () => {
  it("gets the teens right", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1ST", "2ND", "3RD", "4TH", "11TH", "12TH", "13TH", "21ST", "22ND", "23RD",
    ])
  })
})
