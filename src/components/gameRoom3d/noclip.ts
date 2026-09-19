// `?noclip=1` on the game-room URL: the local character walks through tables
// and straight out of the room.
//
// A development and screenshot aid, not a game mechanic, and deliberately
// CLIENT-ONLY. The hub validates every reported position against the same
// collision geometry the scene uses (`GameRoomHub.handleInput` clamps to
// ROOM_BOUNDS and drops anything `pointBlocked` rejects), so a noclipping
// player leaves the room in their OWN viewport while everyone else keeps
// seeing them at the last spot they could legally stand. That asymmetry is
// the point: the flag can't be used to cheat a shared room, because nothing
// about it is trusted by the server.
//
// Pure, so the scene can read it once at build time and tests need no URL.

/** Values that read as "on" in a URL flag. Bare `?noclip` counts too. */
const TRUTHY = new Set(["", "1", "true", "yes", "on"])

/**
 * Whether `?noclip=` asks for collisions off. Anything unrecognised — a typo,
 * `?noclip=0` — returns false rather than guessing, so the room stays solid
 * unless it was asked plainly.
 */
export function parseNoclipOverride(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  if (!params.has("noclip")) return false
  return TRUTHY.has((params.get("noclip") ?? "").trim().toLowerCase())
}
