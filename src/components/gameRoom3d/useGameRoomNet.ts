// Client side of the multiplayer game room. Opens the SSE stream, translates
// the hub's session idx space into this page's playerIdx space (matched on
// users.id via the hello roster), and drives the scene handle imperatively —
// positions never flow through React props, so the WebGL scene is never
// rebuilt by a snapshot.
//
// Degrades cleanly: while the stream is down (server restart, network) the
// scene simply keeps its local wander, and EventSource's own reconnect brings
// back a fresh hello that re-syncs everything. A frame that arrives cut short
// does the same on purpose (see `on`).

import { useCallback, useEffect, useRef, useState } from "react"
import type { FlatPlayer } from "~/lib/event-types"
import { track } from "~/lib/analytics"
import { facingForInput } from "~/lib/gameRoomNet/collision"
import { OBJECT_IDX_BASE } from "~/lib/gameRoomNet/objects"
import type { ScreenPage } from "./screen-pages"
import type { PresentationState } from "~/lib/presentation-order"
import type { WinnersState } from "~/lib/winners-ceremony"
import {
  unpackState,
  unpackWander,
  type WanderEntry,
  type WanderEvent,
  type BulletinEvent,
  type ChatEvent,
  type DialogEndEvent,
  type GameRoomEventName,
  type HelloEvent,
  type JoinEvent,
  type LeaveEvent,
  type MusicEvent,
  type PresentationEvent,
  type RosterEntryDTO,
  type WinnersEvent,
  type SayEvent,
  type SnapshotEntry,
} from "~/lib/gameRoomNet/protocol"
import type { RoomNetState, RoomSceneHandle, RoomSelfState, RoomWanderState } from "./scene"
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

export interface GameRoomGuest {
  /** users.id */
  id: string
  playerIdx: number
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
  /** The connected visitors — characters off this page's roster — each at
   * the player index minted for them, so the room can seat their pets. */
  guests: GameRoomGuest[]
  /** The stream is up and hello has landed. */
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
   * The page the gamemaster has pinned the wall screen to, or null while the
   * players still turn it themselves.
   */
  forcedScreenPage: ScreenPage | null
  /**
   * The last bulletin the gamemaster pushed straight at the room, or null if
   * there has not been one this connection. Carries a nonce, because two
   * identical sends — a rehearsal and then the real thing — are otherwise
   * indistinguishable and the second must still raise the banner.
   */
  bulletin: BulletinEvent | null
  /**
   * The presentation running order the gamemaster has drawn, with the team
   * under the spotlight, or null until there is one. State like the pinned
   * page: hello carries it, so a reconnect lands on the finished board.
   */
  presentation: PresentationState | null
  /**
   * The winners' ceremony the gamemaster is running, with the places read so
   * far, or null. State like the running order: hello carries it, so a
   * reconnect lands on the podium as it stands.
   */
  winners: WinnersState | null
  /**
   * What the gamemaster has put on the PA screens' music — a looping track,
   * silence, or null for the room's own playlist. State like the pinned page:
   * hello carries it. Whether THIS screen obeys it is the room's call, by role.
   */
  music: RoomMusic
}

interface NetSession {
  idxToPlayerIdx: Map<number, number>
  playerIdxToIdx: Map<number, number>
  myIdx: number | null
  myStart: { x: number; y: number } | null
  lastStates: SnapshotEntry[] | null
  /** The wander state last handed over for each idle character (hub idx →
   * entry), kept so a scene that mounts after the frame can still be given
   * it. An entry is dropped the moment a snapshot streams the character. */
  lastWanders: Map<number, WanderEntry>
  /** Connected visitors (hub idx → roster entry) — characters this page's own
   * roster has never heard of; the scene adds them dynamically. */
  guests: Map<number, RosterEntryDTO>
}

