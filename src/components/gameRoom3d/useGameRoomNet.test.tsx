// The frames the visitors' hub pushes into the room — who is here, where they
// are, the private conversations, the gamemaster's music and bulletin — enter
// the client through this hook. So does the single-player room, which has no
// hub and seats its one visitor itself.
import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BACKROOMS_UNLOCK_COUNT, roomObjectIdx } from "~/lib/gameRoomNet/objects"
import { visitorSpawnPoint } from "~/lib/gameRoomNet/spawn"
import type { HelloEvent } from "~/lib/gameRoomNet/protocol"
import type { RoomSceneHandle } from "./scene"
import type { GameRoomNetOptions } from "./useGameRoomNet"

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
  visitors: [],
  states: [],
  ...over,
})

let net: ReturnType<typeof useGameRoomNet>

function Probe({ options }: { options?: GameRoomNetOptions }) {
  net = useGameRoomNet(options ?? { hub: true })
  return null
}

const feed = () => FakeEventSource.instances[0]!

const makeHandle = () => ({
  setNetStates: vi.fn(),
  setLocalPlayer: vi.fn(),
  upsertGuest: vi.fn(),
  removeGuest: vi.fn(),
  freezeLocalInput: vi.fn(),
  showSpeech: vi.fn(),
  showObjectSpeech: vi.fn(),
})

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
    const handle = makeHandle()
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
  it("arrives with its message and nonce", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("bulletin", { message: "Lunch at 12:30.", nonce: 1 })
    expect(net.bulletin).toEqual({ message: "Lunch at 12:30.", nonce: 1 })
  })

  // Sending the same text twice — a rehearsal, then the real thing — has to
  // read as two bulletins, and only the nonce says so.
  it("reads a repeat of the same text as a second bulletin", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    feed().emit("bulletin", { message: "BREAKING: sanctions.", nonce: 4 })
    const first = net.bulletin
    feed().emit("bulletin", { message: "BREAKING: sanctions.", nonce: 5 })
    expect(net.bulletin).not.toBe(first)
    expect(net.bulletin?.nonce).toBe(5)
  })
})

