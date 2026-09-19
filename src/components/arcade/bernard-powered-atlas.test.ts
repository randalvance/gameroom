import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { decodePng } from "../../../scripts/png"
import { BERNARD_POWERED } from "./bernard-powered.generated"
import { MOTION_ATLASES } from "./motion-atlases.generated"

const load = (url: string) => decodePng(readFileSync(resolve(process.cwd(), `public${url}`)))
describe("Bernard powered animation atlas", () => {
  it("preserves every original combat, walk, down and rain pixel", () => {
    const old = MOTION_ATLASES.bernard!, before = load(old.url), after = load(BERNARD_POWERED.url)
    for (const [pose, frames] of Object.entries(old.poses)) {
      expect(BERNARD_POWERED.poses[pose as keyof typeof old.poses]).toEqual(frames)
      for (const f of frames!) for (let y = 0; y < f.h; y++) {
        const a = ((f.y + y) * before.width + f.x) * 4, b = ((f.y + y) * after.width + f.x) * 4
        expect(Buffer.from(after.data.subarray(b, b + f.w * 4)).equals(Buffer.from(before.data.subarray(a, a + f.w * 4)))).toBe(true)
      }
    }
  })
  it("packs 24 complete special drawings in isolated transparent gutters", () => {
    const image = load(BERNARD_POWERED.url)
    const poses = ["specialCharge", "specialIce", "specialCircle", "specialOrb", "specialScan", "specialBreaking"] as const
    for (const pose of poses) {
      const frames = BERNARD_POWERED.poses[pose]!
      expect(frames).toHaveLength(4)
      for (const f of frames) {
        expect(f.ay).toBe(f.h)
        expect(f.h).toBeGreaterThan(100)
        expect(f.h).toBeLessThan(270)
        expect(f.ax).toBeGreaterThan(0)
        expect(f.ax).toBeLessThan(f.w)
        for (let y = -6; y < f.h + 6; y++) for (let x = -6; x < f.w + 6; x++) {
          if (x >= 0 && x < f.w && y >= 0 && y < f.h) continue
          expect(image.data[((f.y + y) * image.width + f.x + x) * 4 + 3]).toBe(0)
        }
      }
    }
  })
})
