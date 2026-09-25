import { describe, expect, it } from "vitest"
import {
  SCREEN_FOCUS_KEEP_PER_STEP,
  BROADCAST_FOCUS_PADDING,
  SCREEN_FOCUS_PADDING,
  advanceScreenFocus,
  blendCameraPose,
  SCREEN_FOCUS_CLEAR_AT,
  screenFocusHidesRoom,
  screenFocusKeyAction,
  screenFocusPose,
  type CameraPose,
} from "./screen-focus"

/** The room's wall screen, near enough for the framing maths. */
const SCREEN = {
  width: 49.2,
  height: 12,
  centreY: 7,
  z: 0.33,
  fovDeg: 45,
}

/** Half-extents of the screen as the pose's camera sees them, in world units
 * at the screen's depth. */
function visibleHalfExtents(pose: CameraPose, aspect: number): { halfW: number; halfH: number } {
  const distance = pose.position.z - SCREEN.z
  const halfH = Math.tan((SCREEN.fovDeg * Math.PI) / 360) * distance
  return { halfH, halfW: halfH * aspect }
}

describe("screenFocusPose", () => {
  it("puts the camera square in front of the screen, level with its middle", () => {
    const pose = screenFocusPose({ ...SCREEN, aspect: 16 / 9 })
    expect(pose.position.x).toBe(0)
    expect(pose.position.y).toBeCloseTo(SCREEN.centreY, 6)
    expect(pose.target).toEqual({ x: 0, y: SCREEN.centreY, z: SCREEN.z })
    expect(pose.position.z).toBeGreaterThan(SCREEN.z)
  })

  it("frames the whole screen with padding to spare on a wide viewport", () => {
    const aspect = 16 / 9
    const { halfW, halfH } = visibleHalfExtents(screenFocusPose({ ...SCREEN, aspect }), aspect)
    expect(halfW).toBeGreaterThan(SCREEN.width / 2)
    expect(halfH).toBeGreaterThan(SCREEN.height / 2)
    // The tighter of the two axes is exactly the padding, never more: the
    // screen fills the frame apart from the margin it was asked for.
    const slack = Math.min(halfW / (SCREEN.width / 2), halfH / (SCREEN.height / 2))
    expect(slack).toBeCloseTo(SCREEN_FOCUS_PADDING, 6)
  })

  it("frames the whole screen with padding to spare on a tall viewport", () => {
    // A phone held upright: width is the binding constraint, and the camera
    // has to back further off than it would on a wide one.
    const aspect = 9 / 16
    const { halfW, halfH } = visibleHalfExtents(screenFocusPose({ ...SCREEN, aspect }), aspect)
    expect(halfW).toBeGreaterThan(SCREEN.width / 2)
    expect(halfH).toBeGreaterThan(SCREEN.height / 2)
    const slack = Math.min(halfW / (SCREEN.width / 2), halfH / (SCREEN.height / 2))
    expect(slack).toBeCloseTo(SCREEN_FOCUS_PADDING, 6)
  })

  it("backs the camera off further as the viewport narrows", () => {
    const wide = screenFocusPose({ ...SCREEN, aspect: 21 / 9 })
    const square = screenFocusPose({ ...SCREEN, aspect: 1 })
    const tall = screenFocusPose({ ...SCREEN, aspect: 9 / 16 })
    expect(square.position.z).toBeGreaterThan(wide.position.z)
    expect(tall.position.z).toBeGreaterThan(square.position.z)
  })

  it("backs off further still when the camera is zoomed in", () => {
    // The room's viewport runs the camera at a zoom above 1, which narrows the
    // effective field of view; a pose measured from the bare fov frames a
    // screen far bigger than the one that actually fits.
    const plain = screenFocusPose({ ...SCREEN, aspect: 16 / 9 })
    const zoomed = screenFocusPose({ ...SCREEN, aspect: 16 / 9, zoom: 1.4 })
    expect(zoomed.position.z).toBeCloseTo(SCREEN.z + (plain.position.z - SCREEN.z) * 1.4, 6)
  })

  it("frames the whole screen with padding to spare at the viewport's zoom", () => {
    const aspect = 16 / 9
    const zoom = 1.4
    const pose = screenFocusPose({ ...SCREEN, aspect, zoom })
    const distance = pose.position.z - SCREEN.z
    // What the camera actually sees at that depth once zoom has narrowed it.
    const halfH = (Math.tan((SCREEN.fovDeg * Math.PI) / 360) / zoom) * distance
    const halfW = halfH * aspect
    const slack = Math.min(halfW / (SCREEN.width / 2), halfH / (SCREEN.height / 2))
    expect(slack).toBeCloseTo(SCREEN_FOCUS_PADDING, 6)
  })
})

describe("blendCameraPose", () => {
  const from: CameraPose = {
    position: { x: 0, y: 34, z: 76 },
    target: { x: 0, y: 0.6, z: 21 },
  }
  const to: CameraPose = {
    position: { x: 2, y: 7, z: 20 },
    target: { x: 2, y: 7, z: 0.33 },
  }

  it("is the room's own view at zero", () => {
    expect(blendCameraPose(from, to, 0)).toEqual(from)
  })

  it("is the screen's view at one", () => {
    expect(blendCameraPose(from, to, 1)).toEqual(to)
  })

  it("sits between the two halfway", () => {
    const mid = blendCameraPose(from, to, 0.5)
    expect(mid.position.x).toBeCloseTo(1, 9)
    expect(mid.position.y).toBeCloseTo(20.5, 9)
    expect(mid.position.z).toBeCloseTo(48, 9)
    expect(mid.target.x).toBeCloseTo(1, 9)
    expect(mid.target.y).toBeCloseTo(3.8, 9)
    expect(mid.target.z).toBeCloseTo(10.665, 9)
  })
})

