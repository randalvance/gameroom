import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const viewportProps = vi.fn()
vi.mock("./Room3DViewport", () => ({
  Room3DViewport: (props: Record<string, unknown>) => {
    viewportProps(props)
    return null
  },
}))
vi.mock("../gameRoom/InfoPanel", () => ({
  RoomInfoPanel: () => null,
}))

import GameRoom3D from "./GameRoom3D"

describe("GameRoom3D", () => {
  it("passes the wall's board through to the viewport that owns the screen", () => {
    const board = { title: "AGENTS", lines: ["2 working"] }
    render(<GameRoom3D teams={[]} allPlayers={[]} board={board} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { board?: unknown }
    expect(props.board).toEqual(board)
  })

  it("passes a bulletin through to the viewport that owns the screen", () => {
    render(<GameRoom3D teams={[]} allPlayers={[]} bulletin="Freight routes disrupted" />)

    const props = viewportProps.mock.calls.at(-1)![0] as { bulletin?: unknown }
    expect(props.bulletin).toBe("Freight routes disrupted")
  })

  it("passes Primey's interact through to the viewport", () => {
    const onPrimeyInteract = vi.fn()
    render(<GameRoom3D teams={[]} allPlayers={[]} onPrimeyInteract={onPrimeyInteract} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { onPrimeyInteract?: () => void }
    props.onPrimeyInteract!()
    expect(onPrimeyInteract).toHaveBeenCalledTimes(1)
  })
})
