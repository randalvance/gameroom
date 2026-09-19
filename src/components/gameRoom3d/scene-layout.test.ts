import { describe, expect, it } from "vitest"
import { CH, TILE, WALL_Y } from "../gameRoom/constants"
import { NOMINAL_CHARACTER_SIZE } from "./character-scale"
import { assignmentSceneLayout, lobbyPosition } from "./scene-layout"
import { FACING_CAMERA } from "./walk-path"

const ROOM_DEPTH = (CH - WALL_Y) / TILE

/** The closest any two waiting students stand, in body widths. */
function closestPairInBodyWidths(rosterSize: number): number {
  const layout = assignmentSceneLayout(rosterSize)
  const spots = Array.from({ length: rosterSize }, (_, i) => lobbyPosition(i, layout))
  let closest = Infinity
  for (let a = 0; a < spots.length; a++) {
    for (let b = a + 1; b < spots.length; b++) {
      const dx = spots[a]!.x - spots[b]!.x
      const dz = spots[a]!.z - spots[b]!.z
      closest = Math.min(closest, Math.hypot(dx, dz))
    }
  }
  return closest / NOMINAL_CHARACTER_SIZE.width
}

describe("assignment scene layout", () => {
  it("places a large roster's last local arrival inside the generated platform", () => {
    const layout = assignmentSceneLayout(550)
    const last = lobbyPosition(549, layout)

    expect(last.x).toBeLessThan(layout.lobbyStartX + layout.lobbyWidth)
    expect(last.z).toBeLessThan(layout.lobbyDepth)
    expect(layout.capacity).toBeGreaterThanOrEqual(550)
  })

  it("expands platform geometry and camera framing with the finite roster", () => {
    const ordinary = assignmentSceneLayout(12)
    const large = assignmentSceneLayout(550)

    expect(large.lobbyWidth).toBeGreaterThan(ordinary.lobbyWidth)
    expect(large.lobbyDepth).toBeGreaterThanOrEqual(ordinary.lobbyDepth)
    expect(large.camera.distance).toBeGreaterThan(ordinary.camera.distance)
    expect(large.camera.far).toBeGreaterThan(large.camera.distance * 2)
    expect(large.camera.targetZ).toBe(large.lobbyDepth / 2)
  })

})

describe("arrivals lobby spacing", () => {
  it("leaves waiting students most of a body width apart, at every roster size", () => {
    // The bug: a fixed 1.5 × 1.25 world-unit grid, against sprites 3.75 wide —
    // barely a third of a body — so the platform read as one clump of heads.
    for (const rosterSize of [4, 12, 30, 50, 120]) {
      expect(closestPairInBodyWidths(rosterSize)).toBeGreaterThan(0.75)
    }
  })

  it("spaces by the character's own size, so it survives a rescale", () => {
    // Spacing is a fraction of NOMINAL_CHARACTER_SIZE rather than a literal, so
    // this holds in body widths however big the cast is drawn.
    const layout = assignmentSceneLayout(50)
    const neighbour = Math.abs(lobbyPosition(1, layout).x - lobbyPosition(0, layout).x)
    expect(neighbour).toBeCloseTo(NOMINAL_CHARACTER_SIZE.width * 0.8)
  })

  it("stands waiting students face-on to the camera, not backs turned", () => {
    // dir 0 — the old hardcoded value — is the row drawn from BEHIND on both
    // sheet layouts, so the arrivals hall was a crowd of turned backs.
    const layout = assignmentSceneLayout(50)
    for (const ordinal of [0, 1, layout.columns, 49]) {
      expect(lobbyPosition(ordinal, layout).dir).toBe(FACING_CAMERA)
      expect(lobbyPosition(ordinal, layout).dir).not.toBe(0)
    }
  })

  it("staggers alternate rows so nobody hides directly behind anybody", () => {
    const layout = assignmentSceneLayout(50)
    const front = lobbyPosition(0, layout)
    const behind = lobbyPosition(layout.columns, layout)
    const twoBack = lobbyPosition(layout.columns * 2, layout)

    expect(behind.z).toBeGreaterThan(front.z)
    expect(behind.x - front.x).toBeCloseTo(
      Math.abs(lobbyPosition(1, layout).x - front.x) / 2,
    )
    // Two rows back lines up again — the offset alternates, it does not drift.
    expect(twoBack.x).toBeCloseTo(front.x)
  })

  it("spreads an event-sized roster into the platform's depth, not out to the side", () => {
    // Depth is free — the platform is already as deep as the room — while width
    // pushes the camera back and shrinks everyone. The old grid used under half
    // the depth available and packed people in regardless.
    const layout = assignmentSceneLayout(50)
    const lastRowZ = lobbyPosition(49, layout).z

    // Measured in WORLD UNITS, not head count. The column and row gaps are
    // different sizes (a character is narrower than it is tall), so 8 narrow
    // columns can still be a narrower block than 7 deep rows — comparing the
    // counts leans the wrong way, exactly as assignmentSceneLayout warns.
    const spots = Array.from({ length: 50 }, (_, o) => lobbyPosition(o, layout))
    const blockWidth = Math.max(...spots.map((s) => s.x)) - Math.min(...spots.map((s) => s.x))
    const blockDepth = Math.max(...spots.map((s) => s.z)) - Math.min(...spots.map((s) => s.z))
    // Markedly deeper than wide — the block's own footprint carries the
    // invariant now. It used to be measured against ROOM_DEPTH, but the room
    // has since doubled its depth, and the platform (as deep as the room)
    // grew with it: fifty people cannot be expected to fill it.
    expect(blockDepth).toBeGreaterThan(blockWidth * 1.1)
    expect(lastRowZ).toBeGreaterThan(blockWidth)

    expect(layout.lobbyDepth).toBe(ROOM_DEPTH)
  })

  it("keeps every waiting student on the platform, staggered rows included", () => {
    for (const rosterSize of [4, 50, 550]) {
      const layout = assignmentSceneLayout(rosterSize)
      for (let ordinal = 0; ordinal < rosterSize; ordinal++) {
        const spot = lobbyPosition(ordinal, layout)
        expect(spot.x).toBeGreaterThanOrEqual(layout.lobbyStartX)
        expect(spot.x).toBeLessThan(layout.lobbyStartX + layout.lobbyWidth)
        expect(spot.z).toBeGreaterThan(0)
        expect(spot.z).toBeLessThan(layout.lobbyDepth)
      }
    }
  })
})
