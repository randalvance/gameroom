// Guards the preview against going BLURRY, which is subtler than it sounds.
//
// Setting canvas.width or canvas.height resets the 2D context to its
// defaults, and one of those defaults is imageSmoothingEnabled = true. The
// draw loop starts when the sheet image decodes, but the canvas is sized from
// React state that only lands on the NEXT render — so if the pre-decode size
// guess disagrees with the real one, React rewrites the attribute, the
// context resets underneath the already-running loop, and every later frame is
// drawn smoothed. That is exactly what happened when cells went from 32×32 to
// 32×48 while the guess stayed square.
//
// The loop now re-asserts imageSmoothingEnabled every frame, which is the
// actual fix. This pins the other half: the guess matches the contract, so a
// conforming sheet never triggers the resize at all.
import { describe, expect, it } from "vitest"
import { SPRITE_SHEET_H, SPRITE_SHEET_W } from "~/lib/sprite-gen"
import { sheetFormatFor } from "~/components/gameRoom/spriteIndex"
import { previewCanvasSize } from "./SpriteWalkPreview"

const ROWS = [0, 1, 2, 3]

describe("previewCanvasSize", () => {
  it("guesses the same size before decode that it computes after", () => {
    const decoded = sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H)
    for (const scale of [1, 2, 3]) {
      for (const rows of [ROWS, [0], [0, 2]]) {
        expect(previewCanvasSize(null, rows, scale)).toEqual(
          previewCanvasSize(decoded, rows, scale),
        )
      }
    }
  })

  it("sizes the canvas from the cell, not from a square assumption", () => {
    const { width, height } = previewCanvasSize(null, [0], 2)
    expect(width).toBe(64) // one 32px-wide cell at 2x, no gaps
    expect(height).toBe(96) // …and 48px tall at 2x — NOT another 64
  })

  it("lays rows out side by side with a gap between them", () => {
    const one = previewCanvasSize(null, [0], 2)
    const four = previewCanvasSize(null, ROWS, 2)
    expect(four.height).toBe(one.height)
    expect(four.width).toBe(one.width * 4 + 8 * 3)
  })

  it("counts only the rows the decoded sheet actually has", () => {
    const decoded = sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H)
    // Row 9 does not exist; it must not reserve a slot in the canvas.
    expect(previewCanvasSize(decoded, [0, 9], 2)).toEqual(previewCanvasSize(decoded, [0], 2))
  })

  it("never returns a zero-width canvas, even asked for no rows", () => {
    const { width, height } = previewCanvasSize(null, [], 2)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})
