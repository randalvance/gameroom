// Interactable objects in the game room — the non-character things a player
// can face and talk to. Shared client/server: the scene uses positions for
// the interact probe and for spectator speech bubbles, the hub uses them for
// range checks and owns each user's object dialogue progress.
//
// Objects share the interact wire with characters by living in their own idx
// range: OBJECT_IDX_BASE + (index into ROOM_OBJECTS). Character idxs are
// session-assigned small integers, so the ranges can never collide.

import { CH, CW, TILE, WALL_Y } from "../../components/gameRoom/constants"

export const OBJECT_IDX_BASE = 100_000

export interface RoomObject {
  id: string
  /** Dialog-box header name. */
  name: string
  /** Room-plan px (the same space characters move in). */
  x: number
  y: number
}

// The four corner plants, inset from the room's corners in plan px.
//
// These used to be a hand-copied projection of the billboard positions written
// out again in the scene. That is two copies of one fact, and they drifted the
// moment the room's depth changed: the scene's plants moved to the new far
// corners while these stayed where the old south wall had been, leaving the
// things you could talk to standing in open floor away from the things you
// could see. The scene now draws its billboards FROM this list, so the plant
// you walk up to is always the plant the hub range-checks.
const PLANT_INSET_X = 1.8 * TILE
const PLANT_NORTH_Y = WALL_Y + 1.6 * TILE
const PLANT_SOUTH_Y = CH - 2.6 * TILE

export const ROOM_OBJECTS: readonly RoomObject[] = [
  { id: "plant-nw", name: "Plant", x: PLANT_INSET_X, y: PLANT_NORTH_Y },
  { id: "plant-ne", name: "Plant", x: CW - PLANT_INSET_X, y: PLANT_NORTH_Y },
  { id: "plant-sw", name: "Plant", x: PLANT_INSET_X, y: PLANT_SOUTH_Y },
  { id: "plant-se", name: "Plant", x: CW - PLANT_INSET_X, y: PLANT_SOUTH_Y },
]

export function roomObjectByIdx(idx: number): RoomObject | null {
  return ROOM_OBJECTS[idx - OBJECT_IDX_BASE] ?? null
}

export function roomObjectIdx(id: string): number {
  return OBJECT_IDX_BASE + ROOM_OBJECTS.findIndex((o) => o.id === id)
}

// ---------------------------------------------------------------- the script

const NORMAL_PLANT = "It's just a normal plant..."
export const BACKROOMS_UNLOCK_COUNT = 10

/**
 * The lower-right plant cracks under repeated questioning: a different line
 * on every interaction up to the 20th (the 10th is the confession), then it
 * has nothing left to say and repeats the last one. The hub keeps a separate
 * count per user: only your own conversations reveal your ladder.
 */
const PLANT_SE_SCRIPT = [
  NORMAL_PLANT,
  "It's just a normal plant... really.",
  "Still a plant. Same as before.",
  "Leaves. Stem. Pot. That's the whole inventory.",
  "Don't you have a hackathon to win?",
  "P-photosynthesis... that's a thing I do. Because plant.",
  "Okay, you're starting to make me nervous.",
  "There is DEFINITELY nothing special about this pot.",
  "Stop. Looking. At. Me.",
  "...Fine, you found my secret. Watch your step. Face the hatch and interact again to climb down.",
  "The ladder leads to The Backrooms. Bring your laser fingers. You'll need them.",
  "You can stop now.",
  "Tell no one. Especially not the other plants.",
  "The other three? Regular plants. Total amateurs.",
  "Do you talk to every plant like this?",
  "I have nothing left to confess.",
  "Water me and we'll call it even.",
  "The judges can see you doing this, you know.",
  "I've lost count. You haven't, have you.",
  "Go build something amazing. — The Plant",
] as const

/** What an object says on its `count`-th interaction (1-based). */
export function objectSpeech(id: string, count: number): string {
  if (id !== "plant-se") return NORMAL_PLANT
  const at = Math.min(Math.max(1, count), PLANT_SE_SCRIPT.length)
  return PLANT_SE_SCRIPT[at - 1]!
}
