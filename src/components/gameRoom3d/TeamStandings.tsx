// One team's live trading standing, for the game-room menu's Team section.
//
// The roster beside it comes from the route loader and never fails; these
// three numbers come from the exchange and can. So this owns its own fetch and
// its own failure: a dead exchange costs the numbers, not the section.

import { useEffect, useState } from "react"
import type { ExLeaderboardRow } from "~/lib/exchange-types"
import { teamStatsFor, type TeamStats } from "~/lib/team-stats"
import { getExLeaderboardFn } from "~/server/exchange"

/** Slow on purpose: the menu is a glance, not a trading screen. */
const REFRESH_MS = 10_000

type Standings =
  | { state: "loading" }
  // `stale` means these are the last good numbers and the most recent refresh
  // failed — they stay on screen, but with STANDINGS UNAVAILABLE beside them
  // so nobody reads a ten-minute-old rank as live.
  | { state: "ok"; stats: TeamStats; stale: boolean }
  | { state: "absent" }
  | { state: "error" }

const money = (n: number) =>
  n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function TeamStandings({ teamId }: { teamId: string }) {
  const [standings, setStandings] = useState<Standings>({ state: "loading" })

  useEffect(() => {
    let alive = true
    setStandings({ state: "loading" })
    const load = async () => {
      try {
        const rows: ExLeaderboardRow[] = await getExLeaderboardFn()
        if (!alive) return
        const stats = teamStatsFor(rows, teamId)
        setStandings(stats ? { state: "ok", stats, stale: false } : { state: "absent" })
      } catch {
        // Keep whatever numbers are on screen, but say they are not live.
        if (alive) {
          setStandings((prev) =>
            prev.state === "ok" ? { ...prev, stale: true } : { state: "error" },
          )
        }
      }
    }
    void load()
    const id = setInterval(() => void load(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [teamId])

  const ok = standings.state === "ok" ? standings.stats : null
  return (
    <div className="game-room-menu-standings">
      <div className="game-room-menu-stats">
        <Stat testId="team-stats-rank" label="RANK">{ok ? `#${ok.rank}` : "—"}</Stat>
        <Stat testId="team-stats-value" label="TOTAL VALUE">{ok ? `$${money(ok.totalValue)}` : "—"}</Stat>
        <Stat testId="team-stats-pnl" label="P&L">{ok ? `$${money(ok.totalPnL)}` : "—"}</Stat>
      </div>
      {standings.state === "absent" && <p className="game-room-menu-standings-note">NO STANDINGS THIS WINDOW</p>}
      {(standings.state === "error" || (standings.state === "ok" && standings.stale)) && (
        <p className="game-room-menu-standings-note">STANDINGS UNAVAILABLE</p>
      )}
    </div>
  )
}

function Stat({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="game-room-menu-stat">
      <span className="game-room-menu-stat-label">{label}</span>
      <span className="game-room-menu-stat-value" data-testid={testId}>{children}</span>
    </div>
  )
}
