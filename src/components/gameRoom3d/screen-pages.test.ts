import { describe, expect, it } from "vitest"
import {
  BIG_SCREEN_IDX,
  BIG_SCREEN_POINT,
  availableScreenPages,
  boardRows,
  boardTitle,
  isBoardPage,
  nextScreenPage,
  pageDwellMs,
  prevScreenPage,
  type ScreenPage,
  SCREEN_PAGES,
} from "./screen-pages"
import {
  buildStaticColliders,
  interactTarget,
  pointBlocked,
} from "~/lib/gameRoomNet/collision"
import { OBJECT_IDX_BASE } from "~/lib/gameRoomNet/objects"
import { teamColor } from "~/lib/team-colors"

describe("nextScreenPage", () => {
  it("cycles through every page and back to the countdown", () => {
    let page: ScreenPage = SCREEN_PAGES[0]
    expect(page).toBe("countdown")
    for (let i = 1; i < SCREEN_PAGES.length; i++) {
      page = nextScreenPage(page)
      expect(page).toBe(SCREEN_PAGES[i])
    }
    expect(nextScreenPage(page)).toBe("countdown")
  })

  it("never turns to the board before the event has started", () => {
    expect(nextScreenPage("countdown", false)).toBe("countdown")
  })

  it("brings a screen left on the board back to the countdown", () => {
    // A window disappearing under the page (a poll answering null) must not
    // strand the wall on standings that no longer exist.
    expect(nextScreenPage("leaderboard", false)).toBe("countdown")
  })
})

describe("prevScreenPage", () => {
  it("walks the ring backwards and wraps at the countdown", () => {
    // Left is the mirror of right: from the first page it lands on the last.
    expect(prevScreenPage("countdown")).toBe(SCREEN_PAGES[SCREEN_PAGES.length - 1])
    expect(prevScreenPage("leaderboard")).toBe("countdown")
    expect(prevScreenPage("leaderboard-lower")).toBe("leaderboard")
    expect(prevScreenPage("leaderboard-tail")).toBe("leaderboard-lower")
  })

  it("never turns to the board before the event has started", () => {
    expect(prevScreenPage("countdown", false)).toBe("countdown")
  })

  it("brings a screen left on the board back to the countdown", () => {
    expect(prevScreenPage("leaderboard", false)).toBe("countdown")
  })

  it("skips the lower board in a field that does not reach it", () => {
    // Five teams or fewer: the ring is countdown + leaderboard, so stepping
    // back from the countdown lands on the board rather than the empty half.
    expect(prevScreenPage("countdown", true, 5)).toBe("leaderboard")
    expect(prevScreenPage("leaderboard", true, 5)).toBe("countdown")
  })

  it("undoes a forward turn from every page", () => {
    for (const page of SCREEN_PAGES) {
      expect(prevScreenPage(nextScreenPage(page))).toBe(page)
    }
  })
})

describe("availableScreenPages", () => {
  it("offers the countdown alone until the event starts", () => {
    expect(availableScreenPages(false)).toEqual(["countdown"])
  })

  it("offers every page once a window has opened", () => {
    expect(availableScreenPages(true)).toEqual([...SCREEN_PAGES])
  })
})

describe("pageDwellMs", () => {
  it("holds the countdown 5s and the leaderboard twice as long", () => {
    // The board carries five cards of numbers; the countdown is one line you
    // read at a glance.
    expect(pageDwellMs("countdown")).toBe(5000)
    expect(pageDwellMs("leaderboard")).toBe(10000)
  })

  it("gives every page a dwell, so the cycle can never stall", () => {
    for (const page of SCREEN_PAGES) expect(pageDwellMs(page)).toBeGreaterThan(0)
  })
})

describe("BIG_SCREEN_IDX", () => {
  it("sits outside the hub's object range, so a press never reaches the hub", () => {
    // The screen's page is local to one client. Sharing the ROOM_OBJECTS range
    // would make the hub answer for it (with a plant's line, no less).
    expect(BIG_SCREEN_IDX).toBeGreaterThan(OBJECT_IDX_BASE + 1000)
  })
})

describe("BIG_SCREEN_POINT", () => {
  it("is reachable — a player can stand under the screen and face it", () => {
    const colliders = buildStaticColliders()
    const stand = { x: BIG_SCREEN_POINT.x, y: BIG_SCREEN_POINT.y + 22, dir: 0 as const }
    expect(pointBlocked(stand.x, stand.y, colliders)).toBe(false)
    const hit = interactTarget(stand, [{ key: BIG_SCREEN_IDX, ...BIG_SCREEN_POINT }])
    expect(hit?.key).toBe(BIG_SCREEN_IDX)
  })
})

