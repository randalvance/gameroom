// 3D game room — HD-2D diorama view. Rendering is delegated to
// gameRoom3d/scene.ts (three.js, lazy-loaded).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FlatPlayer, TeamDTO } from "~/lib/event-types"
import type { ExLeaderboardRow } from "~/lib/exchange-types"
import { roomPresentation, type PresentationState } from "~/lib/presentation-order"
import { roomWinners, type WinnersState } from "~/lib/winners-ceremony"
import { teamRanksByIndex } from "~/lib/team-ranks"
import { CW } from "../gameRoom/constants"
import { RoomInfoPanel, useLocalFeedbacks, type RoomSelection } from "../gameRoom/InfoPanel"
import { Room3DViewport } from "./Room3DViewport"
import type { TouchPadPress } from "./TouchControls"
import type { RoomPlayerInput, RoomSceneHandle, RoomSelfState } from "./scene"
import type { ScreenPage } from "./screen-pages"
import { eventStarted, type ScreenCountdown, type SessionClockSnapshot } from "./session-screen"
import type { MarketNews } from "./useMarketNews"

export interface GameRoom3DProps {
  teams: TeamDTO[]
  allPlayers: FlatPlayer[]
  selectedTeamIdx?: number | null
  selectedPlayerIdx?: number | null
  /** Fill the parent element edge to edge instead of the framed aspect box. */
  fill?: boolean
  /**
   * Standings for the wall screen's leaderboard page, and for the floating
   * placing over each team's desk (see lib/team-ranks.ts). Empty until a
   * window is scored, which leaves the screen on its waiting line and the
   * desks bare. Both are gated on `sessionClock` too — before the event's
   * first window there is no board page and no desk numerals at all.
   */
  leaderboard?: readonly ExLeaderboardRow[]
  onPlayerSelect?: (playerIdx: number | null) => void
  /** The trading window's clock for the room's big screen; null falls the
   * screen back to the countdown to launch day. */
  sessionClock?: SessionClockSnapshot | null
  /** What the wall counts to with no window running: the doors before they
   * open (the room hands this in pre-event), or null for launch day. */
  countdown?: ScreenCountdown | null
  /** A live market announcement temporarily taking over the wall screen. */
  marketNews?: MarketNews | null
  /** Fixed room-PA settings for a filmed broadcast's audio. */
  newsAudio?: { muted: boolean; volume: number }
  /** A page the gamemaster has pinned the wall screen to for the whole room,
   * or null while the players turn it themselves. */
  forcedScreenPage?: ScreenPage | null
  /**
   * The presentation running order the gamemaster has drawn, or null. The
   * room darkens and sweeps a spotlight over the desks in order, each desk's
   * numeral becoming its presentation slot as the light lands; a spotlit team
   * is lit alone. Team ids are resolved to desks here, against the same
   * `teams` the desks are seated by.
   */
  presentation?: PresentationState | null
  /**
   * The winners' ceremony the gamemaster is running, or null. The room turns
   * to the wall and the sky goes dark; each place read hangs its medal over
   * the desk and fires fireworks over the city. Team ids are resolved to
   * desks here, like the running order.
   */
  winners?: WinnersState | null
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
  /** Primey stands in the room (hidden in a student's room before the doors). */
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
  /** Interact fired while facing Primey — opens the chat panel, local only. */
  onPrimeyInteract?: () => void
  onMenuToggle?: () => void
}


export default function GameRoom3D({ teams, allPlayers, selectedTeamIdx, selectedPlayerIdx, fill = false, leaderboard, sessionClock = null, countdown = null, marketNews = null, newsAudio, forcedScreenPage = null, presentation = null, winners = null, onPlayerSelect, localControlActive = false, localInputDisabled = false, backroomsUnlocked = false, arcadeVisible = false, arcadeEntrance = true, primeyVisible = true, thanosSnapSeq = 0, renderPaused = false, onBackroomsEnter, onArcadeInteract, onArcadeLanded, onTouchPadPress, onSceneReady, onSelfState, onInteract, onTableInteract, onPrimeyInteract, onMenuToggle }: GameRoom3DProps) {
  const [selected, setSelected] = useState<RoomSelection>(null)
  const feedbacks = useLocalFeedbacks()
  // Pan/zoom keys go to this wrapper, same shape as the team-assignment tab:
  // a focusable region around the canvas, so WASD only pans while the room —
  // not the find-student box floating above it — has focus.
  const focusOriginRef = useRef<HTMLDivElement>(null)

  // Keep the current selection visible to the scene callback without rebuilding it.
  const selectedRef = useRef<RoomSelection>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // The wall screen's leaderboard page is fed imperatively — the scene owns
  // its canvas, so new standings are pushed at it rather than re-rendered.
  const sceneRef = useRef<RoomSceneHandle | null>(null)
  const leaderboardRef = useRef<readonly ExLeaderboardRow[] | undefined>(undefined)
  const handleSceneReady = useCallback((handle: RoomSceneHandle | null) => {
    sceneRef.current = handle
    // A scene rebuilt after the first poll starts on the standings we have.
    if (handle && leaderboardRef.current) handle.setLeaderboard(leaderboardRef.current)
    onSceneReady?.(handle)
  }, [onSceneReady])
  useEffect(() => {
    leaderboardRef.current = leaderboard
    if (leaderboard) sceneRef.current?.setLeaderboard(leaderboard)
  }, [leaderboard])

  // external selection (student selector) drives internal state
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
    draggable: false,
    spriteId: player.spriteId,
    spriteSheet: player.spriteSheet,
  } satisfies RoomPlayerInput)), [allPlayers])
  const teamLabels = useMemo(() => teams.map((team) => team.name), [teams])
  const teamCompeting = useMemo(() => teams.map((team) => team.competing ?? true), [teams])
  // The desks' floating placings come from the SAME standings the wall screen
  // reads — one poll, one answer. A second source could put a team 2nd on the
  // desk and 3rd on the screen a few seconds apart.
  //
  // And they only exist once the event has: before the first trading window
  // opens, nobody is 1st at anything, so every desk stays bare rather than
  // hanging a placing over it that no trade earned. Same gate the wall screen
  // puts on its leaderboard page.
  // The boolean, not the snapshot: the clock polls every 5s and hands back a
  // fresh object each time, and re-deriving the placings on every tick would
  // push a new array at the scene for nothing.
  const started = eventStarted(sessionClock)
  const teamRanks = useMemo(
    () => (started ? teamRanksByIndex(teams, leaderboard ?? []) : []),
    [teams, leaderboard, started],
  )

  // The running order, by desk. Memoised on the state's identity: the hook
  // hands over a new object only when a presentation frame lands.
  const roomOrder = useMemo(() => roomPresentation(presentation, teams), [presentation, teams])
  const roomPodium = useMemo(() => roomWinners(winners, teams), [winners, teams])

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
          teamRanks={teamRanks}
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
          sessionClock={sessionClock}
          countdown={countdown}
          marketNews={marketNews}
          newsAudio={newsAudio}
          forcedScreenPage={forcedScreenPage}
          presentation={roomOrder}
          winners={roomPodium}
          onPick={handlePick}
          onSceneReady={handleSceneReady}
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
        feedbacks={feedbacks}
        onClose={() => { setSelected(null); onPlayerSelect?.(null) }}
      />
    </div>
  )
}
