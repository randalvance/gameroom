// The game room, as ONE component you can drop into a page.
//
// Everything below the header of the event site's /game-room route lives here:
// the 3D room, the multiplayer wiring, the pause menu, the chat panel, the
// dialog box, the music, and the three easter-egg games that open over it.
// A host hands in who is playing and which teams are seated; the room does the
// rest and calls back when something outside its walls has to happen (a save,
// an exit).
//
// What it deliberately does NOT own:
//
//   - identity. There is no sign-in here. `me` is whoever you say it is.
//   - persistence. Unlocking the arcade fires `onArcadeUnlock`; keeping that
//     across visits is the host's business (`arcadeUnlocked` hands it back).
//   - the roster. Teams come in as props, and the hub is told about them
//     server-side (see server/hub-server.ts).
//
// Use <GameRoom3D> directly instead if you want only the scene, with your own
// UI around it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import GameRoom3D from "~/components/gameRoom3d/GameRoom3D"
import { BackroomsPortal } from "~/components/backrooms/BackroomsPortal"
import { ArcadePortal } from "~/components/arcade/ArcadePortal"
import { DuelPortal } from "~/components/duel/DuelPortal"
import type { DeckId } from "~/components/duel/cards"
import { exhibitionOrdinal, houseDeckForDesk } from "~/components/duel/house-deck"
import { RoomToast } from "~/components/RoomToast"
import { StudentSelector } from "~/components/StudentSelector"
import { tableInteractAction } from "~/lib/table-interact-action"
import { createRoomArcadeCues, type RoomArcadeCues } from "~/components/arcade/room-cues"
import { RotateToLandscape, useCoarsePointer, useIsPortrait } from "~/components/gameRoom3d/TouchControls"
import { useGameRoomNet } from "~/components/gameRoom3d/useGameRoomNet"
import { useBulletin, type RoomBulletin } from "~/components/gameRoom3d/useBulletin"
import type { RoomBoard } from "~/components/gameRoom3d/wall"
import { GameRoomChatPanel } from "~/components/gameRoom3d/GameRoomChatPanel"
import { GameRoomDialogBox } from "~/components/gameRoom3d/GameRoomDialogBox"
import type { GameRoomDialog } from "~/components/gameRoom3d/useGameRoomNet"
import { GameRoomMenu } from "~/components/gameRoom3d/GameRoomMenu"
import type { RoomSceneHandle } from "~/components/gameRoom3d/scene"
import { usePageMusic, useSiteAudio } from "~/components/SiteAudio"
import { roomMusicRequest } from "~/lib/game-room-music"
import { createKonamiDetector, konamiTokenForKey } from "~/lib/konami"
import { track } from "~/lib/analytics"
import { buildAllPlayers, type TeamDTO } from "~/lib/event-types"
import { useSnapMic } from "~/components/gameRoom3d/useSnapMic"
import type { GameRoomMenuData } from "~/lib/game-room-menu"

/** How long Primey's line stays up when you press interact on it. */
const PRIMEY_DIALOG_MS = 4200

export interface GameRoomProps {
  /** Who is playing. `role` decides crowns, PA music and what the menu offers. */
  me: GameRoomMenuData["me"]
  /** The desks, in seating order. */
  teams: TeamDTO[]
  /** What the pause menu shows: you, and the people it lists beside you. */
  menu: GameRoomMenuData
  /** The wall's resting page: a title and a few lines. Omit for the room's
   * title alone. */
  board?: RoomBoard | null
  /** A bulletin for the wall: it goes up for its hold, and every camera in
   * the room turns to read it. Hand in a new object to raise it again. */
  bulletin?: RoomBulletin | null
  /** The arcade cabinet was unlocked on an earlier visit: it is already there,
   * with no drop-in entrance. */
  arcadeUnlocked?: boolean
  /** The Konami code was just entered. Persist it and hand it back as
   * `arcadeUnlocked` next time. */
  onArcadeUnlock?: () => void | Promise<void>
  /** A house deck was beaten at a white desk. */
  onDuelWin?: (houseDeck: DeckId) => void
  /** Escape (and Q, for a spectator) leaves the room. Omit and they do nothing. */
  onExit?: () => void
  /** Rendered above the room — your own header, ticker or nothing at all. */
  header?: React.ReactNode
}

