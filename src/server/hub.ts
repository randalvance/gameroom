// The multiplayer game-room hub: one in-memory, in-process authority for what
// every character in the room is doing. Connected players' clients report
// their own positions (validated here); everyone else runs the same wander
// simulation the scene used to run per-browser — moved server-side so every
// client finally sees the SAME room (design:
// docs/superpowers/specs/2026-08-16-gameroom-multiplayer-design.md).
//
// Transport is SSE down + POST up (the stack's documented push pattern — see
// routes/api/sprite-jobs.stream.ts). The hub itself is transport-agnostic:
// subscribers are just `send(frame)` sinks, which is also what the tests use.
//
// State is deliberately ephemeral. A restart resets everyone to wandering and
// reconnecting EventSources rebuild the session. Known limit: >1 server
// replica would split the room; the app deploys as a single process.
//
// Before the doors open (lib/student-access) the room is somewhere to wait
// with your OWN team, and every frame is cut per connection to what that
// viewer may see — their desk and the staff (lib/gameRoomNet/visibility).
// The cut is made here, at the one point every frame passes, so a client
// reading the stream by hand learns no more than the room shows.

import type { WalkDir } from "~/components/gameRoom/spriteIndex"
import { logger } from "~/lib/logger"
import type { ScreenPage } from "~/components/gameRoom3d/screen-pages"
import type { PresentationState } from "~/lib/presentation-order"
import { nextPodiumPlace, placedTeamIds, type PodiumPlace, type WinnersState } from "~/lib/winners-ceremony"
import { SIM_STEP_MS } from "~/components/gameRoom3d/sim-clock"
import { buildAllPlayers, type PlayerRole, type TeamDTO } from "~/lib/event-types"
import {
  buildStaticColliders,
  facingForInput,
  nearestFreePoint,
  pointBlocked,
  PLAYER_SPEED_PX_PER_STEP,
  ROOM_BOUNDS,
  INTERACT_PROBE_PX,
  INTERACT_RANGE_PX,
  type Rect,
} from "~/lib/gameRoomNet/collision"
import { PARTICIPANT_TABLES } from "~/components/gameRoom/constants"
import {
  dialogTypewriterMs,
  packState,
  packWander,
  sseFrame,
  SNAPSHOT_INTERVAL_MS,
  WANDER_SYNC_INTERVAL_MS,
  type HelloEvent,
  type PlayerInputMessage,
  type SnapshotEntry,
  type WanderEntry,
} from "~/lib/gameRoomNet/protocol"
import {
  OBJECT_IDX_BASE,
  BACKROOMS_UNLOCK_COUNT,
  objectSpeech,
  roomObjectByIdx,
} from "~/lib/gameRoomNet/objects"
import { censor } from "~/lib/gameRoomNet/profanity"
import type { RoomMusic } from "~/lib/game-room-music"
import { inRoomScope, roomScopeFor, type RoomScope } from "~/lib/gameRoomNet/visibility"
import { DEFAULT_STUDENT_ACCESS_OPENS_AT_MS } from "~/lib/student-access"
import {
  phaseForPos,
  seedWander,
  stepWander,
  wanderPos,
  type WanderState,
} from "~/lib/gameRoomNet/wander"

/**
 * North edge of the band visitors arrive in: clear of the last row of desks
 * and of the margin their colliders add. Derived from the room plan so it
 * follows the desks instead of having to be re-tuned behind them.
 */
const GUEST_SPAWN_Y =
  Math.max(...PARTICIPANT_TABLES.map((tbl) => tbl.y + tbl.h)) + 48

/** A tab that stops reporting for this long reads as standing still. */
const INPUT_STALE_MS = 3_000
/** Validation slack: legitimate clients burst above the exact per-step speed
 * (frame batching, network jitter), so allow this factor plus a flat margin. */
const SPEED_SLACK = 1.75
const SPEED_SLACK_PX = 6
/** Interact reach: probe + range + a little latency slack. */
const INTERACT_MAX_DIST_PX = INTERACT_PROBE_PX + INTERACT_RANGE_PX + 14
const INTERACT_COOLDOWN_MS = 400
/** Simulation catch-up cap per tick — a stalled interval resumes, not fast-forwards. */
const MAX_STEPS_PER_TICK = 120
/** How often a connecting user may trigger a roster reload. */
const ROSTER_RELOAD_MIN_MS = 30_000
/**
 * How often a connecting user with no desk — a visitor, or someone the hub
 * has never seen — may trigger one. Sooner than the rest: a student seated
 * moments ago who arrived inside the ordinary window was made a guest, and
 * stayed one (the reload skipped ids it knew) until the process restarted.
 */
