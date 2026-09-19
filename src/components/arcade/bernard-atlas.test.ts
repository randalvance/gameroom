import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { decodePng } from "../../../scripts/png"
import { BERNARD_ATLAS } from "./bernard-sprite-atlas.generated"

const atlas = decodePng(readFileSync(`public${BERNARD_ATLAS.url}`))
const alpha = (x: number, y: number) => atlas.data[(y * atlas.width + x) * 4 + 3]!

describe("Bernard's shipped sprite pixels", () => {
  it("has no magenta fringe", () => {
    let magenta = 0
    for (let i = 0; i < atlas.data.length; i += 4) {
      const [r, g, b, a] = atlas.data.subarray(i, i + 4)
      if (a! > 0 && r! > g! + 10 && b! > g! + 10) magenta++
    }
    expect(magenta).toBe(0)
  })

  it("isolates every complete figure inside transparent gutters", () => {
    for (const [pose, frames] of Object.entries(BERNARD_ATLAS.poses)) for (const [index, frame] of frames.entries()) {
      const {x,y,w,h} = frame
      expect(x + w + 4).toBeLessThan(atlas.width)
      expect(y + h + 4).toBeLessThan(atlas.height)
      for (let py = y - 4; py < y + h + 4; py++) for (let px = x - 4; px < x + w + 4; px++) {
        if (px < x || px >= x + w || py < y || py >= y + h) expect(alpha(px,py), `${pose}/${index} gutter`).toBe(0)
      }
      // A substantial disconnected component would be a neighboring hand or
      // boot. Tiny disconnected antialias pixels do not count as another body.
      const seen = new Set<number>()
      const components: number[] = []
      for(let p=0;p<w*h;p++) {
        if(seen.has(p) || !alpha(x+p%w,y+Math.floor(p/w))) continue
        const queue=[p];seen.add(p)
        for(let j=0;j<queue.length;j++) {
          const at=queue[j]!,cx=at%w,cy=Math.floor(at/w)
          for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
            const nx=cx+dx,ny=cy+dy,n=ny*w+nx
            if(nx>=0&&nx<w&&ny>=0&&ny<h&&!seen.has(n)&&alpha(x+nx,y+ny)) {seen.add(n);queue.push(n)}
          }
        }
        if(queue.length>16) components.push(queue.length)
      }
      expect(components, `${pose}/${index} figures`).toHaveLength(1)
    }
  })

  it("keeps tucked jump poses shorter than standing poses without enlarging the body", () => {
    const standing = BERNARD_ATLAS.poses.idle[0]!.h
    expect(BERNARD_ATLAS.poses.jump[0]!.h).toBeLessThan(standing * 0.9)
    expect(BERNARD_ATLAS.poses.jump[2]!.h).toBeLessThan(standing * 0.9)
    for(const frame of BERNARD_ATLAS.poses.ranged) {
      expect(frame.h / standing).toBeGreaterThan(0.9)
      expect(frame.h / standing).toBeLessThan(1.1)
    }
  })
})
