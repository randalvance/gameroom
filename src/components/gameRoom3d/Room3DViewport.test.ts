// @vitest-environment jsdom
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const createRoomScene = vi.hoisted(() => vi.fn())

vi.mock("./scene", () => ({ createRoomScene }))

import {
  consumeRoomArrival,
  nextRoomCameraPan,
  nextRoomCameraZoom,
  replayRoomArrival,
  Room3DViewport,
  RoomCameraLegend,
  roomCameraWheelAction,
  room3DSceneIdentityKey,
  shouldAnimateRoomTeamChange,
} from "./Room3DViewport"
import { ROOM_CAMERA_MAX_PAN_SOUTH } from "./camera-pan"
import type { RoomPlayerInput, RoomSceneHandle } from "./scene"
import { CUSTOM_SPRITE_ID } from "~/lib/roster"

const SHEET_PREFIX = "data:image/png;base64,"

const player: RoomPlayerInput = {
  name: "Ada",
  teamIdx: null,
  seatIdx: 0,
  playerIdx: 3,
  draggable: true,
}

function createSceneHandle(): RoomSceneHandle {
  return {
    setSelection() {},
    setTeamRanks() {},
    setPresentation() {},
    setWinners() {},
    setQualityPreference() {},
    setCameraPan() {},
    setCameraZoom() {},
    setPlayerTeam() {},
    setPlayerBusy() {},
    setNetStates() {},
    setWanderStates() {},
    setLocalPlayer() {},
    setLocalInputDisabled: vi.fn(),
    setLeaderboard() {},
    setSessionClock() {},
    setCountdown() {},
    setMarketNews() {},
    setNewsAudio() {},
    setForcedScreenPage() {},
    setMoveInput() {},
    interact() {},
    pickNearCenter: () => null,
    showSpeech() {},
    upsertGuest() {},
    removeGuest() {},
    freezeLocalInput() {},
    showObjectSpeech() {},
    dispose() {},
  }
}

beforeEach(() => {
  createRoomScene.mockReset()
})

