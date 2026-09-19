import { describe, expect, it } from "vitest"
import { CROWN_KINDS, crownPalette, CROWN_SPRITE_PX, drawCrown } from "./crown-sprites"
import type { CrownKind } from "./crowns"

describe("crownPalette", () => {
  it("dresses every crown the room can wear", () => {
    for (const kind of CROWN_KINDS) {
      const paint = crownPalette(kind)
      expect(paint.body, kind).toMatch(/^#[0-9A-F]{6}$/i)
      expect(paint.trim, kind).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it("keeps the three egg tiers apart, since they share a shape", () => {
    const bronze = crownPalette("bronze").body
    const silver = crownPalette("silver").body
    const gold = crownPalette("gold").body

    expect(new Set([bronze, silver, gold]).size).toBe(3)
  })

  it("gives every crown the same outline, so they read as one family", () => {
    const outlines = new Set(CROWN_KINDS.map((kind) => crownPalette(kind).outline))

    expect(outlines.size).toBe(1)
  })
})

describe("the sprite sheet", () => {
  it("draws every kind at the same size", () => {
    expect(CROWN_SPRITE_PX).toBe(16)
  })

  it("covers the four role markers and the three tiers", () => {
    expect([...CROWN_KINDS].sort()).toEqual(
      ["bronze", "compass", "eye", "gold", "jewel", "scales", "silver"],
    )
  })
})

/**
 * Rasterise one sprite into a 16x16 grid of fill colours, so the art itself can
 * be asserted on: "" is an untouched pixel.
 */
function paint(kind: CrownKind): string[][] {
  const grid: string[][] = Array.from({ length: CROWN_SPRITE_PX }, () =>
    Array.from({ length: CROWN_SPRITE_PX }, () => ""),
  )
  const ctx = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      for (let row = y; row < y + h; row++) {
        const line = grid[row]
        if (!line) continue
        for (let col = x; col < x + w; col++) {
          if (line[col] !== undefined) line[col] = this.fillStyle
        }
      }
    },
  }
  drawCrown(ctx as unknown as CanvasRenderingContext2D, kind)
  return grid
}

describe("the role markers", () => {
  it("keeps every crown inside its own tile", () => {
    for (const kind of CROWN_KINDS) {
      const spilled = { fillStyle: "", count: 0 }
      const ctx = {
        fillStyle: "",
        fillRect(x: number, y: number, w: number, h: number) {
          if (x < 0 || y < 0 || x + w > CROWN_SPRITE_PX || y + h > CROWN_SPRITE_PX) spilled.count++
        },
      }
      drawCrown(ctx as unknown as CanvasRenderingContext2D, kind)
      expect(spilled.count, kind).toBe(0)
    }
  })

  // Mentor.
  it("rings the mentor's compass face in its case", () => {
    const paint_ = crownPalette("compass")
    const middle = paint("compass")[8] ?? []

    // Case outside, face inside, on both sides of the needle.
    expect(middle.indexOf(paint_.body)).toBeLessThan(middle.indexOf(paint_.trim))
    expect(middle.lastIndexOf(paint_.trim)).toBeLessThan(middle.lastIndexOf(paint_.body))
  })

  it("settles the needle inside the compass face", () => {
    const grid = paint("compass")
    const paint_ = crownPalette("compass")
    const needle: Array<[number, number]> = []
    grid.forEach((row, y) => row.forEach((px, x) => { if (px === paint_.shade) needle.push([y, x]) }))

    expect(needle.length).toBeGreaterThanOrEqual(6)
    // Every scrap of it sits on the face, never over the case or the outline.
    for (const [y, x] of needle) {
      const left = (grid[y] ?? []).slice(0, x)
      const right = (grid[y] ?? []).slice(x + 1)
      expect(left, `row ${y}`).toContain(paint_.trim)
      expect(right, `row ${y}`).toContain(paint_.trim)
    }
  })

  // Judge.
  it("hangs the judge's scales evenly, a tray either side of the post", () => {
    const grid = paint("scales")

    for (const [y, row] of grid.entries()) {
      expect(row, `row ${y}`).toEqual([...row].reverse())
    }
  })

  it("stands the scales on a post, from the beam down to a wider foot", () => {
    const grid = paint("scales")
    const post = (y: number) => Boolean(grid[y]?.[7] && grid[y]?.[8])

    // Unbroken down the middle: a wreath is hollow here, a balance is not.
    for (let y = 4; y <= 13; y++) expect(post(y), `post at row ${y}`).toBe(true)

    const width = (y: number) => (grid[y] ?? []).filter(Boolean).length
    expect(width(14)).toBeGreaterThan(width(10))
  })
})
