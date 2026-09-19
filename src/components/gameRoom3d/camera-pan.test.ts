import { describe, expect, it } from "vitest"
import { CH, TILE, WALL_Y } from "../gameRoom/constants"
import { ROOM_BOUNDS } from "~/lib/gameRoomNet/collision"
import {
  clampRoomCameraPan,
  DRAG_PAN_THRESHOLD_PX,
  followRoomCameraPan,
  isDragPan,
  nextRoomCameraPan,
  panFromDrag,
  ROOM_CAMERA_MAX_PAN,
  ROOM_CAMERA_MAX_PAN_NORTH,
  ROOM_CAMERA_MAX_PAN_SOUTH,
  ROOM_CAMERA_PAN_STEP,
} from "./camera-pan"

const CENTRED = { x: 0, z: 0 }

describe("room camera pan", () => {
  it("moves the camera against the drag, so the grabbed spot stays put", () => {
    // Pull the floor to the right and the camera slides left to follow it —
    // the opposite sign reads as the room sliding away from the cursor.
    expect(panFromDrag(CENTRED, { x: 4, z: 0 })).toEqual({ x: -4, z: 0 })
    expect(panFromDrag(CENTRED, { x: 0, z: -3 })).toEqual({ x: 0, z: 3 })
  })

  it("measures a drag from where it started, not from the last frame", () => {
    // Each move re-derives the pan from the drag's origin, so a rounding error
    // in one frame cannot accumulate over a long drag.
    const start = { x: 5, z: -2 }
    expect(panFromDrag(start, { x: 3, z: 3 })).toEqual({ x: 2, z: -5 })
    expect(panFromDrag(start, { x: 6, z: 6 })).toEqual({ x: -1, z: -8 })
  })

  it("holds a long drag at the same limit the keyboard stops at", () => {
    const dragged = panFromDrag(CENTRED, { x: -500, z: 500 })
    expect(dragged).toEqual({ x: ROOM_CAMERA_MAX_PAN, z: -ROOM_CAMERA_MAX_PAN_NORTH })

    let keyed = CENTRED
    for (let press = 0; press < 100; press++) keyed = nextRoomCameraPan(keyed, "right")
    expect(keyed.x).toBe(ROOM_CAMERA_MAX_PAN)
  })

  it("lets the view reach the last row of desks without cropping them", () => {
    // The regression: a 4-unit southern leash put the bottom of the frame in
    // FRONT of the walk bounds, so anyone standing at the last row of desks
    // lost their legs to the screen edge. The camera's home target sits at
    // ROOM_D * 0.4, so covering a character at the far edge of the walkable
    // floor costs (maxWalkableZ - target) units of southward pan.
    const roomDepth = (CH - WALL_Y) / TILE
    const maxWalkableZ = (ROOM_BOUNDS.maxY - WALL_Y) / TILE
    const homeTargetZ = roomDepth * 0.4
    // Allow for the frame bottom sitting a little short of the camera's own
    // target; the cap must still clear most of that gap.
    expect(ROOM_CAMERA_MAX_PAN_SOUTH).toBeGreaterThan((maxWalkableZ - homeTargetZ) * 0.25)
  })

  it("stops a southward pan before the tower facade enters the frame", () => {
    // Below the floor slab the building is bare dark boxes; the south leash is
    // deliberately much shorter than the north one so the frame never tips
    // down onto that facade.
    expect(ROOM_CAMERA_MAX_PAN_SOUTH).toBeLessThan(ROOM_CAMERA_MAX_PAN_NORTH)
    expect(clampRoomCameraPan({ x: 0, z: 999 })).toEqual({ x: 0, z: ROOM_CAMERA_MAX_PAN_SOUTH })
    let keyed = CENTRED
    for (let press = 0; press < 100; press++) keyed = nextRoomCameraPan(keyed, "down")
    expect(keyed.z).toBe(ROOM_CAMERA_MAX_PAN_SOUTH)
  })

  it("treats a press that barely moves as a click, not a pan", () => {
    // Otherwise the wobble between pressing and releasing eats the click that
    // selects a student.
    expect(isDragPan(0, 0)).toBe(false)
    expect(isDragPan(2, 2)).toBe(false)
    expect(isDragPan(DRAG_PAN_THRESHOLD_PX, 0)).toBe(true)
    expect(isDragPan(0, -DRAG_PAN_THRESHOLD_PX)).toBe(true)
  })

  it("keeps drag and keyboard on one shared limit", () => {
    expect(clampRoomCameraPan({ x: 999, z: -999 })).toEqual({
      x: ROOM_CAMERA_MAX_PAN,
      z: -ROOM_CAMERA_MAX_PAN_NORTH,
    })
    expect(nextRoomCameraPan(CENTRED, "left")).toEqual({ x: -ROOM_CAMERA_PAN_STEP, z: 0 })
    expect(nextRoomCameraPan({ x: 7, z: 7 }, "center")).toEqual(CENTRED)
  })

  it("hands a drag back to the keyboard where it left off", () => {
    const dragged = panFromDrag(CENTRED, { x: -6, z: 0 })
    expect(nextRoomCameraPan(dragged, "right")).toEqual({
      x: 6 + ROOM_CAMERA_PAN_STEP,
      z: 0,
    })
  })
})

describe("followRoomCameraPan", () => {
  it("eases toward the target without overshooting", () => {
    const target = { x: 10, z: -6 }
    let pan = { x: 0, z: 0 }
    let previousDist = Math.hypot(target.x, target.z)
    for (let frame = 0; frame < 120; frame++) {
      pan = followRoomCameraPan(pan, target, 1)
      const dist = Math.hypot(target.x - pan.x, target.z - pan.z)
      expect(dist).toBeLessThanOrEqual(previousDist)
      previousDist = dist
    }
    // two seconds of chasing lands essentially on the character
    expect(pan.x).toBeCloseTo(target.x, 1)
    expect(pan.z).toBeCloseTo(target.z, 1)
  })

  it("chases a clamped target when the character walks past the pan limit", () => {
    let pan = { x: 0, z: 0 }
    for (let frame = 0; frame < 240; frame++) {
      pan = followRoomCameraPan(pan, { x: ROOM_CAMERA_MAX_PAN + 30, z: 0 }, 1)
    }
    expect(pan.x).toBeLessThanOrEqual(ROOM_CAMERA_MAX_PAN)
    expect(pan.x).toBeCloseTo(ROOM_CAMERA_MAX_PAN, 1)
  })

  it("drops the leash for noclip, so the camera follows a player out of the room", () => {
    const target = { x: ROOM_CAMERA_MAX_PAN + 30, z: ROOM_CAMERA_MAX_PAN_SOUTH + 20 }
    let pan = { x: 0, z: 0 }
    for (let frame = 0; frame < 240; frame++) {
      pan = followRoomCameraPan(pan, target, 1, { unclamped: true })
    }
    expect(pan.x).toBeCloseTo(target.x, 1)
    expect(pan.z).toBeCloseTo(target.z, 1)
  })

  it("covers the same ground for the same sim steps, batched or not", () => {
    const target = { x: 8, z: 4 }
    let a = { x: -3, z: 2 }
    for (let i = 0; i < 4; i++) a = followRoomCameraPan(a, target, 1)
    const b = followRoomCameraPan({ x: -3, z: 2 }, target, 4)
    expect(a.x).toBeCloseTo(b.x, 6)
    expect(a.z).toBeCloseTo(b.z, 6)
  })
})
