// The visitors' hub: one in-memory, in-process authority for where the humans
// in the room are. Each connected visitor's client reports its own position
// (validated here); the hub relays it to everyone else, runs the private
// conversations (the plants, the introductions), the chat, and the
// gamemaster's controls (music, a bulletin).
//
// The agents are not here. They are the host's, handed to every client as
// props, and every client seats and walks the same agents from the same
// seeds — so two clients see the same room without the hub relaying a single
// agent position.
//
// Transport is SSE down + POST up. The hub itself is transport-agnostic:
// subscribers are just `send(frame)` sinks, which is also what the tests use.
//
// State is deliberately ephemeral. A restart empties the room and
// reconnecting EventSources rebuild the session. Known limit: >1 server
// replica would split the room; run it as a single process.

import type { WalkDir } from "~/components/gameRoom/spriteIndex"
import { logger } from "~/lib/logger"
import { SIM_STEP_MS } from "~/components/gameRoom3d/sim-clock"
import type { Role } from "~/lib/auth"
import {
  buildStaticColliders,
  facingForInput,
  pointBlocked,
  PLAYER_SPEED_PX_PER_STEP,
  ROOM_BOUNDS,
  INTERACT_PROBE_PX,
  INTERACT_RANGE_PX,
  type Rect,
} from "~/lib/gameRoomNet/collision"
import {
  dialogDurationMs,
  dialogTypewriterMs,
  packState,
  sseFrame,
  SNAPSHOT_INTERVAL_MS,
  type HelloEvent,
  type PlayerInputMessage,
  type SnapshotEntry,
  type VisitorDTO,
} from "~/lib/gameRoomNet/protocol"
import {
  OBJECT_IDX_BASE,
  BACKROOMS_UNLOCK_COUNT,
  objectSpeech,
  roomObjectByIdx,
} from "~/lib/gameRoomNet/objects"
import { censor } from "~/lib/gameRoomNet/profanity"
import type { RoomMusic } from "~/lib/game-room-music"
import { visitorSpawnPoint } from "~/lib/gameRoomNet/spawn"

export { visitorSpawnPoint }

/** A tab that stops reporting for this long reads as standing still. */
const INPUT_STALE_MS = 3_000
/** Validation slack: legitimate clients burst above the exact per-step speed
 * (frame batching, network jitter), so allow this factor plus a flat margin. */
const SPEED_SLACK = 1.75
const SPEED_SLACK_PX = 6
/** Interact reach: probe + range + a little latency slack. */
const INTERACT_MAX_DIST_PX = INTERACT_PROBE_PX + INTERACT_RANGE_PX + 14
const INTERACT_COOLDOWN_MS = 400

export interface HubChar {
  idx: number
  id: string
  name: string
  x: number
  y: number
  dir: WalkDir
  moving: boolean
  /** Open connections controlling this character. */
  live: number
  lastInputAt: number
  /** The visitor's role, for their halo and their introduction. */
  role: Role
  /** The last connection closed: hidden from the room, but the slot (and its
   * idx) is kept so a reconnect revives the same character. */
  departed: boolean
  spriteId: number | null
  spriteSheet: string | null
}

interface Subscriber {
  userId: string
  send: (frame: string) => void
}

export type InteractResult =
  | { ok: true; text: string; ms: number }
  | { ok: false; error: "NOT_LIVE" | "NO_TARGET" | "OUT_OF_RANGE" | "RATE_LIMITED" | "BUSY" }

export type ChatResult =
  | { ok: true }
  | { ok: false; error: "NOT_LIVE" | "RATE_LIMITED" }

/** Floor between chat messages per user — a typo fix is fine, a flood isn't. */
export const CHAT_COOLDOWN_MS = 1_000

/**
 * Longest bulletin the wall will carry.
 *
 * The room draws one across three lines of a fixed canvas, so a pasted wall of
 * text would be measured and then mostly thrown away.
 */
export const BULLETIN_MAX_LEN = 500

/** Who a connecting id is, as the host knows them. */
export interface HubVisitor {
  id: string
  name: string
  role: Role
  spriteId: number | null
  spriteSheet: string | null
}

