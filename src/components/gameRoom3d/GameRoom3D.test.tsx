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
  useLocalFeedbacks: () => ({}),
}))

import GameRoom3D from "./GameRoom3D"

describe("GameRoom3D", () => {
  it("passes the session clock through to the viewport that owns the screen", () => {
    const sessionClock = {
      status: "paused" as const,
      elapsedSeconds: 120,
      remainingSeconds: 900,
      fetchedAtMs: 1_789_698_600_000,
    }
    render(<GameRoom3D teams={[]} allPlayers={[]} sessionClock={sessionClock} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { sessionClock?: unknown }
    expect(props.sessionClock).toEqual(sessionClock)
  })

  it("passes the wall's countdown target through to the viewport that owns the screen", () => {
    const countdown = { atMs: 1_789_689_600_000, title: "DOORS OPEN" }
    render(<GameRoom3D teams={[]} allPlayers={[]} countdown={countdown} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { countdown?: unknown }
    expect(props.countdown).toEqual(countdown)
  })

  it("passes live market news through to the viewport that owns the screen", () => {
    const marketNews = { message: "Freight routes disrupted", affectedSymbol: "AXON", clip: null, placeholder: false }
    render(<GameRoom3D teams={[]} allPlayers={[]} marketNews={marketNews} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { marketNews?: unknown }
    expect(props.marketNews).toEqual(marketNews)
  })

  it("passes Primey's interact through to the viewport", () => {
    const onPrimeyInteract = vi.fn()
    render(<GameRoom3D teams={[]} allPlayers={[]} onPrimeyInteract={onPrimeyInteract} />)

    const props = viewportProps.mock.calls.at(-1)![0] as { onPrimeyInteract?: () => void }
    props.onPrimeyInteract!()
    expect(onPrimeyInteract).toHaveBeenCalledTimes(1)
  })
})
