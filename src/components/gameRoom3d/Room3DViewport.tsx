import { logger } from "~/lib/logger"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { CW, CH } from "../gameRoom/constants"
import type { RoomSelection } from "../gameRoom/InfoPanel"
import type { RoomDrop } from "./assignment-drag"
import {
  nextRoomCameraPan,
  type RoomCameraPan,
  type RoomCameraPanAction,
} from "./camera-pan"
import type { RoomPlayerInput, RoomSceneHandle, RoomSelfState } from "./scene"
import type { ScreenPage } from "./screen-pages"
import type { RoomPresentation } from "~/lib/presentation-order"
import type { RoomWinners } from "~/lib/winners-ceremony"
import type { ScreenCountdown, SessionClockSnapshot } from "./session-screen"
import type { MarketNews } from "./useMarketNews"
import { RoomTouchControls, useCoarsePointer, type TouchPadPress } from "./TouchControls"

export interface Room3DViewportProps {
  players: RoomPlayerInput[]
  teamLabels: string[]
  /** Whether each desk belongs to a competing team, aligned with teamLabels. */
  teamCompeting?: readonly boolean[]
  /** Each team's placing on the live leaderboard, aligned with teamLabels;
   *  null where a team has none yet. Drives the floating numeral over its
   *  desk, and is deliberately NOT part of the scene identity: standings move
   *  every few seconds and must never rebuild the room. */
  teamRanks?: readonly (number | null)[]
  interactionMode?: "select" | "assign"
  selectedTeamIdx?: number | null
  selectedPlayerIdx?: number | null
  busyPlayerIdxs?: readonly number[]
  arrivalAnimation?: RoomArrivalAnimation | null
  cameraControls?: boolean
  /** WASD/arrows are being spent on walking the local character — keep the
   * zoom keys and drag-pan, but stand the keyboard pan down. */
  suppressPanKeys?: boolean
  /** Temporarily release and suppress local movement/interact input while the
   * scene and its network connection remain mounted. */
  localInputDisabled?: boolean
  backroomsUnlocked?: boolean
  /** The Konami-code arcade cabinet is standing beside Primey (this client only). */
  arcadeVisible?: boolean
  /** Play the cabinet's drop-in entrance when it first appears (false when it
   * was unlocked on an earlier visit). */
  arcadeEntrance?: boolean
  /** Primey stands in the room (hidden in a student's room before the doors). */
  primeyVisible?: boolean
  /** Bumped once per finger snap heard: each change dusts half the room. */
  thanosSnapSeq?: number
  renderPaused?: boolean
  onBackroomsEnter?: () => void
  /** Interact fired while facing the cabinet, or a click on it — opens the
   * fighter over the room, local only. */
  onArcadeInteract?: () => void
  /** The cabinet hit the floor in its entrance — a cue for the thud. */
  onArcadeLanded?: () => void
  /** A discrete press on the touch pad (D-pad direction or A), for the
   * Konami-code listener. */
  onTouchPadPress?: (press: TouchPadPress) => void
  /**
   * Offer the on-screen game-pad (D-pad lower left, interact lower right) on
   * touch-first devices. Only rendered when the pointer is actually coarse.
   * While suppressPanKeys is on the pad walks the local character; otherwise
   * it pans the spectator camera.
   */
  touchControls?: boolean
  keyboardTargetRef?: RefObject<HTMLElement | null>
  /** What the room's big screen shows: the running trading window's clock, or
   * null for the countdown to launch day. */
  sessionClock?: SessionClockSnapshot | null
  /** What the clock page counts to with no window running: the doors before
   * they open, or null for launch day. */
  countdown?: ScreenCountdown | null
  /** A public market bulletin temporarily taking over the wall screen. */
  marketNews?: MarketNews | null
  /**
   * A page the gamemaster has pinned the wall screen to for the whole room, or
   * null while the players turn it themselves with interact.
   */
  forcedScreenPage?: ScreenPage | null
  /** The presentation running order, by desk, or null — see GameRoom3D. */
  presentation?: RoomPresentation | null
  /** The winners' ceremony, by desk, or null — see GameRoom3D. */
  winners?: RoomWinners | null
  /** Fixed room-PA settings for a filmed broadcast playing on that screen. */
  newsAudio?: { muted: boolean; volume: number }
  /**
   * Fill the parent instead of keeping the room's own aspect box. The parent
   * owns the size (and any chrome); the canvas tracks it via ResizeObserver.
   */
  fill?: boolean
  onPick?: (pick: RoomSelection) => void
  onPlayerHover?: (playerIdx: number | null) => void
  onDrop?: (drop: RoomDrop) => void
  /** The scene handle, for imperative drivers (the multiplayer net hook) —
   * called with the handle once the scene is live, and null when it goes away. */
  onSceneReady?: (handle: RoomSceneHandle | null) => void
  onSelfState?: (state: RoomSelfState) => void
  onInteract?: (targetPlayerIdx: number) => void
  onTableInteract?: (tableIdx: number) => void
  /** Interact fired while facing Primey — opens the chat panel, local only. */
  onPrimeyInteract?: () => void
  onMenuToggle?: () => void
}

