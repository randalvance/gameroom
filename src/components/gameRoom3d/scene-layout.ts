import type { WalkDir } from "../gameRoom/spriteIndex"
import { CH, CW, TILE, WALL_Y } from "../gameRoom/constants"
import { NOMINAL_CHARACTER_SIZE } from "./character-scale"
import { FACING_CAMERA } from "./walk-path"

const ROOM_WIDTH = CW / TILE
const ROOM_DEPTH = (CH - WALL_Y) / TILE

// Waiting students are spaced by how much room a student actually TAKES UP,
// not in bare world units: the old 1.5 × 1.25 grid packed them at well under
// half their own width, so the arrivals platform read as one clump of heads
// rather than a queue of people, and every change to CHARACTER_SCALE made it
// worse. Both gaps are a fraction of the sprite's own footprint, so the lobby
// keeps its breathing room whatever size the cast is.
const COLUMN_GAP = NOMINAL_CHARACTER_SIZE.width * 0.8
const ROW_GAP = NOMINAL_CHARACTER_SIZE.height * 0.8
const MIN_LOBBY_WIDTH = 7
const LOBBY_X_GAP = NOMINAL_CHARACTER_SIZE.width * 0.5
const LOBBY_Z_START = 2.25
/** Clear floor kept past the last row, so nobody stands on the platform edge. */
const LOBBY_Z_END_PAD = 2
/** Side margins on the platform — half a body either side of the grid. */
const LOBBY_X_PAD = NOMINAL_CHARACTER_SIZE.width * 0.55

/**
 * How much wider than deep the block of waiting students may get. Below 1
 * because depth is FREE — the platform is already as deep as the room, and the
 * old grid left over half of it empty — while width pushes the camera back and
 * shrinks everyone. Spreading into the depth buys spacing for nothing.
 */
const LOBBY_ASPECT = 0.8

export interface AssignmentSceneLayout {
  columns: number
  rows: number
  capacity: number
  lobbyStartX: number
  lobbyWidth: number
  lobbyDepth: number
  camera: {
    fov: number
    distance: number
    far: number
    positionX: number
    positionY: number
    positionZ: number
    targetX: number
    targetZ: number
  }
}

export function assignmentSceneLayout(rosterSize: number): AssignmentSceneLayout {
  const finiteSize = Math.max(1, Math.floor(rosterSize))
  // Columns that make the block LOBBY_ASPECT as wide as it is deep, measured
  // in world units rather than head count — the two gaps differ, so counting
  // seats would lean the wrong way.
  const columns = Math.max(
    3,
    Math.ceil(Math.sqrt((finiteSize * LOBBY_ASPECT * ROW_GAP) / COLUMN_GAP)),
  )
  const rows = Math.ceil(finiteSize / columns)
  // The staggered rows reach half a place further right than the square ones,
  // so the platform has to cover that too.
  const lobbyWidth = Math.max(
    MIN_LOBBY_WIDTH,
    LOBBY_X_GAP + (columns - 1) * COLUMN_GAP + COLUMN_GAP / 2 + LOBBY_X_PAD,
  )
  const lobbyDepth = Math.max(
    ROOM_DEPTH,
    LOBBY_Z_START + (rows - 1) * ROW_GAP + LOBBY_Z_END_PAD,
  )
  const totalWidth = ROOM_WIDTH + lobbyWidth
  const fov = 54
  const verticalFov = fov * Math.PI / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (CW / CH))
  const distance = Math.max(
    totalWidth / (2 * Math.tan(horizontalFov / 2)),
    lobbyDepth / (2 * Math.tan(verticalFov / 2)),
  ) * 1.18
  const targetX = lobbyWidth / 2
  const targetZ = lobbyDepth / 2

  return {
    columns,
    rows,
    capacity: columns * rows,
    lobbyStartX: ROOM_WIDTH / 2,
    lobbyWidth,
    lobbyDepth,
    camera: {
      fov,
      distance,
      far: Math.max(200, distance * 4),
      positionX: targetX,
      positionY: Math.max(24, distance * 0.72),
      positionZ: targetZ + distance,
      targetX,
      targetZ,
    },
  }
}

export function lobbyPosition(
  ordinal: number,
  layout: AssignmentSceneLayout,
): { x: number; z: number; dir: WalkDir } {
  const localOrdinal = Math.max(0, Math.floor(ordinal))
  const row = Math.floor(localOrdinal / layout.columns)
  // Every other row steps half a place sideways. Billboarded sprites are much
  // taller than the depth between rows, so a square grid stacks each student
  // directly behind the one in front; offsetting alternate rows opens a
  // sightline to every face without spending an inch more floor.
  const stagger = row % 2 === 1 ? COLUMN_GAP / 2 : 0
  return {
    x: layout.lobbyStartX + LOBBY_X_GAP + stagger + (localOrdinal % layout.columns) * COLUMN_GAP,
    z: LOBBY_Z_START + row * ROW_GAP,
    // Waiting students face the admin placing them, not away. An arrivals
    // hall of turned backs is no way to pick someone out of a crowd.
    dir: FACING_CAMERA,
  }
}
