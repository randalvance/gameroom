// What the room's wall-spanning screen is showing, and the data shaping the
// leaderboard page needs.
//
// The page is LOCAL to one client: a player walks up to the screen, presses
// interact, and their own view turns the page. Nothing goes to the hub — two
// players standing side by side can be reading different pages, the same way
// two people can look at different tabs of the same dashboard.

import { CW } from "../gameRoom/constants"
import type { ExLeaderboardRow } from "~/lib/exchange-types"
import { teamColor } from "~/lib/team-colors"

/**
 * The saturated accents the wall screen writes in. Each is a stop or two below
 * the pure hue it replaced (#40FF80 / #FF6060 / #FFD040): at full chroma the
 * countdown and the PnL figures read as lit signage rather than text. They live here rather than in
 * scene.ts because both the screen's pages and the clock that feeds one of
 * them have to agree on them.
 */
export const TEXT_GAIN = "#3FC46E"
export const TEXT_LOSS = "#D65C5C"
export const TEXT_GOLD = "#D9AE38"

/**
 * The standings run to a dozen teams (ten competing plus the exhibition
 * entries) but only five cards fit across the screen's legible band, so the
 * board is three pages rather than one: the podium five, the five below them,
 * then the tail. Splitting it this way — instead of shrinking a dozen cards to
 * fit — keeps every card readable from the back of the room, which is the
 * only place most of these numbers are ever read from. A page the field does
 * not reach stays off the ring (see availableScreenPages).
 */
export const SCREEN_PAGES = ["countdown", "leaderboard", "leaderboard-lower", "leaderboard-tail"] as const

export type ScreenPage = (typeof SCREEN_PAGES)[number]

/**
 * The pages the screen can turn to right now.
 *
 * Before the event's first trading window opens there is nothing to stand a
 * leaderboard on — no window means no scores, and the board page would spend
 * the whole pre-event day cycling an empty waiting card onto the wall every
 * ten seconds. So the board is not merely empty then, it is out of the cycle:
 * the screen holds the countdown to launch, which is the only thing that is
 * actually true yet.
 *
 * The lower boards earn their place the same way: with five teams or fewer
 * nobody stands below fifth, with ten or fewer nobody stands below tenth, and
 * a page of five empty slots is not worth ten seconds of a room's attention.
 * `teamCount` is how many teams the standings carry; left out, every page is
 * on the ring.
 */
export function availableScreenPages(
  eventStarted: boolean,
  teamCount = Number.POSITIVE_INFINITY,
): readonly ScreenPage[] {
  if (!eventStarted) return ["countdown"] as const
  if (teamCount <= BOARD_SIZE) return ["countdown", "leaderboard"] as const
  if (teamCount <= BOARD_SIZE * 2) return ["countdown", "leaderboard", "leaderboard-lower"] as const
  return SCREEN_PAGES
}

/**
 * The next page an interact press turns to, wrapping at the end. A page that
 * is not available (any board before the event has started, a lower board
 * the field does not reach) is not on the ring at all, so this lands on the
 * next one that is rather than turning to it.
 */
export function nextScreenPage(
  page: ScreenPage,
  eventStarted = true,
  teamCount = Number.POSITIVE_INFINITY,
): ScreenPage {
  const pages = availableScreenPages(eventStarted, teamCount)
  const at = pages.indexOf(page)
  // A page that has just left the ring under our feet has no successor on it;
  // start the ring over rather than reading off the end of it.
  if (at === -1) return pages[0]!
  return pages[(at + 1) % pages.length]!
}

/**
 * The page an interact press turns BACK to — the mirror of nextScreenPage,
 * wrapping at the front of the ring rather than the end of it. Same handling
 * of a page that has fallen off the ring: start the ring over rather than
 * reading off it.
 */
export function prevScreenPage(
  page: ScreenPage,
  eventStarted = true,
  teamCount = Number.POSITIVE_INFINITY,
): ScreenPage {
  const pages = availableScreenPages(eventStarted, teamCount)
  const at = pages.indexOf(page)
  if (at === -1) return pages[0]!
  return pages[(at - 1 + pages.length) % pages.length]!
}