const UNSEATED_ROSTER_RELOAD_MIN_MS = 5_000
/**
 * How often the hub re-reads the doors' opening time while anyone is in the
 * room — the cadence the holding screen polls at, so the room opens up for
 * a student at the same moment the rest of the site would let them in.
 */
export const DOORS_REFRESH_MS = 5_000

export interface HubChar {
  idx: number
  id: string
  name: string
  team: string
  teamIdx: number
  x: number
  y: number
  dir: WalkDir
  moving: boolean
  /** Open connections controlling this character; 0 = wandering. */
  live: number
  wander: WanderState
  lastInputAt: number
  /** A visitor with no seat on the map (admin/mentor/judge/teamless user):
   * present only while connected. */
  guest: boolean
  /** The guest's users.role, for their introduction. */
  role: PlayerRole
  /** A guest whose last connection closed: hidden from the room, but the slot
   * (and its idx) is kept so a reconnect revives the same character. */
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
 * text would be measured and then mostly thrown away. Matches the bound the
 * room already puts on the exchange's own announcements.
 */
export const BULLETIN_MAX_LEN = 500

/** How long a conversation freezes its two participants, from its text. */
function dialogDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(6_000, Math.max(2_500, 1_200 + words * 350))
}

export interface GuestUser {
  id: string
  name: string
  role: PlayerRole
  spriteId: number | null
  spriteSheet: string | null
}

export interface GameRoomHubOptions {
  loadRoster: () => Promise<TeamDTO[]>
  /** Look up a signed-in user who is not on the roster (null = unknown id). */
  loadGuest?: (userId: string) => Promise<GuestUser | null>
  now?: () => number
  /** Off in tests: they drive tick() by hand. */
  autoTick?: boolean
  /**
   * When the doors open (lib/student-access). Before it the room is scoped:
   * a student sees and hears their own team and the staff only. Absent means
   * the doors are always open — the whole-room behaviour every test written
   * before the doors existed expects.
   */
  loadOpensAtMs?: () => Promise<number>
}

/**
 * Where visitors appear: the open aisle at the south of the room, scattered
 * so simultaneous guests don't stack on one point. Plan px.
 *
 * That aisle is what the literal 440 used to mean, back when the room ended
 * at y=500. Deepening the room turned the same number into the middle of the
 * floor and then a row of desks grew over it, so visitors arrived inside a
 * table's collider, unable to walk out in any direction. The band now follows
 * the last row of desks, and is snapped to open floor regardless, so a future
 * layout change cannot wedge anyone again.
 */
export function guestSpawnPoint(
  idx: number,
  colliders: readonly Rect[] = buildStaticColliders(),
): { x: number; y: number } {
  return nearestFreePoint(
    340 + ((idx * 53) % 140),
    GUEST_SPAWN_Y + ((idx * 29) % 36),
    colliders,
  )
}

export class GameRoomHub {
  private readonly loadRoster: () => Promise<TeamDTO[]>
  private readonly loadGuest: (userId: string) => Promise<GuestUser | null>
  private readonly now: () => number
  private readonly autoTick: boolean
  private readonly loadOpensAtMs: () => Promise<number>
  private readonly colliders: readonly Rect[] = buildStaticColliders()
  /**
   * The doors' opening time as last read. Starts at the scheduled morning
   * rather than "open", so a read that fails before the first succeeds keeps
   * the room scoped — teams that could not talk to each other is recoverable,
   * teams that could is not.
   */
  private opensAtMs = DEFAULT_STUDENT_ACCESS_OPENS_AT_MS
  private lastOpensAtLoadAt = -Infinity

