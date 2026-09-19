// Who a game-room viewer may see before the doors open.
//
// The room is open to students before the rest of the site is (see
// lib/student-access), as somewhere to hang out with their team while they
// wait — and only their team. Teams must not be able to talk to each other
// before the event starts, so until the doors open a participant's room holds
// their own desk and the staff walking the floor, and nothing else; staff
// see the whole room as always. After the doors open there is no scope and
// the room is everyone's.
//
// "Staff" is a role, not the absence of a desk. The rule used to treat every
// deskless visitor as staff, so a student with no team — or a seated student
// the hub happened to meet as a visitor first — was drawn in, and heard by,
// every team's room: a one-way channel into all of them. Only admins, mentors
// and judges cross team lines now. Anyone else without a desk is alone with
// the staff, and seen by nobody but the staff.
//
// The one exception is a deskless VIEWER: the account driving the venue's big
// screen. It SEES the whole room, as the admin projector always has, but is
// still seen by nobody but the staff — watching is not a channel into a team.
//
// This is the pure rule, shared by the hub (which frames reach a connection,
// and who a chat line is delivered to) and the room's loader (which desks are
// drawn populated), so the wire and the page cannot disagree about who is in
// the room. Client-safe: no server imports.

import type { PlayerRole, TeamDTO } from "~/lib/event-types"

/** The roles that see, and are seen by, the whole room before the doors. */
export const ROOM_STAFF_ROLES: ReadonlySet<PlayerRole> = new Set(["admin", "mentor", "judge"])

/** Deskless roles that see the whole room before the doors without being seen
 * by it: the big-screen account. */
export const ROOM_WATCHER_ROLES: ReadonlySet<PlayerRole> = new Set(["viewer"])

/**
 * What a viewer may see: null is the whole room; a number from 0 up is that
 * team's desk (its index in the loaded teams) plus the staff. -1 is the staff
 * alone. Below that, `unseatedScope(idx)` is one deskless character's own
 * scope: the staff, and themselves.
 */
export type RoomScope = number | null

/** The private scope of the deskless, non-staff character at hub idx `idx`. */
export function unseatedScope(idx: number): number {
  return -(idx + 2)
}

/** A viewer as the hub knows them: their role, their desk (-1 = none) and,
 * when they have a character, its hub idx. Null for a connection the hub has
 * no character for at all. */
export interface RoomViewer {
  role: PlayerRole
  teamIdx: number
  idx?: number
}

export function roomScopeFor(viewer: RoomViewer | null, preEvent: boolean): RoomScope {
  if (!preEvent) return null
  if (viewer === null) return -1
  if (ROOM_STAFF_ROLES.has(viewer.role)) return null
  // Seated: their team, whatever their role says — a participant whose role
  // was never promoted from "viewer" is still a participant.
  if (viewer.teamIdx >= 0) return viewer.teamIdx
  if (ROOM_WATCHER_ROLES.has(viewer.role)) return null
  return viewer.idx === undefined ? -1 : unseatedScope(viewer.idx)
}

/** Whether a character is inside a viewer's scope. A deskless visitor is in
 * every scope only if they are staff; otherwise only in their own. */
export function inRoomScope(
  scope: RoomScope,
  char: { guest: boolean; teamIdx: number; role: PlayerRole; idx: number },
): boolean {
  if (scope === null) return true
  if (char.guest) return ROOM_STAFF_ROLES.has(char.role) || scope === unseatedScope(char.idx)
  return char.teamIdx === scope
}

/**
 * The teams as a scoped viewer's page should draw them: every desk stays,
 * in order (desks are laid out by array position, and the hub numbers
 * characters by the same order), but only the viewer's own is populated.
 * The same array back when there is no scope, so callers can keep it by
 * identity.
 */
export function scopeTeams(teams: TeamDTO[], scope: RoomScope): TeamDTO[] {
  if (scope === null) return teams
  return teams.map((team, teamIdx) => (teamIdx === scope ? team : { ...team, players: [] }))
}

/**
 * The teams as a signed-in viewer's page should draw them: their desk found
 * by their id (a participant on no desk sees an empty floor), then scoped as
 * above. The room's loader calls this with the server's read of the doors.
 */
export function scopeTeamsForViewer(
  teams: TeamDTO[],
  viewer: { userId: string; role: PlayerRole },
  preEvent: boolean,
): TeamDTO[] {
  const teamIdx = teams.findIndex((team) => team.players.some((p) => p.id === viewer.userId))
  return scopeTeams(teams, roomScopeFor({ role: viewer.role, teamIdx }, preEvent))
}