describe("boardRows", () => {
  const row = (label: string, totalPnL: number, totalValue = 100000) => ({
    label,
    teamId: label,
    totalValue,
    totalPnL,
  })

  it("ranks the top five and drops the rest", () => {
    const rows = boardRows([
      row("A", 900), row("B", 800), row("C", 700),
      row("D", 600), row("E", 500), row("F", 400),
    ])
    expect(rows.map((r) => r.label)).toEqual(["A", "B", "C", "D", "E"])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it("signs profit and loss, and flags which is which for colour", () => {
    const [win, lose] = boardRows([row("WIN", 12430.4), row("LOSE", -2050.7)])
    expect(win!.pnl).toBe("+$12,430")
    expect(win!.down).toBe(false)
    expect(lose!.pnl).toBe("-$2,051")
    expect(lose!.down).toBe(true)
  })

  it("formats the marked-to-market total in whole dollars", () => {
    const [only] = boardRows([row("A", 0, 1012430.6)])
    expect(only!.value).toBe("$1,012,431")
  })

  it("truncates a team label too long for its card", () => {
    const [only] = boardRows([row("EXTRAORDINARILY LONG TEAM", 1)])
    expect(only!.label).toBe("EXTRAORDINA…")
  })

  it("has nothing to draw before the first trading window", () => {
    expect(boardRows([])).toEqual([])
  })
})

describe("the lower board", () => {
  const field = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      label: `TEAM_${String(i + 1).padStart(2, "0")}`,
      teamId: `t${i + 1}`,
      totalValue: 100000,
      totalPnL: 1000 - i,
    }))

  it("carries ranks six to ten, numbered where the top board left off", () => {
    const rows = boardRows(field(10), "leaderboard-lower")
    expect(rows.map((r) => r.rank)).toEqual([6, 7, 8, 9, 10])
    expect(rows.map((r) => r.label)).toEqual([
      "TEAM_06", "TEAM_07", "TEAM_08", "TEAM_09", "TEAM_10",
    ])
  })

  it("stays off the ring when nobody is below fifth", () => {
    // Five teams or fewer and the lower board is five empty slots — the
    // screen should not spend ten seconds a cycle showing them.
    expect(availableScreenPages(true, 5)).toEqual(["countdown", "leaderboard"])
    expect(nextScreenPage("leaderboard", true, 5)).toBe("countdown")
  })

  it("joins the ring as soon as a sixth team has a score", () => {
    expect(availableScreenPages(true, 6)).toEqual(["countdown", "leaderboard", "leaderboard-lower"])
    expect(nextScreenPage("leaderboard", true, 6)).toBe("leaderboard-lower")
    expect(nextScreenPage("leaderboard-lower", true, 6)).toBe("countdown")
  })

  it("comes off the ring with the top board before the event starts", () => {
    expect(availableScreenPages(false, 10)).toEqual(["countdown"])
    expect(nextScreenPage("leaderboard-lower", false, 10)).toBe("countdown")
  })

  it("holds as long as the top board — same five cards to read", () => {
    expect(pageDwellMs("leaderboard-lower")).toBe(pageDwellMs("leaderboard"))
  })

  it("has nothing to show when the field stops at fifth", () => {
    expect(boardRows(field(5), "leaderboard-lower")).toEqual([])
  })

  it("says which part of the field it is showing", () => {
    expect(boardTitle("leaderboard")).toContain("1-5")
    expect(boardTitle("leaderboard-lower")).toContain("6-10")
    expect(boardTitle("leaderboard-tail")).toContain("11-15")
  })
})

describe("the tail board", () => {
  const field = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      label: `TEAM_${String(i + 1).padStart(2, "0")}`,
      teamId: `t${i + 1}`,
      totalValue: 100000,
      totalPnL: 1000 - i,
    }))

  it("carries ranks eleven onward — a twelve-team field is not cut at ten", () => {
    const rows = boardRows(field(12), "leaderboard-tail")
    expect(rows.map((r) => r.rank)).toEqual([11, 12])
    expect(rows.map((r) => r.label)).toEqual(["TEAM_11", "TEAM_12"])
  })

  it("stays off the ring until an eleventh team has a score", () => {
    expect(availableScreenPages(true, 10)).toEqual(["countdown", "leaderboard", "leaderboard-lower"])
    expect(nextScreenPage("leaderboard-lower", true, 10)).toBe("countdown")
    expect(availableScreenPages(true, 11)).toEqual([...SCREEN_PAGES])
    expect(nextScreenPage("leaderboard-lower", true, 11)).toBe("leaderboard-tail")
    expect(nextScreenPage("leaderboard-tail", true, 11)).toBe("countdown")
  })

  it("holds as long as the other boards and counts as a board page", () => {
    expect(pageDwellMs("leaderboard-tail")).toBe(pageDwellMs("leaderboard"))
    expect(isBoardPage("leaderboard-tail")).toBe(true)
  })
})

describe("board card colour", () => {
  it("gives each card its team's own colour, not its placing's", () => {
    const rows = boardRows([
      { label: "TEAM_03", teamId: "c", totalValue: 1, totalPnL: 9 },
      { label: "TEAM_01", teamId: "a", totalValue: 1, totalPnL: 8 },
    ])
    expect(rows[0]!.color).toBe(teamColor("TEAM_03"))
    expect(rows[1]!.color).toBe(teamColor("TEAM_01"))
  })

  it("colours by the whole label, so truncation cannot repaint a team", () => {
    const long = "EXTRAORDINARILY LONG TEAM"
    const [only] = boardRows([{ label: long, teamId: "x", totalValue: 1, totalPnL: 1 }])
    expect(only!.label).not.toBe(long)
    expect(only!.color).toBe(teamColor(long))
  })
})

describe("isBoardPage", () => {
  it("is true for every page of the standings and nothing else", () => {
    // The scene repaints on fresh standings only when one is showing.
    expect(isBoardPage("leaderboard")).toBe(true)
    expect(isBoardPage("leaderboard-lower")).toBe(true)
    expect(isBoardPage("leaderboard-tail")).toBe(true)
    expect(isBoardPage("countdown")).toBe(false)
  })
})
