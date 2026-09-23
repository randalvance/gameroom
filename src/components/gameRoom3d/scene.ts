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
import { roomTitle } from "./room-branding"
import { BIG_SCREEN_IDX, BIG_SCREEN_POINT, BOARD_MAX_LINES, type RoomBoard } from "./wall"
import { localMinutes, parseTimeOverride, skyPalette } from "./time-of-day"
import type { RoomSelection } from "../gameRoom/InfoPanel"
import {
    CHARACTER_SCALE,
    characterGroundY,
    characterPlaneSize,
    characterShadowLocalY,
    characterTopY,
    NOMINAL_CHARACTER_TOP_Y,
} from "./character-scale"
import { createBackdrop } from "./backdrop"
import { createBackroomsHatch, maskHatchOpening } from "./backrooms-hatch"
import { ARCADE_IDX, ARCADE_POINT, createArcadeCabinet } from "./arcade-cabinet"
import { createArcadeReveal, REVEAL, type ArcadeReveal } from "./arcade-reveal"
import {
    EMPTY_TABLE_LABEL,
    isExhibitionDesk,
    tableLegColorForCompetition,
    tableHasTeam,
    tableLabelText,
    tableTopColorForCompetition,
} from "./team-tables"
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
    playerIdx: number
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
    onPick?: (pick: RoomSelection) => void
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
    setCameraPan(x: number, z: number): void
    setCameraZoom(zoom: number): void
    setPlayerTeam(playerIdx: number, teamIdx: number | null, animate?: boolean): void
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
     * hidden, the room has no mascot). */
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
    /** The wall's resting page: a title and a few lines, or null for the
     * room's title alone. */
    setBoard(board: RoomBoard | null): void
    /**
     * A bulletin taking over the wall, or null to hand it back.
     *
     * While one is up every camera in the room turns to the wall and holds —
     * the furniture stands down so the whole text can be read — and is handed
     * back when it comes down, unless the player has since taken the camera
     * elsewhere themselves.
     */
    setBulletin(text: string | null): void
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

/** A soft round spot for dust motes: bright core, feathered edge. */
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

/** Greedy word wrap into at most `maxLines` lines; a longer text is elided. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    for (const word of words) {
        const at = lines.length - 1
        const candidate = at < 0 ? word : `${lines[at]} ${word}`
        if (at < 0 || ctx.measureText(candidate).width > maxWidth) lines.push(word)
        else lines[at] = candidate
    }
    const visible = lines.slice(0, maxLines)
    if (lines.length > visible.length && visible.length > 0) {
        visible[visible.length - 1] = `${visible[visible.length - 1]!.replace(/[.…]+$/, "")}…`
    }
    return visible
}

/**
 * The wall: a bulletin while one is up, otherwise the board — the host's
 * title and lines, or the room's own title over an empty band.
 */
