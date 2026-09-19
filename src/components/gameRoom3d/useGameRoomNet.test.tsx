// The two frames the gamemaster's GAME ROOM console tab pushes into the room:
// the wall screen it has pinned, and a bulletin it wants on every screen.
//
// Both arrive on the room's own hub rather than the exchange's announcement
// feed — see server/game-room-control-store.ts for why — so this hook is where
// they enter the client.
import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HelloEvent } from "~/lib/gameRoomNet/protocol"
import type { WinnersState } from "~/lib/winners-ceremony"
import { buildAllPlayers } from "~/lib/event-types"
import type { RoomSceneHandle } from "./scene"

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  readyState = 1
  onerror: ((event: Event) => void) | null = null

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  emit(name: string, data: unknown) {
    const event = new MessageEvent(name, { data: JSON.stringify(data) })
    act(() => {
      for (const listener of this.listeners.get(name) ?? []) listener(event)
    })
  }

  closed = false

  /** A frame whose data is not JSON — what a connection cut mid-frame delivered on iOS. */
  emitRaw(name: string, data: string) {
    const event = new MessageEvent(name, { data })
    act(() => {
      for (const listener of this.listeners.get(name) ?? []) listener(event)
    })
  }

  close() {
    this.closed = true
  }
}

const { useGameRoomNet } = await import("./useGameRoomNet")

const hello = (over: Partial<HelloEvent> = {}): HelloEvent => ({
  you: null,
  roster: [],
  states: [],
  wanders: [],
  screen: null,
  presentation: null,
  winners: null,
  ...over,
})

let net: ReturnType<typeof useGameRoomNet>

function Probe() {
  net = useGameRoomNet([])
  return null
}

const feed = () => FakeEventSource.instances[0]!

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true } as Response)))
})

describe("the personal Backrooms hatch", () => {
  it("follows unlock events and authoritative reconnect state", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    expect(net.backroomsUnlocked).toBe(false)
    feed().emit("backrooms", { unlocked: true })
    expect(net.backroomsUnlocked).toBe(true)
    feed().emit("hello", hello({ backroomsUnlocked: true }))
    expect(net.backroomsUnlocked).toBe(true)
    feed().emit("hello", hello({ backroomsUnlocked: false }))
    expect(net.backroomsUnlocked).toBe(false)
  })
})

describe("private interaction dialogue", () => {
  it("ignores other people's conversations, including when I am the target", () => {
    render(<Probe />)
    feed().emit("hello", hello({ you: 7 }))
    const handle = {
      setLocalPlayer: vi.fn(), setNetStates: vi.fn(),
      freezeLocalInput: vi.fn(), unfreezeLocalInput: vi.fn(),
      showSpeech: vi.fn(), showObjectSpeech: vi.fn(),
    }
    act(() => net.onSceneReady(handle as unknown as RoomSceneHandle))
    for (const event of [{ idx: 100_003, by: 2 }, { idx: 7, by: 2 }, { idx: 2, by: 3 }]) {
      feed().emit("say", { ...event, name: "Private", text: "Not your conversation", ms: 3000 })
      expect(net.dialog).toBeNull()
    }
    expect(handle.showSpeech).not.toHaveBeenCalled()
    expect(handle.showObjectSpeech).not.toHaveBeenCalled()
    expect(handle.freezeLocalInput).not.toHaveBeenCalled()
    feed().emit("say", { idx: 100_003, by: 7, name: "Plant", text: "Your secret", ms: 3000 })
    expect(net.dialog?.text).toBe("Your secret")
    expect(handle.freezeLocalInput).toHaveBeenCalledOnce()
    feed().emit("dialogEnd", { a: 2, b: 7 })
    expect(net.dialog?.text).toBe("Your secret")
    feed().emit("dialogEnd", { a: 7, b: null })
    expect(net.dialog).toBeNull()
  })
})

describe("the wall screen the gamemaster has pinned", () => {
  it("is nobody's until the gamemaster takes it", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    expect(net.forcedScreenPage).toBeNull()
  })

  it("follows a screen frame", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("screen", { page: "leaderboard" })
    expect(net.forcedScreenPage).toBe("leaderboard")
  })

  it("is released again when the gamemaster hands the wall back", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("screen", { page: "leaderboard" })
    feed().emit("screen", { page: null })
    expect(net.forcedScreenPage).toBeNull()
  })

  // A reconnect replays hello, not the screen frame that came before it, so
  // hello is the only thing that can tell this client the wall is still taken.
  it("is picked up from hello by a client that arrives mid-force", () => {
    render(<Probe />)
    feed().emit("hello", hello({ screen: "leaderboard-lower" }))
    expect(net.forcedScreenPage).toBe("leaderboard-lower")
  })
})

