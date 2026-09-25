import { describe, expect, it } from "vitest"
import {
  dialogTypewriterMs,
  SNAPSHOT_INTERVAL_MS,
  unpackState,
  type HelloEvent,
  type SnapshotEntry,
} from "~/lib/gameRoomNet/protocol"
import { objectSpeech, ROOM_OBJECTS, roomObjectIdx } from "~/lib/gameRoomNet/objects"
import { PARTICIPANT_TABLES } from "~/components/gameRoom/constants"
import { buildStaticColliders, movePlayer, pointBlocked } from "~/lib/gameRoomNet/collision"
import {
  BULLETIN_MAX_LEN,
  CHAT_COOLDOWN_MS,
  GameRoomHub,
  introductionFor,
  visitorSpawnPoint,
  type HubVisitor,
} from "./hub"

describe("visitorSpawnPoint", () => {
  // The bug: the spawn band was a literal tuned for a shallower room, and once
  // the desk grid grew over it visitors arrived inside a table's collider,
  // pinned in place because every direction they could walk was blocked.
  it("never drops a visitor inside a collider, whatever their index", () => {
    const colliders = buildStaticColliders()
    for (let idx = 0; idx < 200; idx++) {
      const spawn = visitorSpawnPoint(idx, colliders)
      expect(
        pointBlocked(spawn.x, spawn.y, colliders),
        `visitor ${idx} spawned blocked at ${spawn.x},${spawn.y}`,
      ).toBe(false)
    }
  })

  it("leaves a visitor able to walk away from where they land", () => {
    // Standing on free floor is not enough on its own — a spot boxed in on
    // every side would still strand them.
    const colliders = buildStaticColliders()
    for (let idx = 0; idx < 50; idx++) {
      const { x, y } = visitorSpawnPoint(idx, colliders)
      const canLeave = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        movePlayer(x, y, dx! * 4, dy! * 4, colliders).moved,
      )
      expect(canLeave, `visitor ${idx} is walled in at ${x},${y}`).toBe(true)
    }
  })

  it("keeps visitors clear of the desks entirely", () => {
    // They arrive in the room's open southern floor, not in an aisle that the
    // next layout change could close up.
    const lastDeskBottom = Math.max(...PARTICIPANT_TABLES.map((t) => t.y + t.h))
    for (let idx = 0; idx < 50; idx++) {
      expect(visitorSpawnPoint(idx).y).toBeGreaterThan(lastDeskBottom)
    }
  })
})

interface Frame {
  event: string
  data: unknown
}

function makeSink() {
  const frames: Frame[] = []
  const send = (frame: string) => {
    const m = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(frame)
    if (!m) throw new Error(`unparseable frame: ${frame}`)
    frames.push({ event: m[1]!, data: JSON.parse(m[2]!) })
  }
  return { frames, send }
}

const VISITORS: Record<string, HubVisitor> = {
  "user-ada": { id: "user-ada", name: "Ada Lovelace", role: "visitor", spriteId: null, spriteSheet: null },
  "user-bob": { id: "user-bob", name: "Bob Tan", role: "visitor", spriteId: null, spriteSheet: null },
  "user-cyn": { id: "user-cyn", name: "Cynthia Lee", role: "visitor", spriteId: null, spriteSheet: null },
  "user-admin": { id: "user-admin", name: "Randal Cunanan", role: "host", spriteId: 3, spriteSheet: null },
}

function makeHub(start = 1_000_000) {
  let now = start
  // A per-hub copy: tests that change a visitor's character must not leak that
  // into the next test's fixture.
  const visitors: Record<string, HubVisitor> = { ...VISITORS }
  let lookupFails = false
  const hub = new GameRoomHub({
    loadVisitor: async (userId) => {
      if (lookupFails) throw new Error("db down")
      return visitors[userId] ?? null
    },
    now: () => now,
    autoTick: false,
  })
  return {
    hub,
    visitors,
    advance: (ms: number) => { now += ms },
    breakLookup: () => { lookupFails = true },
  }
}

const statesOf = (frame: Frame) =>
  (frame.data as { states: SnapshotEntry[] }).states.map(unpackState)