function drawScreenCanvas(ctx: CanvasRenderingContext2D, board: RoomBoard | null, bulletin: string | null) {
    const W = SCREEN_TEX_W, H = SCREEN_TEX_H
    ctx.fillStyle = "#020510"
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = "#3050c8"
    ctx.lineWidth = 8
    ctx.strokeRect(8, 8, W - 16, H - 16)
    ctx.textAlign = "center"
    if (bulletin) {
        ctx.fillStyle = "#A51F32"
        ctx.fillRect(12, 12, W - 24, 88)
        ctx.fillStyle = "#FFF4F4"
        ctx.font = "bold 56px 'Courier New', monospace"
        ctx.fillText("◆ ANNOUNCEMENT ◆", W / 2, 75)
        ctx.fillStyle = TEXT_BRIGHT
        ctx.font = "bold 46px 'Courier New', monospace"
        // Three lines from here still finish above SCREEN_CONTENT_BOTTOM.
        wrapLines(ctx, bulletin, W - 180, 3).forEach((line, index) => ctx.fillText(line, W / 2, 175 + index * 60, W - 180))
        return
    }
    ctx.fillStyle = TEXT_BRIGHT
    ctx.font = "bold 96px 'Courier New', monospace"
    ctx.fillText(board?.title ?? roomTitle(), W / 2, 128, W - 160)
    ctx.fillStyle = "#2840A8"
    ctx.fillRect(90, 166, W - 180, 5)
    ctx.fillStyle = "#A0B8FF"
    ctx.font = "48px 'Courier New', monospace"
    const lines = (board?.lines ?? []).slice(0, BOARD_MAX_LINES)
    lines.forEach((line, index) => ctx.fillText(line, W / 2, 226 + index * 50, W - 180))
    // The panel below the content fades out rather than ending on a hard edge,
    // so the part down by the plinth reads as screen, not as a gap.
    const skirt = ctx.createLinearGradient(0, SCREEN_CONTENT_BOTTOM + 24, 0, H)
    skirt.addColorStop(0, "rgba(40,64,168,0.20)")
    skirt.addColorStop(1, "rgba(4,8,24,0)")
    ctx.fillStyle = skirt
    ctx.fillRect(12, SCREEN_CONTENT_BOTTOM + 24, W - 24, H - SCREEN_CONTENT_BOTTOM - 36)
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


// WALK_SPEED now lives in lib/gameRoomNet/wander.ts, shared with the
// multiplayer hub so the server-side wander walks the same gait.
/** Simulation steps per sprite frame: the walk cycle at WALK_SPEED = 1. */
const WALK_FRAME_STEPS = 6
/** Peak of the hop a character makes when it moves between two seats. */
const TRANSITION_HOP = 0.7

/** How much of its colour and light an unused desk keeps — see team-tables.ts. */
const EMPTY_TABLE_FADE = 0.42


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
    playerIdx: number
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
        // The fog brackets scale off the room depth, so the far wall reads as
        // city haze rather than a smoky far half.
        scene.fog = new THREE.Fog(0x05070f, ROOM_D * 2, ROOM_D * 3.7)

        // Fixed, front-facing camera. The far plane clears the backdrop's haze
        // shell (r=520), not just the room: 200 would cull the city outside.
        const camera = new THREE.PerspectiveCamera(45, CW / CH, 0.1, 1400)
        // High and a touch back, so the far rows clear the near ones.
        camera.position.set(0, 34, ROOM_D + 24)
        camera.lookAt(0, 0.6, ROOM_D * 0.4)
        const cameraHomePosition = camera.position.clone()
        const cameraHomeTarget = new THREE.Vector3(0, 0.6, ROOM_D * 0.4)

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
                // room's far end disappears behind a silhouette tower.
                clearRadius: Math.hypot(
                    Math.abs(cameraHomePosition.x) + ROOM_W / 2,
                    cameraHomePosition.z + NORTH_APRON,
                ) + 8,
                lightsScale: q.backdropLightsScale,
            },
        )
        const todOverride = parseTimeOverride(window.location.search)
        const clockMinute = () => todOverride ?? localMinutes(new Date())
        let paletteMinute = -1
        // The palette in force, so the lights can be retuned to it.
        let palette: ReturnType<typeof skyPalette> | null = null
        const applyTimeOfDay = () => {
            const minute = clockMinute()
            if (minute === paletteMinute) return
            paletteMinute = minute
            const p = skyPalette(minute)
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
        scene.add(rightGlass)

        // ---- the rest of our own tower -------------------------------------------
        // With a real city outside, a floor plane ending in mid-air reads as a
        // mistake rather than a diorama. A fascia over the glass line and a few
        // storeys of the building falling away beneath the slab turn the cut-away
        // into a floor OF something. The top stays open — the camera looks down
        // into the room, so a ceiling would be all it ever saw.
        {
            const plateWest = -ROOM_W / 2
            const plateEast = ROOM_W / 2
            const plateNorth = -NORTH_APRON
            // The slab runs past the south glass line by as much as the camera may pan
            // that way (plus margin for the widest zoom), so panning down always lands
            // the bottom of the frame on structure. Without it, buying enough southward
            // pan to keep the last row's characters in frame would buy a view of the
            // tower's blank south face as well.
            const plateSouth = ROOM_D + ROOM_CAMERA_MAX_PAN_SOUTH + 3
            const plateW = plateEast - plateWest
            const plateD = plateSouth - plateNorth
            const plateX = (plateWest + plateEast) / 2
            const plateZ = (plateNorth + plateSouth) / 2

            const fasciaMat = track(surfaceMaterial({ color: 0x232733, roughness: 0.55, metalness: 0.35 }))
            // fascia band capping the glass, on the three walls that exist
            const fasciaSpans: Array<[w: number, x: number, z: number, rotY: number]> = [
                [ROOM_W + 0.7, 0, 0, 0],
                [ROOM_D + 0.7, -ROOM_W / 2, ROOM_D / 2, Math.PI / 2],
                [ROOM_D + 0.7, ROOM_W / 2, ROOM_D / 2, Math.PI / 2],
            ]
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
        /** The wall's resting page, or null for the room's title alone. */
        let board: RoomBoard | null = null
        /** The bulletin up on the wall, or null while it shows the board. */
        let bulletinText: string | null = null
        // Whether the auto-frame on the wall was OURS to release. A player who
        // presses Escape mid-bulletin has taken the camera back, and the bulletin
        // coming down must not yank it away from wherever they went.
        let bulletinFocusHeld = false
        const redrawScreen = () => {
            drawScreenCanvas(screenCtx, board, bulletinText)
            screenTex.needsUpdate = true
        }
        drawScreenCanvas(screenCtx, board, bulletinText)
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
        // The palette's three lights and the desk pools, retuned whenever the
        // clock outside moves.
        const applyLightLevel = () => {
            if (palette) {
                hemi.intensity = palette.hemiIntensity
                key.intensity = palette.keyIntensity
                rim.intensity = palette.rimIntensity
            }
            for (const light of deskLights) light.intensity = light.userData.baseIntensity as number
        }
        buildDeskLights(q.deskLightsPerRow)
        registerCleanup(() => {
            for (const light of deskLights) light.dispose()
        })


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
         * so they stop covering the band the text is written in; backing out
         * puts them back. Collected as they are built rather than searched for by
         * name, so a new piece of furniture in front of the screen only has to be
         * pushed here.
         */
        const screenOccluders: THREE.Object3D[] = []
        const tableHitboxes: THREE.Mesh[] = []
        const hitboxGeo = track(new THREE.BoxGeometry(6.4, 2.6, 4))
        const hitboxMat = track(new THREE.MeshBasicMaterial({ visible: false }))
        const labelSprites: Array<{
            sprite: THREE.Sprite
            baseLabel: string
            normal: THREE.Texture
            gold: THREE.Texture
            hasTeam: boolean
        }> = []

        /** Is there a team behind the desk at this index, or is it just furniture? */
        const hasTeamAt = (ti: number) => tableHasTeam(ti, opts.teamLabels.length)


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
            const label = tableLabelText(ti, opts.teamLabels, { count: 0, showCount: false })
            const normal = makeLabelTexture(label, false, !hasTeam)
            const gold = makeLabelTexture(label, true)
            const labelMat = track(new THREE.SpriteMaterial({ map: normal, depthTest: true }))
            const sprite = new THREE.Sprite(labelMat)
            sprite.scale.set(2.9, 0.8, 1)
            sprite.position.set(0, AREA_LABEL_Y, 0)
            group.add(sprite)
            if (!hasTeam) fadeTable(group)
            screenOccluders.push(group)
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

        const chars: CharState[] = opts.players.map((p) => {
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
                playerIdx: p.playerIdx,
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
                    playerIdx: guest.playerIdx,
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
        const framedPose = (): CameraPose =>
            screenFocusPose({
                width: SCREEN_W,
                height: SCREEN_H,
                centreY: SCREEN_CY,
                z: screen.position.z,
                fovDeg: camera.fov,
                aspect: camera.aspect,
                zoom: camera.zoom,
            })

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
            // bulletin no longer holds it, so its coming down will not move them.
            if (!next) bulletinFocusHeld = false
            screenFocused = next
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

        const setHoveredPlayer = (playerIdx: number | null) => {
            if (playerIdx === hoverPlayerIdx) return
            hoverPlayerIdx = playerIdx
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
            if (!activePanDrag && !activePinch && touchPoints.size === 0) {
                suppressNextClick = false
            }
            if (e.pointerType === "touch") {
                touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
                // A second finger starts the pinch. Third and later fingers do nothing.
                if (touchPoints.size === 2) {
                    beginPinch()
                    return
                }
                if (touchPoints.size > 2) return
            }
            if (activePanDrag || activePinch || (e.pointerType === "mouse" && e.button !== 0)) return
            updatePointer(e)
            beginPanDrag(e)
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
            if (activePanDrag?.pointerId === e.pointerId) {
                updatePanDrag(e)
                if (activePanDrag?.panning) {
                    e.preventDefault()
                    return
                }
            }
            updatePointer(e)
        }
        const onPointerUp = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
        }
        const onPointerCancel = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
        }
        const onLostPointerCapture = (e: PointerEvent) => {
            finishPanDrag(e)
        }
        const onPointerLeave = () => {
            if (activePanDrag) return
            pointerDirty = false
            setHoveredPlayer(null)
            renderer.domElement.style.cursor = "default"
        }

        // Every press on the floor drags the room; a click picks.
        renderer.domElement.addEventListener("pointerdown", onPointerDown)
        renderer.domElement.addEventListener("pointermove", onMove)
        renderer.domElement.addEventListener("pointerup", onPointerUp)
        renderer.domElement.addEventListener("pointercancel", onPointerCancel)
        renderer.domElement.addEventListener("lostpointercapture", onLostPointerCapture)
        renderer.domElement.addEventListener("pointerleave", onPointerLeave)
        // Raw touches are handled here (drag-pan and pinch-zoom), so the browser
        // gets none of them.
        renderer.domElement.style.touchAction = "none"
        renderer.domElement.addEventListener("click", onClick)
        registerCleanup(() => {
            renderer.domElement.removeEventListener("click", onClick)
            renderer.domElement.removeEventListener("pointerdown", onPointerDown)
            renderer.domElement.removeEventListener("pointermove", onMove)
            renderer.domElement.removeEventListener("pointerup", onPointerUp)
            renderer.domElement.removeEventListener("pointercancel", onPointerCancel)
            renderer.domElement.removeEventListener("lostpointercapture", onLostPointerCapture)
            renderer.domElement.removeEventListener("pointerleave", onPointerLeave)
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
            if (localChar) {
                for (let step = 0; step < advance.steps; step++) stepLocalControl()
            }
            for (const c of chars) {
                const isLocal = c === localChar
                let dir: WalkDir
                let standing: boolean
                if (isLocal) {
                    // The player's own character: keyboard-driven, collision-checked,
                    // zero-latency — the hub only relays it to everyone else.
                    c.transition = null
                    c.x = toX(localPx.x)
                    c.z = toZ(localPx.y)
                    c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
                    dir = localDir
                    standing = !localMoving
                } else if (c.net) {
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
                    if (c.teamIdx !== null) {
                        for (let step = 0; step < advance.steps; step++) stepWander(c)
                    }
                    const home = authoritativePosition(c)
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
                    dir = home.dir
                    standing = c.teamIdx === null || c.pauseLeft > 0
                }
                const row = c.format.dirRow[dir]
                const animFrame = standing ? c.format.standFrame : c.format.walkFrame(walkFrame)
                c.texture.offset.set(animFrame / c.format.cols, 1 - (row + 1) / c.format.rows)
                const dim = selTeamIdx !== null && c.teamIdx !== selTeamIdx
                c.material.color.setHex(dim ? 0x3c4256 : 0xffffff)
                // Keep opacity above alphaTest (0.5) so dimmed sprites stay visible.
                c.material.opacity = dim ? 0.65 : 1
                // Keep the halo in world space, centred on the character's ground
                // position. Attaching it to the billboard makes it inherit sprite-facing
                // transforms and can pull the projected ring away from the feet.
                c.presenceHalo.position.set(c.x, 0.03, c.z)
            }
            // The snap's fade overrides the opacity and height just set.
            stepSnap(frameMs)


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
            if (pointerDirty && !activePanDrag?.panning) {
                const pick = pickAt()
                const newHover = pick?.type === "player" ? pick.idx : null
                renderer.domElement.style.cursor = pick ? "pointer" : "default"
                if (newHover !== hoverPlayerIdx) {
                    setHoveredPlayer(newHover)
                }
                pointerDirty = false
            } else if (activePanDrag?.panning) {
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

            if (grade) grade.uniforms.uTime!.value = t
            if (composer) composer.render()
            else renderer.render(scene, camera)

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
            setPlayerTeam(playerIdx, teamIdx, animate = false) {
                const c = charByPlayerIdx.get(playerIdx)
                if (!c || c.teamIdx === teamIdx) return
                const fromX = c.x
                const fromZ = c.z
                c.teamIdx = teamIdx
                c.transition = animate
                    ? { fromX, fromZ, startedAt: performance.now(), duration: 520 }
                    : null
                if (!animate) snapToAuthoritativeHome(c)
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
            setBoard(next) {
                board = next
                redrawScreen()
            },
            setBulletin(text) {
                bulletinText = text
                redrawScreen()
                // A bulletin takes the room's attention: the wall lights up behind
                // whatever the player happened to be looking at, and the room's
                // furniture hides the bottom of the screen from a normal camera,
                // which is where a three-line bulletin's last line sits.
                if (text && !bulletinFocusHeld && !screenFocused) {
                    bulletinFocusHeld = true
                    setScreenFocus(true)
                } else if (!text && bulletinFocusHeld) {
                    bulletinFocusHeld = false
                    setScreenFocus(false)
                }
            },
            freezeLocalInput(ms, faceDir) {
                inputFrozenUntil = performance.now() + ms
                localMoving = false
                if (faceDir !== undefined) localDir = faceDir
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