describe("the PA screens' music", () => {
  it("is the room's playlist until the gamemaster takes it", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    expect(net.music).toBeNull()
  })

  it("follows a music frame, and the release after it", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("music", { mode: "track", track: "/theme.mp3" })
    expect(net.music).toEqual({ mode: "track", track: "/theme.mp3" })
    feed().emit("music", { mode: "stop" })
    expect(net.music).toEqual({ mode: "stop" })
    feed().emit("music", null)
    expect(net.music).toBeNull()
  })

  // A reconnect replays hello, not the frame before it.
  it("is picked up from hello by a client that arrives mid-hold", () => {
    render(<Probe />)
    feed().emit("hello", hello({ music: { mode: "stop" } }))
    expect(net.music).toEqual({ mode: "stop" })
  })
})

describe("a bulletin pushed straight at the room", () => {
  it("arrives with its message and the instrument it concerns", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("bulletin", { message: "Lunch at 12:30.", affectedSymbol: "AXON", nonce: 1 })
    expect(net.bulletin).toEqual({ message: "Lunch at 12:30.", affectedSymbol: "AXON", nonce: 1 })
  })

  // Replaying the same market event twice — a rehearsal, then the real thing —
  // has to read as two bulletins, and only the nonce says so.
  it("reads a repeat of the same text as a second bulletin", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("bulletin", { message: "BREAKING: sanctions.", affectedSymbol: "AXON", nonce: 4 })
    const first = net.bulletin
    feed().emit("bulletin", { message: "BREAKING: sanctions.", affectedSymbol: "AXON", nonce: 5 })
    expect(net.bulletin).not.toBe(first)
    expect(net.bulletin?.nonce).toBe(5)
  })
})

describe("the winners' ceremony", () => {
  const ceremony: WinnersState = {
    startedAt: 1_000,
    nonce: 1,
    podium: [{ place: 3, teamId: "team-b", announcedAt: 2_000 }],
  }

  it("is nothing until the gamemaster starts one", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    expect(net.winners).toBeNull()
  })

  it("follows a winners frame, the whole podium each time", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("winners", ceremony)
    expect(net.winners).toEqual(ceremony)
    feed().emit("winners", null)
    expect(net.winners).toBeNull()
  })

  // A screen that opens mid-ceremony has missed the frames; hello is what
  // tells it the room is dark and who is on the podium already.
  it("is picked up from hello by a client that arrives mid-ceremony", () => {
    render(<Probe />)
    feed().emit("hello", hello({ winners: ceremony }))
    expect(net.winners).toEqual(ceremony)
  })
})

