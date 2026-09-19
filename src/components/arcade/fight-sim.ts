// The fight, as pure state.
//
// One fixed-step simulation the shell drives at 60 Hz: two fighters, a
// round clock, projectiles, and a phase machine (ROUND → FIGHT → K.O. → next
// round or match over). Everything in here is plain data and arithmetic so a
// test can play a whole round in a loop; the renderer reads the state and the
// audio reads `events`, which the sim fills afresh on every step.
//
// Coordinates: x runs across the stage in px, y is HEIGHT ABOVE THE FLOOR
// (positive up) — the renderer flips it. Each fighter's origin is at its feet,
// centred. `facing` is +1 when looking right.

import {
  characterById,
  ENERGY_PER_BAR,
  type Box,
  type CharacterDef,
  type CharacterId,
  type MoveDef,
} from "./characters"
import {
  BREAKING_NEWS_FLIGHT_MS, BREAKING_NEWS_SAFE_HALF_WIDTH, BREAKING_NEWS_WIDTH,
  breakingNewsGeometry, circleCenter, circleRadius, scanningBeamBox,
  divingThroughBodies, scriptedMotion, stepSpecialMotion,
} from "./special-motion"

export const STAGE_WIDTH = 960
export const ROUND_SECONDS = 99
export const ROUNDS_TO_WIN = 2
export const GRAVITY = 1900
/** Redline rain's exact collision and warning-column width. */
export const RAIN_WIDTH = 54
export const ORB_RADIUS = 90
export const ORB_HEIGHT = 110
export const ORB_OFFSET = 230
export const ORB_LIFETIME_MS = 3000
export const MAX_WATER_ORBS = 3
const ORB_RELEASE_GRACE_MS = 450
const ENERGY_WARNING_COOLDOWN_MS = 3000
/** How long ROUND N / FIGHT! sits on screen before control arrives. */
export const INTRO_MS = 2000
/** The freeze that follows a K.O. or the clock running out. */
export const KO_MS = 2200
const FRICTION = 6
const KNOCKDOWN_MS = 700
const GETUP_INVULN_MS = 400
/** A quarter-circle has to finish within this window to count. */
const MOTION_WINDOW_MS = 400

export interface FightInput {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  /** Attack buttons are EDGES — true only on the step they were pressed. */
  lp: boolean
  hp: boolean
  lk: boolean
  hk: boolean
  sp: boolean
  /** Explicit roster special selection for touch controls and CPU. */
  specialId?: string
}

export const EMPTY_INPUT: FightInput = {
  left: false, right: false, up: false, down: false,
  lp: false, hp: false, lk: false, hk: false, sp: false,
}

export type FighterState =
  | "idle" | "walk" | "crouch" | "jump" | "attack"
  | "hitstun" | "blockstun" | "knockdown" | "ko" | "trapped"

export interface Fighter {
  id: CharacterId
  def: CharacterDef
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  health: number
  energy: number
  /** Simulation-clock deadline for the next insufficient-energy voice cue. */
  energyWarningUntil: number
  /** Animation clock pauses while suspended in a water orb. */
  animationMs: number
  /** Brief protection from a second orb immediately after release. */
  orbImmuneUntil: number
  state: FighterState
  /** ms spent in the current state (hitstun etc. count down against it). */
  stateMs: number
  /** ms the current stun/knockdown lasts. */
  stunMs: number
  move: MoveDef | null
  moveMs: number
  /** The live move already connected (a hitbox lands once). */
  hitDone: boolean
  /** The projectile for this move has been spawned. */
  spawned: boolean
  special: { originX: number; targetX: number; targetLocked: boolean; landed: boolean; aimSlope?: number; hoverX?: number; impactAnnounced?: boolean } | null
  crouching: boolean
  /** Holding back this step — blocks an incoming attack. */
  guarding: boolean
  invulnMs: number
  /** One air attack per jump. */
  airAttackUsed: boolean
  /** Rising Up after recent Down; survives the short jump-cancel grace. */
  upHeld: boolean
  ultimateReadyUntil: number
  /** Recent relative directions with timestamps, for motion inputs. */
  motion: { dir: "down" | "downforward" | "forward"; at: number }[]
  /** Landed hits in a row without the opponent recovering. */
  combo: number
  /** Times hit while airborne since last touching the floor. */
  juggle: number
}

export interface Projectile {
  owner: 0 | 1
  x: number
  y: number
  vx: number
  vy?: number
  w: number
  h: number
  move: MoveDef
  ttl: number
}

export interface WaterOrb { owner: 0 | 1; x: number; y: number; radius: number; remainingMs: number; lifetimeMs?: number; captured: 0 | 1 | null }
export interface RainLane { owner: 0 | 1; x: number; ageMs: number; warningMs: number; activeMs: number; hit: boolean; move: MoveDef }

export type FightPhase = "intro" | "fight" | "ko" | "matchover"

