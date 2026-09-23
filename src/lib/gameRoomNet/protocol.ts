// Wire protocol for the multiplayer game room: what the hub pushes down the
// SSE stream and what clients POST up. Positions travel in the 2D room plan's
// pixel space; the scene owns the px→world mapping.
//
// Characters are addressed by `idx`, a session-stable small integer the hub
// assigns per roster member (append-only, so it never shifts mid-session).
// The `hello` event carries the idx ↔ users.id mapping; clients translate to
// their own playerIdx from there. Snapshots then stay compact — no repeated
// Clerk-id strings at 10 Hz.

import type { WalkDir } from "../../components/gameRoom/spriteIndex"
import type { PlayerRole } from "../event-types"
import type { RoomMusic } from "../game-room-music"
import type { WanderState } from "./wander"

/** How often the hub broadcasts a snapshot of the characters being controlled. */
export const SNAPSHOT_INTERVAL_MS = 100

/**
 * How often the hub re-sends every idle character's simulation state.
 *
 * Idle characters are not streamed: their orbit of the table is a deterministic
 * simulation every client runs for itself, so all a client needs is the
 * state to run it from. That goes out when a character becomes idle (a player
 * hangs up, a conversation ends) and then on this cadence, to pull back the
 * drift of clocks that tick at nominally the same rate — a throttled
 * background tab loses steps, a foreground one does not.
 */
export const WANDER_SYNC_INTERVAL_MS = 5_000

export interface NetCharState {
  idx: number
  /** Room-plan px. */
  x: number
  y: number
  dir: WalkDir
  moving: boolean
  /** Player-controlled right now (false = server-side wander). */
  live: boolean
}

/** Compact snapshot entry: [idx, x, y, dir, flags] — flags bit0 moving, bit1 live. */
export type SnapshotEntry = [number, number, number, number, number]

/**
 * An idle character's simulation state: [idx, phase, speed, pauseLeft, rng] —
 * exactly a WanderState, which the client steps from here on. Phase is the
 * distance along the table's orbit in plan px; the rest are as seeded.
 */
export type WanderEntry = [number, number, number, number, number]

export function packWander(idx: number, w: WanderState): WanderEntry {
  return [idx, Math.round(w.phase * 100) / 100, w.speed, w.pauseLeft, w.rng]
}

export function unpackWander(e: WanderEntry): { idx: number } & WanderState {
  return { idx: e[0], phase: e[1], speed: e[2], pauseLeft: e[3], rng: e[4] }
}

export interface RosterEntryDTO {
  idx: number
  id: string // users.id (Clerk id)
  name: string
  team: string
  /** A visitor (admin/mentor/judge — anyone without a seat on the map): the
   * character exists only while they are connected. Guests are unknown to the
   * page's own roster, so the entry carries their sprite too. */
  guest?: boolean
  role?: PlayerRole
  spriteId?: number | null
  spriteSheet?: string | null
}

export interface HelloEvent {
  /** This user's plant discovery; optional during a rollout. Never room-wide. */
  backroomsUnlocked?: boolean
  /** The connecting user's own idx, or null for viewers with no character. */
  you: number | null
  roster: RosterEntryDTO[]
  /** The characters being controlled right now — what snapshots carry. */
  states: SnapshotEntry[]
  /** Everyone else, as the simulation state to run them from. */
  wanders: WanderEntry[]
  /**
   * What the gamemaster has put on the PA screens' music — one looping track,
   * silence, or null for the room's own playlist. Optional during a rollout;
   * state like `screen`, and carried here for the same reason.
   */
  music?: RoomMusic
}

/**
 * The characters being controlled: live players, plus anyone frozen in a
 * conversation, whose facing the hub set. An idle character is NOT here —
 * its absence means "run the wander you were last handed for it".
 */
export interface SnapshotEvent {
  states: SnapshotEntry[]
}

/**
 * Idle characters' simulation state: every one of them on the sync cadence,
 * or just the ones that have gone idle since the last snapshot. A client
 * adopts each state and steps it locally from there.
 */
export interface WanderEvent {
  wanders: WanderEntry[]
}

/** join carries the full roster entry — a guest joining mid-session is a
 * character the other clients have never heard of. */
export type JoinEvent = RosterEntryDTO

export interface LeaveEvent {
  idx: number
  /** A departing guest's character disappears; a student's returns to its table. */
  guest?: boolean
}

/** Cadence of the dialog box's word-by-word reveal. Shared: the client's
 * typewriter runs at this rate, and the hub uses it to know the earliest
 * moment a participant can honestly have finished reading — the gate for
 * dismissing a conversation early. */