// Idle characters are not streamed: the hub hands over the state to wander
// them from, and this hook is where that reaches the scene.
describe("idle characters' wander state", () => {
  const ROSTER = buildAllPlayers([
    {
      id: "team-a",
      name: "TEAM 01",
      players: [
        { id: "user-ada", name: "Ada", spriteId: null, spriteSheet: null },
        { id: "user-bob", name: "Bob", spriteId: null, spriteSheet: null },
      ],
    },
  ])
  const roster = [
    { idx: 0, id: "user-ada", name: "Ada", team: "TEAM 01" },
    { idx: 1, id: "user-bob", name: "Bob", team: "TEAM 01" },
  ]
  const bobWander = [1, 12.5, 0.224, 0, 99] as const

  function RosterProbe() {
    net = useGameRoomNet(ROSTER)
    return null
  }
  const makeHandle = () => ({
    setWanderStates: vi.fn(),
    setNetStates: vi.fn(),
    setLocalPlayer: vi.fn(),
    upsertGuest: vi.fn(),
    removeGuest: vi.fn(),
  })

  it("lists the connected guests by the player index it minted for them", () => {
    // A guest's pets are seated by this list (room-pets), so the room can
    // draw a mentor's or a judge's pets on every client, not only their own.
    render(<RosterProbe />)
    feed().emit("hello", hello({ roster: [...roster, { idx: 5, id: "user-mentor", name: "Mentor", team: "", guest: true, role: "mentor" }] }))
    expect(net.guests).toEqual([{ id: "user-mentor", playerIdx: ROSTER.length + 5 }])

    feed().emit("join", { idx: 6, id: "user-judge", name: "Judge", team: "", guest: true, role: "judge" })
    expect(net.guests).toEqual([
      { id: "user-mentor", playerIdx: ROSTER.length + 5 },
      { id: "user-judge", playerIdx: ROSTER.length + 6 },
    ])

    feed().emit("leave", { idx: 5, guest: true })
    expect(net.guests).toEqual([{ id: "user-judge", playerIdx: ROSTER.length + 6 }])
  })

  it("hands the scene the wanderers hello carries, by this page's player index", () => {
    render(<RosterProbe />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("hello", hello({ you: 0, roster, states: [[0, 100, 100, 2, 2]], wanders: [[...bobWander]] }))
    expect(handle.setWanderStates).toHaveBeenLastCalledWith([
      { playerIdx: 1, phase: 12.5, speed: 0.224, pauseLeft: 0, rng: 99 },
    ])
  })

  it("passes a wander frame straight through", () => {
    render(<RosterProbe />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("hello", hello({ you: 0, roster, states: [[0, 100, 100, 2, 2]] }))
    feed().emit("wander", { wanders: [[1, 40, -0.224, 3, 7]] })
    expect(handle.setWanderStates).toHaveBeenLastCalledWith([
      { playerIdx: 1, phase: 40, speed: -0.224, pauseLeft: 3, rng: 7 },
    ])
  })

  it("never hands over this client's own character", () => {
    render(<RosterProbe />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("hello", hello({ you: 1, roster, states: [[1, 100, 100, 2, 2]] }))
    feed().emit("wander", { wanders: [[1, 40, 0.224, 0, 7]] })
    expect(handle.setWanderStates).not.toHaveBeenCalled()
  })

  it("gives a scene that mounts after the frames the latest state it missed", () => {
    render(<RosterProbe />)
    feed().emit("hello", hello({ you: 0, roster, states: [[0, 100, 100, 2, 2]], wanders: [[...bobWander]] }))
    feed().emit("wander", { wanders: [[1, 55, 0.224, 0, 8]] })
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    expect(handle.setWanderStates).toHaveBeenCalledWith([
      { playerIdx: 1, phase: 55, speed: 0.224, pauseLeft: 0, rng: 8 },
    ])
  })

  it("forgets a wanderer's state once a snapshot streams the character again", () => {
    render(<RosterProbe />)
    feed().emit("hello", hello({ you: 0, roster, states: [[0, 100, 100, 2, 2]], wanders: [[...bobWander]] }))
    feed().emit("snapshot", { states: [[0, 100, 100, 2, 2], [1, 200, 200, 1, 3]] })
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    expect(handle.setWanderStates).not.toHaveBeenCalled()
    expect(handle.setNetStates).toHaveBeenCalledWith([
      { playerIdx: 1, x: 200, y: 200, dir: 1, moving: true, live: true },
    ])
  })
})

// CODE2IMPACT2026-18: "JSON Parse error: Expected ']'" from a `wander` frame on
// Chrome for iPhone. The hub only ever sends JSON.stringify output, so the page
// received a frame cut short, and the unguarded JSON.parse threw out of the
// listener. A dropped frame also leaves the room out of step with the hub.
describe("a malformed frame", () => {
  it.each(["wander", "snapshot", "hello", "chat", "presentation"])(
    "does not throw from a cut-off %s frame, and reconnects to resync",
    (name) => {
      render(<Probe />)
      feed().emit("hello", hello())
      expect(() => FakeEventSource.instances[0]!.emitRaw(name, '{"wanders":[[3,0.5,1,0')).not.toThrow()
      expect(FakeEventSource.instances[0]!.closed).toBe(true)
      expect(FakeEventSource.instances).toHaveLength(2)
      expect(FakeEventSource.instances[1]!.closed).toBe(false)
    },
  )

  it("keeps working on the fresh stream", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    FakeEventSource.instances[0]!.emitRaw("wander", "{")
    FakeEventSource.instances[1]!.emit("hello", hello())
    FakeEventSource.instances[1]!.emit("screen", { page: "leaderboard" })
    expect(net.forcedScreenPage).toBe("leaderboard")
  })

  it("resyncs once per broken stream, however many bad frames it had queued", () => {
    render(<Probe />)
    const first = FakeEventSource.instances[0]!
    first.emitRaw("wander", "{")
    first.emitRaw("snapshot", "{")
    expect(FakeEventSource.instances).toHaveLength(2)
  })
})
