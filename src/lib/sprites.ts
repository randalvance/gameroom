// The sprite id vocabulary: which sheet a stored sprite id points at.
//
// Ids are PERSISTED by hosts, so the sentinels below are deliberately out of
// band of the stock pool and never renumbered.

// Must equal CHAR_COUNT in components/gameRoom/assets.ts (132 stock sheets,
// char_0.png … char_131.png). Duplicated because server-side code needs it
// without dragging in the canvas init path; spriteIndex.test.ts pins the two
// together.
export const SPRITE_COUNT = 132

/**
 * Sentinel sprite id for "use the generated sheet stored alongside the id".
 *
 * Out of band ON PURPOSE rather than the pool's size: growing the stock set
 * must never silently redefine a stored row. 999 leaves the pool room to
 * roughly decuple before this recurs.
 */
export const CUSTOM_SPRITE_ID = 999

// Sprite ids for a host's SHARED sprite library: sheets published by a host,
// persisted as SHARED_SPRITE_BASE + row id — out of band past CUSTOM_SPRITE_ID
// for the same reason CUSTOM is. A row is either `exclusive` (never in any
// character select; only a host assigns it) or `public` (offered in the
// picker alongside the stock pool).
export const SHARED_SPRITE_BASE = 1000
export const SHARED_SPRITE_MAX = 32767

export type SharedSpriteVisibility = "exclusive" | "public"

export const SHARED_SPRITE_VISIBILITIES: ReadonlySet<string> = new Set<SharedSpriteVisibility>([
  "exclusive",
  "public",
])

export interface SharedSpriteView {
  /** The sprite id that selects this sheet. */
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

/** The sheet URL a shared sprite id renders from (a host serves this route). */
export function sharedSpriteUrl(spriteId: number): string {
  return `/api/shared-sprites/${spriteId - SHARED_SPRITE_BASE}`
}
