// What the pause menu shows about a person: enough to draw them and name them.

import type { Role } from "./auth"

export interface GameRoomMenuPerson {
  id: string
  name: string
  role: Role
  spriteId: number | null
  spriteSheet: string | null
  /** The indexes the room derives a character from when no sprite is set. */
  playerIdx: number
  teamIdx: number
}

export interface GameRoomMenuData {
  me: GameRoomMenuPerson
}
