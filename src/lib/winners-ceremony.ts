// The winners' ceremony: what the gamemaster runs at the end of the day, and
// how the room and the wall read it.
//
// Pure, for the same reason presentation-order.ts is: the hub stores it, the
// console asks for it, the 3D room fires its fireworks off it and the wall
// draws it, and all four have to agree on what "the next place to announce"
// means. The suspense is the point — third is read first, first is read last,
// and nothing here lets that order be skipped.

import type { TeamDTO } from "./event-types"
import { ordinal } from "./presentation-order"

export type PodiumPlace = 1 | 2 | 3

/** The order the podium is read in: the winner is the last name out. */
export const PODIUM_ORDER: readonly PodiumPlace[] = [3, 2, 1]

export interface PodiumEntry {
  place: PodiumPlace
  /** A team id, not a desk index — see PresentationState for why. */
  teamId: string
  /** Epoch ms the place was announced: the fireworks fire from here. */
  announcedAt: number
}

/**
 * The ceremony as the hub holds it and the wire carries it.
 *
 * `podium` is in ANNOUNCEMENT order (third, second, first), so its length is
 * how far the ceremony has got and the last entry is the newest news.
 */
export interface WinnersState {
  /** Epoch ms the ceremony began — the room darkens and turns to the wall. */
  startedAt: number
  /**
   * Which ceremony this is. A second run through the same podium — a
   * rehearsal, then the real thing — still has to fire its fireworks.
   */
  nonce: number
  podium: PodiumEntry[]
}

/** The place the gamemaster is asked for next, or null once the winner is out. */
export function nextPodiumPlace(state: Pick<WinnersState, "podium">): PodiumPlace | null {
  return PODIUM_ORDER[state.podium.length] ?? null
}

export function isCeremonyComplete(state: Pick<WinnersState, "podium">): boolean {
  return nextPodiumPlace(state) === null
}

/** The teams already on the podium, in the order they were called. */
export function placedTeamIds(state: Pick<WinnersState, "podium">): string[] {
  return state.podium.map((entry) => entry.teamId)
}

/** The newest announcement — the one the fireworks and the banner are for. */
export function latestAnnouncement(state: Pick<WinnersState, "podium">): PodiumEntry | null {
  return state.podium[state.podium.length - 1] ?? null
}

/** "1ST PLACE" — a placing, never a bare number that could be a team's name. */
export function podiumLabel(place: PodiumPlace): string {
  return `${ordinal(place)} PLACE`
}

/**
 * The gamemaster's announcement: `{ place, teamId }`. The place is checked
 * to be a podium place here; whether it is the NEXT place, and whether the
 * team is still unplaced, is the hub's call — it holds the state.
 */
export function parseAnnounceInput(input: unknown): { place: PodiumPlace; teamId: string } {
  const o = (input ?? {}) as Record<string, unknown>
  const place = Number(o.place)
  if (!PODIUM_ORDER.includes(place as PodiumPlace)) {
    throw new Error("INVALID_INPUT: place must be 1, 2 or 3")
  }
  if (typeof o.teamId !== "string" || !o.teamId.trim()) {
    throw new Error("INVALID_INPUT: teamId required")
  }
  return { place: place as PodiumPlace, teamId: o.teamId }
}

/**
 * The room's view: the same state with each team id resolved to the desk it
 * sits at. Ids the room does not know are dropped rather than kept as a
 * hole — a place the room cannot hang a medal over is not one it can show.
 */
export interface RoomWinners {
  startedAt: number
  nonce: number
  podium: Array<{ place: PodiumPlace; teamIdx: number; announcedAt: number }>
}

export function roomWinners(
  state: WinnersState | null,
  teams: readonly Pick<TeamDTO, "id">[],
): RoomWinners | null {
  if (!state) return null
  const byId = new Map(teams.map((team, idx) => [team.id, idx]))
  const podium = state.podium.flatMap((entry) => {
    const teamIdx = byId.get(entry.teamId)
    return teamIdx === undefined ? [] : [{ place: entry.place, teamIdx, announcedAt: entry.announcedAt }]
  })
  return { startedAt: state.startedAt, nonce: state.nonce, podium }
}

/** Each desk's podium place, aligned with the desks; null where it has none. */
export function podiumByTeamIdx(winners: RoomWinners, teamCount: number): (PodiumPlace | null)[] {
  const places: (PodiumPlace | null)[] = Array.from({ length: teamCount }, () => null)
  for (const entry of winners.podium) {
    if (entry.teamIdx >= 0 && entry.teamIdx < teamCount) places[entry.teamIdx] = entry.place
  }
  return places
}

export interface WinnersBoardEntry {
  place: PodiumPlace
  /** The team's name once announced; null while the place is still to come. */
  label: string | null
}

export interface WinnersBoard {
  /** First place at the top: the podium as it will finally stand. */
  entries: WinnersBoardEntry[]
  /** The winner has been named. */
  complete: boolean
}

/** The podium as the wall screen draws it. */
export function winnersBoard(winners: RoomWinners, teamLabels: readonly string[]): WinnersBoard {
  const entries = ([1, 2, 3] as const).map((place) => {
    const entry = winners.podium.find((candidate) => candidate.place === place)
    return {
      place,
      label: entry ? teamLabels[entry.teamIdx] ?? `TEAM ${entry.teamIdx + 1}` : null,
    }
  })
  return { entries, complete: entries.every((entry) => entry.label !== null) }
}
