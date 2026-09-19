export interface RoomDrop {
  playerIdx: number
  fromTeamIdx: number | null
  destinationTeamIdx: number | null
}

export function roomDragPlayerHover(
  playerIdx: number,
  dragging: boolean,
): number | null {
  return dragging ? playerIdx : null
}

export function roomDragHighlightState(
  fromTeamIdx: number | null,
  teamCount: number,
  hoverTeamIdx: number | null,
): { eligibleTeamIdxs: number[]; strongTeamIdx: number | null } {
  const eligibleTeamIdxs = Array.from({ length: teamCount }, (_, index) => index)
    .filter((index) => index !== fromTeamIdx)
  return {
    eligibleTeamIdxs,
    strongTeamIdx:
      hoverTeamIdx !== null && eligibleTeamIdxs.includes(hoverTeamIdx)
        ? hoverTeamIdx
        : null,
  }
}

export function resolveRoomDrop(input: {
  playerIdx: number
  fromTeamIdx: number | null
  hoverTeamIdx: number | null
  overLobby: boolean
}): RoomDrop | null {
  const destinationTeamIdx = input.hoverTeamIdx ?? (input.overLobby ? null : undefined)
  if (destinationTeamIdx === undefined || destinationTeamIdx === input.fromTeamIdx) return null
  return {
    playerIdx: input.playerIdx,
    fromTeamIdx: input.fromTeamIdx,
    destinationTeamIdx,
  }
}
