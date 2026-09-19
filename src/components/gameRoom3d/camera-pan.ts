// Where the room camera is looking, and the rules for moving it.
//
// Lives apart from both the React viewport (which drives panning from the
// keyboard) and the scene (which drives it from a mouse drag) because they
// have to agree: the limit used to be written as a bare 18 in each of them,
// which is two places to forget.

export type RoomCameraPanAction = "left" | "right" | "up" | "down" | "center"

export interface RoomCameraPan {
  x: number
  z: number
}

/** How far one key press slides the view. */
export const ROOM_CAMERA_PAN_STEP = 3

/** How far the view may stray from the room before it stops following. */
export const ROOM_CAMERA_MAX_PAN = 18

/**
 * How much further the view may slide INTO the room (north, -z) than away from
 * it. The room is twice as deep as it is wide, so reaching the far tables
 * takes a longer leash — but the same leash pointing south would swing the
 * frame below the floor slab, onto the bare front facade of the tower the room
 * sits in, which is unmodelled black boxes. South stays short.
 */
export const ROOM_CAMERA_MAX_PAN_NORTH = 34

/**
 * Southward (toward the viewer) cap — see ROOM_CAMERA_MAX_PAN_NORTH.
 *
 * Short, but not so short that it crops the room's own occupants: a character
 * may stand as far south as the walk bounds allow (CH - 8 in plan px), and at
 * 4 the bottom of the frame fell in front of that, cutting the legs off
 * anybody at the last row of desks. This clears the whole walkable floor with
 * room to spare, and the slab is extended to match so the view still never
 * reaches the tower's blank south face.
 */
export const ROOM_CAMERA_MAX_PAN_SOUTH = 9

/**
 * How far the mouse travels before a press becomes a pan rather than a click.
 * Without it, the tremor between pressing and releasing a button would eat the
 * click that selects a student.
 */
export const DRAG_PAN_THRESHOLD_PX = 4

export function clampRoomCameraPan(pan: RoomCameraPan): RoomCameraPan {
  return {
    x: Math.min(ROOM_CAMERA_MAX_PAN, Math.max(-ROOM_CAMERA_MAX_PAN, pan.x)),
    z: Math.min(ROOM_CAMERA_MAX_PAN_SOUTH, Math.max(-ROOM_CAMERA_MAX_PAN_NORTH, pan.z)),
  }
}

export function nextRoomCameraPan(
  current: RoomCameraPan,
  action: RoomCameraPanAction,
): RoomCameraPan {
  if (action === "center") return { x: 0, z: 0 }
  const next = { ...current }
  if (action === "left") next.x -= ROOM_CAMERA_PAN_STEP
  else if (action === "right") next.x += ROOM_CAMERA_PAN_STEP
  else if (action === "up") next.z -= ROOM_CAMERA_PAN_STEP
  else next.z += ROOM_CAMERA_PAN_STEP
  return clampRoomCameraPan(next)
}

/**
 * How much of the gap to the followed character survives one 60 Hz sim step.
 * Close enough to feel attached, soft enough that a direction change reads as
 * the camera catching up rather than being bolted to the sprite.
 */
const CAMERA_FOLLOW_KEEP_PER_STEP = 0.93

/**
 * One frame of follow-cam: ease the pan toward the (clamped) pan that centres
 * the followed character. `steps` is the frame's sim-step count, so the chase
 * speed is display-rate independent like everything else in the room.
 *
 * `unclamped` drops the leash entirely, and is only for `?noclip=1`: a
 * character walking out through a wall is past every limit above within a
 * couple of seconds, and a camera that stopped at the leash would leave the
 * flag useless — you would be steering a sprite you cannot see. It follows the
 * player off the edge of the modelled world, black boxes and all.
 */
export function followRoomCameraPan(
  current: RoomCameraPan,
  target: RoomCameraPan,
  steps: number,
  { unclamped = false }: { unclamped?: boolean } = {},
): RoomCameraPan {
  const clamped = unclamped ? target : clampRoomCameraPan(target)
  const closeness = 1 - Math.pow(CAMERA_FOLLOW_KEEP_PER_STEP, steps)
  return {
    x: current.x + (clamped.x - current.x) * closeness,
    z: current.z + (clamped.z - current.z) * closeness,
  }
}

/** Has the pointer moved far enough to mean a pan instead of a click? */
export function isDragPan(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) >= DRAG_PAN_THRESHOLD_PX
}

/**
 * Where the camera sits after dragging the floor by `world` units.
 *
 * The camera moves AGAINST the drag: the point of grabbing the room is that
 * the spot under the cursor stays under the cursor, so pulling the floor right
 * slides the camera left.
 */
export function panFromDrag(
  panAtDragStart: RoomCameraPan,
  world: { x: number; z: number },
): RoomCameraPan {
  return clampRoomCameraPan({
    x: panAtDragStart.x - world.x,
    z: panAtDragStart.z - world.z,
  })
}
