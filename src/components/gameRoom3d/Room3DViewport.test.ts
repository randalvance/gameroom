// @vitest-environment jsdom
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const createRoomScene = vi.hoisted(() => vi.fn())

vi.mock("./scene", () => ({ createRoomScene }))

import {
  nextRoomCameraPan,
  nextRoomCameraZoom,
  Room3DViewport,
  RoomCameraLegend,
  roomAgentInputs,
  roomCameraWheelAction,
  syncRoomAgents,
} from "./Room3DViewport"
import { ROOM_CAMERA_MAX_PAN_SOUTH } from "./camera-pan"
import type { RoomAgentInput, RoomSceneHandle } from "./scene"
import { DEFAULT_STATUS_STYLES, type Agent } from "~/lib/agents"

const ada: Agent = { id: "ada", name: "Ada", status: "working", activity: "Reading" }
const bob: Agent = { id: "bob", name: "Bob", status: "idle" }

function createSceneHandle(): RoomSceneHandle {
  return {
    setSelection() {},
    setQualityPreference() {},
    setCameraPan() {},
    setCameraZoom() {},
    upsertAgent: vi.fn(),
    removeAgent: vi.fn(),
    say() {},
    setNetStates() {},
    setWanderStates() {},
    setLocalPlayer() {},
    setLocalInputDisabled: vi.fn(),
    setBoard() {},
    setBulletin() {},
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
    const props = { agents: [ada] }
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
    const props = { agents: [ada] }
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
      agents: [ada],
      localInputDisabled: false,
    }))

    await waitFor(() => {
      expect(handle.setLocalInputDisabled).toHaveBeenCalledWith(false)
    })

    rerender(createElement(Room3DViewport, {
      agents: [ada],
      localInputDisabled: true,
    }))

    expect(handle.setLocalInputDisabled).toHaveBeenLastCalledWith(true)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })
})

describe("Room3DViewport agents", () => {
  it("seats the agents through the handle once the scene is up, and never rebuilds for them", async () => {
    const handle = createSceneHandle()
    createRoomScene.mockResolvedValueOnce(handle)
    const { rerender } = render(createElement(Room3DViewport, { agents: [ada] }))

    await waitFor(() => expect(handle.upsertAgent).toHaveBeenCalledTimes(1))
    expect(handle.upsertAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "ada", status: "working", activity: "Reading" }))

    // A newcomer goes in; the unchanged one is left alone.
    rerender(createElement(Room3DViewport, { agents: [ada, bob] }))
    expect(handle.upsertAgent).toHaveBeenCalledTimes(2)
    expect(handle.upsertAgent).toHaveBeenLastCalledWith(expect.objectContaining({ id: "bob" }))

    // A change is applied in place.
    rerender(createElement(Room3DViewport, { agents: [{ ...ada, status: "waiting" }, bob] }))
    expect(handle.upsertAgent).toHaveBeenCalledTimes(3)
    expect(handle.upsertAgent).toHaveBeenLastCalledWith(expect.objectContaining({ id: "ada", status: "waiting" }))

    // A departure is a removal.
    rerender(createElement(Room3DViewport, { agents: [bob] }))
    expect(handle.removeAgent).toHaveBeenCalledWith("ada")
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  it("re-sends everyone when the host's status styles change", async () => {
    const handle = createSceneHandle()
    createRoomScene.mockResolvedValueOnce(handle)
    const { rerender } = render(createElement(Room3DViewport, { agents: [ada, bob] }))
    await waitFor(() => expect(handle.upsertAgent).toHaveBeenCalledTimes(2))

    rerender(createElement(Room3DViewport, { agents: [ada, bob], statusStyles: { idle: { bubble: "Resting" } } }))
    // Only bob is idle, so only bob's look changed.
    expect(handle.upsertAgent).toHaveBeenCalledTimes(3)
    expect(handle.upsertAgent).toHaveBeenLastCalledWith(expect.objectContaining({ id: "bob", style: expect.objectContaining({ bubble: "Resting" }) }))
  })
})