export interface FightEvent {
  type: "intro" | "fight" | "attack" | "hit" | "block" | "whiff" | "special" | "outOfEnergy" | "specialRelease" | "specialImpact" | "ko" | "timeout" | "roundwin" | "matchover" | "jump" | "land"
  /** Who did the thing (attacker for hit/block, the fighter for the rest). */
  player: 0 | 1
  /** Cast identity survives an interruption later in the same simulation step. */
  moveId?: string
  /** hit / attack: a heavy move; matchover / roundwin: unused. */
  heavy?: boolean
  x?: number
  y?: number
}

export interface FightState {
  phase: FightPhase
  phaseMs: number
  round: number
  wins: [number, number]
  /** Round clock, ms remaining. */
  timerMs: number
  /** Total simulated ms — the motion buffer's clock. */
  clock: number
  fighters: [Fighter, Fighter]
  projectiles: Projectile[]
  orbs: WaterOrb[]
  rain: RainLane[]
  rngState: number
  events: FightEvent[]
  /** Who took the round that just ended (null: a draw). */
  roundWinner: 0 | 1 | null
  /** Set once the match is decided (null: a double K.O. draw). */
  matchWinner: 0 | 1 | null
  /** A hit landed this step — the shell freezes a few frames for impact. */
  hitstop: number
  /** The ROUND N card has been called for this round. */
  introAnnounced: boolean
  /** The final-boss slot, if this match is Bernard's challenge. */
  bossSlot: 0 | 1 | null
}

const START_X: [number, number] = [STAGE_WIDTH * 0.3, STAGE_WIDTH * 0.7]

function createFighter(id: CharacterId, slot: 0 | 1): Fighter {
  const def = characterById(id)
  return {
    id,
    def,
    x: START_X[slot],
    y: 0,
    vx: 0,
    vy: 0,
    facing: slot === 0 ? 1 : -1,
    health: def.maxHealth,
    energy: def.energyBars * ENERGY_PER_BAR,
    energyWarningUntil: 0,
    animationMs: 0,
    orbImmuneUntil: 0,
    state: "idle",
    stateMs: 0,
    stunMs: 0,
    move: null,
    moveMs: 0,
    hitDone: false,
    spawned: false,
    special: null,
    crouching: false,
    guarding: false,
    invulnMs: 0,
    airAttackUsed: false,
    upHeld: false,
    ultimateReadyUntil: -1,
    motion: [],
    combo: 0,
    juggle: 0,
  }
}

function resetRound(state: FightState) {
  state.fighters = [createFighter(state.fighters[0].id, 0), createFighter(state.fighters[1].id, 1)]
  state.projectiles = []
  state.orbs = []
  state.rain = []
  state.timerMs = ROUND_SECONDS * 1000
  state.phase = "intro"
  state.phaseMs = 0
  state.roundWinner = null
  state.hitstop = 0
  state.introAnnounced = false
}

export interface FightOptions {
  /** The final-boss slot, used for presentation; combat uses normal damage. */
  bossSlot?: 0 | 1
  seed?: number
}

export function createFight(p1: CharacterId, p2: CharacterId, options: FightOptions = {}): FightState {
  const state: FightState = {
    phase: "intro",
    phaseMs: 0,
    round: 1,
    wins: [0, 0],
    timerMs: ROUND_SECONDS * 1000,
    clock: 0,
    fighters: [createFighter(p1, 0), createFighter(p2, 1)],
    projectiles: [],
    orbs: [],
    rain: [],
    rngState: (options.seed ?? 0x6d2b79f5) >>> 0,
    events: [],
    roundWinner: null,
    matchWinner: null,
    hitstop: 0,
    introAnnounced: false,
    bossSlot: options.bossSlot ?? null,
  }
  return state
}

/** Seconds left on the clock, as the HUD shows it. */
export function timerSeconds(state: FightState): number {
  return Math.max(0, Math.ceil(state.timerMs / 1000))
}

function moveTotal(move: MoveDef): number {
  return move.startup + move.active + move.recovery
}

function fighterHeight(f: Fighter): number {
  return f.crouching ? f.def.crouchHeight : f.def.height
}

/** The fighter's body in world space. */
export function hurtbox(f: Fighter): Box {
  return { x: f.x - f.def.width / 2, y: f.y, w: f.def.width, h: fighterHeight(f) }
}

