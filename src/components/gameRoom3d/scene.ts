// HD-2D ("Octopath Traveller"-style) renderer for the game room.
// Real 3D diorama — perspective camera, warm point-light pools, fog,
// vignette and grain — with the existing pixel-art character sheets
// billboarded inside it. Layout comes from the shared 2D room plan: table
// positions (PARTICIPANT_TABLES, px-space) mapped into world units (1 unit =
// 1 tile = 16 px).
import { logger } from "~/lib/logger"
import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { CW, CH, TILE, WALL_Y, PARTICIPANT_TABLES } from "../gameRoom/constants"
import { CHAR_COUNT, characterSheetUrl } from "../gameRoom/assets"
import {
    characterIdForPlayer,
    resolveSprite,
    sheetFormatFor,
    type SheetFormat,
    type WalkDir,
} from "../gameRoom/spriteIndex"
import {
    buildStaticColliders,
    facingForInput,
    movePlayer,
    PLAYER_SPEED_PX_PER_STEP,
    type ProbeCandidate,
} from "../../lib/gameRoomNet/collision"
import { seedWander, stepWander, WALK_SPEED } from "../../lib/gameRoomNet/wander"
import { OBJECT_IDX_BASE, ROOM_OBJECTS, roomObjectByIdx } from "../../lib/gameRoomNet/objects"
import { resolveRoomInteract, type RoomInteractTarget } from "../../lib/gameRoomNet/tables"
import {
    PRIMEY_IDX,
    PRIMEY_POINT,
    PRIMEY_STRIP,
    primeyCenterY,
    primeyFrameOffset,
    primeyPlaneSize,
} from "./primey-npc"
import { crownsFor, type Crown, type CrownRole } from "./crowns"
import { roomTitle } from "./room-branding"
import { CROWN_SPRITE_PX, drawCrown } from "./crown-sprites"
import type { ExLeaderboardRow } from "../../lib/exchange-types"
import {
    BIG_SCREEN_IDX,
    BIG_SCREEN_POINT,
    boardRows,
    boardTitle,
    isBoardPage,
    nextScreenPage,
    prevScreenPage,
    TEXT_GAIN,
    TEXT_GOLD,
    TEXT_LOSS,
    pageDwellMs,
    SCREEN_PAGES,
    availableScreenPages,
    type ScreenBoardRow,
    type ScreenPage,
} from "./screen-pages"
import type { RoomSelection } from "../gameRoom/InfoPanel"
import { resolveRoomDrop, roomDragHighlightState, roomDragPlayerHover, type RoomDrop } from "./assignment-drag"
import {
    CHARACTER_SCALE,
    characterGroundY,
    characterPlaneSize,
    characterShadowLocalY,
    characterTopY,
    NOMINAL_CHARACTER_TOP_Y,
} from "./character-scale"
import { assignmentSceneLayout, lobbyPosition } from "./scene-layout"
import { createBackdrop } from "./backdrop"
import { createBackroomsHatch, maskHatchOpening } from "./backrooms-hatch"
import { ARCADE_IDX, ARCADE_POINT, createArcadeCabinet } from "./arcade-cabinet"
import { createArcadeReveal, REVEAL, type ArcadeReveal } from "./arcade-reveal"
import {
    advanceNightBlend,
    mixPalette,
    NIGHT_SHOW_MINUTE,
    nightBlendTarget,
    parseTimeOverride,
    sgtMinutes,
    skyPalette,
} from "./time-of-day"
import {
    createFireworks,
    fireworksCueFor,
    launchVolley,
    MAX_SPARKS,
    stepFireworks,
    victoryMusicFor,
    volleyForPlace,
} from "./fireworks"
import {
    podiumByTeamIdx,
    podiumLabel,
    winnersBoard,
    type RoomWinners,
    type WinnersBoard,
} from "~/lib/winners-ceremony"
import {
    EMPTY_TABLE_LABEL,
    isExhibitionDesk,
    tableLegColorForCompetition,
    tableHasTeam,
    tableLabelText,
    tableTopColorForCompetition,
} from "./team-tables"
import { rankNumeralCells, rankNumeralColor, rankNumeralCssColor } from "./rank-numerals"
import {
    PRESENTATION_COLOR,
    PRESENTATION_CSS_COLOR,
    PRESENTATION_DONE_COLOR,
    PRESENTATION_DONE_CSS_COLOR,
    houseDimGoal,
    isDeskDone,
    ordinal,
    presentationBoard,
    presentationSlotsByTeamIdx,
    revealProgress,
    type PresentationBoard,
    type RoomPresentation,
} from "~/lib/presentation-order"
import { PresentationAudioPlayer } from "./presentation-audio"
import { eventStarted, screenLines, type ScreenCountdown, type SessionClockSnapshot } from "./session-screen"
import { marketNewsHeader, type MarketNews, type MarketNewsClip } from "./useMarketNews"
import { broadcastFitRect, broadcastWorldRect } from "./market-news-video"
import {
    BroadcastPicturePass,
    applyBroadcastPictureShader,
    broadcastPictureUniforms,
} from "./broadcast-picture"
import { advanceSimClock } from "./sim-clock"
import {
    clampRoomCameraPan,
    followRoomCameraPan,
    isDragPan,
    panFromDrag,
    ROOM_CAMERA_MAX_PAN_SOUTH,
    type RoomCameraPan,
} from "./camera-pan"
import {
    advanceScreenFocus,
    blendCameraPose,
    screenFocusHidesRoom,
    screenFocusKeyAction,
    screenFocusPose,
    BROADCAST_FOCUS_PADDING,
    type CameraPose,
    type ScreenFocusKeyAction,
} from "./screen-focus"
import { pickNearestToPoint, pinchZoom } from "./touch-controls"
import { FACING_CAMERA, walkPos } from "./walk-path"
import { roleHaloColor, type RoomRole } from "./role-colors"
import { createRoomLocalInput, type RoomMoveDirection } from "./local-input"
import { parseNoclipOverride } from "./noclip"
import { chooseSnapped, createSnapDissolve, type SnapDissolve } from "./thanos-snap"
import {
    createFrameBudgetWatcher,
    deskLightPlan,
    detectQualitySignals,
    nextTierDown,
    parseQualityOverride,
    pinnedGraphicsTier,
    qualitySettings,
    resolveQualityTier,
    type FrameBudgetWatcher,
    type GraphicsPreference,
    type QualitySettings,
    type QualityTier,
} from "./quality-tier"

export interface RoomPlayerInput {
    name: string
    role?: RoomRole
    teamIdx: number | null
    seatIdx: number
    lobbyOrdinal?: number | null
    playerIdx: number
    draggable: boolean
    /** Admin-assigned sprite override (users.sprite_id); null/absent = derived hash. */
    spriteId?: number | null
    /** Generated 4×4 sheet (users.sprite_sheet, PNG data URL); drawn only while spriteId = CUSTOM_SPRITE_ID. */
    spriteSheet?: string | null
}

/** A character position pushed from the multiplayer hub, room-plan px. */
export interface RoomNetState {
    playerIdx: number
    x: number
    y: number
    dir: WalkDir
    moving: boolean
    live: boolean
}

/**
 * An idle character's wander state, handed over by the hub for this client to
 * step locally: the hub does not stream characters nobody is controlling.
 */
export interface RoomWanderState {
    playerIdx: number
    phase: number
    speed: number
    pauseLeft: number
    rng: number
}

/** The local player's own state, reported back up to the hub. Room-plan px. */
export interface RoomSelfState {
    x: number
    y: number
    dir: WalkDir
    moving: boolean
}

export interface CreateRoomOptions {
    players: RoomPlayerInput[]
    teamLabels: string[]
    /** Whether each desk belongs to a competing team, aligned with teamLabels. */
    teamCompeting?: readonly boolean[]
    /**
     * Each team's placing on the live leaderboard, aligned with teamLabels. A
     * team with no placing yet (or no exchange result at all) is null and gets
     * no numeral — see lib/team-ranks.ts.
     */
    teamRanks?: readonly (number | null)[]
    interactionMode?: "select" | "assign"
    onPick?: (pick: RoomSelection) => void
    onPlayerHover?: (playerIdx: number | null) => void
    onDrop?: (drop: RoomDrop) => void
    /** Dragging the floor moves the camera; this reports where it ended up. */
    onCameraPan?: (pan: RoomCameraPan) => void
    /** A pinch zoomed the camera; this keeps the viewport's zoom state (and so
     * the +/− buttons and wheel) carrying on from where the fingers left it. */
    onCameraZoom?: (zoom: number) => void
    /** The local player's character moved/turned (throttled to ~10 Hz). */
    onSelfState?: (state: RoomSelfState) => void
    /** The local player pressed interact while facing this character. */
    onInteract?: (targetPlayerIdx: number) => void
    /** The local player pressed interact while facing this team's desk. Unlike
     * onInteract this never reaches the hub — it opens local UI, broadcasts
     * nothing and freezes nobody. */
    onTableInteract?: (tableIdx: number) => void
    /** The local player pressed interact while facing Primey. Local UI only —
     * the chat is one visitor's, so like the desks this never reaches the hub. */
    onPrimeyInteract?: () => void
    onBackroomsEnter?: () => void
    /** The local player pressed interact while facing the arcade cabinet (or
     * clicked it). Local UI only — the cabinet exists in this client's scene
     * alone, so this never reaches the hub. */
    onArcadeInteract?: () => void
    /** The cabinet just hit the floor in its entrance — a cue for the thud. */
    onArcadeLanded?: () => void
    /**
     * Pin the rendering tier instead of measuring the device. A `?quality=`
     * search param beats this, and both beat auto-detection; the runtime
     * frame-budget watcher is disabled entirely whenever a tier is pinned,
     * because a pin is a deliberate instruction and not a starting guess.
     */
    quality?: QualityTier
    /** The tier changed — either resolved at build, or dropped mid-session
     * because the room could not hold its frame budget. */
    onQualityChange?: (tier: QualityTier) => void
}

export interface RoomSceneHandle {
    setSelection(teamIdx: number | null, playerIdx: number | null): void
    /** Standings moved: the floating numeral over each desk, by team index. */
    setTeamRanks(ranks: readonly (number | null)[]): void
    setCameraPan(x: number, z: number): void
    setCameraZoom(zoom: number): void
    setPlayerLobbyOrdinal?(playerIdx: number, lobbyOrdinal: number | null): void
    setPlayerTeam(playerIdx: number, teamIdx: number | null, animate?: boolean): void
    setPlayerBusy(playerIdx: number, busy: boolean): void
    /** Hub-driven positions for remote characters (the local player is skipped). */
    setNetStates(states: readonly RoomNetState[]): void
    /** Idle characters, with the wander state to run them from locally. Each
     * one stops following the hub and orbits its table from this state. */
    setWanderStates(states: readonly RoomWanderState[]): void
    /** Hand keyboard control of a character to this client (null releases it). */
    setLocalPlayer(playerIdx: number | null, start?: { x: number; y: number }): void
    /** Disable local movement and interaction without stopping the scene or
     * network. Disabling also releases any movement that is already held. */
    setLocalInputDisabled(disabled: boolean): void
    setBackroomsUnlocked?(unlocked: boolean): void
    /** Show or hide the Konami-code arcade cabinet beside Primey. Private to
     * this client; built on first reveal, which plays the drop-in entrance
     * unless `entrance` is false (already unlocked on an earlier visit). */
    setArcadeVisible?(visible: boolean, entrance?: boolean): void
    /** Show or hide Primey. Hidden, it is neither drawn nor an interact target
     * (a student's room before the doors open has no Primey). */
    setPrimeyVisible?(visible: boolean): void
    /** Half of the other characters, at random, crumble to dust. Private to
     * this client and forgotten on reload — nothing reaches the hub. Snapping
     * again takes half of whoever is left. */
    thanosSnap?(): void
    setRenderPaused?(paused: boolean): void
    /** A speech bubble above a character (an interact introduction landing). */
    showSpeech(playerIdx: number, text: string): void
    /** A speech bubble above an interactable object (OBJECT_IDX_BASE-keyed). */
    showObjectSpeech(objectIdx: number, text: string): void
    /** What the wall screen's clock page counts down: the running trading
     * window's clock, or null for the countdown to launch day. */
    setSessionClock(session: SessionClockSnapshot | null): void
    /** What the clock page counts to with no window running: the doors before
     * they open, or null for launch day. */
    setCountdown(countdown: ScreenCountdown | null): void
    /** A public market bulletin temporarily taking over the wall screen. */
    setMarketNews(news: MarketNews | null): void
    /**
     * Pin the wall screen to one page for the whole room, or null to hand it
     * back to the players.
     *
     * While a page is pinned it is ABSOLUTE: neither the dwell cycle, an
     * interact press, nor the countdown's own takeovers move off it. The
     * gamemaster took the wall deliberately and has a RELEASE button; a wall
     * that quietly turned itself back would be the worse surprise.
     */
    setForcedScreenPage(page: ScreenPage | null): void
    /**
     * The presentation running order the gamemaster drew, by desk, or null.
     *
     * The room goes dark and a spotlight sweeps the desks in order — as it
     * lands, that desk's numeral becomes its presentation slot rather than its
     * placing, and the wall screen fixes on the order. A spotlit team is lit
     * alone. The sweep replays from the state's own clock, so a room that
     * arrives late shows the finished board rather than a private reveal.
     */
    setPresentation(presentation: RoomPresentation | null): void
    /**
     * The winners' ceremony, by desk, or null.
     *
     * The room turns to the wall — the same framed view a bulletin takes — and
     * the sky falls to night if it is not already. The wall shows the podium as
     * it is read; each place hangs its medal over the team's desk and fires a
     * volley of fireworks over the city beyond the front wall, the winner's
     * being the finale. The standings' numerals are taken down for the
     * duration, so the desks cannot give the podium away before it is read.
     */
    setWinners(winners: RoomWinners | null): void
    /** The fixed room-PA audio settings, pushed in because the scene has no React context. */
    setNewsAudio(settings: { muted: boolean; volume: number }): void
    /** Latest standings for the wall screen's leaderboard page (empty = none yet). */
    setLeaderboard(rows: readonly ExLeaderboardRow[]): void
    /** Lock the local player's movement for a conversation; optionally turn
     * them to face their dialog partner. */
    freezeLocalInput(ms: number, faceDir?: WalkDir): void
    /** A connected visitor with no seat on the map: add their transient
     * character (idempotent; sprite decode may land it a frame later). */
    upsertGuest(guest: {
        playerIdx: number
        name: string
        role?: RoomRole
        spriteId?: number | null
        spriteSheet?: string | null
        start?: { x: number; y: number }
    }): void
    /** The visitor left — their character disappears. */
    removeGuest(playerIdx: number): void
    /** Touch D-pad: hold or release one of the local character's movement
     * inputs — the same state the WASD keys drive. */
    setMoveInput(direction: "up" | "down" | "left" | "right", active: boolean): void
    /** Touch interact button — the same facing probe as the Space key. */
    interact(): void
    /** What a spectator's touch interact button lands on: the character or
     * table nearest the centre of the view. */
    pickNearCenter(): RoomSelection
    /**
     * Retune the live scene from the player's GRAPHICS choice, without a
     * rebuild — the game-room menu sits over a running room, so the change has
     * to be visible on the next frame rather than on the next visit.
     *
     * `"auto"` hands the decision back to device detection and re-arms the
     * frame-budget watcher; any tier pins it and stands the watcher down.
     */
    setQualityPreference(preference: GraphicsPreference): void
    dispose(): void
}

// ---------------------------------------------------------------- constants

const ROOM_W = CW / TILE // 50 units wide
const ROOM_D = (CH - WALL_Y) / TILE // ~52 units deep
const WALL_H = 13
/**
 * The desk rows (px), north to south. Rugs run in the aisles between them and
 * the warm ceiling pools sit over them, so both follow the plan wherever the
 * rows move — the room plan is the one place the grid is written down.
 */
const TABLE_ROWS = [...new Set(PARTICIPANT_TABLES.map((t) => t.y))]
    .sort((a, b) => a - b)
    .map((y) => {
        const h = PARTICIPANT_TABLES.find((t) => t.y === y)!.h
        return { top: y, bottom: y + h, center: y + h / 2 }
    })

/** The desk columns' centres (px), west to east — one ceiling pool each. */
const TABLE_COL_CENTERS = [
    ...new Set(PARTICIPANT_TABLES.map((t) => t.x + t.w / 2)),
].sort((a, b) => a - b)
/**
 * How far north of the front wall the tower's floor slab runs.
 *
 * Nothing is built out there any more — the front wall is solid screen from
 * the floor up, so a room behind it was polygons nobody could see. The apron
 * stays because it is what the skyline rings stand off from: shrinking it
 * would walk the city several units closer to the glass.
 */
const NORTH_APRON = 7.9
const toX = (px: number) => px / TILE - ROOM_W / 2
const toZ = (py: number) => (py - WALL_Y) / TILE

// ---------------------------------------------------------------- textures

function pixelTexture(tex: THREE.Texture): THREE.Texture {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

function makeCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const ctx = c.getContext("2d")!
    draw(ctx)
    const tex = new THREE.CanvasTexture(c)
    return pixelTexture(tex) as THREE.CanvasTexture
}

// deterministic tiny PRNG so the floor/wood noise is stable
function mulberry(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A soft round spot for the fireworks' sparks: bright core, feathered edge. */
function makeSparkTexture(): THREE.CanvasTexture {
    const size = 32
    const c = document.createElement("canvas")
    c.width = c.height = size
    const ctx = c.getContext("2d")!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.35, "rgba(255,255,255,0.7)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

function makeCarpetTexture(): THREE.CanvasTexture {
    const rnd = mulberry(7)
    const tones = ["#63666c", "#6a6d73", "#5e6167", "#666a70"]
    const tex = makeCanvasTexture(128, 128, (ctx) => {
        // grey carpet tiles with fibre speckle
        for (let ty = 0; ty < 4; ty++) {
            for (let tx = 0; tx < 4; tx++) {
                ctx.fillStyle = tones[Math.floor(rnd() * tones.length)]!
                ctx.fillRect(tx * 32, ty * 32, 32, 32)
                ctx.fillStyle = "rgba(0,0,0,0.16)"
                ctx.fillRect(tx * 32, ty * 32, 32, 1)
                ctx.fillRect(tx * 32, ty * 32, 1, 32)
                for (let i = 0; i < 170; i++) {
                    ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.09)"
                    ctx.fillRect(tx * 32 + Math.floor(rnd() * 32), ty * 32 + Math.floor(rnd() * 32), 1, 1)
                }
            }
        }
    })
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(ROOM_W / 8, ROOM_D / 8)
    return tex
}

function makeRugTexture(): THREE.CanvasTexture {
    return makeCanvasTexture(128, 64, (ctx) => {
        ctx.fillStyle = "#1a2350"
        ctx.fillRect(0, 0, 128, 64)
        ctx.strokeStyle = "#c8a040"
        ctx.lineWidth = 2
        ctx.strokeRect(4, 4, 120, 56)
        ctx.strokeStyle = "#2c3a78"
        ctx.strokeRect(9, 9, 110, 46)
        const rnd = mulberry(21)
        for (let i = 0; i < 220; i++) {
            ctx.fillStyle = "rgba(0,0,0,0.14)"
            ctx.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 64), 1, 1)
        }
    })
}

/**
 * The brightest any text in the room is allowed to be drawn.
 *
 * Pure white (#FFFFFF) made the wall screen's headline, the team names and
 * the floating name tags read as lit signage rather than lettering. This
 * off-white sits near 0.67 linear luminance, so text is drawn and not lit.
 */
const TEXT_BRIGHT = "#CBD6EC"

function makeLabelTexture(label: string, gold: boolean, muted = false): THREE.CanvasTexture {
    return makeCanvasTexture(160, 44, (ctx) => {
        ctx.fillStyle = muted ? "rgba(4,8,24,0.5)" : "rgba(4,8,24,0.88)"
        ctx.fillRect(0, 0, 160, 44)
        ctx.strokeStyle = gold ? "#FFD040" : muted ? "#26325A" : "#3050c8"
        ctx.lineWidth = 3
        ctx.strokeRect(2, 2, 156, 40)
        ctx.font = "bold 20px 'Courier New', monospace"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = gold ? "#FFD040" : muted ? "#6C77A6" : "#cfdaff"
        ctx.fillText(label, 80, 23)
    })
}

function makeNameTagTexture(name: string): THREE.CanvasTexture {
    const label = (name.split(" ")[0] ?? name).toUpperCase()
    return makeCanvasTexture(256, 64, (ctx) => {
        ctx.font = "bold 26px 'Courier New', monospace"
        const tw = Math.min(210, ctx.measureText(label).width)
        const bw = tw + 44
        const x0 = (256 - bw) / 2
        ctx.fillStyle = "rgba(4,8,24,0.92)"
        ctx.fillRect(x0, 10, bw, 42)
        ctx.strokeStyle = "#3050c8"
        ctx.lineWidth = 3
        ctx.strokeRect(x0, 10, bw, 42)
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = TEXT_BRIGHT
        ctx.fillText(label, 128, 33, 210)
    })
}

function makeSpeechTexture(text: string): THREE.CanvasTexture {
    const W = 384, H = 112
    return makeCanvasTexture(W, H, (ctx) => {
        ctx.font = "bold 21px 'Courier New', monospace"
        // Greedy word wrap into at most three lines; anything longer is elided.
        const words = text.split(/\s+/)
        const lines: string[] = []
        let line = ""
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word
            if (ctx.measureText(candidate).width <= W - 48 || !line) {
                line = candidate
                continue
            }
            lines.push(line)
            line = word
            if (lines.length === 3) break
        }
        if (lines.length < 3 && line) lines.push(line)
        else if (line && lines[2]) lines[2] = `${lines[2]}…`

        const boxH = 26 * lines.length + 18
        const boxY = H - 14 - boxH
        ctx.fillStyle = "rgba(4,8,24,0.94)"
        ctx.fillRect(10, boxY, W - 20, boxH)
        ctx.strokeStyle = "#FFD040"
        ctx.lineWidth = 3
        ctx.strokeRect(12, boxY + 2, W - 24, boxH - 4)
        // the little tail that points the bubble at its speaker
        ctx.fillStyle = "#FFD040"
        ctx.beginPath()
        ctx.moveTo(W / 2 - 9, H - 14)
        ctx.lineTo(W / 2 + 9, H - 14)
        ctx.lineTo(W / 2, H - 2)
        ctx.closePath()
        ctx.fill()
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = TEXT_BRIGHT
        lines.forEach((l, i) => {
            ctx.fillText(l, W / 2, boxY + 22 + i * 26, W - 56)
        })
    })
}

function makeHighlightTexture(): THREE.CanvasTexture {
    return makeCanvasTexture(128, 128, (ctx) => {
        ctx.strokeStyle = "#FFD040"
        ctx.lineWidth = 5
        ctx.strokeRect(6, 6, 116, 116)
        ctx.strokeStyle = "rgba(255,208,64,0.35)"
        ctx.lineWidth = 12
        ctx.strokeRect(12, 12, 104, 104)
    })
}

// ---------------------------------------------------------------- screen

// The wall-spanning screen: canvas keeps the plane's ~4:1 aspect at a
// resolution where the countdown digits survive the bigger surface.
const SCREEN_TEX_W = 1920
const SCREEN_TEX_H = 468

/**
 * How far down the canvas the readable content may run.
 *
 * The screen reaches the roof, but its bottom edge runs down behind the
 * surround's plinth and the near rows of the room, so anything below this
 * line is read by nobody. Everything legible lives above it; the band
 * underneath is deliberately empty panel.
 */
const SCREEN_CONTENT_BOTTOM = 330

/**
 * @param broadcast whether a filmed picture is up on the wall IN FRONT of this
 * canvas — see the broadcast picture quad in createRoomScene. The canvas then
 * paints only the panel and its border for the picture to sit on, and is not
 * touched again until the clip ends: the picture drives its own texture.
 */
function drawScreenCanvas(
    ctx: CanvasRenderingContext2D,
    page: ScreenPage,
    board: readonly ScreenBoardRow[],
    session: SessionClockSnapshot | null,
    countdown: ScreenCountdown | undefined,
    marketNews: MarketNews | null,
    broadcast = false,
    presentation: PresentationBoard | null = null,
    winners: WinnersBoard | null = null,
) {
    const W = SCREEN_TEX_W, H = SCREEN_TEX_H
    ctx.fillStyle = "#020510"
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = "#3050c8"
    ctx.lineWidth = 8
    ctx.strokeRect(8, 8, W - 16, H - 16)
    ctx.textAlign = "center"
    if (marketNews) {
        // A filmed broadcast is the whole screen. The clip opens on its own titles
        // and the anchor says the headline out loud, so a banner and a wall of
        // text beside it would only be the same news twice. The picture itself is
        // a separate quad over this panel; all the canvas owes it is the black
        // and the border already painted above.
        if (broadcast) return

        // One header line. The wall used to carry a BREAKING MARKET NEWS bar over
        // a MARKET BULLETIN subtitle, which was written when the only thing that
        // could reach this screen was a scripted market event. The gamemaster now
        // types "lunch is in the atrium" through the same path, and crying
        // breaking news over it was absurd — so the header is generic unless the
        // server has said this bulletin is a scripted event with no film.
        ctx.fillStyle = "#A51F32"
        ctx.fillRect(12, 12, W - 24, 88)
        ctx.fillStyle = "#FFF4F4"
        ctx.font = "bold 56px 'Courier New', monospace"
        ctx.fillText(marketNewsHeader(marketNews), W / 2, 75)

        ctx.fillStyle = TEXT_BRIGHT
        ctx.font = "bold 46px 'Courier New', monospace"
        const words = marketNews.message.split(/\s+/).filter(Boolean)
        const lines: string[] = []
        for (const word of words) {
            const at = lines.length - 1
            const candidate = at < 0 ? word : `${lines[at]} ${word}`
            if (at < 0 || ctx.measureText(candidate).width > W - 180) lines.push(word)
            else lines[at] = candidate
        }
        const visible = lines.slice(0, 3)
        if (lines.length > visible.length && visible.length > 0) {
            visible[visible.length - 1] = `${visible[visible.length - 1]!.replace(/[.…]+$/, "")}…`
        }
        // Raised from 202: that start allowed for the subtitle line that used to
        // sit at 143. Three lines from here still finish above SCREEN_CONTENT_BOTTOM.
        visible.forEach((line, index) => ctx.fillText(line, W / 2, 175 + index * 60, W - 180))
        return
    }
    // The podium outranks everything but a bulletin: once the ceremony starts
    // the wall has one job until it ends.
    if (winners) {
        drawWinnersPage(ctx, winners)
        return
    }
    // The running order outranks every page and the pin: presentations are the
    // one part of the day the wall has nothing else to say about. A bulletin
    // still takes it — "five minutes to lunch" matters mid-presentation too.
    if (presentation) {
        drawPresentationPage(ctx, presentation)
        return
    }
    if (isBoardPage(page)) drawLeaderboardPage(ctx, page, board)
    else if (drawCountdownPage(ctx, session, countdown)) return // the final minute owns the whole panel
    drawScreenSkirt(ctx, page)
}

