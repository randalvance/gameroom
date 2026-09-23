import { describe, expect, it } from "vitest"
import { PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import { INTERACT_PROBE_PX, PLAYER_RADIUS } from "./collision"
import { resolveRoomInteract } from "./tables"

// Desk 0 is at x:78 y:190, 88 wide and 48 tall.
const T0 = PARTICIPANT_TABLES[0]!

describe("resolveRoomInteract", () => {
  it("hits a desk from above its top edge, anywhere along its width", () => {
    // Standing north of the desk's far corner, facing south (dir 2).
    const self = { x: T0.x + T0.w - 4, y: T0.y - INTERACT_PROBE_PX - 2, dir: 2 } as const
    expect(resolveRoomInteract(self, [])).toEqual({ kind: "table", tableIdx: 0 })
  })

  it("hits the same desk from its left edge", () => {
    const self = { x: T0.x - INTERACT_PROBE_PX - 2, y: T0.y + T0.h / 2, dir: 1 } as const
    expect(resolveRoomInteract(self, [])).toEqual({ kind: "table", tableIdx: 0 })
  })

  it("ignores a desk that is out of range", () => {
    const self = { x: T0.x + T0.w / 2, y: T0.y - 200, dir: 2 } as const
    expect(resolveRoomInteract(self, [])).toBeNull()
  })

  it("ignores a desk facing away from it", () => {
    const self = { x: T0.x + T0.w / 2, y: T0.y - INTERACT_PROBE_PX - 2, dir: 0 } as const
    expect(resolveRoomInteract(self, [])).toBeNull()
  })

  it("lets a character in probe range beat the desk it is standing at", () => {
    const self = { x: T0.x + T0.w / 2, y: T0.y - INTERACT_PROBE_PX - 2, dir: 2 } as const
    const seated = { key: 7, x: self.x, y: self.y + INTERACT_PROBE_PX + 2 }
    expect(resolveRoomInteract(self, [seated])).toEqual({ kind: "probe", key: 7 })
  })

  // The bug this rule exists for: a player's legal standing spot is 17px off
  // the desk rect (TABLE_INFLATE 12 + PLAYER_RADIUS 5) and the idle cast
  // wanders an orbit 18px off the same rect — the same ring. Under the old
  // strict fallback tier a wanderer won the point probe every time and the
  // desk was unreachable at any populated desk.
  const STAND_OFF = 12 + PLAYER_RADIUS
  const WALK_PAD = 18

  it("gives the desk to a player facing it squarely past a wanderer on the orbit", () => {
    const self = { x: T0.x + T0.w / 2, y: T0.y - STAND_OFF, dir: 2 } as const
    const wanderer = { key: 7, x: self.x, y: T0.y - WALK_PAD }
    expect(resolveRoomInteract(self, [wanderer])).toEqual({ kind: "table", tableIdx: 0 })
  })

  it("still gives a teammate you are nose-to-nose with the win over the desk", () => {
    // Probe point 5px inside the desk's left edge; the character sits 10px
    // from it, inside the tie-break radius.
    const self = { x: T0.x - STAND_OFF, y: T0.y + T0.h / 2, dir: 1 } as const
    const px = self.x + INTERACT_PROBE_PX
    const close = { key: 3, x: px - 10, y: self.y }
    expect(resolveRoomInteract(self, [close])).toEqual({ kind: "probe", key: 3 })
  })

  it("treats a plant exactly like a character: close beats the desk, far does not", () => {
    const self = { x: T0.x - STAND_OFF, y: T0.y + T0.h / 2, dir: 1 } as const
    const px = self.x + INTERACT_PROBE_PX
    const nearPlant = { key: 900, x: px - 9, y: self.y }
    expect(resolveRoomInteract(self, [nearPlant])).toEqual({ kind: "probe", key: 900 })
    const farPlant = { key: 900, x: px - 18, y: self.y }
    expect(resolveRoomInteract(self, [farPlant])).toEqual({ kind: "table", tableIdx: 0 })
  })

  it("gives the desk a character outside the tie-break radius", () => {
    // 15px from the probe point: outside the tie-break radius but inside
    // interact range, so the desk takes it.
    const self = { x: T0.x - STAND_OFF, y: T0.y + T0.h / 2, dir: 1 } as const
    const other = { key: 7, x: self.x + INTERACT_PROBE_PX - 15, y: self.y }
    expect(resolveRoomInteract(self, [other])).toEqual({ kind: "table", tableIdx: 0 })
  })

  it("returns the nearer of two desks", () => {
    const T1 = PARTICIPANT_TABLES[1]!
    // Between the two desks in the first row, facing right (dir 1) at desk 1.
    const self = { x: T1.x - INTERACT_PROBE_PX - 2, y: T1.y + T1.h / 2, dir: 1 } as const
    expect(resolveRoomInteract(self, [])).toEqual({ kind: "table", tableIdx: 1 })
  })
})