/** A move's hitbox in world space, mirrored for the facing. */
export function worldHitbox(f: Fighter, box: Box): Box {
  const left = f.facing === 1 ? f.x + box.x : f.x - box.x - box.w
  return { x: left, y: f.y + box.y, w: box.w, h: box.h }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function setState(f: Fighter, next: FighterState) {
  f.state = next
  f.stateMs = 0
}

function canAct(f: Fighter): boolean {
  return f.state === "idle" || f.state === "walk" || f.state === "crouch" || f.state === "jump"
}

export function canAffordSpecial(f: Fighter, move: MoveDef): boolean { return f.energy >= (move.energyCost ?? 0) }

export function canCastSpecial(state: FightState, slot: 0 | 1, move: MoveDef): boolean {
  return canAffordSpecial(state.fighters[slot], move)
    && (move.kind !== "orb" || state.orbs.filter(orb => orb.owner === slot && orb.remainingMs > 0).length < MAX_WATER_ORBS)
}

function random01(state: FightState): number {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0
  return state.rngState / 0x100000000
}

function addEnergy(f: Fighter, amount: number, health = f.health) {
  // A smooth comeback bonus begins at half health and reaches 1.8x at critical health.
  const lowHealth = Math.max(0, 0.5 - health / f.def.maxHealth) * 1.6
  f.energy = Math.min(f.def.energyBars * ENERGY_PER_BAR, f.energy + amount * (1 + lowHealth))
}

function beginMove(f: Fighter, move: MoveDef, state: FightState, slot: 0 | 1) {
  if (!canCastSpecial(state, slot, move)) return
  f.energy = Math.max(0, f.energy - (move.energyCost ?? 0))
  f.move = move
  f.moveMs = 0
  f.hitDone = false
  f.spawned = false
  const other = state.fighters[slot === 0 ? 1 : 0]
  const distance = Math.min(move.range ?? STAGE_WIDTH, Math.abs(other.x - f.x))
  f.special = move.kind !== "normal" ? {
    originX: f.x,
    targetX: Math.max(f.def.width / 2, Math.min(STAGE_WIDTH - f.def.width / 2, f.x + f.facing * distance)),
    targetLocked: false, landed: false,
    // Aim at standing head height, locked at startup: crouching and jumping
    // remain counterplay. A short fighter cannot passively duck the eye beam.
    aimSlope: move.projectile
      ? (Math.min(move.projectile.y, other.def.height - 8) - move.projectile.y) / Math.max(80, Math.abs(other.x - f.x) - 11)
      : undefined,
  } : null
  if (move.kind === "breakingNews" && f.special) {
    // Leap within walking distance of the opponent, then hold a fixed pose
    // and aim for the full charge. The 1.6s charge plus 600ms flight leaves
    // even Whale time to get beneath him and out of the marked blast.
    const hoverX = Math.max(f.def.width / 2, Math.min(STAGE_WIDTH - f.def.width / 2, other.x - f.facing * 280))
    f.special.hoverX = hoverX
    f.special.targetX = hoverX + f.facing * Math.max(BREAKING_NEWS_WIDTH / 2 + BREAKING_NEWS_SAFE_HALF_WIDTH, f.facing * (other.x - hoverX))
    f.special.targetLocked = true
  }
  if (f.special) f.crouching = false
  f.guarding = false
  if (f.state !== "jump") f.vx = 0
  setState(f, "attack")
  if (move.invulnStartup) f.invulnMs = move.startup
  if (move.kind !== "normal") state.events.push({ type: "special", player: slot, moveId: move.id, x: f.x, y: f.y })
  else state.events.push({ type: "attack", player: slot, heavy: move.damage >= 12 })
}

/** Which of the pressed buttons wins, if several land on one step. */
function pressedMove(f: Fighter, input: FightInput, wantsSpecial: boolean, clock: number): MoveDef | null {
  const m = f.def.moves
  if (input.sp && input.specialId && f.state !== "jump") {
    return Object.values(m).find(move => move?.kind !== "normal" && move?.id === input.specialId) ?? null
  }
  if (f.state === "jump") {
    if (f.id === "bernard" && input.sp && f.stateMs <= 150 && m.specialUp) {
      return f.ultimateReadyUntil >= clock && m.specialUltimate ? m.specialUltimate : m.specialUp
    }
    if (f.airAttackUsed) return null
    if (input.lp || input.hp || input.lk || input.hk || input.sp) return m.air
    return null
  }
  if (wantsSpecial) {
    if (input.sp) {
      if (input.up && m.specialUp) return f.ultimateReadyUntil >= clock && m.specialUltimate ? m.specialUltimate : m.specialUp
      const forward = f.facing === 1 ? input.right : input.left
      const back = f.facing === 1 ? input.left : input.right
      if (input.down && forward && m.specialDownForward) return m.specialDownForward
      if (input.down && m.specialDown) return m.specialDown
      if (forward && m.specialForward) return m.specialForward
      if (back && m.specialBack) return m.specialBack
    }
    return m.special
  }
  // Down pressed on the same step as the button counts as a crouching attack.
  if (f.crouching || input.down) {
    if (input.hk) return m.sweep
    if (input.lk) return m.crlk
  }
  if (input.hk) return m.hk
  if (input.hp) return m.hp
  if (input.lk) return m.lk
  if (input.lp) return m.lp
  return null
}

function recordMotion(f: Fighter, input: FightInput, clock: number) {
  const forward = f.facing === 1 ? input.right : input.left
  let dir: "down" | "downforward" | "forward" | null = null
  if (input.down && forward) dir = "downforward"
  else if (input.down) dir = "down"
  else if (forward) dir = "forward"
  if (dir) {
    const last = f.motion[f.motion.length - 1]
    if (!last || last.dir !== dir) f.motion.push({ dir, at: clock })
    else last.at = clock // Held directions remain fresh until released.
  }
  f.motion = f.motion.filter((entry) => clock - entry.at <= MOTION_WINDOW_MS)
}

/** ↓ ↘ → within the window, in order. ↘ is optional — a keyboard rolls it. */
function quarterCircleForward(f: Fighter): boolean {
  const dirs = f.motion.map((entry) => entry.dir)
  const downAt = dirs.indexOf("down")
  if (downAt < 0) return false
  const forwardAt = dirs.indexOf("forward", downAt + 1)
  return forwardAt > downAt
}

function stepFighterControl(state: FightState, slot: 0 | 1, input: FightInput, dt: number) {
  const f = state.fighters[slot]
  const other = state.fighters[slot === 0 ? 1 : 0]
  const dtMs = dt * 1000
  if (input.up && !f.upHeld) {
    f.ultimateReadyUntil = f.motion.some(entry => entry.dir === "down" && state.clock - entry.at <= MOTION_WINDOW_MS)
      ? state.clock + 150 : -1
  }
  f.upHeld = input.up
  f.stateMs += dtMs
  if (f.invulnMs > 0) f.invulnMs = Math.max(0, f.invulnMs - dtMs)
  if (f.state === "trapped") return
  f.animationMs += dtMs

  // Stunned, down, or out: ride the timer out.
  if (f.state === "hitstun" || f.state === "blockstun") {
    if (f.stateMs >= f.stunMs && f.y <= 0) {
      setState(f, "idle")
      // Recovered: the opponent's combo is over.
      other.combo = 0
    }
    return
  }
  if (f.state === "knockdown") {
    if (f.y <= 0 && f.stateMs >= f.stunMs) {
      setState(f, "idle")
      f.invulnMs = GETUP_INVULN_MS
      f.crouching = false
      other.combo = 0
    }
    return
  }
  if (f.state === "ko") return

  // Face the opponent whenever standing free.
  if (f.state !== "attack" && f.state !== "jump") f.facing = other.x >= f.x ? 1 : -1

  if (f.state === "attack" && f.move) {
    const move = f.move
    f.moveMs += dtMs
    const liveFrom = move.startup
    if (stepSpecialMotion(f, other, dtMs, STAGE_WIDTH)) state.events.push({ type: "land", player: slot, x: f.x, y: 0 })
    if (move.kind === "uppercut" && !f.spawned && f.moveMs >= liveFrom) {
      f.spawned = true
      f.vy = move.selfVy ?? 0
      f.vx = (move.selfVx ?? 0) * f.facing
      f.y = Math.max(f.y, 0.01)
    }
    if (move.kind === "projectile" && move.projectile && !f.spawned && f.moveMs >= liveFrom) {
      f.spawned = true
      const p = move.projectile
      const offset = f.def.width / 2 + p.w / 2
      const slope = f.special?.aimSlope ?? 0
      state.projectiles.push({
        owner: slot,
        x: f.x + f.facing * offset,
        y: p.y + (offset - 11) * slope,
        vx: p.speed * f.facing,
        vy: p.speed * slope,
        w: p.w,
        h: p.h,
        move,
        ttl: p.life,
      })
    }
    if (move.kind === "breakingNews" && f.special) {
      if (!f.spawned && f.moveMs >= liveFrom) {
        f.spawned = true
        state.events.push({ type: "specialRelease", player: slot, moveId: move.id, x: f.x, y: breakingNewsGeometry(f).ballY })
      }
      if (!f.special.impactAnnounced && f.moveMs >= liveFrom + BREAKING_NEWS_FLIGHT_MS) {
        f.special.impactAnnounced = true
        state.events.push({ type: "specialImpact", player: slot, moveId: move.id, x: f.special.targetX, y: 160 })
      }
    }
    if (move.kind === "orb" && !f.spawned && f.moveMs >= liveFrom) {
      f.spawned = true
      const radius = move.orb?.radius ?? ORB_RADIUS
      const life = move.orb?.life ?? ORB_LIFETIME_MS
      state.orbs.push({ owner: slot,
        x: Math.max(radius, Math.min(STAGE_WIDTH - radius, f.x + f.facing * (move.orb?.offset ?? ORB_OFFSET))),
        y: move.orb?.y ?? ORB_HEIGHT, radius, remainingMs: life, lifetimeMs: life, captured: null })
    }
    if (move.kind === "rain" && !f.spawned && f.moveMs >= liveFrom) {
      f.spawned = true
      const victimX = other.x
      // Three narrow, independently dodgeable columns. The lead lane covers
      // the current position; two seeded lanes vary within the middle stage.
      const offsets = [0, (random01(state) - 0.5) * 340, (random01(state) - 0.5) * 500]
      for (let i = 0; i < offsets.length; i++) state.rain.push({
        owner: slot,
        x: Math.max(30, Math.min(STAGE_WIDTH - 30, victimX + offsets[i]!)),
        ageMs: -i * 230,
        warningMs: 600,
        activeMs: 120,
        hit: false,
        move,
      })
    }
    if (f.moveMs >= moveTotal(move)) {
      f.move = null
      f.special = null
      if (f.y > 0) {
        setState(f, "jump")
        f.airAttackUsed = true
      } else {
        setState(f, "idle")
        f.crouching = false
      }
    }
    return
  }

  if (!canAct(f)) return

  // Free to act: read the stick.
  recordMotion(f, input, state.clock)
  const punch = input.lp || input.hp
  const wantsSpecial = f.state !== "jump" && (input.sp || (punch && quarterCircleForward(f)))
  const move = pressedMove(f, input, wantsSpecial, state.clock)
  if (move && !canAffordSpecial(f, move)) {
    if (state.clock >= f.energyWarningUntil) {
      state.events.push({ type: "outOfEnergy", player: slot })
      f.energyWarningUntil = state.clock + ENERGY_WARNING_COOLDOWN_MS
    }
  } else if (move) {
    if (wantsSpecial || move.kind !== "normal") { f.motion = []; f.ultimateReadyUntil = -1 }
    if (f.state === "jump") {
      if (move.kind === "rain" || move.kind === "breakingNews") {
        // Cancel only the opening of Bernard's jump into a grounded cast.
        f.y = 0; f.vx = 0; f.vy = 0
      } else f.airAttackUsed = true
    }
    beginMove(f, move, state, slot)
    return
  }

  if (f.state === "jump") return

  const back = f.facing === 1 ? input.left : input.right
  const forward = f.facing === 1 ? input.right : input.left
  f.crouching = input.down
  f.guarding = back && !input.up
  if (input.up) {
    f.vy = f.def.jumpVy
    f.vx = (forward ? 1 : back ? -1 : 0) * f.facing * f.def.walkSpeed * 0.95
    f.crouching = false
    f.guarding = false
    f.airAttackUsed = false
    f.y = Math.max(f.y, 0.01)
    setState(f, "jump")
    state.events.push({ type: "jump", player: slot })
    return
  }
  if (f.crouching) {
    if (f.state !== "crouch") setState(f, "crouch")
    return
  }
  if (forward || back) {
    f.x += (forward ? 1 : -1) * f.facing * f.def.walkSpeed * dt
    if (f.state !== "walk") setState(f, "walk")
    return
  }
  if (f.state !== "idle") setState(f, "idle")
}

function stepPhysics(state: FightState, slot: 0 | 1, dt: number) {
  const f = state.fighters[slot]
  if (f.state === "trapped") return
  if (state.phase === "fight" && scriptedMotion(f)) return
  if (f.y > 0 || f.vy > 0) {
    f.vy -= GRAVITY * f.def.weight * dt
    f.y += f.vy * dt
    f.x += f.vx * dt
    if (f.y <= 0) {
      f.y = 0
      f.vy = 0
      f.vx = 0
      f.juggle = 0
      if (f.state === "knockdown" || f.state === "ko") f.stateMs = 0
      if (f.state === "jump") {
        setState(f, "idle")
        state.events.push({ type: "land", player: slot })
      } else if (f.state === "hitstun") {
        // Knocked out of the air: you land on your back.
        setState(f, "knockdown")
        f.stunMs = KNOCKDOWN_MS
      } else if (f.state === "attack" && f.move?.kind === "uppercut" && f.moveMs < moveTotal(f.move)) {
        // Land mid-recovery: the rest of the recovery is spent on the floor.
        f.moveMs = Math.max(f.moveMs, f.move.startup + f.move.active)
      }
    }
  } else if (f.vx !== 0) {
    f.x += f.vx * dt
    const decay = Math.exp(-FRICTION * dt)
    f.vx *= decay
    if (Math.abs(f.vx) < 4) f.vx = 0
  }
  const half = f.def.width / 2
  f.x = Math.min(STAGE_WIDTH - half, Math.max(half, f.x))
}

function separate(state: FightState) {
  const [a, b] = state.fighters
  if (a.state === "ko" || b.state === "ko") return
  if (divingThroughBodies(a) || divingThroughBodies(b)) return
  const gap = (a.def.width + b.def.width) / 2
  const dx = b.x - a.x
  const vertical = Math.abs(a.y - b.y) < Math.min(a.def.height, b.def.height)
  if (!vertical || Math.abs(dx) >= gap) return
  const push = (gap - Math.abs(dx)) / 2
  const sign = dx >= 0 ? 1 : dx < 0 ? -1 : a.facing
  // A captured fighter is anchored to the stationary sphere. The free
  // fighter takes the separation instead of pushing the sphere around.
  if (a.state === "trapped" || b.state === "trapped") {
    if (a.state !== "trapped") a.x = Math.max(a.def.width / 2, Math.min(STAGE_WIDTH - a.def.width / 2, b.x - gap * sign))
    if (b.state !== "trapped") b.x = Math.max(b.def.width / 2, Math.min(STAGE_WIDTH - b.def.width / 2, a.x + gap * sign))
    return
  }
  a.x -= push * sign
  b.x += push * sign
  for (const f of state.fighters) {
    const half = f.def.width / 2
    f.x = Math.min(STAGE_WIDTH - half, Math.max(half, f.x))
  }
  // Cornered: the pushed fighter cannot move, so the other one takes the gap.
  const dx2 = b.x - a.x
  if (Math.abs(dx2) < gap) {
    if (a.x <= a.def.width / 2 + 0.5) b.x = a.x + gap
    else if (b.x >= STAGE_WIDTH - b.def.width / 2 - 0.5) a.x = b.x - gap
  }
}

/** True when the victim's stance blocks this guard height. */
function blocks(victim: Fighter, guard: MoveDef["guard"]): boolean {
  if (!victim.guarding) return false
  if (victim.state !== "idle" && victim.state !== "walk" && victim.state !== "crouch" && victim.state !== "blockstun") return false
  if (victim.y > 0) return false
  switch (guard) {
    case "high": return true
    case "low": return victim.crouching
    case "overhead": return !victim.crouching
    case "unblockable": return false
  }
}

/** Against the wall: nowhere left to be pushed. */
function cornered(f: Fighter): boolean {
  const half = f.def.width / 2
  return f.x <= half + 1 || f.x >= STAGE_WIDTH - half - 1
}

function applyHit(state: FightState, attackerSlot: 0 | 1, move: MoveDef, at: { x: number; y: number }, attackerHealth = state.fighters[attackerSlot].health) {
  const attacker = state.fighters[attackerSlot]
  const victimSlot = attackerSlot === 0 ? 1 : 0
  const victim = state.fighters[victimSlot]
  // A damaging follow-up pops its occupied orb before applying normal hit
  // physics. Other orbs cannot immediately recapture the released fighter.
  for (const orb of state.orbs) if (orb.captured === victimSlot) releaseOrb(state, orb, true)
  state.orbs = state.orbs.filter(orb => orb.remainingMs > 0)
  const away = victim.x >= attacker.x ? 1 : -1
  const heavy = move.damage >= 12
  // A cornered victim cannot be pushed, so the push goes into the attacker
  // instead — the classic rule that keeps a corner from being a cage.
  if (cornered(victim) && attacker.y <= 0) attacker.vx = -away * move.knockback * 0.7
  if (blocks(victim, move.guard)) {
    victim.health = Math.max(0, victim.health - (move.chip ?? 0))
    setState(victim, "blockstun")
    victim.stunMs = move.blockstun
    victim.vx = away * move.knockback * 0.5
    attacker.vx = -away * move.knockback * 0.15
    state.events.push({ type: "block", player: attackerSlot, heavy, x: at.x, y: at.y })
    state.hitstop = Math.max(state.hitstop, heavy ? 60 : 30)
    if (victim.health <= 0) knockOut(state, victimSlot)
    return
  }
  // Combo scaling: each hit after the first does a little less, so a long
  // string is rewarded without deciding the round by itself.
  const scaled = Math.max(1, Math.round(move.damage * Math.max(0.35, 1 - attacker.combo * 0.12)))
  victim.health = Math.max(0, victim.health - scaled)
  // Landed normals build meter quickly; specials give only a small rebate.
  addEnergy(attacker, move.energyCost ? 4 : 9, attackerHealth)
  addEnergy(victim, 12)
  attacker.combo += 1
  victim.crouching = false
  victim.guarding = false
  victim.move = null
  victim.special = null
  state.events.push({ type: "hit", player: attackerSlot, heavy, x: at.x, y: at.y })
  state.hitstop = Math.max(state.hitstop, heavy ? 110 : 60)
  if (victim.health <= 0) {
    knockOut(state, victimSlot)
    victim.vx = away * Math.max(move.knockback, 260)
    victim.vy = Math.max(move.launch ?? 0, 260)
    victim.y = Math.max(victim.y, 0.01)
    return
  }
  if (move.launch || victim.y > 0) {
    // Juggles decay: the third hit in the air stops popping the victim back
    // up and drops them out of the combo instead (a falling body is safe).
    victim.juggle += victim.y > 0 ? 1 : 0
    if (victim.juggle >= 3) {
      setState(victim, "knockdown")
      victim.stunMs = KNOCKDOWN_MS
      victim.vx = away * move.knockback
      victim.vy = Math.min(victim.vy, 0)
      return
    }
    const decay = victim.juggle === 0 ? 1 : victim.juggle === 1 ? 0.6 : 0.35
    setState(victim, "hitstun")
    victim.stunMs = move.hitstun
    victim.vx = away * move.knockback
    victim.vy = Math.max((move.launch ?? 0) * decay, victim.y > 0 ? 200 * decay : 0)
    victim.y = Math.max(victim.y, 0.01)
    return
  }
  if (move.knockdown) {
    setState(victim, "knockdown")
    victim.stunMs = KNOCKDOWN_MS
    victim.vx = away * move.knockback
    return
  }
  setState(victim, "hitstun")
  victim.stunMs = move.hitstun
  victim.vx = away * move.knockback
}

function clearBreakingNews(state: FightState) {
  for (const f of state.fighters) if (f.move?.kind === "breakingNews") {
    f.move = null; f.special = null
    if (f.state === "attack") setState(f, f.y > 0 ? "jump" : "idle")
  }
}

function knockOut(state: FightState, victimSlot: 0 | 1) {
  const victim = state.fighters[victimSlot]
  setState(victim, "ko")
  victim.move = null
  victim.special = null
  victim.crouching = false
  state.phase = "ko"
  clearBreakingNews(state)
  clearOrbs(state)
  state.rain = []
  state.phaseMs = 0
  state.roundWinner = state.fighters.every(f => f.health <= 0) ? null : victimSlot === 0 ? 1 : 0
  // A same-frame trade can knock out both fighters. Announce one result.
  const announcement = state.events.find(event => event.type === "ko")
  if (announcement) announcement.player = state.roundWinner ?? 0
  else state.events.push({ type: "ko", player: state.roundWinner ?? 0 })
}

function resolveAttacks(state: FightState) {
  const hits: { slot: 0 | 1; move: MoveDef; health: number; at: { x: number; y: number } }[] = []
  // Snapshot contacts before applying hitstun, which clears the victim's move.
  // Both already-active attacks must connect regardless of player slot.
  for (const slot of [0, 1] as const) {
    if (state.phase !== "fight") return
    const f = state.fighters[slot]
    if (f.state !== "attack" || !f.move || f.hitDone) continue
    const move = f.move
    if (move.kind === "projectile") continue
    if (move.kind === "orb" || move.kind === "rain") continue
    if (f.moveMs < move.startup || f.moveMs >= move.startup + move.active) {
      if (f.moveMs >= move.startup + move.active && !f.hitDone && f.moveMs - move.startup - move.active < 1000 / 60 * 1.5) {
        state.events.push({ type: "whiff", player: slot })
        f.hitDone = true
      }
      continue
    }
    const victim = state.fighters[slot === 0 ? 1 : 0]
    // Down is safe: nothing connects with a fighter on the floor.
    if (victim.invulnMs > 0 || victim.state === "ko" || victim.state === "knockdown") continue
    const radius = circleRadius(f)
    const center = circleCenter(f)
    const news = move.kind === "breakingNews" ? breakingNewsGeometry(f) : null
    if (news && news.phase !== "explosion") continue
    const box = news ? news.explosion : move.scanning ? scanningBeamBox(f) : move.kind === "circle"
      ? { x: center.x - radius, y: center.y - radius, w: radius * 2, h: radius * 2 }
      : worldHitbox(f, move.hitbox)
    const body = hurtbox(victim)
    if (!overlaps(box, body)) continue
    if (move.kind === "circle") {
      const nearestX = Math.max(body.x, Math.min(center.x, body.x + body.w))
      const cy = center.y
      const nearestY = Math.max(body.y, Math.min(cy, body.y + body.h))
      if ((nearestX - center.x) ** 2 + (nearestY - cy) ** 2 > radius ** 2) continue
    }
    f.hitDone = true
    hits.push({ slot, move, health: f.health, at: { x: victim.x + (f.facing * victim.def.width) / 4, y: Math.min(box.y + box.h / 2, body.y + body.h) } })
  }
  for (const hit of hits) applyHit(state, hit.slot, hit.move, hit.at, hit.health)
}

function stepProjectiles(state: FightState, dt: number) {
  const alive: Projectile[] = []
  for (const p of state.projectiles) {
    p.x += p.vx * dt
    p.y += (p.vy ?? 0) * dt
    p.ttl -= dt * 1000
    if (p.ttl <= 0 || p.x < -p.w || p.x > STAGE_WIDTH + p.w) continue
    alive.push(p)
  }
  // Two waves meeting cancel each other out.
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!, b = alive[j]!
      if (a.owner !== b.owner && a.ttl > 0 && b.ttl > 0 && Math.abs(a.x - b.x) < (a.w + b.w) / 2) {
        a.ttl = 0
        b.ttl = 0
        state.events.push({ type: "block", player: a.owner, x: (a.x + b.x) / 2, y: a.y })
      }
    }
  }
  state.projectiles = alive.filter((p) => p.ttl > 0)
  if (state.phase !== "fight") return
  for (const p of state.projectiles) {
    const victimSlot = p.owner === 0 ? 1 : 0
    const victim = state.fighters[victimSlot]
    if (victim.invulnMs > 0 || victim.state === "ko" || victim.state === "knockdown") continue
    const box: Box = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }
    if (!overlaps(box, hurtbox(victim))) continue
    p.ttl = 0
    applyHit(state, p.owner, p.move, { x: p.x, y: p.y })
    if (state.phase !== "fight") break
  }
  state.projectiles = state.projectiles.filter((p) => p.ttl > 0)
}

