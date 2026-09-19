import { describe, expect, it } from "vitest"
import { resolveRoomDrop, roomDragHighlightState, roomDragPlayerHover } from "./assignment-drag"

describe("resolveRoomDrop", () => {
  it("keeps the dragged player hovered until the drag finishes", () => {
    expect(roomDragPlayerHover(7, true)).toBe(7)
    expect(roomDragPlayerHover(7, false)).toBeNull()
  })

  it("assigns an arrival to a table", () => {
    expect(resolveRoomDrop({ playerIdx: 3, fromTeamIdx: null, hoverTeamIdx: 2, overLobby: false }))
      .toEqual({ playerIdx: 3, fromTeamIdx: null, destinationTeamIdx: 2 })
  })

  it("moves an assigned player back to arrivals", () => {
    expect(resolveRoomDrop({ playerIdx: 3, fromTeamIdx: 2, hoverTeamIdx: null, overLobby: true }))
      .toEqual({ playerIdx: 3, fromTeamIdx: 2, destinationTeamIdx: null })
  })

  it("cancels outside and same-table drops", () => {
    expect(resolveRoomDrop({ playerIdx: 3, fromTeamIdx: 2, hoverTeamIdx: null, overLobby: false })).toBeNull()
    expect(resolveRoomDrop({ playerIdx: 3, fromTeamIdx: 2, hoverTeamIdx: 2, overLobby: false })).toBeNull()
  })
})

describe("roomDragHighlightState", () => {
  it("keeps every other table softly eligible and the hover target strong", () => {
    expect(roomDragHighlightState(1, 4, 3)).toEqual({
      eligibleTeamIdxs: [0, 2, 3],
      strongTeamIdx: 3,
    })
  })

  it("clears the strong target when the pointer leaves destinations", () => {
    expect(roomDragHighlightState(null, 3, null)).toEqual({
      eligibleTeamIdxs: [0, 1, 2],
      strongTeamIdx: null,
    })
  })
})