export function GameRoom({
  me,
  teams,
  menu,
  board = null,
  bulletin = null,
  arcadeUnlocked = false,
  onArcadeUnlock,
  onDuelWin,
  onExit,
  header,
}: GameRoomProps) {
  const { playSfx, suspendMusic, effectsVolume, musicMuted, musicVolume } = useSiteAudio()
  const allPlayers = useMemo(() => buildAllPlayers(teams), [teams])

  const [menuOpen, setMenuOpen] = useState(false)
  const [inBackrooms, setInBackrooms] = useState(false)
  // Only this account's unlock is held. Discovery is immediate; saving it is
  // the host's job, and a failed save costs the cabinet on the next visit only.
  const [arcadeUnlock, setArcadeUnlock] = useState<{ userId: string; saveFailed?: boolean } | null>(null)
  const arcadeVisible = arcadeUnlocked || arcadeUnlock?.userId === me.id
  const arcadeVisibleRef = useRef(arcadeVisible)
  arcadeVisibleRef.current = arcadeVisible
  const [inArcade, setInArcade] = useState(false)
  const [arcadeToast, setArcadeToast] = useState(false)
  useEffect(() => { setInArcade(false); setArcadeToast(false) }, [me.id])
  // The white desks' card duel: an easter egg with no signpost. Interact at an
  // exhibition desk opens the game over the room, local to this client.
  const [duel, setDuel] = useState<{ houseDeck: DeckId; houseName: string } | null>(null)
  const inDuel = duel !== null
  useEffect(() => { setDuel(null) }, [me.id])
  /** The room's two arcade cues (the unlock jingle, the cabinet's thud). */
  const jingleRef = useRef<RoomArcadeCues | null>(null)
  useEffect(() => () => { jingleRef.current?.close(); jingleRef.current = null }, [])

  // The desk the player walked up to. Null means the Team section shows their
  // own team, which is what opening the menu by hand does.
  const [focusTeamIdx, setFocusTeamIdx] = useState<number | null>(null)
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState<number | null>(null)
  // The scene handle, kept alongside the network hook's own use of it, so the
  // menu's GRAPHICS row can retune the room running behind it.
  const sceneRef = useRef<RoomSceneHandle | null>(null)
  const net = useGameRoomNet(allPlayers)
  // The room's alternating playlist — unless the gamemaster has put one track
  // on, or stopped the music, and this is a PA screen (admin or viewer).
  usePageMusic(roomMusicRequest(net.music, me.role))
  // The wall's bulletin, from the host's prop or the gamemaster's console.
  const bulletinText = useBulletin(bulletin, net.bulletin, () => playSfx("news"))
  // The three overlay games each bring their own soundtrack, so the room's
  // playlist stops for them.
  useEffect(() => {
    if (!inBackrooms && !inArcade && !inDuel) return
    suspendMusic(true)
    return () => suspendMusic(false)
  }, [inBackrooms, inArcade, inDuel, suspendMusic])

  const controlling = net.myPlayerIdx !== null
  /** A mini-game is up over the room: input, rendering and the menu stand down. */
  const overlayGame = inBackrooms || inArcade || inDuel

  // Primey speaks through the room's own dialog box, the same one the plants
  // and the other characters use. Local: the hub never hears it.
  const [localDialog, setLocalDialog] = useState<GameRoomDialog | null>(null)
  const localSeq = useRef(0)
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = useCallback((name: string, text: string, ms: number) => {
    const next = { name, text, ms, seq: ++localSeq.current }
    setLocalDialog(next)
    if (localTimer.current) clearTimeout(localTimer.current)
    localTimer.current = setTimeout(
      () => setLocalDialog((open) => (open?.seq === next.seq ? null : open)),
      next.ms,
    )
  }, [])
  useEffect(() => () => { if (localTimer.current) clearTimeout(localTimer.current) }, [])

  const teamCompeting = useMemo(() => teams.map((team) => team.competing ?? true), [teams])
  const openDuel = useCallback((tableIdx: number) => {
    if (overlayGame || net.dialog) return
    const ordinal = exhibitionOrdinal(teamCompeting, tableIdx)
    if (ordinal < 0) return
    setMenuOpen(false)
    // The challenge begins at the interact press — the toast on the walk-up is
    // an invitation, and is not counted.
    const houseDeck = houseDeckForDesk(ordinal)
    track("easter_egg.duel_opened", { house: houseDeck })
    setDuel({ houseDeck, houseName: teams[tableIdx]?.name ?? "The house" })
  }, [overlayGame, net.dialog, teamCompeting, teams])

  const revealArcade = useCallback(() => {
    if (!jingleRef.current) jingleRef.current = createRoomArcadeCues(effectsVolume)
    jingleRef.current.setVolume(effectsVolume)
    jingleRef.current.unlock()
    const userId = me.id
    track("easter_egg.arcade_unlocked", { already_unlocked: arcadeVisibleRef.current })
    setArcadeUnlock({ userId })
    void Promise.resolve(onArcadeUnlock?.()).catch(() => {
      setArcadeUnlock((current) => (current?.userId === userId ? { userId, saveFailed: true } : current))
    })
    setArcadeToast(true)
  }, [effectsVolume, me.id, onArcadeUnlock])
  const revealArcadeRef = useRef(revealArcade)
  revealArcadeRef.current = revealArcade

  // The snap: hold Shift+Space and the mic listens for a finger snap; each one
  // heard dusts half the room, for this client only. The clue is scrawled on
  // the wall behind Bernard's chair in the Backrooms newsroom.
  const [thanosSnapSeq, setThanosSnapSeq] = useState(0)
  useSnapMic({
    enabled: !overlayGame && !menuOpen,
    onSnap: () => {
      track("easter_egg.thanos_snapped")
      setThanosSnapSeq((seq) => seq + 1)
    },
  })
  // One detector for both spellings: the keyboard feeds it arrows and letters
  // below, the touch pad feeds it D-pad presses and the A button.
  const konami = useMemo(() => createKonamiDetector(() => revealArcadeRef.current()), [])
  useEffect(() => { konami.reset() }, [konami, me.id])
  useEffect(() => {
    if (!arcadeToast) return
    const id = window.setTimeout(() => setArcadeToast(false), 5000)
    return () => window.clearTimeout(id)
  }, [arcadeToast])

  // Touch-first devices get the on-screen game-pad; keyboard hints only confuse
  // there, and the find-student box needs the full narrow width.
  const coarsePointer = useCoarsePointer()
  const portrait = useIsPortrait()

  const selectedTeamIdx =
    selectedPlayerIdx !== null ? allPlayers[selectedPlayerIdx]?.teamIdx ?? null : null

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (overlayGame) return
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (menuOpen) return
      // The Konami code, on a keyboard. Heard whenever the room itself has the
      // keys — arrows also walk or pan, and that is fine: the code is matched
      // against the tail of the stream, not a clean run.
      if (!e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const token = konamiTokenForKey(e.key)
        if (token) konami.push(token)
      }
      // Q quits only for spectators — for anyone walking a character it sits
      // right next to WASD, so Escape is the only exit while controlling.
      if (onExit && (e.key === "Escape" || (!controlling && (e.key === "q" || e.key === "Q")))) {
        e.preventDefault()
        onExit()
        return
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault()
        setSelectedPlayerIdx(null)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [controlling, menuOpen, overlayGame, onExit, konami])

  // dvh, not vh: on phones the URL bar overlaps the bottom of a 100vh page,
  // which is exactly where the touch controls sit.
  return (
    <>
      <div
        inert={overlayGame}
        aria-hidden={overlayGame || undefined}
        style={{
          height: "100dvh",
          background: "var(--color-ink)",
          display: "flex",
          flexDirection: "column",
          overscrollBehavior: "none",
          position: "relative",
        }}
      >
        {header}

        {/* The room owns every pixel below the header; the find-student control
            and the hint float above the canvas instead of framing it. */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <GameRoom3D
            fill
            teams={teams}
            allPlayers={allPlayers}
            selectedTeamIdx={selectedTeamIdx}
            selectedPlayerIdx={selectedPlayerIdx}
            board={board}
            bulletin={bulletinText}
            onPlayerSelect={setSelectedPlayerIdx}
            localControlActive={controlling}
            localInputDisabled={menuOpen || overlayGame}
            backroomsUnlocked={net.backroomsUnlocked}
            arcadeVisible={arcadeVisible}
            thanosSnapSeq={thanosSnapSeq}
            // Unlocked on an earlier visit: the cabinet is already there, no drop-in.
            arcadeEntrance={!arcadeUnlocked}
            renderPaused={overlayGame}
            onArcadeInteract={() => {
              // Unlike the hatch, no character is needed: a spectator can click
              // the cabinet, and the fight is theirs alone either way.
              if (!arcadeVisible || overlayGame || net.dialog) return
              setMenuOpen(false)
              setArcadeToast(false)
              setInArcade(true)
            }}
            onArcadeLanded={() => jingleRef.current?.thud()}
            onTouchPadPress={(press) => {
              if (!overlayGame && !menuOpen) konami.push(press)
            }}
            onBackroomsEnter={() => {
              if (!controlling || !net.backroomsUnlocked || net.dialog || overlayGame) return
              setMenuOpen(false)
              setInBackrooms(true)
            }}
            onSceneReady={(handle) => {
              sceneRef.current = handle
              net.onSceneReady(handle)
            }}
            onSelfState={net.onSelfState}
            onInteract={net.onInteract}
            onTableInteract={(tableIdx) => {
              // A white desk deals you in — unannounced, it is an easter egg;
              // the exhibition team's menu entry is still a menu key away.
              if (tableInteractAction(teams, tableIdx) === "duel") {
                openDuel(tableIdx)
                return
              }
              setFocusTeamIdx(tableIdx)
              setMenuOpen(true)
            }}
            onPrimeyInteract={() => {
              // The site this came from opened an LLM chat panel here. The
              // library ships no model, so Primey says hello through the room's
              // own dialog box and a host that has one opens it from here.
              say("PRIMEY", "Hey! Walk up to a desk and press E to meet a team.", PRIMEY_DIALOG_MS)
            }}
            onMenuToggle={!coarsePointer ? () => setMenuOpen((open) => !open) : undefined}
          />

          {!overlayGame && (
            <GameRoomMenu
              data={menu}
              open={menuOpen}
              onOpenChange={(open) => {
                setMenuOpen(open)
                // Closing releases the desk, so opening the menu by hand next
                // time is about your own team again.
                if (!open) setFocusTeamIdx(null)
              }}
              showTrigger={coarsePointer}
              touchControlsVisible={coarsePointer}
              teams={teams}
              focusTeamIdx={focusTeamIdx}
              onGraphicsChange={(preference) => sceneRef.current?.setQualityPreference?.(preference)}
            />
          )}

          {coarsePointer && (
            <div
              data-testid="game-room-controls-label"
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 11,
                // Leave the find-student box its top-right corner: the hint
                // wraps rather than sliding underneath it on a narrow phone.
                boxSizing: "border-box",
                maxWidth: "calc(100% - 310px)",
                padding: "6px 9px",
                background: "rgba(2, 5, 16, 0.9)",
                border: "2px solid #5070E0",
                boxShadow: "4px 4px 0 #000",
                fontFamily: "var(--font-display)",
                fontSize: 9,
                color: "#9AA4D4",
                letterSpacing: "0.06em",
                lineHeight: 1.6,
                pointerEvents: "none",
              }}
            >
              &gt; {controlling ? "D-PAD WALKS · A TALKS" : "TAP A TABLE OR CHARACTER · DRAG PANS · PINCH ZOOMS"}
            </div>
          )}

          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 11, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: "min(280px, calc(100vw - 20px))" }}>
              <StudentSelector
                players={allPlayers}
                value={selectedPlayerIdx}
                onChange={setSelectedPlayerIdx}
                placeholder="Find someone..."
              />
            </div>
          </div>

          {(arcadeToast || (arcadeUnlock?.userId === me.id && arcadeUnlock.saveFailed)) && (
            <RoomToast>
              {arcadeUnlock?.userId === me.id && arcadeUnlock.saveFailed
                ? "ARCADE OPEN FOR THIS VISIT · SAVE FAILED — RE-ENTER THE CODE TO RETRY"
                : "★ AN ARCADE CABINET APPEARED"}
            </RoomToast>
          )}
          {!overlayGame && (
            <GameRoomDialogBox
              // A conversation with another person wins: Primey can wait.
              dialog={net.dialog ?? localDialog}
              onDismiss={net.dialog ? net.dismissDialog : () => setLocalDialog(null)}
            />
          )}
          <GameRoomChatPanel
            log={net.chatLog}
            canChat={controlling && net.connected && !overlayGame}
            onSend={net.sendChat}
          />
        </div>

        {/* The room keeps running behind the gate, so turning the phone drops
            straight into it. */}
        {coarsePointer && portrait && <RotateToLandscape />}
      </div>

      <BackroomsPortal active={inBackrooms} hideKonamiHint={arcadeVisible} onExit={() => setInBackrooms(false)} />
      <ArcadePortal
        active={inArcade}
        volume={effectsVolume}
        music={{ volume: musicVolume, muted: musicMuted }}
        onExit={() => setInArcade(false)}
      />
      <DuelPortal
        active={inDuel}
        houseDeck={duel?.houseDeck ?? "bulls"}
        houseName={duel?.houseName ?? ""}
        volume={effectsVolume}
        onExit={() => setDuel(null)}
        onWin={(houseDeck) => onDuelWin?.(houseDeck)}
      />
    </>
  )
}

export default GameRoom
