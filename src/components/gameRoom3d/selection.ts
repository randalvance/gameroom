// What a click or a touch in the room lands on.

export type RoomSelection =
  | { type: "agent"; id: string }
  /** A visitor's character, by the player index the room minted for it. */
  | { type: "player"; idx: number }
  | { type: "desk"; idx: number }
  | null

export function sameSelection(a: RoomSelection, b: RoomSelection): boolean {
  if (a === null || b === null) return a === b
  if (a.type !== b.type) return false
  if (a.type === "agent" && b.type === "agent") return a.id === b.id
  if (a.type !== "agent" && b.type !== "agent") return a.idx === b.idx
  return false
}