  private chars: HubChar[] = []
  private byUserId = new Map<string, HubChar>()
  private subs = new Set<Subscriber>()
  private timer: ReturnType<typeof setInterval> | null = null
  private rosterLoaded: Promise<void> | null = null
  private lastRosterLoadAt = -Infinity
  private lastSimAt: number
  private simCarryMs = 0
  private lastSayAt = new Map<string, number>()
  private lastChatAt = new Map<string, number>()
  /**
   * Who the last snapshot carried. A character that drops out of it has gone
   * idle, and every client needs the wander state to run it from — so the
   * next tick sends that state for exactly those characters.
   */
  private streamed = new Set<number>()
  private lastWanderSyncAt = -Infinity
  /** Characters mid-conversation (char idx → the conversation's terms). */
  private dialogs = new Map<number, {
    until: number
    /** Earliest honest dismissal: when the typewriter finishes the text. */
    canDismissAt: number
  }>()
  /** Personal script progress by authenticated user, retained across reconnects. */
  private objectSayCount = new Map<string, Map<string, number>>()
  /** The page the gamemaster has pinned the wall screen to; null = players'. */
  private screenPage: ScreenPage | null = null
  /** What the gamemaster has put on the PA screens' music; null = the playlist. */
  private music: RoomMusic = null
  /** Bulletins sent this session, which is all a nonce has to be. */
  private bulletinCount = 0
  /** The presentation running order the gamemaster drew; null until then. */
  private presentation: PresentationState | null = null
  /** Draws this session, so a redraw of the same order still replays. */
  private presentationCount = 0
  /** The winners' ceremony the gamemaster is running; null until then. */
  private winners: WinnersState | null = null
  /** Ceremonies this session — a rerun still fires its fireworks. */
  private winnersCount = 0

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

  constructor(opts: GameRoomHubOptions) {
    this.loadRoster = opts.loadRoster
    this.loadGuest = opts.loadGuest ?? (async () => null)
    this.now = opts.now ?? (() => Date.now())
    this.autoTick = opts.autoTick ?? true
    this.loadOpensAtMs = opts.loadOpensAtMs ?? (async () => -Infinity)
    this.lastSimAt = this.now()
  }

  // ------------------------------------------------------------------- doors

  /** Re-read the opening time. Best-effort: a failed read keeps the last one. */
  private async refreshOpensAt(): Promise<void> {
    this.lastOpensAtLoadAt = this.now()
    try {
      this.opensAtMs = await this.loadOpensAtMs()
    } catch {
      /* keep the last known time */
    }
  }

  private preEvent(nowMs: number): boolean {
    return nowMs < this.opensAtMs
  }

  /** What a character may see of the room right now (lib/gameRoomNet/visibility). */
  private scopeOf(char: HubChar | null, nowMs: number): RoomScope {
    return roomScopeFor(
      char ? { role: char.role, teamIdx: char.guest ? -1 : char.teamIdx, idx: char.idx } : null,
      this.preEvent(nowMs),
    )
  }

  /**
   * Send a frame to every connection that may see it. `visible` decides per
   * scope; the frame is built once per distinct scope, not per connection,
   * and a scope it returns null for gets nothing.
   */
  private broadcastScoped(build: (scope: RoomScope) => string | null): void {
    const nowMs = this.now()
    const built = new Map<RoomScope, string | null>()
    for (const sub of this.subs) {
      const scope = this.scopeOf(this.byUserId.get(sub.userId) ?? null, nowMs)
      if (!built.has(scope)) built.set(scope, build(scope))
      const frame = built.get(scope)
      if (frame === null || frame === undefined) continue
      try {
        sub.send(frame)
      } catch {
        /* a dead sink is dropped by its own route cleanup */
      }
    }
  }

  /** A frame about one character, to those who can see them. */
  private broadcastAbout(char: HubChar, frame: string): void {
    this.broadcastScoped((scope) => (inRoomScope(scope, char) ? frame : null))
  }

  // ------------------------------------------------------------------ roster

  private async ensureRoster(): Promise<void> {
    if (!this.rosterLoaded) this.rosterLoaded = this.reloadRoster()
    await this.rosterLoaded
  }