describe("roomAgentInputs", () => {
  it("rolls a working child up to its parent and resolves the look", () => {
    const parent: Agent = { id: "p", name: "Parent", status: "idle" }
    const child: Agent = { id: "c", name: "Child", status: "working", parentId: "p" }
    const inputs = roomAgentInputs([parent, child])
    expect(inputs[0]).toMatchObject({ id: "p", status: "working", style: DEFAULT_STATUS_STYLES.working })
    expect(inputs[1]).toMatchObject({ id: "c", status: "working" })
  })
})

describe("syncRoomAgents", () => {
  const input = (over: Partial<RoomAgentInput>): RoomAgentInput => ({
    id: "a", name: "A", status: "idle", style: DEFAULT_STATUS_STYLES.idle, ...over,
  })

  it("sends only what changed", () => {
    const handle = { upsertAgent: vi.fn(), removeAgent: vi.fn() }
    const first = syncRoomAgents(handle, new Map(), [input({ id: "a" }), input({ id: "b", name: "B" })])
    expect(handle.upsertAgent).toHaveBeenCalledTimes(2)

    syncRoomAgents(handle, first, [input({ id: "a" }), input({ id: "b", name: "Bee" })])
    expect(handle.upsertAgent).toHaveBeenCalledTimes(3)
    expect(handle.upsertAgent).toHaveBeenLastCalledWith(expect.objectContaining({ id: "b", name: "Bee" }))
    expect(handle.removeAgent).not.toHaveBeenCalled()

    syncRoomAgents(handle, first, [input({ id: "b", name: "B" })])
    expect(handle.removeAgent).toHaveBeenCalledWith("a")
  })
})

describe("Room3DViewport wall", () => {
  it("raises and lowers a bulletin on the live wall without rebuilding the scene", async () => {
    const setBulletin = vi.fn()
    const handle = { ...createSceneHandle(), setBulletin }
    createRoomScene.mockResolvedValueOnce(handle)
    const props = { agents: [], bulletin: "Freight routes disrupted" }
    const { rerender } = render(createElement(Room3DViewport, props))

    await waitFor(() => expect(setBulletin).toHaveBeenCalledWith("Freight routes disrupted"))

    rerender(createElement(Room3DViewport, { ...props, bulletin: null }))
    expect(setBulletin).toHaveBeenLastCalledWith(null)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  it("repaints the board without rebuilding the scene", async () => {
    const setBoard = vi.fn()
    const handle = { ...createSceneHandle(), setBoard }
    createRoomScene.mockResolvedValueOnce(handle)
    const board = { title: "AGENTS", lines: ["3 working", "1 waiting"] }
    const props = { agents: [], board }
    const { rerender } = render(createElement(Room3DViewport, props))

    await waitFor(() => expect(setBoard).toHaveBeenCalledWith(board))

    rerender(createElement(Room3DViewport, { ...props, board: null }))
    expect(setBoard).toHaveBeenLastCalledWith(null)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })
})

describe("Room3DViewport interact wiring", () => {
  it("forwards Primey's interact to the LATEST callback without rebuilding the scene", async () => {
    createRoomScene.mockResolvedValueOnce(createSceneHandle())
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(createElement(Room3DViewport, {
      agents: [],
      onPrimeyInteract: first,
    }))

    await waitFor(() => expect(createRoomScene).toHaveBeenCalledTimes(1))
    const opts = createRoomScene.mock.calls[0]![1] as { onPrimeyInteract: () => void }

    // A re-render must not orphan the handler behind a stale closure: the
    // scene is built once and keeps whatever function it was handed.
    rerender(createElement(Room3DViewport, {
      agents: [],
      onPrimeyInteract: second,
    }))

    opts.onPrimeyInteract()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(createRoomScene).toHaveBeenCalledTimes(1)
  })

  it("forwards an agent's interact to the latest callback", async () => {
    createRoomScene.mockResolvedValueOnce(createSceneHandle())
    const onAgentInteract = vi.fn()
    render(createElement(Room3DViewport, { agents: [ada], onAgentInteract }))
    await waitFor(() => expect(createRoomScene).toHaveBeenCalledTimes(1))
    const opts = createRoomScene.mock.calls[0]![1] as { onAgentInteract: (id: string) => void }
    opts.onAgentInteract("ada")
    expect(onAgentInteract).toHaveBeenCalledWith("ada")
  })
})

describe("camera controls", () => {
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
})
