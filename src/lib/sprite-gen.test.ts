import { describe, expect, it } from "vitest"
import {
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
  isSupportedSheetSize,
  keyOutBackground,
  parseImageDataUrl,
  pngDimensions,
} from "./sprite-gen"

/** Builds a WxH RGBA image from a color-keyed ASCII grid. */
function image(
  rows: string[],
  palette: Record<string, [number, number, number]>,
): Uint8ClampedArray {
  const h = rows.length
  const w = rows[0]!.length
  const rgba = new Uint8ClampedArray(w * h * 4)
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = palette[row[x]!]!
      const i = (y * w + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  })
  return rgba
}

function alphaGrid(rgba: Uint8ClampedArray, w: number, h: number): string[] {
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ""
    for (let x = 0; x < w; x++) row += rgba[(y * w + x) * 4 + 3] === 0 ? "." : "#"
    out.push(row)
  }
  return out
}

describe("keyOutBackground", () => {
  const GREEN: [number, number, number] = [40, 220, 60]
  const WHITE: [number, number, number] = [250, 250, 250]
  const RED: [number, number, number] = [200, 60, 40]

  it("keys a green background from the edges", () => {
    const rgba = image(
      ["ggggg", "ggrgg", "grrrg", "ggrgg", "ggggg"],
      { g: GREEN, r: RED },
    )
    keyOutBackground(rgba, 5, 5)
    expect(alphaGrid(rgba, 5, 5)).toEqual([".....", "..#..", ".###.", "..#..", "....."])
  })

  it("keys a WHITE background but keeps white pixels inside the character", () => {
    // w = background white, W = the character's white face — same color, but
    // enclosed by red so no border path reaches it.
    const rgba = image(
      ["wwwww", "wrrrw", "wrWrw", "wrrrw", "wwwww"],
      { w: WHITE, W: WHITE, r: RED },
    )
    keyOutBackground(rgba, 5, 5)
    expect(alphaGrid(rgba, 5, 5)).toEqual([".....", ".###.", ".###.", ".###.", "....."])
  })

  it("keeps character pixels that resemble neither background", () => {
    const rgba = image(["ggg", "grg", "ggg"], { g: GREEN, r: RED })
    keyOutBackground(rgba, 3, 3)
    expect(rgba[(1 * 3 + 1) * 4 + 3]).toBe(255)
  })

  it("removes the anti-aliased halo the flood fill leaves behind", () => {
    // h is a blend of the green background and the red character — the pixels
    // that straddle the silhouette in the model's output. They sit outside the
    // flood fill's tolerance (~114 away from the background, tolerance is 60)
    // and used to survive as a pale fringe around every sprite.
    const rgba = image(
      ["ggggg", "ghhhg", "ghrhg", "ghhhg", "ggggg"],
      { g: GREEN, r: RED, h: [120, 140, 50] },
    )
    keyOutBackground(rgba, 5, 5)
    expect(alphaGrid(rgba, 5, 5)).toEqual([".....", ".....", "..#..", ".....", "....."])
  })

  it("does NOT erode a character whose own color is close to the background", () => {
    // A light-grey character on white: every edge pixel is near the background
    // and would be eaten by a plain "pale pixels at the edge" rule. It survives
    // because the de-fringe only clears a pixel that is closer to the
    // background than the BODY it hangs off, and here they are equally close.
    const rgba = image(
      ["wwwww", "wLLLw", "wLLLw", "wLLLw", "wwwww"],
      { w: [250, 250, 250], L: [200, 200, 200] },
    )
    keyOutBackground(rgba, 5, 5)
    expect(alphaGrid(rgba, 5, 5)).toEqual([".....", ".###.", ".###.", ".###.", "....."])
  })

  it("tolerates a slightly uneven background", () => {
    const rgba = image(["gh", "hg"], {
      g: GREEN,
      h: [55, 205, 75], // off-green within tolerance
    })
    keyOutBackground(rgba, 2, 2)
    expect(alphaGrid(rgba, 2, 2)).toEqual(["..", ".."])
  })
})

/** Just enough of a PNG for the header checks: magic + IHDR width/height. */
function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13], 8) // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

describe("pngDimensions", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(pngDimensions(fakePng(SPRITE_SHEET_W, SPRITE_SHEET_H))).toEqual({
      width: 192,
      height: 192,
    })
  })

  it("accepts the one sheet contract and rejects everything else", () => {
    expect(isSupportedSheetSize(SPRITE_SHEET_W, SPRITE_SHEET_H)).toBe(true)
    // The raw Comfy export, the superseded 4x4 size, and a transposed pair.
    expect(isSupportedSheetSize(768, 768)).toBe(false)
    expect(isSupportedSheetSize(128, 128)).toBe(false)
    expect(isSupportedSheetSize(SPRITE_SHEET_H, 128)).toBe(false)
    expect(isSupportedSheetSize(0, 0)).toBe(false)
  })

  it("returns null for non-PNG bytes and truncated input", () => {
    expect(pngDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
    const jpeg = fakePng(1, 1)
    jpeg[0] = 0xff
    expect(pngDimensions(jpeg)).toBeNull()
  })
})

describe("parseImageDataUrl", () => {
  it("decodes a png data URL", () => {
    const b64 = Buffer.from(fakePng(2, 2)).toString("base64")
    const parsed = parseImageDataUrl(`data:image/png;base64,${b64}`)
    expect(parsed?.mime).toBe("image/png")
    expect(parsed && pngDimensions(parsed.bytes)).toEqual({ width: 2, height: 2 })
  })

  it("rejects other mimes, malformed prefixes, and non-base64 payloads", () => {
    expect(parseImageDataUrl("data:image/gif;base64,AAAA")).toBeNull()
    expect(parseImageDataUrl("data:image/png,plain")).toBeNull()
    expect(parseImageDataUrl("https://example.com/x.png")).toBeNull()
  })
})
