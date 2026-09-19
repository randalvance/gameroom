import { buildAllPlayers, type PlayerRole, type TeamDTO } from "./event-types"

export interface GameRoomMenuPerson {
  id: string
  name: string
  role: PlayerRole
  spriteId: number | null
  spriteSheet: string | null
  teamName: string | null
  playerIdx: number
  teamIdx: number
}

export type GameRoomMenuUserSource = Omit<GameRoomMenuPerson, "playerIdx" | "teamIdx">
export interface GameRoomMenuIdentitySource extends Omit<GameRoomMenuUserSource, "name"> {
  displayName: string | null
  directoryName?: string | null
}
export interface GameRoomMenuData { me: GameRoomMenuPerson; peers: GameRoomMenuPerson[] }
export interface ProjectGameRoomMenuDataInput {
  userId: string
  role: PlayerRole
  me: GameRoomMenuUserSource
  teams: TeamDTO[]
  mentors: GameRoomMenuUserSource[]
}

const named = (person: GameRoomMenuUserSource) => ({ ...person, name: person.name.trim() || person.id })

export function projectGameRoomMenuIdentity(source: GameRoomMenuIdentitySource): GameRoomMenuUserSource {
  return {
    id: source.id,
    name: source.displayName?.trim() || source.directoryName?.trim() || source.id,
    role: source.role,
    spriteId: source.spriteId,
    spriteSheet: source.spriteSheet,
    teamName: source.teamName,
  }
}

export function projectGameRoomMenuData(input: ProjectGameRoomMenuDataInput): GameRoomMenuData {
  const fallbackMe = { ...named(input.me), role: input.role, playerIdx: 0, teamIdx: 0 }
  if (input.role === "student") {
    const players = buildAllPlayers(input.teams)
    const ownIndex = players.findIndex((player) => player.id === input.userId)
    if (ownIndex < 0) return { me: fallbackMe, peers: [] }
    const own = players[ownIndex]!
    const toPerson = (player: typeof own, playerIdx: number): GameRoomMenuPerson => ({
      id: player.id, name: player.name.trim() || player.id, role: player.role ?? "student",
      spriteId: player.spriteId, spriteSheet: player.spriteSheet, teamName: player.teamName,
      playerIdx, teamIdx: player.teamIdx,
    })
    return {
      me: toPerson(own, ownIndex),
      peers: players.flatMap((player, playerIdx) => player.teamIdx === own.teamIdx && player.id !== input.userId ? [toPerson(player, playerIdx)] : []),
    }
  }
  if (input.role === "mentor") {
    const ordered = [...input.mentors].map(named).sort((a, b) => a.id.localeCompare(b.id))
    const ownIndex = ordered.findIndex((person) => person.id === input.userId)
    const me = ownIndex >= 0 ? { ...ordered[ownIndex]!, playerIdx: ownIndex, teamIdx: 0 } : { ...fallbackMe, playerIdx: ordered.length }
    return {
      me,
      peers: ordered.flatMap((person, playerIdx) => person.id === input.userId ? [] : [{ ...person, playerIdx, teamIdx: 0 }]),
    }
  }
  return { me: fallbackMe, peers: [] }
}

/**
 * One team's roster as menu people, for the Team section when it is showing a
 * team other than your own — the desk you walked up to.
 *
 * `playerIdx` is the member's index across EVERY team, not their seat in this
 * one, because that is what resolveSprite hashes an unassigned character on.
 * Number them per team and the menu draws different characters than the ones
 * standing at the desk.
 */
export function teamRosterFor(teams: TeamDTO[], teamIdx: number): GameRoomMenuPerson[] {
  const team = teams[teamIdx]
  if (!team) return []
  return buildAllPlayers(teams).flatMap((player, playerIdx) =>
    player.teamIdx === teamIdx
      ? [{
          id: player.id,
          name: player.name.trim() || player.id,
          role: player.role ?? "student",
          spriteId: player.spriteId,
          spriteSheet: player.spriteSheet,
          teamName: team.name,
          playerIdx,
          teamIdx,
        }]
      : [],
  )
}
