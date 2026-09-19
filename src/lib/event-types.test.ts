import { describe, expect, it } from "vitest"
import {
  appendFeedback,
  appendTeamRating,
  buildAllPlayers,
  fmtMean,
  resolveSelectedPlayerIndex,
  teamRatingMean,
  type FeedbackStore,
  type TeamDTO,
  type TeamFeedbackStore,
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
describe("optimistic feedback append", () => {
  const priya = { id: "user_m1", name: "Priya Nair" }
  const wei = { id: "user_m2", name: "Wei Lim" }

  it("records an undecided call, replacing an earlier decided one", () => {
    let store: FeedbackStore = {}
    store = appendFeedback(store, "user_s", priya, true, "sure about them")
    store = appendFeedback(store, "user_s", priya, null, "actually, I need longer")

    expect(store["user_s"]).toHaveLength(1)
    expect(store["user_s"]![0]).toMatchObject({ gip: null, comment: "actually, I need longer" })
  })

  it("replaces the same mentor's earlier vote", () => {
    let store: FeedbackStore = {}
    store = appendFeedback(store, "user_s", priya, true, "first pass")
    store = appendFeedback(store, "user_s", priya, false, "changed my mind")

    expect(store["user_s"]).toHaveLength(1)
    expect(store["user_s"]![0]).toMatchObject({ gip: false, comment: "changed my mind" })
  })

  // The mentor object is rebuilt from loader data on every render, so the
  // same mentor arrives as a NEW object each time. Identity has to come from
  // the id, not from the reference or the name.
  it("replaces the earlier vote even when the mentor object is rebuilt", () => {
    let store: FeedbackStore = {}
    store = appendFeedback(store, "user_s", { id: "user_m1", name: "Priya Nair" }, true, "first")
    store = appendFeedback(store, "user_s", { id: "user_m1", name: "Priya Nair" }, false, "second")

    expect(store["user_s"]).toHaveLength(1)
    expect(store["user_s"]![0]).toMatchObject({ mentorUserId: "user_m1", comment: "second" })
  })

  it("keeps two mentors who share a display name apart", () => {
    const alsoPriya = { id: "user_m3", name: "Priya Nair" }
    let store: FeedbackStore = {}
    store = appendFeedback(store, "user_s", priya, true, "from m1")
    store = appendFeedback(store, "user_s", alsoPriya, false, "from m3")

    expect(store["user_s"]).toHaveLength(2)
  })

  it("leaves other mentors and other students untouched", () => {
    let store: FeedbackStore = {}
    store = appendFeedback(store, "user_s", priya, true, "a")
    store = appendFeedback(store, "user_s", wei, true, "b")
    store = appendFeedback(store, "user_other", priya, true, "c")

    expect(store["user_s"]).toHaveLength(2)
    expect(store["user_other"]).toHaveLength(1)
  })
})

describe("appendTeamRating", () => {
  const priya = { id: "m1", name: "PRIYA NAIR" }
  const wei = { id: "m2", name: "WEI LIM" }

  it("adds a rating for a team that has none", () => {
    const next = appendTeamRating({}, "TEAM_DELTA", priya, 8, "strong split of work")

    expect(next.TEAM_DELTA).toHaveLength(1)
    expect(next.TEAM_DELTA![0]).toMatchObject({
      mentorUserId: "m1",
      mentorName: "PRIYA NAIR",
      rating: 8,
      comment: "strong split of work",
    })
  })

  // Same rule the server upsert enforces: a mentor's newer rating replaces
  // their own older one and leaves everyone else's alone.
  it("replaces this mentor's earlier rating, keeping other mentors'", () => {
    const first: TeamFeedbackStore = {
      TEAM_DELTA: [
        { mentorUserId: "m1", mentorName: "PRIYA NAIR", rating: 5, comment: "early days", ts: 1 },
        { mentorUserId: "m2", mentorName: "WEI LIM", rating: 7, comment: "", ts: 2 },
      ],
    }

    const next = appendTeamRating(first, "TEAM_DELTA", priya, 9, "turned it around")

    expect(next.TEAM_DELTA).toHaveLength(2)
    expect(next.TEAM_DELTA!.filter((e) => e.mentorUserId === "m1")).toHaveLength(1)
    expect(next.TEAM_DELTA!.find((e) => e.mentorUserId === "m1")).toMatchObject({ rating: 9 })
    expect(next.TEAM_DELTA!.find((e) => e.mentorUserId === "m2")).toMatchObject({ rating: 7 })
  })

  it("does not mutate the store it was given", () => {
    const store: TeamFeedbackStore = {}
    appendTeamRating(store, "TEAM_DELTA", wei, 6, "")
    expect(store).toEqual({})
  })

  it("keeps other teams untouched", () => {
    const next = appendTeamRating(
      { TEAM_ECHO: [{ mentorUserId: "m2", mentorName: "WEI LIM", rating: 4, comment: "", ts: 1 }] },
      "TEAM_DELTA",
      priya,
      8,
      "",
    )

    expect(Object.keys(next).sort()).toEqual(["TEAM_DELTA", "TEAM_ECHO"])
    expect(next.TEAM_ECHO).toHaveLength(1)
  })
})

describe("teamRatingMean", () => {
  const entry = (rating: number) => ({
    mentorUserId: "m",
    mentorName: "M",
    rating,
    comment: "",
    ts: 1,
  })

  it("averages the ratings", () => {
    expect(teamRatingMean([entry(7), entry(7), entry(8)])).toBeCloseTo(7.3333, 3)
  })

  it("returns the rating itself for a single entry", () => {
    expect(teamRatingMean([entry(6)])).toBe(6)
  })

  // No entries means no average. Returning 0 would read as the worst possible
  // score for a team nobody has rated yet.
  it("returns null when nobody has rated", () => {
    expect(teamRatingMean([])).toBeNull()
  })
})

describe("fmtMean", () => {
  // An exact mean is not more precise for being padded: 8, not 8.00.
  it("prints an integer mean bare", () => {
    expect(fmtMean(8)).toBe("8")
    expect(fmtMean(10)).toBe("10")
  })

  it("trims one trailing zero from a two-decimal mean", () => {
    expect(fmtMean(7.3)).toBe("7.3")
  })

  it("keeps two decimals when both are significant", () => {
    expect(fmtMean(7.25)).toBe("7.25")
  })
})
