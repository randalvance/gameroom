// Client-safe types + pure helpers for event data (teams, members, mentor
// feedback). No server imports here — this module is bundled into the client.
//
// The DB-backed server functions live in ~/server/event-data.ts and return
// these shapes. FeedbackStore keys use the stable users.id (Clerk id) so
// feedback follows participants when their team membership changes.

import { SGT } from "./time"

export type TrackKey = "#TRADING" | "#ANALYTICS" // challenges directory tag
export type PlayerRole = "student" | "mentor" | "judge" | "admin" | "viewer"

export interface PlayerDTO {
  id: string // users.id (Clerk user id)
  name: string
  role?: PlayerRole
  spriteId: number | null // admin-assigned game-room sprite; null = auto
  /** users.sprite_sheet — generated 4×4 sheet (PNG data URL); rendered only while spriteId = CUSTOM_SPRITE_ID. */
  spriteSheet: string | null
}

export interface TeamDTO {
  id: string // accounts.team_id — the shared web/exchange team identity
  name: string // accounts.team_name ("TEAM 01")
  /** Exhibition teams are seated but excluded from judging and presentation draws. */
  competing?: boolean
  players: PlayerDTO[] // ordered by display name
}

// Flattened player, shape-compatible with the old ALL_PLAYERS const.
// teamIdx/seatIdx are positions within the loaded teams array — the room
// scenes seat by array order, not by persisted numbers or team ids.
export interface FlatPlayer extends PlayerDTO {
  teamIdx: number // index of the team in the teams array
  seatIdx: number
  teamName: string
}

export function buildAllPlayers(teams: TeamDTO[]): FlatPlayer[] {
  return teams.flatMap((t, teamIdx) =>
    t.players.map((p, i) => ({ ...p, teamIdx, seatIdx: i, teamName: t.name })),
  )
}

export function resolveSelectedPlayerIndex(
  allPlayers: FlatPlayer[],
  team: TeamDTO | undefined,
  selectedIndex: number | null,
): number {
  const selectedPlayer = selectedIndex === null ? undefined : team?.players[selectedIndex]
  return selectedPlayer
    ? allPlayers.findIndex((player) => player.id === selectedPlayer.id)
    : -1
}

export interface FeedbackEntry {
  /** Who left it — users.id of the mentor. Null only on rows written before
   *  the app recorded it. */
  mentorUserId: string | null
  /** What to call them: a snapshot of users.display_name, for showing only. */
  mentorName: string
  /** true = recommend, false = pass, null = the mentor is undecided. */
  gip: boolean | null
  comment: string
  ts: number // epoch ms
}

// Keyed by users.id (Clerk id).
export type FeedbackStore = Record<string, FeedbackEntry[]>

export function fmtTs(ts: number): string {
  // SGT — §5: user-facing times must be Singapore time, not the viewer's clock.
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SGT,
  })
}

/** Two decimals, but 8 rather than 8.00 — a mean of exactly 8 is not more precise. */
export function fmtMean(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")
}

// Pure optimistic-update helper, mirroring what the server does on write: a
// mentor's newer entry replaces their previous one for that student. Matched on
// the mentor's id, never their name — two mentors can share a display name, and
// the same mentor arrives as a fresh object on every render.
export function appendFeedback(
  store: FeedbackStore,
  key: string,
  mentor: { id: string; name: string },
  gip: boolean | null,
  comment: string,
): FeedbackStore {
  const existing = (store[key] ?? []).filter((e) => e.mentorUserId !== mentor.id)
  return {
    ...store,
    [key]: [
      ...existing,
      { mentorUserId: mentor.id, mentorName: mentor.name, gip, comment, ts: Date.now() },
    ],
  }
}

// Mentor team feedback ------------------------------------------------------

export interface TeamRatingEntry {
  /** Who left it — users.id of the mentor. */
  mentorUserId: string
  /** What to call them: a snapshot of users.display_name, for showing only. */
  mentorName: string
  /** The mentor's overall read on the team, 1..10. */
  rating: number
  comment: string
  ts: number // epoch ms
}

// Keyed by accounts.team_id.
export type TeamFeedbackStore = Record<string, TeamRatingEntry[]>

export const TEAM_RATING_MIN = 1
export const TEAM_RATING_MAX = 10

/** Null rather than 0 when nobody has rated — 0 would read as the worst score. */
export function teamRatingMean(entries: readonly TeamRatingEntry[]): number | null {
  if (entries.length === 0) return null
  return entries.reduce((sum, e) => sum + e.rating, 0) / entries.length
}

// Pure optimistic-update helper, mirroring what the server upsert does: a
// mentor's newer rating replaces their own previous one for that team. Matched
// on the mentor's id, never their name.
export function appendTeamRating(
  store: TeamFeedbackStore,
  teamId: string,
  mentor: { id: string; name: string },
  rating: number,
  comment: string,
): TeamFeedbackStore {
  const existing = (store[teamId] ?? []).filter((e) => e.mentorUserId !== mentor.id)
  return {
    ...store,
    [teamId]: [
      ...existing,
      { mentorUserId: mentor.id, mentorName: mentor.name, rating, comment, ts: Date.now() },
    ],
  }
}

// Judge rubric --------------------------------------------------------------
//
// A judge's card itself is `JudgeFeedback` in ~/lib/judge-rubric.ts, which owns
// the criteria and validates the stored object.

export interface JudgeTeamDTO {
  id: string // accounts.team_id
  name: string
}

// Directory ------------------------------------------------------------------

export interface MentorDTO {
  name: string
  role: string
  skills: string[]
  avail: "ONLINE" | "OFFICE HOURS" | "OFFLINE"
  featured: boolean
}

export interface ChallengeDTO {
  num: string
  name: string
  tag: TrackKey
  sprite: string
  accent: string
  desc: string
  badge: string
}
