// Validation for the gamemaster's room controls — the console's bulletin.
//
// Pure, so it can be tested without a hub or a session, and so the server fns
// in ~/server/game-room-control stay the thin wrappers they should be.
// Trimming and bounding are NOT done here: the hub is the one place every
// bulletin passes through, so they belong there (same reasoning as the chat
// censor).

/** How long the wall holds a bulletin when the gamemaster picks nothing. */
export const DEFAULT_HOLD_SECONDS = 15
/** The shortest hold worth putting a room's cameras through. */
export const MIN_HOLD_SECONDS = 3
/** Long enough for any announcement. */
export const MAX_HOLD_SECONDS = 300

export interface BulletinInput {
  message: string
  /** How long the wall holds it. */
  holdSeconds: number
}

export function parseBulletinInput(input: unknown): BulletinInput {
  const o = (input ?? {}) as Record<string, unknown>
  if (typeof o.message !== "string" || !o.message.trim()) {
    throw new Error("INVALID_INPUT: message required")
  }

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

  return { message: o.message, holdSeconds }
}
