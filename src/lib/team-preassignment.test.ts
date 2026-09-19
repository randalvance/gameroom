import { describe, expect, it } from "vitest"
import {
  assertPreassignmentDeleteInput,
  assertPreassignmentSaveInput,
  normalizeRosterEmail,
  parsePreassignmentRoster,
  type PreassignmentTeam,
} from "./team-preassignment"

const TEAMS: PreassignmentTeam[] = [
  { id: "TEAM_01", name: "TEAM 01" },
  { id: "TEAM_02", name: "TEAM 02" },
]

describe("normalizeRosterEmail", () => {
  it("lowercases and trims, so a spreadsheet paste matches what Clerk reports", () => {
    expect(normalizeRosterEmail("  Ada.Lovelace@Uni.edu ")).toBe("ada.lovelace@uni.edu")
  })

  it("rejects non-addresses, embedded whitespace and over-long values", () => {
    expect(normalizeRosterEmail("ada")).toBeNull()
    expect(normalizeRosterEmail("ada lovelace@uni.edu")).toBeNull()
    expect(normalizeRosterEmail(`${"a".repeat(320)}@uni.edu`)).toBeNull()
    expect(normalizeRosterEmail(null)).toBeNull()
  })
})

describe("parsePreassignmentRoster", () => {
  it("accepts team ids and team names, case-insensitively", () => {
    const parsed = parsePreassignmentRoster(
      "ada@uni.edu, TEAM_01\ngrace@uni.edu, team 01\nalan@uni.edu,TEAM_02",
      TEAMS,
    )
    expect(parsed.rejected).toEqual([])
    expect(parsed.entries).toEqual([
      { email: "ada@uni.edu", teamId: "TEAM_01" },
      { email: "grace@uni.edu", teamId: "TEAM_01" },
      { email: "alan@uni.edu", teamId: "TEAM_02" },
    ])
  })

  it("accepts semicolon and tab separated exports", () => {
    const parsed = parsePreassignmentRoster("ada@uni.edu;TEAM_01\ngrace@uni.edu\tTEAM_02", TEAMS)
    expect(parsed.entries).toEqual([
      { email: "ada@uni.edu", teamId: "TEAM_01" },
      { email: "grace@uni.edu", teamId: "TEAM_02" },
    ])
  })

  it("ignores blank lines, comments and a header row", () => {
    const parsed = parsePreassignmentRoster(
      'email,team\n\n# day two arrivals\n"ada@uni.edu", "TEAM_01"\n',
      TEAMS,
    )
    expect(parsed.rejected).toEqual([])
    expect(parsed.entries).toEqual([{ email: "ada@uni.edu", teamId: "TEAM_01" }])
  })

  it("reports each unusable line with its number and reason, keeping the good ones", () => {
    const parsed = parsePreassignmentRoster(
      [
        "ada@uni.edu, TEAM_01", // 1 ok
        "not-an-email, TEAM_01", // 2
        "grace@uni.edu, TEAM_99", // 3
        "alan@uni.edu,", // 4
        "lone@uni.edu", // 5
        "ada@uni.edu, TEAM_02", // 6
      ].join("\n"),
      TEAMS,
    )
    expect(parsed.entries).toEqual([{ email: "ada@uni.edu", teamId: "TEAM_01" }])
    expect(parsed.rejected.map((line) => [line.lineNumber, line.reason])).toEqual([
      [2, "BAD_EMAIL"],
      [3, "UNKNOWN_TEAM"],
      [4, "MISSING_TEAM"],
      [5, "MISSING_TEAM"],
      [6, "DUPLICATE_EMAIL"],
    ])
  })

  it("recognizes the email and team columns wherever a CSV export puts them", () => {
    const parsed = parsePreassignmentRoster(
      [
        "name,email,team,university",
        "Ada Lovelace,ada@uni.edu,TEAM_01,NUS",
        '"Hopper, Grace",grace@uni.edu,TEAM 02,SMU',
        "TEAM_01,alan@uni.edu",
      ].join("\n"),
      TEAMS,
    )
    expect(parsed.rejected).toEqual([])
    expect(parsed.entries).toEqual([
      { email: "ada@uni.edu", teamId: "TEAM_01" },
      { email: "grace@uni.edu", teamId: "TEAM_02" },
      { email: "alan@uni.edu", teamId: "TEAM_01" },
    ])
  })

  it("falls back to the joined remainder for a team name containing a comma", () => {
    const parsed = parsePreassignmentRoster("ada@uni.edu, TEAM 01, Alpha", [
      { id: "TEAM_01", name: "TEAM 01, Alpha" },
    ])
    expect(parsed.entries).toEqual([{ email: "ada@uni.edu", teamId: "TEAM_01" }])
  })

  it("keeps the FIRST of two contradictory rows for one email", () => {
    const parsed = parsePreassignmentRoster(
      "ada@uni.edu, TEAM_01\nADA@UNI.EDU, TEAM_02",
      TEAMS,
    )
    expect(parsed.entries).toEqual([{ email: "ada@uni.edu", teamId: "TEAM_01" }])
    expect(parsed.rejected[0]?.reason).toBe("DUPLICATE_EMAIL")
  })
})

describe("input validators", () => {
  it("accepts a roster string and rejects anything else", () => {
    expect(assertPreassignmentSaveInput({ text: "ada@uni.edu, TEAM_01" })).toEqual({
      text: "ada@uni.edu, TEAM_01",
    })
    expect(() => assertPreassignmentSaveInput({})).toThrow()
    expect(() => assertPreassignmentSaveInput({ text: "x".repeat(200_001) })).toThrow()
  })

  it("normalizes the email to delete, so the row is found by its stored key", () => {
    expect(assertPreassignmentDeleteInput({ email: " Ada@Uni.edu " })).toEqual({
      email: "ada@uni.edu",
    })
    expect(() => assertPreassignmentDeleteInput({ email: "nope" })).toThrow()
  })
})