export interface GameRoomHubOptions {
  /** Look up a connecting user. null = unknown id, who spectates. */
  loadVisitor?: (userId: string) => Promise<HubVisitor | null>
  now?: () => number
  /** Off in tests: they drive tick() by hand. */
  autoTick?: boolean
}

export class GameRoomHub {
  private readonly loadVisitor: (userId: string) => Promise<HubVisitor | null>
  private readonly now: () => number
  private readonly autoTick: boolean
  private readonly colliders: readonly Rect[] = buildStaticColliders()

  private chars: HubChar[] = []
  private byUserId = new Map<string, HubChar>()
  private subs = new Set<Subscriber>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSayAt = new Map<string, number>()
  private lastChatAt = new Map<string, number>()
  /** Characters mid-conversation (char idx → the conversation's terms). */
  private dialogs = new Map<number, {
    until: number
    /** Earliest honest dismissal: when the typewriter finishes the text. */
    canDismissAt: number
  }>()
  /** Personal script progress by user, retained across reconnects. */
  private objectSayCount = new Map<string, Map<string, number>>()
  /** What the gamemaster has put on the PA screens' music; null = the playlist. */
  private music: RoomMusic = null
  /** Bulletins sent this session, which is all a nonce has to be. */
  private bulletinCount = 0

  private inDialog(idx: number, nowMs: number): boolean {
    const dialog = this.dialogs.get(idx)
    if (dialog === undefined) return false
    if (nowMs >= dialog.until) {
      this.dialogs.delete(idx)
      return false
    }
    return true
  }

  private startDialog(aIdx: number, text: string, nowMs: number, ms: number): void {
    const until = nowMs + ms
    const canDismissAt = nowMs + dialogTypewriterMs(text)
    this.dialogs.set(aIdx, { until, canDismissAt })
  }

  constructor(opts: GameRoomHubOptions = {}) {
    this.loadVisitor = opts.loadVisitor ?? (async () => null)
    this.now = opts.now ?? (() => Date.now())
    this.autoTick = opts.autoTick ?? true
  }

  // ---------------------------------------------------------------- visitors

  /**
   * Re-read who a returning visitor is before they are announced.
   *
   * A HubChar is created once and then lives for the whole process — a
   * visitor who leaves is only marked `departed` — so the sprite captured at
   * first sight would otherwise be the sprite this user has forever. Their
   * sprite goes out on the wire from HERE, so nothing downstream can correct
   * it.
   *
   * Best-effort by design: this sits on the connection path, and a failed
   * lookup must leave the character as it was rather than cost the user their
   * place in the room.
   */
  private async refreshCharacter(char: HubChar): Promise<void> {
    const user = await this.loadVisitor(char.id).catch(() => null)
    if (!user) return
    char.name = user.name
    char.role = user.role
    char.spriteId = user.spriteId
    char.spriteSheet = user.spriteSheet
  }

  private addChar(user: HubVisitor): HubChar {
    const idx = this.chars.length
    const spawn = visitorSpawnPoint(idx, this.colliders)
    const char: HubChar = {
      idx,
      id: user.id,
      name: user.name,
      x: spawn.x,
      y: spawn.y,
      dir: 2,
      moving: false,
      live: 0,
      lastInputAt: 0,
      role: user.role,
      departed: true, // subscribe flips it as the connection lands
      spriteId: user.spriteId,
      spriteSheet: user.spriteSheet,
    }
    this.chars.push(char)
    this.byUserId.set(user.id, char)
    return char
  }

  /** The wire shape of one visitor, as hello and join carry it. */
  private visitorEntryFor(c: HubChar): VisitorDTO {
    return { idx: c.idx, id: c.id, name: c.name, role: c.role, spriteId: c.spriteId, spriteSheet: c.spriteSheet }
  }

  // ---------------------------------------------------------------- snapshots

  /** Let silent movers come to rest, then broadcast where everyone is. */
  tick(nowMs = this.now()): void {
    for (const c of this.chars) {
      if (c.departed || c.live === 0) continue
      if (this.inDialog(c.idx, nowMs)) continue // mid-conversation: stand still
      // Client-reported; just decay `moving` when the reports stop.
      if (c.moving && nowMs - c.lastInputAt > INPUT_STALE_MS) c.moving = false
    }
    if (this.subs.size === 0) return
    this.broadcast(sseFrame("snapshot", { states: this.snapshotStates() }))
  }