const helloOf = (sink: ReturnType<typeof makeSink>) => sink.frames[0]!.data as HelloEvent

describe("subscribe", () => {
  it("greets a visitor with hello: their idx, everyone present, where they all are", async () => {
    const { hub } = makeHub()
    const ada = makeSink()
    await hub.subscribe("user-ada", ada.send)
    const bob = makeSink()
    await hub.subscribe("user-bob", bob.send)

    expect(bob.frames[0]!.event).toBe("hello")
    const hello = helloOf(bob)
    expect(hello.you).toBe(1) // connection order: ada, bob
    expect(hello.visitors).toEqual([
      { idx: 0, id: "user-ada", name: "Ada Lovelace", role: "visitor", spriteId: null, spriteSheet: null },
      { idx: 1, id: "user-bob", name: "Bob Tan", role: "visitor", spriteId: null, spriteSheet: null },
    ])
    expect(hello.states).toHaveLength(2)
    const you = unpackState(hello.states[1]!)
    expect(you.idx).toBe(1)
    expect(you.live).toBe(true)
    expect({ x: you.x, y: you.y }).toEqual(visitorSpawnPoint(1))
  })

  it("a user the host has not introduced spectates: hello.you is null", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-nobody", sink.send)
    expect(helloOf(sink).you).toBeNull()
    expect(helloOf(sink).visitors).toEqual([])
  })

  // A visitor's character goes out on the wire from the hub, and the HubChar
  // behind it outlives every connection — it is only marked departed.
  // Re-reading on connect is what stops someone who just changed character
  // from walking back in as their old one until the process restarts.
  it("picks up a visitor's new character on their next connection", async () => {
    const { hub, visitors } = makeHub()
    const detach = await hub.subscribe("user-admin", makeSink().send)
    detach()

    visitors["user-admin"] = { ...visitors["user-admin"]!, spriteId: 41 }
    const second = makeSink()
    await hub.subscribe("user-admin", second.send)

    const me = helloOf(second).visitors.find((entry) => entry.id === "user-admin")
    expect(me?.spriteId).toBe(41)
  })

  // The audience draws a visitor from the join frame, so a stale sprite there
  // is the same bug seen from the other side of the room.
  it("announces the visitor's current character to the room", async () => {
    const { hub, visitors } = makeHub()
    const audience = makeSink()
    await hub.subscribe("user-ada", audience.send)

    const detach = await hub.subscribe("user-admin", makeSink().send)
    detach()
    visitors["user-admin"] = { ...visitors["user-admin"]!, spriteId: 7 }
    await hub.subscribe("user-admin", makeSink().send)

    const joins = audience.frames.filter((f) => f.event === "join")
    expect((joins.at(-1)?.data as { spriteId?: number | null }).spriteId).toBe(7)
  })

  // The refresh is a lookup on a live connection path: it must not cost the
  // visitor the character the hub already knows about.
  it("keeps the known character when the refresh lookup fails", async () => {
    const { hub, breakLookup } = makeHub()
    const detach = await hub.subscribe("user-admin", makeSink().send)
    detach()

    breakLookup()
    const sink = makeSink()
    await hub.subscribe("user-admin", sink.send)

    const hello = helloOf(sink)
    expect(hello.you).not.toBeNull()
    expect(hello.visitors.find((entry) => entry.id === "user-admin")?.spriteId).toBe(3)
  })

  it("broadcasts join on first connection and leave after the last detach", async () => {
    const { hub } = makeHub()
    const a = makeSink()
    await hub.subscribe("user-ada", a.send)
    const b1 = makeSink()
    const detach1 = await hub.subscribe("user-bob", b1.send)
    const join = a.frames.find((f) => f.event === "join")
    expect(join?.data).toEqual({ idx: 1, id: "user-bob", name: "Bob Tan", role: "visitor", spriteId: null, spriteSheet: null })

    const b2 = makeSink()
    const detach2 = await hub.subscribe("user-bob", b2.send)
    detach1()
    expect(a.frames.filter((f) => f.event === "leave")).toHaveLength(0) // still one tab open
    detach2()
    expect(a.frames.find((f) => f.event === "leave")?.data).toEqual({ idx: 1 })
  })

  it("a departed visitor is gone from the room and revives at the spawn, same idx", async () => {
    const { hub, advance } = makeHub()
    const ada = makeSink()
    await hub.subscribe("user-ada", ada.send)
    const bob = makeSink()
    const detach = await hub.subscribe("user-bob", bob.send)
    // Bob walks off the spawn before hanging up.
    advance(60_000)
    hub.handleInput("user-bob", { x: 300, y: 450, dir: 1, moving: true })
    detach()

    advance(SNAPSHOT_INTERVAL_MS)
    hub.tick()
    const last = statesOf(ada.frames.filter((f) => f.event === "snapshot").at(-1)!)
    expect(last.map((s) => s.idx)).toEqual([0])
    // A fresh client never hears about the departed visitor…
    const late = makeSink()
    await hub.subscribe("user-cyn", late.send)
    expect(helloOf(late).visitors.map((v) => v.id)).toEqual(["user-ada", "user-cyn"])

    // …until they come back, same idx, back at the spawn.
    const again = makeSink()
    await hub.subscribe("user-bob", again.send)
    expect(helloOf(again).you).toBe(1)
    const revived = statesOf(again.frames[0]!).find((s) => s.idx === 1)!
    expect({ x: revived.x, y: revived.y }).toEqual(visitorSpawnPoint(1))
  })
})