describe("the connected visitors", () => {
  // A visitor carries their hub idx as their player index.
  const visitors = [
    { idx: 0, id: "user-ada", name: "Ada", role: "visitor" as const, spriteId: null, spriteSheet: null },
    { idx: 1, id: "user-bob", name: "Bob", role: "visitor" as const, spriteId: 4, spriteSheet: null },
  ]

  it("lists them by the player index it minted for them, and follows joins and leaves", () => {
    render(<Probe />)
    feed().emit("hello", hello({ visitors: [...visitors, { idx: 5, id: "user-host", name: "Host", role: "host", spriteId: null, spriteSheet: null }] }))
    expect(net.guests).toEqual([
      { id: "user-ada", playerIdx: 0 },
      { id: "user-bob", playerIdx: 1 },
      { id: "user-host", playerIdx: 5 },
    ])

    feed().emit("join", { idx: 6, id: "user-screen", name: "Screen", role: "screen", spriteId: null, spriteSheet: null })
    expect(net.guests.map((guest) => guest.id)).toEqual(["user-ada", "user-bob", "user-host", "user-screen"])

    feed().emit("leave", { idx: 5 })
    expect(net.guests.map((guest) => guest.id)).toEqual(["user-ada", "user-bob", "user-screen"])
  })

  it("puts each one in the scene where hello has them, and hands control of mine to me", () => {
    render(<Probe />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("hello", hello({ you: 0, visitors, states: [[0, 100, 100, 2, 2], [1, 300, 320, 1, 3]] }))
    expect(handle.upsertGuest).toHaveBeenCalledWith(expect.objectContaining({ playerIdx: 0, name: "Ada", start: { x: 100, y: 100 } }))
    expect(handle.upsertGuest).toHaveBeenCalledWith(expect.objectContaining({ playerIdx: 1, name: "Bob", spriteId: 4, start: { x: 300, y: 320 } }))
    expect(handle.setLocalPlayer).toHaveBeenLastCalledWith(0, { x: 100, y: 100 })
    expect(net.myPlayerIdx).toBe(0)
    expect(net.onlineCount).toBe(2)
  })

  it("drives the others from each snapshot, never my own character", () => {
    render(<Probe />)
    feed().emit("hello", hello({ you: 0, visitors, states: [[0, 100, 100, 2, 2], [1, 300, 320, 1, 3]] }))
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("snapshot", { states: [[0, 110, 100, 1, 3], [1, 200, 200, 1, 3]] })
    expect(handle.setNetStates).toHaveBeenLastCalledWith([
      { playerIdx: 1, x: 200, y: 200, dir: 1, moving: true, live: true },
    ])
  })

  it("removes a visitor from the scene when they leave", () => {
    render(<Probe />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    feed().emit("hello", hello({ you: 0, visitors, states: [[0, 100, 100, 2, 2], [1, 300, 320, 1, 3]] }))
    feed().emit("leave", { idx: 1 })
    expect(handle.removeGuest).toHaveBeenCalledWith(1)
  })

  it("sends an interact only for a visitor it knows, or an object", () => {
    render(<Probe />)
    feed().emit("hello", hello({ you: 0, visitors, states: [] }))
    act(() => net.onInteract(1))
    act(() => net.onInteract(9))
    act(() => net.onInteract(roomObjectIdx("plant-se")))
    const posted = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => String(url).endsWith("/api/game-room/interact"))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(posted).toEqual([{ targetIdx: 1 }, { targetIdx: roomObjectIdx("plant-se") }])
  })
})

// "JSON Parse error: Expected ']'" from a frame on Chrome for iPhone. The hub
// only ever sends JSON.stringify output, so the page received a frame cut
// short, and the unguarded JSON.parse threw out of the listener. A dropped
// frame also leaves the room out of step with the hub.
describe("a malformed frame", () => {
  it.each(["join", "snapshot", "hello", "chat", "music"])(
    "does not throw from a cut-off %s frame, and reconnects to resync",
    (name) => {
      render(<Probe />)
      feed().emit("hello", hello())
      expect(() => FakeEventSource.instances[0]!.emitRaw(name, '{"states":[[3,0.5,1,0')).not.toThrow()
      expect(FakeEventSource.instances[0]!.closed).toBe(true)
      expect(FakeEventSource.instances).toHaveLength(2)
      expect(FakeEventSource.instances[1]!.closed).toBe(false)
    },
  )

  it("keeps working on the fresh stream", () => {
    render(<Probe />)
    feed().emit("hello", hello())
    FakeEventSource.instances[0]!.emitRaw("snapshot", "{")
    FakeEventSource.instances[1]!.emit("hello", hello())
    FakeEventSource.instances[1]!.emit("music", { mode: "stop" })
    expect(net.music).toEqual({ mode: "stop" })
  })

  it("resyncs once per broken stream, however many bad frames it had queued", () => {
    render(<Probe />)
    const first = FakeEventSource.instances[0]!
    first.emitRaw("join", "{")
    first.emitRaw("snapshot", "{")
    expect(FakeEventSource.instances).toHaveLength(2)
  })
})

describe("a room with no hub", () => {
  const me = { id: "user-me", name: "Me", role: "host" as const, spriteId: 7 }

  it("opens no stream and posts nothing", () => {
    render(<Probe options={{ hub: false, me }} />)
    act(() => net.onSelfState({ x: 1, y: 2, dir: 0, moving: true }))
    act(() => net.sendChat("anyone?"))
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(net.connected).toBe(false)
  })

  it("seats the one visitor at the spawn and hands them the keys", () => {
    render(<Probe options={{ hub: false, me }} />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    const spawn = visitorSpawnPoint(0)
    expect(handle.upsertGuest).toHaveBeenCalledWith(expect.objectContaining({ playerIdx: 0, name: "Me", role: "host", spriteId: 7, start: spawn }))
    expect(handle.setLocalPlayer).toHaveBeenLastCalledWith(0, spawn)
    expect(net.myPlayerIdx).toBe(0)
    expect(net.guests).toEqual([{ id: "user-me", playerIdx: 0 }])
    expect(net.onlineCount).toBe(1)
  })

  it("a spectator gets no character", () => {
    render(<Probe options={{ hub: false, me: null }} />)
    const handle = makeHandle()
    act(() => net.onSceneReady(handle as never))
    expect(handle.upsertGuest).not.toHaveBeenCalled()
    expect(net.myPlayerIdx).toBeNull()
  })

  it("answers the plants itself, and unlocks the hatch on the same count as the hub", () => {
    vi.useFakeTimers()
    try {
      render(<Probe options={{ hub: false, me }} />)
      const handle = makeHandle()
      act(() => net.onSceneReady(handle as never))
      const plant = roomObjectIdx("plant-se")
      act(() => net.onInteract(plant))
      expect(net.dialog).toMatchObject({ name: "Plant", text: "It's just a normal plant..." })
      expect(handle.freezeLocalInput).toHaveBeenCalledWith(net.dialog!.ms)
      // Pressing again mid-dialog does nothing; the dialog runs its course.
      act(() => net.onInteract(plant))
      act(() => { vi.advanceTimersByTime(net.dialog!.ms + 1) })
      expect(net.dialog).toBeNull()
      for (let i = 2; i < BACKROOMS_UNLOCK_COUNT; i++) {
        act(() => net.onInteract(plant))
        act(() => { vi.advanceTimersByTime(net.dialog!.ms + 1) })
        expect(net.backroomsUnlocked).toBe(false)
      }
      act(() => net.onInteract(plant))
      expect(net.dialog!.text.toLowerCase()).toContain("you found my secret")
      expect(net.backroomsUnlocked).toBe(true)
      // The other plants have nothing to hide, and a visitor cannot talk to themselves.
      act(() => { vi.advanceTimersByTime(net.dialog!.ms + 1) })
      act(() => net.onInteract(roomObjectIdx("plant-nw")))
      expect(net.dialog?.text).toBe("It's just a normal plant...")
      act(() => net.dismissDialog())
      expect(net.dialog).toBeNull()
      expect(handle.freezeLocalInput).toHaveBeenLastCalledWith(0)
      act(() => net.onInteract(0))
      expect(net.dialog).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