const emptySession = (): NetSession => ({
  idxToPlayerIdx: new Map(),
  playerIdxToIdx: new Map(),
  myIdx: null,
  myStart: null,
  lastStates: null,
  lastWanders: new Map(),
  guests: new Map(),
})

export function useGameRoomNet(allPlayers: FlatPlayer[]): GameRoomNet {
  const handleRef = useRef<RoomSceneHandle | null>(null)
  const sessionRef = useRef<NetSession>(emptySession())
  const allPlayersRef = useRef(allPlayers)
  allPlayersRef.current = allPlayers

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
  const [forcedScreenPage, setForcedScreenPage] = useState<ScreenPage | null>(null)
  const [bulletin, setBulletin] = useState<BulletinEvent | null>(null)
  const [presentation, setPresentation] = useState<PresentationState | null>(null)
  const [winners, setWinners] = useState<WinnersState | null>(null)
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

  // Guest characters this hook has told the scene about (hub idx → the local
  // playerIdx it minted). Local guest indices sit above the page roster —
  // base + hubIdx — so they are unique AND stable across reconnects.
  const sceneGuestsRef = useRef(new Map<number, number>())
  const guestLocalIdx = useCallback(
    (hubIdx: number) => allPlayersRef.current.length + hubIdx,
    [],
  )

  /** Reconcile the scene's guest cast with the session's connected guests,
   * and publish who they are. */
  const syncGuests = useCallback(() => {
    const s = sessionRef.current
    setGuests([...s.guests].map(([hubIdx, entry]) => ({ id: entry.id, playerIdx: guestLocalIdx(hubIdx) })))
    const handle = handleRef.current
    if (!handle) return
    for (const [hubIdx, playerIdx] of [...sceneGuestsRef.current]) {
      if (s.guests.has(hubIdx)) continue
      handle.removeGuest(playerIdx)
      sceneGuestsRef.current.delete(hubIdx)
    }
    for (const [hubIdx, entry] of s.guests) {
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
      const playerIdx = s.idxToPlayerIdx.get(st.idx)
      if (playerIdx === undefined) continue
      states.push({ playerIdx, x: st.x, y: st.y, dir: st.dir, moving: st.moving, live: st.live })
    }
    handle.setNetStates(states)
  }, [])

  /** Hand the scene the wander state for these idle characters, or for every
   * one the session knows of. Own character excluded: it is never idle while
   * this client is connected, and a stale entry must not seize control. */
  const applyWanders = useCallback((entries?: Iterable<WanderEntry>) => {
    const handle = handleRef.current
    const s = sessionRef.current
    if (!handle) return
    const states: RoomWanderState[] = []
    for (const entry of entries ?? s.lastWanders.values()) {
      const w = unpackWander(entry)
      if (w.idx === s.myIdx) continue
      const playerIdx = s.idxToPlayerIdx.get(w.idx)
      if (playerIdx === undefined) continue
      states.push({ playerIdx, phase: w.phase, speed: w.speed, pauseLeft: w.pauseLeft, rng: w.rng })
    }
    if (states.length > 0) handle.setWanderStates(states)
  }, [])

  const applySession = useCallback(() => {
    const handle = handleRef.current
    const s = sessionRef.current
    if (!handle) return
    syncGuests()
    const localPlayerIdx = s.myIdx === null ? null : s.idxToPlayerIdx.get(s.myIdx) ?? null
    handle.setLocalPlayer(localPlayerIdx, s.myStart ?? undefined)
    // Wanderers first, then the streamed: a character the hub has taken back
    // since its last wander entry ends up net-driven, never the reverse.
    applyWanders()
    applyNetStates()
  }, [applyNetStates, applyWanders, syncGuests])

  useEffect(() => {
    const es = new EventSource(apiUrl("/api/game-room/stream"))

    // Every frame is parsed here, once. The hub only ever sends JSON.stringify
    // output, so a frame that does not parse arrived cut short — Chrome on an
    // iPhone handed a listener half a `wander` frame when the connection
    // dropped (CODE2IMPACT2026-18), and the bare JSON.parse threw out of it.
    // Skipping the frame is not enough: whatever it carried (a character going
    // idle, a join, a chat line) is now missing, and nothing re-sends it. So a
    // broken frame ends this stream and opens a fresh one, whose hello replays
    // the room as the hub has it. Once per stream, however many bad frames the
    // dying connection had queued.
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
      const byId = new Map(allPlayersRef.current.map((p, playerIdx) => [p.id, playerIdx]))
      const s = emptySession()
      for (const entry of hello.roster) {
        if (entry.guest) {
          const playerIdx = guestLocalIdx(entry.idx)
          s.guests.set(entry.idx, entry)
          s.idxToPlayerIdx.set(entry.idx, playerIdx)
          s.playerIdxToIdx.set(playerIdx, entry.idx)
          continue
        }
        const playerIdx = byId.get(entry.id)
        if (playerIdx === undefined) continue // hub knows them, this page's roster doesn't
        s.idxToPlayerIdx.set(entry.idx, playerIdx)
        s.playerIdxToIdx.set(playerIdx, entry.idx)
      }
      s.myIdx = hello.you
      s.lastStates = hello.states
      for (const entry of hello.wanders ?? []) s.lastWanders.set(entry[0], entry)
      if (hello.you !== null) {
        const mine = hello.states.find((entry) => entry[0] === hello.you)
        if (mine) {
          const st = unpackState(mine)
          s.myStart = { x: st.x, y: st.y }
        }
      }
      sessionRef.current = s
      setMyPlayerIdx(s.myIdx === null ? null : s.idxToPlayerIdx.get(s.myIdx) ?? null)
      syncGuests()
      setOnlineCount(countLive(hello.states))
      setForcedScreenPage(hello.screen ?? null)
      setBackroomsUnlocked(hello.backroomsUnlocked === true)
      setPresentation(hello.presentation ?? null)
      setWinners(hello.winners ?? null)
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
      for (const entry of states) s.lastWanders.delete(entry[0])
      setOnlineCount(countLive(states))
      applyNetStates()
    })

    // Characters that have gone idle, with the state to walk them from. The
    // hub sends this BEFORE the snapshot that stops carrying them, so the
    // scene never sits on a stale streamed position.
    on<WanderEvent>("wander", ({ wanders }) => {
      const s = sessionRef.current
      for (const entry of wanders) s.lastWanders.set(entry[0], entry)
      applyWanders(wanders)
    })

    on<SayEvent>("say", (say) => {
      const s = sessionRef.current
      const participant = s.myIdx !== null && say.by === s.myIdx
      if (participant) {
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
        const next: GameRoomDialog = {
          name: say.name,
          text: say.text,
          ms: say.ms,
          seq: ++dialogSeqRef.current,
        }
        dialogRef.current = next
        setDialog(next)
        if (dialogTimerRef.current) clearTimeout(dialogTimerRef.current)
        dialogTimerRef.current = setTimeout(() => {
          if (dialogRef.current?.seq === next.seq) closeDialog()
        }, say.ms)
        return
      }
      // Ignore older servers' broadcast conversations; only their reader sees them.
    })

    // The wall screen the gamemaster has taken. Set from hello too: a forced
    // page is state, and a reconnect replays hello rather than the screen
    // frame that came before it.
    on<{ page: ScreenPage | null }>("screen", ({ page }) => {
      setForcedScreenPage(page)
    })

    // A bulletin, on the other hand, is a moment: nothing replays it, and the
    // room's banner is raised by the arrival rather than by the content.
    on<BulletinEvent>("bulletin", (data) => {
      setBulletin(data)
    })

    // The running order is state too — the whole of it each time, so a
    // spotlight never arrives without the order it points into.
    on<PresentationEvent>("presentation", (data) => {
      setPresentation(data)
    })

    // And the ceremony: whole state, every frame, like the order.
    on<WinnersEvent>("winners", (data) => {
      setWinners(data)
    })

    // And the PA screens' music: whole state, like the page.
    on<MusicEvent>("music", (data) => {
      setMusic(data)
    })

    on<ChatEvent>("chat", (chat) => {
      const s = sessionRef.current
      // The bubble every passer-by sees — reused from interact speech, own
      // character included (the hub echoes the sender's message back).
      const playerIdx = s.idxToPlayerIdx.get(chat.idx)
      if (playerIdx !== undefined) handleRef.current?.showSpeech(playerIdx, chat.text)
      const line: GameRoomChatLine = {
        seq: ++chatSeqRef.current,
        name: chat.name,
        text: chat.text,
        self: s.myIdx !== null && chat.idx === s.myIdx,
      }
      setChatLog((log) => [...log.slice(-(CHAT_LOG_MAX - 1)), line])
    })

    // For roster members, join/leave are just live-flag flips the next
    // snapshot repeats — nothing to do. Guests are actual cast changes.
    on<JoinEvent>("join", (entry) => {
      if (!entry.guest) return
      const s = sessionRef.current
      const playerIdx = guestLocalIdx(entry.idx)
      s.guests.set(entry.idx, entry)
      s.idxToPlayerIdx.set(entry.idx, playerIdx)
      s.playerIdxToIdx.set(playerIdx, entry.idx)
      syncGuests()
    })

    on<LeaveEvent>("leave", (leave) => {
      if (!leave.guest) return
      const s = sessionRef.current
      const playerIdx = s.idxToPlayerIdx.get(leave.idx)
      s.guests.delete(leave.idx)
      if (playerIdx !== undefined) {
        s.idxToPlayerIdx.delete(leave.idx)
        s.playerIdxToIdx.delete(playerIdx)
      }
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
      closeDialog()
    }
  }, [applyNetStates, applySession, applyWanders, closeDialog, guestLocalIdx, syncGuests, streamEpoch])

  const onSceneReady = useCallback(
    (handle: RoomSceneHandle | null) => {
      handleRef.current = handle
      if (handle) applySession()
    },
    [applySession],
  )

  const onSelfState = useCallback((state: RoomSelfState) => {
    void fetch(apiUrl("/api/game-room/input"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {
      /* transient — the next report retries */
    })
  }, [])

  const onInteract = useCallback((targetPlayerIdx: number) => {
    // Objects address themselves: their idx range is global, not per-session.
    const targetIdx =
      targetPlayerIdx >= OBJECT_IDX_BASE
        ? targetPlayerIdx
        : sessionRef.current.playerIdxToIdx.get(targetPlayerIdx)
    if (targetIdx === undefined) return
    void fetch(apiUrl("/api/game-room/interact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIdx }),
    }).catch(() => {
      /* nothing to retry — the press just misses */
    })
  }, [])

  const sendChat = useCallback((text: string) => {
    track("game_room.chat_sent")
    void fetch(apiUrl("/api/game-room/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {
      /* nothing to retry — the line just doesn't land */
    })
  }, [])

  const dismissDialog = useCallback(() => {
    if (!dialogRef.current) return
    // Optimistic: close and unfreeze immediately (the hub's dismiss gate is
    // aligned with the typewriter, so an honest press is never early), then
    // tell the hub so the partner unfreezes too.
    closeDialog()
    handleRef.current?.freezeLocalInput(0)
    void fetch(apiUrl("/api/game-room/dismiss"), { method: "POST" }).catch(() => {
      /* worst case the freeze runs out on its own */
    })
  }, [closeDialog])

  return { onSceneReady, onSelfState, onInteract, onlineCount, myPlayerIdx, guests, connected, dialog, dismissDialog, chatLog, sendChat, forcedScreenPage, bulletin, presentation, winners, music, backroomsUnlocked }
}
