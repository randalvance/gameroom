import { useState } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TeamDTO } from "~/lib/event-types"
import type { GameRoomMenuData, GameRoomMenuPerson } from "~/lib/game-room-menu"
import { teamColor } from "~/lib/team-colors"
import { GameRoomMenu } from "./GameRoomMenu"
import { GRAPHICS_PREFERENCE_KEY, type GraphicsPreference } from "./quality-tier"

// vi.mock factories are hoisted above module scope — the spy must be too.
const { getExLeaderboardFn } = vi.hoisted(() => ({ getExLeaderboardFn: vi.fn() }))
vi.mock("~/server/exchange", () => ({ getExLeaderboardFn: () => getExLeaderboardFn() }))

vi.mock("~/components/SiteAudio", () => ({
  SiteAudioControls: () => (
    <div>
      music controls
      <input type="range" aria-label="Background music volume" />
    </div>
  ),
}))

vi.mock("./GameRoomMenuSprite", () => ({
  GameRoomMenuSprite: ({ person, scale }: { person: GameRoomMenuPerson; scale: number }) => <img alt={`${person.name} walking`} data-scale={scale} />,
}))

const studentMenu = {
  me: {
    id: "student-1",
    name: "Ada",
    role: "student",
    spriteId: 3,
    spriteSheet: null,
    teamName: "TEAM ALPHA",
    playerIdx: 0,
    teamIdx: 0,
  },
  peers: [{
    id: "student-2",
    name: "Lin",
    role: "student",
    spriteId: 4,
    spriteSheet: null,
    teamName: "TEAM ALPHA",
    playerIdx: 1,
    teamIdx: 0,
  }],
} satisfies GameRoomMenuData

function Harness({
  data = studentMenu,
  touchControlsVisible = false,
  teams,
  focusTeamIdx = null,
  startOpen = false,
  onGraphicsChange,
}: {
  data?: GameRoomMenuData
  touchControlsVisible?: boolean
  teams?: TeamDTO[]
  focusTeamIdx?: number | null
  startOpen?: boolean
  onGraphicsChange?: (preference: GraphicsPreference) => void
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <GameRoomMenu
      data={data}
      open={open}
      onOpenChange={setOpen}
      touchControlsVisible={touchControlsVisible}
      teams={teams}
      focusTeamIdx={focusTeamIdx}
      onGraphicsChange={onGraphicsChange}
    />
  )
}

const TEAMS: TeamDTO[] = [
  { id: "t0", name: "TEAM ALPHA", players: [
    { id: "student-1", name: "Ada", role: "student", spriteId: 3, spriteSheet: null },
    { id: "student-2", name: "Lin", role: "student", spriteId: 4, spriteSheet: null },
  ] },
  { id: "t1", name: "TEAM BETA", players: [
    { id: "student-3", name: "Rui", role: "student", spriteId: 5, spriteSheet: null },
  ] },
]

