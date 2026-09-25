// 3D game room — HD-2D diorama view. Rendering is delegated to
// gameRoom3d/scene.ts (three.js, lazy-loaded).
import { useEffect, useRef, useState } from "react"
import type { Agent, StatusStyleOverrides } from "~/lib/agents"
import { CW } from "../gameRoom/constants"
import { RoomInfoPanel } from "../gameRoom/InfoPanel"
import { Room3DViewport } from "./Room3DViewport"
import type { TouchPadPress } from "./TouchControls"
import type { RoomSceneHandle, RoomSelfState } from "./scene"
import { sameSelection, type RoomSelection } from "./selection"
import type { RoomBoard } from "./wall"

export interface GameRoom3DProps {
  agents: readonly Agent[]
  statusStyles?: StatusStyleOverrides
  /** A selection driven from outside (the find box). Undefined leaves the
   * room's own clicks in charge. */
  selected?: RoomSelection
  /** Fill the parent element edge to edge instead of the framed aspect box. */
  fill?: boolean
  onSelect?: (selection: RoomSelection) => void
  /** The wall's resting page, or null for the room's title alone. */
  board?: RoomBoard | null
  /** A bulletin taking over the wall, or null while it shows the board. */
  bulletin?: string | null
  // multiplayer plumbing (useGameRoomNet at the route level)
  /** The local player is walking their character: movement owns WASD/arrows,
   * so the camera's keyboard pan stands down (drag-pan and zoom stay). */
  localControlActive?: boolean
  /** Keep rendering and networking while menu UI temporarily owns local input. */
  localInputDisabled?: boolean
  backroomsUnlocked?: boolean
  /** The Konami-code arcade cabinet is standing beside Primey (this client only). */
  arcadeVisible?: boolean
  /** Play the cabinet's drop-in entrance when it first appears. Off when the
   * player unlocked it on an earlier visit, so a refresh does not replay it. */
  arcadeEntrance?: boolean
  /** Primey stands in the room. */
  primeyVisible?: boolean
  /** Bumped once per finger snap heard: each change dusts half the room. */
  thanosSnapSeq?: number
  renderPaused?: boolean
  onBackroomsEnter?: () => void
  /** Interact fired while facing the arcade cabinet (or a click on it) — opens
   * the fighter over the room, local only. */
  onArcadeInteract?: () => void
  /** The cabinet hit the floor in its entrance — a cue for the thud. */
  onArcadeLanded?: () => void
  /** A discrete press on the touch pad, for the Konami-code listener. */
  onTouchPadPress?: (press: TouchPadPress) => void
  onSceneReady?: (handle: RoomSceneHandle | null) => void
  onSelfState?: (state: RoomSelfState) => void
  onInteract?: (targetPlayerIdx: number) => void
  onAgentInteract?: (agentId: string) => void
  onTableInteract?: (tableIdx: number) => void
  /** Interact fired while facing Primey — local only. */
  onPrimeyInteract?: () => void
  onMenuToggle?: () => void
}

export default function GameRoom3D({
  agents,
  statusStyles,
  selected: selectedProp,
  fill = false,
  onSelect,
  board = null,
  bulletin = null,
  localControlActive = false,
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
  onSceneReady,
  onSelfState,
  onInteract,
  onAgentInteract,
  onTableInteract,
  onPrimeyInteract,
  onMenuToggle,
}: GameRoom3DProps) {
  const [selected, setSelected] = useState<RoomSelection>(null)
  // Pan/zoom keys go to this wrapper: a focusable region around the canvas,
  // so WASD only pans while the room — not the find box floating above it —
  // has focus.
  const focusOriginRef = useRef<HTMLDivElement>(null)

  // Keep the current selection visible to the scene callback without rebuilding it.
  const selectedRef = useRef<RoomSelection>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // external selection (the find box) drives internal state
  useEffect(() => {
    if (selectedProp === undefined) return
    setSelected(selectedProp)
  }, [selectedProp])

  // The room is the page's main surface — pan keys should work on arrival,
  // not after a click the user has no reason to make.
  useEffect(() => {
    if (fill) focusOriginRef.current?.focus()
  }, [fill])

  const handlePick = (pick: RoomSelection) => {
    // A visitor's character has no card — clicking one is a no-op.
    if (pick?.type === "player") return
    const previous = selectedRef.current
    const next: RoomSelection = sameSelection(pick, previous) ? null : pick
    setSelected(next)
    onSelect?.(next)
  }

  return (
    <div style={fill
      ? { position: "relative", width: "100%", height: "100%" }
      : { position: "relative", width: "100%", maxWidth: CW * 1.5 }}
    >
      <div
        ref={focusOriginRef}
        role="region"
        aria-label="3D game room interaction surface"
        tabIndex={0}
        onPointerDown={() => focusOriginRef.current?.focus()}
        className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
        style={fill ? { width: "100%", height: "100%" } : undefined}
      >
        <Room3DViewport
          agents={agents}
          statusStyles={statusStyles}
          selected={selected}
          cameraControls
          suppressPanKeys={localControlActive}
          localInputDisabled={localInputDisabled}
          backroomsUnlocked={backroomsUnlocked}
          arcadeVisible={arcadeVisible}
          arcadeEntrance={arcadeEntrance}
          primeyVisible={primeyVisible}
          thanosSnapSeq={thanosSnapSeq}
          renderPaused={renderPaused}
          onBackroomsEnter={onBackroomsEnter}
          onArcadeInteract={onArcadeInteract}
          onArcadeLanded={onArcadeLanded}
          onTouchPadPress={onTouchPadPress}
          touchControls
          keyboardTargetRef={focusOriginRef}
          fill={fill}
          board={board}
          bulletin={bulletin}
          onPick={handlePick}
          onSceneReady={onSceneReady}
          onSelfState={onSelfState}
          onInteract={onInteract}
          onAgentInteract={onAgentInteract}
          onTableInteract={onTableInteract}
          onPrimeyInteract={onPrimeyInteract}
          onMenuToggle={onMenuToggle}
        />
      </div>
      <RoomInfoPanel
        selected={selected}
        agents={agents}
        statusStyles={statusStyles}
        onClose={() => { setSelected(null); onSelect?.(null) }}
      />
    </div>
  )
}
