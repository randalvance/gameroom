import { describe, expect, it } from "vitest"
import { PARTICIPANT_TABLES, CW, CH, WALL_Y } from "../../components/gameRoom/constants"
import { WALK_PAD, walkPos } from "../../components/gameRoom3d/walk-path"
import {
  buildStaticColliders,
  facingForInput,
  interactTarget,
  movePlayer,
  nearestFreePoint,
  pointBlocked,
  INTERACT_PROBE_PX,
  PLAYER_SPEED_PX_PER_STEP,
  ROOM_BOUNDS,
} from "./collision"

const COLLIDERS = buildStaticColliders()

describe("buildStaticColliders", () => {
  it("blocks every participant table's centre", () => {
    for (const tbl of PARTICIPANT_TABLES) {
      expect(pointBlocked(tbl.x + tbl.w / 2, tbl.y + tbl.h / 2, COLLIDERS)).toBe(true)
    }
  })

  it("keeps the wander orbit walkable — colliders inflate less than WALK_PAD", () => {
    // Sample every table's full orbit: a controlled player must be able to
    // stand anywhere the idle cast walks.
    for (let teamIdx = 0; teamIdx < PARTICIPANT_TABLES.length; teamIdx++) {
      const tbl = PARTICIPANT_TABLES[teamIdx]!
      const perim = 2 * (tbl.w + 2 * WALK_PAD + tbl.h + 2 * WALK_PAD)
      for (let p = 0; p < perim; p += 4) {
        const pos = walkPos(p, tbl)
        expect(pointBlocked(pos.x, pos.y, COLLIDERS)).toBe(false)
      }
    }
  })

  it("blocks outside the room bounds", () => {
    expect(pointBlocked(-5, 200, COLLIDERS)).toBe(true)
    expect(pointBlocked(CW + 5, 200, COLLIDERS)).toBe(true)
    expect(pointBlocked(400, WALL_Y, COLLIDERS)).toBe(true)
    expect(pointBlocked(400, CH + 5, COLLIDERS)).toBe(true)
    expect(pointBlocked(400, 300, COLLIDERS)).toBe(false)
  })

  it("leaves the whole strip under the wall screen walkable", () => {
    // The judges' desks used to line this wall and block it. They are gone,
    // and the screen's interact point is only reachable because nothing
    // stands here any more.
    for (const x of [120, CW / 2, CW - 120]) {
      expect(pointBlocked(x, 100, COLLIDERS)).toBe(false)
      expect(pointBlocked(x, 130, COLLIDERS)).toBe(false)
    }
  })
})

describe("movePlayer", () => {
  it("moves freely in open floor", () => {
    const r = movePlayer(400, 300, 2, -2, COLLIDERS)
    expect(r).toEqual({ x: 402, y: 298, moved: true })
  })

  it("slides along a collider instead of sticking", () => {
    // Just left of table 0 (x: 25..113 inflated by 17 → blocked from x=8;
    // use the second table, x: 173): stand left of its inflated edge and
    // push diagonally into it — x is cancelled, y still applies.
    const tbl = PARTICIPANT_TABLES[1]!
    const x = tbl.x - 18 // 1px outside the inflated edge (inflate = 17)
    const y = tbl.y + tbl.h / 2
    const r = movePlayer(x, y, 2, 2, COLLIDERS)
    expect(r.x).toBe(x) // pushed into the table: cancelled
    expect(r.y).toBe(y + 2) // slides down the edge
    expect(r.moved).toBe(true)
  })

  it("cannot leave the room", () => {
    const r = movePlayer(ROOM_BOUNDS.minX, 300, -5, 0, COLLIDERS)
    expect(r.x).toBe(ROOM_BOUNDS.minX)
    expect(r.moved).toBe(false)
  })

  it("one step at PLAYER_SPEED stays a plausible stride", () => {
    // Guards the speed constant against accidental unit drift (world units vs
    // px): a step should be a couple of px, not a tile-sized leap.
    expect(PLAYER_SPEED_PX_PER_STEP).toBeGreaterThan(0.5)
    expect(PLAYER_SPEED_PX_PER_STEP).toBeLessThan(4)
  })
})

describe("facingForInput", () => {
  it("maps axes to WalkDir (0 up, 1 right, 2 down, 3 left)", () => {
    expect(facingForInput(1, 0, 0)).toBe(1)
    expect(facingForInput(-1, 0, 0)).toBe(3)
    expect(facingForInput(0, 1, 0)).toBe(2)
    expect(facingForInput(0, -1, 2)).toBe(0)
  })

  it("keeps the previous facing when still", () => {
    expect(facingForInput(0, 0, 3)).toBe(3)
  })

  it("horizontal wins diagonal ties", () => {
    expect(facingForInput(1, 1, 0)).toBe(1)
  })
})

describe("interactTarget", () => {
  it("targets a character directly ahead", () => {
    const hit = interactTarget(
      { x: 400, y: 300, dir: 1 },
      [{ key: 7, x: 400 + INTERACT_PROBE_PX + 4, y: 302 }],
    )
    expect(hit?.key).toBe(7)
  })

  it("ignores a character behind the facing", () => {
    const hit = interactTarget(
      { x: 400, y: 300, dir: 1 },
      [{ key: 7, x: 400 - INTERACT_PROBE_PX, y: 300 }],
    )
    expect(hit).toBeNull()
  })

  it("picks the nearest of several in range", () => {
    const hit = interactTarget(
      { x: 400, y: 300, dir: 2 },
      [
        { key: 1, x: 402, y: 300 + INTERACT_PROBE_PX + 8 },
        { key: 2, x: 400, y: 300 + INTERACT_PROBE_PX + 2 },
      ],
    )
    expect(hit?.key).toBe(2)
  })

  it("returns null when nobody is near the probe", () => {
    expect(interactTarget({ x: 400, y: 300, dir: 0 }, [{ key: 1, x: 600, y: 450 }])).toBeNull()
  })
})

describe("nearestFreePoint", () => {
  it("leaves a point that is already on open floor exactly where it is", () => {
    const colliders = buildStaticColliders()
    const open = { x: CW / 2, y: CH - 40 }
    expect(pointBlocked(open.x, open.y, colliders)).toBe(false)
    expect(nearestFreePoint(open.x, open.y, colliders)).toEqual(open)
  })

  it("pushes a point out of a desk it was buried in", () => {
    const colliders = buildStaticColliders()
    const desk = PARTICIPANT_TABLES[0]!
    const middle = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
    expect(pointBlocked(middle.x, middle.y, colliders)).toBe(true)

    const freed = nearestFreePoint(middle.x, middle.y, colliders)
    expect(pointBlocked(freed.x, freed.y, colliders)).toBe(false)
    // It escapes the desk rather than teleporting across the room.
    expect(Math.hypot(freed.x - middle.x, freed.y - middle.y)).toBeLessThan(200)
  })

  it("finds open floor from anywhere on the plan", () => {
    const colliders = buildStaticColliders()
    for (let x = 20; x < CW; x += 37) {
      for (let y = WALL_Y + 20; y < CH; y += 41) {
        const freed = nearestFreePoint(x, y, colliders)
        expect(pointBlocked(freed.x, freed.y, colliders), `stuck at ${x},${y}`).toBe(false)
      }
    }
  })
})