/**
 * The podium, as three blocks in the classic arrangement — second, first,
 * third — each wearing its medal colour, with the team's name over it once
 * that place has been read and a "?" until then. The title turns to
 * congratulations once the winner is up.
 */
function drawWinnersPage(ctx: CanvasRenderingContext2D, board: WinnersBoard) {
    const W = SCREEN_TEX_W
    ctx.fillStyle = board.complete ? "rgba(255,210,74,0.12)" : "rgba(40,64,168,0.14)"
    ctx.fillRect(12, 12, W - 24, SCREEN_CONTENT_BOTTOM + 40)
    ctx.fillStyle = rankNumeralCssColor(1)
    ctx.font = "bold 60px 'Courier New', monospace"
    ctx.fillText(board.complete ? "★ CONGRATULATIONS ★" : "◆ AND THE WINNERS ARE ◆", W / 2, 84)

    // Left to right: 2nd, 1st, 3rd — the way a podium stands.
    const columns: Array<{ place: 1 | 2 | 3; cx: number; blockH: number }> = [
        { place: 2, cx: W * 0.25, blockH: 96 },
        { place: 1, cx: W * 0.5, blockH: 132 },
        { place: 3, cx: W * 0.75, blockH: 70 },
    ]
    const blockW = W * 0.22
    const floor = SCREEN_CONTENT_BOTTOM + 6
    for (const column of columns) {
        const entry = board.entries.find((candidate) => candidate.place === column.place)!
        const color = rankNumeralCssColor(column.place)
        const top = floor - column.blockH
        ctx.fillStyle = entry.label ? color : "rgba(42,58,120,0.55)"
        ctx.fillRect(column.cx - blockW / 2, top, blockW, column.blockH)
        ctx.fillStyle = entry.label ? "#020510" : "#2A3A78"
        ctx.font = "bold 44px 'Courier New', monospace"
        ctx.fillText(ordinal(column.place), column.cx, top + column.blockH / 2 + 16)
        if (entry.label) {
            ctx.fillStyle = TEXT_BRIGHT
            ctx.font = "bold 40px 'Courier New', monospace"
            ctx.fillText(entry.label, column.cx, top - 22, blockW - 16)
            ctx.fillStyle = color
            ctx.font = "bold 24px 'Courier New', monospace"
            ctx.fillText(podiumLabel(column.place), column.cx, top - 66)
        } else {
            ctx.fillStyle = "#2A3A78"
            ctx.font = "bold 52px 'Courier New', monospace"
            ctx.fillText("?", column.cx, top - 22)
        }
    }
}

/**
 * The presentation running order, or — while a team is on stage — that team.
 *
 * With a spotlight the wall is a title card: the whole room reads which team
 * is up from the back. Without one it is the order, as chips across the band:
 * up to six across in one row, two rows past that (the roster runs to a
 * dozen), each reading "?" until the sweep in the room has reached it, so the
 * wall reveals at the same pace as the desks.
 */
function drawPresentationPage(ctx: CanvasRenderingContext2D, board: PresentationBoard) {
    const W = SCREEN_TEX_W
    if (board.spotlight) {
        ctx.fillStyle = "rgba(255,106,213,0.14)"
        ctx.fillRect(12, 12, W - 24, SCREEN_CONTENT_BOTTOM + 40)
        ctx.fillStyle = PRESENTATION_CSS_COLOR
        ctx.font = "bold 56px 'Courier New', monospace"
        ctx.fillText("◆ NOW PRESENTING ◆", W / 2, 84)
        ctx.fillStyle = TEXT_BRIGHT
        ctx.font = "bold 132px 'Courier New', monospace"
        ctx.fillText(board.spotlight.label, W / 2, 228, W - 160)
        ctx.fillStyle = "#A0B8FF"
        ctx.font = "48px 'Courier New', monospace"
        ctx.fillText(`${ordinal(board.spotlight.slot)} OF ${board.entries.length}`, W / 2, 306)
        if (board.doneCount > 0) {
            ctx.fillStyle = PRESENTATION_DONE_CSS_COLOR
            ctx.font = "bold 34px 'Courier New', monospace"
            ctx.textAlign = "right"
            ctx.fillText(`${board.doneCount}/${board.total} DONE`, W - 100, 84)
            ctx.textAlign = "center"
        }
        return
    }

    ctx.fillStyle = PRESENTATION_CSS_COLOR
    ctx.font = "bold 72px 'Courier New', monospace"
    ctx.fillText("◆ PRESENTATION ORDER ◆", W / 2, 100)
    // How far down the order the afternoon has got, once it has started —
    // before the first team is marked off there is no progress to report.
    if (board.doneCount > 0) {
        ctx.fillStyle = PRESENTATION_DONE_CSS_COLOR
        ctx.font = "bold 40px 'Courier New', monospace"
        ctx.textAlign = "right"
        ctx.fillText(`${board.doneCount}/${board.total} DONE`, W - 100, 100)
        ctx.textAlign = "center"
    }
    ctx.fillStyle = "#2840A8"
    ctx.fillRect(90, 132, W - 180, 5)

    const entries = board.entries
    if (entries.length === 0) return
    const perRow = entries.length <= 6 ? entries.length : Math.ceil(entries.length / 2)
    const rows = entries.length <= 6 ? 1 : 2
    const chipW = (W - 160) / perRow
    const rowY = rows === 1 ? [232] : [200, 292]
    entries.forEach((entry, i) => {
        const row = Math.floor(i / perRow)
        const col = i % perRow
        const cx = 80 + chipW * (col + 0.5)
        const y = rowY[row]!
        const left = cx - chipW / 2 + 6
        const w = chipW - 12
        ctx.fillStyle = entry.live
            ? "rgba(255,106,213,0.28)"
            : entry.done
                ? "rgba(47,156,90,0.18)"
                : "rgba(40,64,168,0.16)"
        ctx.fillRect(left, y - 54, w, 76)
        if (!entry.revealed) {
            // Waiting for the light: the slot is known, the team is not yet.
            ctx.fillStyle = "#2A3A78"
            ctx.font = "bold 44px 'Courier New', monospace"
            ctx.fillText("?", cx, y - 8)
            return
        }
        // A finished team is ticked and greened. The rest of the chip is
        // unchanged — the room still has to be able to read who was third.
        ctx.fillStyle = entry.done ? PRESENTATION_DONE_CSS_COLOR : PRESENTATION_CSS_COLOR
        ctx.font = "bold 40px 'Courier New', monospace"
        ctx.fillText(entry.done ? `✓ ${entry.slot}` : `${entry.slot}`, cx, y - 14)
        ctx.fillStyle = entry.done ? "#8FA8E8" : TEXT_BRIGHT
        ctx.font = "bold 30px 'Courier New', monospace"
        ctx.fillText(entry.label, cx, y + 14, w - 12)
    })
}

/**
 * The clock page: the running trading window's countdown, or — with no window
 * — the countdown to launch day. Returns true when it has taken the whole
 * panel for its final minute, which is the caller's cue to skip the skirt and
 * its page dots: a screen showing one number should not also be advertising
 * that it has another page.
 */
function drawCountdownPage(
    ctx: CanvasRenderingContext2D,
    session: SessionClockSnapshot | null,
    countdown: ScreenCountdown | undefined,
): boolean {
    const W = SCREEN_TEX_W
    const lines = screenLines(session, Date.now(), countdown)
    if (lines.solo) {
        // The last minute: nothing on the wall but the count, filling the band the
        // title and subtitle vacated. Centred on the readable band rather than sat
        // on its baseline, so it does not drift down into the dead band.
        ctx.fillStyle = lines.color
        ctx.font = "bold 280px 'Courier New', monospace"
        ctx.textBaseline = "middle"
        ctx.fillText(lines.readout, W / 2, SCREEN_CONTENT_BOTTOM / 2 + 24)
        ctx.textBaseline = "alphabetic"
        return true
    }
    ctx.fillStyle = TEXT_BRIGHT
    ctx.font = "bold 96px 'Courier New', monospace"
    ctx.fillText(roomTitle(), W / 2, 128)
    ctx.fillStyle = "#2840A8"
    ctx.fillRect(90, 166, W - 180, 5)
    // The launch date (or the window's state) rides alongside the label rather
    // than on its own bottom line, down in the dead band.
    ctx.fillStyle = "#A0B8FF"
    ctx.font = "48px 'Courier New', monospace"
    ctx.fillText(lines.subtitle, W / 2, 234)
    ctx.fillStyle = lines.color
    ctx.font = "bold 108px 'Courier New', monospace"
    ctx.fillText(lines.readout, W / 2, SCREEN_CONTENT_BOTTOM)
    return false
}

/**
 * The live leaderboard: the top teams as cards across the wide band.
 *
 * The screen is a 4:1 letterbox with only its top third legible, so the board
 * runs SIDEWAYS — five columns, not five rows. A vertical table would push
 * fourth and fifth place down into the unreadable band.
 */
function drawLeaderboardPage(
    ctx: CanvasRenderingContext2D,
    page: ScreenPage,
    board: readonly ScreenBoardRow[],
) {
    const W = SCREEN_TEX_W
    ctx.fillStyle = TEXT_GOLD
    ctx.font = "bold 72px 'Courier New', monospace"
    ctx.fillText(boardTitle(page), W / 2, 100)
    ctx.fillStyle = "#2840A8"
    ctx.fillRect(90, 132, W - 180, 5)

    if (board.length === 0) {
        ctx.fillStyle = "#A0B8FF"
        ctx.font = "56px 'Courier New', monospace"
        ctx.fillText("AWAITING FIRST TRADING WINDOW", W / 2, 250)
        return
    }

    // Five slots always, so the cards keep their places as teams come and go.
    const SLOTS = 5
    const cardW = (W - 160) / SLOTS
    board.slice(0, SLOTS).forEach((row, i) => {
        const cx = 80 + cardW * (i + 0.5)
        const left = cx - cardW / 2 + 8
        const w = cardW - 16
        // The podium gets the medal its desk numeral already wears; everyone else
        // gets the field colour, so a card and a desk never disagree about a
        // placing. Ranks are absolute, so this reads the row rather than the slot
        // — sixth place on the lower board is not a first place.
        const medal = rankNumeralCssColor(row.rank)
        ctx.fillStyle = row.rank === 1 ? "rgba(255,208,64,0.14)" : "rgba(40,64,168,0.16)"
        ctx.fillRect(left, 154, w, 182)
        // The team's own colour, as a rule along the top of its card: the same
        // swatch /results puts beside the name, so a team can be picked out of the
        // board from across the room without reading a label.
        ctx.fillStyle = row.color
        ctx.fillRect(left, 154, w, 7)
        ctx.fillStyle = medal
        ctx.font = "bold 44px 'Courier New', monospace"
        ctx.fillText(`${row.rank}`, cx, 200)
        ctx.fillStyle = TEXT_BRIGHT
        ctx.font = "bold 42px 'Courier New', monospace"
        ctx.fillText(row.label, cx, 244)
        ctx.fillStyle = row.down ? TEXT_LOSS : TEXT_GAIN
        ctx.font = "bold 48px 'Courier New', monospace"
        ctx.fillText(row.pnl, cx, 292)
        // The PnL is what teams are ranked on; the book value rides under it in
        // the quiet grey of a footnote.
        ctx.fillStyle = "#8FA8E8"
        ctx.font = "32px 'Courier New', monospace"
        ctx.fillText(row.value, cx, 324)
    })
}

/**
 * The panel below the content fades out rather than ending on a hard edge, so
 * the part down by the plinth reads as screen, not as a gap. The page dots
 * ride at the top of it — the only hint that the screen has another page,
 * placed just high enough to stay in the readable band.
 */
function drawScreenSkirt(ctx: CanvasRenderingContext2D, page: ScreenPage) {
    const W = SCREEN_TEX_W, H = SCREEN_TEX_H
    const skirt = ctx.createLinearGradient(0, SCREEN_CONTENT_BOTTOM + 24, 0, H)
    skirt.addColorStop(0, "rgba(40,64,168,0.20)")
    skirt.addColorStop(1, "rgba(4,8,24,0)")
    ctx.fillStyle = skirt
    ctx.fillRect(12, SCREEN_CONTENT_BOTTOM + 24, W - 24, H - SCREEN_CONTENT_BOTTOM - 36)
    const at = SCREEN_PAGES.indexOf(page)
    const dotGap = 34
    const x0 = W / 2 - (dotGap * (SCREEN_PAGES.length - 1)) / 2
    SCREEN_PAGES.forEach((_, i) => {
        ctx.fillStyle = i === at ? "#A0B8FF" : "#2A3A78"
        ctx.beginPath()
        ctx.arc(x0 + dotGap * i, SCREEN_CONTENT_BOTTOM + 46, 9, 0, Math.PI * 2)
        ctx.fill()
    })
}

// ---------------------------------------------------------------- post fx

/**
 * How much light the tone mapper lets through. Under 1 the whole frame reads
 * dimmer — the room is a lit interior at dusk, and at full exposure the floor
 * and desktops washed out to a flat glare that the warm point-light pools had
 * nothing left to stand out against.
 */
const ROOM_EXPOSURE = 0.78

// The frame's final grade. It used to be a tilt-shift — a 12-tap circular blur
// that let go of everything away from a focus band — but the miniature effect
// cost more legibility than it bought charm, so only the vignette and the grain
// remain.
const RoomGradeShader = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // gentle vignette
      vec2 vc = vUv - 0.5;
      float vig = 1.0 - smoothstep(0.42, 0.95, length(vc) * 1.18) * 0.5;
      col *= vig;
      // faint film grain keeps large flat areas alive
      col += (hash(vUv * (401.0 + fract(uTime))) - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

// ---------------------------------------------------------------- helpers

// What floats over a character, measured from the top of its head so the whole
// stack rises together when the cast is resized.
const MARKER_RISE = 0.54
const HOVER_TAG_RISE = 0.89
const SEL_TAG_RISE = 1.24
/** Area headings (team tables, the arrivals platform) float this far overhead. */
const AREA_LABEL_Y = NOMINAL_CHARACTER_TOP_Y + 0.64

// The floating rank numeral over a desk. It hangs over the middle of the
// desktop at about head height — high enough to clear the laptops, low enough
// to stay under the warm pools the room hangs over each desk row (point lights
// at y 5.4, intensity 55). Level with the name plate it was inside one of
// those pools and rendered as an orange blob rather than a placing.
/** World units per cell of the numeral's 3×5 pixel grid — see rank-numerals.ts. */
const RANK_CELL = 0.32
/** How far the block is extruded, so the numeral has real depth to turn in. */
const RANK_DEPTH = 0.24
/** Height of the numeral's centre, a head under the team's name plate. */
const RANK_NUMERAL_Y = NOMINAL_CHARACTER_TOP_Y - 0.55
/**
 * How far south of the desk's middle the numeral floats. The team's name plate
 * hangs at the same spot dead centre, so a step toward the camera puts the
 * placing clearly in FRONT of the plate instead of growing through it.
 */
const RANK_NUMERAL_Z = 1.55
/** Amplitude and pace of the hover bob. */
const RANK_BOB = 0.11
const RANK_BOB_SPEED = 1.6
/**
 * The numeral SWAYS through this many radians rather than spinning: a full
 * turn shows the camera a mirrored digit for half of every revolution, which
 * is a poor way to tell someone they are in 2nd place. A sway still catches
 * the light on the extruded sides, which is the whole point of a 3D numeral.
 */
const RANK_SWAY = 0.42
const RANK_SWAY_SPEED = 0.9

// WALK_SPEED now lives in lib/gameRoomNet/wander.ts, shared with the
// multiplayer hub so the server-side wander walks the same gait.
/** Simulation steps per sprite frame: the walk cycle at WALK_SPEED = 1. */
const WALK_FRAME_STEPS = 6
/** How far a dragged character lifts off its standing height. */
const DRAG_LIFT = 0.24
/** Peak of the hop a character makes when it moves between two seats. */
const TRANSITION_HOP = 0.7

/** How much of its colour and light an unused desk keeps — see team-tables.ts. */
const EMPTY_TABLE_FADE = 0.42

// The presentation spotlight. A real SpotLight from high over the desk — the
// room's furniture and characters are Lambert/Standard, so it lights them —
// plus a beam and a floor pool drawn as additive geometry, because a light
// alone is invisible in air and the point of a spotlight is that you see it.
/** How high over the floor the spot hangs. */
const SPOT_HEIGHT = 17
/** Radius of the pool it throws on the floor: a desk and the people at it. */
const SPOT_RADIUS = 3.2
/**
 * Candela, against SPOT_DECAY's inverse-square falloff — so what reaches the
 * desk seventeen units below is 900/17², a few times the desk pools' own
 * 34/5.4². Bright enough to be the brightest thing in the room, and nothing
 * like the 45× it was throwing while the falloff was linear.
 */
const SPOT_INTENSITY = 900
/**
 * Inverse square, like every other light the room hangs.
 *
 * It was linear, which is what made the reveal wash out: a fixture this
 * powerful with a 42-unit reach and no real falloff was not lighting one desk,
 * it was lighting the whole room from above — the pool blew out to flat white.
 */
const SPOT_DECAY = 2
/** How dark the house goes: 1 would be black, and the brief was "still a bit
 * visible" — the room stays legible, the spotlight just owns it. */
const ROOM_DIM_DEPTH = 0.86
/** How far down the house lights go for the winners' ceremony (0..1). */
const WINNERS_HOUSE_DIM = 0.5
/**
 * How recently a place must have been read for a screen to fire its volley.
 * A tab that connects a minute into the ceremony shows the podium as it
 * stands rather than replaying every burst the room has already seen.
 */
const VOLLEY_REPLAY_WINDOW_MS = 15_000
/** How fast the house lights fade, per second (exponential approach). */
const ROOM_DIM_RATE = 3.2
/** How fast the spot slides between desks, per second. Snappy: a light that
 * drifts reads as a search, and this one knows where it is going. */
const SPOT_SLIDE_RATE = 7
/** A desk numeral pops in over this long when the spotlight lands on it. */
const NUMERAL_POP_MS = 420
/** The screen's glow into the room, at full house lights. */
const SCREEN_GLOW_INTENSITY = 34

/**
 * Baseline for measuring how far the floor moves per pixel of pointer travel.
 * Wide enough that the two sample rays are not fighting float precision, and
 * the reading stays good for the whole drag: sliding the camera parallel to
 * the floor changes neither its height nor its angle, so the scale holds.
 */
const PAN_PROBE_PX = 100

interface CharState {
    mesh: THREE.Mesh
    material: THREE.MeshLambertMaterial
    texture: THREE.Texture
    /** Cell size, direction rows and walk cycle, read off this sheet's image. */
    format: SheetFormat
    phase: number
    speed: number
    pauseLeft: number
    rng: number
    teamIdx: number | null
    lobbyOrdinal: number | null
    playerIdx: number
    draggable: boolean
    busy: boolean
    name: string
    role: RoomRole
    presenceHalo: THREE.Mesh
    x: number
    z: number
    transition: {
        fromX: number
        fromZ: number
        startedAt: number
        duration: number
    } | null
    /** Hub-driven target (world units); set = this character is remote-synced. */
    net: { x: number; z: number; dir: WalkDir; moving: boolean; live: boolean } | null
}

async function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
    const tex = await loader.loadAsync(url)
    return pixelTexture(tex)
}

