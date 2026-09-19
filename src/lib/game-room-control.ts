// Validation for the gamemaster's room controls — the GAME ROOM tab of the
// console driving the wall screen and the room's bulletins.
//
// Pure, so it can be tested without a hub or a session, and so the server fns
// in ~/server/game-room-control stay the thin guarded wrappers they should be.
// Trimming, bounding and upper-casing are NOT done here: the hub is the one
// place every bulletin passes through, so they belong there (same reasoning as
// the chat censor).

import { SCREEN_PAGES, type ScreenPage } from "~/components/gameRoom3d/screen-pages"
import { resolveVoiceId } from "./announcement-voices"

/** How long the wall holds an announcement when the gamemaster picks nothing. */
export const DEFAULT_HOLD_SECONDS = 15
/** The shortest hold worth putting a room's cameras through. */
export const MIN_HOLD_SECONDS = 3
/** Long enough for any announcement; beyond this it is a pinned page, not a
 * bulletin, and WALL SCREEN is the control for that. */
export const MAX_HOLD_SECONDS = 300

export interface BulletinInput {
  message: string
  /** "" when the bulletin concerns no instrument in particular. */
  affectedSymbol: string
  /**
   * Whether an announcer reads this aloud. False for a replayed market event:
   * the clip opens on its own titles and its anchor reads the headline, so a
   * second voice would talk over the video — and be billed for doing it.
   */
  spoken: boolean
  /** Which announcer reads it, already checked against the known voices. */
  voiceId: string
  /** How long the wall holds it, as a FLOOR — a read longer than this still
   * finishes rather than being cut off. */
  holdSeconds: number
}

/** The page to pin the wall to, or null to hand it back to the players. */
export function parseScreenPageInput(input: unknown): ScreenPage | null {
  const page = (input as { page?: unknown } | null)?.page
  if (page === null) return null
  if (typeof page === "string" && (SCREEN_PAGES as readonly string[]).includes(page)) {
    return page as ScreenPage
  }
  throw new Error(`INVALID_INPUT: page must be null or one of ${SCREEN_PAGES.join(", ")}`)
}

export function parseBulletinInput(input: unknown): BulletinInput {
  const o = (input ?? {}) as Record<string, unknown>
  if (typeof o.message !== "string" || !o.message.trim()) {
    throw new Error("INVALID_INPUT: message required")
  }

  // Null — not the default — for an id we do not know, so an unknown voice is
  // refused rather than quietly swapped for one nobody picked.
  const voiceId = resolveVoiceId(typeof o.voiceId === "string" ? o.voiceId : undefined)
  if (!voiceId) throw new Error("INVALID_INPUT: unknown voice")

  const holdSeconds = o.holdSeconds === undefined ? DEFAULT_HOLD_SECONDS : Number(o.holdSeconds)
  if (
    !Number.isFinite(holdSeconds) ||
    holdSeconds < MIN_HOLD_SECONDS ||
    holdSeconds > MAX_HOLD_SECONDS
  ) {
    throw new Error(
      `INVALID_INPUT: holdSeconds must be between ${MIN_HOLD_SECONDS} and ${MAX_HOLD_SECONDS}`,
    )
  }

  return {
    message: o.message,
    affectedSymbol: typeof o.affectedSymbol === "string" ? o.affectedSymbol : "",
    // Spoken unless the caller says otherwise: a typed announcement is the
    // common case, and a replay has to opt out deliberately.
    spoken: o.spoken !== false,
    voiceId,
    holdSeconds,
  }
}
