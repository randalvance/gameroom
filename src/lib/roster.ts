// Client-safe half of roster linking: the kind vocabulary, the kind→role rule,
// and the DTO shapes. Kept OUT of server/roster-links.ts (which imports @c2i/db
// and therefore the pg driver) so the admin route can read ROLE_FOR_KIND at
// runtime without dragging the database client into the browser bundle. Same
// split as user-sync.ts / user-mirror.ts — see docs/DATABASE.md.

import type { Role } from "./auth"

// The two roster tables a Clerk account can be linked to.
export type RosterKind = "player" | "mentor"

export const ROSTER_KINDS: ReadonlySet<string> = new Set<RosterKind>(["player", "mentor"])

// Linking is what makes an account usable on event day, so it also decides the
// account's role: a dashboard-created user has no `publicMetadata.role` at all,
// which `normalizeRole` reads as `student` (the default) — right for a player,
// wrong for a mentor, who could not reach /mentor. Writing the role here also
// makes a player's role explicit instead of leaving it to the fallback.
export const ROLE_FOR_KIND: Readonly<Record<RosterKind, Role>> = {
  player: "student",
  mentor: "mentor",
}

export interface RosterRow {
  kind: RosterKind
  rowId: number
  /** Roster name as seeded ("ALICE TAN", "MENTOR A"). */
  name: string
  /** Secondary line: "TEAM 01 · SEAT 1 · Team Lead", or the mentor's role. */
  detail: string
  /**
   * Student's email (players.email), lowercased; null on a mentor row or on a
   * student row that predates the column. Required to provision — it becomes
   * the Clerk account's address, which is what lets the PRE-ASSIGN roster
   * match the account at sign-in.
   */
  email: string | null
  /** Linked Clerk account, or null when the seat is unclaimed. */
  userId: string | null
  username: string | null
  /** Mirrored role of the linked account, so the UI can flag a mismatch. */
  linkedRole: Role | null
  /** Linked user's game-room sprite override (users.sprite_id); null = auto. */
  spriteId: number | null
  /** Linked user's AI-generated 4×4 sheet (users.sprite_sheet, PNG data URL). */
  spriteSheet: string | null
}

export interface AccountRow {
  id: string
  username: string | null
  /** Clerk full name, else the username, else a placeholder. Never an email. */
  displayName: string
  role: Role
}

// ---------------------------------------------------------------------------
// Student account maintenance (reset / rename / sprite) — client-safe shapes.
// Expected failures travel as data with a display-ready `error` string, the
// same contract as ProvisionStudentResult.
// ---------------------------------------------------------------------------

// Must equal CHAR_COUNT in components/gameRoom/assets.ts (132 stock sheets,
// char_0.png … char_131.png). Duplicated because server-side validation
// needs it and assets.ts belongs to the canvas code; roster-links.test.ts pins
// the two together.
//
// These 132 are the STOCK characters the game room's derived hash falls back
// to for a player who has not generated a character. They are not offered as a
// choice anywhere — not on /character, not in the admin sprite picker — so a
// NEW users.sprite_id is only ever NULL (auto) or CUSTOM_SPRITE_ID. Rows
// carrying a sheet index predate that and still render.
export const SPRITE_COUNT = 132

// Sentinel sprite id for "use the AI-generated sheet in users.sprite_sheet"
// (see server/sprite-gen.ts).
//
// Out of band ON PURPOSE, rather than the SPRITE_COUNT it used to be. This
// value is PERSISTED in users.sprite_id, so pinning it near the stock sheets
// means growing the stock set silently redefines every stored row: when the
// set went 6 → 8, every account holding 6 ("custom") would have started
// reading as stock sheet #6. Migration 0042 moved those rows onto 99.
//
// 99 then ran out the same way — the pool grew to 101 sheets and swallowed it,
// so migration 0045 moved the rows again, to 999. The lesson both times was
// that a three-sheet margin is not a margin; 999 leaves the pool room to
// roughly decuple before this recurs. Growing the stock set past 998 means
// moving CUSTOM_SPRITE_ID (another data migration) FIRST. The roster-links
// test enforces the gap.
export const CUSTOM_SPRITE_ID = 999

// Sprite ids for the SHARED sprite library (db table shared_sprites): sheets
// an admin published from the character creator, or shipped ones like the
// wizards. Persisted in users.sprite_id as SHARED_SPRITE_BASE + row id — out of
// band past CUSTOM_SPRITE_ID for the same reason CUSTOM is, and below
// smallint's ceiling. A row is either `exclusive` (never in any character
// select; only an admin assigns it, from /admin/sprite-library) or `public`
// (offered on /character alongside the stock pool).
export const SHARED_SPRITE_BASE = 1000
export const SHARED_SPRITE_MAX = 32767

export type SharedSpriteVisibility = "exclusive" | "public"

export const SHARED_SPRITE_VISIBILITIES: ReadonlySet<string> = new Set<SharedSpriteVisibility>([
  "exclusive",
  "public",
])

export interface SharedSpriteView {
  /** The users.sprite_id that selects this sheet. */
  spriteId: number
  label: string
  visibility: SharedSpriteVisibility
  /** Same-origin URL the sheet renders from. */
  url: string
}

export function isSharedSpriteId(spriteId: number | null | undefined): spriteId is number {
  return (
    typeof spriteId === "number" &&
    Number.isInteger(spriteId) &&
    spriteId > SHARED_SPRITE_BASE &&
    spriteId <= SHARED_SPRITE_MAX
  )
}

export function sharedSpriteIdFor(rowId: number): number {
  return SHARED_SPRITE_BASE + rowId
}

/** The sheet URL a shared sprite id renders from (routes/api/shared-sprites.$id). */
export function sharedSpriteUrl(spriteId: number): string {
  return `/api/shared-sprites/${spriteId - SHARED_SPRITE_BASE}`
}

export type ResetStudentPasswordResult =
  | { ok: true; username: string | null; password: string }
  | { ok: false; error: string }

export type RenameStudentResult =
  // clerkSynced is false when the row has no linked account (nothing to sync)
  // or when the Clerk write failed after the roster rename succeeded.
  //
  // emailSynced reports the SEPARATE Clerk write that moves a provisioned
  // account onto a corrected address: false means the roster row now says one
  // thing and the Clerk account another, which matters because
  // pre-assignment matches on the CLERK address.
  | { ok: true; clerkSynced: boolean; emailSynced: boolean }
  | { ok: false; error: string }

export type SetStudentSpriteResult = { ok: true } | { ok: false; error: string }

export type AddStudentResult =
  // The freshly inserted worklist row, shaped like listRosterFn's rows so the
  // UI can append it without a refetch.
  | { ok: true; row: RosterRow }
  | { ok: false; error: string }

// SPRITE_NAMES is gone with the picker that used it: nothing chooses a stock
// sheet by name any more, and each one is described by the prompt that
// generates it (apps/web/scripts/generate-student-sprites.ts).