  private async reloadRoster(): Promise<void> {
    this.lastRosterLoadAt = this.now()
    const teams = await this.loadRoster()
    // idx is append-only: existing characters keep their idx (and their
    // position/live state); new roster members join at the end. A member
    // removed from the roster keeps wandering — harmless, gone on restart.
    for (const p of buildAllPlayers(teams)) {
      const known = this.byUserId.get(p.id)
      if (known) {
        this.reseat(known, p)
        continue
      }
      const idx = this.chars.length
      const wander = seedWander(idx, p.teamIdx, p.seatIdx)
      const pos = wanderPos(wander, p.teamIdx)
      const char: HubChar = {
        idx,
        id: p.id,
        name: p.name,
        team: p.teamName,
        teamIdx: p.teamIdx,
        x: pos?.x ?? 400,
        y: pos?.y ?? 470,
        dir: pos?.dir ?? 2,
        moving: false,
        live: 0,
        wander,
        lastInputAt: 0,
        guest: false,
        role: p.role ?? "student",
        departed: false,
        spriteId: p.spriteId,
        spriteSheet: p.spriteSheet,
      }
      this.chars.push(char)
      this.byUserId.set(p.id, char)
    }
  }

  /**
   * Bring a character the hub already knows up to date with the roster: the
   * desk it sits at decides who may see it before the doors, so a stale one
   * put a reseated student in their old team's room.
   *
   * A guest who has since been seated becomes a roster member — but only
   * while offline. A live guest was announced to the room as a guest, and
   * clients drop a guest only on a guest leave; they meet the member on the
   * next connection. A live member keeps walking where they are and heads
   * for the new desk when they leave (the detach path orbits `teamIdx`).
   */
  private reseat(char: HubChar, p: { teamIdx: number; seatIdx: number; teamName: string }): void {
    if (char.guest) {
      if (char.live > 0) return
      char.guest = false
      char.departed = false
    } else if (char.teamIdx === p.teamIdx) {
      char.team = p.teamName
      return
    }
    char.team = p.teamName
    char.teamIdx = p.teamIdx
    if (char.live > 0) return
    char.wander = seedWander(char.idx, p.teamIdx, p.seatIdx)
    const pos = wanderPos(char.wander, p.teamIdx)
    if (pos) {
      char.x = pos.x
      char.y = pos.y
      char.dir = pos.dir
    }
    char.moving = false
    this.streamed.delete(char.idx)
  }

  /**
   * Re-read who a returning character is before they are announced.
   *
   * A HubChar is created once and then lives for the whole process — the
   * roster reload skips ids it already knows, and a guest is only marked
   * `departed` rather than dropped — so the sprite captured at first sight
   * would otherwise be the sprite this user has forever. That is what made a
   * new character look like it needed a restart to take effect, and it bites
   * visitors hardest: a guest's sprite goes out on the wire from HERE (a
   * roster member's is drawn from the page's own loader payload), so nothing
   * downstream can correct it.
   *
   * Best-effort by design: this sits on the connection path, and a failed
   * lookup must leave the character as it was rather than cost the user their
   * place in the room.
   */
  private async refreshCharacter(char: HubChar): Promise<void> {
    const user = await this.loadGuest(char.id).catch(() => null)
    if (!user) return
    char.name = user.name
    char.role = user.role
    char.spriteId = user.spriteId
    char.spriteSheet = user.spriteSheet
  }

  private addGuestChar(user: GuestUser): HubChar {
    const idx = this.chars.length
    const spawn = guestSpawnPoint(idx, this.colliders)
    const char: HubChar = {
      idx,
      id: user.id,
      name: user.name,
      team: "",
      teamIdx: -1,
      x: spawn.x,
      y: spawn.y,
      dir: 2,
      moving: false,
      live: 0,
      wander: seedWander(idx, 0, 0), // never used: guests are gone when idle
      lastInputAt: 0,
      guest: true,
      role: user.role,
      departed: true, // subscribe flips it as the connection lands
      spriteId: user.spriteId,
      spriteSheet: user.spriteSheet,
    }
    this.chars.push(char)
    this.byUserId.set(user.id, char)
    return char
  }

  /** The wire shape of one character, as hello and join carry it. */
  private rosterEntryFor(c: HubChar) {
    return c.guest
      ? {
          idx: c.idx,
          id: c.id,
          name: c.name,
          team: c.team,
          guest: true,
          role: c.role,
          spriteId: c.spriteId,
          spriteSheet: c.spriteSheet,
        }
      : { idx: c.idx, id: c.id, name: c.name, team: c.team, role: c.role }
  }