export const DIALOG_WORD_INTERVAL_MS = 110

/** When the typewriter finishes revealing `text` (relative to dialog start):
 * the first word shows immediately, each further word one interval later. */
export function dialogTypewriterMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(0, words - 1) * DIALOG_WORD_INTERVAL_MS
}

/** A reader dismissed their private dialogue. Sent only to that user's sessions.
 * `b` stays null; retained for wire compatibility with older clients. */
export interface DialogEndEvent {
  a: number
  b: number | null
}

/** A private introduction from `idx` to `by`, delivered only to `by`'s user.
 * Only the interacting player renders the dialogue and freezes for `ms`. */
export interface SayEvent {
  /** The character speaking (the interact target). */
  idx: number
  /** The character they are speaking to (the interactor). */
  by: number
  /** The speaker's display name, for the dialog box header. */
  name: string
  text: string
  /** How long the conversation (and the movement freeze) lasts. */
  ms: number
}

/** A typed chat line: shown as a bubble over the speaker and a line in every
 * client's chat stream. Unlike `say`, nobody freezes and no dialog opens. */
export interface ChatEvent {
  /** The speaker. */
  idx: number
  /** The speaker's display name, for the chat stream. */
  name: string
  text: string
}

/** The gamemaster put one track on, stopped the music, or gave it back. */
export type MusicEvent = RoomMusic

/**
 * A bulletin the gamemaster pushed straight at the room. A moment rather
 * than state: nothing replays it, and the wall is raised by its arrival.
 */
export interface BulletinEvent {
  message: string
  /**
   * Which send this is. Two identical bulletins are indistinguishable by
   * content, so the client needs this to know the second one is a second one
   * and raise the banner again.
   */
  nonce: number
  /** How long the gamemaster asked the wall to hold this, in ms. Absent for
   * the room's default. */
  holdMs?: number
}

export function packState(s: NetCharState): SnapshotEntry {
  return [
    s.idx,
    Math.round(s.x * 10) / 10,
    Math.round(s.y * 10) / 10,
    s.dir,
    (s.moving ? 1 : 0) | (s.live ? 2 : 0),
  ]
}

export function unpackState(e: SnapshotEntry): NetCharState {
  return {
    idx: e[0],
    x: e[1],
    y: e[2],
    dir: (e[3] & 3) as WalkDir,
    moving: (e[4] & 1) !== 0,
    live: (e[4] & 2) !== 0,
  }
}

// -------------------------------------------------------------- client → hub

export interface PlayerInputMessage {
  x: number
  y: number
  dir: WalkDir
  moving: boolean
}

/** Validates a POSTed input body. Returns null rather than throwing — a bad
 * body is a client bug or mischief, not a server error. */
export function parsePlayerInput(body: unknown): PlayerInputMessage | null {
  const o = body as Record<string, unknown>
  if (
    !o ||
    typeof o.x !== "number" || !Number.isFinite(o.x) ||
    typeof o.y !== "number" || !Number.isFinite(o.y) ||
    typeof o.dir !== "number" || ![0, 1, 2, 3].includes(o.dir) ||
    typeof o.moving !== "boolean"
  ) {
    return null
  }
  return { x: o.x, y: o.y, dir: o.dir as WalkDir, moving: o.moving }
}

export interface InteractMessage {
  targetIdx: number
}

export function parseInteract(body: unknown): InteractMessage | null {
  const o = body as Record<string, unknown>
  if (!o || typeof o.targetIdx !== "number" || !Number.isInteger(o.targetIdx) || o.targetIdx < 0) {
    return null
  }
  return { targetIdx: o.targetIdx }
}

/** Chat length cap, enforced by the input's maxLength AND parseChat — a body
 * over the cap therefore didn't come from the UI and is rejected outright. */
export const CHAT_MAX_LEN = 200

export interface ChatMessage {
  text: string
}

/** Validates a POSTed chat body: trims, collapses internal whitespace (the
 * bubble renders one line), and rejects empty or over-long text. */
export function parseChat(body: unknown): ChatMessage | null {
  const o = body as Record<string, unknown>
  if (!o || typeof o.text !== "string" || o.text.length > CHAT_MAX_LEN) return null
  const text = o.text.replace(/\s+/g, " ").trim()
  if (!text) return null
  return { text }
}

// ------------------------------------------------------------------ framing

export type GameRoomEventName =
  | "backrooms"
  | "hello"
  | "snapshot"
  | "wander"
  | "join"
  | "leave"
  | "say"
  | "dialogEnd"
  | "chat"
  | "bulletin"
  | "music"

/** One SSE frame: named event + JSON data. */
export function sseFrame(event: GameRoomEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
