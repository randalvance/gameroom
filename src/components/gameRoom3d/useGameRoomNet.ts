// Client side of the visitors' hub. Opens the SSE stream, puts each connected
// visitor's character in the scene, and drives the scene handle imperatively
// — positions never flow through React props, so the WebGL scene is never
// rebuilt by a snapshot.
//
// Degrades cleanly: while the stream is down (server restart, network) the
// scene simply keeps what it has, and EventSource's own reconnect brings back
// a fresh hello that re-syncs everything. A frame that arrives cut short does
// the same on purpose (see `on`).
//
// With `hub: false` there is no stream at all. The one visitor walks a
// character the hook places itself, the plants answer from the same script
// the hub would run, and the hatch unlocks on the same count — a
// single-player room, not a broken one. Chat and other people need the hub.

import { useCallback, useEffect, useRef, useState } from "react"
import { track } from "~/lib/analytics"
import type { Role } from "~/lib/auth"
import { facingForInput } from "~/lib/gameRoomNet/collision"
import { BACKROOMS_UNLOCK_COUNT, OBJECT_IDX_BASE, objectSpeech, roomObjectByIdx } from "~/lib/gameRoomNet/objects"
import { visitorSpawnPoint } from "~/lib/gameRoomNet/spawn"
import {
  dialogDurationMs,
  packState,
  unpackState,
  type BulletinEvent,
  type ChatEvent,
  type DialogEndEvent,
  type GameRoomEventName,
  type HelloEvent,
  type JoinEvent,
  type LeaveEvent,
  type MusicEvent,
  type SayEvent,
  type SnapshotEntry,
  type VisitorDTO,
} from "~/lib/gameRoomNet/protocol"
import type { RoomNetState, RoomSceneHandle, RoomSelfState } from "./scene"
import type { RoomMusic } from "~/lib/game-room-music"
import { apiUrl } from "~/server/client"

/** A conversation this client is part of, for the RPG dialog box. */
export interface GameRoomDialog {
  /** The speaker's name (the dialog box header). */
  name: string
  text: string
  /** Freeze/display duration. */
  ms: number
  /** Distinguishes back-to-back dialogs with identical text. */
  seq: number
}

/** One line of the room's chat stream. */
export interface GameRoomChatLine {
  /** Client-local ordinal, for React keys. */
  seq: number
  name: string
  text: string
  /** This client's own message (styled differently in the stream). */
  self: boolean
}

/** How much chat history the stream keeps scrollable. */
const CHAT_LOG_MAX = 100

/** The person at this keyboard, for a room with no hub to seat them. */
export interface GameRoomVisitor {
  id: string
  name: string
  role?: Role
  spriteId?: number | null
  spriteSheet?: string | null
}

export interface GameRoomGuest {
  id: string
  playerIdx: number
}

export interface GameRoomNetOptions {
  /** Connect to the visitors' hub. Off, the room is single-player. */
  hub?: boolean
  /** Who is at this keyboard. Only a room with no hub reads it — with one,
   * the hub knows from the identity the host posted. Null spectates. */
  me?: GameRoomVisitor | null
}

export interface GameRoomNet {
  backroomsUnlocked: boolean
  /** Wire into Room3DViewport's onSceneReady. */
  onSceneReady: (handle: RoomSceneHandle | null) => void
  /** Wire into Room3DViewport's onSelfState. */
  onSelfState: (state: RoomSelfState) => void
  /** Wire into Room3DViewport's onInteract. */
  onInteract: (targetPlayerIdx: number) => void
  /** Characters currently player-controlled (self included). */
  onlineCount: number
  /** This user's own character, or null for spectators. */
  myPlayerIdx: number | null
  /** The connected visitors, each at the player index minted for them. */
  guests: GameRoomGuest[]
  /** The stream is up and hello has landed. Never true without a hub. */
  connected: boolean
  /** The conversation this player is currently in, or null. */
  dialog: GameRoomDialog | null
  /** Close the open dialog early (only meaningful once its text finished). */
  dismissDialog: () => void
  /** The room's chat stream, oldest first (capped at CHAT_LOG_MAX). */
  chatLog: GameRoomChatLine[]
  /** Post a chat message; it comes back on the stream as a `chat` event. */
  sendChat: (text: string) => void
  /**
   * The last bulletin the gamemaster pushed straight at the room, or null if
   * there has not been one this connection. Carries a nonce, because two
   * identical sends — a rehearsal and then the real thing — are otherwise
   * indistinguishable and the second must still raise the banner.
   */
  bulletin: BulletinEvent | null
  /**
   * What the gamemaster has put on the PA screens' music — a looping track,
   * silence, or null for the room's own playlist. State: hello carries it.
   * Whether THIS screen obeys it is the room's call, by role.
   */
  music: RoomMusic
}

