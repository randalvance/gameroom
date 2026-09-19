import { describe, expect, it } from "vitest"
import {
  BROADCAST_INSET,
  broadcastFitRect,
  broadcastWorldRect,
  videoFitRect,
} from "./market-news-video"

describe("videoFitRect", () => {
  it("pillarboxes a 16:9 broadcast into the wall's 4.1:1 strip", () => {
    const rect = videoFitRect(1280, 720, 1920, 468)
    // Height binds: the video fills the strip top to bottom and is centred.
    expect(rect.height).toBe(468)
    expect(rect.width).toBe(832)
    expect(rect.y).toBe(0)
    expect(rect.x).toBe((1920 - 832) / 2)
  })

  it("letterboxes a source wider than the strip rather than cropping it", () => {
    const rect = videoFitRect(4000, 500, 1920, 468)
    expect(rect.width).toBe(1920)
    expect(rect.height).toBe(240)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe((468 - 240) / 2)
  })

  it("fills the strip exactly when the aspects already agree", () => {
    expect(videoFitRect(1920, 468, 1920, 468)).toEqual({ x: 0, y: 0, width: 1920, height: 468 })
  })

  it("gives an empty rect for a video whose dimensions are not known yet", () => {
    // A <video> reports 0x0 until metadata lands; drawing that throws.
    expect(videoFitRect(0, 0, 1920, 468)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe("broadcastWorldRect", () => {
  // The room's actual numbers: a 1920x468 texture on a 49.2 x 12 plane whose
  // middle sits 7 units off the floor.
  const TEX = { w: 1920, h: 468 }
  const PLANE = { w: 49.2, h: 12, centreY: 7 }
  const world = (fit: { x: number; y: number; width: number; height: number }) =>
    broadcastWorldRect(fit, TEX.w, TEX.h, PLANE.w, PLANE.h, PLANE.centreY)

  it("measures a full-height broadcast as its own 16:9 slab, not the whole wall", () => {
    // What the camera should frame is the PICTURE — framing the 4.1:1 wall
    // around it is what leaves most of a 16:9 viewport on floor and ceiling.
    const rect = world(videoFitRect(1280, 720, TEX.w, TEX.h))
    expect(rect.width).toBeCloseTo(21.32, 2)
    expect(rect.height).toBeCloseTo(12, 5)
    // Only to 2dp: the texture is 4.1026:1 on a 4.1:1 plane, so the screen
    // stretches everything by 0.06% before the video gets there.
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 2)
    // Filling the height, it is centred on the screen's own middle.
    expect(rect.centreY).toBeCloseTo(7, 5)
  })

  it("puts a letterboxed picture's centre where it actually sits on the wall", () => {
    // A source wider than 16:9 leaves slack top and bottom; the centre stays
    // mid-screen because videoFitRect centres it.
    const rect = world(videoFitRect(4000, 500, TEX.w, TEX.h))
    expect(rect.centreY).toBeCloseTo(7, 5)
    expect(rect.width).toBeCloseTo(49.2, 5)
  })

  it("reads a rect sitting high on the texture as high on the wall", () => {
    // Texture y counts DOWN from the screen's top edge, world y counts up —
    // getting this backwards would frame the floor under the screen.
    const rect = world({ x: 0, y: 0, width: 1920, height: 234 })
    expect(rect.height).toBeCloseTo(6, 5)
    expect(rect.centreY).toBeCloseTo(10, 5)
  })
})

describe("broadcastFitRect", () => {
  // The room's screen texture, and the blue border the canvas strokes round it.
  const TEX = { w: 1920, h: 468 }

  it("keeps clear of the screen's painted border on every side", () => {
    // The border is drawn before the picture, so a picture reaching the canvas
    // edge paints straight over it and the screen loses its frame.
    const rect = broadcastFitRect(1280, 720, TEX.w, TEX.h)
    expect(rect.y).toBeGreaterThanOrEqual(BROADCAST_INSET)
    expect(rect.x).toBeGreaterThanOrEqual(BROADCAST_INSET)
    expect(rect.y + rect.height).toBeLessThanOrEqual(TEX.h - BROADCAST_INSET)
    expect(rect.x + rect.width).toBeLessThanOrEqual(TEX.w - BROADCAST_INSET)
  })

  it("still gives height to the picture, since height is what binds", () => {
    const rect = broadcastFitRect(1280, 720, TEX.w, TEX.h)
    expect(rect.height).toBeCloseTo(TEX.h - BROADCAST_INSET * 2, 5)
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 3)
  })

  it("centres the picture on the screen", () => {
    const rect = broadcastFitRect(1280, 720, TEX.w, TEX.h)
    expect(rect.x + rect.width / 2).toBeCloseTo(TEX.w / 2, 5)
    expect(rect.y + rect.height / 2).toBeCloseTo(TEX.h / 2, 5)
  })

  it("reports nothing for a video whose dimensions are not known yet", () => {
    expect(broadcastFitRect(0, 0, TEX.w, TEX.h).width).toBe(0)
  })
})