export interface RoomArrivalAnimation {
  playerIdx: number
  sequence: number
}

const ROOM_CAMERA_FIT_ZOOM = 1
const ROOM_CAMERA_MAX_ZOOM = 2.4
const ROOM_CAMERA_ZOOM_STEP = 0.2
const ROOM_CAMERA_DEFAULT_ZOOM = 1.4

export type RoomCameraZoomAction = "in" | "out" | "fit"
// The pan model is shared with the scene, which drives the same camera from a
// mouse drag. Re-exported so the viewport stays the one import for camera
// controls.
export { nextRoomCameraPan }
export type { RoomCameraPan, RoomCameraPanAction }

export function roomCameraWheelAction(deltaY: number): "in" | "out" | null {
  if (deltaY === 0) return null
  return deltaY < 0 ? "in" : "out"
}

export function nextRoomCameraZoom(
  current: number,
  action: RoomCameraZoomAction,
): number {
  if (action === "fit") return ROOM_CAMERA_FIT_ZOOM
  const direction = action === "in" ? 1 : -1
  return Math.min(
    ROOM_CAMERA_MAX_ZOOM,
    Math.max(ROOM_CAMERA_FIT_ZOOM, Number((current + direction * ROOM_CAMERA_ZOOM_STEP).toFixed(1))),
  )
}

export function RoomCameraLegend({ walkMode = false, onMenuToggle }: { walkMode?: boolean; onMenuToggle?: () => void } = {}) {
  return (
    <div
      aria-label="3D camera shortcuts"
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        padding: "7px 9px",
        background: "rgba(2, 5, 16, 0.9)",
        border: "2px solid #5070E0",
        boxShadow: "4px 4px 0 #000",
        color: "#9AA4D4",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        pointerEvents: "none",
      }}
    >
      {onMenuToggle && (
        <button
          type="button"
          aria-label="Open game room menu"
          onClick={onMenuToggle}
          style={{
            pointerEvents: "auto",
            border: 0,
            padding: 0,
            background: "transparent",
            color: "#FFF",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          <b>TAB</b> MENU
        </button>
      )}
      {walkMode ? (
        <>
          <span><b style={{ color: "#FFF" }}>WASD</b> WALK</span>
          <span><b style={{ color: "#FFF" }}>SPACE</b> TALK</span>
          <span><b style={{ color: "#FFF" }}>DRAG</b> PAN</span>
        </>
      ) : (
        <span><b style={{ color: "#FFF" }}>DRAG / WASD</b> PAN</span>
      )}
      <span><b style={{ color: "#FFF" }}>SCROLL / +−</b> ZOOM</span>
      <span><b style={{ color: "#FFF" }}>F / 0</b> FIT</span>
    </div>
  )
}

export function shouldAnimateRoomTeamChange(
  previousTeamIdx: number | null | undefined,
  nextTeamIdx: number | null,
  busy: boolean,
): boolean {
  return !busy && previousTeamIdx === null && nextTeamIdx !== null
}

export function replayRoomArrival(
  handle: RoomSceneHandle,
  players: readonly RoomPlayerInput[],
  animation: RoomArrivalAnimation,
): boolean {
  const player = players.find((candidate) => candidate.playerIdx === animation.playerIdx)
  if (!player || player.teamIdx === null) return false
  handle.setPlayerTeam(animation.playerIdx, null, false)
  handle.setPlayerTeam(animation.playerIdx, player.teamIdx, true)
  return true
}

