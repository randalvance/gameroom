// Client-safe types + pure helpers for the roster: teams and the people on
// them. No server imports here — this module is bundled into the client.

import type { Role } from "./auth"

export type PlayerRole = Role

export interface PlayerDTO {
  id: string
  name: string
  role?: PlayerRole
  spriteId: number | null // admin-assigned game-room sprite; null = auto
  /** A generated sheet (PNG data URL); rendered only while spriteId = CUSTOM_SPRITE_ID. */
  spriteSheet: string | null
}

export interface TeamDTO {
  id: string
  name: string
  /** Exhibition desks are seated but not competing: the white desks. */
  competing?: boolean
  players: PlayerDTO[] // ordered by display name
}

// Flattened player, shape-compatible with the old ALL_PLAYERS const.
// teamIdx/seatIdx are positions within the loaded teams array — the room
// scenes seat by array order, not by persisted numbers or team ids.
export interface FlatPlayer extends PlayerDTO {
  teamIdx: number // index of the team in the teams array
  seatIdx: number
  teamName: string
}

export function buildAllPlayers(teams: TeamDTO[]): FlatPlayer[] {
  return teams.flatMap((t, teamIdx) =>
    t.players.map((p, i) => ({ ...p, teamIdx, seatIdx: i, teamName: t.name })),
  )
}

export function resolveSelectedPlayerIndex(
  allPlayers: FlatPlayer[],
  team: TeamDTO | undefined,
  selectedIndex: number | null,
): number {
  const selectedPlayer = selectedIndex === null ? undefined : team?.players[selectedIndex]
  return selectedPlayer
    ? allPlayers.findIndex((player) => player.id === selectedPlayer.id)
    : -1
}
