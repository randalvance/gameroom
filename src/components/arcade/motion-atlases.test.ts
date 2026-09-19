import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { decodePng } from "../../../scripts/png"
import { MOTION_ATLASES as FIGHTER_ATLASES } from "./motion-atlases.generated"
import { ROSTER_ATLASES } from "./roster-atlases.generated"

const ids = ["bull", "bear", "quant", "whale", "primey", "bernard"] as const

describe("v5 motion atlases", () => {
  it.each(ids)("%s preserves its approved v4 combat art exactly", id => {
    const before = ROSTER_ATLASES[id]!, after = FIGHTER_ATLASES[id]!
    const oldImage = decodePng(readFileSync(resolve(process.cwd(), `public${before.url}`)))
    const newImage = decodePng(readFileSync(resolve(process.cwd(), `public${after.url}`)))
    expect(newImage.width).toBeGreaterThanOrEqual(oldImage.width)
    expect(newImage.height).toBeGreaterThan(oldImage.height)
    for (const [pose, frames] of Object.entries(before.poses)) {
      if (pose !== "idle" || id !== "bear") expect(after.poses[pose as keyof typeof after.poses]).toEqual(frames)
      for (const frame of frames) {
        const oldPixels = Buffer.alloc(frame.w * frame.h * 4), newPixels = Buffer.alloc(oldPixels.length)
        for (let y = 0; y < frame.h; y++) {
          const oldStart = ((frame.y + y) * oldImage.width + frame.x) * 4
          const newStart = ((frame.y + y) * newImage.width + frame.x) * 4
          oldPixels.set(oldImage.data.subarray(oldStart, oldStart + frame.w * 4), y * frame.w * 4)
          newPixels.set(newImage.data.subarray(newStart, newStart + frame.w * 4), y * frame.w * 4)
        }
        expect(newPixels.equals(oldPixels)).toBe(true)
      }
    }
  })

  it.each(ids)("%s has four separate grounded walk drawings at idle scale", id => {
    const atlas = FIGHTER_ATLASES[id]!, walk = atlas.poses.walk!
    expect(walk).toHaveLength(4)
    const image = decodePng(readFileSync(resolve(process.cwd(), `public${atlas.url}`)))
    const signatures = walk.map(f => {
      expect(f.ay).toBe(f.h)
      expect(f.h / atlas.poses.idle[1]!.h).toBeGreaterThan(0.95)
      expect(f.h / atlas.poses.idle[1]!.h).toBeLessThan(1.05)
      let hash = 0
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const a = image.data[((f.y + y) * image.width + f.x + x) * 4 + 3]!
        hash = (hash * 33 + a + x * (a > 0 ? 1 : 0)) >>> 0
      }
      return hash
    })
    expect(new Set(signatures).size).toBe(4)
  })

  it("Bernard has a dedicated four-frame laser-rain casting sequence", () => {
    const special = FIGHTER_ATLASES.bernard!.poses.specialUp!
    expect(special).toHaveLength(4)
    expect(special.every(f => f.y > FIGHTER_ATLASES.bernard!.poses.walk![0]!.y)).toBe(true)
  })
})
