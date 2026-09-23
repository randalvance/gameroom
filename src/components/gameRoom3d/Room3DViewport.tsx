import { logger } from "~/lib/logger"
import { useEffect, useRef, useState, type RefObject } from "react"
import { CW, CH } from "../gameRoom/constants"
import { effectiveStatus, styleFor, type Agent, type StatusStyleOverrides } from "~/lib/agents"
import {
  nextRoomCameraPan,
  type RoomCameraPan,
  type RoomCameraPanAction,
} from "./camera-pan"
import type { RoomAgentInput, RoomSceneHandle, RoomSelfState } from "./scene"
import type { RoomSelection } from "./selection"
import type { RoomBoard } from "./wall"
import { RoomTouchControls, useCoarsePointer, type TouchPadPress } from "./TouchControls"

export interface Room3DViewportProps {
  /** The agents in the room. Diffed against the last render: an agent that
   * appears walks in, one that goes fades out, one that changes is retinted
   * in place. Never rebuilds the scene. */
  agents: readonly Agent[]
  /** The host's overrides of how each status looks. */
  statusStyles?: StatusStyleOverrides
  selected?: RoomSelection
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
  /** Primey stands in the room. */
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
  /** The wall's resting page, or null for the room's title alone. */
  board?: RoomBoard | null
  /** A bulletin taking over the wall, or null while it shows the board. */
  bulletin?: string | null
  /**
   * Fill the parent instead of keeping the room's own aspect box. The parent
   * owns the size (and any chrome); the canvas tracks it via ResizeObserver.
   */
  fill?: boolean
  onPick?: (pick: RoomSelection) => void
  /** The scene handle, for imperative drivers (the multiplayer net hook) —
   * called with the handle once the scene is live, and null when it goes away. */
  onSceneReady?: (handle: RoomSceneHandle | null) => void
  onSelfState?: (state: RoomSelfState) => void
  onInteract?: (targetPlayerIdx: number) => void
  /** The local player pressed interact while facing this agent. */
  onAgentInteract?: (agentId: string) => void
  onTableInteract?: (tableIdx: number) => void
  /** Interact fired while facing Primey — local only. */
  onPrimeyInteract?: () => void
  onMenuToggle?: () => void
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

/**
 * The agents as the scene takes them: status rolled up through their
 * children and the look for it resolved, so the scene never has to know
 * about parents or the host's overrides.
 */
export function roomAgentInputs(agents: readonly Agent[], statusStyles?: StatusStyleOverrides): RoomAgentInput[] {
  return agents.map((agent) => {
    const status = effectiveStatus(agent, agents)
    return {
      id: agent.id,
      name: agent.name,
      status,
      style: styleFor(status, statusStyles),
      activity: agent.activity,
      sprite: agent.sprite,
      color: agent.color,
    }
  })
}

/** Is this the same input the scene already has? Cheap enough per render. */
function sameAgentInput(a: RoomAgentInput, b: RoomAgentInput): boolean {
  return (
    a.name === b.name &&
    a.status === b.status &&
    a.style === b.style &&
    a.activity === b.activity &&
    a.sprite === b.sprite &&
    a.color === b.color
  )
}

/**
 * Bring the scene's cast up to the host's list: new agents go in, missing
 * ones go, changed ones are retinted. Returns what the scene now holds.
 */
export function syncRoomAgents(
  handle: Pick<RoomSceneHandle, "upsertAgent" | "removeAgent">,
  previous: ReadonlyMap<string, RoomAgentInput>,
  next: readonly RoomAgentInput[],
): Map<string, RoomAgentInput> {
  const current = new Map<string, RoomAgentInput>()
  for (const agent of next) {
    current.set(agent.id, agent)
    const before = previous.get(agent.id)
    if (!before || !sameAgentInput(before, agent)) handle.upsertAgent(agent)
  }
  for (const id of previous.keys()) {
    if (!current.has(id)) handle.removeAgent(id)
  }
  return current
}

export function Room3DViewport({
  agents,
  statusStyles,
  selected = null,
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
  board = null,
  bulletin = null,
  fill = false,
  onPick,
  onSceneReady,
  onSelfState,
  onInteract,
  onAgentInteract,
  onTableInteract,
  onPrimeyInteract,
  onMenuToggle,
}: Room3DViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RoomSceneHandle | null>(null)
  const onPickRef = useRef(onPick)
  const onSceneReadyRef = useRef(onSceneReady)
  const onSelfStateRef = useRef(onSelfState)
  const onInteractRef = useRef(onInteract)
  const onAgentInteractRef = useRef(onAgentInteract)
  const onTableInteractRef = useRef(onTableInteract)
  const onPrimeyInteractRef = useRef(onPrimeyInteract)
  const onBackroomsEnterRef = useRef(onBackroomsEnter)
  const onArcadeInteractRef = useRef(onArcadeInteract)
  const onArcadeLandedRef = useRef(onArcadeLanded)
  const [cameraZoom, setCameraZoom] = useState(
    cameraControls ? ROOM_CAMERA_DEFAULT_ZOOM : ROOM_CAMERA_FIT_ZOOM,
  )
  const [cameraPan, setCameraPan] = useState<RoomCameraPan>({ x: 0, z: 0 })
  const cameraZoomRef = useRef(cameraZoom)
  const cameraPanRef = useRef(cameraPan)
  const localInputDisabledRef = useRef(localInputDisabled)
  const selectedRef = useRef(selected)
  const lastWheelZoomAtRef = useRef(Number.NEGATIVE_INFINITY)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const coarsePointer = useCoarsePointer()
  const showTouchControls = touchControls && coarsePointer
  /** What the scene holds, by agent id, so a render only sends the delta. */
  const sceneAgentsRef = useRef(new Map<string, RoomAgentInput>())

  onPickRef.current = onPick
  onSceneReadyRef.current = onSceneReady
  onSelfStateRef.current = onSelfState
  onInteractRef.current = onInteract
  onAgentInteractRef.current = onAgentInteract
  onTableInteractRef.current = onTableInteract
  onPrimeyInteractRef.current = onPrimeyInteract
  onBackroomsEnterRef.current = onBackroomsEnter
  onArcadeInteractRef.current = onArcadeInteract
  onArcadeLandedRef.current = onArcadeLanded
  cameraZoomRef.current = cameraZoom
  cameraPanRef.current = cameraPan
  localInputDisabledRef.current = localInputDisabled
  selectedRef.current = selected

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let handle: RoomSceneHandle | null = null
    setReady(false)
    setLoadError(null)

    import("./scene")
      .then(({ createRoomScene }) => createRoomScene(container, {
        onPick: (pick) => onPickRef.current?.(pick),
        onSelfState: (state) => onSelfStateRef.current?.(state),
        onInteract: (targetPlayerIdx) => onInteractRef.current?.(targetPlayerIdx),
        onAgentInteract: (agentId) => onAgentInteractRef.current?.(agentId),
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
        // A fresh scene holds nobody: the agents effect below seats everyone.
        sceneAgentsRef.current = new Map()
        created.setCameraZoom(cameraZoomRef.current)
        created.setCameraPan(cameraPanRef.current.x, cameraPanRef.current.z)
        created.setSelection(selectedRef.current)
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
  }, [retryKey])

  // The cast goes through the handle: nobody's arrival rebuilds the room.
  useEffect(() => {
    const handle = handleRef.current
    if (!handle || !ready) return
    sceneAgentsRef.current = syncRoomAgents(handle, sceneAgentsRef.current, roomAgentInputs(agents, statusStyles))
  }, [agents, statusStyles, ready])

  useEffect(() => {
    handleRef.current?.setSelection(selected)
  }, [ready, selected])

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

  // The wall's contents go through the handle too. Rebuilding the room for a
  // line of text would drop the camera, the walk and everyone's position.
  useEffect(() => {
    handleRef.current?.setBoard(board)
  }, [board, ready])

  useEffect(() => {
    handleRef.current?.setBulletin(bulletin)
  }, [bulletin, ready])

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