describe("tick", () => {
  it("streams every connected visitor and nobody else", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const detachBob = await hub.subscribe("user-bob", makeSink().send)

    advance(SNAPSHOT_INTERVAL_MS)
    hub.tick()
    expect(statesOf(sink.frames.filter((f) => f.event === "snapshot").at(-1)!).map((s) => s.idx)).toEqual([0, 1])

    detachBob()
    advance(SNAPSHOT_INTERVAL_MS)
    hub.tick()
    expect(statesOf(sink.frames.filter((f) => f.event === "snapshot").at(-1)!).map((s) => s.idx)).toEqual([0])
  })

  it("moves nobody on its own: where a visitor stands is their client's to say", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const { x, y } = hub.charForUser("user-ada")!
    advance(2_000)
    hub.tick()
    const after = hub.charForUser("user-ada")!
    expect(after.x).toBe(x)
    expect(after.y).toBe(y)
  })

  it("stays quiet with nobody connected", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    const detach = await hub.subscribe("user-ada", sink.send)
    detach()
    const before = sink.frames.length
    advance(SNAPSHOT_INTERVAL_MS)
    hub.tick()
    expect(sink.frames).toHaveLength(before)
  })
})

describe("handleInput", () => {
  it("accepts a plausible move and rejects without a live connection", async () => {
    const { hub, advance } = makeHub()
    expect(hub.handleInput("user-ada", { x: 100, y: 200, dir: 1, moving: true })).toBe(false)

    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const c = hub.charForUser("user-ada")!
    advance(100)
    const nx = c.x + 8 // ~10.5 px allowed for 100 ms plus slack
    const ok = hub.handleInput("user-ada", { x: nx, y: c.y, dir: 1, moving: true })
    expect(ok).toBe(true)
    expect(hub.charForUser("user-ada")!.x).toBe(nx)
    expect(hub.charForUser("user-ada")!.moving).toBe(true)
  })

  it("keeps the last good position on a teleport, but still updates facing", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const c = hub.charForUser("user-ada")!
    const { x, y } = c
    advance(100)
    hub.handleInput("user-ada", { x: x + 300, y, dir: 3, moving: true })
    const after = hub.charForUser("user-ada")!
    expect(after.x).toBe(x)
    expect(after.y).toBe(y)
    expect(after.dir).toBe(3)
  })

  it("rejects a position inside furniture", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const c = hub.charForUser("user-ada")!
    const tbl = PARTICIPANT_TABLES[0]!
    // Plenty of allowance — only the collider can refuse now.
    advance(60_000)
    hub.handleInput("user-ada", {
      x: tbl.x + tbl.w / 2,
      y: tbl.y + tbl.h / 2,
      dir: 0,
      moving: true,
    })
    const after = hub.charForUser("user-ada")!
    expect({ x: after.x, y: after.y }).toEqual({ x: c.x, y: c.y })
  })

  it("marks a silent mover as stopped after the stale window", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const c = hub.charForUser("user-ada")!
    advance(100)
    hub.handleInput("user-ada", { x: c.x, y: c.y, dir: 2, moving: true })
    advance(4_000)
    hub.tick()
    expect(hub.charForUser("user-ada")!.moving).toBe(false)
  })
})