/** jsdom reports a style as rgb(); teamColor speaks hex. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe("GameRoomMenu", () => {
  it("opens and closes from its visible trigger", () => {
    render(<Harness />)
    const trigger = screen.getByRole("button", { name: /menu/i })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(trigger)
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(trigger)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("offsets only the trigger when touch controls are visible", () => {
    const { rerender } = render(<Harness />)
    const desktopTrigger = screen.getByRole("button", { name: /menu/i })
    expect(desktopTrigger.classList.contains("game-room-menu-trigger--touch-offset")).toBe(false)

    rerender(<Harness touchControlsVisible />)
    const touchTrigger = screen.getByRole("button", { name: /menu/i })
    expect(touchTrigger.classList.contains("game-room-menu-trigger--touch-offset")).toBe(true)
    fireEvent.click(touchTrigger)
    expect(screen.getByRole("dialog", { name: "Game room menu" }).className).toBe("game-room-menu-overlay")
  })

  it("toggles with Tab from room context and prevents the default traversal", () => {
    render(<Harness />)

    const openEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(window, openEvent)
    expect(openEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()

    const closeEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(window, closeEvent)
    expect(closeEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("toggles with Tab from an input and prevents the default traversal", () => {
    render(
      <>
        <Harness />
        <input aria-label="chat draft" />
      </>,
    )
    const input = screen.getByRole("textbox", { name: "chat draft" })
    input.focus()

    const openEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(input, openEvent)
    expect(openEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()

    const closeEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(input, closeEvent)
    expect(closeEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("leaves non-Tab keys untouched after Tab opens the menu from an input", () => {
    render(
      <>
        <Harness />
        <input aria-label="chat draft" />
      </>,
    )
    const input = screen.getByRole("textbox", { name: "chat draft" })
    input.focus()

    fireEvent(input, new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }))
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()

    const downstreamKeydown = vi.fn()
    window.addEventListener("keydown", downstreamKeydown)

    try {
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      })
      fireEvent(input, enterEvent)
      expect(enterEvent.defaultPrevented).toBe(false)
      expect(downstreamKeydown).toHaveBeenCalledTimes(1)
      expect(downstreamKeydown.mock.calls[0]?.[0]).toMatchObject({ key: "Enter" })
    } finally {
      window.removeEventListener("keydown", downstreamKeydown)
    }
  })

  it("closes with Escape from a focused text input and consumes the key", () => {
    render(
      <>
        <Harness />
        <input aria-label="chat draft" />
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    const input = screen.getByRole("textbox", { name: "chat draft" })
    input.focus()
    const downstreamKeydown = vi.fn()
    window.addEventListener("keydown", downstreamKeydown)

    try {
      const escapeEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
      fireEvent(input, escapeEvent)
      expect(escapeEvent.defaultPrevented).toBe(true)
      expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
      expect(downstreamKeydown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("keydown", downstreamKeydown)
    }
  })

  it("closes with Escape from a focused contenteditable and consumes the key", () => {
    render(
      <>
        <Harness />
        <div role="textbox" aria-label="editable draft" contentEditable />
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    const editor = screen.getByRole("textbox", { name: "editable draft" })
    Object.defineProperty(editor, "isContentEditable", { configurable: true, value: true })
    editor.focus()

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(editor, escapeEvent)
    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("closes with Escape from the focused Options range control", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Options" }))
    const range = screen.getByRole("slider", { name: "Background music volume" })
    range.focus()

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(range, escapeEvent)
    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("closes with Tab and Shift+Tab from a focused menu item and prevents traversal", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    const activeItem = screen.getByRole("menuitem", { name: "Profile" })
    activeItem.focus()

    const closeEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(activeItem, closeEvent)
    expect(closeEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    const reopenedItem = screen.getByRole("menuitem", { name: "Profile" })
    reopenedItem.focus()

    const shiftCloseEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(reopenedItem, shiftCloseEvent)
    expect(shiftCloseEvent.defaultPrevented).toBe(true)
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("consumes Enter while preserving focused menu-item activation", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    const teamItem = screen.getByRole("menuitem", { name: "Team" })
    teamItem.focus()
    const downstreamKeydown = vi.fn()
    window.addEventListener("keydown", downstreamKeydown)

    try {
      fireEvent.keyDown(teamItem, { key: "Enter" })
      expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy()
      expect(downstreamKeydown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("keydown", downstreamKeydown)
    }
  })

  it("renders the three sections and changes content by keyboard with wrapping", () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: "Tab" })
    const menu = screen.getByRole("menu", { name: "Game room sections" })
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Profile",
      "Team",
      "Options",
    ])
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy()
    fireEvent.keyDown(window, { key: "ArrowDown" })
    expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy()
    fireEvent.keyDown(window, { key: "ArrowUp" })
    fireEvent.keyDown(window, { key: "ArrowUp" })
    expect(screen.getByRole("heading", { name: "Options" })).toBeTruthy()
  })

  it("renders the signed-in student profile", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))

    expect(screen.getByText("Ada")).toBeTruthy()
    expect(screen.getByText("USER ID: student-1")).toBeTruthy()
    expect(screen.getByText("TEAM: TEAM ALPHA")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Ada walking" }).getAttribute("data-scale")).toBe("3")
  })

  it("renders teammates with their identity and walking sprites", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))

    const teammate = screen.getByTestId("game-room-team-member-student-2")
    expect(within(teammate).getByText("Lin")).toBeTruthy()
    expect(within(teammate).getByText("student-2")).toBeTruthy()
    expect(within(teammate).getByRole("img", { name: "Lin walking" }).getAttribute("data-scale")).toBe("2")
  })

  it("renders mentor role and empty mentor roster", () => {
    const mentorMenu: GameRoomMenuData = {
      me: { ...studentMenu.me, id: "mentor-1", name: "Maya", role: "mentor", teamName: null },
      peers: [],
    }
    render(<Harness data={mentorMenu} />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))

    expect(screen.getByText("ROLE: MENTOR")).toBeTruthy()
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))
    expect(screen.getByText("NO OTHER MENTORS FOUND")).toBeTruthy()
  })

  it("renders music controls in Options", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Options" }))

    expect(screen.getByText("music controls")).toBeTruthy()
  })

  it("changes content by pointer and Escape closes the overlay", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))
    expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy()
    expect(screen.getByTestId("game-room-team-member-student-2")).toBeTruthy()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("closes when a click lands outside the panels", () => {
    render(<Harness startOpen />)
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByRole("dialog", { name: "Game room menu" })).toBeNull()
  })

  it("stays open when a click lands inside a panel", () => {
    render(<Harness startOpen />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))
    fireEvent.click(screen.getByRole("heading", { name: "Team" }))
    expect(screen.getByRole("dialog", { name: "Game room menu" })).toBeTruthy()
  })

  it("does not render the dismiss surface while the menu is closed", () => {
    render(<Harness />)
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull()
  })
})


describe("GameRoomMenu team standings", () => {
  beforeEach(() => {
    getExLeaderboardFn.mockReset()
    getExLeaderboardFn.mockResolvedValue([
      { label: "TEAM BETA", teamId: "t1", totalValue: 10500, totalPnL: 500 },
      { label: "TEAM ALPHA", teamId: "t0", totalValue: 10120, totalPnL: 120 },
    ])
  })

  it("shows your own team's rank, value and P&L beside your teammates", async () => {
    render(<Harness teams={TEAMS} startOpen />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))
    expect(screen.getByText("Lin")).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId("team-stats-rank").textContent).toBe("#2"))
    expect(screen.getByTestId("team-stats-value").textContent).toContain("10,120")
    expect(screen.getByTestId("team-stats-pnl").textContent).toContain("120")
  })

  it("shows the desk's team instead when one is in focus, and opens on Team", async () => {
    render(<Harness teams={TEAMS} focusTeamIdx={1} startOpen />)
    expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy()
    expect(screen.getByText("TEAM BETA")).toBeTruthy()
    expect(screen.getByText("Rui")).toBeTruthy()
    expect(screen.queryByText("Lin")).toBeNull()
    await waitFor(() => expect(screen.getByTestId("team-stats-rank").textContent).toBe("#1"))
  })

  it("marks the focused team with its own colour, the one /results gives it", () => {
    render(<Harness teams={TEAMS} focusTeamIdx={1} startOpen />)
    const swatch = screen.getByTestId("team-swatch")
    expect(swatch.style.background).toBe(hexToRgb(teamColor("TEAM BETA")))
  })

  it("keeps the roster when the standings cannot be read", async () => {
    getExLeaderboardFn.mockRejectedValue(new Error("EXCHANGE: down"))
    render(<Harness teams={TEAMS} startOpen />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }))
    await waitFor(() => expect(screen.getByText("STANDINGS UNAVAILABLE")).toBeTruthy())
    expect(screen.getByText("Lin")).toBeTruthy()
  })
})

describe("GameRoomMenu graphics setting", () => {
  const showOptions = () => {
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Options" }))
  }
  const graphicsValue = () => screen.getByText(/^(AUTO|LOW|MEDIUM|HIGH|ULTRA)$/).textContent

  beforeEach(() => {
    window.localStorage.removeItem(GRAPHICS_PREFERENCE_KEY)
  })

  it("sits in Options alongside the music controls and starts on AUTO", () => {
    render(<Harness />)
    showOptions()
    expect(screen.getByText("GRAPHICS")).toBeTruthy()
    expect(screen.getByText("music controls")).toBeTruthy()
    expect(graphicsValue()).toBe("AUTO")
  })

  it("steps the value with ←→ and reports each change to the live scene", () => {
    const onGraphicsChange = vi.fn()
    render(<Harness onGraphicsChange={onGraphicsChange} />)
    showOptions()

    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(graphicsValue()).toBe("LOW")
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(graphicsValue()).toBe("MEDIUM")
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(graphicsValue()).toBe("LOW")

    expect(onGraphicsChange.mock.calls.map(([p]) => p)).toEqual(["low", "medium", "low"])
    expect(window.localStorage.getItem(GRAPHICS_PREFERENCE_KEY)).toBe("low")
  })

  it("reaches ULTRA, which auto-detection never picks on its own", () => {
    render(<Harness />)
    showOptions()
    // Backwards from AUTO is the dearest setting — one key press away.
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(graphicsValue()).toBe("ULTRA")
    expect(window.localStorage.getItem(GRAPHICS_PREFERENCE_KEY)).toBe("ultra")
  })

  it("restores the stored choice when the room is opened again", () => {
    window.localStorage.setItem(GRAPHICS_PREFERENCE_KEY, "high")
    render(<Harness />)
    showOptions()
    expect(graphicsValue()).toBe("HIGH")
  })

  it("steps from the on-screen arrows too, for touch and mouse", () => {
    const onGraphicsChange = vi.fn()
    render(<Harness onGraphicsChange={onGraphicsChange} />)
    showOptions()
    fireEvent.click(screen.getByRole("button", { name: "Next graphics setting" }))
    expect(graphicsValue()).toBe("LOW")
    fireEvent.click(screen.getByRole("button", { name: "Previous graphics setting" }))
    expect(graphicsValue()).toBe("AUTO")
    expect(onGraphicsChange).toHaveBeenCalledTimes(2)
  })

  it("describes the value it is on, not the setting", () => {
    render(<Harness />)
    showOptions()
    expect(screen.getByText(/Match this device/)).toBeTruthy()
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByText(/no post FX/)).toBeTruthy()
  })

  it("leaves ←→ alone in the sections that have nothing to step", () => {
    // They are still swallowed there — they would otherwise pan the camera
    // behind the sheet — but they must not reach the graphics setting.
    const onGraphicsChange = vi.fn()
    render(<Harness onGraphicsChange={onGraphicsChange} />)
    fireEvent.click(screen.getByRole("button", { name: /menu/i }))
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(onGraphicsChange).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy()
  })
})