function releaseOrb(state: FightState, orb: WaterOrb, continuingCombo = false) {
  if (orb.captured !== null) {
    const f = state.fighters[orb.captured]
    f.orbImmuneUntil = state.clock + ORB_RELEASE_GRACE_MS
    if (!continuingCombo) state.fighters[orb.captured === 0 ? 1 : 0].combo = 0
    if (f.state === "trapped") setState(f, f.y > 0 ? "jump" : "idle")
    orb.captured = null
  }
  orb.remainingMs = 0
}

function clearOrbs(state: FightState) {
  for (const orb of state.orbs) releaseOrb(state, orb)
  state.orbs = []
}

function stepWorldEffects(state: FightState, dtMs: number) {
  if (state.phase !== "fight") return
  for (const orb of state.orbs) {
    orb.remainingMs -= dtMs
    if (orb.remainingMs <= 0) { releaseOrb(state, orb); continue }
    if (orb.captured !== null) continue
    const slot = orb.owner === 0 ? 1 : 0, victim = state.fighters[slot]
    if (victim.state === "ko" || victim.state === "knockdown" || victim.state === "trapped"
      || victim.invulnMs > 0 || victim.orbImmuneUntil > state.clock) continue
    const body = hurtbox(victim)
    const x = Math.max(body.x, Math.min(orb.x, body.x + body.w))
    const y = Math.max(body.y, Math.min(orb.y, body.y + body.h))
    if ((x - orb.x) ** 2 + (y - orb.y) ** 2 > orb.radius ** 2) continue
    if (blocks(victim, "high")) {
      orb.remainingMs = 0
      setState(victim, "blockstun")
      victim.stunMs = 120
      state.events.push({ type: "block", player: orb.owner, x, y })
      continue
    }
    orb.captured = slot
    victim.x = orb.x; victim.y = Math.max(0, orb.y - victim.def.height / 2)
    victim.vx = 0; victim.vy = 0; victim.move = null; victim.special = null
    victim.crouching = false; victim.guarding = false; victim.motion = []
    setState(victim, "trapped")
  }
  state.orbs = state.orbs.filter(orb => orb.remainingMs > 0)
  for (const lane of state.rain) {
    if (state.phase !== "fight") return
    const before = lane.ageMs
    lane.ageMs += dtMs
    if (lane.hit || before >= lane.warningMs + lane.activeMs || lane.ageMs < lane.warningMs) continue
    const victim = state.fighters[lane.owner === 0 ? 1 : 0]
    if (victim.state === "ko" || victim.state === "knockdown" || victim.invulnMs > 0) continue
    // Airborne fighters can move out of a narrow column too.
    if (Math.abs(victim.x - lane.x) < RAIN_WIDTH / 2 + victim.def.width / 2) {
      lane.hit = true
      applyHit(state, lane.owner, lane.move, { x: lane.x, y: victim.y + victim.def.height / 2 })
      if (state.phase !== "fight") return
    }
  }
  state.rain = state.rain.filter(lane => lane.ageMs < lane.warningMs + lane.activeMs)
}