  private snapshotStates(): SnapshotEntry[] {
    return this.chars
      .filter((c) => !c.departed)
      .map((c) =>
        packState({ idx: c.idx, x: c.x, y: c.y, dir: c.dir, moving: c.moving, live: c.live > 0 }),
      )
  }

  private broadcast(frame: string): void {
    for (const sub of this.subs) {
      try {
        sub.send(frame)
      } catch {
        /* a dead sink is dropped by its own route cleanup */
      }
    }
  }

  private sendToUser(userId: string, frame: string): void {
    for (const sub of this.subs) {
      if (sub.userId !== userId) continue
      try { sub.send(frame) } catch { /* the route cleans up disconnected sinks */ }
    }
  }

  // ------------------------------------------------------------ subscription

  /** Attach a client. Returns the detach function. */
  async subscribe(userId: string, send: (frame: string) => void): Promise<() => void> {
    let char = this.byUserId.get(userId) ?? null
    if (!char) {
      // A visitor the host has introduced gets a character; an id the host
      // does not know spectates.
      const user = await this.loadVisitor(userId).catch(() => null)
      if (user) char = this.addChar(user)
    } else {
      await this.refreshCharacter(char)
    }

    const sub: Subscriber = { userId, send }
    if (char) {
      char.live++
      char.lastInputAt = this.now()
      if (char.live === 1) {
        // A fresh entrance, first time or returning: at the spawn point.
        const spawn = visitorSpawnPoint(char.idx, this.colliders)
        char.x = spawn.x
        char.y = spawn.y
        char.dir = 2
        char.moving = false
        char.departed = false
        // To the existing audience only — the new client's first frame must be
        // hello, and hello already carries this character. join carries the
        // full entry (name, sprite) the audience needs to draw someone new.
        this.broadcast(sseFrame("join", this.visitorEntryFor(char)))
      }
    }
    this.subs.add(sub)

    const hello: HelloEvent = {
      you: char?.idx ?? null,
      visitors: this.chars.filter((c) => !c.departed).map((c) => this.visitorEntryFor(c)),
      states: this.snapshotStates(),
      music: this.music,
      backroomsUnlocked: (this.objectSayCount.get(userId)?.get("plant-se") ?? 0) >= BACKROOMS_UNLOCK_COUNT,
    }
    sub.send(sseFrame("hello", hello))
    logger.info(
      "game_room.connected",
      `[game-room hub] connect ${userId} → ${char ? `char #${char.idx} (${char.name})` : "spectator"}; ` +
        `${this.subs.size} connection(s), ${this.chars.filter((c) => c.live > 0).length} live`,
    )

    if (this.autoTick && !this.timer) {
      this.timer = setInterval(() => this.tick(), SNAPSHOT_INTERVAL_MS)
    }

    let detached = false
    return () => {
      if (detached) return
      detached = true
      this.subs.delete(sub)
      if (char) {
        char.live = Math.max(0, char.live - 1)
        if (char.live === 0) {
          // The character simply leaves the room with its last tab.
          char.departed = true
          char.moving = false
          this.dialogs.delete(char.idx)
          this.broadcast(sseFrame("leave", { idx: char.idx }))
        }
      }
      logger.info(
        "game_room.disconnected",
        `[game-room hub] disconnect ${userId}; ${this.subs.size} connection(s) remain`,
      )
      if (this.subs.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  // ------------------------------------------------------------------- input

  /** A live client reporting its own position. Returns false when the caller
   * has no character or no open control connection. */
  handleInput(userId: string, msg: PlayerInputMessage): boolean {
    const char = this.byUserId.get(userId)
    if (!char || char.live === 0) return false
    const nowMs = this.now()
    if (this.inDialog(char.idx, nowMs)) {
      // Frozen mid-conversation: the report is accepted but changes nothing,
      // so a client that kept walking can't drift the character.
      char.lastInputAt = nowMs
      return true
    }

    const x = Math.min(ROOM_BOUNDS.maxX, Math.max(ROOM_BOUNDS.minX, msg.x))
    const y = Math.min(ROOM_BOUNDS.maxY, Math.max(ROOM_BOUNDS.minY, msg.y))
    const dtMs = Math.max(SIM_STEP_MS, nowMs - char.lastInputAt)
    const maxDist =
      PLAYER_SPEED_PX_PER_STEP * (dtMs / SIM_STEP_MS) * SPEED_SLACK + SPEED_SLACK_PX
    const dist = Math.hypot(x - char.x, y - char.y)

    // A bad position (teleport, inside furniture) keeps the last good one;
    // facing and gait still update so the character doesn't freeze mid-stride.
    if (dist <= maxDist && !pointBlocked(x, y, this.colliders)) {
      char.x = x
      char.y = y
    }
    char.dir = msg.dir
    char.moving = msg.moving
    char.lastInputAt = nowMs
    return true
  }

  /** A private introduction for the interacting player. Only its reader freezes. */
  handleInteract(userId: string, targetIdx: number): InteractResult {
    const char = this.byUserId.get(userId)
    if (!char || char.live === 0) return { ok: false, error: "NOT_LIVE" }
    if (targetIdx >= OBJECT_IDX_BASE) return this.interactWithObject(char, targetIdx)
    const target = this.chars[targetIdx]
    if (!target || target === char || target.departed) return { ok: false, error: "NO_TARGET" }
    const nowMs = this.now()
    if (Math.hypot(target.x - char.x, target.y - char.y) > INTERACT_MAX_DIST_PX) {
      return { ok: false, error: "OUT_OF_RANGE" }
    }
    if (this.inDialog(char.idx, nowMs)) {
      return { ok: false, error: "BUSY" }
    }
    const last = this.lastSayAt.get(userId) ?? -Infinity
    if (nowMs - last < INTERACT_COOLDOWN_MS) return { ok: false, error: "RATE_LIMITED" }
    this.lastSayAt.set(userId, nowMs)

    const text = introductionFor(target)
    const ms = dialogDurationMs(text)
    this.startDialog(char.idx, text, nowMs, ms)
    // The reader faces their target without taking control of another player.
    char.dir = facingForInput(target.x - char.x, target.y - char.y, char.dir)
    char.moving = false
    this.sendToUser(userId,
      sseFrame("say", { idx: target.idx, by: char.idx, name: target.name, text, ms }),
    )
    return { ok: true, text, ms }
  }

  /** Talking to an object advances only this player's script and discovery. */
  private interactWithObject(char: HubChar, targetIdx: number): InteractResult {
    const obj = roomObjectByIdx(targetIdx)
    if (!obj) return { ok: false, error: "NO_TARGET" }
    if (Math.hypot(obj.x - char.x, obj.y - char.y) > INTERACT_MAX_DIST_PX) {
      return { ok: false, error: "OUT_OF_RANGE" }
    }
    const nowMs = this.now()
    if (this.inDialog(char.idx, nowMs)) return { ok: false, error: "BUSY" }
    const last = this.lastSayAt.get(char.id) ?? -Infinity
    if (nowMs - last < INTERACT_COOLDOWN_MS) return { ok: false, error: "RATE_LIMITED" }
    this.lastSayAt.set(char.id, nowMs)

    let progress = this.objectSayCount.get(char.id)
    if (!progress) { progress = new Map(); this.objectSayCount.set(char.id, progress) }
    const count = (progress.get(obj.id) ?? 0) + 1
    progress.set(obj.id, count)
    const text = objectSpeech(obj.id, count)
    const ms = dialogDurationMs(text)
    this.startDialog(char.idx, text, nowMs, ms)
    char.dir = facingForInput(obj.x - char.x, obj.y - char.y, char.dir)
    char.moving = false
    this.sendToUser(char.id, sseFrame("say", { idx: targetIdx, by: char.idx, name: obj.name, text, ms }))
    if (obj.id === "plant-se" && count === BACKROOMS_UNLOCK_COUNT) {
      this.sendToUser(char.id, sseFrame("backrooms", { unlocked: true }))
    }
    return { ok: true, text, ms }
  }

  /** A typed chat message from a connected player: broadcast to the whole
   * room. Purely social — nobody freezes, no dialog opens, and being
   * mid-conversation doesn't block it. Text arrives already validated
   * (parseChat); the hub only checks who may speak and how often. */
  handleChat(userId: string, text: string): ChatResult {
    const char = this.byUserId.get(userId)
    if (!char || char.live === 0) return { ok: false, error: "NOT_LIVE" }
    const nowMs = this.now()
    const last = this.lastChatAt.get(userId) ?? -Infinity
    if (nowMs - last < CHAT_COOLDOWN_MS) return { ok: false, error: "RATE_LIMITED" }
    this.lastChatAt.set(userId, nowMs)
    // Censored here rather than at the route: this is the choke point every
    // chat line passes, so a client that skips the UI is filtered too.
    this.broadcast(sseFrame("chat", { idx: char.idx, name: char.name, text: censor(text) }))
    return { ok: true }
  }

  /** The reader pressed interact on a finished private dialog. Refused while the
   * typewriter could not yet have finished — a client that unfreezes itself
   * before the hub does would walk its character into rejected territory. */
  handleDismiss(userId: string): boolean {
    const char = this.byUserId.get(userId)
    if (!char) return false
    const nowMs = this.now()
    const dialog = this.dialogs.get(char.idx)
    if (!dialog || nowMs >= dialog.until) return true // nothing left to dismiss
    if (nowMs < dialog.canDismissAt) return false
    this.dialogs.delete(char.idx)
    this.sendToUser(userId, sseFrame("dialogEnd", { a: char.idx, b: null }))
    return true
  }

  // ------------------------------------------------- the gamemaster's controls

  /**
   * Put one track on the PA screens, stop their music, or hand it back to the
   * room's playlist with null. Remembered as well as broadcast: a screen that
   * reconnects mid-hold must play what the others do.
   */
  setMusic(music: RoomMusic): void {
    this.music = music
    this.broadcast(sseFrame("music", music))
  }

  getMusic(): RoomMusic {
    return this.music
  }

  /**
   * Put a bulletin on every screen in the room.
   *
   * Returns the nonce it stamped, or null for a message with nothing in it.
   * Trimming and bounding happen HERE rather than at the route for the same
   * reason the chat censor does: this is the one place every bulletin passes
   * through.
   */
  sendBulletin(message: string, { holdMs }: { holdMs?: number } = {}): number | null {
    const text = message.trim().slice(0, BULLETIN_MAX_LEN)
    if (!text) return null
    const nonce = ++this.bulletinCount
    this.broadcast(
      sseFrame("bulletin", {
        message: text,
        nonce,
        ...(holdMs && holdMs > 0 ? { holdMs } : {}),
      }),
    )
    return nonce
  }

  // ------------------------------------------------------------------- tests

  /** Test seam: the hub's view of a character. */
  charForUser(userId: string): HubChar | null {
    return this.byUserId.get(userId) ?? null
  }
}

/** What a visitor says when another walks up to them: a greeting with their
 * first name and their role. */
export function introductionFor(target: { name: string; role?: string }): string {
  const first = target.name.split(" ")[0] ?? target.name
  const role = target.role || "visitor"
  const article = /^[aeiou]/i.test(role) ? "an" : "a"
  return `Hi, I'm ${first}! I'm ${article} ${role} here.`
}

// One hub per process. Stashed on globalThis so a dev server's module reloads
// reuse the running instance instead of stranding its subscribers.
//
// Who a connecting id is comes from the host: pass `loadVisitor` and the hub
// seats whoever it answers for.
const HUB_KEY = Symbol.for("gameroom.hub")

export function createGameRoomHub(opts: GameRoomHubOptions = {}): GameRoomHub {
  return new GameRoomHub(opts)
}

export function getGameRoomHub(opts: GameRoomHubOptions = {}): GameRoomHub {
  const g = globalThis as unknown as Record<symbol, GameRoomHub | undefined>
  if (!g[HUB_KEY]) g[HUB_KEY] = createGameRoomHub(opts)
  return g[HUB_KEY]
}
