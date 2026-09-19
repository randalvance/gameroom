import { describe, expect, it } from "vitest"
import { CH, CW, WALL_Y } from "../../components/gameRoom/constants"
import { pointBlocked, buildStaticColliders } from "./collision"
import {
  OBJECT_IDX_BASE,
  objectSpeech,
  ROOM_OBJECTS,
  roomObjectByIdx,
  roomObjectIdx,
} from "./objects"

describe("room objects", () => {
  // The regression: these coordinates were a hand-copy of the scene's plant
  // billboards, so doubling the room's depth moved the plants you can see
  // while the plants you can talk to stayed at the old south wall. Pinning
  // them to the room's own corners is what keeps the two together.
  it("keeps the corner plants in the room's actual corners", () => {
    const at = (id: string) => ROOM_OBJECTS.find((o) => o.id === id)!
    const north = [at("plant-nw"), at("plant-ne")]
    const south = [at("plant-sw"), at("plant-se")]

    // Each pair shares a row, and the rows sit near opposite ends of the room.
    expect(north[0]!.y).toBe(north[1]!.y)
    expect(south[0]!.y).toBe(south[1]!.y)
    expect(north[0]!.y - WALL_Y).toBeLessThan((CH - WALL_Y) * 0.1)
    expect(CH - south[0]!.y).toBeLessThan((CH - WALL_Y) * 0.1)

    // West plants hug the west wall, east plants the east wall, symmetrically.
    for (const west of [at("plant-nw"), at("plant-sw")]) {
      expect(west.x).toBeLessThan(CW * 0.1)
    }
    for (const east of [at("plant-ne"), at("plant-se")]) {
      expect(CW - east.x).toBeLessThan(CW * 0.1)
    }
    expect(at("plant-nw").x).toBeCloseTo(CW - at("plant-ne").x, 6)
  })

  it("round-trips id ↔ idx through the object idx range", () => {
    for (const obj of ROOM_OBJECTS) {
      const idx = roomObjectIdx(obj.id)
      expect(idx).toBeGreaterThanOrEqual(OBJECT_IDX_BASE)
      expect(roomObjectByIdx(idx)?.id).toBe(obj.id)
    }
    expect(roomObjectByIdx(OBJECT_IDX_BASE + ROOM_OBJECTS.length)).toBeNull()
  })

  it("every object is reachable — a walkable point exists within reach", () => {
    // A player must be able to stand near enough to talk: probe the plan
    // around each object for an unblocked point inside interact distance.
    const colliders = buildStaticColliders()
    for (const obj of ROOM_OBJECTS) {
      let reachable = false
      for (let dx = -40; dx <= 40 && !reachable; dx += 8) {
        for (let dy = -40; dy <= 40 && !reachable; dy += 8) {
          if (Math.hypot(dx, dy) > 40) continue
          if (!pointBlocked(obj.x + dx, obj.y + dy, colliders)) reachable = true
        }
      }
      expect(reachable, `object ${obj.id} has no walkable spot in reach`).toBe(true)
    }
  })
})

describe("objectSpeech", () => {
  it("three of the plants only ever say the normal-plant line", () => {
    for (const id of ["plant-nw", "plant-ne", "plant-sw"]) {
      for (const count of [1, 5, 10, 50]) {
        expect(objectSpeech(id, count)).toBe("It's just a normal plant...")
      }
    }
  })

  it("the lower-right plant starts normal, changes every time, confesses on the tenth", () => {
    expect(objectSpeech("plant-se", 1)).toBe("It's just a normal plant...")
    const seen = new Set<string>()
    for (let count = 1; count <= 20; count++) {
      const line = objectSpeech("plant-se", count)
      expect(seen.has(line), `line for count ${count} repeats an earlier one`).toBe(false)
      seen.add(line)
    }
    expect(objectSpeech("plant-se", 10).toLowerCase()).toContain("you found my secret")
  })

  it("after the twentieth interaction it has nothing new left", () => {
    const last = objectSpeech("plant-se", 20)
    expect(objectSpeech("plant-se", 21)).toBe(last)
    expect(objectSpeech("plant-se", 500)).toBe(last)
  })
})