interface NetSession {
  myIdx: number | null
  myStart: { x: number; y: number } | null
  lastStates: SnapshotEntry[] | null
  /** Connected visitors by hub idx; the scene adds them dynamically. */
  visitors: Map<number, VisitorDTO>
}

const emptySession = (): NetSession => ({
  myIdx: null,
  myStart: null,
  lastStates: null,
  visitors: new Map(),
})

/** The player index of the one visitor in a room with no hub. A visitor's
 * local index is otherwise its hub index, and the hub counts from 0 too. */
const LOCAL_PLAYER_IDX = 0

export function useGameRoomNet({ hub = false, me = null }: GameRoomNetOptions = {}): GameRoomNet {
  const handleRef = useRef<RoomSceneHandle | null>(null)
  const sessionRef = useRef<NetSession>(emptySession())

  const [onlineCount, setOnlineCount] = useState(0)
  // Bumped to throw the stream away and open a fresh one, whose hello resyncs
  // the whole room — see `on` below.
  const [streamEpoch, setStreamEpoch] = useState(0)
  const [myPlayerIdx, setMyPlayerIdx] = useState<number | null>(null)
  const [guests, setGuests] = useState<GameRoomGuest[]>([])
  const [connected, setConnected] = useState(false)
  const [backroomsUnlocked, setBackroomsUnlocked] = useState(false)
  const [dialog, setDialog] = useState<GameRoomDialog | null>(null)
  // Chat survives reconnects on purpose: the stream is this client's memory
  // of the room, and a server blip shouldn't blank it.
  const [chatLog, setChatLog] = useState<GameRoomChatLine[]>([])
  const [bulletin, setBulletin] = useState<BulletinEvent | null>(null)
  const [music, setMusic] = useState<RoomMusic>(null)
  const chatSeqRef = useRef(0)
  const dialogRef = useRef<GameRoomDialog | null>(null)
  const dialogSeqRef = useRef(0)
  const dialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const closeDialog = useCallback(() => {
    if (dialogTimerRef.current) clearTimeout(dialogTimerRef.current)
    dialogTimerRef.current = null
    dialogRef.current = null
    setDialog(null)
  }, [])

  /** Put a conversation in the dialog box for `ms`, then take it down. */
  const openDialog = useCallback((name: string, text: string, ms: number) => {
    const next: GameRoomDialog = { name, text, ms, seq: ++dialogSeqRef.current }
    dialogRef.current = next
    setDialog(next)
    if (dialogTimerRef.current) clearTimeout(dialogTimerRef.current)
    dialogTimerRef.current = setTimeout(() => {
      if (dialogRef.current?.seq === next.seq) closeDialog()
    }, ms)
  }, [closeDialog])

  // Visitor characters this hook has told the scene about (hub idx → the
  // local playerIdx it minted). A visitor's local index IS its hub index:
  // unique, stable across reconnects, and clear of the room's own index
  // ranges.
  const sceneGuestsRef = useRef(new Map<number, number>())
  const guestLocalIdx = useCallback((hubIdx: number) => hubIdx, [])

  /** Reconcile the scene's visitor cast with the session's connected
   * visitors, and publish who they are. */
  const syncGuests = useCallback(() => {
    const s = sessionRef.current
    setGuests([...s.visitors].map(([hubIdx, entry]) => ({ id: entry.id, playerIdx: guestLocalIdx(hubIdx) })))
    const handle = handleRef.current
    if (!handle) return
    for (const [hubIdx, playerIdx] of [...sceneGuestsRef.current]) {
      if (s.visitors.has(hubIdx)) continue
      handle.removeGuest(playerIdx)
      sceneGuestsRef.current.delete(hubIdx)
    }
    for (const [hubIdx, entry] of s.visitors) {
      if (sceneGuestsRef.current.has(hubIdx)) continue
      const playerIdx = guestLocalIdx(hubIdx)
      const state = s.lastStates?.find((e) => e[0] === hubIdx)
      const st = state ? unpackState(state) : null
      handle.upsertGuest({
        playerIdx,
        name: entry.name,
        role: entry.role,
        spriteId: entry.spriteId,
        spriteSheet: entry.spriteSheet,
        start: st ? { x: st.x, y: st.y } : undefined,
      })
      sceneGuestsRef.current.set(hubIdx, playerIdx)
    }
  }, [guestLocalIdx])

  const applyNetStates = useCallback(() => {
    const handle = handleRef.current
    const s = sessionRef.current
    if (!handle || !s.lastStates) return
    const states: RoomNetState[] = []
    for (const entry of s.lastStates) {
      const st = unpackState(entry)
      if (st.idx === s.myIdx) continue // own character is locally predicted
      const playerIdx = guestLocalIdx(st.idx)
      if (!sceneGuestsRef.current.has(st.idx)) continue
      states.push({ playerIdx, x: st.x, y: st.y, dir: st.dir, moving: st.moving, live: st.live })
    }
    handle.setNetStates(states)
  }, [guestLocalIdx])

  const applySession = useCallback(() => {
    const handle = handleRef.current
    const s = sessionRef.current
    if (!handle) return
    syncGuests()
    const localPlayerIdx = s.myIdx === null ? null : guestLocalIdx(s.myIdx)
    handle.setLocalPlayer(localPlayerIdx, s.myStart ?? undefined)
    applyNetStates()
  }, [applyNetStates, guestLocalIdx, syncGuests])

  // ------------------------------------------------------------- the stream

  useEffect(() => {
    if (!hub) return
    const es = new EventSource(apiUrl("/api/game-room/stream"))

    // Every frame is parsed here, once. The hub only ever sends JSON.stringify
    // output, so a frame that does not parse arrived cut short — Chrome on an
    // iPhone has handed a listener half a frame when the connection dropped,
    // and a bare JSON.parse threw out of it. Skipping the frame is not enough:
    // whatever it carried (a join, a chat line) is now missing, and nothing
    // re-sends it. So a broken frame ends this stream and opens a fresh one,
    // whose hello replays the room as the hub has it. Once per stream,
    // however many bad frames the dying connection had queued.
    let resyncing = false
    const on = <T,>(name: GameRoomEventName, handler: (data: T) => void) => {
      es.addEventListener(name, (e) => {
        if (resyncing) return
        let data: T
        try {
          data = JSON.parse((e as MessageEvent).data) as T
        } catch {
          resyncing = true
          es.close()
          setConnected(false)
          setStreamEpoch((n) => n + 1)
          return
        }
        handler(data)
      })
    }

    const countLive = (states: SnapshotEntry[]) =>
      states.reduce((n, e) => n + (unpackState(e).live ? 1 : 0), 0)

    on<HelloEvent>("hello", (hello) => {
      const s = emptySession()
      for (const entry of hello.visitors) s.visitors.set(entry.idx, entry)
      s.myIdx = hello.you
      s.lastStates = hello.states
      if (hello.you !== null) {
        const mine = hello.states.find((entry) => entry[0] === hello.you)
        if (mine) {
          const st = unpackState(mine)
          s.myStart = { x: st.x, y: st.y }
        }
      }
      sessionRef.current = s
      setMyPlayerIdx(s.myIdx === null ? null : guestLocalIdx(s.myIdx))
      syncGuests()
      setOnlineCount(countLive(hello.states))
      setBackroomsUnlocked(hello.backroomsUnlocked === true)
      setMusic(hello.music ?? null)
      setConnected(true)
      applySession()
    })

    on<{ unlocked: boolean }>("backrooms", (event) => {
      // Only the live push counts as an unlock; a reconnect restores it via hello.
      if (event.unlocked === true) track("easter_egg.backrooms_unlocked")
      setBackroomsUnlocked(event.unlocked === true)
    })

    on<{ states: SnapshotEntry[] }>("snapshot", ({ states }) => {
      const s = sessionRef.current
      s.lastStates = states
      setOnlineCount(countLive(states))
      applyNetStates()
    })

    on<SayEvent>("say", (say) => {
      const s = sessionRef.current
      const participant = s.myIdx !== null && say.by === s.myIdx
      if (!participant) return // only its reader sees a private conversation
      // My private conversation: freeze only my input and face the target.
      const partnerIdx = say.idx
      let faceDir: 0 | 1 | 2 | 3 | undefined
      const mine = s.lastStates?.find((entry) => entry[0] === s.myIdx)
      const partner = s.lastStates?.find((entry) => entry[0] === partnerIdx)
      if (mine && partner) {
        const me = unpackState(mine)
        const them = unpackState(partner)
        faceDir = facingForInput(them.x - me.x, them.y - me.y, me.dir)
      }
      handleRef.current?.freezeLocalInput(say.ms, faceDir)
      openDialog(say.name, say.text, say.ms)
    })

    // A bulletin is a moment: nothing replays it, and the room's banner is
    // raised by the arrival rather than by the content.
    on<BulletinEvent>("bulletin", (data) => {
      setBulletin(data)
    })

    // The PA screens' music: whole state, every frame.
    on<MusicEvent>("music", (data) => {
      setMusic(data)
    })

    on<ChatEvent>("chat", (chat) => {
      const s = sessionRef.current
      // The bubble every passer-by sees — reused from interact speech, own
      // character included (the hub echoes the sender's message back).
      if (sceneGuestsRef.current.has(chat.idx)) handleRef.current?.showSpeech(guestLocalIdx(chat.idx), chat.text)
      const line: GameRoomChatLine = {
        seq: ++chatSeqRef.current,
        name: chat.name,
        text: chat.text,
        self: s.myIdx !== null && chat.idx === s.myIdx,
      }
      setChatLog((log) => [...log.slice(-(CHAT_LOG_MAX - 1)), line])
    })

    // Someone arrived or left: the cast changes.
    on<JoinEvent>("join", (entry) => {
      sessionRef.current.visitors.set(entry.idx, entry)
      syncGuests()
    })

    on<LeaveEvent>("leave", (leave) => {
      sessionRef.current.visitors.delete(leave.idx)
      syncGuests()
    })

    // The reader dismissed their finished private dialog.
    on<DialogEndEvent>("dialogEnd", (end) => {
      const s = sessionRef.current
      if (s.myIdx === null || end.a !== s.myIdx) return
      closeDialog()
      handleRef.current?.freezeLocalInput(0)
    })

    es.onerror = () => setConnected(false)

    return () => {
      es.close()
      sessionRef.current = emptySession()
      sceneGuestsRef.current.clear()
      setGuests([])
      setConnected(false)
      closeDialog()
    }
  }, [hub, applyNetStates, applySession, closeDialog, guestLocalIdx, openDialog, syncGuests, streamEpoch])

  // --------------------------------------------------------- without a hub

  // The one visitor's character, seated by this hook the way the hub would
  // have: a join at the spawn point, and a leave when they change or go.
  const localVisitor = hub ? null : me
  const localKey = localVisitor
    ? [localVisitor.id, localVisitor.name, localVisitor.role ?? "visitor", localVisitor.spriteId ?? "", localVisitor.spriteSheet ?? ""].join("\u0000")
    : null
  const localVisitorRef = useRef(localVisitor)
  localVisitorRef.current = localVisitor
  /** Each plant's script progress for this visitor, kept for the visit. */
  const localSayCountRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (localKey === null) return
    const visitor = localVisitorRef.current!
    const s = emptySession()
    const spawn = visitorSpawnPoint(LOCAL_PLAYER_IDX)
    s.myIdx = LOCAL_PLAYER_IDX
    s.myStart = spawn
    s.visitors.set(LOCAL_PLAYER_IDX, {
      idx: LOCAL_PLAYER_IDX,
      id: visitor.id,
      name: visitor.name,
      role: visitor.role ?? "visitor",
      spriteId: visitor.spriteId ?? null,
      spriteSheet: visitor.spriteSheet ?? null,
    })
    s.lastStates = [packState({ idx: LOCAL_PLAYER_IDX, x: spawn.x, y: spawn.y, dir: 2, moving: false, live: true })]
    sessionRef.current = s
    setMyPlayerIdx(LOCAL_PLAYER_IDX)
    setOnlineCount(1)
    applySession()
    return () => {
      sessionRef.current = emptySession()
      setMyPlayerIdx(null)
      setOnlineCount(0)
      syncGuests()
      handleRef.current?.setLocalPlayer(null)
      closeDialog()
    }
  }, [localKey, applySession, closeDialog, syncGuests])

  const onSceneReady = useCallback(
    (handle: RoomSceneHandle | null) => {
      handleRef.current = handle
      if (handle) applySession()
    },
    [applySession],
  )

  const onSelfState = useCallback((state: RoomSelfState) => {
    if (!hub) return
    void fetch(apiUrl("/api/game-room/input"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {
      /* transient — the next report retries */
    })
  }, [hub])

  /** A room with no hub answers the plants itself, from the hub's script. */
  const interactLocally = useCallback((targetIdx: number) => {
    if (dialogRef.current) return
    const obj = roomObjectByIdx(targetIdx)
    if (!obj) return
    const counts = localSayCountRef.current
    const count = (counts.get(obj.id) ?? 0) + 1
    counts.set(obj.id, count)
    const text = objectSpeech(obj.id, count)
    const ms = dialogDurationMs(text)
    handleRef.current?.freezeLocalInput(ms)
    openDialog(obj.name, text, ms)
    if (obj.id === "plant-se" && count === BACKROOMS_UNLOCK_COUNT) {
      track("easter_egg.backrooms_unlocked")
      setBackroomsUnlocked(true)
    }
  }, [openDialog])

  const onInteract = useCallback((targetPlayerIdx: number) => {
    // Objects address themselves: their idx range is global, not per-session.
    const isObject = targetPlayerIdx >= OBJECT_IDX_BASE
    if (!hub) {
      if (isObject && sessionRef.current.myIdx !== null) interactLocally(targetPlayerIdx)
      return
    }
    // A visitor's local index is its hub index, so the target needs no
    // translation — only a check that it is someone the hub told us about.
    if (!isObject && !sessionRef.current.visitors.has(targetPlayerIdx)) return
    void fetch(apiUrl("/api/game-room/interact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIdx: targetPlayerIdx }),
    }).catch(() => {
      /* nothing to retry — the press just misses */
    })
  }, [hub, interactLocally])

  const sendChat = useCallback((text: string) => {
    if (!hub) return // chat is between people, and people need the hub
    track("game_room.chat_sent")
    void fetch(apiUrl("/api/game-room/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {
      /* nothing to retry — the line just doesn't land */
    })
  }, [hub])

  const dismissDialog = useCallback(() => {
    if (!dialogRef.current) return
    // Optimistic: close and unfreeze immediately (the hub's dismiss gate is
    // aligned with the typewriter, so an honest press is never early), then
    // tell the hub so it unfreezes the character too.
    closeDialog()
    handleRef.current?.freezeLocalInput(0)
    if (!hub) return
    void fetch(apiUrl("/api/game-room/dismiss"), { method: "POST" }).catch(() => {
      /* worst case the freeze runs out on its own */
    })
  }, [closeDialog, hub])

  return { onSceneReady, onSelfState, onInteract, onlineCount, myPlayerIdx, guests, connected, dialog, dismissDialog, chatLog, sendChat, bulletin, music, backroomsUnlocked }
}
