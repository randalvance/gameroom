import { describe, expect, it } from "vitest"
import { PARTICIPANT_TABLES } from "../gameRoom/constants"
import {
  buildStaticColliders,
  pointBlocked,
  ROOM_BOUNDS,
  INTERACT_PROBE_PX,
  INTERACT_RANGE_PX,
} from "../../lib/gameRoomNet/collision"
import { visitorSpawnPoint } from "../../lib/gameRoomNet/spawn"
import { OBJECT_IDX_BASE, ROOM_OBJECTS } from "../../lib/gameRoomNet/objects"
import { resolveRoomInteract } from "../../lib/gameRoomNet/tables"
import { BIG_SCREEN_IDX } from "./wall"
import {
  PRIMEY_BODY_HEIGHT,
  PRIMEY_IDX,
  PRIMEY_POINT,
  PRIMEY_STRIP,
  primeyCenterY,
  primeyFrame,
  primeyFrameOffset,
  primeyPlaneSize,
} from "./primey-npc"

describe("PRIMEY_IDX", () => {
  it("cannot be mistaken for a character, a hub object or the wall screen", () => {
    // Character idxs are session-assigned small integers; objects and the
    // screen own the two ranges above them. A collision would send a chat
    // press at a plant, or a plant's line at the chat panel.
    expect(PRIMEY_IDX).toBeGreaterThan(OBJECT_IDX_BASE + ROOM_OBJECTS.length)
    expect(PRIMEY_IDX).not.toBe(BIG_SCREEN_IDX)
    expect(PRIMEY_IDX).toBeGreaterThan(BIG_SCREEN_IDX)
  })
})

describe("PRIMEY_POINT", () => {
  const colliders = buildStaticColliders()

  it("stands on floor a player can actually reach", () => {
    expect(pointBlocked(PRIMEY_POINT.x, PRIMEY_POINT.y, colliders)).toBe(false)
  })

  it("stays inside the room's walkable bounds", () => {
    expect(PRIMEY_POINT.x).toBeGreaterThan(ROOM_BOUNDS.minX)
    expect(PRIMEY_POINT.x).toBeLessThan(ROOM_BOUNDS.maxX)
    expect(PRIMEY_POINT.y).toBeGreaterThan(ROOM_BOUNDS.minY)
    expect(PRIMEY_POINT.y).toBeLessThan(ROOM_BOUNDS.maxY)
  })

  it("is south of every desk, so it never crowds a team's table", () => {
    const lastDeskEdge = Math.max(...PARTICIPANT_TABLES.map((t) => t.y + t.h))
    expect(PRIMEY_POINT.y).toBeGreaterThan(lastDeskEdge)
  })

  it("stands clear of every slot the arrivals scatter can put a visitor in", () => {
    // Primey used to stand dead centre, which is the middle of visitorSpawnPoint's
    // own box — visitors materialised inside the billboard, and a character on
    // top of Primey WINS the interact probe (nearest candidate), so a press
    // meant for the chat panel talked to them instead.
    //
    // The scatter's two moduli are 140 and 36, so 1260 idxs walk every slot it
    // can ever produce; none of them may land within the probe's reach.
    const reach = INTERACT_PROBE_PX + INTERACT_RANGE_PX
    let nearest = Infinity
    for (let idx = 0; idx < 1260; idx++) {
      const spawn = visitorSpawnPoint(idx, colliders)
      const d = Math.hypot(spawn.x - PRIMEY_POINT.x, spawn.y - PRIMEY_POINT.y)
      nearest = Math.min(nearest, d)
    }
    expect(nearest).toBeGreaterThan(reach)
  })

  it("is what interact resolves to for a player facing it from the south", () => {
    // Standing a probe's reach below Primey, facing north (WalkDir 0) — the
    // plants are in the candidate list too, so this also proves Primey is not
    // being shadowed by one of them.
    const target = resolveRoomInteract(
      { x: PRIMEY_POINT.x, y: PRIMEY_POINT.y + INTERACT_PROBE_PX, dir: 0 },
      [
        ...ROOM_OBJECTS.map((obj, i) => ({ key: OBJECT_IDX_BASE + i, x: obj.x, y: obj.y })),
        { key: PRIMEY_IDX, x: PRIMEY_POINT.x, y: PRIMEY_POINT.y },
      ],
    )
    expect(target).toEqual({ kind: "probe", key: PRIMEY_IDX })
  })
})

describe("the billboard's geometry", () => {
  it("draws Primey at its stated body height, art undistorted", () => {
    const { width, height } = primeyPlaneSize()
    // Square cell, square plane — the strip is 256px cells.
    expect(width).toBeCloseTo(height, 6)
    // The plane is TALLER than the body: the cell has empty art under the feet.
    expect(height).toBeGreaterThan(PRIMEY_BODY_HEIGHT)
  })

  it("puts the drawn feet on the floor rather than the frame's bottom edge", () => {
    const { height } = primeyPlaneSize()
    const bottomOfPlane = primeyCenterY() - height / 2
    // The plane hangs below y=0 by exactly the empty art under the feet, so
    // the feet themselves land on it — and the head, which is what anyone
    // actually sees, tops out at the stated body height.
    expect(bottomOfPlane).toBeLessThan(0)
    const bodyTop = bottomOfPlane + height * (244 / 256)
    expect(bodyTop).toBeCloseTo(PRIMEY_BODY_HEIGHT, 6)
  })

  it("stands shorter than a person", () => {
    expect(PRIMEY_BODY_HEIGHT).toBeLessThan(3.75)
  })
})

describe("primeyFrame", () => {
  it("starts on the first cell and holds it for one frame's worth of time", () => {
    expect(primeyFrame(0)).toBe(0)
    expect(primeyFrame(PRIMEY_STRIP.frameMs - 1)).toBe(0)
    expect(primeyFrame(PRIMEY_STRIP.frameMs)).toBe(1)
  })

  it("loops back to the first cell after the last one", () => {
    const cycle = PRIMEY_STRIP.frames * PRIMEY_STRIP.frameMs
    expect(primeyFrame(cycle - PRIMEY_STRIP.frameMs)).toBe(PRIMEY_STRIP.frames - 1)
    expect(primeyFrame(cycle)).toBe(0)
  })

  it("never walks the texture past the end of the strip", () => {
    const cycle = PRIMEY_STRIP.frames * PRIMEY_STRIP.frameMs
    for (let ms = 0; ms < cycle * 3; ms += 37) {
      const offset = primeyFrameOffset(ms)
      expect(offset).toBeGreaterThanOrEqual(0)
      // The last legal offset leaves exactly one cell's width to sample.
      expect(offset).toBeLessThanOrEqual(1 - 1 / PRIMEY_STRIP.frames + 1e-9)
    }
  })

  it("shrugs off a negative elapsed time rather than sampling off the strip", () => {
    expect(primeyFrame(-500)).toBe(0)
  })
})
