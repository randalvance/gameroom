// Which sheet a player renders with, and which sheet row a walk direction
// reads. Its own module — no layout/asset bootstrap imports — so node tests
// and future server code can import it without dragging in the canvas init
// path. Directions follow walkPos: 0=up 1=right 2=down 3=left.
import { CHAR_COUNT } from "./assets"
import { CUSTOM_SPRITE_ID, isSharedSpriteId, sharedSpriteUrl } from "~/lib/sprites"
import { SPRITE_COLS, SPRITE_ROWS, WALK_FRAME_SEQUENCE } from "~/lib/sprite-gen"

export function characterIdForPlayer(playerIdx: number, teamIdx: number): number {
  return ((playerIdx + teamIdx * 7) % CHAR_COUNT + CHAR_COUNT) % CHAR_COUNT
}

// An admin-assigned sprite (players.sprite_id) wins; null/undefined means
// "auto" — the stable derived hash, so unassigned players are pixel-identical
// to the pre-sprite_id behaviour (pinned by spriteIndex.test.ts).
export function spriteSheetIndex(
  spriteId: number | null | undefined,
  playerIdx: number,
  teamIdx: number,
): number {
  return spriteId ?? characterIdForPlayer(playerIdx, teamIdx)
}

// ---------------------------------------------------------------------------
// Direction rows. Every sheet uses the classic RPG-Maker row order — down,
// left, right, up — so each direction has its own drawn row and nothing is
// ever mirrored. (The 7×3 strips that needed a mirrored side row are gone
// along with the layout that described them.)
// ---------------------------------------------------------------------------

export type WalkDir = 0 | 1 | 2 | 3

export const DIR_ROW: Record<WalkDir, number> = {
  0: 3,
  1: 2,
  2: 0,
  3: 1,
}

export type ResolvedSprite =
  | { kind: "builtin"; charIdx: number }
  | { kind: "custom"; sheetDataUrl: string }

/**
 * users.sprite_id semantics: null → derived hash; 0..CHAR_COUNT-1 → that
 * built-in sheet; CUSTOM_SPRITE_ID → the generated sheet stored in
 * users.sprite_sheet. Anything that cannot be honored (out-of-range id,
 * CUSTOM_SPRITE_ID with no stored sheet) falls back to the derived hash
 * rather than blanking the character.
 */
export function resolveSprite(
  spriteId: number | null | undefined,
  spriteSheet: string | null | undefined,
  playerIdx: number,
  teamIdx: number,
): ResolvedSprite {
  if (spriteId === CUSTOM_SPRITE_ID && spriteSheet) {
    return { kind: "custom", sheetDataUrl: spriteSheet }
  }
  // A shared-library sheet is a URL rather than a data URL, but every renderer
  // loads a "custom" source by URL either way — and one that fails to load
  // (a deleted row) drops the player back onto the built-in fallback.
  if (isSharedSpriteId(spriteId)) {
    return { kind: "custom", sheetDataUrl: sharedSpriteUrl(spriteId) }
  }
  if (spriteId != null && Number.isInteger(spriteId) && spriteId >= 0 && spriteId < CHAR_COUNT) {
    return { kind: "builtin", charIdx: spriteId }
  }
  return { kind: "builtin", charIdx: characterIdForPlayer(playerIdx, teamIdx) }
}

/**
 * Walk-cycle column at animation step `step` (already divided down from the
 * frame counter): the 0→1→2→1 ping-pong over the three walk columns. Columns
 * 3 and 4 are the attack pair and column 5 is the hurt pose — poses the walk
 * cycle deliberately never reaches.
 */
export function walkFrameFor(step: number): number {
  return WALK_FRAME_SEQUENCE[((step % 4) + 4) % 4]!
}

// ---------------------------------------------------------------------------
// Sheet format
// ---------------------------------------------------------------------------
// ONE layout, applied to every sheet: 6 columns x 4 rows of 2:3 cells
// (192x192 = 32x48 cells; the raw 768x768 Comfy export divides the same way).
//
// This used to sniff the layout from the image's dimensions so that older
// 4x4 sheets and the original 16x32 strips kept rendering. That is gone on
// purpose. Every sheet is being converted, and a sheet that has NOT been
// converted should look obviously wrong rather than quietly correct — a
// garbled character is how you find the files still to do. So the geometry is
// divided out of whatever image arrives, with no format guessing and no
// fallback layout.
//
// The only thing defended against is division by zero: a texture that failed
// to decode reports 0x0, and a wrong-looking sprite beats a crashed room.

export interface SheetFormat {
  /** Cell size in source pixels. */
  cellW: number
  cellH: number
  /** Frames per direction row, and how many direction rows. */
  cols: number
  rows: number
  /** Which row each walk direction reads. */
  dirRow: Record<WalkDir, number>
  /** Column to draw at animation step `step` (already divided down). */
  walkFrame: (step: number) => number
  /** Column the character stands on when it is not walking. */
  standFrame: number
}

/**
 * The grid for a loaded sheet. `cellW`/`cellH` come from the image so that the
 * raw 768x768 export (128x192 cells) slices exactly like the finished 192x192
 * sheet; everything else is the fixed contract. A sheet whose dimensions do
 * not divide evenly is still sliced on this grid — it renders wrong, which is
 * the point.
 */
export function sheetFormatFor(width: number, height: number): SheetFormat {
  return {
    cellW: Math.max(1, Math.floor(width / SPRITE_COLS)),
    cellH: Math.max(1, Math.floor(height / SPRITE_ROWS)),
    cols: SPRITE_COLS,
    rows: SPRITE_ROWS,
    dirRow: DIR_ROW,
    // Column 0 is a step, so a standing character holds the mid-stride column
    // instead — standing on column 0 reads as a limp.
    walkFrame: walkFrameFor,
    standFrame: 1,
  }
}