function endRound(state: FightState) {
  const winner = state.roundWinner
  if (winner === null) {
    state.wins[0] += 1
    state.wins[1] += 1
  } else {
    state.wins[winner] += 1
  }
  state.events.push({ type: "roundwin", player: winner ?? 0 })
  const p1Won = state.wins[0] >= ROUNDS_TO_WIN
  const p2Won = state.wins[1] >= ROUNDS_TO_WIN
  if (p1Won || p2Won) {
    state.phase = "matchover"
    state.phaseMs = 0
    state.matchWinner = p1Won && p2Won ? null : p1Won ? 0 : 1
    state.events.push({ type: "matchover", player: state.matchWinner ?? 0 })
    return
  }
  state.round += 1
  resetRound(state)
}

/**
 * Advance the fight by `dtMs`. Inputs are read only during the FIGHT phase;
 * attack buttons must be edges (pressed this step), directions held state.
 * Returns the same (mutated) state for convenience.
 */
export function stepFight(state: FightState, inputs: [FightInput, FightInput], dtMs: number): FightState {
  state.events = []
  state.clock += dtMs
  const dt = dtMs / 1000
  state.phaseMs += dtMs

  if (state.hitstop > 0) {
    state.hitstop = Math.max(0, state.hitstop - dtMs)
    stepWorldEffects(state, dtMs)
    return state
  }

  switch (state.phase) {
    case "intro":
      if (!state.introAnnounced) {
        state.introAnnounced = true
        state.events.push({ type: "intro", player: 0 })
      }
      if (state.phaseMs >= INTRO_MS) {
        state.phase = "fight"
        state.phaseMs = 0
        state.events.push({ type: "fight", player: 0 })
      }
      return state
    case "fight": {
      state.timerMs = Math.max(0, state.timerMs - dtMs)
      for (const slot of [0, 1] as const) stepFighterControl(state, slot, inputs[slot], dt)
      for (const slot of [0, 1] as const) stepPhysics(state, slot, dt)
      separate(state)
      resolveAttacks(state)
      stepProjectiles(state, dt)
      stepWorldEffects(state, dtMs)
      if (state.phase === "fight" && state.timerMs <= 0) {
        const [a, b] = state.fighters
        state.phase = "ko"
        state.phaseMs = 0
        clearBreakingNews(state)
        clearOrbs(state)
        state.rain = []
        state.roundWinner = a.health === b.health ? null : a.health > b.health ? 0 : 1
        state.events.push({ type: "timeout", player: state.roundWinner ?? 0 })
      }
      return state
    }
    case "ko":
      // The loser keeps falling; the winner stands where they are.
      for (const f of state.fighters) f.stateMs += dtMs
      for (const slot of [0, 1] as const) stepPhysics(state, slot, dt)
      stepProjectiles(state, dt)
      if (state.phaseMs >= KO_MS) endRound(state)
      return state
    case "matchover":
      for (const f of state.fighters) f.stateMs += dtMs
      for (const slot of [0, 1] as const) stepPhysics(state, slot, dt)
      return state
  }
}
