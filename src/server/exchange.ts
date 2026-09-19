// The standings and the trading clock the room's wall screen reads.
//
// The event site had a whole exchange behind these two calls. The room does
// not care: it wants a list of teams with a number beside each, and a session
// clock to count down. Anything that can serve those two routes — the demo
// hub, your own back end — drives the wall.

import type { ExLeaderboardRow } from "~/lib/exchange-types"
import { apiGet } from "./client"

export interface PublicSession {
  id: string
  status: "running" | "paused" | "ended"
  mode: string
  startedAt: string
  elapsedSeconds: number
  durationSeconds: number | null
  remainingSeconds: number | null
}

/** The standings, richest first. An empty list simply leaves the board blank. */
export function getExLeaderboardFn(): Promise<ExLeaderboardRow[]> {
  return apiGet<ExLeaderboardRow[]>("/api/leaderboard", [])
}

/** The window's clock, or null when nothing is running. */
export function getPublicSessionFn(_input?: { data?: unknown }): Promise<PublicSession | null> {
  return apiGet<PublicSession | null>("/api/session", null)
}
