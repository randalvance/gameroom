// Which of the room's desks are actually teams.
//
// The room lays out a fixed set of desks (PARTICIPANT_TABLES) whatever the
// event's roster looks like, so an event with four teams leaves six desks with
// nothing behind them. Those used to wear a made-up "TEAM 5" label, highlight
// like a drop target, and then silently swallow the student — the admin board
// can only save a drop onto a team it actually has an id for.

import { PARTICIPANT_TABLES } from "../gameRoom/constants"

/** Shown over a desk that has no team. */
export const EMPTY_TABLE_LABEL = "NO TEAM"

/** Table finishes: exhibition desks are warm white; the competition desks stay wood. */
export const COMPETING_TABLE_TOP_COLOR = 0xd8c8a6
export const EXHIBITION_TABLE_TOP_COLOR = 0xf4f3ea
export const COMPETING_TABLE_LEG_COLOR = 0x8b7f66
export const EXHIBITION_TABLE_LEG_COLOR = 0xdeddd6

export function tableTopColorForCompetition(competing?: boolean): number {
  return competing === false ? EXHIBITION_TABLE_TOP_COLOR : COMPETING_TABLE_TOP_COLOR
}

export function tableLegColorForCompetition(competing?: boolean): number {
  return competing === false ? EXHIBITION_TABLE_LEG_COLOR : COMPETING_TABLE_LEG_COLOR
}

/**
 * Is there a team behind this desk, or is it only furniture?
 *
 * Bounded by the desks as well as the roster: an event with more teams than the
 * room has desks leaves the extras seatless, and a team index past the last
 * desk is not a desk anything can be drawn at (CODE2IMPACT2026-16).
 */
export function tableHasTeam(tableIdx: number, teamCount: number): boolean {
  return tableIdx >= 0 && tableIdx < teamCount && tableIdx < PARTICIPANT_TABLES.length
}

/** A desk gets exhibition trim only when its status is explicitly non-competing. */
export function isExhibitionDesk(
  tableIdx: number,
  teamCompeting?: readonly boolean[],
): boolean {
  return tableIdx >= 0 && teamCompeting?.[tableIdx] === false
}

/**
 * What to write over a desk. A real team carries its name, plus its headcount
 * while an admin is placing people. An unused desk says so instead — a "(0)"
 * would read as a team that simply has nobody in it yet.
 */
export function tableLabelText(
  tableIdx: number,
  teamLabels: readonly string[],
  options: { count?: number; showCount?: boolean } = {},
): string {
  const name = teamLabels[tableIdx]
  if (!tableHasTeam(tableIdx, teamLabels.length) || name === undefined) {
    return EMPTY_TABLE_LABEL
  }
  return options.showCount ? `${name} (${options.count ?? 0})` : name
}
