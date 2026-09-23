// 3D game room — HD-2D diorama view. Rendering is delegated to
// gameRoom3d/scene.ts (three.js, lazy-loaded).
import { useEffect, useMemo, useRef, useState } from "react"
import type { FlatPlayer, TeamDTO } from "~/lib/event-types"
import { CW } from "../gameRoom/constants"
import { RoomInfoPanel, type RoomSelection } from "../gameRoom/InfoPanel"
import { Room3DViewport } from "./Room3DViewport"
import type { TouchPadPress } from "./TouchControls"
import type { RoomPlayerInput, RoomSceneHandle, RoomSelfState } from "./scene"
import type { RoomBoard } from "./wall"

export interface GameRoom3DProps {
  teams: TeamDTO[]
  allPlayers: FlatPlayer[]
  selectedTeamIdx?: number | null
  selectedPlayerIdx?: number | null
  /** Fill the parent element edge to edge instead of the framed aspect box. */
  fill?: boolean
  onPlayerSelect?: (playerIdx: number | null) => void
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
  onTableInteract?: (tableIdx: number) => void
  /** Interact fired while facing Primey — local only. */
  onPrimeyInteract?: () => void
  onMenuToggle?: () => void
}

export default function GameRoom3D({
  teams,
  allPlayers,
  selectedTeamIdx,
  selectedPlayerIdx,
  fill = false,
  onPlayerSelect,
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
    if (selectedPlayerIdx === undefined) return
    setSelected(selectedPlayerIdx === null ? null : { type: "player", idx: selectedPlayerIdx })
  }, [selectedPlayerIdx])

  // The room is the page's main surface — pan keys should work on arrival,
  // not after a click the user has no reason to make.
  useEffect(() => {
    if (fill) focusOriginRef.current?.focus()
  }, [fill])

  const effTeamIdx = selectedTeamIdx ?? (selected?.type === "team" ? selected.idx : null)
  const effPlayerIdx = selected?.type === "player" ? selected.idx : null
  const players = useMemo(() => allPlayers.map((player, playerIdx) => ({
    name: player.name,
    role: player.role,
    teamIdx: player.teamIdx,
    seatIdx: player.seatIdx,
    playerIdx,
    spriteId: player.spriteId,
    spriteSheet: player.spriteSheet,
  } satisfies RoomPlayerInput)), [allPlayers])
  const teamLabels = useMemo(() => teams.map((team) => team.name), [teams])
  const teamCompeting = useMemo(() => teams.map((team) => team.competing ?? true), [teams])

  const handlePick = (pick: RoomSelection) => {
    // Guest characters (connected visitors) live past the page roster's
    // indices and have no info panel — clicking one is a no-op.
    if (pick?.type === "player" && !allPlayers[pick.idx]) return
    const previous = selectedRef.current
    let next: RoomSelection = pick
    if (pick && previous && pick.type === previous.type && pick.idx === previous.idx) next = null
    setSelected(next)
    onPlayerSelect?.(next?.type === "player" ? next.idx : null)
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
          players={players}
          teamLabels={teamLabels}
          teamCompeting={teamCompeting}
          selectedTeamIdx={effTeamIdx}
          selectedPlayerIdx={effPlayerIdx}
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
          onTableInteract={onTableInteract}
          onPrimeyInteract={onPrimeyInteract}
          onMenuToggle={onMenuToggle}
        />
      </div>
      <RoomInfoPanel
        selected={selected}
        teams={teams}
        allPlayers={allPlayers}
        onClose={() => { setSelected(null); onPlayerSelect?.(null) }}
      />
    </div>
  )
}
