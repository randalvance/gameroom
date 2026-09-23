// The scene's public surface: what a host hands in, what it gets back, and
// the handle it drives the room through. Types only; scene.ts re-exports them.

import type { WalkDir } from "../../gameRoom/spriteIndex"
import type { AgentStatus, FollowSlot, ResolvedStatusStyle } from "../../../lib/agents"
import type { RoomBoard } from "../wall"
import type { RoomSelection } from "../selection"
import type { RoomCameraPan } from "../camera-pan"
import type { RoomRole } from "../role-colors"
import type { GraphicsPreference, QualityTier } from "../quality-tier"

/** An agent as the scene draws it: the host's agent, its status rolled up
 * and its look resolved. Hand the same id in again to change any of it. */
export interface RoomAgentInput {
    id: string
    name: string
    status: AgentStatus
    style: ResolvedStatusStyle
    activity?: string
    /** A stock sheet index, or a URL to a 6×4 sheet. Absent derives one from the id. */
    sprite?: number | string
    /** Halo tint override, as a CSS hex colour. */
    color?: string
    /** Its place in a family's line: whose trail it follows, and how far back. */
    follow?: FollowSlot | null
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

/** The local player's own state, reported back up to the hub. Room-plan px. */
export interface RoomSelfState {
    x: number
    y: number
    dir: WalkDir
    moving: boolean
}

export interface CreateRoomOptions {
    onPick?: (pick: RoomSelection) => void
    /** Dragging the floor moves the camera; this reports where it ended up. */
    onCameraPan?: (pan: RoomCameraPan) => void
    /** A pinch zoomed the camera; this keeps the viewport's zoom state (and so
     * the +/− buttons and wheel) carrying on from where the fingers left it. */
    onCameraZoom?: (zoom: number) => void
    /** The local player's character moved/turned (throttled to ~10 Hz). */
    onSelfState?: (state: RoomSelfState) => void
    /** The local player pressed interact while facing this visitor's character
     * (or a room object). What happens next is the hub's. */
    onInteract?: (targetPlayerIdx: number) => void
    /** The local player pressed interact while facing this agent. Local: the
     * host decides what a conversation with an agent is. */
    onAgentInteract?: (agentId: string) => void
    /** The local player pressed interact while facing this desk. Unlike
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
    setSelection(selection: RoomSelection): void
    setCameraPan(x: number, z: number): void
    setCameraZoom(zoom: number): void
    /**
     * An agent arrived, or changed. A new one is seated at the emptiest desk
     * and walks in from the aisle; past the desks it stands in the aisle. A
     * known one takes the new name, status, look and bubble in place.
     */
    upsertAgent(agent: RoomAgentInput): void
    /** The agent is gone: it fades out where it stands and its seat frees. */
    removeAgent(agentId: string): void
    /** A speech bubble over an agent, for `ms` (the room's default when
     * absent) — the host's answer to onAgentInteract, or anything else it
     * wants said. */
    say(agentId: string, text: string, ms?: number): void
    /** Hub-driven positions for the other visitors (the local player is skipped). */
    setNetStates(states: readonly RoomNetState[]): void
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