export function consumeRoomArrival(
  handle: RoomSceneHandle,
  players: readonly RoomPlayerInput[],
  animation: RoomArrivalAnimation,
  consumedSequence: number | null,
): number | null {
  if (animation.sequence === consumedSequence) return consumedSequence
  return replayRoomArrival(handle, players, animation)
    ? animation.sequence
    : consumedSequence
}

/**
 * A generated sheet is a base64 PNG data URL — tens of kilobytes per player —
 * and the identity key is serialized on every render, so the key carries a
 * digest rather than the sheet itself. Length plus the tail is enough: two
 * different PNGs of the same byte length ending in the same 24 characters is
 * not a case the room has to survive, and a re-encode of the SAME sheet must
 * not read as a change (which is why this is not a counter).
 */
function sheetDigest(sheet: string | null | undefined): string | null {
  return sheet ? `${sheet.length}:${sheet.slice(-24)}` : null
}

export function room3DSceneIdentityKey(input: {
  players: readonly RoomPlayerInput[]
  teamLabels: readonly string[]
  teamCompeting?: readonly boolean[]
  interactionMode: "select" | "assign"
}): string {
  return JSON.stringify({
    interactionMode: input.interactionMode,
    teamLabels: input.teamLabels,
    teamCompeting: input.teamCompeting,
    // The sprite fields belong here even though team assignments deliberately
    // do NOT: a team change is applied to a live scene through the handle,
    // whereas a character is baked into its mesh when the scene is built and
    // there is no handle to swap it. Omitting them left a room mounted before
    // the change showing the old character until the process was restarted.
    players: input.players.map(({ playerIdx, name, seatIdx, draggable, spriteId, spriteSheet }) => ({
      playerIdx,
      name,
      seatIdx,
      draggable,
      spriteId: spriteId ?? null,
      spriteSheet: sheetDigest(spriteSheet),
    })),
  })
}

