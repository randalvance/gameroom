import { describe, expect, it } from "vitest"
import { STAGE_WIDTH } from "./fight-sim"
import { STAGE } from "./stage-atlas.generated"
import { FAR_OVERSCAN, placeLayer, stageCameraOffset, stageFloorY, stageScale } from "./stage-parallax"

const VIEW = { w: 960, h: 540 }

describe("stage metadata", () => {
  it("is a 16:9 master with the floor band below the tables and the baseline on the floor", () => {
    expect(STAGE.width / STAGE.height).toBeCloseTo(16 / 9, 2)
    const { far, tables, floor } = STAGE.layers
    expect(far.factor).toBeGreaterThan(0)
    expect(tables.factor).toBeGreaterThan(far.factor)
    expect(floor.factor).toBe(0)
    expect(tables.y + tables.h).toBeLessThanOrEqual(floor.y + 10)
    expect(STAGE.footBaseline).toBeGreaterThan(floor.y)
    expect(STAGE.footBaseline).toBeLessThan(floor.y + floor.h)
  })
})

describe("stage placement", () => {
  it("maps the master onto the view width exactly and puts the floor line inside the lower half", () => {
    const s = stageScale(VIEW.h, VIEW.w)
    expect(STAGE.width * s).toBeGreaterThanOrEqual(VIEW.w)
    expect(STAGE.width * s).toBeLessThan(VIEW.w + 1)
    const floorY = stageFloorY(VIEW.h)
    expect(floorY).toBeGreaterThan(VIEW.h / 2)
    expect(floorY).toBeLessThan(VIEW.h)
  })

  it("the floor never moves, the tables slide a little, the far wall barely", () => {
    const at = (offset: number) => ({
      floor: placeLayer(STAGE.layers.floor, offset, VIEW).x,
      tables: placeLayer(STAGE.layers.tables, offset, VIEW).x,
      far: placeLayer(STAGE.layers.far, offset, VIEW).x,
    })
    const centre = at(0)
    const right = at(200)
    expect(right.floor).toBe(centre.floor)
    expect(centre.tables - right.tables).toBeCloseTo(200 * STAGE.layers.tables.factor, 5)
    expect(centre.far - right.far).toBeCloseTo(200 * STAGE.layers.far.factor, 5)
    expect(centre.tables - right.tables).toBeGreaterThan(centre.far - right.far)
  })

  it("keeps the far wall covering the whole frame across the fighters' full reach", () => {
    for (const offset of [-STAGE_WIDTH / 2, 0, STAGE_WIDTH / 2]) {
      const far = placeLayer(STAGE.layers.far, offset, VIEW)
      expect(far.x).toBeLessThanOrEqual(0)
      expect(far.x + far.w).toBeGreaterThanOrEqual(VIEW.w)
      expect(far.y).toBeLessThanOrEqual(0)
      expect(far.y + far.h).toBeCloseTo(VIEW.h, 5)
    }
    expect(placeLayer(STAGE.layers.far, 0, VIEW).w).toBeCloseTo(VIEW.w * FAR_OVERSCAN, -1)
  })

  it("reads the camera off the fighters' midpoint", () => {
    expect(stageCameraOffset([STAGE_WIDTH / 2, STAGE_WIDTH / 2], STAGE_WIDTH)).toBe(0)
    expect(stageCameraOffset([100, 300], STAGE_WIDTH)).toBe(200 - STAGE_WIDTH / 2)
  })
})
