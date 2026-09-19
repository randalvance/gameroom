import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { decodePng } from "../../../scripts/png"
import { FIGHTER_ATLASES, PORTRAIT_ORDER } from "./fighter-atlases"

describe("shipped roster artwork", () => {
  it.each(PORTRAIT_ORDER)("%s has complete frames with transparent gutters and horizontal KO poses", id => {
    const atlas = FIGHTER_ATLASES[id]!
    const image = decodePng(readFileSync(resolve(process.cwd(), `public${atlas.url}`)))
    for (const frames of Object.values(atlas.poses)) for (const f of frames) {
      expect(f.x + f.w + 4).toBeLessThanOrEqual(image.width)
      expect(f.y + f.h + 4).toBeLessThanOrEqual(image.height)
      let visible = 0
      for (let y = f.y - 4; y < f.y + f.h + 4; y++) for (let x = f.x - 4; x < f.x + f.w + 4; x++) {
        const alpha = image.data[(y * image.width + x) * 4 + 3]
        if (x < f.x || x >= f.x + f.w || y < f.y || y >= f.y + f.h) {
          if (alpha !== 0) throw new Error(`${id}: neighboring pixels in gutter at ${x},${y}`)
        } else if (alpha) visible++
      }
      expect(visible).toBeGreaterThan(500)
    }
    for (const down of atlas.poses.down!.slice(2)) {
      expect(down.w).toBeGreaterThan(down.h * 2)
      expect(down.h).toBeLessThan(atlas.poses.idle[0]!.h * 0.55)
    }
  })

  it("decodes Primey's original indexed transparency for lossless pose reuse", () => {
    const image = decodePng(readFileSync(resolve(process.cwd(), "public/assets/arcade/fighter-primey.png")))
    expect(image.data[3]).toBe(0)
    const alpha = image.data.filter((_, i) => i % 4 === 3)
    expect(alpha.some(a => a === 255)).toBe(true)
  })
})
