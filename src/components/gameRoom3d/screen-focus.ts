// Framing the wall screen: where the camera stands to read it, and how it
// gets there and back.
//
// Kept out of scene.ts for the same reason camera-pan.ts is — the pose is
// arithmetic over the screen's size and the viewport's aspect, which is worth
// testing without a WebGL context behind it.

export interface CameraPoint {
  x: number
  y: number
  z: number
}

export interface CameraPose {
  position: CameraPoint
  target: CameraPoint
}

/**
 * How much bigger than the screen the framed view is. The screen spans the
 * whole front wall, so a pose that fits it exactly puts its edges hard against
 * the viewport's — which reads as the frame cropping the screen rather than
 * showing it. A little air on the tighter axis says "this is the whole thing".
 */
export const SCREEN_FOCUS_PADDING = 1.04

/**
 * How much bigger than the PICTURE the view is while a filmed broadcast plays.
 *
 * Much roomier than reading the screen, because the two are different acts. A
 * player who walks up and presses interact wants the board filling their view;
 * a broadcast is watched rather than read, and the clips are 16:9 like the
 * viewport — so framing one tight would press it to every edge and turn the
 * room into a video player, which is the takeover this deliberately is not.
 * This keeps the surround, the floor and whoever is standing at the front in
 * shot, so it still reads as a screen in a room.
 */
export const BROADCAST_FOCUS_PADDING = 1.35

export interface ScreenFocusInput {
  /** The screen plane's width and height, in world units. */
  width: number
  height: number
  /** The height its middle sits at, and the depth it hangs at. */
  centreY: number
  z: number
  /** The camera's vertical field of view, in degrees, as three.js takes it. */
  fovDeg: number
  /** Viewport width / height. */
  aspect: number
  /**
   * The camera's zoom, which narrows the field of view it actually sees by
   * (three.js getEffectiveFOV). The room runs above 1, and a pose measured
   * from the bare fov frames a screen far bigger than the one that fits.
   */
  zoom?: number
  padding?: number
}

/**
 * Where the camera stands to read the whole screen.
 *
 * Square on and level with the screen's middle — this is a camera looking at a
 * screen, not the room's raked establishing shot — and far enough back that
 * both axes clear the glass. Which axis binds depends on the viewport: a wide
 * one runs out of height first, a phone held upright runs out of width, so the
 * distance is the larger of the two fits.
 */
export function screenFocusPose(input: ScreenFocusInput): CameraPose {
  const padding = input.padding ?? SCREEN_FOCUS_PADDING
  // Half the visible extent per unit of depth, on each axis.
  const perDepthY = Math.tan((input.fovDeg * Math.PI) / 360) / (input.zoom ?? 1)
  const perDepthX = perDepthY * input.aspect
  const forHeight = input.height / 2 / perDepthY
  const forWidth = input.width / 2 / perDepthX
  const distance = Math.max(forHeight, forWidth) * padding
  return {
    position: { x: 0, y: input.centreY, z: input.z + distance },
    target: { x: 0, y: input.centreY, z: input.z },
  }
}

function lerpPoint(from: CameraPoint, to: CameraPoint, t: number): CameraPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  }
}

/** The pose `t` of the way from the room's view to the screen's. */
export function blendCameraPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  if (t <= 0) return from
  if (t >= 1) return to
  return {
    position: lerpPoint(from.position, to.position, t),
    target: lerpPoint(from.target, to.target, t),
  }
}

/**
 * How much of the gap to the framed pose survives one 60 Hz sim step. Slower
 * than the follow-cam's chase (0.93): that one is keeping up with a walking
 * sprite, this one is a deliberate move between two fixed views, and taking
 * about a third of a second over it reads as the camera going somewhere rather
 * than cutting.
 */
export const SCREEN_FOCUS_KEEP_PER_STEP = 0.88

/**
 * How close to an end counts as arrived. Without it the ease approaches 0 and
 * 1 forever, so the camera would keep writing a new matrix every frame of a
 * view that is, to the pixel, already still.
 */
const SETTLE_EPSILON = 1e-4

/**
 * One frame of the move in or out. `steps` is the frame's sim-step count, so a
 * 120 Hz display flies in at the same speed a 60 Hz one does.
 */
export function advanceScreenFocus(current: number, focused: boolean, steps: number): number {
  if (steps <= 0) return current
  const goal = focused ? 1 : 0
  const closeness = 1 - Math.pow(SCREEN_FOCUS_KEEP_PER_STEP, steps)
  const next = current + (goal - current) * closeness
  return Math.abs(goal - next) < SETTLE_EPSILON ? goal : next
}

/**
 * What a key press means while the screen is framed.
 *
 * Focus rebinds the walk keys rather than sharing them: with the camera off
 * the character there is nothing useful to be seen walking left or right, so
 * those two turn the page instead. Down is the way out — it backs the camera
 * off AND walks, so leaving is the same one press it would have been if the
 * screen had never taken the view. Up is swallowed rather than passed through,
 * because the only thing north of a player reading the screen is the wall it
 * hangs on.
 *
 * `null` means focus has no opinion and the room's normal handling stands.
 */
export type ScreenFocusKeyAction =
  | "page-prev"
  | "page-next"
  | "exit"
  | "exit-and-move"
  | "swallow"

const FOCUS_KEY: Record<string, ScreenFocusKeyAction> = {
  arrowleft: "page-prev", a: "page-prev",
  arrowright: "page-next", d: "page-next",
  arrowdown: "exit-and-move", s: "exit-and-move",
  arrowup: "swallow", w: "swallow",
  " ": "exit", e: "exit",
}

/** `key` is already lower-cased, as the room's key handler has it. */
export function screenFocusKeyAction(key: string, focused: boolean): ScreenFocusKeyAction | null {
  if (!focused) return null
  return FOCUS_KEY[key] ?? null
}

/**
 * How far into the move the room's furniture goes.
 *
 * The team tables stand between the camera and the wall, and at the framed
 * pose they cover the bottom of the screen — the very band the standings'
 * figures sit in. So they are taken out of the way while
 * the screen is being read, and put back on the way out.
 *
 * Not at t = 0: a table vanishing while the camera is still sitting in the
 * room reads as a glitch. Partway through, with the room already rushing past,
 * the swap goes unnoticed.
 */
export const SCREEN_FOCUS_CLEAR_AT = 0.45

/** Is the move far enough along to stand the room's furniture down? */
export function screenFocusHidesRoom(t: number): boolean {
  return t >= SCREEN_FOCUS_CLEAR_AT
}
