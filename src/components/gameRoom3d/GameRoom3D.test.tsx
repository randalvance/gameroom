import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Agent } from "~/lib/agents"

const viewportProps = vi.fn()
vi.mock("./Room3DViewport", () => ({
  Room3DViewport: (props: Record<string, unknown>) => {
    viewportProps(props)
    return null
  },
}))
vi.mock("./TouchControls", () => ({
  useCoarsePointer: () => false,
}))

import GameRoom3D from "./GameRoom3D"

const ada: Agent = { id: "ada", name: "Ada", status: "working", activity: "Reading the diff" }

describe("GameRoom3D", () => {
  it("passes the wall's board through to the viewport that owns the screen", () => {
    const board = { title: "AGENTS", lines: ["2 working"] }
    render(<GameRoom3D agents={[]} board={board} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { board?: unknown }
    expect(props.board).toEqual(board)
  })

  it("passes a bulletin through to the viewport that owns the screen", () => {
    render(<GameRoom3D agents={[]} bulletin="Freight routes disrupted" />)

    const props = viewportProps.mock.calls.at(-1)![0] as { bulletin?: unknown }
    expect(props.bulletin).toBe("Freight routes disrupted")
  })

  it("passes Primey's interact through to the viewport", () => {
    const onPrimeyInteract = vi.fn()
    render(<GameRoom3D agents={[]} onPrimeyInteract={onPrimeyInteract} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { onPrimeyInteract?: () => void }
    props.onPrimeyInteract!()
    expect(onPrimeyInteract).toHaveBeenCalledTimes(1)
  })

  it("opens an agent's card on a pick, reports it, and closes it on the same pick again", () => {
    const onSelect = vi.fn()
    render(<GameRoom3D agents={[ada]} onSelect={onSelect} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { onPick: (pick: unknown) => void }
    act(() => props.onPick({ type: "agent", id: "ada" }))
    expect(onSelect).toHaveBeenLastCalledWith({ type: "agent", id: "ada" })
    expect(screen.getByTestId("info-agent-name").textContent).toBe("ADA")
    expect(screen.getByTestId("info-agent-status").textContent).toBe("WORKING")
    expect(screen.getByText("Reading the diff")).toBeTruthy()

    const latest = viewportProps.mock.calls.at(-1)![0] as { onPick: (pick: unknown) => void }
    act(() => latest.onPick({ type: "agent", id: "ada" }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId("info-agent-name")).toBeNull()
  })

  it("follows a selection driven from outside", () => {
    const { rerender } = render(<GameRoom3D agents={[ada]} selected={null} />)
    expect(screen.queryByTestId("info-agent-name")).toBeNull()
    rerender(<GameRoom3D agents={[ada]} selected={{ type: "agent", id: "ada" }} />)
    expect(screen.getByTestId("info-agent-name").textContent).toBe("ADA")
    const props = viewportProps.mock.calls.at(-1)![0] as { selected?: unknown }
    expect(props.selected).toEqual({ type: "agent", id: "ada" })
  })
})