export function Room3DViewport({
  players,
  teamLabels,
  teamCompeting,
  teamRanks,
  interactionMode = "select",
  selectedTeamIdx = null,
  selectedPlayerIdx = null,
  busyPlayerIdxs = [],
  arrivalAnimation = null,
  cameraControls = false,
  suppressPanKeys = false,
  localInputDisabled = false,
  backroomsUnlocked = false,
  arcadeVisible = false,
  arcadeEntrance = true,
  primeyVisible = true,
  thanosSnapSeq = 0,
  renderPaused = false,
  onBackroomsEnter,
  onArcadeInteract,
  onArcadeLanded,
  onTouchPadPress,
  touchControls = false,
  keyboardTargetRef,
  sessionClock = null,
  countdown = null,
  marketNews = null,
  forcedScreenPage = null,
  presentation = null,
  winners = null,
  newsAudio,
  fill = false,
  onPick,
  onPlayerHover,
  onDrop,
  onSceneReady,
  onSelfState,
  onInteract,
  onTableInteract,
  onPrimeyInteract,
  onMenuToggle,
}: Room3DViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RoomSceneHandle | null>(null)
  const sceneTeamsRef = useRef(new Map<number, number | null>())
  const playersRef = useRef(players)
  const busyPlayerIdxsRef = useRef(busyPlayerIdxs)
  const onPickRef = useRef(onPick)
  const onPlayerHoverRef = useRef(onPlayerHover)
  const onDropRef = useRef(onDrop)
  const onSceneReadyRef = useRef(onSceneReady)
  const onSelfStateRef = useRef(onSelfState)
  const onInteractRef = useRef(onInteract)
  const onTableInteractRef = useRef(onTableInteract)
  const onPrimeyInteractRef = useRef(onPrimeyInteract)
  const onBackroomsEnterRef = useRef(onBackroomsEnter)
  const onArcadeInteractRef = useRef(onArcadeInteract)
  const onArcadeLandedRef = useRef(onArcadeLanded)
  const consumedArrivalSequenceRef = useRef<number | null>(null)
  const teamRanksRef = useRef(teamRanks)
  const [cameraZoom, setCameraZoom] = useState(
    cameraControls ? ROOM_CAMERA_DEFAULT_ZOOM : ROOM_CAMERA_FIT_ZOOM,
  )
  const [cameraPan, setCameraPan] = useState<RoomCameraPan>({ x: 0, z: 0 })
  const cameraZoomRef = useRef(cameraZoom)
  const cameraPanRef = useRef(cameraPan)
  const localInputDisabledRef = useRef(localInputDisabled)
  const lastWheelZoomAtRef = useRef(Number.NEGATIVE_INFINITY)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const coarsePointer = useCoarsePointer()
  const showTouchControls = touchControls && coarsePointer

  playersRef.current = players
  busyPlayerIdxsRef.current = busyPlayerIdxs
  onPickRef.current = onPick
  onPlayerHoverRef.current = onPlayerHover
  onDropRef.current = onDrop
  onSceneReadyRef.current = onSceneReady
  onSelfStateRef.current = onSelfState
  onInteractRef.current = onInteract
  onTableInteractRef.current = onTableInteract
  onPrimeyInteractRef.current = onPrimeyInteract
  onBackroomsEnterRef.current = onBackroomsEnter
  onArcadeInteractRef.current = onArcadeInteract
  onArcadeLandedRef.current = onArcadeLanded
  cameraZoomRef.current = cameraZoom
  cameraPanRef.current = cameraPan
  localInputDisabledRef.current = localInputDisabled
  teamRanksRef.current = teamRanks

  // Team and busy changes flow through the scene handle. Recreate only when
  // the cast, immutable team presentation (labels and category), or mode changes.
  const sceneIdentityKey = useMemo(() => room3DSceneIdentityKey({
    interactionMode,
    teamLabels,
    teamCompeting,
    players,
  }), [interactionMode, players, teamCompeting, teamLabels])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let handle: RoomSceneHandle | null = null
    const initialPlayers = playersRef.current
    setReady(false)
    setLoadError(null)

    import("./scene")
      .then(({ createRoomScene }) => createRoomScene(container, {
        players: initialPlayers,
        teamLabels,
        teamCompeting,
        // Whatever the standings are by the time the scene finishes loading,
        // not whatever they were when the effect started.
        teamRanks: teamRanksRef.current,
        interactionMode,
        onPick: (pick) => onPickRef.current?.(pick),
        onPlayerHover: (playerIdx) => onPlayerHoverRef.current?.(playerIdx),
        onDrop: (drop) => onDropRef.current?.(drop),
        onSelfState: (state) => onSelfStateRef.current?.(state),
        onInteract: (targetPlayerIdx) => onInteractRef.current?.(targetPlayerIdx),
        onTableInteract: (tableIdx) => onTableInteractRef.current?.(tableIdx),
        onPrimeyInteract: () => onPrimeyInteractRef.current?.(),
        onBackroomsEnter: () => onBackroomsEnterRef.current?.(),
         onArcadeInteract: () => onArcadeInteractRef.current?.(),
         onArcadeLanded: () => onArcadeLandedRef.current?.(),
        // The scene has already moved the camera by the time these arrive —
        // they keep the keyboard's and buttons' idea of the view in step, so
        // the next key or +/− press carries on where the gesture left off.
        onCameraPan: (pan) => setCameraPan(pan),
        onCameraZoom: (zoom) => setCameraZoom(zoom),
      }))
      .then((created) => {
        if (cancelled) {
          created.dispose()
          return
        }
        handle = created
        handleRef.current = created
        sceneTeamsRef.current = new Map(initialPlayers.map((player) => [player.playerIdx, player.teamIdx]))

        const latestPlayers = playersRef.current
        const busy = new Set(busyPlayerIdxsRef.current)
        for (const player of latestPlayers) {
          created.setPlayerLobbyOrdinal?.(player.playerIdx, player.lobbyOrdinal ?? null)
          const previousTeam = sceneTeamsRef.current.get(player.playerIdx)
          created.setPlayerTeam(
            player.playerIdx,
            player.teamIdx,
            shouldAnimateRoomTeamChange(
              previousTeam,
              player.teamIdx,
              busy.has(player.playerIdx),
            ),
          )
          sceneTeamsRef.current.set(player.playerIdx, player.teamIdx)
        }
        for (const player of latestPlayers) created.setPlayerBusy(player.playerIdx, busy.has(player.playerIdx))
        created.setCameraZoom(cameraZoomRef.current)
        created.setCameraPan(cameraPanRef.current.x, cameraPanRef.current.z)
        created.setSelection(selectedTeamIdx, selectedPlayerIdx)
        created.setLocalInputDisabled(localInputDisabledRef.current)
        setReady(true)
        onSceneReadyRef.current?.(created)
      })
      .catch((error) => {
        logger.error("room3d.init_failed", error)
        if (handleRef.current === handle) handleRef.current = null
        handle?.dispose()
        handle = null
        if (!cancelled) {
          container.replaceChildren()
          setLoadError(error instanceof Error ? error : new Error(String(error)))
        }
      })

    return () => {
      cancelled = true
      if (handle) onSceneReadyRef.current?.(null)
      if (handleRef.current === handle) handleRef.current = null
      handle?.dispose()
    }
  // The serialized identity deliberately excludes mutable team assignments.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, sceneIdentityKey])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const busy = new Set(busyPlayerIdxs)
    for (const player of players) {
      handle.setPlayerLobbyOrdinal?.(player.playerIdx, player.lobbyOrdinal ?? null)
      const previousTeam = sceneTeamsRef.current.get(player.playerIdx)
      handle.setPlayerTeam(
        player.playerIdx,
        player.teamIdx,
        shouldAnimateRoomTeamChange(
          previousTeam,
          player.teamIdx,
          busy.has(player.playerIdx),
        ),
      )
      sceneTeamsRef.current.set(player.playerIdx, player.teamIdx)
    }
  }, [players, ready])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const busy = new Set(busyPlayerIdxs)
    for (const player of players) handle.setPlayerBusy(player.playerIdx, busy.has(player.playerIdx))
  }, [busyPlayerIdxs, players, ready])

  useEffect(() => {
    handleRef.current?.setSelection(selectedTeamIdx, selectedPlayerIdx)
  }, [ready, selectedPlayerIdx, selectedTeamIdx])

  useEffect(() => {
    handleRef.current?.setBackroomsUnlocked?.(backroomsUnlocked)
  }, [ready, backroomsUnlocked])

  useEffect(() => {
   handleRef.current?.setArcadeVisible?.(arcadeVisible, arcadeEntrance)
 }, [ready, arcadeVisible, arcadeEntrance])

 useEffect(() => {
    handleRef.current?.setPrimeyVisible?.(primeyVisible)
  }, [ready, primeyVisible])

  // A one-shot, not a state: only a change to the sequence fires it, so a
  // remount (or the scene's own rebuild) does not replay the last snap.
  const consumedSnapSeqRef = useRef(thanosSnapSeq)
  useEffect(() => {
    if (thanosSnapSeq === consumedSnapSeqRef.current) return
    consumedSnapSeqRef.current = thanosSnapSeq
    handleRef.current?.thanosSnap?.()
  }, [ready, thanosSnapSeq])

  useEffect(() => {
    handleRef.current?.setRenderPaused?.(renderPaused)
  }, [ready, renderPaused])

  // Standings arrive on their own cadence — the leaderboard poll, every few
  // seconds — long after the scene was built, so they go through the handle
  // exactly as team changes do. Rebuilding the room for a placing would drop
  // the camera, the walk and everyone's position.
  useEffect(() => {
    handleRef.current?.setTeamRanks(teamRanks ?? [])
  }, [ready, teamRanks])

  useEffect(() => {
    handleRef.current?.setSessionClock(sessionClock)
  }, [ready, sessionClock])

  useEffect(() => {
    handleRef.current?.setCountdown(countdown)
  }, [ready, countdown])

  useEffect(() => {
    handleRef.current?.setMarketNews(marketNews)
  }, [marketNews, ready])

  useEffect(() => {
    handleRef.current?.setForcedScreenPage(forcedScreenPage)
  }, [forcedScreenPage, ready])

  useEffect(() => {
    handleRef.current?.setPresentation(presentation)
  }, [presentation, ready])

  useEffect(() => {
    handleRef.current?.setWinners(winners)
  }, [winners, ready])

  useEffect(() => {
    if (newsAudio) handleRef.current?.setNewsAudio(newsAudio)
  }, [newsAudio, ready])

  useEffect(() => {
    handleRef.current?.setCameraZoom(cameraZoom)
  }, [cameraZoom, ready])

  useEffect(() => {
    handleRef.current?.setCameraPan(cameraPan.x, cameraPan.z)
  }, [cameraPan, ready])

  useEffect(() => {
    handleRef.current?.setLocalInputDisabled(localInputDisabled)
  }, [localInputDisabled, ready])

  useEffect(() => {
    if (!cameraControls) return
    const keyboardTarget = keyboardTargetRef?.current
    if (!keyboardTarget) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      let action: RoomCameraZoomAction | null = null
      if (event.key === "+" || event.key === "=") action = "in"
      else if (event.key === "-" || event.key === "_") action = "out"
      else if (event.key === "0" || event.key.toLowerCase() === "f") action = "fit"
      if (action) {
        event.preventDefault()
        setCameraZoom((zoom) => nextRoomCameraZoom(zoom, action))
        if (action === "fit") setCameraPan({ x: 0, z: 0 })
        return
      }

      const panKey: Record<string, RoomCameraPanAction> = {
        ArrowLeft: "left",
        a: "left",
        ArrowRight: "right",
        d: "right",
        ArrowUp: "up",
        w: "up",
        ArrowDown: "down",
        s: "down",
      }
      // Walking the local character owns these keys; the scene's own key
      // handler moves the player and the camera stays put.
      if (suppressPanKeys) return
      const panAction = panKey[event.key] ?? panKey[event.key.toLowerCase()]
      if (!panAction) return
      event.preventDefault()
      setCameraPan((pan) => nextRoomCameraPan(pan, panAction))
    }

    keyboardTarget.addEventListener("keydown", onKeyDown)
    return () => keyboardTarget.removeEventListener("keydown", onKeyDown)
  }, [cameraControls, keyboardTargetRef, suppressPanKeys])

  useEffect(() => {
    if (!cameraControls) return
    const container = containerRef.current
    if (!container) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const action = roomCameraWheelAction(event.deltaY)
      if (!action) return
      const now = performance.now()
      if (now - lastWheelZoomAtRef.current < 70) return
      lastWheelZoomAtRef.current = now
      setCameraZoom((zoom) => nextRoomCameraZoom(zoom, action))
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [cameraControls])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle || !arrivalAnimation) return
    consumedArrivalSequenceRef.current = consumeRoomArrival(
      handle,
      players,
      arrivalAnimation,
      consumedArrivalSequenceRef.current,
    )
  }, [arrivalAnimation, players, ready])

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    background: "#020510",
    fontFamily: "var(--font-display)",
    fontSize: 12,
    letterSpacing: "0.12em",
  }

  return (
    <div
      style={{ position: "relative", width: "100%", ...(fill ? { height: "100%" } : {}) }}
      aria-busy={!ready && !loadError}
    >
      <div
        ref={containerRef}
        style={fill
          ? {
            // full-bleed: the page supplies the frame, so no border chrome
            width: "100%",
            height: "100%",
            background: "#020510",
            overflow: "hidden",
            // Taps select; a stray touch drag must not scroll or pinch the page.
            touchAction: "none",
          }
          : {
            width: "100%",
            aspectRatio: `${CW}/${CH}`,
            border: "6px solid #2840A8",
            outline: "2px solid #5070E0",
            boxShadow: "8px 8px 0 #000",
            background: "#020510",
            overflow: "hidden",
            touchAction: "none",
          }}
      />
      {cameraControls && ready && !showTouchControls && <RoomCameraLegend walkMode={suppressPanKeys} onMenuToggle={onMenuToggle} />}
      {showTouchControls && ready && (
        <RoomTouchControls
          walkMode={suppressPanKeys}
          onWalk={(direction, active) => handleRef.current?.setMoveInput(direction, active)}
          onPan={(action) => setCameraPan((pan) => nextRoomCameraPan(pan, action))}
          onZoom={(action) => setCameraZoom((zoom) => nextRoomCameraZoom(zoom, action))}
          onPadPress={onTouchPadPress}
          onInteract={() => {
            const handle = handleRef.current
            if (!handle) return
            if (suppressPanKeys) handle.interact()
            else onPick?.(handle.pickNearCenter())
          }}
        />
      )}
      {!ready && !loadError && (
        <div style={{ ...overlayStyle, color: "#5070E0", pointerEvents: "none" }}>
          &gt; BUILDING 3D ROOM…
        </div>
      )}
      {loadError && (
        <div style={{ ...overlayStyle, color: "#FF4040", padding: 24 }}>
          <div>&gt; 3D ROOM FAILED TO LOAD</div>
          <div style={{ fontSize: 10, color: "#A0B0D0", maxWidth: 400, textAlign: "center" }}>
            {loadError.message}
          </div>
          <button
            onClick={() => setRetryKey((key) => key + 1)}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              letterSpacing: "0.06em",
              background: "#2840A8",
              border: "2px solid #5070E0",
              color: "#FFF",
              cursor: "pointer",
              padding: "6px 12px",
            }}
          >
            RETRY
          </button>
        </div>
      )}
    </div>
  )
}