describe("handleInteract", () => {
  async function liveHubWithNeighbours() {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    await hub.subscribe("user-bob", makeSink().send)
    // Park Ada right next to Bob's spawn.
    const bob = hub.charForUser("user-bob")!
    advance(60_000)
    hub.handleInput("user-ada", { x: bob.x + 20, y: bob.y, dir: 3, moving: false })
    expect(hub.charForUser("user-ada")!.x).toBe(bob.x + 20)
    return { hub, advance, sink, bob }
  }

  it("sends the introduction only to the interacting user's connections", async () => {
    const { hub, sink, bob } = await liveHubWithNeighbours()
    const target = makeSink(), bystander = makeSink(), secondTab = makeSink()
    await hub.subscribe("user-bob", target.send)
    await hub.subscribe("user-cyn", bystander.send)
    await hub.subscribe("user-ada", secondTab.send)
    const result = hub.handleInteract("user-ada", bob.idx)
    expect(result).toMatchObject({ ok: true, text: "Hi, I'm Bob! I'm a visitor here." })
    const ms = (result as { ms: number }).ms
    expect(ms).toBeGreaterThanOrEqual(2_500)
    const say = sink.frames.find((f) => f.event === "say")
    expect(say?.data).toEqual({
      idx: bob.idx,
      by: 0,
      name: "Bob Tan",
      text: "Hi, I'm Bob! I'm a visitor here.",
      ms,
    })
    expect(secondTab.frames.find((f) => f.event === "say")?.data).toEqual(say?.data)
    expect(target.frames.some((f) => f.event === "say")).toBe(false)
    expect(bystander.frames.some((f) => f.event === "say")).toBe(false)
  })

  it("freezes only the reader and lets other players interact independently", async () => {
    const { hub, advance, bob } = await liveHubWithNeighbours()
    const ada = hub.charForUser("user-ada")!
    // Park a third live player near Bob too, before the conversation starts.
    const cyn = makeSink()
    await hub.subscribe("user-cyn", cyn.send)
    advance(60_000)
    hub.handleInput("user-cyn", { x: bob.x - 20, y: bob.y, dir: 1, moving: false })
    expect(hub.charForUser("user-cyn")!.x).toBe(bob.x - 20)

    const result = hub.handleInteract("user-ada", bob.idx)
    expect(result.ok).toBe(true)
    const ms = (result as { ms: number }).ms
    // Ada faces the target while reading her private introduction.
    expect(ada.dir).toBe(3)

    // Movement reports are swallowed while frozen…
    const { x, y } = ada
    advance(200)
    expect(hub.handleInput("user-ada", { x: x + 5, y, dir: 1, moving: true })).toBe(true)
    expect({ x: ada.x, y: ada.y, dir: ada.dir }).toEqual({ x, y, dir: 3 })
    // …the target is not frozen by someone else's private dialogue…
    advance(100)
    expect(hub.handleInput("user-bob", { x: bob.x + 3, y: bob.y, dir: 1, moving: true })).toBe(true)
    expect(hub.charForUser("user-bob")!.moving).toBe(true)
    // …and a third player can talk to the same target meanwhile.
    expect(hub.handleInteract("user-cyn", bob.idx).ok).toBe(true)

    // The reader's freeze lifts on schedule.
    advance(ms)
    hub.handleInput("user-ada", { x: x + 5, y, dir: 1, moving: true })
    expect(hub.charForUser("user-ada")!.x).toBe(x + 5)
  })

  it("a finished private dialog can be dismissed early, unfreezing its reader", async () => {
    const { hub, advance, bob } = await liveHubWithNeighbours()
    const ada = hub.charForUser("user-ada")!
    const result = hub.handleInteract("user-ada", bob.idx)
    expect(result.ok).toBe(true)
    const text = (result as { text: string }).text
    const ms = (result as { ms: number }).ms

    // Too early: the typewriter cannot have finished yet.
    expect(hub.handleDismiss("user-ada")).toBe(false)

    // Once the reveal is done, the reader may dismiss — and the
    // reveal finishes far inside the freeze window, which was the delay.
    expect(dialogTypewriterMs(text)).toBeLessThan(ms / 2)
    advance(dialogTypewriterMs(text) + 50)
    expect(hub.handleDismiss("user-ada")).toBe(true)
    // Ada's movement applies well before the dialog's natural end.
    const { x, y } = ada
    advance(100)
    hub.handleInput("user-ada", { x: x + 3, y, dir: 1, moving: true })
    expect(hub.charForUser("user-ada")!.x).toBe(x + 3)
  })

  it("dismissing sends dialogEnd only to its reader", async () => {
    const { hub, advance, sink, bob } = await liveHubWithNeighbours()
    const target = makeSink()
    await hub.subscribe("user-bob", target.send)
    const result = hub.handleInteract("user-ada", bob.idx)
    advance(dialogTypewriterMs((result as { text: string }).text) + 50)
    hub.handleDismiss("user-ada")
    const end = sink.frames.find((f) => f.event === "dialogEnd")
    expect(end?.data).toEqual({ a: 0, b: null })
    expect(target.frames.some((f) => f.event === "dialogEnd" || f.event === "say")).toBe(false)
  })

  it("dismissing with no open dialog is a harmless no-op", async () => {
    const { hub } = await liveHubWithNeighbours()
    expect(hub.handleDismiss("user-ada")).toBe(true)
  })

  it("refuses out-of-range, self, unknown, departed and spamming", async () => {
    const { hub, advance, bob } = await liveHubWithNeighbours()
    // Cyn is connected but across the floor.
    const detachCyn = await hub.subscribe("user-cyn", makeSink().send)
    advance(60_000)
    hub.handleInput("user-cyn", { x: bob.x - 120, y: bob.y, dir: 1, moving: false })
    expect(hub.charForUser("user-cyn")!.x).toBe(bob.x - 120)
    expect(hub.handleInteract("user-ada", 2)).toEqual({ ok: false, error: "OUT_OF_RANGE" })
    expect(hub.handleInteract("user-ada", 0)).toEqual({ ok: false, error: "NO_TARGET" }) // self
    expect(hub.handleInteract("user-ada", 99)).toEqual({ ok: false, error: "NO_TARGET" })
    expect(hub.handleInteract("user-nobody", bob.idx)).toEqual({ ok: false, error: "NOT_LIVE" })
    detachCyn()
    expect(hub.handleInteract("user-cyn", bob.idx)).toEqual({ ok: false, error: "NOT_LIVE" })
    expect(hub.handleInteract("user-ada", 2)).toEqual({ ok: false, error: "NO_TARGET" }) // departed

    const first = hub.handleInteract("user-ada", bob.idx)
    expect(first.ok).toBe(true)
    expect(hub.handleInteract("user-ada", bob.idx)).toEqual({ ok: false, error: "BUSY" })
    advance((first as { ms: number }).ms + 100)
    expect(hub.handleInteract("user-ada", bob.idx).ok).toBe(true)
  })

  it("a visitor introduces themselves by role", async () => {
    const { hub, advance } = makeHub()
    await hub.subscribe("user-ada", makeSink().send)
    await hub.subscribe("user-admin", makeSink().send)
    // Walk Ada next to the host's spawn so the interact is in range.
    const spawn = visitorSpawnPoint(1)
    advance(60_000)
    hub.handleInput("user-ada", { x: spawn.x + 15, y: spawn.y, dir: 3, moving: false })
    const result = hub.handleInteract("user-ada", 1)
    expect(result).toMatchObject({ ok: true, text: "Hi, I'm Randal! I'm a host here." })
  })
})

