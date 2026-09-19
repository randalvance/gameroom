import { describe, expect, it } from "vitest"
import {
  isCeremonyComplete,
  latestAnnouncement,
  nextPodiumPlace,
  parseAnnounceInput,
  placedTeamIds,
  PODIUM_ORDER,
  podiumByTeamIdx,
  podiumLabel,
  roomWinners,
  winnersBoard,
  type WinnersState,
} from "./winners-ceremony"

const TEAMS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

const state = (over: Partial<WinnersState> = {}): WinnersState => ({
  startedAt: 1_000_000,
  nonce: 1,
  podium: [],
  ...over,
})

describe("the order the podium is read in", () => {
  it("is third, then second, then first — the suspense runs upward", () => {
    expect(PODIUM_ORDER).toEqual([3, 2, 1])
  })

  it("asks for third place first, and first place last", () => {
    expect(nextPodiumPlace(state())).toBe(3)
    expect(nextPodiumPlace(state({ podium: [{ place: 3, teamId: "c", announcedAt: 1 }] }))).toBe(2)
    expect(
      nextPodiumPlace(state({ podium: [
        { place: 3, teamId: "c", announcedAt: 1 },
        { place: 2, teamId: "a", announcedAt: 2 },
      ] })),
    ).toBe(1)
  })

  it("has nothing left to ask once the winner is out", () => {
    const done = state({ podium: [
      { place: 3, teamId: "c", announcedAt: 1 },
      { place: 2, teamId: "a", announcedAt: 2 },
      { place: 1, teamId: "b", announcedAt: 3 },
    ] })
    expect(nextPodiumPlace(done)).toBeNull()
    expect(isCeremonyComplete(done)).toBe(true)
    expect(isCeremonyComplete(state())).toBe(false)
  })

  it("knows which teams are already on the podium", () => {
    expect(placedTeamIds(state({ podium: [
      { place: 3, teamId: "c", announcedAt: 1 },
      { place: 2, teamId: "a", announcedAt: 2 },
    ] }))).toEqual(["c", "a"])
  })

  it("names the most recent announcement, or nothing before the first", () => {
    expect(latestAnnouncement(state())).toBeNull()
    expect(latestAnnouncement(state({ podium: [
      { place: 3, teamId: "c", announcedAt: 1 },
      { place: 2, teamId: "a", announcedAt: 2 },
    ] }))).toEqual({ place: 2, teamId: "a", announcedAt: 2 })
  })
})

describe("podiumLabel", () => {
  it("reads as a placing, never a bare number", () => {
    expect(podiumLabel(1)).toBe("1ST PLACE")
    expect(podiumLabel(2)).toBe("2ND PLACE")
    expect(podiumLabel(3)).toBe("3RD PLACE")
  })
})

describe("parseAnnounceInput", () => {
  it("accepts a podium place and a team id", () => {
    expect(parseAnnounceInput({ place: 3, teamId: "c" })).toEqual({ place: 3, teamId: "c" })
    expect(parseAnnounceInput({ place: "1", teamId: "c" })).toEqual({ place: 1, teamId: "c" })
  })

  it("refuses anything that is not a podium place", () => {
    expect(() => parseAnnounceInput({ place: 4, teamId: "c" })).toThrow(/INVALID_INPUT/)
    expect(() => parseAnnounceInput({ place: 0, teamId: "c" })).toThrow(/INVALID_INPUT/)
    expect(() => parseAnnounceInput({ place: 1.5, teamId: "c" })).toThrow(/INVALID_INPUT/)
    expect(() => parseAnnounceInput({ teamId: "c" })).toThrow(/INVALID_INPUT/)
  })

  it("refuses a missing or blank team", () => {
    expect(() => parseAnnounceInput({ place: 1 })).toThrow(/INVALID_INPUT/)
    expect(() => parseAnnounceInput({ place: 1, teamId: "  " })).toThrow(/INVALID_INPUT/)
    expect(() => parseAnnounceInput(null)).toThrow(/INVALID_INPUT/)
  })
})

describe("the room's view of the podium", () => {
  const drawn = state({ podium: [
    { place: 3, teamId: "c", announcedAt: 1 },
    { place: 2, teamId: "ghost", announcedAt: 2 },
    { place: 1, teamId: "a", announcedAt: 3 },
  ] })

  it("resolves team ids to desks, dropping ids the room has no desk for", () => {
    expect(roomWinners(drawn, TEAMS)).toEqual({
      startedAt: 1_000_000,
      nonce: 1,
      podium: [
        { place: 3, teamIdx: 2, announcedAt: 1 },
        { place: 1, teamIdx: 0, announcedAt: 3 },
      ],
    })
  })

  it("is nothing when there is no ceremony", () => {
    expect(roomWinners(null, TEAMS)).toBeNull()
  })

  it("hangs each placed desk's medal, and nothing over the rest", () => {
    const room = roomWinners(drawn, TEAMS)!
    expect(podiumByTeamIdx(room, TEAMS.length)).toEqual([1, null, 3, null])
  })
})

describe("what the wall reads", () => {
  const labels = ["TEAM 01", "TEAM 02", "TEAM 03", "TEAM 04"]

  it("lists the podium first place at the top, with the unannounced still hidden", () => {
    const board = winnersBoard(
      roomWinners(state({ podium: [{ place: 3, teamId: "c", announcedAt: 1 }] }), TEAMS)!,
      labels,
    )
    expect(board.entries).toEqual([
      { place: 1, label: null },
      { place: 2, label: null },
      { place: 3, label: "TEAM 03" },
    ])
    expect(board.complete).toBe(false)
  })

  it("is complete once the winner is named", () => {
    const board = winnersBoard(
      roomWinners(state({ podium: [
        { place: 3, teamId: "c", announcedAt: 1 },
        { place: 2, teamId: "d", announcedAt: 2 },
        { place: 1, teamId: "a", announcedAt: 3 },
      ] }), TEAMS)!,
      labels,
    )
    expect(board.entries.map((entry) => entry.label)).toEqual(["TEAM 01", "TEAM 04", "TEAM 03"])
    expect(board.complete).toBe(true)
  })

  it("falls back to a desk number for a label it does not have", () => {
    const board = winnersBoard(
      roomWinners(state({ podium: [{ place: 3, teamId: "d", announcedAt: 1 }] }), TEAMS)!,
      ["TEAM 01"],
    )
    expect(board.entries[2]!.label).toBe("TEAM 4")
  })
})
