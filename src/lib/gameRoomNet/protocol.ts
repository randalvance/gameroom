// Wire protocol for the multiplayer game room: what the hub pushes down the
// SSE stream and what clients POST up. Positions travel in the 2D room plan's
// pixel space; the scene owns the px→world mapping.
//
// Characters are addressed by `idx`, a session-stable small integer the hub
// assigns per visitor (append-only, so it never shifts mid-session). The
// `hello` event carries the idx ↔ user id mapping; clients translate to their
// own playerIdx from there. Snapshots then stay compact — no repeated id
// strings at 10 Hz.
//
// Only humans travel here. The agents are the host's, drawn by every client
// from the same props; the hub never hears of them.

import type { WalkDir } from "../../components/gameRoom/spriteIndex"
import type { Role } from "../auth"
import type { RoomMusic } from "../game-room-music"

/** How often the hub broadcasts a snapshot of the characters being controlled. */
export const SNAPSHOT_INTERVAL_MS = 100

export interface NetCharState {
  idx: number
  /** Room-plan px. */
  x: number
  y: number
  dir: WalkDir
  moving: boolean
  /** Player-controlled right now (false = frozen in a conversation). */
  live: boolean
}

/** Compact snapshot entry: [idx, x, y, dir, flags] — flags bit0 moving, bit1 live. */
export type SnapshotEntry = [number, number, number, number, number]

/** A connected visitor, as hello and join carry them: everything a client
 * needs to draw a character it has never seen. */
export interface VisitorDTO {
  idx: number
  /** The host's id for this person. */
  id: string
  name: string
  role: Role
  spriteId: number | null
  spriteSheet: string | null
}

export interface HelloEvent {
  /** This user's plant discovery. Never room-wide. */
  backroomsUnlocked?: boolean
  /** The connecting user's own idx, or null for viewers with no character. */
  you: number | null
  /** Everyone in the room right now, this user included. */
  visitors: VisitorDTO[]
  /** Where they all are — what snapshots carry. */
  states: SnapshotEntry[]
  /**
   * What the gamemaster has put on the PA screens' music — one looping track,
   * silence, or null for the room's own playlist. State, and carried here so
   * a screen that reconnects mid-hold plays what the others do.
   */
  music?: RoomMusic
}

/** Every character in the room: the connected visitors, at the positions
 * their own clients reported, plus anyone frozen mid-conversation. */
export interface SnapshotEvent {
  states: SnapshotEntry[]
}

/** A visitor arrived: the full entry, since the other clients have never
 * heard of them. */
export type JoinEvent = VisitorDTO

/** A visitor's last connection closed; their character leaves with them. */
export interface LeaveEvent {
  idx: number
}

/** How long a conversation freezes its reader, from its text. Shared: a room
 * with no hub runs the plants' dialogue itself, on the same clock. */
export function dialogDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(6_000, Math.max(2_500, 1_200 + words * 350))
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
