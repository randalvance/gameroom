import type { PlayerRole } from "~/lib/event-types"

export type RoomRole = PlayerRole

/** Role colours are deliberately bright so the ring remains legible in the diorama. */
export function roleHaloColor(role: RoomRole | undefined): number {
  switch (role) {
    case "screen":
      return 0xff4040
    case "host":
      return 0xffd040
    case "visitor":
    default:
      return 0x40ff88
  }
}
