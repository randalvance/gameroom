import type { PlayerRole } from "~/lib/event-types"

export type RoomRole = PlayerRole

/** Role colours are deliberately bright so the ring remains legible in the diorama. */
export function roleHaloColor(role: RoomRole | undefined): number {
  switch (role) {
    case "mentor":
    case "judge":
      return 0xff4040
    case "admin":
      return 0xffd040
    case "student":
    case "viewer":
    default:
      return 0x40ff88
  }
}