describe("handleChat", () => {
  it("broadcasts a live player's message to the whole room", async () => {
    const { hub } = makeHub()
    const ada = makeSink()
    const cyn = makeSink()
    await hub.subscribe("user-ada", ada.send)
    await hub.subscribe("user-cyn", cyn.send)

    expect(hub.handleChat("user-ada", "gm team, orders are flowing")).toEqual({ ok: true })
    for (const sink of [ada, cyn]) {
      const chat = sink.frames.find((f) => f.event === "chat")
      expect(chat?.data).toEqual({ idx: 0, name: "Ada Lovelace", text: "gm team, orders are flowing" })
    }
  })

  // The hub is the one place every chat line passes through, so it is where
  // the censor has to sit — a hand-rolled POST reaches it the same as the UI.
  it("censors profanity before the line reaches the room", async () => {
    const { hub } = makeHub()
    const ada = makeSink()
    const cyn = makeSink()
    await hub.subscribe("user-ada", ada.send)
    await hub.subscribe("user-cyn", cyn.send)

    expect(hub.handleChat("user-ada", "this shit is broken")).toEqual({ ok: true })
    for (const sink of [ada, cyn]) {
      const chat = sink.frames.find((f) => f.event === "chat")
      expect(chat?.data).toEqual({ idx: 0, name: "Ada Lovelace", text: "this **** is broken" })
    }
  })

  it("refuses users without a live character", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    // Bob is known to the host but not connected; user-nobody has no character.
    expect(hub.handleChat("user-bob", "hi")).toEqual({ ok: false, error: "NOT_LIVE" })
    expect(hub.handleChat("user-nobody", "hi")).toEqual({ ok: false, error: "NOT_LIVE" })
  })

  it("rate limits rapid-fire messages, independently per user", async () => {
    const { hub, advance } = makeHub()
    const ada = makeSink()
    const cyn = makeSink()
    await hub.subscribe("user-ada", ada.send)
    await hub.subscribe("user-cyn", cyn.send)

    expect(hub.handleChat("user-ada", "one").ok).toBe(true)
    expect(hub.handleChat("user-ada", "two")).toEqual({ ok: false, error: "RATE_LIMITED" })
    // Another user's cooldown is their own.
    expect(hub.handleChat("user-cyn", "three").ok).toBe(true)
    advance(CHAT_COOLDOWN_MS)
    expect(hub.handleChat("user-ada", "four").ok).toBe(true)
  })

  it("chatting does not freeze anyone or open a dialog", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    const ada = hub.charForUser("user-ada")!
    hub.handleChat("user-ada", "still walking")
    const { x, y } = ada
    advance(200)
    expect(hub.handleInput("user-ada", { x: x + 5, y, dir: 1, moving: true })).toBe(true)
    expect(ada.x).toBe(x + 5)
  })
})