describe("advanceScreenFocus", () => {
  it("eases toward the screen while focused and back out when released", () => {
    const stepIn = advanceScreenFocus(0, true, 1)
    expect(stepIn).toBeGreaterThan(0)
    expect(stepIn).toBeLessThan(1)
    expect(advanceScreenFocus(stepIn, false, 1)).toBeLessThan(stepIn)
  })

  it("moves at the same rate however the display is clocked", () => {
    // Two 60 Hz steps must land where one 30 fps frame carrying two steps does,
    // so a 120 Hz monitor does not fly in twice as fast.
    const twoSteps = advanceScreenFocus(advanceScreenFocus(0, true, 1), true, 1)
    expect(advanceScreenFocus(0, true, 2)).toBeCloseTo(twoSteps, 12)
  })

  it("settles hard on the ends rather than creeping at them forever", () => {
    expect(advanceScreenFocus(0.999999, true, 1)).toBe(1)
    expect(advanceScreenFocus(0.000001, false, 1)).toBe(0)
  })

  it("holds still on a frame that advanced no sim steps", () => {
    expect(advanceScreenFocus(0.4, true, 0)).toBe(0.4)
    expect(advanceScreenFocus(0.4, false, 0)).toBe(0.4)
  })

  it("keeps the same share of the gap per step as it is documented to", () => {
    expect(advanceScreenFocus(0, true, 1)).toBeCloseTo(1 - SCREEN_FOCUS_KEEP_PER_STEP, 12)
  })
})

describe("screenFocusKeyAction", () => {
  it("leaves every key alone while the room is not focused on the screen", () => {
    for (const key of [" ", "e", "arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s", "q"]) {
      expect(screenFocusKeyAction(key, false)).toBeNull()
    }
  })

  it("swallows left and right rather than walking", () => {
    expect(screenFocusKeyAction("arrowleft", true)).toBe("swallow")
    expect(screenFocusKeyAction("arrowright", true)).toBe("swallow")
    // WASD is an alias for the arrows everywhere else in the room, and a
    // player cannot walk sideways while reading anyway.
    expect(screenFocusKeyAction("a", true)).toBe("swallow")
    expect(screenFocusKeyAction("d", true)).toBe("swallow")
  })

  it("backs out on down, and walks the character away with it", () => {
    expect(screenFocusKeyAction("arrowdown", true)).toBe("exit-and-move")
    expect(screenFocusKeyAction("s", true)).toBe("exit-and-move")
  })

  it("backs out on the interact key that framed the screen", () => {
    expect(screenFocusKeyAction(" ", true)).toBe("exit")
    expect(screenFocusKeyAction("e", true)).toBe("exit")
  })

  it("swallows up, so a player cannot walk into the wall unsighted", () => {
    expect(screenFocusKeyAction("arrowup", true)).toBe("swallow")
    expect(screenFocusKeyAction("w", true)).toBe("swallow")
  })

  it("leaves keys it has no opinion about to the rest of the room", () => {
    expect(screenFocusKeyAction("q", true)).toBeNull()
    expect(screenFocusKeyAction("enter", true)).toBeNull()
  })
})

describe("screenFocusHidesRoom", () => {
  it("keeps the room's furniture up while the camera is still in the room", () => {
    expect(screenFocusHidesRoom(0)).toBe(false)
    expect(screenFocusHidesRoom(0.1)).toBe(false)
  })

  it("clears the furniture once the camera has committed to the screen", () => {
    // The desks and team tables stand between the camera and the glass, so at
    // the framed pose they cover the bottom of the screen. They go once the
    // move is well under way — mid-rush, where the swap does not read as a pop.
    expect(screenFocusHidesRoom(SCREEN_FOCUS_CLEAR_AT)).toBe(true)
    expect(screenFocusHidesRoom(1)).toBe(true)
  })

  it("brings them back on the way out at the same point it took them", () => {
    // Symmetric: no hysteresis, so a half-finished move in either direction
    // agrees with itself about what the room looks like.
    const justBelow = SCREEN_FOCUS_CLEAR_AT - 1e-6
    expect(screenFocusHidesRoom(justBelow)).toBe(false)
  })

  it("clears them before the camera arrives, not at the end of the move", () => {
    expect(SCREEN_FOCUS_CLEAR_AT).toBeGreaterThan(0)
    expect(SCREEN_FOCUS_CLEAR_AT).toBeLessThan(1)
  })
})

describe("BROADCAST_FOCUS_PADDING", () => {
  /** The 16:9 picture on the wall, as broadcastWorldRect measures it. */
  const PICTURE = { width: 21.32, height: 12, centreY: 7, z: SCREEN.z, fovDeg: SCREEN.fovDeg }

  it("leaves more air than reading the screen does", () => {
    // Walking up to READ the screen wants it filling the view. A broadcast is
    // watched, not read, and a picture pressed to the viewport edges stops
    // looking like a screen in a room and starts looking like a video player.
    expect(BROADCAST_FOCUS_PADDING).toBeGreaterThan(SCREEN_FOCUS_PADDING)
  })

  it("stands the camera back far enough to keep the room around the picture", () => {
    const tight = screenFocusPose({ ...PICTURE, aspect: 16 / 9 })
    const eased = screenFocusPose({ ...PICTURE, aspect: 16 / 9, padding: BROADCAST_FOCUS_PADDING })
    expect(eased.position.z).toBeGreaterThan(tight.position.z)

    // The picture should still be the clear subject — most of the view, but
    // not all of it.
    const { halfW } = visibleHalfExtents(eased, 16 / 9)
    const share = PICTURE.width / (halfW * 2)
    expect(share).toBeLessThan(0.85)
    expect(share).toBeGreaterThan(0.6)
  })
})
