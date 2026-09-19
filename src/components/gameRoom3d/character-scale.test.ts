import { describe, expect, it } from "vitest"
import { SPRITE_CELL_H, SPRITE_CELL_W, SPRITE_SHEET_H, SPRITE_SHEET_W } from "~/lib/sprite-gen"
import { sheetFormatFor } from "../gameRoom/spriteIndex"
import {
  CHARACTER_SCALE,
  CHARACTER_WORLD_HEIGHT,
  characterGroundY,
  characterPlaneSize,
  characterShadowLocalY,
  characterTopY,
} from "./character-scale"

/** The one sheet format there is. */
const SHEET = sheetFormatFor(SPRITE_SHEET_W, SPRITE_SHEET_H)

/** What a 32 px cell measured before the cast was scaled up. */
const BASE_HEIGHT = 2.5

describe("character scale", () => {
  it("stands a character 50% taller than the room's original art scale", () => {
    expect(CHARACTER_SCALE).toBeCloseTo(1.5)
    expect(CHARACTER_WORLD_HEIGHT).toBeCloseTo(BASE_HEIGHT * 1.5)
    expect(characterPlaneSize(SHEET).height).toBeCloseTo(BASE_HEIGHT * 1.5)
  })

  // The regression this exists for: world size used to be pixels × a constant,
  // so moving to a 48px-tall cell made the whole cast 1.5x bigger — taller ART
  // read as a taller PERSON. Standing height is now fixed and only the WIDTH
  // follows the cell, so a change of sheet format cannot resize the room.
  it("stands every cell size at the same height, whatever its pixel height", () => {
    expect(SHEET.cellW).toBe(SPRITE_CELL_W)
    expect(SHEET.cellH).toBe(SPRITE_CELL_H)
    for (const cell of [
      { cellW: 32, cellH: 48 },
      { cellW: 32, cellH: 32 },
      { cellW: 16, cellH: 32 },
      { cellW: 128, cellH: 192 },
    ]) {
      expect(characterPlaneSize(cell).height).toBeCloseTo(CHARACTER_WORLD_HEIGHT)
    }
  })

  it("takes the width from the cell's aspect, so the art is never stretched", () => {
    const { width, height } = characterPlaneSize(SHEET)
    expect(width / height).toBeCloseTo(SPRITE_CELL_W / SPRITE_CELL_H)
    // A 2:3 cell at the 3.75-unit standing height is 2.5 wide.
    expect(width).toBeCloseTo(BASE_HEIGHT)
    // Same art at 4x the pixels is the same size on screen.
    expect(characterPlaneSize({ cellW: 128, cellH: 192 }).width).toBeCloseTo(width)
  })

  it("never divides by a zero-size cell from a texture that failed to decode", () => {
    const { width, height } = characterPlaneSize({ cellW: 0, cellH: 0 })
    expect(Number.isFinite(width)).toBe(true)
    expect(height).toBeCloseTo(CHARACTER_WORLD_HEIGHT)
  })

  it("keeps a scaled character's feet on the floor rather than sunk or hovering", () => {
    const feet = characterGroundY(SHEET) - characterPlaneSize(SHEET).height / 2
    expect(feet).toBeGreaterThan(0)
    expect(feet).toBeLessThan(0.05)
  })

  it("keeps the contact shadow on the floor at the character's feet", () => {
    // The blob is a child of the character mesh, so a taller character has to
    // push it further down to leave it lying on the floor.
    const shadowWorldY = characterGroundY(SHEET) + characterShadowLocalY(SHEET)
    expect(shadowWorldY).toBeGreaterThan(0)
    expect(shadowWorldY).toBeLessThan(0.05)
  })

  it("puts the head where overhead markers and name tags hang from", () => {
    expect(characterTopY(SHEET)).toBeCloseTo(
      characterGroundY(SHEET) + characterPlaneSize(SHEET).height / 2,
    )
  })
})