  // -------------------------------------------------------------- simulation

  /** Advance the wander sim to `nowMs` and broadcast a snapshot. */
  tick(nowMs = this.now()): void {
    const pending = this.simCarryMs + Math.max(0, nowMs - this.lastSimAt)
    this.lastSimAt = nowMs
    let steps = Math.floor(pending / SIM_STEP_MS)
    if (steps > MAX_STEPS_PER_TICK) {
      steps = MAX_STEPS_PER_TICK
      this.simCarryMs = 0
    } else {
      this.simCarryMs = pending - steps * SIM_STEP_MS
    }

    for (const c of this.chars) {
      if (c.departed) continue
      if (this.inDialog(c.idx, nowMs)) continue // mid-conversation: stand still
      if (c.live > 0) {
        // Client-reported; just decay `moving` when the reports stop.
        if (c.moving && nowMs - c.lastInputAt > INPUT_STALE_MS) c.moving = false
        continue
      }
      if (c.guest) continue // an idle guest is a departed guest; nothing to wander
      for (let i = 0; i < steps; i++) stepWander(c.wander)
      const pos = wanderPos(c.wander, c.teamIdx)
      if (pos) {
        c.x = pos.x
        c.y = pos.y
        c.dir = pos.dir
        c.moving = c.wander.pauseLeft === 0
      }
    }

    if (this.subs.size === 0) return

    // The doors can move while people are in the room (the console opening
    // them early); re-read on the same cadence the holding screen polls at.
    if (nowMs - this.lastOpensAtLoadAt >= DOORS_REFRESH_MS) void this.refreshOpensAt()

    // Idle characters are not streamed — see WANDER_SYNC_INTERVAL_MS. Their
    // state goes out when they go idle (before the snapshot that no longer
    // carries them, so no client is ever left holding a stale position), and
    // for all of them together on the sync cadence.
    //
    // Each frame is cut to what a connection may see (the whole room, once
    // the doors are open) — positions carry no names, but a scoped client
    // has no character to put them on and a hand-rolled reader learns nothing.
    const streamedNow = new Set(this.snapshotStates(nowMs, null).map((s) => s[0]))
    const wentIdle = [...this.streamed].filter((idx) => !streamedNow.has(idx))
    this.streamed = streamedNow
    if (nowMs - this.lastWanderSyncAt >= WANDER_SYNC_INTERVAL_MS) {
      this.lastWanderSyncAt = nowMs
      this.broadcastScoped((scope) => sseFrame("wander", { wanders: this.wanderEntries(nowMs, scope) }))
    } else if (wentIdle.length > 0) {
      this.broadcastScoped((scope) => {
        const wanders = this.wanderEntries(nowMs, scope).filter((w) => wentIdle.includes(w[0]))
        return wanders.length > 0 ? sseFrame("wander", { wanders }) : null
      })
    }
    this.broadcastScoped((scope) => sseFrame("snapshot", { states: this.snapshotStates(nowMs, scope) }))
  }

  /**
   * Whether a character's position is the hub's to stream: a player is
   * controlling it, or it is frozen in a conversation the hub set the facing
   * for. Everyone else is simulated by the clients, from the wander state.
   */
  private isStreamed(c: HubChar, nowMs: number): boolean {
    return !c.departed && (c.live > 0 || this.inDialog(c.idx, nowMs))
  }

  private snapshotStates(nowMs: number, scope: RoomScope): SnapshotEntry[] {
    return this.chars
      .filter((c) => this.isStreamed(c, nowMs) && inRoomScope(scope, c))
      .map((c) =>
        packState({ idx: c.idx, x: c.x, y: c.y, dir: c.dir, moving: c.moving, live: c.live > 0 }),
      )
  }