describe("interactable objects", () => {
  const SE_IDX = roomObjectIdx("plant-se")
  const SE = ROOM_OBJECTS.find((o) => o.id === "plant-se")!

  async function liveNextToThePlant(userId: string, hub: GameRoomHub, advance: (ms: number) => void) {
    const sink = makeSink()
    await hub.subscribe(userId, sink.send)
    advance(60_000)
    hub.handleInput(userId, { x: SE.x - 20, y: SE.y, dir: 1, moving: false })
    return sink
  }

  it("talking to a plant opens a dialog and freezes only the player", async () => {
    const { hub, advance } = makeHub()
    const sink = await liveNextToThePlant("user-ada", hub, advance)
    const ada = hub.charForUser("user-ada")!
    const result = hub.handleInteract("user-ada", SE_IDX)
    expect(result).toMatchObject({ ok: true, text: "It's just a normal plant..." })
    expect(ada.dir).toBe(1) // squared up to face the plant
    const say = sink.frames.find((f) => f.event === "say")
    expect(say?.data).toMatchObject({ idx: SE_IDX, by: ada.idx, name: "Plant", text: "It's just a normal plant..." })
    // frozen for the dialog
    const { x } = ada
    advance(300)
    hub.handleInput("user-ada", { x: x + 5, y: ada.y, dir: 1, moving: true })
    expect(ada.x).toBe(x)
  })

  it("out of range is refused", async () => {
    const { hub, advance } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    advance(60_000)
    hub.handleInput("user-ada", { x: 400, y: 300, dir: 1, moving: false })
    expect(hub.handleInteract("user-ada", SE_IDX)).toEqual({ ok: false, error: "OUT_OF_RANGE" })
  })

  it("each player starts their own plant script and receives only their dialogue", async () => {
    const { hub, advance } = makeHub()
    const adaSink = await liveNextToThePlant("user-ada", hub, advance)
    const first = hub.handleInteract("user-ada", SE_IDX)
    expect(first).toMatchObject({ ok: true, text: objectSpeech("plant-se", 1) })

    const bobSink = await liveNextToThePlant("user-bob", hub, advance)
    advance((first as { ms: number }).ms + 100)
    const second = hub.handleInteract("user-bob", SE_IDX)
    expect(second).toMatchObject({ ok: true, text: objectSpeech("plant-se", 1) })
    expect(adaSink.frames.filter((f) => f.event === "say")).toHaveLength(1)
    expect(bobSink.frames.filter((f) => f.event === "say")).toHaveLength(1)
  })

  it("reveals the hatch only for its discoverer and restores their own reconnect state", async () => {
    const { hub, advance } = makeHub()
    const sink = await liveNextToThePlant("user-ada", hub, advance)
    const other = makeSink()
    await hub.subscribe("user-cyn", other.send)
    expect(sink.frames.find((f) => f.event === "hello")?.data).toMatchObject({ backroomsUnlocked: false })
    for (let i = 0; i < 9; i++) {
      const result = hub.handleInteract("user-ada", SE_IDX) as { ok: boolean; ms: number }
      expect(result.ok).toBe(true)
      expect(hub.handleInteract("user-ada", SE_IDX).ok).toBe(false)
      advance(result.ms + 100)
    }
    expect(sink.frames.filter((f) => f.event === "backrooms")).toHaveLength(0)
    const tenth = hub.handleInteract("user-ada", SE_IDX) as { ms: number }
    expect(sink.frames.filter((f) => f.event === "backrooms").map((f) => f.data)).toEqual([{ unlocked: true }])
    advance(tenth.ms + 100)
    hub.handleInteract("user-ada", SE_IDX)
    expect(sink.frames.filter((f) => f.event === "backrooms")).toHaveLength(1)
    expect(other.frames.some((f) => f.event === "backrooms" || f.event === "say")).toBe(false)
    const newcomer = makeSink()
    await hub.subscribe("user-bob", newcomer.send)
    expect(newcomer.frames.find((f) => f.event === "hello")?.data).toMatchObject({ backroomsUnlocked: false })
    const returning = makeSink()
    await hub.subscribe("user-ada", returning.send)
    expect(returning.frames.find((f) => f.event === "hello")?.data).toMatchObject({ backroomsUnlocked: true })
  })

  it("ten personal interactions reach the confession", async () => {
    const { hub, advance } = makeHub()
    await liveNextToThePlant("user-ada", hub, advance)
    let text = ""
    for (let i = 0; i < 10; i++) {
      const result = hub.handleInteract("user-ada", SE_IDX)
      expect(result.ok).toBe(true)
      text = (result as { text: string; ms: number }).text
      advance((result as { ms: number }).ms + 100)
    }
    expect(text.toLowerCase()).toContain("you found my secret")
  })
})

