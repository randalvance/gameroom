// Placings from the live leaderboard, for anything that wants to show a team's
// standing rather than its numbers — today, the floating numeral over each
// desk in the 3D game room.
//
// The arithmetic that decides the standings themselves lives in the Go
// exchange (`/admin/sessions/:id/results`, surfaced by getExLeaderboardFn);
// this only turns an ordered list into "which place is this team in", which is
// where the room would otherwise be free to invent its own answer.
import type { ExLeaderboardRow } from "./exchange-types"

/** Just enough of a team to find its row — the room passes whole TeamDTOs. */
export interface RankableTeam {
  id: string
}

/**
 * Placings keyed by team id, best P&L first. Ties SHARE a placing and consume
 * the ones behind them (1, 1, 3), which is what a scoreboard means by a draw —
 * breaking the tie on row order would hand out a first place on nothing.
 */
export function teamRanksById(rows: readonly ExLeaderboardRow[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.totalPnL - a.totalPnL)
  const ranks = new Map<string, number>()
  let placing = 0
  let previousPnL: number | null = null
  sorted.forEach((row, index) => {
    if (previousPnL === null || row.totalPnL !== previousPnL) {
      placing = index + 1
      previousPnL = row.totalPnL
    }
    ranks.set(row.teamId, placing)
  })
  return ranks
}

/**
 * The same placings, lined up with the room's desk order. A team with no row
 * on the leaderboard — never registered with the exchange, or a window that
 * has not opened — gets `null`, NOT last place: the room shows no numeral
 * rather than a placing nobody earned.
 */
export function teamRanksByIndex(
  teams: readonly RankableTeam[],
  rows: readonly ExLeaderboardRow[],
): (number | null)[] {
  const ranks = teamRanksById(rows)
  return teams.map((team) => ranks.get(team.id) ?? null)
}