export async function createRoomScene(container: HTMLElement, opts: CreateRoomOptions): Promise<RoomSceneHandle> {
    const interactionMode = opts.interactionMode ?? "select"
    const assignmentLayout = interactionMode === "assign"
        ? assignmentSceneLayout(opts.players.length)
        : null
    const cleanupCallbacks: Array<() => void> = []
    let cleanedUp = false
    const runCleanup = (cleanup: () => void) => {
        try {
            cleanup()
        } catch (error) {
            logger.error("room3d.cleanup_failed", error)
        }
    }
    const registerCleanup = (cleanup: () => void) => {
        if (cleanedUp) {
            runCleanup(cleanup)
            return
        }
        cleanupCallbacks.push(cleanup)
    }
    const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        for (let i = cleanupCallbacks.length - 1; i >= 0; i--) {
            runCleanup(cleanupCallbacks[i]!)
        }
    }
    const track = <T extends { dispose(): void }>(disposable: T): T => {
        registerCleanup(() => disposable.dispose())
        return disposable
    }

    // One plane per distinct cell size, shared by every character drawn with it:
    // every sheet uses the same 32×48 cell, so this is effectively one geometry —
    // it stays keyed by cell size so a mis-sized sheet still gets a plane that
    // matches its art. Cached (and tracked once) rather than built per character
    // — 50 hackers would otherwise mean 50 identical geometries to dispose.
    const charGeoCache = new Map<string, THREE.PlaneGeometry>()
    const planeForSheet = (f: SheetFormat): THREE.PlaneGeometry => {
        const key = `${f.cellW}x${f.cellH}`
        let geo = charGeoCache.get(key)
        if (!geo) {
            const { width, height } = characterPlaneSize(f)
            geo = track(new THREE.PlaneGeometry(width, height))
            charGeoCache.set(key, geo)
        }
        return geo
    }

    try {
        const loader = new THREE.TextureLoader()
        const charSheets = await Promise.all(
            // CHAR_COUNT, not a literal: characterIdForPlayer hashes into that range,
            // so a short list here would silently wrap several seats onto one sheet.
            Array.from({ length: CHAR_COUNT }, (_, i) =>
                loadTexture(loader, characterSheetUrl(i)).then(track),
            ),
        )
        // Only the corner plants are left: the paintings, whiteboard and clock hung
        // on a wall that no longer exists, and the two SMALL_PAINTINGs were being
        // decoded for nobody long before that.
        const decorNames = ["LARGE_PLANT"] as const
        const decorTex: Record<string, THREE.Texture> = {}
        await Promise.all(
            decorNames.map(async (n) => {
                decorTex[n] = track(await loadTexture(loader, `/assets/room/furniture/${n}/${n}.png`))
            }),
        )

        // ------------------------------------------------------------ quality

        // How much of the diorama this device can afford. Highest authority first:
        // the URL param (a rehearsal or screenshot override), then the caller, then
        // whatever the player set in OPTIONS → GRAPHICS. Any of those is an
        // instruction and switches the frame-budget watcher off — a setting that
        // quietly moved itself would read as broken. Only with all three absent
        // (GRAPHICS on AUTO) is the device measured and re-judged as it runs.
        const pinnedTier =
            parseQualityOverride(window.location.search) ?? opts.quality ?? pinnedGraphicsTier()
        let tier: QualityTier = pinnedTier ?? resolveQualityTier(detectQualitySignals())
        let q: QualitySettings = qualitySettings(tier)
        const pixelRatioFor = (settings: QualitySettings) =>
            Math.min(window.devicePixelRatio * settings.renderScale, settings.maxPixelRatio)

        // ------------------------------------------------------------ renderer

        const renderer = track(new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" }))
        renderer.setPixelRatio(pixelRatioFor(q))
        renderer.shadowMap.enabled = q.shadows
        renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
        // Nothing that casts a shadow in this room ever moves — the furniture is
        // static and the characters use blob decals rather than real shadows — so
        // the depth pass is rendered on demand instead of 60 times a second.
        renderer.shadowMap.autoUpdate = false
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = ROOM_EXPOSURE
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"
        renderer.domElement.style.display = "block"
        registerCleanup(() => {
            if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
        })
        container.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        // Both start black and are retinted from the time-of-day palette below —
        // the background doubles as the last line of haze wherever the frame looks
        // past the backdrop's shell.
        scene.background = new THREE.Color(0x05070f)
        // Select mode's fog brackets scale off the room depth — the doubled room
        // put the far wall where the old fixed 52 began, which read as a smoky far
        // half rather than city haze.
        scene.fog = new THREE.Fog(
            0x05070f,
            assignmentLayout ? Math.max(52, assignmentLayout.camera.distance * 1.25) : ROOM_D * 2,
            assignmentLayout ? Math.max(96, assignmentLayout.camera.far * 0.75) : ROOM_D * 3.7,
        )

        // fixed, front-facing camera — assignment mode widens just enough to include
        // arrivals. The far plane clears the backdrop's haze shell (r=520), not just
        // the room: the old 200 would cull the city outside.
        const camera = new THREE.PerspectiveCamera(assignmentLayout?.camera.fov ?? 45, CW / CH, 0.1, 1400)
        if (assignmentLayout) {
            camera.position.set(
                assignmentLayout.camera.positionX,
                assignmentLayout.camera.positionY,
                assignmentLayout.camera.positionZ,
            )
            camera.lookAt(assignmentLayout.camera.targetX, 0.6, assignmentLayout.camera.targetZ)
        } else {
            // Higher and a touch further back than the old (21, +19.5): the doubled
            // depth needs the extra altitude for the far rows to clear the near ones.
            camera.position.set(0, 34, ROOM_D + 24)
            camera.lookAt(0, 0.6, ROOM_D * 0.4)
        }
        const cameraHomePosition = camera.position.clone()
        const cameraHomeTarget = new THREE.Vector3(
            assignmentLayout?.camera.targetX ?? 0,
            0.6,
            assignmentLayout?.camera.targetZ ?? ROOM_D * 0.4,
        )

        // ---- the city outside ----------------------------------------------------
        // Rings of skyline below the room, centred on the camera's home so a pan
        // slides the camera INSIDE them — that offset is the parallax. The palette
        // retints backdrop, fog, background and the room lights together, from the
        // Singapore clock (or a ?tod= override for rehearsals and screenshots).
        const backdrop = await createBackdrop(
            scene,
            { x: cameraHomePosition.x, z: cameraHomePosition.z },
            track,
            {
                // The rings must wrap outside the far corner of the floor slab, or the
                // room's far end disappears behind a silhouette tower (assignment
                // mode's pulled-back camera used to do exactly that on the doubled
                // room).
                clearRadius: Math.hypot(
                    Math.abs(cameraHomePosition.x) + ROOM_W / 2,
                    cameraHomePosition.z + NORTH_APRON,
                ) + 8,
                lightsScale: q.backdropLightsScale,
            },
        )
        const todOverride = parseTimeOverride(window.location.search)
        const clockMinute = () => todOverride ?? sgtMinutes(new Date())
        let paletteMinute = -1
        let paletteNight = -1
        // How far the sky has been pushed to night for the winners' ceremony: 0 is
        // the clock outside, 1 is the lit-city night the fireworks want. Eased
        // towards its goal every frame rather than cut, and back again when the
        // ceremony ends, so the room never visibly snaps between two evenings.
        let nightBlend = 0
        let nightGoal = 0
        // The palette in force, kept so the house lights can be dimmed and brought
        // back to it — the presentation spotlight dims the room, and "back up" has
        // to mean the same evening the clock outside says it is.
        let palette: ReturnType<typeof skyPalette> | null = null
        // What the clock page counts to with no window running: launch day unless
        // the route hands in the doors (undefined = screenLines's launch default).
        let countdown: ScreenCountdown | undefined = undefined
        const applyTimeOfDay = () => {
            const minute = clockMinute()
            if (minute === paletteMinute && nightBlend === paletteNight) return
            paletteMinute = minute
            paletteNight = nightBlend
            const p = nightBlend > 0
                ? mixPalette(skyPalette(minute), skyPalette(NIGHT_SHOW_MINUTE), nightBlend)
                : skyPalette(minute)
            palette = p
            backdrop.applyPalette(p)
                ; (scene.background as THREE.Color).setHex(p.haze)
            scene.fog!.color.setHex(p.haze)
            hemi.color.setHex(p.hemiSky)
            hemi.groundColor.setHex(p.hemiGround)
            key.color.setHex(p.keyColor)
            rim.color.setHex(p.rimColor)
            applyLightLevel()
        }

        // ------------------------------------------------------------ room shell

        /**
         * A lit surface — floor, walls, furniture. Standard pays for a full
         * metalness/roughness BRDF against every point light in the room, which is
         * exactly the term that makes twenty pools expensive; the cheap tier swaps
         * in Lambert, which is a dot product, and drops the two parameters Lambert
         * has no use for. Everything else about the material carries over, so the
         * room keeps its colours and maps and only loses its speculars.
         */
        const surfaceMaterial = (
            params: THREE.MeshStandardMaterialParameters,
        ): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial => {
            if (!q.cheapFurniture) return new THREE.MeshStandardMaterial(params)
            const { roughness: _roughness, metalness: _metalness, ...rest } = params
            return new THREE.MeshLambertMaterial(rest)
        }

        const carpetTex = track(makeCarpetTexture())
        const floor = new THREE.Mesh(
            track(new THREE.PlaneGeometry(ROOM_W, ROOM_D)),
            track(surfaceMaterial({ map: carpetTex, roughness: 1, metalness: 0 })),
        )
        floor.rotation.x = -Math.PI / 2
        floor.position.set(0, 0, ROOM_D / 2)
        floor.receiveShadow = true
        scene.add(floor)
        const hatchOpeningMaterials: THREE.Material[] = [floor.material]

        // ---- glass curtain walls -------------------------------------------------
        const mullionMat = track(surfaceMaterial({ color: 0x343a46, roughness: 0.45, metalness: 0.6 }))
        const glassMat = track(surfaceMaterial({
            color: 0xa8c8e0, transparent: true, opacity: 0.13, roughness: 0.08,
            metalness: 0, side: THREE.DoubleSide, depthWrite: false,
        }))

        const buildGlassWall = (width: number, height: number): THREE.Group => {
            const g = new THREE.Group()
            const glass = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), glassMat)
            glass.position.y = height / 2
            g.add(glass)
            const panes = Math.max(2, Math.round(width / 5))
            const postGeo = track(new THREE.BoxGeometry(0.14, height, 0.14))
            for (let i = 0; i <= panes; i++) {
                const post = new THREE.Mesh(postGeo, mullionMat)
                post.position.set(-width / 2 + (width / panes) * i, height / 2, 0)
                g.add(post)
            }
            const railGeo = track(new THREE.BoxGeometry(width, 0.12, 0.12))
            // The doubled wall gets a mid-height rail — floor, handrail, mid, cap —
            // so the upper glass doesn't read as one unbroken sheet.
            for (const ry of [0.08, 2.4, height * 0.55, height - 0.08]) {
                const rail = new THREE.Mesh(railGeo, mullionMat)
                rail.position.y = ry
                g.add(rail)
            }
            return g
        }

        // No glass on the front wall: floor to roof, that face is the screen and its
        // surround, and glazing behind an opaque panel is panes nobody can see.
        const leftGlass = buildGlassWall(ROOM_D, WALL_H)
        leftGlass.rotation.y = Math.PI / 2
        leftGlass.position.set(-ROOM_W / 2, 0, ROOM_D / 2)
        scene.add(leftGlass)
        const rightGlass = buildGlassWall(ROOM_D, WALL_H)
        rightGlass.rotation.y = -Math.PI / 2
        rightGlass.position.set(ROOM_W / 2, 0, ROOM_D / 2)
        if (interactionMode === "select") scene.add(rightGlass)

        // ---- the rest of our own tower -------------------------------------------
        // With a real city outside, a floor plane ending in mid-air reads as a
        // mistake rather than a diorama. A fascia over the glass line and a few
        // storeys of the building falling away beneath the slab turn the cut-away
        // into a floor OF something. The top stays open — the camera looks down
        // into the room, so a ceiling would be all it ever saw.
        {
            // Assignment mode grows the building sideways to carry the arrivals
            // platform; it is all one floor plate.
            const plateWest = -ROOM_W / 2
            const plateEast = assignmentLayout
                ? assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth + 0.6
                : ROOM_W / 2
            const plateNorth = -NORTH_APRON
            // The slab runs past the south glass line by as much as the camera may pan
            // that way (plus margin for the widest zoom), so panning down always lands
            // the bottom of the frame on structure. Without it, buying enough southward
            // pan to keep the last row's characters in frame would buy a view of the
            // tower's blank south face as well.
            const plateSouth = assignmentLayout
                ? Math.max(ROOM_D, assignmentLayout.lobbyDepth)
                : ROOM_D + ROOM_CAMERA_MAX_PAN_SOUTH + 3
            const plateW = plateEast - plateWest
            const plateD = plateSouth - plateNorth
            const plateX = (plateWest + plateEast) / 2
            const plateZ = (plateNorth + plateSouth) / 2

            const fasciaMat = track(surfaceMaterial({ color: 0x232733, roughness: 0.55, metalness: 0.35 }))
            // fascia band capping the glass, on the three walls that exist
            const fasciaSpans: Array<[w: number, x: number, z: number, rotY: number]> = [
                [ROOM_W + 0.7, 0, 0, 0],
                [ROOM_D + 0.7, -ROOM_W / 2, ROOM_D / 2, Math.PI / 2],
            ]
            if (interactionMode === "select") fasciaSpans.push([ROOM_D + 0.7, ROOM_W / 2, ROOM_D / 2, Math.PI / 2])
            for (const [w, x, z, rotY] of fasciaSpans) {
                const fascia = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.85, 0.5)), fasciaMat)
                fascia.position.set(x, WALL_H + 0.28, z)
                fascia.rotation.y = rotY
                scene.add(fascia)
            }

            // the slab edge itself, then two darker storeys stepping in and down —
            // enough to read as "building continues" before the haze takes over.
            // No storey's top may sit AT y=0 or flush against the box above: a face
            // coplanar with the floor planes z-fights them, which reads as mottled
            // carpet that shimmers whenever the camera moves. Each box instead starts
            // a little inside the one above, so every pair of surfaces has real
            // separation in depth.
            const storeys: Array<[inset: number, top: number, depth: number, color: number]> = [
                [0, -0.06, 1.1, 0x2e3340], // exposed floor slab, just under the carpet
                [0.35, -1.05, 5.5, 0x141824], // storey below, glass in shadow
                [0.9, -6.4, 7.7, 0x0b0e18], // and one more, sinking into the dark
            ]
            for (const [inset, top, depth, color] of storeys) {
                const storey = new THREE.Mesh(
                    track(new THREE.BoxGeometry(plateW - inset * 2, depth, plateD - inset * 2)),
                    track(surfaceMaterial({ color, roughness: 0.8, metalness: 0.1 })),
                )
                storey.position.set(plateX, top - depth / 2, plateZ)
                scene.add(storey)
                hatchOpeningMaterials.push(storey.material)
            }
        }

        // Assignment arrivals are on an open platform immediately outside the
        // room. The missing right wall is the entrance; there is intentionally no
        // gate, rope, or attendant blocking it.
        let lobbyHitbox: THREE.Mesh | null = null
        let lobbyHighlight: THREE.Mesh | null = null
        if (assignmentLayout) {
            const lobbyFloor = new THREE.Mesh(
                track(new THREE.PlaneGeometry(assignmentLayout.lobbyWidth, assignmentLayout.lobbyDepth)),
                track(surfaceMaterial({ color: 0x17234f, roughness: 0.92, metalness: 0.05 })),
            )
            lobbyFloor.rotation.x = -Math.PI / 2
            lobbyFloor.position.set(assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth / 2, 0.025, assignmentLayout.lobbyDepth / 2)
            lobbyFloor.receiveShadow = true
            scene.add(lobbyFloor)

            const platformEdgeMat = track(new THREE.MeshBasicMaterial({ color: 0x5070e0, toneMapped: false }))
            const platformEdgeGeo = track(new THREE.BoxGeometry(0.12, 0.12, assignmentLayout.lobbyDepth))
            const platformEdge = new THREE.Mesh(platformEdgeGeo, platformEdgeMat)
            platformEdge.position.set(assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth - 0.06, 0.08, assignmentLayout.lobbyDepth / 2)
            scene.add(platformEdge)

            lobbyHitbox = new THREE.Mesh(
                track(new THREE.BoxGeometry(assignmentLayout.lobbyWidth, 0.5, assignmentLayout.lobbyDepth)),
                track(new THREE.MeshBasicMaterial({ visible: false })),
            )
            lobbyHitbox.position.set(assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth / 2, 0.25, assignmentLayout.lobbyDepth / 2)
            scene.add(lobbyHitbox)

            lobbyHighlight = new THREE.Mesh(
                track(new THREE.PlaneGeometry(assignmentLayout.lobbyWidth - 0.25, assignmentLayout.lobbyDepth - 0.25)),
                track(new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false })),
            )
            lobbyHighlight.rotation.x = -Math.PI / 2
            lobbyHighlight.position.set(assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth / 2, 0.055, assignmentLayout.lobbyDepth / 2)
            lobbyHighlight.visible = false
            scene.add(lobbyHighlight)

            const arrivalsTex = track(makeLabelTexture("ARRIVALS", false))
            const arrivalsLabel = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: arrivalsTex, depthTest: true })))
            arrivalsLabel.scale.set(3.2, 0.88, 1)
            arrivalsLabel.position.set(assignmentLayout.lobbyStartX + assignmentLayout.lobbyWidth / 2, AREA_LABEL_Y, 1.1)
            scene.add(arrivalsLabel)
        }

        // centre aisle rugs — one per gap between table rows, derived from the plan
        // so they follow the rows wherever the layout puts them
        const rugGeo = track(new THREE.PlaneGeometry(42, 3.4))
        const rugMat = track(surfaceMaterial({ map: track(makeRugTexture()), roughness: 1 }))
        for (let i = 0; i + 1 < TABLE_ROWS.length; i++) {
            const aisleZ = (toZ(TABLE_ROWS[i]!.bottom) + toZ(TABLE_ROWS[i + 1]!.top)) / 2
            const rug = new THREE.Mesh(rugGeo, rugMat)
            rug.rotation.x = -Math.PI / 2
            rug.position.set(0, 0.015, aisleZ)
            rug.receiveShadow = true
            scene.add(rug)
        }

        // ------------------------------------------------------------ big screen

        // The screen spans the whole front wall now — no suspension rods; it IS the
        // wall face, sitting in a full-width surround that runs floor to roof line,
        // where the fascia band caps it. The lit glass starts a unit up, so the
        // surround reads as a plinth rather than the picture bleeding into the
        // carpet.
        const SCREEN_BOTTOM = 1
        const SCREEN_H = WALL_H - SCREEN_BOTTOM
        const SCREEN_W = ROOM_W - 0.8
        const SCREEN_CY = SCREEN_BOTTOM + SCREEN_H / 2
        const screenCanvas = document.createElement("canvas")
        screenCanvas.width = SCREEN_TEX_W
        screenCanvas.height = SCREEN_TEX_H
        const screenCtx = screenCanvas.getContext("2d")!
        // Which page this client's screen is on, and the board it draws. Both are
        // local: the page turns for whoever pressed interact, nobody else.
        let screenPage: ScreenPage = SCREEN_PAGES[0]
        // The standings as the poll last handed them over, unsliced: which five of
        // them the screen wants depends on the page it is on, and the page turns
        // more often than the poll lands.
        let screenRows: readonly ExLeaderboardRow[] = []
        // The trading window's clock, pushed in by the route's 5s poll; the page
        // ticks the seconds off its timestamp in between.
        let sessionClock: SessionClockSnapshot | null = null
        // A public exchange announcement takes the panel over briefly. Its lifetime
        // is owned by useMarketNews; the scene only paints the latest value it gets.
        let marketNews: MarketNews | null = null
        // The filmed broadcast for a scripted market event, while one is playing.
        // Only set once the element actually has a frame — until then the banner and
        // its text hold the wall, so the screen never goes black waiting on bytes.
        let newsVideo: HTMLVideoElement | null = null
        // The element the room OWNS, from the moment it is created — which is not the
        // same as the one being drawn. A clip takes a moment to reach its first
        // frame, and a second market event can land inside that moment; tearing down
        // only what had already loaded left the still-loading element in the page,
        // where it went on to load, play, and seize the screen from the event that
        // replaced it. Firing three events a few seconds apart left three clips
        // playing at once. Ownership is tracked here so teardown is unconditional.
        let newsVideoEl: HTMLVideoElement | null = null
        // The clip the room is MEANT to be playing, kept so a broadcast that could
        // not start can be started again later. See the visibilitychange handler.
        let newsClip: MarketNewsClip | null = null
        // The site's effects settings, pushed in by the route. Defaults to muted so
        // a broadcast that somehow starts before the first push cannot be the thing
        // that makes noise in a silent room.
        let newsAudio = { muted: true, volume: 0.8 }
        // Whether the auto-frame on the wall was OURS to release. A player who
        // presses Escape mid-broadcast has taken the camera back, and the clip
        // ending must not yank it away from wherever they went.
        let newsFocusHeld = false
        /** The camera is on the wall because the winners' ceremony put it there. */
        let winnersFocusHeld = false
        // The screen turns its own pages on a timer; interact just takes the wheel,
        // which is why a press resets the dwell rather than stopping the cycle —
        // whoever pressed gets the full reading time on the page they asked for.
        let screenPageAt = performance.now()
        /**
         * A page the gamemaster has pinned for the whole room, or null while the
         * players own the wall. While it is set nothing else moves the page — see
         * setForcedScreenPage on the handle for why it is absolute.
         */
        let forcedScreenPage: ScreenPage | null = null
        const redrawScreen = () => {
            drawScreenCanvas(
                screenCtx,
                screenPage,
                boardRows(screenRows, screenPage),
                sessionClock,
                countdown,
                marketNews,
                broadcastPicture.visible,
                presentation ? presentationBoard(presentation, opts.teamLabels, Date.now()) : null,
                winners ? winnersBoard(winners, opts.teamLabels) : null,
            )
            screenTex.needsUpdate = true
        }
        /**
         * Take the broadcast down and give the wall back to its pages.
         *
         * Called from every way a clip can end — its own `ended` event, a decoding
         * error, the bulletin being released or replaced, and the scene being
         * disposed — so the element is never left playing audio into a room that has
         * moved on.
         */
        const stopNewsVideo = () => {
            // The OWNED element, not the drawn one: a clip still loading has no frame
            // yet and would otherwise survive this and hijack the wall later.
            const video = newsVideoEl
            newsVideoEl = null
            newsVideo = null
            newsClip = null
            clearBroadcastPicture()
            // Back to framing the whole wall for whoever is still standing at it.
            if (screenFocusT > 0) syncCamera()
            if (video) {
                video.pause()
                // Dropping the src and reloading is what actually releases the network
                // request and the decoder; removing the element alone does not.
                video.removeAttribute("src")
                video.load()
                video.remove()
            }
            if (newsFocusHeld) {
                newsFocusHeld = false
                setScreenFocus(false)
            }
            redrawScreen()
        }

        const startNewsVideo = (clip: MarketNewsClip) => {
            stopNewsVideo()
            const video = document.createElement("video")
            video.src = clip.webm
            // playsInline keeps iOS from throwing the clip into its own fullscreen
            // player, which would take the room off the screen entirely.
            video.playsInline = true
            video.preload = "auto"
            video.muted = newsAudio.muted
            video.volume = newsAudio.volume

            // Ownership, not drawn-ness: an element that errors before its first frame
            // still has to be torn down, and one the room has already moved on from
            // must not tear down its successor.
            const fail = () => { if (newsVideoEl === video) stopNewsVideo() }
            video.addEventListener("ended", fail, { once: true })
            video.addEventListener("error", fail, { once: true })
            // Not "playing" but the first frame being decodable: `playing` can fire
            // before videoWidth is known, and drawing a 0x0 source throws.
            video.addEventListener("loadeddata", () => {
                // A frame from a clip the room has already replaced is not wanted, however
                // late it arrives.
                if (newsVideoEl !== video) return
                newsVideo = video
                showBroadcastPicture(video)
                // The framed pose is measured from the picture, so it changes the moment
                // there is one — re-sync rather than waiting for the next thing to move
                // the camera.
                if (screenFocusT > 0) syncCamera()
                // The room's furniture hides the bottom of the screen from a normal
                // camera, so a broadcast that filled it would lose the anchor's desk.
                // Framing the wall also hides those occluders — see screenFocusHidesRoom.
                if (!screenFocused) {
                    newsFocusHeld = true
                    setScreenFocus(true)
                }
                redrawScreen()
            })

            newsVideoEl = video
            newsClip = clip
            video.style.display = "none"
            document.body.appendChild(video)
            void video.play().catch(() => {
                // Autoplay with sound needs a gesture the page may not have had yet.
                // A silent broadcast is far better than none, and the room's own audio
                // controls are the user's way back to sound.
                video.muted = true
                void video.play().catch(fail)
            })
        }

        // Teardown detaches the element directly rather than going through
        // stopNewsVideo: by the time cleanup runs the screen and the camera it would
        // touch may already be disposed, and all that matters here is that no clip
        // is left playing audio into a page that has navigated away.
        registerCleanup(() => {
            const video = newsVideoEl
            newsVideoEl = null
            newsVideo = null
            if (!video) return
            video.pause()
            video.removeAttribute("src")
            video.load()
            video.remove()
        })

        /**
         * Chrome does not decode media in a hidden tab.
         *
         * A clip started while the room was in the background sits in networkState
         * LOADING with readyState 0 and never produces a frame — verified with a
         * bare <video> element and an already-cached file, so this is the browser,
         * not the room. `loadeddata` therefore never fires and the wall stays on its
         * text banner, which is exactly what a game master sees when they fire an
         * event from the console tab with the room behind it.
         *
         * Coming back to the foreground is the first moment the clip can actually
         * play, so that is when it is started again. The bulletin is still current —
         * a frozen tab does not run its release timer either.
         */
        const onVisibilityChange = () => {
            if (document.hidden) return
            const clip = newsClip
            if (clip && !newsVideo) startNewsVideo(clip)
        }
        document.addEventListener("visibilitychange", onVisibilityChange)
        registerCleanup(() => document.removeEventListener("visibilitychange", onVisibilityChange))

        const turnScreenPage = (direction: "next" | "prev" = "next") => {
            // A pinned wall does not turn — not for the dwell timer, and not for a
            // player pressing interact in front of it. Nor does the running order:
            // it is fixed on the wall for as long as presentations run.
            if (forcedScreenPage || presentation) {
                redrawScreen()
                return
            }
            // The final minute owns the screen: neither the dwell timer nor an
            // interact press turns away from a count that is about to hit zero.
            if (screenLines(sessionClock, Date.now(), countdown).solo) {
                redrawScreen()
                return
            }
            const turn = direction === "prev" ? prevScreenPage : nextScreenPage
            screenPage = turn(screenPage, eventStarted(sessionClock), screenRows.length)
            screenPageAt = performance.now()
            redrawScreen()
        }
        drawScreenCanvas(screenCtx, screenPage, boardRows(screenRows, screenPage), sessionClock, countdown, marketNews)
        const screenTex = track(pixelTexture(new THREE.CanvasTexture(screenCanvas)) as THREE.CanvasTexture)
        // The surround runs from the floor to the wall head: it is the only thing
        // standing on this face now, so anything it fails to cover is a gap onto
        // the empty world outside. The top is flush with the wall head rather than
        // floating above the roof.
        const frameBottom = 0
        const frameH = WALL_H - frameBottom
        const screenFrame = new THREE.Mesh(
            track(new THREE.BoxGeometry(ROOM_W, frameH, 0.3)),
            track(surfaceMaterial({ color: 0x10162e, roughness: 0.5, metalness: 0.4 })),
        )
        screenFrame.position.set(0, frameBottom + frameH / 2, 0.16)
        scene.add(screenFrame)
        const screen = new THREE.Mesh(
            track(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)),
            track(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })),
        )
        screen.position.set(0, SCREEN_CY, 0.33)
        scene.add(screen)

        // ------------------------------------------------------------ broadcast picture
        // A filmed broadcast is NOT painted onto the screen's canvas. It used to be:
        // every frame the clip advanced, the video was drawn through a 2D-canvas
        // filter into the 1920x468 canvas and the whole canvas re-uploaded to the
        // GPU — and since a <video>'s currentTime is a running clock rather than a
        // frame counter, "every frame the clip advanced" was every frame the room
        // rendered. That was the room's lag while a clip played.
        //
        // The picture is now its own quad, a hair in front of the screen, carrying
        // a VideoTexture: the browser hands each decoded frame straight to WebGL at
        // the clip's own rate, and the wall's canvas is painted once (black, border)
        // when the clip starts and left alone until it ends. The quad is sized and
        // placed from the same fit rect the camera frames, so what is drawn and what
        // is framed still cannot disagree. The picture is shown as filmed — the 90s
        // tube treatment it once had (scanlines, vignette, a saturation lift) is
        // gone; the clips are a clean production and read best as one.
        //
        // "As filmed" also means outside the room's tone mapping, which the post
        // chain applies to the whole frame regardless of what a material asks for,
        // and which left the picture dark. So the picture lives in a scene of its
        // own, drawn over the room before the output pass with the tone map
        // pre-inverted (broadcast-picture.ts
        // has the why and the maths), or straight after the room where there is no
        // post chain to dodge.
        const BROADCAST_PICTURE_LIFT = 0.01
        const broadcastPicture = new THREE.Mesh(
            track(new THREE.PlaneGeometry(1, 1)),
            new THREE.MeshBasicMaterial({ toneMapped: false }),
        )
        broadcastPicture.visible = false
        broadcastPicture.position.set(0, SCREEN_CY, screen.position.z + BROADCAST_PICTURE_LIFT)
        const pictureScene = new THREE.Scene()
        pictureScene.add(broadcastPicture)
        // Off until the post chain is built (below), which is the only path that
        // needs the mapping undone.
        const pictureUniforms = broadcastPictureUniforms(ROOM_EXPOSURE)

        /** Take the picture down and release its texture and material. */
        const clearBroadcastPicture = () => {
            if (!broadcastPicture.visible) return
            broadcastPicture.visible = false
            const material = broadcastPicture.material as THREE.MeshBasicMaterial
            // The texture is disposed first: it is what holds the rVFC subscription on
            // the element, and the material after it so the two never outlive the clip.
            material.map?.dispose()
            material.dispose()
            broadcastPicture.material = new THREE.MeshBasicMaterial({ toneMapped: false })
        }
        registerCleanup(clearBroadcastPicture)

        /**
         * Put a clip's picture up: sized and placed as it would have been drawn.
         * Returns false, leaving the wall on its text banner, for a video that has
         * no dimensions yet — nothing to size a quad from.
         */
        const showBroadcastPicture = (video: HTMLVideoElement): boolean => {
            clearBroadcastPicture()
            const fit = broadcastFitRect(video.videoWidth, video.videoHeight, SCREEN_TEX_W, SCREEN_TEX_H)
            if (fit.width <= 0) return false
            const world = broadcastWorldRect(fit, SCREEN_TEX_W, SCREEN_TEX_H, SCREEN_W, SCREEN_H, SCREEN_CY)
            broadcastPicture.scale.set(world.width, world.height, 1)
            broadcastPicture.position.y = world.centreY

            const texture = new THREE.VideoTexture(video)
            texture.colorSpace = THREE.SRGBColorSpace
            // Same material as the wall behind it (basic, untonemapped), so the output
            // colour space treats the picture exactly as they do the panel.
            const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
            material.onBeforeCompile = (shader) => { applyBroadcastPictureShader(shader, pictureUniforms) }
            broadcastPicture.material = material
            broadcastPicture.visible = true
            return true
        }
        // Twice the glass, twice the throw: a pair of glows so the wall-wide screen
        // lights the room's front end evenly instead of one hot centre pool.
        const screenGlowLights = [-ROOM_W / 4, ROOM_W / 4].map((gx) => {
            const screenGlow = new THREE.PointLight(0x6090ff, 34, 20, 2)
            screenGlow.position.set(gx, SCREEN_CY + 0.6, 2.8)
            scene.add(screenGlow)
            return screenGlow
        })

        // ------------------------------------------------------------ wall decor

        // corner plants (billboards)
        const plantTex = decorTex["LARGE_PLANT"]!
        const plantImg = plantTex.image as HTMLImageElement
        const plantAspect = plantImg.width / plantImg.height
        const plantGeo = track(new THREE.PlaneGeometry(3.4 * plantAspect, 3.4))
        const plantMat = track(new THREE.MeshLambertMaterial({ map: plantTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }))
        let secretPlant: THREE.Mesh | null = null
        let backroomsUnlocked = false
        let renderPaused = false
        // Drawn from the shared object list rather than a second copy of the same
        // coordinates: these billboards ARE the talkable plants, so a plant you can
        // see and a plant you can talk to cannot end up in different places.
        for (const obj of ROOM_OBJECTS) {
            if (!obj.id.startsWith("plant-")) continue
            const plant = new THREE.Mesh(plantGeo, plantMat)
            plant.position.set(toX(obj.x), 1.7, toZ(obj.y))
            scene.add(plant)
            if (obj.id === "plant-se") secretPlant = plant
        }

        // This small piece of scenery belongs upstairs. The mini-game itself is
        // behind a separate dynamic import in the route, never a scene dependency.
        const secretObject = ROOM_OBJECTS.find((obj) => obj.id === "plant-se")!
        let hatch: THREE.Group | null = null
        const hatchOpen = { value: 0 }
        const revealHatch = () => {
            hatch = createBackroomsHatch(track)
            hatch.position.set(toX(secretObject.x), 0, toZ(secretObject.y))
            scene.add(hatch)
            for (const material of hatchOpeningMaterials) maskHatchOpening(material, hatch.position.x, hatch.position.z, hatchOpen)
            const hatchLabel = document.createElement("canvas")
            hatchLabel.width = 512
            hatchLabel.height = 96
            const hatchCtx = hatchLabel.getContext("2d")!
            hatchCtx.fillStyle = "#17160d"
            hatchCtx.fillRect(0, 0, 512, 96)
            hatchCtx.fillStyle = "#ffe493"
            hatchCtx.font = "bold 25px monospace"
            hatchCtx.textAlign = "center"
            hatchCtx.fillText("↓ THE BACKROOMS", 256, 37)
            hatchCtx.font = "20px monospace"
            hatchCtx.fillText("SPACE / E / A · CLIMB DOWN", 256, 73)
            const hatchTex = track(new THREE.CanvasTexture(hatchLabel))
            const hatchSign = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: hatchTex, depthTest: false })))
            hatchSign.scale.set(5.4, 1.02, 1)
            hatchSign.position.set(-1.5, 3.8, 0)
            hatch.add(hatchSign)
        }

        // The Konami code's cabinet, beside Primey. Private to this client and
        // built the first time it is revealed; the fighter it opens is behind a
        // dynamic import in the route, never a scene dependency.
        let arcade: THREE.Group | null = null
        let arcadeVisible = false
        /** The entrance in progress (camera move, drop, dust), or null. */
        let arcadeReveal: ArcadeReveal | null = null
        /** Whether the follow-cam was driving before the entrance took the camera. */
        let followBeforeReveal = false
        /** 0 = the room's view, 1 = framed on the cabinet; and the impact jitter. */
        let arcadeFocusT = 0
        const arcadeShake = { x: 0, z: 0 }
        // The landing's dust: one Points buffer the reveal timeline is copied into,
        // and a ground ring that spreads and fades under it.
        const dustPositions = new Float32Array(REVEAL.dustCount * 3)
        const dustGeo = track(new THREE.BufferGeometry())
        dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage))
        dustGeo.setDrawRange(0, 0)
        const dustMat = track(new THREE.PointsMaterial({
            size: 1.6,
            color: 0xcfc3ad,
            map: track(makeSparkTexture()),
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            fog: false,
        }))
        const dustPoints = new THREE.Points(dustGeo, dustMat)
        dustPoints.frustumCulled = false
        dustPoints.visible = false
        scene.add(dustPoints)
        const dustRing = new THREE.Mesh(
            track(new THREE.RingGeometry(0.7, 1, 40)),
            track(new THREE.MeshBasicMaterial({ color: 0xd8ccb4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })),
        )
        dustRing.rotation.x = -Math.PI / 2
        dustRing.visible = false
        scene.add(dustRing)
        const revealArcade = (entrance: boolean) => {
            arcade = createArcadeCabinet(track)
            const x = toX(ARCADE_POINT.x)
            const z = toZ(ARCADE_POINT.y)
            if (!entrance) {
                // Unlocked on an earlier visit: it is simply standing there.
                arcade.position.set(x, 0, z)
                scene.add(arcade)
                return
            }
            arcade.position.set(x, REVEAL.dropHeight, z)
            // The sign waits for the landing; a floating label over a falling
            // cabinet reads as two things.
            const sign = arcade.getObjectByName("arcade-sign")
            if (sign) sign.visible = false
            scene.add(arcade)
            dustPoints.position.set(x, 0.05, z)
            dustRing.position.set(x, 0.04, z)
            // The entrance: move to the spot, drop, dust, move back. The follow-cam
            // and the framed screen both stand down for it, and the local character
            // is held still so the camera is not chasing anyone while it is away.
            setScreenFocus(false)
            followBeforeReveal = cameraFollowSuspended
            cameraFollowSuspended = true
            arcadeReveal = createArcadeReveal()
            localInput.releaseMovement()
            localMoving = false
            inputFrozenUntil = Math.max(inputFrozenUntil, performance.now() + arcadeReveal.totalMs)
        }
        /** One frame of the cabinet's entrance. */
        const stepArcadeReveal = (frameMs: number) => {
            if (!arcadeReveal || !arcade) return
            const frame = arcadeReveal.advance(frameMs)
            arcadeFocusT = frame.focus
            arcadeShake.x = frame.shake.x
            arcadeShake.z = frame.shake.z
            syncCamera()
            arcade.position.y = frame.cabinetY
            arcade.scale.y = frame.squash
            if (frame.landedNow) {
                const sign = arcade.getObjectByName("arcade-sign")
                if (sign) sign.visible = true
                opts.onArcadeLanded?.()
            }
            const showDust = frame.dust.length > 0
            dustPoints.visible = showDust
            dustRing.visible = frame.ring.opacity > 0
            if (showDust) {
                frame.dust.forEach((d, i) => {
                    dustPositions[i * 3] = d.x
                    dustPositions[i * 3 + 1] = d.y
                    dustPositions[i * 3 + 2] = d.z
                })
                dustGeo.setDrawRange(0, frame.dust.length)
                    ; (dustGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
                dustMat.opacity = 0.85 * Math.max(...frame.dust.map((d) => d.alpha))
                const s = frame.ring.radius
                dustRing.scale.set(s, s, 1)
                    ; (dustRing.material as THREE.MeshBasicMaterial).opacity = frame.ring.opacity
            }
            if (frame.done) {
                arcadeReveal = null
                arcadeFocusT = 0
                arcadeShake.x = arcadeShake.z = 0
                syncCamera()
                dustPoints.visible = false
                dustRing.visible = false
                cameraFollowSuspended = followBeforeReveal
            }
        }

        // ------------------------------------------------------------ Primey

        // The mascot, standing in the arrivals band as a billboard. The idle strip
        // is one row of square cells, so a 1/frames-wide texture repeat picks the
        // cell and the tick below walks the offset along it — no per-frame texture
        // upload, just a uniform.
        //
        // Basic, not Lambert: Primey is a lit screen on legs, and a mascot that
        // dims with the room's evening palette reads as switched off rather than as
        // the one thing in here you can ask a question.
        const primeySize = primeyPlaneSize()
        const primeyTex = track(await loadTexture(loader, PRIMEY_STRIP.url))
        primeyTex.repeat.set(1 / PRIMEY_STRIP.frames, 1)
        const primeyMat = track(new THREE.MeshBasicMaterial({
            map: primeyTex,
            transparent: true,
            alphaTest: 0.4,
            side: THREE.DoubleSide,
        }))
        const primeyMesh = new THREE.Mesh(
            track(new THREE.PlaneGeometry(primeySize.width, primeySize.height)),
            primeyMat,
        )
        primeyMesh.position.set(toX(PRIMEY_POINT.x), primeyCenterY(), toZ(PRIMEY_POINT.y))
        scene.add(primeyMesh)
        let primeyVisible = true

        /** A character's crowns, by playerIdx, with the set they were built for
         * so an unchanged wearer is left alone. */
        const crowns = new Map<number, { kinds: string; meshes: THREE.Mesh[] }>()
        /** What each character should be wearing, and the role it was worked out
         * from. Recomputed only when that changes: doing it per character per
         * frame allocated a list and a string for everybody in the room sixty
         * times a second, to nearly always the same answer. */
        const crownWanted = new Map<number, { from: string; crowns: Crown[]; kinds: string }>()

        /** One texture per kind, drawn once and shared by everyone wearing it. */
        const crownTextures = new Map<string, THREE.CanvasTexture>()
        const crownTexture = (kind: Crown["kind"]) => {
            const already = crownTextures.get(kind)
            if (already) return already
            const made = track(makeCanvasTexture(CROWN_SPRITE_PX, CROWN_SPRITE_PX, (ctx) => drawCrown(ctx, kind)))
            crownTextures.set(kind, made)
            return made
        }

        const CROWN_SIZE = 0.52
        /** How far above the top of its wearer's head a crown floats. Read off the
         * character rather than fixed, so it sits right whatever sheet they use. */
        const CROWN_RISE = 0.22
        const crownGeometry = track(new THREE.PlaneGeometry(CROWN_SIZE, CROWN_SIZE))

        const clearCrowns = (playerIdx: number) => {
            const worn = crowns.get(playerIdx)
            if (!worn) return
            for (const mesh of worn.meshes) {
                scene.remove(mesh)
                ;(mesh.material as THREE.Material).dispose()
            }
            crowns.delete(playerIdx)
            crownWanted.delete(playerIdx)
        }

        /**
         * Put the right crowns on a character and stand them above its head.
         *
         * Rebuilt only when the set changes, so a walking character costs a
         * position update and nothing else. Hidden while its wearer is speaking:
         * the bubble takes that space, and crowns that shoved themselves out of
         * the way every time somebody talked would read as a fault.
         */
        const syncCrowns = (c: CharState) => {
            const role = (c.role ?? "student") as CrownRole
            // No pets in this build, so nobody has an egg crown to wear: a
            // character's crowns are decided by their role alone.
            const from = role
            let asked = crownWanted.get(c.playerIdx)
            if (asked?.from !== from) {
                const fresh = crownsFor(role, 0)
                asked = { from, crowns: fresh, kinds: fresh.map((crown) => crown.kind).join(",") }
                crownWanted.set(c.playerIdx, asked)
            }
            const wanted = asked.crowns
            const kinds = asked.kinds
            let worn = crowns.get(c.playerIdx)
            if (worn?.kinds !== kinds) {
                clearCrowns(c.playerIdx)
                const meshes = wanted.map((crown) => {
                    const mesh = new THREE.Mesh(
                        crownGeometry,
                        new THREE.MeshBasicMaterial({
                            map: crownTexture(crown.kind),
                            alphaTest: 0.5,
                        }),
                    )
                    mesh.name = `crown-${crown.kind}-${c.playerIdx}`
                    mesh.matrixAutoUpdate = false
                    scene.add(mesh)
                    return mesh
                })
                worn = { kinds, meshes }
                if (meshes.length > 0) crowns.set(c.playerIdx, worn)
            }
            if (!worn || worn.meshes.length === 0) return
            const hidden = !c.mesh.visible || speechBubbles.has(c.playerIdx)
            const y = characterTopY(c.format) + CROWN_RISE
            worn.meshes.forEach((mesh, index) => {
                mesh.visible = !hidden
                if (hidden) return
                mesh.position.set(c.x + (wanted[index]?.offset ?? 0), y, c.z)
                mesh.updateMatrix()
            })
        }

        registerCleanup(() => {
            for (const playerIdx of [...crowns.keys()]) clearCrowns(playerIdx)
        })

        // ------------------------------------------------------------ lighting

        // Ambient bounce, key and rim all start at arbitrary values — the palette
        // overwrites colour and intensity before the first frame, so the interior
        // light always agrees with whatever the city outside is doing.
        const hemi = new THREE.HemisphereLight(0x8fb0d8, 0x3a3d42, 0.75)
        scene.add(hemi)
        const key = new THREE.DirectionalLight(0xfff2dd, 1.1)
        key.position.set(14, 30, 44)
        key.castShadow = true
        key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
        // Frustum sized for the doubled floor plate, not the old half-depth room.
        key.shadow.camera.left = -36
        key.shadow.camera.right = 36
        key.shadow.camera.top = 48
        key.shadow.camera.bottom = -30
        key.shadow.camera.far = 140
        key.shadow.bias = -0.002
        scene.add(key)
        const rim = new THREE.DirectionalLight(0x4060ff, 0.5)
        rim.position.set(0, 14, -16)
        scene.add(rim)

        // Warm pools over the desk rows. The pendant fixtures these hung from are
        // gone — cords dangling from an open sky read wrong once the room got a
        // real backdrop — but the pools they cast stay, as unseen sources. One rank
        // per table row, centred on the row, so every row gets its pools.
        //
        // This rank is the room's single largest GPU cost: three.js is a forward
        // renderer, so all sixteen are evaluated per fragment of every Standard
        // material in the room. The cheap tiers merge columns into fewer, wider,
        // brighter pools — hence the rebuild rather than a fixed rig.
        const deskLights: THREE.PointLight[] = []
        const buildDeskLights = (perRow: number) => {
            for (const light of deskLights) {
                scene.remove(light)
                light.dispose()
            }
            deskLights.length = 0
            for (const row of TABLE_ROWS) {
                const lz = toZ(row.center)
                for (const plan of deskLightPlan(TABLE_COL_CENTERS, perRow)) {
                    const pt = new THREE.PointLight(0xffb066, plan.intensity, plan.distance, 2)
                    pt.position.set(toX(plan.x), 5.4, lz)
                    // Its full brightness, so the house lights can dim and come back.
                    pt.userData.baseIntensity = plan.intensity
                    scene.add(pt)
                    deskLights.push(pt)
                }
            }
            applyLightLevel()
        }

        // ---- house lights ---------------------------------------------------------
        // Every light the room hangs — the palette's three, the desk pools and the
        // screen's glow — scaled by one level. 1 is the room as the clock outside
        // paints it; the presentation spotlight takes it down towards
        // 1 - ROOM_DIM_DEPTH and the spot becomes the only thing lighting a desk.
        let roomDim = 0
        let roomDimTarget = 0
        const applyLightLevel = () => {
            const level = 1 - roomDim * ROOM_DIM_DEPTH
            if (palette) {
                hemi.intensity = palette.hemiIntensity * level
                key.intensity = palette.keyIntensity * level
                rim.intensity = palette.rimIntensity * level
            }
            for (const light of deskLights) light.intensity = (light.userData.baseIntensity as number) * level
            for (const light of screenGlowLights) light.intensity = SCREEN_GLOW_INTENSITY * level
        }
        buildDeskLights(q.deskLightsPerRow)
        registerCleanup(() => {
            for (const light of deskLights) light.dispose()
        })

        // ---- the presentation spotlight ------------------------------------------
        const spot = new THREE.SpotLight(
            0xfff1cf,
            0,
            SPOT_HEIGHT * 2.5,
            Math.atan(SPOT_RADIUS / SPOT_HEIGHT) * 1.15,
            0.45,
            SPOT_DECAY,
        )
        spot.position.set(0, SPOT_HEIGHT, 0)
        spot.target.position.set(0, 0, 0)
        scene.add(spot)
        scene.add(spot.target)
        registerCleanup(() => spot.dispose())
        // The beam: an open cone from the fixture to the floor, additive so it
        // reads as light in the air rather than a solid. Drawn only while the spot
        // is up — its opacity follows the light's intensity.
        const spotBeamMat = track(new THREE.MeshBasicMaterial({
            color: 0xfff1cf,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false,
            fog: false,
        }))
        const spotBeam = new THREE.Mesh(
            track(new THREE.ConeGeometry(SPOT_RADIUS, SPOT_HEIGHT, 40, 1, true)),
            spotBeamMat,
        )
        spotBeam.visible = false
        scene.add(spotBeam)
        // The pool on the floor under it: the bright disc that says "this desk".
        const spotPoolMat = track(new THREE.MeshBasicMaterial({
            color: 0xfff1cf,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            fog: false,
        }))
        const spotPool = new THREE.Mesh(track(new THREE.CircleGeometry(SPOT_RADIUS, 48)), spotPoolMat)
        spotPool.rotation.x = -Math.PI / 2
        spotPool.position.y = 0.045
        spotPool.visible = false
        scene.add(spotPool)
        /** Where the spot is and where it is going, on the floor. */
        const spotAt = { x: 0, z: 0 }
        const spotGoal = { x: 0, z: 0 }
        let spotOn = false
        const spotlightAudio = new Audio("/spotlight.mp3")
        spotlightAudio.preload = "auto"
        const spotlightPlayer = new PresentationAudioPlayer(spotlightAudio)
        const suspenseAudio = new Audio("/suspense_music.mp3")
        suspenseAudio.preload = "auto"
        suspenseAudio.loop = true
        const suspensePlayer = new PresentationAudioPlayer(suspenseAudio)
        // The fireworks' cues: one recording per place, each the length of its
        // volley, played on every screen at the room's effects volume like the
        // spotlight — the point is a room that hears the finale, not one laptop.
        const fireworksAudio = ([3, 2, 1] as const).map((place) => {
            const audio = new Audio(fireworksCueFor(place))
            audio.preload = "auto"
            return { place, audio, player: new PresentationAudioPlayer(audio) }
        })
        const fireworksPlayer = (place: 1 | 2 | 3) =>
            fireworksAudio.find((entry) => entry.place === place)!.player
        // The victory music, one track per place like the cues. Only one plays at
        // a time: reading the next place cuts the last place's music off.
        const victoryMusic = ([3, 2, 1] as const).map((place) => {
            const audio = new Audio(victoryMusicFor(place))
            audio.preload = "auto"
            return { place, audio, player: new PresentationAudioPlayer(audio) }
        })
        const unlockPresentationAudio = () => {
            spotlightPlayer.unlock()
            suspensePlayer.unlock()
            for (const entry of fireworksAudio) entry.player.unlock()
            for (const entry of victoryMusic) entry.player.unlock()
        }
        window.addEventListener("pointerdown", unlockPresentationAudio, { capture: true })
        window.addEventListener("keydown", unlockPresentationAudio, { capture: true })
        registerCleanup(() => {
            window.removeEventListener("pointerdown", unlockPresentationAudio, { capture: true })
            window.removeEventListener("keydown", unlockPresentationAudio, { capture: true })
            spotlightAudio.pause()
            spotlightAudio.removeAttribute("src")
            spotlightAudio.load()
            suspenseAudio.pause()
            suspenseAudio.removeAttribute("src")
            suspenseAudio.load()
            for (const { audio } of [...fireworksAudio, ...victoryMusic]) {
                audio.pause()
                audio.removeAttribute("src")
                audio.load()
            }
        })
        /** 0..1, the light's fade — eased towards spotOn each frame. */
        let spotLevel = 0
        const placeSpot = () => {
            spot.position.set(spotAt.x, SPOT_HEIGHT, spotAt.z)
            spot.target.position.set(spotAt.x, 0, spotAt.z)
            spotBeam.position.set(spotAt.x, SPOT_HEIGHT / 2, spotAt.z)
            spotPool.position.set(spotAt.x, 0.045, spotAt.z)
        }

        // ---- fireworks -----------------------------------------------------------
        // The display over the city for the winners' ceremony. The simulation lives
        // in fireworks.ts; this is one Points buffer it is copied into each frame,
        // additive and untonemapped so the sparks burn past white and the bloom
        // pass catches them. Nothing is allocated per burst.
        const fireworks = createFireworks()
        const fireworkPositions = new Float32Array(MAX_SPARKS * 3)
        const fireworkColors = new Float32Array(MAX_SPARKS * 3)
        const fireworkGeo = track(new THREE.BufferGeometry())
        fireworkGeo.setAttribute("position", new THREE.BufferAttribute(fireworkPositions, 3).setUsage(THREE.DynamicDrawUsage))
        fireworkGeo.setAttribute("color", new THREE.BufferAttribute(fireworkColors, 3).setUsage(THREE.DynamicDrawUsage))
        fireworkGeo.setDrawRange(0, 0)
        const fireworkMat = track(new THREE.PointsMaterial({
            size: 1.15,
            map: track(makeSparkTexture()),
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            fog: false,
        }))
        const fireworkPoints = new THREE.Points(fireworkGeo, fireworkMat)
        // The bounding sphere would have to be recomputed every frame the display
        // moves; the display is a handful of draw calls either way.
        fireworkPoints.frustumCulled = false
        fireworkPoints.visible = false
        scene.add(fireworkPoints)
        /** The volleys already fired this ceremony (`nonce:place`), so a state
         * frame that repeats a place does not fire it twice. */
        const firedVolleys = new Set<string>()
        const fireworkColor = new THREE.Color()
        const updateFireworks = (dt: number, nowMs: number) => {
            const idle = fireworks.pending.length === 0 && fireworks.shells.length === 0 && fireworks.sparks.length === 0
            if (idle) {
                fireworkPoints.visible = false
                return
            }
            stepFireworks(fireworks, dt, nowMs, Math.random)
            let n = 0
            const put = (x: number, y: number, z: number, color: number, brightness: number) => {
                if (n >= MAX_SPARKS) return
                fireworkPositions[n * 3] = x
                fireworkPositions[n * 3 + 1] = y
                fireworkPositions[n * 3 + 2] = z
                fireworkColor.setHex(color).multiplyScalar(brightness)
                fireworkColors[n * 3] = fireworkColor.r
                fireworkColors[n * 3 + 1] = fireworkColor.g
                fireworkColors[n * 3 + 2] = fireworkColor.b
                n++
            }
            // A rising shell is a bright white-gold point; a spark fades with its
            // life, and the few embers each burst throws burn brighter for longer.
            for (const shell of fireworks.shells) put(shell.x, shell.y, shell.z, 0xfff3d0, 2.4)
            for (const spark of fireworks.sparks) {
                const fade = spark.life / spark.maxLife
                put(spark.x, spark.y, spark.z, spark.color, fade * fade * (spark.size > 0.5 ? 3.2 : 2.2))
            }
            ; (fireworkGeo.attributes["position"] as THREE.BufferAttribute).needsUpdate = true
                ; (fireworkGeo.attributes["color"] as THREE.BufferAttribute).needsUpdate = true
            fireworkGeo.setDrawRange(0, n)
            fireworkPoints.visible = n > 0
        }

        // ------------------------------------------------------------ tables

        const tableTopMaterials = new Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>()
        const tableMaterial = (
            competing: boolean | undefined,
            colorFor: (competing?: boolean) => number,
            cache: Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>,
            roughness = 0.8,
        ) => {
            const color = colorFor(competing)
            let material = cache.get(color)
            if (!material) {
                material = track(surfaceMaterial({ color, roughness }))
                cache.set(color, material)
            }
            return material
        }
        const tableLegMaterials = new Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>()
        const exhibitionAccentMat = track(surfaceMaterial({ color: 0x65d9c8, roughness: 0.38, metalness: 0.35 }))
        const chairMat = track(surfaceMaterial({ color: 0x223060, roughness: 0.75 }))
        const chairLegMat = track(surfaceMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.4 }))
        const tableTopGeo = track(new THREE.BoxGeometry(5.5, 0.24, 3))
        const tableLegGeo = track(new THREE.BoxGeometry(0.28, 1.45, 0.28))
        const chairSeatGeo = track(new THREE.BoxGeometry(0.85, 0.14, 0.85))
        const chairBackGeo = track(new THREE.BoxGeometry(0.85, 0.95, 0.12))
        const chairLegGeo = track(new THREE.BoxGeometry(0.1, 0.62, 0.1))
        const laptopBaseGeo = track(new THREE.BoxGeometry(0.78, 0.06, 0.55))
        const exhibitionInlayGeo = track(new THREE.BoxGeometry(4.85, 0.018, 0.075))
        const laptopAccentGeo = track(new THREE.BoxGeometry(0.26, 0.012, 0.045))
        const laptopScreenGeo = track(new THREE.PlaneGeometry(0.72, 0.48))
        const laptopBodyMat = track(surfaceMaterial({ color: 0x22283e, roughness: 0.4, metalness: 0.5 }))
        const laptopGlowMats = [0x54ffd8, 0x86ff6a, 0x6ab6ff].map((c) =>
            track(new THREE.MeshBasicMaterial({ color: c, toneMapped: false })),
        )
        const contactShadowTex = track(makeCanvasTexture(64, 64, (ctx) => {
            const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32)
            g.addColorStop(0, "rgba(0,0,0,0.42)")
            g.addColorStop(1, "rgba(0,0,0,0)")
            ctx.fillStyle = g
            ctx.fillRect(0, 0, 64, 64)
        }))
        const contactShadowMat = track(new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false }))
        const contactShadowGeo = track(new THREE.PlaneGeometry(1, 1))

        /**
         * The room furniture that stands between the camera and the wall screen —
         * the team tables. Framing the screen stands them down
         * so they stop covering the band the standings are written in; backing out
         * puts them back. Collected as they are built rather than searched for by
         * name, so a new piece of furniture in front of the screen only has to be
         * pushed here.
         */
        const screenOccluders: THREE.Object3D[] = []
        const tableHitboxes: THREE.Mesh[] = []
        const hitboxGeo = track(new THREE.BoxGeometry(6.4, 2.6, 4))
        const hitboxMat = track(new THREE.MeshBasicMaterial({ visible: false }))
        const initialTeamCounts = PARTICIPANT_TABLES.map((_, teamIdx) =>
            opts.players.filter((player) => player.teamIdx === teamIdx).length,
        )
        const labelSprites: Array<{
            sprite: THREE.Sprite
            baseLabel: string
            normal: THREE.Texture
            gold: THREE.Texture
            hasTeam: boolean
        }> = []

        /** Is there a team behind the desk at this index, or is it just furniture? */
        const hasTeamAt = (ti: number) => tableHasTeam(ti, opts.teamLabels.length)

        // ---- floating rank numerals -------------------------------------------
        // One extruded block per lit pixel of a 3×5 digit (rank-numerals.ts), merged
        // into a single ExtrudeGeometry so a numeral is one draw call. Geometry is
        // cached by placing and material by colour: ten desks share at most ten
        // numerals and four colours between them, and both survive the standings
        // moving — a rank change swaps which cached pair a desk points at rather
        // than building anything.
        const rankGeoCache = new Map<number, THREE.ExtrudeGeometry>()
        const rankMatCache = new Map<number, THREE.MeshStandardMaterial>()
        const rankGeometry = (rank: number): THREE.ExtrudeGeometry => {
            let geo = rankGeoCache.get(rank)
            if (!geo) {
                const { cells } = rankNumeralCells(rank)
                const shapes = cells.map((cell) => {
                    // Each cell carries its own edge length: the ordinal suffix is set as
                    // a smaller superscript, so the grid is not uniform.
                    const half = (cell.size * RANK_CELL) / 2
                    const shape = new THREE.Shape()
                    shape.moveTo(cell.x * RANK_CELL - half, cell.y * RANK_CELL - half)
                    shape.lineTo(cell.x * RANK_CELL + half, cell.y * RANK_CELL - half)
                    shape.lineTo(cell.x * RANK_CELL + half, cell.y * RANK_CELL + half)
                    shape.lineTo(cell.x * RANK_CELL - half, cell.y * RANK_CELL + half)
                    shape.closePath()
                    return shape
                })
                geo = new THREE.ExtrudeGeometry(shapes, { depth: RANK_DEPTH, bevelEnabled: false })
                // rankNumeralCells centres the numeral on the origin in X and Y; the
                // extrusion only grows forward, so this centres it in Z as well and the
                // sway turns about the numeral's middle instead of its back face.
                geo.translate(0, 0, -RANK_DEPTH / 2)
                rankGeoCache.set(rank, track(geo))
            }
            return geo
        }
        const numeralMaterial = (color: number): THREE.MeshStandardMaterial => {
            let mat = rankMatCache.get(color)
            if (!mat) {
                // Lit like the furniture, but glowing enough to hold its colour in the
                // room's warm gloom. Kept matte and barely
                // metallic on purpose: a specular highlight this close to a desk pool
                // is what turns a digit into a blob.
                mat = track(new THREE.MeshStandardMaterial({
                    color,
                    emissive: color,
                    emissiveIntensity: 0.5,
                    roughness: 0.6,
                    metalness: 0.1,
                }))
                rankMatCache.set(color, mat)
            }
            return mat
        }

        /** One desk's numeral, or null while that desk has no placing. */
        const rankNumerals = new Map<number, THREE.Mesh>()
        /** The desk group each numeral hangs in, so a placing can arrive later. */
        const tableGroups = new Map<number, THREE.Group>()

        /**
         * Hang a numeral over a desk — a placing in its medal colour, or during
         * presentations the desk's slot in the running order in the presentation
         * colour — or take it down with null.
         *
         * A number outside 1..99 is not one this room can draw (rankNumeralCells
         * throws on it), so it is treated the same as having none. `pop` scales the
         * numeral in from nothing: the spotlight has just landed on this desk.
         */
        const applyDeskNumeral = (ti: number, number: number | null, color: number, pop = false) => {
            const existing = rankNumerals.get(ti)
            if (number === null || !Number.isInteger(number) || number < 1 || number > 99) {
                if (existing) {
                    existing.parent?.remove(existing)
                    rankNumerals.delete(ti)
                }
                return
            }
            const group = tableGroups.get(ti)
            if (!group || !hasTeamAt(ti)) return
            const geometry = rankGeometry(number)
            const material = numeralMaterial(color)
            const unchanged = existing?.geometry === geometry && existing.material === material
            const mesh = existing ?? new THREE.Mesh(geometry, material)
            mesh.geometry = geometry
            mesh.material = material
            // Every placing is the same shape, so every desk's numeral hangs at the
            // one height — and the bob works from here rather than from wherever the
            // last frame left it.
            mesh.position.set(0, RANK_NUMERAL_Y, RANK_NUMERAL_Z)
            mesh.userData.baseY = RANK_NUMERAL_Y
            mesh.castShadow = false
            if (pop && !unchanged) {
                mesh.userData.popAt = performance.now()
                mesh.scale.setScalar(0.001)
            }
            if (!existing) {
                group.add(mesh)
                rankNumerals.set(ti, mesh)
            }
        }

        /** The standings, as the leaderboard poll last handed them over. */
        let teamRanks: readonly (number | null)[] = opts.teamRanks ?? []
        /** The presentation running order, by desk, while there is one. */
        let presentation: RoomPresentation | null = null
        /** The winners' ceremony, by desk, while one is running. */
        let winners: RoomWinners | null = null
        /** How many slots the room had revealed at the last refresh, so the tick
         * can tell when the sweep has reached another desk. -1 forces a refresh. */
        let presentationRevealed = -1

        /**
         * Every desk's numeral, from the standings and — over them — the running
         * order: a desk whose slot the sweep has reached wears that slot in the
         * presentation colour instead of its placing. Every desk is visited, not
         * just the ones with a number: a team that drops off the leaderboard has to
         * lose its numeral too.
         */
        const refreshDeskNumerals = (pop = false) => {
            const slots = presentation ? presentationSlotsByTeamIdx(presentation, opts.teamLabels.length) : null
            const revealed = presentation ? revealProgress(presentation, Date.now()).revealed : 0
            const podium = winners ? podiumByTeamIdx(winners, opts.teamLabels.length) : null
            PARTICIPANT_TABLES.forEach((_, ti) => {
                // Through the ceremony the desks wear the podium and nothing else: a
                // live placing over the desk would read out first place before the
                // gamemaster does.
                if (podium) {
                    const place = podium[ti] ?? null
                    applyDeskNumeral(ti, place, place === null ? 0 : rankNumeralColor(place), pop)
                    return
                }
                const slot = slots?.[ti] ?? null
                if (slot !== null && slot <= revealed) {
                    // Green once they have presented, hot pink while they are still to
                    // come: the desks alone say how far down the order the room has got.
                    const done = presentation !== null && isDeskDone(presentation, ti)
                    applyDeskNumeral(ti, slot, done ? PRESENTATION_DONE_COLOR : PRESENTATION_COLOR, pop)
                    return
                }
                const rank = teamRanks[ti] ?? null
                applyDeskNumeral(ti, rank, rank === null ? 0 : rankNumeralColor(rank))
            })
        }

        // Faded twins of the furniture materials, one per original, so the unused
        // desks read as switched off without every desk paying for its own copy.
        const fadedMaterials = new Map<THREE.Material, THREE.Material>()
        const fadedMaterial = (source: THREE.Material): THREE.Material => {
            let faded = fadedMaterials.get(source)
            if (!faded) {
                faded = source.clone()
                faded.transparent = true
                faded.opacity = (source.opacity ?? 1) * EMPTY_TABLE_FADE
                const tinted = faded as THREE.Material & { color?: THREE.Color }
                tinted.color?.multiplyScalar(EMPTY_TABLE_FADE)
                fadedMaterials.set(source, track(faded))
            }
            return faded
        }
        const fadeTable = (group: THREE.Group) => {
            group.traverse((object) => {
                if (!(object instanceof THREE.Mesh)) return
                // The hitbox is already invisible, and an unused desk has none anyway.
                if (object.material === hitboxMat) return
                object.material = fadedMaterial(object.material as THREE.Material)
                object.castShadow = false
                object.receiveShadow = false
            })
        }

        const chairAt = (group: THREE.Group | THREE.Scene, dx: number, dz: number, rotY: number) => {
            const chair = new THREE.Group()
            const seat = new THREE.Mesh(chairSeatGeo, chairMat)
            seat.position.y = 0.66
            seat.castShadow = true
            chair.add(seat)
            const back = new THREE.Mesh(chairBackGeo, chairMat)
            back.position.set(0, 1.12, -0.38)
            back.castShadow = true
            chair.add(back)
            for (const [lx, lz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]] as const) {
                const leg = new THREE.Mesh(chairLegGeo, chairLegMat)
                leg.position.set(lx, 0.31, lz)
                chair.add(leg)
            }
            chair.position.set(dx, 0, dz)
            chair.rotation.y = rotY
            group.add(chair)
        }

        PARTICIPANT_TABLES.forEach((tbl, ti) => {
            const cx = toX(tbl.x + tbl.w / 2)
            const cz = toZ(tbl.y + tbl.h / 2)
            const hasTeam = hasTeamAt(ti)
            const exhibitionDesk = hasTeam && isExhibitionDesk(ti, opts.teamCompeting)
            const group = new THREE.Group()
            group.position.set(cx, 0, cz)

            const top = new THREE.Mesh(
                tableTopGeo,
                tableMaterial(opts.teamCompeting?.[ti], tableTopColorForCompetition, tableTopMaterials),
            )
            top.position.y = 1.5
            top.castShadow = true
            top.receiveShadow = true
            group.add(top)
            // Exhibition desks keep the same silhouette and lighting, with pale
            // furniture finishes plus a slim teal inlay and matching laptop marks.
            if (exhibitionDesk) {
                const inlay = new THREE.Mesh(exhibitionInlayGeo, exhibitionAccentMat)
                inlay.position.set(0, 1.632, -1.28)
                group.add(inlay)
            }
            for (const [lx, lz] of [[-2.45, -1.2], [2.45, -1.2], [-2.45, 1.2], [2.45, 1.2]] as const) {
                const leg = new THREE.Mesh(
                    tableLegGeo,
                    tableMaterial(opts.teamCompeting?.[ti], tableLegColorForCompetition, tableLegMaterials, 0.85),
                )
                leg.position.set(lx, 0.72, lz)
                leg.castShadow = true
                group.add(leg)
            }

            // soft contact shadow to ground the table
            const cShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat)
            cShadow.rotation.x = -Math.PI / 2
            cShadow.scale.set(7.2, 4.6, 1)
            cShadow.position.y = 0.011
            group.add(cShadow)

                // two glowing laptops per table, angled toward each long side
                ;[[-1.25, 0.32, 1], [1.25, -0.32, -1]].forEach(([lx, lz, side], li) => {
                    const base = new THREE.Mesh(laptopBaseGeo, laptopBodyMat)
                    base.position.set(lx!, 1.65, lz!)
                    base.rotation.y = side! > 0 ? 0.35 : Math.PI - 0.35
                    group.add(base)
                    if (exhibitionDesk) {
                        const accent = new THREE.Mesh(laptopAccentGeo, exhibitionAccentMat)
                        accent.position.set(0, 0.037, side! * 0.15)
                        base.add(accent)
                    }
                    const scr = new THREE.Mesh(laptopScreenGeo, laptopGlowMats[(ti + li) % laptopGlowMats.length]!)
                    scr.position.set(lx!, 1.9, lz! - side! * 0.26)
                    scr.rotation.y = side! > 0 ? 0.35 : Math.PI - 0.35
                    scr.rotation.x = -0.28 * side!
                    group.add(scr)
                })

            chairAt(group, 0, -2.15, Math.PI)
            chairAt(group, 0, 2.15, 0)
            chairAt(group, -3.3, 0, Math.PI / 2)
            chairAt(group, 3.3, 0, -Math.PI / 2)

            // Only a desk with a team is a target: no hitbox means no hover, no
            // highlight while dragging, and no drop that could not have been saved.
            if (hasTeam) {
                const hit = new THREE.Mesh(hitboxGeo, hitboxMat)
                hit.position.y = 1.3
                hit.userData.tableIdx = ti
                group.add(hit)
                tableHitboxes.push(hit)
            }

            const baseLabel = opts.teamLabels[ti] ?? EMPTY_TABLE_LABEL
            const label = tableLabelText(ti, opts.teamLabels, {
                count: initialTeamCounts[ti] ?? 0,
                showCount: interactionMode === "assign",
            })
            const normal = makeLabelTexture(label, false, !hasTeam)
            const gold = makeLabelTexture(label, true)
            const labelMat = track(new THREE.SpriteMaterial({ map: normal, depthTest: true }))
            const sprite = new THREE.Sprite(labelMat)
            sprite.scale.set(2.9, 0.8, 1)
            sprite.position.set(0, AREA_LABEL_Y, 0)
            group.add(sprite)
            if (!hasTeam) fadeTable(group)
            // Registered before the numeral goes in: applyDeskNumeral hangs it in the
            // desk's own group, so it pans, fades and disposes with the desk.
            tableGroups.set(ti, group)
            screenOccluders.push(group)
            {
                const rank = opts.teamRanks?.[ti] ?? null
                applyDeskNumeral(ti, rank, rank === null ? 0 : rankNumeralColor(rank))
            }
            const labelState = { sprite, baseLabel, normal, gold, hasTeam }
            labelSprites.push(labelState)
            registerCleanup(() => {
                labelState.normal.dispose()
                labelState.gold.dispose()
            })

            scene.add(group)
        })

        // gold highlight square under the selected table
        const highlight = new THREE.Mesh(
            track(new THREE.PlaneGeometry(7.4, 4.9)),
            track(new THREE.MeshBasicMaterial({ map: track(makeHighlightTexture()), transparent: true, depthWrite: false, toneMapped: false })),
        )
        highlight.rotation.x = -Math.PI / 2
        highlight.position.y = 0.02
        highlight.visible = false
        scene.add(highlight)

        // The proximity outline: what the interact button would answer right now.
        // A 1x1 plane scaled per target, so one mesh serves a desk footprint and a
        // plant's base alike. A character keeps the hover tag it already has, and
        // the wall screen is up on the wall rather than on the floor, so neither
        // gets an outline — this marks the things whose target is a floor patch.
        const interactHighlight = new THREE.Mesh(
            track(new THREE.PlaneGeometry(1, 1)),
            track(new THREE.MeshBasicMaterial({
                map: track(makeHighlightTexture()),
                transparent: true,
                depthWrite: false,
                toneMapped: false,
            })),
        )
        interactHighlight.rotation.x = -Math.PI / 2
        interactHighlight.position.y = 0.03
        interactHighlight.visible = false
        scene.add(interactHighlight)

        const destinationHighlights = PARTICIPANT_TABLES.map((tbl) => {
            const mesh = new THREE.Mesh(
                track(new THREE.PlaneGeometry(6.6, 4.25)),
                track(new THREE.MeshBasicMaterial({
                    color: 0x5070e0,
                    transparent: true,
                    opacity: 0.18,
                    depthWrite: false,
                    toneMapped: false,
                })),
            )
            mesh.rotation.x = -Math.PI / 2
            mesh.position.set(toX(tbl.x + tbl.w / 2), 0.015, toZ(tbl.y + tbl.h / 2))
            mesh.visible = false
            scene.add(mesh)
            return mesh
        })

        // ------------------------------------------------------------ characters

        // Footprint grows with the cast — a shadow narrower than the feet above it
        // reads as a character hovering.
        const blobGeo = track(new THREE.PlaneGeometry(1.1 * CHARACTER_SCALE, 0.6 * CHARACTER_SCALE))
        const blobMat = track(new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false, opacity: 0.9 }))
        const haloGeo = track(new THREE.RingGeometry(0.55, 0.82, 24))
        const makePresenceHalo = (role: RoomRole | undefined) => {
            const halo = new THREE.Mesh(
                haloGeo,
                track(new THREE.MeshBasicMaterial({
                    color: roleHaloColor(role),
                    transparent: true,
                    opacity: 0.8,
                    depthWrite: false,
                    toneMapped: false,
                })),
            )
            halo.rotation.x = -Math.PI / 2
            halo.position.y = 0.03
            halo.visible = false
            scene.add(halo)
            return halo
        }

        // Decode each distinct generated sheet (data URL) once; a sheet that fails
        // to decode just leaves its player on the built-in fallback.
        const customTex = new Map<string, THREE.Texture>()
        await Promise.all(
            opts.players.map(async (p) => {
                const r = resolveSprite(p.spriteId, p.spriteSheet, p.playerIdx, p.teamIdx ?? 0)
                if (r.kind !== "custom" || customTex.has(r.sheetDataUrl)) return
                try {
                    customTex.set(r.sheetDataUrl, track(await loadTexture(loader, r.sheetDataUrl)))
                } catch (err) {
                    logger.warn("room3d.sprite_decode_failed", err)
                }
            }),
        )

        let fallbackLobbyOrdinal = 0
        const chars: CharState[] = opts.players.map((p) => {
            const localLobbyOrdinal = p.teamIdx === null ? fallbackLobbyOrdinal++ : null
            const resolved = resolveSprite(p.spriteId, p.spriteSheet, p.playerIdx, p.teamIdx ?? 0)
            const custom = resolved.kind === "custom" ? customTex.get(resolved.sheetDataUrl) : undefined

            // Whether the sheet came from the pipeline or the assets folder no longer
            // decides how it is drawn — its own dimensions do.
            let source: THREE.Texture
            if (custom) {
                source = custom
            } else {
                const sheetIdx =
                    resolved.kind === "builtin"
                        ? resolved.charIdx
                        : characterIdForPlayer(p.playerIdx, p.teamIdx ?? 0)
                source = charSheets[sheetIdx % charSheets.length]!
            }
            const img = source.image as HTMLImageElement
            const format = sheetFormatFor(img.width, img.height)
            const tex = track(source.clone())
            tex.repeat.set(1 / format.cols, 1 / format.rows)
            const material = track(new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }))
            const mesh = new THREE.Mesh(planeForSheet(format), material)
            mesh.userData.playerIdx = p.playerIdx
            const blob = new THREE.Mesh(blobGeo, blobMat)
            blob.rotation.x = -Math.PI / 2
            blob.position.y = characterShadowLocalY(format)
            mesh.add(blob)
            const presenceHalo = makePresenceHalo(p.role)
            scene.add(mesh)
            const wander = seedWander(p.playerIdx, p.teamIdx ?? 0, p.seatIdx)
            return {
                mesh,
                material,
                texture: tex,
                format,
                phase: wander.phase,
                speed: wander.speed,
                pauseLeft: wander.pauseLeft,
                rng: wander.rng,
                teamIdx: p.teamIdx,
                lobbyOrdinal:
                    p.teamIdx === null
                        ? p.lobbyOrdinal ?? localLobbyOrdinal
                        : null,
                playerIdx: p.playerIdx,
                draggable: p.draggable,
                busy: false,
                name: p.name,
                role: p.role ?? "student",
                presenceHalo,
                x: 0,
                z: 0,
                transition: null,
                net: null,
            }
        })
        const charByPlayerIdx = new Map(chars.map((c) => [c.playerIdx, c]))

        // ------------------------------------------------------------ the snap
        // Who has been dusted (hidden, unpickable, uninteractable) and the fade
        // in progress. The motes share one Points buffer, built to the size of
        // each snap and thrown away when it settles. The set is never written to
        // anything, so a reload brings everyone back.
        const snapped = new Set<CharState>()
        let snapDissolve: SnapDissolve | null = null
        let snapDust: { points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.PointsMaterial; positions: Float32Array } | null = null
        const snapDustTexture = track(makeSparkTexture())
        const clearSnapDust = () => {
            if (!snapDust) return
            scene.remove(snapDust.points)
            snapDust.geo.dispose()
            snapDust.mat.dispose()
            snapDust = null
        }
        registerCleanup(clearSnapDust)
        /** The characters still standing that a snap can take: not you. */
        const standing = () => chars.filter((c) => c !== localChar && !snapped.has(c))
        const snapHalfTheRoom = () => {
            // A snap over a snap: whoever is mid-fade counts as taken already.
            if (snapDissolve) return
            const taken = new Set(chooseSnapped(standing().map((c) => c.playerIdx), Math.random))
            const targets = chars.filter((c) => taken.has(c.playerIdx))
            if (targets.length === 0) return
            for (const c of targets) {
                snapped.add(c)
                // The sprite is cut out with alphaTest, which turns opacity into a
                // cliff at 0.5; lowering it lets the fade run all the way down.
                c.material.alphaTest = 0.02
                c.material.depthWrite = false
                c.material.needsUpdate = true
                c.presenceHalo.visible = false
                if (hoverPlayerIdx === c.playerIdx) setHoveredPlayer(null)
            }
            snapDissolve = createSnapDissolve(
                targets.map((c) => {
                    const { width, height } = characterPlaneSize(c.format)
                    return { id: c.playerIdx, x: c.x, y: c.mesh.position.y, z: c.z, w: width, h: height }
                }),
                Math.random,
            )
            clearSnapDust()
            const positions = new Float32Array(snapDissolve.dustCapacity * 3)
            const geo = new THREE.BufferGeometry()
            geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
            geo.setDrawRange(0, 0)
            // Sized for the room's usual camera distance: any smaller and the cloud
            // is a shimmer nobody notices from the default view.
            const mat = new THREE.PointsMaterial({
                size: 1.1,
                color: 0xe6dcc6,
                map: snapDustTexture,
                transparent: true,
                opacity: 0.95,
                depthWrite: false,
                fog: false,
            })
            const points = new THREE.Points(geo, mat)
            points.frustumCulled = false
            points.renderOrder = 21
            scene.add(points)
            snapDust = { points, geo, mat, positions }
        }
        /** One frame of the fade, AFTER the characters have been placed: it
         * lifts and fades the taken ones over wherever they are this frame. */
        const stepSnap = (frameMs: number) => {
            if (!snapDissolve) return
            const frame = snapDissolve.advance(frameMs)
            for (const f of frame.chars) {
                const c = charByPlayerIdx.get(f.id)
                if (!c) continue
                c.material.opacity = f.alpha
                c.mesh.position.y += f.lift
                c.mesh.visible = !f.gone
            }
            if (snapDust) {
                const { positions, geo, mat, points } = snapDust
                frame.dust.forEach((d, i) => {
                    positions[i * 3] = d.x
                    positions[i * 3 + 1] = d.y
                    positions[i * 3 + 2] = d.z
                })
                geo.setDrawRange(0, frame.dust.length)
                    ; (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
                points.visible = frame.dust.length > 0
                if (frame.dust.length > 0) {
                    mat.opacity = 0.95 * frame.dust.reduce((sum, d) => sum + d.alpha, 0) / frame.dust.length
                }
            }
            if (frame.done) {
                snapDissolve = null
                clearSnapDust()
            }
        }

        const authoritativePosition = (c: CharState) => {
            // A character who is standing rather than walking a lap faces the camera:
            // these all used to pin dir 0, which is the row drawn from BEHIND.
            if (c.teamIdx === null) {
                if (assignmentLayout) return lobbyPosition(c.lobbyOrdinal ?? 0, assignmentLayout)
                return { x: c.x, z: c.z, dir: FACING_CAMERA }
            }
            const tbl = PARTICIPANT_TABLES[c.teamIdx]
            if (!tbl) return { x: c.x, z: c.z, dir: FACING_CAMERA }
            // c.speed carries the direction of the orbit, so an anticlockwise walker
            // faces the way it is actually going rather than moonwalking its lap.
            const pos = walkPos(c.phase, tbl, c.speed)
            return { x: toX(pos.x), z: toZ(pos.y), dir: pos.dir }
        }

        const snapToAuthoritativeHome = (c: CharState) => {
            const home = authoritativePosition(c)
            c.x = home.x
            c.z = home.z
            c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
        }

        // ---------------------------------------------------- multiplayer: local control

        // Movement runs in the 2D room plan's px space (where the shared collision
        // geometry lives) and is projected into world units for rendering.
        const toPxX = (x: number) => (x + ROOM_W / 2) * TILE
        const toPxY = (z: number) => z * TILE + WALL_Y
        const colliders = buildStaticColliders()
        /** `?noclip=1`: walk through the furniture and out through the walls.
         * Local only — the hub still validates what we report, so nobody else
         * sees the room leak. See ./noclip.ts. */
        const noclip = parseNoclipOverride(window.location.search)

        let localChar: CharState | null = null
        const localInput = createRoomLocalInput()
        const localPx = { x: 0, y: 0 }
        let localDir: WalkDir = FACING_CAMERA
        let localMoving = false
        let lastSelfSentAt = 0
        let lastSelfSent: RoomSelfState | null = null
        /** A floor drag looks away from the character; the next movement key hands
         * the camera back to the follow-cam. */
        let cameraFollowSuspended = false
        /** Mid-conversation: movement and interact are locked until this passes.
         * The hub enforces the same freeze; this keeps the local prediction from
         * drifting away from it. */
        let inputFrozenUntil = 0

        /** How much of the gap to a remote character's hub position survives one sim
         * step — snapshots land at 10 Hz, so this closes most of a gap between two
         * of them without the jitter of hard snapping. */
        const NET_KEEP_PER_STEP = 0.86
        /** Beyond this (world units), stop gliding and teleport — a reconnect or a
         * disconnect hand-back, not ordinary movement. */
        const NET_SNAP_DIST = 7
        /** Farther than this from its lap when handed back to the wander, a
         * character hops home over a beat instead of appearing there. */
        const WANDER_HOP_DIST = 1.5

        const stepLocalControl = () => {
            if (!localInput.canInteract() || performance.now() < inputFrozenUntil) {
                localMoving = false
                return
            }
            const { dx, dy } = localInput.movement()
            const active = dx !== 0 || dy !== 0
            localMoving = active
            if (!active) return
            cameraFollowSuspended = false
            const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1
            const step = PLAYER_SPEED_PX_PER_STEP * norm
            if (noclip) {
                // Integrate the raw input: no colliders, and no ROOM_BOUNDS either
                // (that clamp lives inside pointBlocked, so going through
                // movePlayer with an empty collider list would still fence us
                // into the carpet).
                localPx.x += dx * step
                localPx.y += dy * step
            } else {
                const moved = movePlayer(localPx.x, localPx.y, dx * step, dy * step, colliders)
                localPx.x = moved.x
                localPx.y = moved.y
            }
            localDir = facingForInput(dx, dy, localDir)
        }

        /** Everything the point-probe tier can hit: the other characters, the room's
         * objects, and the wall screen. Shared by the interact button and the
         * proximity outline, so the two always ask the same question. */
        const probeCandidates = (): ProbeCandidate[] => {
            const candidates: ProbeCandidate[] = []
            for (const c of standing()) {
                candidates.push({ key: c.playerIdx, x: toPxX(c.x), y: toPxY(c.z) })
            }
            // Objects share the probe with characters, keyed into their own idx range.
            ROOM_OBJECTS.forEach((obj, i) => {
                candidates.push({ key: OBJECT_IDX_BASE + i, x: obj.x, y: obj.y })
            })
            // The wall screen is a target too, but a private one.
            candidates.push({ key: BIG_SCREEN_IDX, x: BIG_SCREEN_POINT.x, y: BIG_SCREEN_POINT.y })
            // So is Primey — same private treatment, for the same reason.
            if (primeyVisible) candidates.push({ key: PRIMEY_IDX, x: PRIMEY_POINT.x, y: PRIMEY_POINT.y })
            // And the arcade cabinet, only while this client can see it.
            if (arcadeVisible) candidates.push({ key: ARCADE_IDX, x: ARCADE_POINT.x, y: ARCADE_POINT.y })
            return candidates
        }

        /** What the interact button would answer right now, or null. */
        const currentInteractTarget = (): RoomInteractTarget | null => {
            if (!localChar) return null
            return resolveRoomInteract(
                { x: localPx.x, y: localPx.y, dir: localDir },
                probeCandidates(),
                opts.teamLabels.length,
            )
        }

        const fireInteract = () => {
            // No onInteract gate here: the wall screen's page turns locally, so a
            // press is worth taking even with nobody listening on the hub side.
            if (!localChar) return
            if (!localInput.canInteract()) return
            if (performance.now() < inputFrozenUntil) return
            const hit = currentInteractTarget()
            if (!hit) return
            if (backroomsUnlocked && hit.kind !== "table" && roomObjectByIdx(hit.key)?.id === "plant-se") {
                localInput.releaseMovement()
                localMoving = false
                opts.onBackroomsEnter?.()
                return
            }
            // A desk opens local UI. Like the screen's page turn, it never reaches
            // the hub's interact wire.
            if (hit.kind === "table") {
                opts.onTableInteract?.(hit.tableIdx)
                return
            }
            // The screen answers interact by framing itself, and everything that
            // follows — the page turns, backing out again — is local too, so none of
            // it goes near the hub's interact wire.
            if (hit.key === BIG_SCREEN_IDX) {
                setScreenFocus(!screenFocused)
                return
            }
            // Primey answers by opening its chat panel over the room. Also local: the
            // conversation is this visitor's, not the room's.
            if (hit.key === PRIMEY_IDX) {
                opts.onPrimeyInteract?.()
                return
            }
            // The cabinet opens the fighter over the room. Local, like Primey.
            if (hit.key === ARCADE_IDX) {
                localInput.releaseMovement()
                localMoving = false
                opts.onArcadeInteract?.()
                return
            }
            opts.onInteract?.(hit.key)
        }

        /** Move the outline onto the current interact target, or hide it. Called
         * every frame — the probe is a handful of squared distances. */
        const updateInteractHighlight = () => {
            const target = currentInteractTarget()
            if (!target) {
                interactHighlight.visible = false
                return
            }
            if (target.kind === "table") {
                const tbl = PARTICIPANT_TABLES[target.tableIdx]
                if (!tbl) {
                    interactHighlight.visible = false
                    return
                }
                interactHighlight.scale.set(tbl.w / TILE + 1.4, tbl.h / TILE + 1.4, 1)
                interactHighlight.position.set(toX(tbl.x + tbl.w / 2), 0.03, toZ(tbl.y + tbl.h / 2))
                interactHighlight.visible = true
                return
            }
            // Primey is not in the hub's object list, so it needs its own answer here
            // — without one the outline would go dark on the one target in the room
            // that opens a whole panel.
            if (target.key === PRIMEY_IDX) {
                interactHighlight.scale.set(2.4, 2.4, 1)
                interactHighlight.position.set(toX(PRIMEY_POINT.x), 0.03, toZ(PRIMEY_POINT.y))
                interactHighlight.visible = true
                return
            }
            if (target.key === ARCADE_IDX) {
                interactHighlight.scale.set(2.4, 2.4, 1)
                interactHighlight.position.set(toX(ARCADE_POINT.x), 0.03, toZ(ARCADE_POINT.y))
                interactHighlight.visible = true
                return
            }
            const obj = roomObjectByIdx(target.key)
            if (!obj) {
                interactHighlight.visible = false
                return
            }
            interactHighlight.scale.set(2.4, 2.4, 1)
            interactHighlight.position.set(toX(obj.x), 0.03, toZ(obj.y))
            interactHighlight.visible = true
        }

        const isTextEntryTarget = (e: KeyboardEvent) => {
            const t = e.target
            return (
                t instanceof HTMLInputElement ||
                t instanceof HTMLTextAreaElement ||
                (t instanceof HTMLElement && t.isContentEditable)
            )
        }
        const MOVE_KEY: Record<string, RoomMoveDirection> = {
            w: "up", arrowup: "up",
            s: "down", arrowdown: "down",
            a: "left", arrowleft: "left",
            d: "right", arrowright: "right",
        }
        const onControlKeyDown = (e: KeyboardEvent) => {
            if (renderPaused) return
            if (!localChar || e.altKey || e.ctrlKey || e.metaKey || isTextEntryTarget(e)) return
            const key = e.key.toLowerCase()
            // While the screen is framed the walk keys read it instead of walking it:
            // left and right turn pages, down backs out AND walks away in the one
            // press, up has nothing but wall behind it.
            const framed = screenFocusKeyAction(key, screenFocused)
            if (framed) {
                e.preventDefault()
                applyFramedAction(framed)
                if (framed === "exit-and-move") localInput.setMoveInput("down", true)
                return
            }
            const move = MOVE_KEY[key]
            if (move) {
                localInput.setMoveInput(move, true)
                e.preventDefault()
                return
            }
            if (key === " " || key === "e") {
                // Space is the interact button (E stays as an alias; Enter belongs to
                // the chat box); preventDefault also keeps space from scrolling the page.
                e.preventDefault()
                if (e.repeat) return
                // Shift+Space is the snap's mic chord (useSnapMic), not an interact.
                if (e.shiftKey) return
                fireInteract()
            }
        }
        const onControlKeyUp = (e: KeyboardEvent) => {
            const move = MOVE_KEY[e.key.toLowerCase()]
            if (move) localInput.setMoveInput(move, false)
        }
        window.addEventListener("keydown", onControlKeyDown)
        window.addEventListener("keyup", onControlKeyUp)
        window.addEventListener("blur", localInput.releaseMovement)
        registerCleanup(() => {
            window.removeEventListener("keydown", onControlKeyDown)
            window.removeEventListener("keyup", onControlKeyUp)
            window.removeEventListener("blur", localInput.releaseMovement)
        })

        // Presence halos mark every character currently controlled by a connected
        // player; the local character uses the same role-coloured mesh as remotes.
        /** setLocalPlayer aimed at a guest character that has not finished
         * materializing; the guest creation path completes the hand-over. */
        let pendingLocal: { playerIdx: number; start?: { x: number; y: number } } | null = null

        const activateLocalControl = (next: CharState, start?: { x: number; y: number }) => {
            setScreenFocus(false)
            if (localChar) {
                // Hand the old character back to the hub/wander path from where it
                // stands; the net glide (or the next wander snap) takes it from here.
                localChar.net = null
            }
            localChar = next
            localInput.releaseMovement()
            localMoving = false
            lastSelfSent = null
            cameraFollowSuspended = false
            next.net = null
            next.transition = null
            // Start where the hub says the character is; fall back to its local
            // authoritative position.
            if (start) {
                localPx.x = start.x
                localPx.y = start.y
            } else {
                const home = authoritativePosition(next)
                localPx.x = toPxX(home.x)
                localPx.y = toPxY(home.z)
            }
            next.x = toX(localPx.x)
            next.z = toZ(localPx.y)
            localDir = FACING_CAMERA
            next.presenceHalo.visible = true
        }

        const releaseLocalControl = () => {
            setScreenFocus(false)
            if (localChar) {
                localChar.net = null
                localChar.presenceHalo.visible = false
            }
            localChar = null
            localInput.releaseMovement()
            localMoving = false
            lastSelfSent = null
        }

        // ------------------------------------------------------- multiplayer: speech

        const SPEECH_MS = 4_000
        const SPEECH_RISE = 1.34
        const speechBubbles = new Map<number, {
            sprite: THREE.Sprite
            material: THREE.SpriteMaterial
            texture: THREE.CanvasTexture
            expiresAt: number
        }>()
        const clearSpeech = (playerIdx: number) => {
            const bubble = speechBubbles.get(playerIdx)
            if (!bubble) return
            scene.remove(bubble.sprite)
            bubble.material.dispose()
            bubble.texture.dispose()
            speechBubbles.delete(playerIdx)
        }
        const showSpeechFor = (playerIdx: number, text: string) => {
            if (!charByPlayerIdx.has(playerIdx)) return
            clearSpeech(playerIdx)
            const texture = makeSpeechTexture(text)
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(4.6, 1.34, 1)
            sprite.renderOrder = 22
            scene.add(sprite)
            speechBubbles.set(playerIdx, { sprite, material, texture, expiresAt: performance.now() + SPEECH_MS })
        }
        /** A bubble over an interactable object (they share the bubble map — object
         * idxs live far above any playerIdx). Objects don't move, so the bubble is
         * placed once. */
        const showObjectSpeechFor = (objectIdx: number, text: string) => {
            const obj = roomObjectByIdx(objectIdx)
            if (!obj) return
            clearSpeech(objectIdx)
            const texture = makeSpeechTexture(text)
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(4.6, 1.34, 1)
            sprite.renderOrder = 22
            // above the corner plants' 3.4-unit billboards
            sprite.position.set(toX(obj.x), 4.15, toZ(obj.y))
            scene.add(sprite)
            speechBubbles.set(objectIdx, { sprite, material, texture, expiresAt: performance.now() + SPEECH_MS })
        }
        registerCleanup(() => {
            for (const playerIdx of [...speechBubbles.keys()]) clearSpeech(playerIdx)
        })

        // ------------------------------------------------------- multiplayer: guests

        // Visitors (admins, mentors, judges) get transient characters that exist
        // only while they are connected — created here at runtime, because the
        // page's own roster has never heard of them and rebuilding the WebGL scene
        // per join would black-flash the room.
        const guestPlayerIdxs = new Set<number>()

        const spawnGuestChar = (guest: {
            playerIdx: number
            name: string
            role?: RoomRole
            spriteId?: number | null
            spriteSheet?: string | null
            start?: { x: number; y: number }
        }) => {
            if (guestPlayerIdxs.has(guest.playerIdx) || charByPlayerIdx.has(guest.playerIdx)) return
            guestPlayerIdxs.add(guest.playerIdx)
            void (async () => {
                const resolved = resolveSprite(guest.spriteId, guest.spriteSheet, guest.playerIdx, 0)
                let source: THREE.Texture | null = null
                if (resolved.kind === "custom") {
                    source = customTex.get(resolved.sheetDataUrl) ?? null
                    if (!source) {
                        try {
                            source = await loadTexture(loader, resolved.sheetDataUrl)
                            customTex.set(resolved.sheetDataUrl, track(source))
                        } catch (err) {
                            logger.warn("room3d.guest_decode_failed", err)
                        }
                    }
                }
                if (!source) {
                    const sheetIdx =
                        resolved.kind === "builtin"
                            ? resolved.charIdx
                            : characterIdForPlayer(guest.playerIdx, 0)
                    source = charSheets[sheetIdx % charSheets.length]!
                }
                // Departed (or the scene died) while the sheet was decoding.
                if (cleanedUp || !guestPlayerIdxs.has(guest.playerIdx) || charByPlayerIdx.has(guest.playerIdx)) return

                const img = source.image as HTMLImageElement
                const format = sheetFormatFor(img.width, img.height)
                const tex = source.clone()
                tex.repeat.set(1 / format.cols, 1 / format.rows)
                const material = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
                const mesh = new THREE.Mesh(planeForSheet(format), material)
                mesh.userData.playerIdx = guest.playerIdx
                const blob = new THREE.Mesh(blobGeo, blobMat)
                blob.rotation.x = -Math.PI / 2
                blob.position.y = characterShadowLocalY(format)
                mesh.add(blob)
                const presenceHalo = makePresenceHalo(guest.role)
                scene.add(mesh)
                const wander = seedWander(guest.playerIdx, 0, 0)
                const c: CharState = {
                    mesh,
                    material,
                    texture: tex,
                    format,
                    phase: wander.phase,
                    speed: wander.speed,
                    pauseLeft: wander.pauseLeft,
                    rng: wander.rng,
                    teamIdx: null,
                    lobbyOrdinal: null,
                    playerIdx: guest.playerIdx,
                    draggable: false,
                    busy: false,
                    name: guest.name,
                    role: guest.role ?? "viewer",
                    presenceHalo,
                    x: guest.start ? toX(guest.start.x) : 0,
                    z: guest.start ? toZ(guest.start.y) : ROOM_D - 2,
                    transition: null,
                    net: null,
                }
                c.mesh.position.set(c.x, characterGroundY(format), c.z)
                chars.push(c)
                charByPlayerIdx.set(guest.playerIdx, c)
                if (pendingLocal?.playerIdx === guest.playerIdx) {
                    const start = pendingLocal.start ?? guest.start
                    pendingLocal = null
                    activateLocalControl(c, start)
                }
            })()
        }

        const removeGuestChar = (playerIdx: number) => {
            guestPlayerIdxs.delete(playerIdx)
            if (pendingLocal?.playerIdx === playerIdx) pendingLocal = null
            const c = charByPlayerIdx.get(playerIdx)
            if (!c) return
            if (localChar === c) releaseLocalControl()
            clearSpeech(playerIdx)
            snapped.delete(c)
            scene.remove(c.mesh)
            scene.remove(c.presenceHalo)
            // The plane geometry and shadow blob are shared with the whole cast; only
            // this character's cloned texture and material are its own.
            c.texture.dispose()
            c.material.dispose()
            const at = chars.indexOf(c)
            if (at >= 0) chars.splice(at, 1)
            charByPlayerIdx.delete(playerIdx)
            if (hoverPlayerIdx === playerIdx) setHoveredPlayer(null)
            if (selPlayerIdx === playerIdx) {
                selPlayerIdx = null
                applySelection()
            }
        }
        registerCleanup(() => {
            for (const playerIdx of [...guestPlayerIdxs]) removeGuestChar(playerIdx)
        })

        const refreshTeamLabels = () => {
            if (interactionMode !== "assign") return
            const counts = PARTICIPANT_TABLES.map((_, teamIdx) =>
                chars.filter((c) => c.teamIdx === teamIdx).length,
            )
            labelSprites.forEach((label, teamIdx) => {
                // An unused desk keeps saying NO TEAM — a count of (0) would read as a
                // team that simply has nobody in it yet.
                if (!label.hasTeam) return
                const text = `${label.baseLabel} (${counts[teamIdx] ?? 0})`
                label.normal.dispose()
                label.gold.dispose()
                label.normal = makeLabelTexture(text, false)
                label.gold = makeLabelTexture(text, true)
            })
        }

        // selected-player marker (bobbing gold diamond) + name tags
        const marker = new THREE.Mesh(
            track(new THREE.OctahedronGeometry(0.26)),
            track(new THREE.MeshBasicMaterial({ color: 0xffd040, toneMapped: false })),
        )
        marker.visible = false
        scene.add(marker)

        const selTagMat = track(new THREE.SpriteMaterial({ map: null, depthTest: false }))
        const selTag = new THREE.Sprite(selTagMat)
        selTag.scale.set(2.9, 0.72, 1)
        selTag.renderOrder = 21
        selTag.visible = false
        scene.add(selTag)

        const hoverTagMat = track(new THREE.SpriteMaterial({ map: null, depthTest: false }))
        const hoverTag = new THREE.Sprite(hoverTagMat)
        hoverTag.scale.set(2.9, 0.72, 1)
        hoverTag.renderOrder = 21
        hoverTag.visible = false
        scene.add(hoverTag)

        const nameTagCache = new Map<number, THREE.CanvasTexture>()
        const nameTagFor = (c: CharState): THREE.CanvasTexture => {
            let tex = nameTagCache.get(c.playerIdx)
            if (!tex) {
                tex = track(makeNameTagTexture(c.name))
                nameTagCache.set(c.playerIdx, tex)
            }
            return tex
        }

        // ------------------------------------------------------------ post fx

        // The grade pass is a screen pass and a render target of its own, and
        // EffectComposer sizes every target at the device pixel ratio, so on a
        // dense display the post chain can outweigh the room. The bottom tier drops
        // the composer entirely and draws straight to the canvas —
        // `renderer.toneMapping` and the output colour space still apply, so what
        // is lost is the vignette, not the whole look.
        //
        // There is no bloom pass. It haloed anything pale under a desk pool — the
        // exhibition desks' white tops most of all — and was removed outright.
        //
        // The grade is built whatever the tier and toggled through `enabled`,
        // because the frame-budget watcher has to be able to switch it off
        // mid-session without rebuilding the scene.
        let composer: EffectComposer | null = null
        let grade: ShaderPass | null = null
        if (q.grade) {
            composer = track(new EffectComposer(renderer))
            composer.addPass(track(new RenderPass(scene, camera)))
            // The broadcast picture, before the output pass (which tone maps it —
            // hence the inverse in its material).
            composer.addPass(new BroadcastPicturePass(pictureScene, camera))
            pictureUniforms.uUndoToneMapping.value = 1
            composer.addPass(track(new OutputPass()))
            grade = track(new ShaderPass(RoomGradeShader))
            grade.enabled = q.grade
            composer.addPass(grade)
        }

        // ------------------------------------------------------------ input

        const raycaster = new THREE.Raycaster()
        const pointerNdc = new THREE.Vector2()
        const dragFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const dragPoint = new THREE.Vector3()

        // Where the camera has been slid to. The viewport drives this from the
        // keyboard through setCameraPan, a floor drag drives it from down here, and
        // both land in the same place.
        let cameraPan: RoomCameraPan = { x: 0, z: 0 }
        // Framing the wall screen. Pressing interact under it — or clicking it from
        // anywhere in the room — lifts the camera off the room and puts it square on
        // the glass, where the walk keys turn pages instead of walking. It rides ON
        // TOP of the pan rather than replacing it, so backing out eases straight
        // into wherever the follow-cam had got to.
        let screenFocused = false
        /** 0 = the room's own raked view, 1 = the screen filling the frame. */
        let screenFocusT = 0
        /** Measured fresh every time rather than cached: it depends on the aspect
         * AND the zoom, both of which a resize, a pinch or a +/− press can move
         * under it, and it is a handful of tangents. */
        const framedPose = (): CameraPose => {
            // A broadcast is framed on the PICTURE, not on the wall carrying it. The
            // wall is 4.1:1 and a viewport is nearer 16:9, so fitting the whole screen
            // runs out of width long before height and spends most of the view on
            // floor and ceiling — with the picture itself left small in the middle of
            // it. Framing its rect puts the camera as close as the clip allows.
            const picture = newsVideo
                ? broadcastWorldRect(
                    broadcastFitRect(newsVideo.videoWidth, newsVideo.videoHeight, SCREEN_TEX_W, SCREEN_TEX_H),
                    SCREEN_TEX_W,
                    SCREEN_TEX_H,
                    SCREEN_W,
                    SCREEN_H,
                    SCREEN_CY,
                )
                : null
            return screenFocusPose({
                width: picture?.width ?? SCREEN_W,
                height: picture?.height ?? SCREEN_H,
                centreY: picture?.centreY ?? SCREEN_CY,
                padding: picture ? BROADCAST_FOCUS_PADDING : undefined,
                z: screen.position.z,
                fovDeg: camera.fov,
                aspect: camera.aspect,
                zoom: camera.zoom,
            })
        }

        /** A close view of the cabinet for its entrance: over Primey's shoulder
         * from the south, aimed a little above the cabinet so the frame holds the
         * floor it lands on AND the height it falls from. */
        const arcadeFramedPose = (): CameraPose => {
            const x = toX(ARCADE_POINT.x)
            const z = toZ(ARCADE_POINT.y)
            return {
                position: { x: x - 1.5, y: 12, z: z + 15 },
                target: { x: x - 0.5, y: 4.6, z },
            }
        }

        /** Put the camera where the pan and the screen focus between them say it
         * goes. Every mover of the camera ends up here. */
        const syncCamera = () => {
            const room: CameraPose = {
                position: {
                    x: cameraHomePosition.x + cameraPan.x,
                    y: cameraHomePosition.y,
                    z: cameraHomePosition.z + cameraPan.z,
                },
                target: {
                    x: cameraHomeTarget.x + cameraPan.x,
                    y: cameraHomeTarget.y,
                    z: cameraHomeTarget.z + cameraPan.z,
                },
            }
            let pose = screenFocusT > 0 ? blendCameraPose(room, framedPose(), screenFocusT) : room
            // The cabinet's entrance rides on top of everything else, shake and all.
            if (arcadeFocusT > 0) pose = blendCameraPose(pose, arcadeFramedPose(), arcadeFocusT)
            camera.position.set(pose.position.x + arcadeShake.x, pose.position.y, pose.position.z + arcadeShake.z)
            camera.lookAt(pose.target.x + arcadeShake.x, pose.target.y, pose.target.z + arcadeShake.z)
        }

        const applyCameraPan = (pan: RoomCameraPan) => {
            cameraPan = clampRoomCameraPan(pan)
            syncCamera()
        }

        /** Carry out what a framed-screen key (or its touch-pad equivalent) means. */
        const applyFramedAction = (action: ScreenFocusKeyAction) => {
            if (action === "page-prev" || action === "page-next") {
                turnScreenPage(action === "page-prev" ? "prev" : "next")
                return
            }
            if (action === "swallow") return
            setScreenFocus(false)
        }

        /** Whether the room's furniture is currently stood down for the screen. */
        let occludersHidden = false
        /** Show or hide the furniture in front of the screen, if the blend has just
         * crossed the point where that changes. */
        const applyScreenOccluders = () => {
            const hide = screenFocusHidesRoom(screenFocusT)
            if (hide === occludersHidden) return
            occludersHidden = hide
            for (const object of screenOccluders) object.visible = !hide
        }

        const setScreenFocus = (next: boolean) => {
            if (screenFocused === next) return
            // Somebody stepping out of the framed view has taken the camera back: the
            // broadcast no longer holds it, so the clip ending will not move them.
            if (!next) {
                newsFocusHeld = false
                winnersFocusHeld = false
            }
            screenFocused = next
            // The screen holds still while somebody has it framed, and gets a fresh
            // dwell when they let it go — so the page they walked away from is not
            // already half-expired.
            screenPageAt = performance.now()
            // The follow-cam and the framed pose would otherwise fight over the camera
            // every frame; suspending it is the same "somebody else is driving" flag a
            // floor drag sets, and letting it go hands the view back to the character.
            cameraFollowSuspended = next
            if (next) localInput.releaseMovement()
        }

        /** Where a screen point lands on the floor, or null if it misses entirely. */
        const groundAt = (clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null => {
            const rect = renderer.domElement.getBoundingClientRect()
            pointerNdc.set(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            )
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.ray.intersectPlane(dragFloor, out) ? out : null
        }

        // A press that has not yet travelled far enough to be a pan is still a click,
        // so the basis is measured up front and the camera only starts moving once
        // the pointer clears DRAG_PAN_THRESHOLD_PX.
        let activePanDrag: {
            pointerId: number
            startClientX: number
            startClientY: number
            panAtStart: RoomCameraPan
            /** Floor movement per pixel of pointer travel, along each screen axis. */
            worldPerPxX: THREE.Vector3
            worldPerPxY: THREE.Vector3
            panning: boolean
        } | null = null
        /** A drag ends in a click event too; that one must not select anything. */
        let suppressNextClick = false
        const panProbeOrigin = new THREE.Vector3()
        const panProbeX = new THREE.Vector3()
        const panProbeY = new THREE.Vector3()
        const interactProbe = new THREE.Vector3()

        let pointerDirty = false
        let hoverPlayerIdx: number | null = null
        let activeDrag: {
            pointerId: number
            char: CharState
            fromTeamIdx: number | null
            hoverTeamIdx: number | null
            overLobby: boolean
        } | null = null

        const setHoveredPlayer = (playerIdx: number | null) => {
            if (playerIdx === hoverPlayerIdx) return
            hoverPlayerIdx = playerIdx
            opts.onPlayerHover?.(playerIdx)
            if (playerIdx !== null && playerIdx !== selPlayerIdx) {
                const c = charByPlayerIdx.get(playerIdx)
                if (c) {
                    hoverTagMat.map = nameTagFor(c)
                    hoverTagMat.needsUpdate = true
                    hoverTag.visible = true
                    return
                }
            }
            hoverTag.visible = false
        }

        const updatePointer = (e: PointerEvent | MouseEvent) => {
            const r = renderer.domElement.getBoundingClientRect()
            pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
            pointerDirty = true
        }

        const pickAt = (): RoomSelection => {
            raycaster.setFromCamera(pointerNdc, camera)
            const charHits = raycaster.intersectObjects(pickableCharMeshes(), false)
            if (charHits.length > 0) {
                return { type: "player", idx: charHits[0]!.object.userData.playerIdx as number }
            }
            // A table that has been stood down for the screen is not standing there to
            // be clicked: its hitbox is still in the list, but nothing is drawn at it.
            const tblHits = occludersHidden ? [] : raycaster.intersectObjects(tableHitboxes, false)
            if (tblHits.length > 0) {
                return { type: "team", idx: tblHits[0]!.object.userData.tableIdx as number }
            }
            return null
        }

        /** Is the pointer over the wall screen? */
        const screenHitAt = (): boolean => {
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.intersectObject(screen, false).length > 0
        }

        /** Is the pointer over the (visible) arcade cabinet? */
        const arcadeHitAt = (): boolean => {
            if (!arcade || !arcadeVisible) return false
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.intersectObject(arcade, true).length > 0
        }

        /** The raycaster does not honour `visible`; a dusted character has to be
         * left out of the list or the pointer keeps finding a ghost. */
        const pickableCharMeshes = () => chars.filter((c) => !snapped.has(c)).map((c) => c.mesh)

        const pickCharacterAt = (): CharState | null => {
            raycaster.setFromCamera(pointerNdc, camera)
            const hits = raycaster.intersectObjects(pickableCharMeshes(), false)
            if (hits.length === 0) return null
            return charByPlayerIdx.get(hits[0]!.object.userData.playerIdx as number) ?? null
        }

        const dropTargetAt = () => {
            raycaster.setFromCamera(pointerNdc, camera)
            // Tables win if projection/perspective ever causes hit volumes to overlap.
            const tableHits = raycaster.intersectObjects(tableHitboxes, false)
            if (tableHits.length > 0) {
                return {
                    hoverTeamIdx: tableHits[0]!.object.userData.tableIdx as number,
                    overLobby: false,
                }
            }
            return {
                hoverTeamIdx: null,
                overLobby: lobbyHitbox !== null && raycaster.intersectObject(lobbyHitbox, false).length > 0,
            }
        }

        const clearDropHighlight = () => {
            highlight.visible = false
            if (lobbyHighlight) lobbyHighlight.visible = false
            destinationHighlights.forEach((destination) => {
                destination.visible = false
            })
            labelSprites.forEach((label) => {
                label.sprite.material.map = label.normal
                label.sprite.material.needsUpdate = true
            })
        }

        const applyDropHighlight = (drag: NonNullable<typeof activeDrag>) => {
            clearDropHighlight()
            const highlightState = roomDragHighlightState(
                drag.fromTeamIdx,
                PARTICIPANT_TABLES.length,
                drag.hoverTeamIdx,
            )
            for (const teamIdx of highlightState.eligibleTeamIdxs) {
                const destination = destinationHighlights[teamIdx]
                if (destination) destination.visible = true
            }
            if (highlightState.strongTeamIdx !== null) {
                const tbl = PARTICIPANT_TABLES[highlightState.strongTeamIdx]
                if (!tbl) return
                highlight.position.set(toX(tbl.x + tbl.w / 2), 0.02, toZ(tbl.y + tbl.h / 2))
                highlight.visible = true
                const label = labelSprites[highlightState.strongTeamIdx]
                if (label) {
                    label.sprite.material.map = label.gold
                    label.sprite.material.needsUpdate = true
                }
                return
            }
            const drop = resolveRoomDrop({
                playerIdx: drag.char.playerIdx,
                fromTeamIdx: drag.fromTeamIdx,
                hoverTeamIdx: drag.hoverTeamIdx,
                overLobby: drag.overLobby,
            })
            if (!drop) return
            if (drop.destinationTeamIdx === null) {
                if (lobbyHighlight) lobbyHighlight.visible = true
            }
        }

        const updateActiveDrag = (e: PointerEvent) => {
            const drag = activeDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            updatePointer(e)
            raycaster.setFromCamera(pointerNdc, camera)
            if (raycaster.ray.intersectPlane(dragFloor, dragPoint)) {
                drag.char.x = dragPoint.x
                drag.char.z = dragPoint.z
                drag.char.mesh.position.set(drag.char.x, characterGroundY(drag.char.format) + DRAG_LIFT, drag.char.z)
            }
            const target = dropTargetAt()
            drag.hoverTeamIdx = target.hoverTeamIdx
            drag.overLobby = target.overLobby
            applyDropHighlight(drag)
        }

        const onClick = (e: MouseEvent) => {
            // The click that ends a floor drag would otherwise land as a selection.
            if (suppressNextClick) {
                suppressNextClick = false
                return
            }
            updatePointer(e)
            // Clicking the screen frames it, the same as pressing interact under it.
            // No proximity probe on this path: a click has already singled out the
            // thing it means, so it works from wherever the player is standing.
            if (localChar && screenHitAt()) {
                setScreenFocus(!screenFocused)
                return
            }
            // The cabinet answers a click from anywhere, so a spectator with no
            // character to walk up can still play.
            if (performance.now() >= inputFrozenUntil && arcadeHitAt()) {
                localInput.releaseMovement()
                localMoving = false
                opts.onArcadeInteract?.()
                return
            }
            opts.onPick?.(pickAt())
        }

        // Touch takes the same drag-pan as the mouse: the canvas is touch-action
        // none (the page beneath never scrolls from it), so a finger on the floor
        // can safely grab the room.
        const beginPanDrag = (e: PointerEvent) => {
            const origin = groundAt(e.clientX, e.clientY, panProbeOrigin)
            const alongX = groundAt(e.clientX + PAN_PROBE_PX, e.clientY, panProbeX)
            const alongY = groundAt(e.clientX, e.clientY + PAN_PROBE_PX, panProbeY)
            // A press aimed past the horizon has no floor under it to grab.
            if (!origin || !alongX || !alongY) return
            activePanDrag = {
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                panAtStart: { ...cameraPan },
                worldPerPxX: alongX.clone().sub(origin).divideScalar(PAN_PROBE_PX),
                worldPerPxY: alongY.clone().sub(origin).divideScalar(PAN_PROBE_PX),
                panning: false,
            }
        }

        const updatePanDrag = (e: PointerEvent) => {
            const drag = activePanDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            const dx = e.clientX - drag.startClientX
            const dy = e.clientY - drag.startClientY
            if (!drag.panning) {
                if (!isDragPan(dx, dy)) return
                drag.panning = true
                // Dragging the room is a deliberate look elsewhere; the screen lets go —
                // before the suspension below, which un-framing would otherwise clear.
                setScreenFocus(false)
                cameraFollowSuspended = true
                renderer.domElement.setPointerCapture(e.pointerId)
                renderer.domElement.style.cursor = "grabbing"
                setHoveredPlayer(null)
            }
            const next = panFromDrag(drag.panAtStart, {
                x: drag.worldPerPxX.x * dx + drag.worldPerPxY.x * dy,
                z: drag.worldPerPxX.z * dx + drag.worldPerPxY.z * dy,
            })
            applyCameraPan(next)
            opts.onCameraPan?.(next)
        }

        const finishPanDrag = (e: PointerEvent) => {
            const drag = activePanDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            activePanDrag = null
            if (!drag.panning) return
            suppressNextClick = true
            renderer.domElement.style.cursor = "default"
            if (renderer.domElement.hasPointerCapture(e.pointerId)) {
                renderer.domElement.releasePointerCapture(e.pointerId)
            }
        }

        // Two fingers on the canvas pinch-zoom the camera. The gesture takes over
        // from any pan the first finger had started, and — like a drag — must not
        // end in a selection.
        const touchPoints = new Map<number, { x: number; y: number }>()
        let activePinch: { startDist: number; zoomAtStart: number } | null = null
        const touchSpread = (): number => {
            const [a, b] = [...touchPoints.values()]
            return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
        }
        const beginPinch = () => {
            if (activePanDrag) {
                const pointerId = activePanDrag.pointerId
                activePanDrag = null
                renderer.domElement.style.cursor = "default"
                if (renderer.domElement.hasPointerCapture(pointerId)) {
                    renderer.domElement.releasePointerCapture(pointerId)
                }
            }
            activePinch = { startDist: touchSpread(), zoomAtStart: camera.zoom }
            suppressNextClick = true
        }
        const updatePinch = (): void => {
            if (!activePinch) return
            const zoom = pinchZoom(activePinch.zoomAtStart, activePinch.startDist, touchSpread())
            camera.zoom = zoom
            camera.updateProjectionMatrix()
            // A framed screen is framed AT a zoom; changing it re-measures the pose.
            if (screenFocusT > 0) syncCamera()
            opts.onCameraZoom?.(zoom)
        }
        const endTouchPoint = (e: PointerEvent) => {
            if (e.pointerType !== "touch") return
            touchPoints.delete(e.pointerId)
            // Lifting either finger ends the pinch; the survivor must press again to
            // start a pan, so a stale drag basis can never take over mid-gesture.
            if (activePinch && touchPoints.size < 2) activePinch = null
        }

        const onPointerDown = (e: PointerEvent) => {
            // A gesture's click (if any) always lands before the next press, so a
            // suppression that was never consumed — a pinch usually ends with no
            // click at all — must not survive to eat this new tap.
            if (!activeDrag && !activePanDrag && !activePinch && touchPoints.size === 0) {
                suppressNextClick = false
            }
            if (e.pointerType === "touch") {
                touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
                // A second finger while a student is mid-drag stays ignored; any other
                // second finger starts the pinch. Third and later fingers do nothing.
                if (touchPoints.size === 2 && !activeDrag) {
                    beginPinch()
                    return
                }
                if (touchPoints.size > 2) return
            }
            if (activeDrag || activePanDrag || activePinch || (e.pointerType === "mouse" && e.button !== 0)) return
            updatePointer(e)
            // Dragging a student onto a team wins over dragging the room: the pan is
            // what an empty patch of floor does.
            if (interactionMode === "assign") {
                const c = pickCharacterAt()
                if (c && c.draggable && !c.busy) {
                    startAssignmentDrag(e, c)
                    return
                }
            }
            beginPanDrag(e)
        }

        const startAssignmentDrag = (e: PointerEvent, c: CharState) => {
            activeDrag = {
                pointerId: e.pointerId,
                char: c,
                fromTeamIdx: c.teamIdx,
                hoverTeamIdx: null,
                overLobby: false,
            }
            // Pointer capture suppresses ordinary hover updates while dragging. Keep
            // the dragged participant active so admin arrivals stay highlighted in
            // the sidebar until the drop or cancellation completes.
            setHoveredPlayer(roomDragPlayerHover(c.playerIdx, true))
            c.transition = null
            applyDropHighlight(activeDrag)
            renderer.domElement.setPointerCapture(e.pointerId)
            renderer.domElement.style.cursor = "grabbing"
            e.preventDefault()
        }
        const onMove = (e: PointerEvent) => {
            if (e.pointerType === "touch" && touchPoints.has(e.pointerId)) {
                touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
                if (activePinch) {
                    updatePinch()
                    e.preventDefault()
                    return
                }
            }
            if (activeDrag?.pointerId === e.pointerId) {
                updateActiveDrag(e)
                e.preventDefault()
                return
            }
            if (activePanDrag?.pointerId === e.pointerId) {
                updatePanDrag(e)
                if (activePanDrag?.panning) {
                    e.preventDefault()
                    return
                }
            }
            updatePointer(e)
        }
        const finishDrag = (e: PointerEvent, emitDrop: boolean) => {
            const drag = activeDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            if (emitDrop) updateActiveDrag(e)
            const drop = emitDrop
                ? resolveRoomDrop({
                    playerIdx: drag.char.playerIdx,
                    fromTeamIdx: drag.fromTeamIdx,
                    hoverTeamIdx: drag.hoverTeamIdx,
                    overLobby: drag.overLobby,
                })
                : null
            activeDrag = null
            drag.char.transition = null
            snapToAuthoritativeHome(drag.char)
            clearDropHighlight()
            applySelection()
            setHoveredPlayer(roomDragPlayerHover(drag.char.playerIdx, false))
            renderer.domElement.style.cursor = "default"
            if (renderer.domElement.hasPointerCapture(e.pointerId)) {
                renderer.domElement.releasePointerCapture(e.pointerId)
            }
            if (drop) opts.onDrop?.(drop)
        }
        const onPointerUp = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
            finishDrag(e, true)
        }
        const onPointerCancel = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
            finishDrag(e, false)
        }
        const onLostPointerCapture = (e: PointerEvent) => {
            finishPanDrag(e)
            finishDrag(e, false)
        }
        const onPointerLeave = () => {
            if (activeDrag || activePanDrag) return
            pointerDirty = false
            setHoveredPlayer(null)
            renderer.domElement.style.cursor = "default"
        }

        // Both modes now take the same pointer stream: assign mode spends a press on
        // a student on moving them, and every other press — in either mode — drags
        // the room.
        renderer.domElement.addEventListener("pointerdown", onPointerDown)
        renderer.domElement.addEventListener("pointermove", onMove)
        renderer.domElement.addEventListener("pointerup", onPointerUp)
        renderer.domElement.addEventListener("pointercancel", onPointerCancel)
        renderer.domElement.addEventListener("lostpointercapture", onLostPointerCapture)
        renderer.domElement.addEventListener("pointerleave", onPointerLeave)
        // Both modes handle raw touches now (drag-pan and pinch-zoom), so the
        // browser gets none of them.
        renderer.domElement.style.touchAction = "none"
        if (interactionMode !== "assign") {
            renderer.domElement.addEventListener("click", onClick)
        }
        registerCleanup(() => {
            renderer.domElement.removeEventListener("click", onClick)
            renderer.domElement.removeEventListener("pointerdown", onPointerDown)
            renderer.domElement.removeEventListener("pointermove", onMove)
            renderer.domElement.removeEventListener("pointerup", onPointerUp)
            renderer.domElement.removeEventListener("pointercancel", onPointerCancel)
            renderer.domElement.removeEventListener("lostpointercapture", onLostPointerCapture)
            renderer.domElement.removeEventListener("pointerleave", onPointerLeave)
        })
        registerCleanup(() => {
            if (activeDrag && renderer.domElement.hasPointerCapture(activeDrag.pointerId)) {
                renderer.domElement.releasePointerCapture(activeDrag.pointerId)
            }
            activeDrag = null
        })

        // ------------------------------------------------------------ selection

        let selTeamIdx: number | null = null
        let selPlayerIdx: number | null = null

        const applySelection = () => {
            highlight.visible = selTeamIdx !== null
            if (selTeamIdx !== null) {
                const tbl = PARTICIPANT_TABLES[selTeamIdx]
                if (tbl) highlight.position.set(toX(tbl.x + tbl.w / 2), 0.02, toZ(tbl.y + tbl.h / 2))
            }
            labelSprites.forEach((l, i) => {
                l.sprite.material.map = i === selTeamIdx ? l.gold : l.normal
                l.sprite.material.needsUpdate = true
            })
            const selChar = selPlayerIdx !== null ? charByPlayerIdx.get(selPlayerIdx) ?? null : null
            marker.visible = selChar !== null
            selTag.visible = selChar !== null
            if (selChar) {
                selTagMat.map = nameTagFor(selChar)
                selTagMat.needsUpdate = true
            }
        }

        // ------------------------------------------------------------ main loop

        // Simulation time, NOT rAF ticks — see sim-clock.ts. `simFrame` counts fixed
        // 60 Hz steps, so the walk cadence and wander below run at the same speed on
        // a 60, 120 or 144 Hz display.
        let simFrame = 0
        let simCarryMs = 0
        let raf = 0
        registerCleanup(() => cancelAnimationFrame(raf))
        let lastScreenRedraw = 0
        let lastTimeOfDayCheck = 0
        const clockStart = performance.now()
        let lastFrameAt = clockStart

        // The aimless orbit itself lives in lib/gameRoomNet/wander.ts (shared with
        // the multiplayer hub); CharState carries its fields inline, so stepWander
        // mutates the character directly.

        const tick = () => {
            if (renderPaused) return
            raf = requestAnimationFrame(tick)
            const now = performance.now()
            const frameMs = now - lastFrameAt
            const advance = advanceSimClock(simCarryMs, frameMs)
            lastFrameAt = now
            simCarryMs = advance.carryMs
            simFrame += advance.steps
            const t = (now - clockStart) / 1000

            // wall screen refresh (2×/s) — the countdown's seconds, and whatever the
            // leaderboard poll last handed us
            if (t - lastScreenRedraw > 0.5) {
                lastScreenRedraw = t
                // A window entering its last minute takes the wheel back off the board —
                // and so does an event that has not opened one at all, which has no
                // standings to put on the board in the first place.
                if (
                    !forcedScreenPage &&
                    !presentation &&
                    !winners &&
                    screenPage !== "countdown" &&
                    (!eventStarted(sessionClock) || screenLines(sessionClock, Date.now(), countdown).solo)
                ) {
                    screenPage = "countdown"
                    screenPageAt = now
                }
                // A screen somebody is standing and reading does not turn its own pages
                // out from under them; the cycle is for the rest of the room.
                if (!screenFocused && !presentation && !winners && now - screenPageAt >= pageDwellMs(screenPage)) turnScreenPage()
                else redrawScreen()
            }

            // A playing broadcast is not the canvas's business: its picture is a
            // VideoTexture on its own quad, and the browser refreshes that on the
            // clip's frames — see the broadcast picture above.

            // time of day — the palette only moves once a real minute, so polling the
            // clock every few seconds is already 20× oversampled
            if (t - lastTimeOfDayCheck > 5) {
                lastTimeOfDayCheck = t
                applyTimeOfDay()
            }

            // Primey's idle loop. Driven by wall-clock ms, not the sim frame: it is
            // scenery, and should breathe at the same pace as the DOM sprite on every
            // other page whatever the room's frame budget is doing.
            primeyTex.offset.x = primeyFrameOffset(now - clockStart)



            // characters
            const walkFrame = Math.floor((simFrame * WALK_SPEED) / WALK_FRAME_STEPS)
            if (localChar && !activeDrag) {
                for (let step = 0; step < advance.steps; step++) stepLocalControl()
            }
            for (const c of chars) {
                const isDragging = activeDrag?.char === c
                const isLocal = c === localChar
                let dir: WalkDir
                let standing: boolean
                if (isLocal && !isDragging) {
                    // The player's own character: keyboard-driven, collision-checked,
                    // zero-latency — the hub only relays it to everyone else.
                    c.transition = null
                    c.x = toX(localPx.x)
                    c.z = toZ(localPx.y)
                    c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
                    dir = localDir
                    standing = !localMoving
                } else if (c.net && !isDragging) {
                    // Remote-synced (a live player elsewhere, or the hub's wander sim):
                    // glide toward the 10 Hz target rather than stepping to it.
                    c.transition = null
                    const dx = c.net.x - c.x
                    const dz = c.net.z - c.z
                    if (dx * dx + dz * dz > NET_SNAP_DIST * NET_SNAP_DIST) {
                        c.x = c.net.x
                        c.z = c.net.z
                    } else {
                        const closeness = 1 - Math.pow(NET_KEEP_PER_STEP, advance.steps)
                        c.x += dx * closeness
                        c.z += dz * closeness
                    }
                    c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
                    dir = c.net.dir
                    standing = !c.net.moving
                } else {
                    if (!isDragging && c.teamIdx !== null) {
                        for (let step = 0; step < advance.steps; step++) stepWander(c)
                    }
                    const home = authoritativePosition(c)
                    if (!isDragging) {
                        let y = characterGroundY(c.format)
                        if (c.transition) {
                            const progress = Math.min(1, (performance.now() - c.transition.startedAt) / c.transition.duration)
                            const eased = 1 - (1 - progress) * (1 - progress)
                            c.x = THREE.MathUtils.lerp(c.transition.fromX, home.x, eased)
                            c.z = THREE.MathUtils.lerp(c.transition.fromZ, home.z, eased)
                            y += Math.sin(progress * Math.PI) * TRANSITION_HOP
                            if (progress === 1) c.transition = null
                        } else {
                            c.x = home.x
                            c.z = home.z
                        }
                        c.mesh.position.set(c.x, y, c.z)
                    }
                    dir = home.dir
                    standing = c.teamIdx === null || isDragging || c.pauseLeft > 0
                }
                const row = c.format.dirRow[dir]
                const animFrame = standing ? c.format.standFrame : c.format.walkFrame(walkFrame)
                c.texture.offset.set(animFrame / c.format.cols, 1 - (row + 1) / c.format.rows)
                const dim = interactionMode === "assign"
                    ? !c.draggable || c.busy
                    : selTeamIdx !== null && c.teamIdx !== selTeamIdx
                c.material.color.setHex(dim ? 0x3c4256 : 0xffffff)
                // Keep opacity above alphaTest (0.5) so dimmed sprites stay visible.
                c.material.opacity = dim ? (c.busy ? 0.6 : 0.65) : 1
                // Keep the halo in world space, centred on the character's ground
                // position. Attaching it to the billboard makes it inherit sprite-facing
                // transforms and can pull the projected ring away from the feet.
                c.presenceHalo.position.set(c.x, 0.03, c.z)
            }
            // The snap's fade overrides the opacity and height just set.
            stepSnap(frameMs)

            // Crowns, AFTER the characters have moved: placed before that they
            // sit at last frame's position while their wearer is at this one,
            // and the pair jitters against each other all the way across the
            // room. Every character, not only the ones with pets — the role
            // markers belong to people who have never hatched a thing.
            for (const c of chars) syncCrowns(c)
            for (const playerIdx of [...crowns.keys()]) {
                if (!charByPlayerIdx.has(playerIdx)) clearCrowns(playerIdx)
            }

            // The cabinet's entrance owns the camera while it runs.
            stepArcadeReveal(frameMs)

            // follow-cam: keep the local character centred, video-game style. Eased
            // per sim step, clamped to the room, and paused while the player is
            // deliberately dragging the view elsewhere (movement re-engages it).
            if (localChar && !cameraFollowSuspended && !activePanDrag?.panning && advance.steps > 0) {
                const next = followRoomCameraPan(
                    cameraPan,
                    { x: localChar.x - cameraHomeTarget.x, z: localChar.z - cameraHomeTarget.z },
                    advance.steps,
                    { unclamped: noclip },
                )
                if (Math.abs(next.x - cameraPan.x) > 1e-4 || Math.abs(next.z - cameraPan.z) > 1e-4) {
                    applyCameraPan(next)
                }
            }

            // The framed view rides on top of whatever the pan just did, so it eases
            // last.
            const focusT = advanceScreenFocus(screenFocusT, screenFocused, advance.steps)
            if (focusT !== screenFocusT) {
                screenFocusT = focusT
                syncCamera()
                applyScreenOccluders()
            }

            // throttled self-report to the hub
            if (localChar) {
                if (opts.onSelfState) {
                    const cur: RoomSelfState = { x: localPx.x, y: localPx.y, dir: localDir, moving: localMoving }
                    const changed =
                        !lastSelfSent ||
                        cur.x !== lastSelfSent.x ||
                        cur.y !== lastSelfSent.y ||
                        cur.dir !== lastSelfSent.dir ||
                        cur.moving !== lastSelfSent.moving
                    if (changed && now - lastSelfSentAt >= 90) {
                        lastSelfSentAt = now
                        lastSelfSent = cur
                        opts.onSelfState(cur)
                    }
                }
            }

            // speech bubbles follow their speakers, then expire
            if (speechBubbles.size > 0) {
                const nowMs = performance.now()
                for (const [playerIdx, bubble] of [...speechBubbles]) {
                    if (nowMs >= bubble.expiresAt) {
                        clearSpeech(playerIdx)
                        continue
                    }
                    const c = charByPlayerIdx.get(playerIdx)
                    if (c) bubble.sprite.position.set(c.x, characterTopY(c.format) + SPEECH_RISE, c.z)
                }
            }

            // floating rank numerals — bob and sway, offset per desk so ten of them
            // do not pulse as one
            if (rankNumerals.size > 0) {
                for (const [ti, mesh] of rankNumerals) {
                    const phase = ti * 0.7
                    mesh.position.y = mesh.userData.baseY as number
                        + Math.sin(t * RANK_BOB_SPEED + phase) * RANK_BOB
                    mesh.rotation.y = Math.sin(t * RANK_SWAY_SPEED + phase) * RANK_SWAY
                    // A numeral the spotlight has just landed on pops in with a little
                    // overshoot, then settles.
                    const popAt = mesh.userData.popAt as number | undefined
                    if (popAt !== undefined) {
                        const u = Math.min(1, (now - popAt) / NUMERAL_POP_MS)
                        // ease-out-back: overshoots to ~1.1 around two thirds of the way in.
                        const v = u - 1
                        const scale = u >= 1 ? 1 : Math.max(0.001, 1 + 2.70158 * v * v * v + 1.70158 * v * v)
                        mesh.scale.setScalar(scale)
                        if (u >= 1) delete mesh.userData.popAt
                    }
                }
            }

            // the presentation: house lights, the spotlight's sweep, and the desks it
            // has reached. Wall-clock time for the reveal (it replays from the hub's
            // stamp), frame time for the eases.
            {
                const dt = Math.min(0.1, frameMs / 1000)
                let deskIdx: number | null = null
                let spotlightPhase = "reveal"
                let activeRevealNonce: number | null = null
                if (presentation) {
                    const progress = revealProgress(presentation, Date.now())
                    if (!progress.done && presentation.order.length > 0) activeRevealNonce = presentation.nonce
                    roomDimTarget = progress.dark ? 1 : 0
                    const n = presentation.order.length
                    if (progress.sweepSlot !== null) deskIdx = presentation.order[progress.sweepSlot] ?? null
                    else if (presentation.spotlightTeamIdx !== null) {
                        deskIdx = presentation.spotlightTeamIdx
                        spotlightPhase = "manual"
                    }
                    // Through the tail the light lingers on the last presenter rather
                    // than snapping off the instant the sweep ends.
                    else if (!progress.done && n > 0) deskIdx = presentation.order[n - 1] ?? null
                    if (progress.revealed !== presentationRevealed) {
                        presentationRevealed = progress.revealed
                        refreshDeskNumerals(true)
                        redrawScreen()
                    }
                } else {
                    // The ceremony takes the house lights part way down: the fireworks
                    // read against a dim room, and the wall becomes the brightest thing
                    // in it, which is where everyone should be looking.
                    roomDimTarget = winners ? WINNERS_HOUSE_DIM : 0
                }
                // One music bed for the entire draw, including the lead-in and tail.
                // It restarts for a re-draw, but not for each desk or a manual spotlight.
                suspensePlayer.sync(
                    activeRevealNonce === null ? null : `reveal:${activeRevealNonce}`,
                    newsAudio,
                )
                const tbl = deskIdx !== null && hasTeamAt(deskIdx) ? PARTICIPANT_TABLES[deskIdx] : undefined
                if (tbl) {
                    spotGoal.x = toX(tbl.x + tbl.w / 2)
                    spotGoal.z = toZ(tbl.y + tbl.h / 2)
                    // The first landing does not slide in from the room's origin.
                    if (!spotOn && spotLevel === 0) {
                        spotAt.x = spotGoal.x
                        spotAt.z = spotGoal.z
                    }
                    spotOn = true
                } else {
                    spotOn = false
                }

                // Use the same desk transition as the light, so the reveal's tail and
                // ordinary frame updates never replay the cue. A fresh draw or a manual
                // spotlight is a new opening even when it picks the same desk.
                const soundKey = spotOn && presentation
                    ? `${presentation.nonce}:${spotlightPhase}:${deskIdx}`
                    : null
                spotlightPlayer.sync(soundKey, newsAudio)

                // The spot moves FIRST, and the house lights follow it: they may fall
                // whenever they like, but they only start coming back up once the spot
                // is actually out. Running both fades at once lit the room twice over
                // for the second either side of the handover — see SPOT_OUT_LEVEL.
                const spotTarget = spotOn ? 1 : 0
                if (spotLevel !== spotTarget || spotAt.x !== spotGoal.x || spotAt.z !== spotGoal.z) {
                    const k = 1 - Math.exp(-SPOT_SLIDE_RATE * dt)
                    spotAt.x += (spotGoal.x - spotAt.x) * k
                    spotAt.z += (spotGoal.z - spotAt.z) * k
                    if (Math.abs(spotAt.x - spotGoal.x) < 0.01) spotAt.x = spotGoal.x
                    if (Math.abs(spotAt.z - spotGoal.z) < 0.01) spotAt.z = spotGoal.z
                    spotLevel += (spotTarget - spotLevel) * k
                    if (Math.abs(spotLevel - spotTarget) < 0.005) spotLevel = spotTarget
                    spot.intensity = SPOT_INTENSITY * spotLevel
                    spotBeamMat.opacity = 0.06 * spotLevel
                    spotPoolMat.opacity = 0.22 * spotLevel
                    spotBeam.visible = spotPool.visible = spotLevel > 0
                    placeSpot()
                }
                const dimGoal = houseDimGoal(roomDim, roomDimTarget, spotLevel)
                if (roomDim !== dimGoal) {
                    const k = 1 - Math.exp(-ROOM_DIM_RATE * dt)
                    roomDim += (dimGoal - roomDim) * k
                    if (Math.abs(roomDim - dimGoal) < 0.005) roomDim = dimGoal
                    applyLightLevel()
                }
            }

            // the winners' ceremony: the sky falling to night (and coming back), and
            // the fireworks over the city
            {
                const dt = Math.min(0.1, frameMs / 1000)
                if (nightBlend !== nightGoal) {
                    nightBlend = advanceNightBlend(nightBlend, nightGoal, dt)
                    applyTimeOfDay()
                }
                updateFireworks(dt, now)
            }

            // selection marker + tag follow their character
            if (selPlayerIdx !== null) {
                const c = charByPlayerIdx.get(selPlayerIdx)
                if (c) {
                    const top = characterTopY(c.format)
                    marker.position.set(c.x, top + MARKER_RISE + Math.sin(t * 4) * 0.14, c.z)
                    marker.rotation.y = t * 2.2
                    selTag.position.set(c.x, top + SEL_TAG_RISE, c.z)
                }
            }

            // hover raycast (only when the pointer moved)
            if (pointerDirty && !activeDrag && !activePanDrag?.panning) {
                const pick = pickAt()
                const newHover = pick?.type === "player" ? pick.idx : null
                if (interactionMode === "assign") {
                    const hoverChar = newHover === null ? null : charByPlayerIdx.get(newHover) ?? null
                    renderer.domElement.style.cursor = hoverChar?.draggable && !hoverChar.busy ? "grab" : "default"
                } else {
                    renderer.domElement.style.cursor = pick ? "pointer" : "default"
                }
                if (newHover !== hoverPlayerIdx) {
                    setHoveredPlayer(newHover)
                }
                pointerDirty = false
            } else if (activeDrag || activePanDrag?.panning) {
                hoverTag.visible = false
            }
            if (hoverPlayerIdx !== null && hoverTag.visible) {
                const c = charByPlayerIdx.get(hoverPlayerIdx)
                if (c) hoverTag.position.set(c.x, characterTopY(c.format) + HOVER_TAG_RISE, c.z)
            }

            // highlight pulse + dust drift
            updateInteractHighlight()
            if (interactHighlight.visible) {
                const m = interactHighlight.material as THREE.MeshBasicMaterial
                m.opacity = 0.5 + Math.sin(t * 6) * 0.35
            }
            if (highlight.visible) {
                const m = highlight.material as THREE.MeshBasicMaterial
                m.opacity = 0.65 + Math.sin(t * 5) * 0.3
            }
            if (lobbyHighlight?.visible) {
                const m = lobbyHighlight.material as THREE.MeshBasicMaterial
                m.opacity = 0.16 + (Math.sin(t * 5) + 1) * 0.08
            }

            if (grade) grade.uniforms.uTime!.value = t
            if (composer) composer.render()
            else {
                renderer.render(scene, camera)
                // No post chain, so nothing to dodge: the picture goes straight on
                // after the room, against its depth. (The composer path draws it from
                // its own pass — see BroadcastPicturePass.)
                if (broadcastPicture.visible) {
                    renderer.autoClear = false
                    renderer.render(pictureScene, camera)
                    renderer.autoClear = true
                }
            }

            // The rAF interval, not this callback's own duration: a GPU that cannot
            // keep up shows as a stretched gap between frames, which is exactly what
            // the player experiences and what a JS-side stopwatch would miss.
            if (frameBudget?.sample(frameMs)) downgradeQuality()
        }

        // ------------------------------------------------------------ sizing

        const resize = () => {
            const w = container.clientWidth || 1
            const h = container.clientHeight || 1
            renderer.setSize(w, h, false)
            composer?.setSize(w, h)
            camera.aspect = w / h
            camera.updateProjectionMatrix()
            // How far back the screen has to be read from depends on the shape of the
            // viewport reading it.
            if (screenFocusT > 0) syncCamera()
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(container)
        registerCleanup(() => ro.disconnect())

        // ------------------------------------------------------------ quality, live

        /**
         * Draw the shadow depth pass once. Cheap to ask for, wasteful to leave on.
         *
         * Not optional: with `autoUpdate` off and no pass ever requested, the depth
         * target stays null and three.js resolves every lit surface as fully
         * shadowed — the room goes black and the unlit backdrop shows straight
         * through it. So every path that invalidates the map has to come back here.
         */
        const refreshShadows = () => {
            if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true
        }

        // A lost-and-restored context drops every GPU resource, the depth target
        // included, and nothing else would ever ask for it again.
        const onContextRestored = () => refreshShadows()
        renderer.domElement.addEventListener("webglcontextrestored", onContextRestored)
        registerCleanup(() =>
            renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored),
        )

        /**
         * Move the live scene to a tier. Only the settings that can be changed
         * without rebuilding are honoured — pixel ratio, the post passes, shadows,
         * the point-light rig and the mote count, which between them are all of the
         * per-frame cost. `cheapFurniture` and `backdropLightsScale` are baked in at
         * build time and deliberately left alone: swapping every material in the
         * room mid-session would stall harder than the frames it saved.
         */
        const applyQuality = (next: QualityTier) => {
            tier = next
            q = qualitySettings(next)

            renderer.setPixelRatio(pixelRatioFor(q))
            if (grade) grade.enabled = q.grade

            const nextShadowType = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
            // The filter kernel is compiled into the shader, so a change here needs
            // the same rebuild that toggling shadows off and on does.
            const shadowsToggled =
                renderer.shadowMap.enabled !== q.shadows || renderer.shadowMap.type !== nextShadowType
            renderer.shadowMap.type = nextShadowType
            if (shadowsToggled || key.shadow.mapSize.x !== q.shadowMapSize) {
                renderer.shadowMap.enabled = q.shadows
                key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
                // The existing depth target is the old size; it has to go before the
                // next pass can allocate one at the new one.
                key.shadow.map?.dispose()
                key.shadow.map = null
            }
            if (shadowsToggled) {
                // Whether a material samples a shadow map is compiled into its shader,
                // so every one of them needs rebuilding. This is a one-off stutter, and
                // it only ever happens on a device that is already stuttering.
                scene.traverse((object) => {
                    if (object instanceof THREE.Mesh) {
                        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                            material.needsUpdate = true
                        }
                    }
                })
            }

            buildDeskLights(q.deskLightsPerRow)
            for (const light of screenGlowLights) light.visible = q.screenGlowLight

            resize()
            refreshShadows()
            opts.onQualityChange?.(next)
        }

        // A pinned tier is an instruction, not a guess, so it is never second-
        // guessed by measurement. Everything else gets watched: the signals in
        // `detectQualitySignals` are coarse, and the honest test of whether a device
        // can render this room is whether it is rendering this room.
        let frameBudget: FrameBudgetWatcher | null = pinnedTier ? null : createFrameBudgetWatcher()

        // The menu's GRAPHICS row lands here. A fresh watcher rather than a kept one
        // when returning to AUTO: its grace period has to start again, because the
        // frames right after a tier change are shader recompiles, not the steady
        // state it is meant to judge.
        const applyQualityPreference = (preference: GraphicsPreference) => {
            if (preference === "auto") {
                frameBudget = createFrameBudgetWatcher()
                applyQuality(resolveQualityTier(detectQualitySignals()))
            } else {
                frameBudget = null
                applyQuality(preference)
            }
        }
        const downgradeQuality = () => {
            const next = nextTierDown(tier)
            if (!next) return
            logger.info("room3d.quality_reduced", { quality: next })
            applyQuality(next)
        }

        for (const light of screenGlowLights) light.visible = q.screenGlowLight
        opts.onQualityChange?.(tier)

        applySelection()
        applyTimeOfDay()
        // The depth pass is on demand (see shadowMap.autoUpdate above), so it has to
        // be asked for once now that every caster is in the scene. Nothing here
        // moves afterwards — not even the key light, which the palette only ever
        // recolours — so this is the only time the shadow map is ever drawn.
        refreshShadows()
        tick()

        return {
            setCameraPan(x, z) {
                applyCameraPan({ x, z })
            },
            setCameraZoom(zoom) {
                camera.zoom = Math.min(2.4, Math.max(1, zoom))
                camera.updateProjectionMatrix()
                if (screenFocusT > 0) syncCamera()
            },
            setSelection(teamIdx, playerIdx) {
                selTeamIdx = teamIdx
                selPlayerIdx = playerIdx
                applySelection()
            },
            setTeamRanks(ranks) {
                teamRanks = ranks
                refreshDeskNumerals()
            },
            setPresentation(next) {
                const wasNonce = presentation?.nonce ?? null
                const wasDone = presentation?.doneTeamIdxs.join() ?? ""
                presentation = next
                // A new draw (or the order coming down) starts the reveal over; a
                // spotlight change keeps the desks as they are. The tick refreshes the
                // numerals on the reveal's own clock, so a late arrival gets the whole
                // board at once and a live room gets it desk by desk.
                if ((next?.nonce ?? null) !== wasNonce) presentationRevealed = -1
                // A team marked off (or put back) recolours its desk now rather than on
                // the next reveal step — there may not be another one.
                if (!next || (next.doneTeamIdxs.join() !== wasDone)) refreshDeskNumerals()
                // The wall fixes on the order, and comes back to whatever it was on
                // with a fresh dwell when the order comes down.
                screenPageAt = performance.now()
                redrawScreen()
            },
            setWinners(next) {
                const wasNonce = winners?.nonce ?? null
                const wasPlaces = winners?.podium.length ?? 0
                winners = next
                // Night falls when the ceremony starts, by daylight; a room already in
                // the evening is left on its own clock. Either way the sky comes back
                // to the clock when the ceremony ends.
                nightGoal = nightBlendTarget(clockMinute(), next !== null)
                // A place just read fires its volley — once. The set is keyed on the
                // ceremony too, so a rerun fires again. A screen that arrives late (a
                // reconnect, a tab opened mid-ceremony) does not replay a volley the
                // room has already watched: only a place announced moments ago fires.
                if (next) {
                    if (next.nonce !== wasNonce) firedVolleys.clear()
                    const nowEpoch = Date.now()
                    for (const entry of next.podium) {
                        const key = `${next.nonce}:${entry.place}`
                        if (firedVolleys.has(key)) continue
                        firedVolleys.add(key)
                        if (nowEpoch - entry.announcedAt > VOLLEY_REPLAY_WINDOW_MS) continue
                        launchVolley(fireworks, volleyForPlace(entry.place), performance.now(), Math.random)
                        fireworksPlayer(entry.place).sync(key, newsAudio)
                        for (const track of victoryMusic) {
                            track.player.sync(track.place === entry.place ? key : null, newsAudio)
                        }
                    }
                } else {
                    // The ceremony ending mid-salvo silences it with the sky.
                    for (const entry of fireworksAudio) entry.player.sync(null, newsAudio)
                    for (const entry of victoryMusic) entry.player.sync(null, newsAudio)
                }
                // The medals: pop in for a place just read, plain for a late arrival's
                // whole podium at once. The standings come back when the ceremony ends.
                refreshDeskNumerals(next !== null && next.nonce === wasNonce && next.podium.length > wasPlaces)
                // Every screen turns to the wall as the ceremony starts, and again for
                // each place if somebody has walked their camera away since — and is
                // handed back at the end, unless a bulletin is still holding it.
                if (next && !winnersFocusHeld && !screenFocused) {
                    winnersFocusHeld = true
                    setScreenFocus(true)
                } else if (!next && winnersFocusHeld) {
                    winnersFocusHeld = false
                    if (!newsFocusHeld) setScreenFocus(false)
                }
                screenPageAt = performance.now()
                redrawScreen()
            },
            setMarketNews(news) {
                const wasClip = marketNews?.clip ?? null
                marketNews = news
                const clip = news?.clip ?? null
                // The clip arrives a beat after the bulletin (it takes a round trip to
                // learn whether this event was filmed), so this is reached twice for the
                // same bulletin: start on the edge, and never restart a clip already
                // running.
                if (clip && clip.id !== wasClip?.id) startNewsVideo(clip)
                else if (!clip && (wasClip || newsVideo)) stopNewsVideo()
                else redrawScreen()

                // A bulletin takes the room's attention whether or not it was filmed.
                // The video path already does this from its first decoded frame; a
                // text-only announcement had nothing that did, so the wall lit up behind
                // whatever the player happened to be looking at. The room's furniture
                // also hides the bottom of the screen from a normal camera, which is
                // where a three-line bulletin's last line sits.
                if (news && !newsFocusHeld && !screenFocused) {
                    newsFocusHeld = true
                    setScreenFocus(true)
                } else if (!news && newsFocusHeld) {
                    // Released here rather than only in stopNewsVideo, which never runs
                    // for a bulletin that had no clip to stop. Unless the ceremony still
                    // wants the wall: a bulletin mid-podium must not hand the camera back.
                    newsFocusHeld = false
                    if (!winnersFocusHeld) setScreenFocus(false)
                }
            },
            setForcedScreenPage(page) {
                forcedScreenPage = page
                // Releasing leaves the wall on whatever it was showing and gives it a
                // fresh dwell, so the room reads the last page for its full time rather
                // than having it snatched away the instant the pin comes off.
                screenPageAt = performance.now()
                if (page) screenPage = page
                redrawScreen()
            },
            setNewsAudio(settings) {
                newsAudio = settings
                if (newsVideo) {
                    newsVideo.muted = settings.muted
                    newsVideo.volume = settings.volume
                }
            },
            setMoveInput(direction, active) {
                // Releases always land (a hold must never stick past losing control);
                // presses only mean something while a character is being walked.
                if (active && !localChar) return
                // The touch pad meets the same rebinding the arrow keys do while the
                // screen is framed — otherwise a player on a phone could walk their
                // character off out of sight while the camera stayed on the wall.
                const framed = active ? screenFocusKeyAction(`arrow${direction}`, screenFocused) : null
                if (framed) {
                    applyFramedAction(framed)
                    // Down is the way out on the pad too, and it walks as it goes.
                    if (framed !== "exit-and-move") return
                }
                localInput.setMoveInput(direction, active)
            },
            setLocalInputDisabled(disabled) {
                localInput.setDisabled(disabled)
                if (disabled) localMoving = false
            },
            setBackroomsUnlocked(unlocked) {
                backroomsUnlocked = unlocked
                if (unlocked && !hatch) revealHatch()
                hatchOpen.value = unlocked ? 1 : 0
                if (hatch) hatch.visible = unlocked
                if (secretPlant) secretPlant.position.x = toX(secretObject.x) - (unlocked ? 2 : 0)
            },
            setArcadeVisible(visible, entrance = true) {
                arcadeVisible = visible
                if (visible && !arcade) revealArcade(entrance)
                if (arcade) arcade.visible = visible
            },
            setPrimeyVisible(visible) {
                primeyVisible = visible
                primeyMesh.visible = visible
            },
            thanosSnap() {
                snapHalfTheRoom()
            },
            setRenderPaused(paused) {
                if (renderPaused === paused) return
                renderPaused = paused
                cancelAnimationFrame(raf)
                if (paused) {
                    localInput.releaseMovement()
                    localMoving = false
                    if (localChar) opts.onSelfState?.({ x: localPx.x, y: localPx.y, dir: localDir, moving: false })
                } else {
                    lastFrameAt = performance.now()
                    simCarryMs = 0
                    tick()
                }
            },
            interact() {
                fireInteract()
            },
            setQualityPreference(preference) {
                applyQualityPreference(preference)
            },
            pickNearCenter() {
                const rect = renderer.domElement.getBoundingClientRect()
                const centre = groundAt(rect.left + rect.width / 2, rect.top + rect.height / 2, interactProbe)
                if (!centre) return null
                return pickNearestToPoint({ x: centre.x, z: centre.z }, {
                    chars: chars.map((c) => ({ playerIdx: c.playerIdx, x: c.x, z: c.z })),
                    tables: PARTICIPANT_TABLES.map((tbl, teamIdx) => ({
                        teamIdx,
                        x: toX(tbl.x + tbl.w / 2),
                        z: toZ(tbl.y + tbl.h / 2),
                    })),
                })
            },
            setPlayerLobbyOrdinal(playerIdx, lobbyOrdinal) {
                const c = charByPlayerIdx.get(playerIdx)
                if (!c || c.lobbyOrdinal === lobbyOrdinal) return
                c.lobbyOrdinal = lobbyOrdinal
                if (c.teamIdx === null && lobbyOrdinal !== null && activeDrag?.char !== c) {
                    snapToAuthoritativeHome(c)
                }
            },
            setPlayerTeam(playerIdx, teamIdx, animate = false) {
                const c = charByPlayerIdx.get(playerIdx)
                if (!c || c.teamIdx === teamIdx) return
                if (activeDrag?.char === c) {
                    const pointerId = activeDrag.pointerId
                    activeDrag = null
                    clearDropHighlight()
                    snapToAuthoritativeHome(c)
                    renderer.domElement.style.cursor = "default"
                    if (renderer.domElement.hasPointerCapture(pointerId)) {
                        renderer.domElement.releasePointerCapture(pointerId)
                    }
                }
                const fromX = c.x
                const fromZ = c.z
                c.teamIdx = teamIdx
                c.transition = animate
                    ? { fromX, fromZ, startedAt: performance.now(), duration: 520 }
                    : null
                if (!animate) snapToAuthoritativeHome(c)
                refreshTeamLabels()
                applySelection()
            },
            setNetStates(states) {
                for (const s of states) {
                    const c = charByPlayerIdx.get(s.playerIdx)
                    if (!c || c === localChar) continue
                    c.net = { x: toX(s.x), z: toZ(s.y), dir: s.dir, moving: s.moving, live: s.live }
                    c.presenceHalo.visible = s.live
                }
            },
            setWanderStates(states) {
                for (const s of states) {
                    const c = charByPlayerIdx.get(s.playerIdx)
                    if (!c || c === localChar || c.teamIdx === null) continue
                    c.phase = s.phase
                    c.speed = s.speed
                    c.pauseLeft = s.pauseLeft
                    c.rng = s.rng
                    c.net = null
                    c.presenceHalo.visible = false
                    // A character the hub has just handed back — a player who hung up
                    // somewhere across the room — hops home rather than blinking there.
                    // A resync of one already on its lap is within a stride and just
                    // takes the correction.
                    const home = authoritativePosition(c)
                    const dx = home.x - c.x, dz = home.z - c.z
                    if (dx * dx + dz * dz > WANDER_HOP_DIST * WANDER_HOP_DIST) {
                        c.transition = { fromX: c.x, fromZ: c.z, startedAt: performance.now(), duration: 520 }
                    } else {
                        c.transition = null
                    }
                }
            },
            setLocalPlayer(playerIdx, start) {
                pendingLocal = null
                if (playerIdx !== null && !charByPlayerIdx.has(playerIdx)) {
                    // A guest character still materializing (sprite decode in flight) —
                    // remember the intent; the creation path completes the hand-over.
                    pendingLocal = { playerIdx, start }
                    releaseLocalControl()
                    return
                }
                const next = playerIdx === null ? null : charByPlayerIdx.get(playerIdx) ?? null
                if (next === localChar) return
                if (next) activateLocalControl(next, start)
                else releaseLocalControl()
            },
            upsertGuest(guest) {
                spawnGuestChar(guest)
            },
            removeGuest(playerIdx) {
                removeGuestChar(playerIdx)
            },
            showSpeech(playerIdx, text) {
                showSpeechFor(playerIdx, text)
            },
            showObjectSpeech(objectIdx, text) {
                showObjectSpeechFor(objectIdx, text)
            },
            setSessionClock(session) {
                sessionClock = session
                // The clock also says whether the event has started at all, and the
                // board page only exists once it has — a screen left on the board by a
                // poll that took the window away comes straight back to the countdown.
                if (!forcedScreenPage && !eventStarted(sessionClock) && screenPage !== "countdown") {
                    screenPage = "countdown"
                    screenPageAt = performance.now()
                }
                // Only the clock page reads it, and that page repaints on its own tick
                // anyway; repainting here means a window opening reaches the wall the
                // moment the poll carrying it does.
                if (screenPage === "countdown") redrawScreen()
            },
            setCountdown(target) {
                countdown = target ?? undefined
                // Only the clock page shows it; a retarget lands on the wall now rather
                // than on the next second's tick.
                if (screenPage === "countdown") redrawScreen()
            },
            setLeaderboard(rows) {
                screenRows = rows
                // A field that has shrunk can take the lower board off the ring while
                // the screen is standing on it — a page that is no longer available is
                // one nobody can turn away from, so leave it now rather than showing
                // five empty slots until the dwell runs out.
                if (
                    !forcedScreenPage &&
                    !availableScreenPages(eventStarted(sessionClock), screenRows.length).includes(screenPage)
                ) {
                    screenPage = SCREEN_PAGES[0]
                    screenPageAt = performance.now()
                }
                // Only a board page shows them; the countdown redraws on its own tick
                // anyway, so there is nothing to repaint for it here.
                if (isBoardPage(screenPage)) redrawScreen()
            },
            freezeLocalInput(ms, faceDir) {
                inputFrozenUntil = performance.now() + ms
                localMoving = false
                if (faceDir !== undefined) localDir = faceDir
            },
            setPlayerBusy(playerIdx, busy) {
                const c = charByPlayerIdx.get(playerIdx)
                if (!c) return
                c.busy = busy
                if (busy && activeDrag?.char === c) {
                    const pointerId = activeDrag.pointerId
                    activeDrag = null
                    c.transition = null
                    snapToAuthoritativeHome(c)
                    clearDropHighlight()
                    applySelection()
                    renderer.domElement.style.cursor = "default"
                    if (renderer.domElement.hasPointerCapture(pointerId)) {
                        renderer.domElement.releasePointerCapture(pointerId)
                    }
                }
            },
            dispose() {
                cleanup()
            },
        }
    } catch (error) {
        cleanup()
        throw error
    }
}