describe("Room3DViewport local input", () => {
  it("reveals and pauses the existing scene without rebuilding it", async () => {
    const handle = { ...createSceneHandle(), setBackroomsUnlocked: vi.fn(), setRenderPaused: vi.fn() }
    createRoomScene.mockResolvedValueOnce(handle)
    const props = { players: [player], teamLabels: ["TEAM 01"] }
    const view = render(createElement(Room3DViewport, props))
    await waitFor(() => expect(handle.setBackroomsUnlocked).toHaveBeenCalledWith(false))
    view.rerender(createElement(Room3DViewport, { ...props, backroomsUnlocked: true, renderPaused: true }))
    expect(handle.setBackroomsUnlocked).toHaveBeenLastCalledWith(true)
    expect(handle.setRenderPaused).toHaveBeenLastCalledWith(true)
    view.rerender(createElement(Room3DViewport, { ...props, backroomsUnlocked: true, renderPaused: false }))
    expect(handle.setRenderPaused).toHaveBeenLastCalledWith(false)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  it("shows and hides Primey on the existing scene", async () => {
    const handle = { ...createSceneHandle(), setPrimeyVisible: vi.fn() }
    createRoomScene.mockResolvedValueOnce(handle)
    const props = { players: [player], teamLabels: ["TEAM 01"] }
    const view = render(createElement(Room3DViewport, { ...props, primeyVisible: false }))
    await waitFor(() => expect(handle.setPrimeyVisible).toHaveBeenCalledWith(false))
    view.rerender(createElement(Room3DViewport, props))
    expect(handle.setPrimeyVisible).toHaveBeenLastCalledWith(true)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  it("updates the live scene input gate without rebuilding the scene", async () => {
    const handle = createSceneHandle()
    createRoomScene.mockResolvedValueOnce(handle)
    const { rerender } = render(createElement(Room3DViewport, {
      players: [player],
      teamLabels: ["TEAM 01"],
      localInputDisabled: false,
    }))

    await waitFor(() => {
      expect(handle.setLocalInputDisabled).toHaveBeenCalledWith(false)
    })

    rerender(createElement(Room3DViewport, {
      players: [player],
      teamLabels: ["TEAM 01"],
      localInputDisabled: true,
    }))

    expect(handle.setLocalInputDisabled).toHaveBeenLastCalledWith(true)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })
})

describe("Room3DViewport team desk categories", () => {
  it("passes each team's competing status into the room scene", async () => {
    createRoomScene.mockResolvedValueOnce(createSceneHandle())

    render(createElement(Room3DViewport, {
      players: [player],
      teamLabels: ["TEAM 01", "TEAM 11"],
      teamCompeting: [true, false],
    } as never))

    await waitFor(() => {
      expect(createRoomScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ teamCompeting: [true, false] }),
      )
    })
  })
})

describe("Room3DViewport market news", () => {
  it("updates the live wall screen without rebuilding the scene", async () => {
    const setMarketNews = vi.fn()
    const handle = { ...createSceneHandle(), setMarketNews } as RoomSceneHandle & {
      setMarketNews: typeof setMarketNews
    }
    createRoomScene.mockResolvedValueOnce(handle)
    const bulletin = { message: "Freight routes disrupted", affectedSymbol: "AXON" }
    const props = {
      players: [player],
      teamLabels: ["TEAM 01"],
      marketNews: bulletin,
    }
    const { rerender } = render(createElement(Room3DViewport, props as never))

    await waitFor(() => expect(setMarketNews).toHaveBeenCalledWith(bulletin))

    rerender(createElement(Room3DViewport, { ...props, marketNews: null } as never))
    expect(setMarketNews).toHaveBeenLastCalledWith(null)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  // The doors countdown is the room's wall before the event; a moved opening
  // time reaches the screen as a retarget, not a rebuild.
  it("retargets the wall's countdown without rebuilding the scene", async () => {
    const setCountdown = vi.fn()
    const handle = { ...createSceneHandle(), setCountdown } as RoomSceneHandle & {
      setCountdown: typeof setCountdown
    }
    createRoomScene.mockResolvedValueOnce(handle)
    const doors = { atMs: 1_789_689_600_000, title: "DOORS OPEN" }
    const props = { players: [player], teamLabels: ["TEAM 01"], countdown: doors }
    const { rerender } = render(createElement(Room3DViewport, props as never))

    await waitFor(() => expect(setCountdown).toHaveBeenCalledWith(doors))

    rerender(createElement(Room3DViewport, { ...props, countdown: null } as never))
    expect(setCountdown).toHaveBeenLastCalledWith(null)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  // The gamemaster's console pins the wall for the whole room; releasing hands
  // it back to the players' own interact presses.
  it("pins and releases the wall screen without rebuilding the scene", async () => {
    const setForcedScreenPage = vi.fn()
    const handle = { ...createSceneHandle(), setForcedScreenPage } as RoomSceneHandle & {
      setForcedScreenPage: typeof setForcedScreenPage
    }
    createRoomScene.mockResolvedValueOnce(handle)
    const props = {
      players: [player],
      teamLabels: ["TEAM 01"],
      forcedScreenPage: "leaderboard",
    }
    const { rerender } = render(createElement(Room3DViewport, props as never))

    await waitFor(() => expect(setForcedScreenPage).toHaveBeenCalledWith("leaderboard"))

    rerender(createElement(Room3DViewport, { ...props, forcedScreenPage: null } as never))
    expect(setForcedScreenPage).toHaveBeenLastCalledWith(null)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })
})

describe("Room3DViewport interact wiring", () => {
  it("forwards Primey's interact to the LATEST callback without rebuilding the scene", async () => {
    createRoomScene.mockResolvedValueOnce(createSceneHandle())
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(createElement(Room3DViewport, {
      players: [player],
      teamLabels: ["TEAM 01"],
      onPrimeyInteract: first,
    }))

    await waitFor(() => expect(createRoomScene).toHaveBeenCalledTimes(1))
    const opts = createRoomScene.mock.calls[0]![1] as { onPrimeyInteract: () => void }

    // A re-render must not orphan the handler behind a stale closure: the
    // scene is built once and keeps whatever function it was handed.
    rerender(createElement(Room3DViewport, {
      players: [player],
      teamLabels: ["TEAM 01"],
      onPrimeyInteract: second,
    }))

    opts.onPrimeyInteract()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })
})

describe("room3DSceneIdentityKey", () => {
  it("shows camera shortcuts as a legend without interactive buttons", () => {
    render(RoomCameraLegend())

    const legend = screen.getByLabelText("3D camera shortcuts")
    // Dragging the floor pans too, and it is the one control nobody thinks to
    // try unless the legend says so.
    expect(legend.textContent).toContain("DRAG / WASD PAN")
    expect(legend.textContent).toContain("SCROLL / +− ZOOM")
    expect(legend.textContent).toContain("F / 0 FIT")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("formats Menu as a key/action camera shortcut", () => {
    const onMenu = vi.fn()

    render(RoomCameraLegend({ onMenuToggle: onMenu }))

    const menu = screen.getByRole("button", { name: /menu/i })
    expect(menu).toBeTruthy()
    expect(menu.textContent).toBe("TAB MENU")
    expect(menu.querySelector("b")?.textContent).toBe("TAB")
    menu.click()
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it("steps camera zoom within the fit and close-up limits", () => {
    expect(nextRoomCameraZoom(1, "in")).toBe(1.2)
    expect(nextRoomCameraZoom(1.2, "out")).toBe(1)
    expect(nextRoomCameraZoom(1, "out")).toBe(1)
    expect(nextRoomCameraZoom(2.4, "in")).toBe(2.4)
    expect(nextRoomCameraZoom(1.8, "fit")).toBe(1)
  })

  it("maps mouse-wheel direction to camera zoom", () => {
    expect(roomCameraWheelAction(-100)).toBe("in")
    expect(roomCameraWheelAction(100)).toBe("out")
    expect(roomCameraWheelAction(0)).toBeNull()
  })

  it("steps and bounds camera panning", () => {
    expect(nextRoomCameraPan({ x: 0, z: 0 }, "left")).toEqual({ x: -3, z: 0 })
    expect(nextRoomCameraPan({ x: 0, z: 0 }, "up")).toEqual({ x: 0, z: -3 })
    const south = ROOM_CAMERA_MAX_PAN_SOUTH
    expect(nextRoomCameraPan({ x: 18, z: south }, "right")).toEqual({ x: 18, z: south })
    expect(nextRoomCameraPan({ x: -18, z: -18 }, "down")).toEqual({ x: -18, z: -15 })
    // South is the shorter leash — it stops before the tower's bare facade —
    // but it still has to clear the walkable floor, or it crops the people
    // standing at the last row of desks.
    expect(nextRoomCameraPan({ x: 0, z: south }, "down")).toEqual({ x: 0, z: south })
    expect(nextRoomCameraPan({ x: 9, z: -6 }, "center")).toEqual({ x: 0, z: 0 })
  })

  it("rebuilds for seat changes but not synchronized team changes", () => {
    const initial = room3DSceneIdentityKey({
      interactionMode: "assign",
      teamLabels: ["TEAM 01"],
      players: [player],
    })

    expect(room3DSceneIdentityKey({
      interactionMode: "assign",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, teamIdx: 0 }],
    })).toBe(initial)
    expect(room3DSceneIdentityKey({
      interactionMode: "assign",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, seatIdx: 1 }],
    })).not.toBe(initial)
  })

  it("rebuilds when a team's competing status changes", () => {
    const competingRoster = {
      interactionMode: "select" as const,
      teamLabels: ["TEAM 11"],
      teamCompeting: [true],
      players: [player],
    }
    const exhibition = { ...competingRoster, teamCompeting: [false] }

    expect(room3DSceneIdentityKey(exhibition)).not.toBe(room3DSceneIdentityKey(competingRoster))
  })

  // Standings move every ten seconds while a window is open. Rebuilding the
  // scene for one would drop the camera, the walk and everyone's position ten
  // times a minute, which is why the placings go through the handle
  // (setTeamRanks) and stay out of the identity key entirely.
  it("never rebuilds for a change in the standings", () => {
    const identity = {
      interactionMode: "select" as const,
      teamLabels: ["TEAM 01"],
      players: [player],
    }
    // The key takes no rank input at all — the type is the guard, and this
    // asserts nobody has quietly widened it.
    expect(room3DSceneIdentityKey({ ...identity, teamRanks: [1] } as typeof identity))
      .toBe(room3DSceneIdentityKey({ ...identity, teamRanks: [7] } as typeof identity))
  })

  // The scene draws each character from its sheet at BUILD time and has no
  // handle for swapping one afterwards, so a sprite that changed under a
  // mounted room only lands if the identity key rebuilds the scene. Leaving it
  // out is what kept the game room on a student's OLD character until the
  // server was restarted.
  it("rebuilds when a player's character changes", () => {
    const initial = room3DSceneIdentityKey({
      interactionMode: "select",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, spriteId: 4 }],
    })

    expect(room3DSceneIdentityKey({
      interactionMode: "select",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, spriteId: 5 }],
    })).not.toBe(initial)
  })

  it("rebuilds when a generated sheet is replaced under the same sprite id", () => {
    const key = (sheet: string) => room3DSceneIdentityKey({
      interactionMode: "select",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, spriteId: CUSTOM_SPRITE_ID, spriteSheet: sheet }],
    })

    expect(key(`${SHEET_PREFIX}AAAA`)).not.toBe(key(`${SHEET_PREFIX}BBBB`))
  })

  // A sheet is a base64 PNG data URL — tens of kilobytes per player, and the
  // key is serialized on every render. It carries a digest of the sheet, not
  // the sheet.
  it("keeps the key small when players carry generated sheets", () => {
    const key = room3DSceneIdentityKey({
      interactionMode: "select",
      teamLabels: ["TEAM 01"],
      players: [{ ...player, spriteId: CUSTOM_SPRITE_ID, spriteSheet: `${SHEET_PREFIX}${"A".repeat(40_000)}` }],
    })

    expect(key.length).toBeLessThan(500)
  })

  it("defers arrival animation while optimistic assignment is busy", () => {
    expect(shouldAnimateRoomTeamChange(null, 0, true)).toBe(false)
    expect(shouldAnimateRoomTeamChange(null, 0, false)).toBe(true)
    expect(shouldAnimateRoomTeamChange(1, 0, false)).toBe(false)
  })

  it("replays a confirmed arrival from the lobby to its authoritative table", () => {
    const calls: Array<[number, number | null, boolean?]> = []
    const handle: RoomSceneHandle = {
      setSelection() {},
      setTeamRanks() {},
    setPresentation() {},
    setWinners() {},
      setCameraPan() {},
      setCameraZoom() {},
      setPlayerTeam: (...args) => calls.push(args),
      setPlayerBusy() {},
      setQualityPreference() {},
      setNetStates() {},
      setWanderStates() {},
      setSessionClock() {},
    setCountdown() {},
      setMarketNews() {},
      setNewsAudio() {},
      setForcedScreenPage() {},
      setLocalPlayer() {},
      setLocalInputDisabled() {},
      setMoveInput() {},
      interact() {},
      pickNearCenter: () => null,
      showSpeech() {},
      upsertGuest() {},
      removeGuest() {},
      freezeLocalInput() {},
      showObjectSpeech() {},
      setLeaderboard() {},
      dispose() {},
    }

    replayRoomArrival(handle, [{ ...player, teamIdx: 1 }], { playerIdx: 3, sequence: 4 })

    expect(calls).toEqual([
      [3, null, false],
      [3, 1, true],
    ])
  })

  it("consumes each confirmed arrival sequence only once across later player updates", () => {
    const calls: Array<[number, number | null, boolean?]> = []
    const handle: RoomSceneHandle = {
      setSelection() {},
      setTeamRanks() {},
    setPresentation() {},
    setWinners() {},
      setCameraPan() {},
      setCameraZoom() {},
      setPlayerTeam: (...args) => calls.push(args),
      setPlayerBusy() {},
      setQualityPreference() {},
      setNetStates() {},
      setWanderStates() {},
      setSessionClock() {},
    setCountdown() {},
      setMarketNews() {},
      setNewsAudio() {},
      setForcedScreenPage() {},
      setLocalPlayer() {},
      setLocalInputDisabled() {},
      setMoveInput() {},
      interact() {},
      pickNearCenter: () => null,
      showSpeech() {},
      upsertGuest() {},
      removeGuest() {},
      freezeLocalInput() {},
      showObjectSpeech() {},
      setLeaderboard() {},
      dispose() {},
    }
    const animation = { playerIdx: 3, sequence: 4 }

    const consumed = consumeRoomArrival(handle, [{ ...player, teamIdx: 1 }], animation, null)
    const stillConsumed = consumeRoomArrival(
      handle,
      [{ ...player, teamIdx: 1, seatIdx: 9 }],
      animation,
      consumed,
    )

    expect(consumed).toBe(4)
    expect(stillConsumed).toBe(4)
    expect(calls).toHaveLength(2)
  })
})
