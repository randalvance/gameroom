import { describe, expect, it } from "vitest"
import { CHAR_COUNT } from "./assets"
import { characterIdForPlayer, spriteSheetIndex } from "./spriteIndex"

describe("spriteSheetIndex", () => {
  it("null/undefined spriteId falls back to the derived hash — unassigned sprites render exactly as before", () => {
    for (let teamIdx = 0; teamIdx < 10; teamIdx++) {
      for (let playerIdx = 0; playerIdx < 50; playerIdx++) {
        const derived = characterIdForPlayer(playerIdx, teamIdx)
        expect(spriteSheetIndex(null, playerIdx, teamIdx)).toBe(derived)
        expect(spriteSheetIndex(undefined, playerIdx, teamIdx)).toBe(derived)
      }
    }
  })
  it("an explicit spriteId wins over the hash", () => {
    expect(spriteSheetIndex(3, 0, 0)).toBe(3)
    expect(spriteSheetIndex(0, 7, 4)).toBe(0)
    expect(spriteSheetIndex(CHAR_COUNT - 1, 11, 2)).toBe(CHAR_COUNT - 1)
  })
  it("derived hash stays in range for every seat", () => {
    for (let teamIdx = 0; teamIdx < 10; teamIdx++) {
      for (let playerIdx = 0; playerIdx < 50; playerIdx++) {
        const id = characterIdForPlayer(playerIdx, teamIdx)
        expect(id).toBeGreaterThanOrEqual(0)
        expect(id).toBeLessThan(CHAR_COUNT)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Custom (generated) sheet contract — ported from the game-room sprite work
// on claude/awesome-davinci-cd818b, adapted to the numeric spriteId model.
// Directions follow walkPos: 0=up 1=right 2=down 3=left.
// ---------------------------------------------------------------------------

import {
  SPRITE_CELL_H,
  SPRITE_CELL_W,
  SPRITE_COLS,
  SPRITE_ROWS,
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
  WALK_FRAME_SEQUENCE,
} from "~/lib/sprite-gen"
import { CUSTOM_SPRITE_ID, SHARED_SPRITE_BASE, SHARED_SPRITE_MAX } from "~/lib/roster"
import { DIR_ROW, resolveSprite, sheetFormatFor, walkFrameFor } from "./spriteIndex"

const SHEET = "data:image/png;base64,iVBORw0KGgo="

describe("CUSTOM_SPRITE_ID", () => {
  it("sits outside the stock sheet range, so growing the range cannot swallow it", () => {
    // It used to be SPRITE_COUNT itself. Migration 0040 moved stored 6s off it
    // precisely because that coupling made a stored value mean something new
    // every time a sheet was added — this assertion is what keeps it apart.
    expect(CUSTOM_SPRITE_ID).toBeGreaterThan(CHAR_COUNT)
  })
})

describe("SHARED_SPRITE_BASE", () => {
  it("sits past CUSTOM_SPRITE_ID, so neither the stock pool nor CUSTOM can reach it", () => {
    expect(SHARED_SPRITE_BASE).toBeGreaterThan(CUSTOM_SPRITE_ID)
    expect(SHARED_SPRITE_BASE).toBeGreaterThan(CHAR_COUNT)
    // users.sprite_id is a smallint.
    expect(SHARED_SPRITE_MAX).toBe(32767)
  })
})

describe("DIR_ROW", () => {
  it("maps up→row 3, right→row 2, down→row 0, left→row 1", () => {
    expect(DIR_ROW).toEqual({ 0: 3, 1: 2, 2: 0, 3: 1 })
  })
  it("gives every direction its own in-bounds row, so nothing is ever mirrored", () => {
    const rows = ([0, 1, 2, 3] as const).map((d) => DIR_ROW[d])
    expect(new Set(rows).size).toBe(4)
    for (const r of rows) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(SPRITE_ROWS)
    }
  })
})

describe("resolveSprite", () => {
  it("null spriteId falls back to the derived hash", () => {
    expect(resolveSprite(null, null, 3, 2)).toEqual({
      kind: "builtin",
      charIdx: characterIdForPlayer(3, 2),
    })
  })
  it("an explicit built-in spriteId overrides the hash", () => {
    const idx = characterIdForPlayer(0, 0) === 3 ? 4 : 3
    expect(resolveSprite(idx, null, 0, 0)).toEqual({ kind: "builtin", charIdx: idx })
  })
  it("CUSTOM_SPRITE_ID with a stored sheet resolves to that sheet", () => {
    expect(resolveSprite(CUSTOM_SPRITE_ID, SHEET, 1, 1)).toEqual({
      kind: "custom",
      sheetDataUrl: SHEET,
    })
  })
  it("CUSTOM_SPRITE_ID without a sheet falls back to the derived hash", () => {
    expect(resolveSprite(CUSTOM_SPRITE_ID, null, 1, 1)).toEqual({
      kind: "builtin",
      charIdx: characterIdForPlayer(1, 1),
    })
  })
  it("a shared-library spriteId resolves to its sheet URL, whatever users.sprite_sheet holds", () => {
    expect(resolveSprite(SHARED_SPRITE_BASE + 3, null, 1, 1)).toEqual({
      kind: "custom",
      sheetDataUrl: "/api/shared-sprites/3",
    })
    expect(resolveSprite(SHARED_SPRITE_BASE + 3, SHEET, 1, 1)).toEqual({
      kind: "custom",
      sheetDataUrl: "/api/shared-sprites/3",
    })
  })
  it("out-of-range spriteIds fall back to the derived hash", () => {
    // Not CUSTOM_SPRITE_ID — that is the one out-of-range value with a meaning.
    for (const bogus of [-1, CHAR_COUNT + 1, CUSTOM_SPRITE_ID - 1, SHARED_SPRITE_BASE, SHARED_SPRITE_MAX + 1]) {
      expect(bogus).not.toBe(CUSTOM_SPRITE_ID)
      expect(resolveSprite(bogus, SHEET, 2, 0)).toEqual({
        kind: "builtin",
        charIdx: characterIdForPlayer(2, 0),
      })
    }
  })
})

describe("walkFrameFor", () => {
  it("plays the ping-pong 0→1→2→1 and never touches the pose columns", () => {
    const frames = Array.from({ length: 8 }, (_, step) => walkFrameFor(step))
    expect(frames).toEqual([0, 1, 2, 1, 0, 1, 2, 1])
    expect(frames).toEqual([...WALK_FRAME_SEQUENCE, ...WALK_FRAME_SEQUENCE])
  })
})

// ---------------------------------------------------------------------------
// Sheet format. ONE layout now — the format is not sniffed from the image any
// more, it is applied to whatever arrives. A sheet in the old 4×4 layout is
// meant to render wrong rather than be quietly accommodated.
// ---------------------------------------------------------------------------

describe("sheetFormatFor", () => {
  it("reads a 192×192 sheet as 6×4 cells of 32×48", () => {
    expect(sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H)).toMatchObject({
      cellW: SPRITE_CELL_W,
      cellH: SPRITE_CELL_H,
      cols: SPRITE_COLS,
      rows: SPRITE_ROWS,
    })
  })

  it("slices the raw Comfy export on the same grid, before it is downsampled", () => {
    expect(sheetFormatFor(768, 768)).toMatchObject({
      cellW: 128,
      cellH: 192,
      cols: SPRITE_COLS,
      rows: SPRITE_ROWS,
    })
  })

  // Deliberate, not an oversight: a 128×128 sheet is sliced on the 6×4 grid
  // like everything else and comes out garbled. That garbling is the signal
  // that the file still needs converting — detecting the old layout and
  // drawing it correctly is what would hide the work.
  it("does not special-case a sheet still in the old 4×4 layout", () => {
    const f = sheetFormatFor(128, 128)
    expect(f.cols).toBe(SPRITE_COLS)
    expect(f.rows).toBe(SPRITE_ROWS)
    expect(f.cellW).not.toBe(f.cellH)
  })

  it("stands on the mid-stride column, not on its column 0", () => {
    expect(sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H).standFrame).toBe(1)
  })

  it("walks the ping-pong, never reaching the attack or hurt columns", () => {
    const f = sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H)
    const used = new Set(Array.from({ length: 40 }, (_, s) => f.walkFrame(s)))
    expect([...used].sort()).toEqual([0, 1, 2])
  })

  it("never returns a frame or row outside the grid it describes", () => {
    for (const [w, h] of [
      [SPRITE_SHEET_W, SPRITE_SHEET_H],
      [768, 768],
      [128, 128],
      [0, 0],
    ] as const) {
      const f = sheetFormatFor(w, h)
      for (let step = 0; step < 40; step++) {
        expect(f.walkFrame(step)).toBeGreaterThanOrEqual(0)
        expect(f.walkFrame(step)).toBeLessThan(f.cols)
      }
      expect(f.standFrame).toBeLessThan(f.cols)
      for (const d of [0, 1, 2, 3] as const) expect(f.dirRow[d]).toBeLessThan(f.rows)
    }
  })

  it("clamps a degenerate size instead of dividing by zero", () => {
    // A texture that failed to decode reports 0×0; the room must still draw.
    const f = sheetFormatFor(0, 0)
    expect(f.cellW).toBeGreaterThanOrEqual(1)
    expect(f.cellH).toBeGreaterThanOrEqual(1)
  })
})