  /** Every idle character a scope may see, as the state a client runs its
   * wander from. */
  private wanderEntries(nowMs: number, scope: RoomScope): WanderEntry[] {
    return this.chars
      .filter((c) => !c.departed && !c.guest && !this.isStreamed(c, nowMs) && inRoomScope(scope, c))
      .map((c) => packWander(c.idx, c.wander))
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
    await this.ensureRoster()
    // Before hello, so the first frame is cut to what THIS moment allows.
    await this.refreshOpensAt()
    // Pick up a student seated after the hub last looked, or moved to another
    // desk, before hello decides what they may see.
    const known = this.byUserId.get(userId)
    const reloadAfterMs = !known || known.guest ? UNSEATED_ROSTER_RELOAD_MIN_MS : ROSTER_RELOAD_MIN_MS
    if (this.now() - this.lastRosterLoadAt >= reloadAfterMs) {
      await this.reloadRoster()
    }

    let char = this.byUserId.get(userId) ?? null
    if (!char) {
      // Not on the map — a visitor. Give them a transient guest character
      // (they still spectate if the id has no users row at all).
      const user = await this.loadGuest(userId).catch(() => null)
      if (user) char = this.addGuestChar(user)
    } else {
      await this.refreshCharacter(char)
    }

    const sub: Subscriber = { userId, send }
    if (char) {
      char.live++
      char.lastInputAt = this.now()
      if (char.live === 1) {
        char.moving = false
        if (char.guest && char.departed) {
          // Revived guest: fresh entrance at the spawn point.
          const spawn = guestSpawnPoint(char.idx, this.colliders)
          char.x = spawn.x
          char.y = spawn.y
          char.dir = 2
          char.departed = false
        }
        // To the existing audience only — the new client's first frame must be
        // hello, and hello already carries this character as live. Guests are
        // characters the audience has never seen, so join carries the full
        // entry (name, sprite) they need to draw one. Before the doors open
        // the audience is the newcomer's own team and the staff.
        this.broadcastAbout(char, sseFrame("join", this.rosterEntryFor(char)))
      }
    }
    this.subs.add(sub)

    const helloAt = this.now()
    const scope = this.scopeOf(char, helloAt)
    const hello: HelloEvent = {
      you: char?.idx ?? null,
      roster: this.chars
        .filter((c) => !c.departed && inRoomScope(scope, c))
        .map((c) => this.rosterEntryFor(c)),
      states: this.snapshotStates(helloAt, scope),
      wanders: this.wanderEntries(helloAt, scope),
      screen: this.screenPage,
      music: this.music,
      backroomsUnlocked: (this.objectSayCount.get(userId)?.get("plant-se") ?? 0) >= BACKROOMS_UNLOCK_COUNT,
      presentation: this.presentation,
      winners: this.winners,
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
          if (char.guest) {
            // A visitor's character simply leaves the room with them.
            char.departed = true
            char.moving = false
            this.broadcastAbout(char, sseFrame("leave", { idx: char.idx, guest: true }))
          } else {
            // Back to the table: teleport to the nearest point of the home
            // orbit and resume the ordinary wander from there. The position is
            // set NOW rather than left for the next tick, and the wander state
            // goes out with it, so every client starts walking the character
            // home from this moment rather than a tick later.
            char.wander.phase = phaseForPos(char.x, char.y, char.teamIdx)
            char.wander.pauseLeft = 0
            const home = wanderPos(char.wander, char.teamIdx)
            if (home) {
              char.x = home.x
              char.y = home.y
              char.dir = home.dir
              char.moving = true
            }
            this.streamed.delete(char.idx)
            this.broadcastAbout(char, sseFrame("wander", { wanders: [packWander(char.idx, char.wander)] }))
            this.broadcastAbout(char, sseFrame("leave", { idx: char.idx }))
          }
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
    // Someone the caller cannot see is someone who is not there — before the
    // doors open, another team's student, however close a hand-rolled POST
    // says they are standing.
    if (!inRoomScope(this.scopeOf(char, nowMs), target)) return { ok: false, error: "NO_TARGET" }
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
   * room — or, before the doors open, to everyone who can see the speaker:
   * their own team and the staff. Purely social — nobody freezes, no dialog
   * opens, and being mid-conversation doesn't block it. Text arrives already
   * validated (parseChat); the hub only checks who may speak and how often. */
  handleChat(userId: string, text: string): ChatResult {
    const char = this.byUserId.get(userId)
    if (!char || char.live === 0) return { ok: false, error: "NOT_LIVE" }
    const nowMs = this.now()
    const last = this.lastChatAt.get(userId) ?? -Infinity
    if (nowMs - last < CHAT_COOLDOWN_MS) return { ok: false, error: "RATE_LIMITED" }
    this.lastChatAt.set(userId, nowMs)
    // Censored and scoped here rather than at the route: this is the choke
    // point every chat line passes, so a client that skips the UI is filtered
    // too, and a client reading the stream by hand hears no other team.
    this.broadcastAbout(char, sseFrame("chat", { idx: char.idx, name: char.name, text: censor(text) }))
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
   * Pin the wall screen to one page for the whole room, or hand it back to the
   * players with null.
   *
   * The page is remembered as well as broadcast, because it is state rather
   * than a moment: `hello` carries it, so a tab opening or an EventSource
   * reconnecting mid-force lands on the right page instead of becoming the one
   * screen in the room showing something else.
   */
  setScreenPage(page: ScreenPage | null): void {
    this.screenPage = page
    this.broadcast(sseFrame("screen", { page }))
  }

  /**
   * Put one track on the PA screens, stop their music, or hand it back to the
   * room's playlist with null. Remembered as well as broadcast, like the wall
   * page: a screen that reconnects mid-hold must play what the others do.
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
   * Deliberately NOT the exchange's announcement feed — that feed is the
   * teams' bots' S1 signal, so replaying a filmed market event for a rehearsal
   * (or typing "lunch at 12:30") must reach the room and nothing else, with no
   * price impact behind it.
   *
   * `speechMs` is how long the spoken read of this message takes, when there
   * is one. It travels to the WHOLE room even though only the admin's screen
   * plays the audio, because everyone's banner and camera hold for the length
   * of the read — a wall that cleared while the voice was still talking would
   * be worse than no voice at all.
   *
   * Returns the nonce it stamped — the key the admin's room later asks for the
   * audio under — or null for a message with nothing in it. Trimming and
   * bounding happen HERE rather than at the route for the same reason the chat
   * censor does: this is the one place every bulletin passes through.
   */
  sendBulletin(
    message: string,
    affectedSymbol: string,
    { speechMs, holdMs }: { speechMs?: number; holdMs?: number } = {},
  ): number | null {
    const text = message.trim().slice(0, BULLETIN_MAX_LEN)
    if (!text) return null
    const nonce = ++this.bulletinCount
    this.broadcast(
      sseFrame("bulletin", {
        message: text,
        affectedSymbol: affectedSymbol.trim().toUpperCase(),
        nonce,
        ...(speechMs && speechMs > 0 ? { speechMs } : {}),
        ...(holdMs && holdMs > 0 ? { holdMs } : {}),
      }),
    )
    return nonce
  }

  /**
   * Put a presentation running order on the room, or take it down with null.
   *
   * Stamped with the reveal's start and a nonce HERE, because this is the one
   * clock every client will replay the sweep against: a tab that opens after
   * the draw computes where the reveal has got to from `revealedAt`, and a
   * redraw that lands the same order is still a new reveal by its nonce.
   * Any spotlight is cleared — the order it pointed into is gone.
   */
  setPresentationOrder(order: readonly string[] | null): PresentationState | null {
    this.presentation = order
      ? {
          order: [...order],
          revealedAt: this.now(),
          nonce: ++this.presentationCount,
          spotlight: null,
          done: [],
        }
      : null
    this.broadcast(sseFrame("presentation", this.presentation))
    return this.presentation
  }

  /**
   * Put one presenting team under the spotlight, or null for lights up.
   * Refused (false) with no order drawn, or for a team that is not in it — a
   * light on a desk with no number over it is a mis-click, not a request.
   */
  setPresentationSpotlight(teamId: string | null): boolean {
    if (!this.presentation) return false
    if (teamId !== null && !this.presentation.order.includes(teamId)) return false
    this.presentation = { ...this.presentation, spotlight: teamId }
    this.broadcast(sseFrame("presentation", this.presentation))
    return true
  }

  /**
   * Mark a team off as having presented, or put it back on the list.
   *
   * Idempotent: pressing DONE twice is not two teams finished, and a room
   * where the console was double-clicked must look the same as one where it
   * was not. Refused (false) with no order drawn, or for a team that is not
   * in it.
   *
   * Marking the team that is ON STAGE also drops the spotlight: they have
   * finished, so the light is not still on them — one press ends the slot
   * rather than two.
   */
  setPresentationDone(teamId: string, done: boolean): boolean {
    if (!this.presentation) return false
    if (!this.presentation.order.includes(teamId)) return false
    const already = this.presentation.done ?? []
    const next = done
      ? already.includes(teamId) ? already : [...already, teamId]
      : already.filter((id) => id !== teamId)
    const spotlight =
      done && this.presentation.spotlight === teamId ? null : this.presentation.spotlight
    this.presentation = { ...this.presentation, done: next, spotlight }
    this.broadcast(sseFrame("presentation", this.presentation))
    return true
  }

  getPresentation(): PresentationState | null {
    return this.presentation
  }

  /**
   * Start the winners' ceremony: the room darkens, turns to the wall, and
   * waits for the podium to be read. Starting again mid-ceremony starts
   * over — the podium is cleared and the nonce moves, so a rehearsal and the
   * real thing are two ceremonies even if they name the same teams.
   */
  startWinners(): WinnersState {
    this.winners = { startedAt: this.now(), nonce: ++this.winnersCount, podium: [] }
    this.broadcast(sseFrame("winners", this.winners))
    return this.winners
  }

  /**
   * Read out one place. The order is the ceremony: third before second
   * before first, and `place` must be the one the ceremony is waiting for —
   * a console that skipped ahead, or double-clicked, is refused (false), as
   * is a team that is already on the podium, and any press with no ceremony
   * running. Stamped with the clock so every screen fires the same volley
   * from the same moment.
   */
  announceWinner(place: PodiumPlace, teamId: string): boolean {
    if (!this.winners) return false
    if (nextPodiumPlace(this.winners) !== place) return false
    if (placedTeamIds(this.winners).includes(teamId)) return false
    this.winners = {
      ...this.winners,
      podium: [...this.winners.podium, { place, teamId, announcedAt: this.now() }],
    }
    this.broadcast(sseFrame("winners", this.winners))
    return true
  }

  /** The ceremony is over: the lights and the clock come back. */
  clearWinners(): void {
    this.winners = null
    this.broadcast(sseFrame("winners", null))
  }

  getWinners(): WinnersState | null {
    return this.winners
  }

  // ------------------------------------------------------------------- tests

  /** Test seam: the hub's view of a character. */
  charForUser(userId: string): HubChar | null {
    return this.byUserId.get(userId) ?? null
  }
}

/**
 * What a character says when interacted with. Default is a greeting with name
 * and team (or role, for visitors); richer per-student intros and non-student
 * objects plug in here later.
 */
export function introductionFor(target: {
  name: string
  team: string
  guest?: boolean
  role?: string
}): string {
  const first = target.name.split(" ")[0] ?? target.name
  if (target.guest) {
    const role = target.role || "visitor"
    const article = /^[aeiou]/i.test(role) ? "an" : "a"
    return `Hi, I'm ${first}! I'm ${article} ${role} here.`
  }
  return `Hi, I'm ${first}! I'm on ${target.team}.`
}

// One hub per process. Stashed on globalThis so a dev server's module reloads
// reuse the running instance instead of stranding its subscribers.
//
// The roster is INJECTED rather than read from a database here: the room is
// the thing this library ships, and where the teams come from is the host's
// business. `setGameRoomRoster` is the standalone default — hand it the teams
// and the hub serves them — and a host with its own source passes
// `loadRoster` to `createGameRoomHub` instead.
const HUB_KEY = Symbol.for("gameroom.hub")

let roster: TeamDTO[] = []

/** The teams the hub seats. Takes effect on the hub's next roster refresh. */
export function setGameRoomRoster(teams: TeamDTO[]): void {
  roster = teams
}

export function createGameRoomHub(opts: Partial<GameRoomHubOptions> = {}): GameRoomHub {
  return new GameRoomHub({
    loadRoster: async () => roster,
    ...opts,
  })
}

export function getGameRoomHub(opts: Partial<GameRoomHubOptions> = {}): GameRoomHub {
  const g = globalThis as unknown as Record<symbol, GameRoomHub | undefined>
  if (!g[HUB_KEY]) g[HUB_KEY] = createGameRoomHub(opts)
  return g[HUB_KEY]
}