describe("introductionFor", () => {
  it("uses the first name and the role, with the right article", () => {
    expect(introductionFor({ name: "Grace Hopper", role: "host" })).toBe("Hi, I'm Grace! I'm a host here.")
    expect(introductionFor({ name: "Grace Hopper", role: "observer" })).toBe("Hi, I'm Grace! I'm an observer here.")
    expect(introductionFor({ name: "Grace" })).toBe("Hi, I'm Grace! I'm a visitor here.")
  })
})

// ---------------------------------------------------------------------------
// The gamemaster's room controls (the #GAME ROOM console tab)
// ---------------------------------------------------------------------------

describe("setMusic", () => {
  it("leaves the music to the room's playlist until the gamemaster takes it", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    expect(helloOf(sink).music).toBeNull()
    expect(hub.getMusic()).toBeNull()
  })

  it("puts one track, or silence, on every connection in the room", async () => {
    const { hub } = makeHub()
    const ada = makeSink()
    const cyn = makeSink()
    await hub.subscribe("user-ada", ada.send)
    await hub.subscribe("user-cyn", cyn.send)

    hub.setMusic({ mode: "track", track: "/theme.mp3" })
    hub.setMusic({ mode: "stop" })

    for (const sink of [ada, cyn]) {
      const frames = sink.frames.filter((f) => f.event === "music").map((f) => f.data)
      expect(frames).toEqual([{ mode: "track", track: "/theme.mp3" }, { mode: "stop" }])
    }
  })

  // A screen that reconnects mid-hold has missed the frame, and would be the
  // one PA screen playing something else.
  it("tells a client that arrives mid-hold what is on", async () => {
    const { hub } = makeHub()
    hub.setMusic({ mode: "track", track: "/theme_jazz.mp3" })
    const late = makeSink()
    await hub.subscribe("user-ada", late.send)
    expect(helloOf(late).music).toEqual({ mode: "track", track: "/theme_jazz.mp3" })
  })

  it("hands the music back to the playlist on release", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    hub.setMusic({ mode: "stop" })
    hub.setMusic(null)

    expect(sink.frames.filter((f) => f.event === "music").at(-1)?.data).toBeNull()
    const late = makeSink()
    await hub.subscribe("user-cyn", late.send)
    expect(helloOf(late).music).toBeNull()
  })
})