/**
 * How long the screen holds each page before turning it by itself.
 *
 * The screen cycles on its own — most of the room is watching it from their
 * desks, not standing under it — and interact just takes the wheel for a
 * moment. The board dwells twice as long as the countdown: five cards of
 * numbers take longer to read than one line of clock.
 */
const PAGE_DWELL_MS: Record<ScreenPage, number> = {
  countdown: 5000,
  leaderboard: 10000,
  "leaderboard-lower": 10000,
  "leaderboard-tail": 10000,
}

export function pageDwellMs(page: ScreenPage): number {
  return PAGE_DWELL_MS[page]
}

/**
 * The screen's interact key. Deliberately clear of the hub's object range
 * (OBJECT_IDX_BASE + index into ROOM_OBJECTS): the scene swallows this key
 * instead of posting it, and if it ever did reach the hub it would be answered
 * as an unknown object rather than as a plant.
 */
export const BIG_SCREEN_IDX = 200_000

/**
 * Where the interact probe finds the screen, in room-plan px.
 *
 * The screen itself spans the whole front wall, but a target is a point, and
 * that point has to be one a player can stand under. The judges' desks used
 * to line the wall, which forced this into the gap between two of them; with
 * the desks gone the whole strip is walkable, so it sits dead centre under a
 * screen that is centred on the same line.
 */
export const BIG_SCREEN_POINT = {
  x: CW / 2,
  y: 90,
} as const

/** One card on the leaderboard page, already formatted for the canvas. */
export interface ScreenBoardRow {
  rank: number
  label: string
  /** Signed, whole dollars: "+$12,430". */
  pnl: string
  /** Marked-to-market total, whole dollars: "$1,012,431". */
  value: string
  /** Losing money — the canvas paints these red. */
  down: boolean
  /**
   * The team's own colour (~/lib/team-colors), so a card on the wall matches
   * that team's swatch on /results and in the room's menu. Taken from the FULL
   * label, never the truncated one — a card is not allowed to change colour
   * because the label above it ran out of room.
   */
  color: string
}

/** How many cards fit across the screen's legible band. */
const BOARD_SIZE = 5
/** Characters of team label a card can hold before it runs into its neighbour. */
const LABEL_MAX = 12

function dollars(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("en-US")
}

function truncate(label: string): string {
  return label.length <= LABEL_MAX ? label : `${label.slice(0, LABEL_MAX - 1)}…`
}

/** Is this page one of the board's pages? */
export function isBoardPage(page: ScreenPage): boolean {
  return page !== "countdown"
}

/** Where in the standings a board page starts. */
function boardOffset(page: ScreenPage): number {
  if (page === "leaderboard-lower") return BOARD_SIZE
  if (page === "leaderboard-tail") return BOARD_SIZE * 2
  return 0
}

/**
 * The banner over a board page. It names the placings on show rather than
 * saying LEADERBOARD three times: the pages are a glance apart on a cycling
 * screen, and a room that cannot tell them apart reads sixth place as first.
 */
export function boardTitle(page: ScreenPage): string {
  const from = boardOffset(page)
  return `◆ STANDINGS ${from + 1}-${from + BOARD_SIZE} ◆`
}

/**
 * One page's worth of teams, formatted for the screen. Input is already
 * PnL-sorted by `getExLeaderboardFn`, so a team's rank is its position in the
 * list plus the page's offset; an empty result means either no window has been
 * scored yet or the field does not reach this page, and the canvas draws its
 * waiting state instead.
 */
export function boardRows(
  rows: readonly ExLeaderboardRow[],
  page: ScreenPage = "leaderboard",
): ScreenBoardRow[] {
  const from = boardOffset(page)
  return rows.slice(from, from + BOARD_SIZE).map((r, i) => ({
    rank: from + i + 1,
    label: truncate(r.label),
    pnl: `${r.totalPnL < 0 ? "-" : "+"}$${dollars(r.totalPnL)}`,
    value: `$${dollars(r.totalValue)}`,
    down: r.totalPnL < 0,
    color: teamColor(r.label),
  }))
}
