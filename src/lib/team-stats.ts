// One team's line of the live standings.
//
// getExLeaderboardFn already returns every team for the current window, sorted
// by total P&L descending, in dollars — so a team's rank is just its position
// in that list and there is nothing to re-derive. A missing row is null rather
// than zeros: "not trading this window" and "flat" are different facts, and
// zeros would tell the player the wrong one.

import type { ExLeaderboardRow } from "./exchange-types"

export interface TeamStats {
  rank: number // 1-based
  totalValue: number // dollars
  totalPnL: number // dollars
}

export function teamStatsFor(
  rows: readonly ExLeaderboardRow[],
  teamId: string,
): TeamStats | null {
  const idx = rows.findIndex((row) => row.teamId === teamId)
  const row = rows[idx]
  if (!row) return null
  return { rank: idx + 1, totalValue: row.totalValue, totalPnL: row.totalPnL }
}