describe("sendBulletin", () => {
  it("puts the gamemaster's message on every screen in the room", async () => {
    const { hub } = makeHub()
    const ada = makeSink()
    const cyn = makeSink()
    await hub.subscribe("user-ada", ada.send)
    await hub.subscribe("user-cyn", cyn.send)

    hub.sendBulletin("Lunch is served in the atrium.")

    for (const sink of [ada, cyn]) {
      const bulletin = sink.frames.find((f) => f.event === "bulletin")
      expect(bulletin?.data).toMatchObject({
        message: "Lunch is served in the atrium.",
      })
    }
  })

  // The room draws this across three lines of a canvas; an unbounded paste
  // would be measured and then mostly thrown away.
  it("bounds a pasted wall of text", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    hub.sendBulletin("x".repeat(BULLETIN_MAX_LEN + 50))
    const { message } = sink.frames.find((f) => f.event === "bulletin")!.data as { message: string }
    expect(message).toHaveLength(BULLETIN_MAX_LEN)
  })

  it("refuses a message with nothing in it", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    expect(hub.sendBulletin("   ")).toBeNull()
    expect(sink.frames.some((f) => f.event === "bulletin")).toBe(false)
  })

  it("reports the nonce it stamped", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)

    const nonce = hub.sendBulletin("Lunch at 12:30.")

    const frame = sink.frames.find((f) => f.event === "bulletin")!.data as { nonce: number }
    expect(nonce).toBe(frame.nonce)
  })

  it("carries the hold the gamemaster asked for", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)

    hub.sendBulletin("Lunch at 12:30.", { holdMs: 30_000 })

    expect(sink.frames.find((f) => f.event === "bulletin")?.data).toMatchObject({ holdMs: 30_000 })
  })

  // Sending the same text twice must raise the banner twice, and the client
  // can only tell those apart by the nonce.
  it("stamps each send with its own nonce, so a repeat still plays", async () => {
    const { hub } = makeHub()
    const sink = makeSink()
    await hub.subscribe("user-ada", sink.send)
    hub.sendBulletin("Five minutes to lunch.")
    hub.sendBulletin("Five minutes to lunch.")
    const nonces = sink.frames
      .filter((f) => f.event === "bulletin")
      .map((f) => (f.data as { nonce: number }).nonce)
    expect(nonces).toHaveLength(2)
    expect(nonces[1]).not.toBe(nonces[0])
  })

  // A bulletin is a moment rather than a state: a reconnect five minutes
  // later must not replay a banner the room has long since finished reading.
  it("is not replayed to a client that connects afterwards", async () => {
    const { hub } = makeHub()
    hub.sendBulletin("Five minutes to lunch.")
    const late = makeSink()
    await hub.subscribe("user-ada", late.send)
    expect(late.frames.some((f) => f.event === "bulletin")).toBe(false)
  })
})
