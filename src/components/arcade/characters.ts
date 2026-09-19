// The arcade's roster: six fighters, each a data sheet the simulation reads.
//
// Frame data is in milliseconds rather than frames so the sim can step at any
// rate, but it is tuned the way a fighting game is: startup, active window,
// recovery. Damage is out of 100 health. Hitboxes are relative to the
// fighter's origin (feet, centre) with +x FORWARD — the sim mirrors them for a
// fighter facing left. No art lives here; the renderer draws each fighter from
// its palette and proportions.

export type CharacterId = "bull" | "bear" | "quant" | "whale" | "bernard" | "primey"
export const ENERGY_PER_BAR = 100

export type Guard = "high" | "low" | "overhead" | "unblockable"

export type MoveKind = "normal" | "dash" | "projectile" | "uppercut" | "iceSlam" | "circle" | "orb" | "beam" | "rain" | "breakingNews"

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface MoveDef {
  id: string
  label: string
  /** ms before the hitbox goes live. */
  startup: number
  /** ms the hitbox stays live. */
  active: number
  /** ms after the hitbox dies before control returns. */
  recovery: number
  damage: number
  /** ms the victim is locked after being hit / after blocking. */
  hitstun: number
  blockstun: number
  /** Horizontal speed (px/s) pushed into the victim on hit. */
  knockback: number
  hitbox: Box
  guard: Guard
  /** The victim falls and has to get up. */
  knockdown?: boolean
  /** Vertical speed given to the victim on hit — a launcher. */
  launch?: number
  /** Damage dealt through a block (specials only, by convention). */
  chip?: number
  kind: MoveKind
  /** Meter spent when the move begins. Normals are free. */
  energyCost?: number
  /** dash / uppercut: forward speed while the move runs (px/s). */
  selfVx?: number
  /** uppercut: the jump the move launches into (px/s). */
  selfVy?: number
  /** Invulnerable through startup — a reversal. */
  invulnStartup?: boolean
  /** Maximum travel or area radius for the redesigned specials. */
  range?: number
  /** Fired circle distance; absent means rings centred on the caster. */
  circleTravel?: number
  orb?: { radius: number; y: number; offset: number; life: number }
  /** A continuous horizontal scan with a roster-safe ducking height. */
  scanning?: boolean
  projectile?: {
    speed: number
    w: number
    h: number
    /** Height of the projectile's centre above the floor. */
    y: number
    /** ms before it fizzles if it hits nothing. */
    life: number
  }
}

export interface CharacterDef {
  id: CharacterId
  name: string
  title: string
  tagline: string
  /** Per-character body colours the renderer paints with. */
  palette: {
    body: string
    trim: string
    skin: string
    accent: string
  }
  maxHealth: number
  /** Full at the start of each round; each bar holds ENERGY_PER_BAR units. */
  energyBars: number
  /** px/s */
  walkSpeed: number
  /** px/s, upward */
  jumpVy: number
  /** Body box the opponent's hitboxes test against. */
  width: number
  height: number
  crouchHeight: number
  /** Multiplies gravity: heavier fighters drop faster. */
  weight: number
  moves: {
    lp: MoveDef
    hp: MoveDef
    lk: MoveDef
    hk: MoveDef
    /** Crouching light kick — a low poke. */
    crlk: MoveDef
    /** Crouching heavy kick — the sweep. */
    sweep: MoveDef
    /** Any button in the air. */
    air: MoveDef
    special: MoveDef
    specialUp?: MoveDef
    specialForward?: MoveDef
    specialBack?: MoveDef
    specialDownForward?: MoveDef
    specialDown?: MoveDef
    specialUltimate?: MoveDef
  }
  specialName: string
  /** What the special does, for the select screen. */
  specialHint: string
}

const normal = (
  id: string,
  label: string,
  frames: [startup: number, active: number, recovery: number],
  damage: number,
  hitbox: Box,
  extra: Partial<MoveDef> = {},
): MoveDef => ({
  id,
  label,
  startup: frames[0],
  active: frames[1],
  recovery: frames[2],
  damage,
  // Lights recover faster than their own hitstun runs out only by a hair, so
  // a jab links into a jab but never chains forever; pushback does the rest.
  hitstun: 140 + damage * 12,
  blockstun: 120 + damage * 8,
  knockback: 120 + damage * 18,
  hitbox,
  guard: "high",
  kind: "normal",
  ...extra,
})

// Shared shapes: a jab reaches an arm's length at chest height, a kick a little
// further and lower, a crouch kick along the floor, a sweep the same but wide.
const JAB: Box = { x: 30, y: 95, w: 55, h: 28 }
const STRAIGHT: Box = { x: 30, y: 90, w: 70, h: 36 }
const KICK: Box = { x: 30, y: 60, w: 70, h: 34 }
const ROUNDHOUSE: Box = { x: 30, y: 70, w: 85, h: 50 }
const LOW: Box = { x: 30, y: 4, w: 65, h: 26 }
const SWEEP: Box = { x: 30, y: 2, w: 90, h: 24 }
const AIR: Box = { x: 10, y: -10, w: 60, h: 50 }

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: "bull",
    name: "BULL",
    title: "THE LONG",
    tagline: "Buys the dip. Head first.",
    palette: { body: "#c8382e", trim: "#7a1d17", skin: "#f0b48c", accent: "#ffd166" },
    maxHealth: 110,
    energyBars: 1,
    walkSpeed: 150,
    jumpVy: 620,
    width: 64,
    height: 150,
    crouchHeight: 100,
    weight: 1.15,
    moves: {
      lp: normal("bull-lp", "JAB", [70, 60, 140], 5, JAB),
      hp: normal("bull-hp", "HAYMAKER", [200, 90, 300], 14, STRAIGHT, { knockback: 420 }),
      lk: normal("bull-lk", "SHIN KICK", [90, 70, 180], 7, KICK),
      hk: normal("bull-hk", "STAMPEDE KICK", [230, 110, 320], 15, ROUNDHOUSE, { knockback: 380 }),
      crlk: normal("bull-crlk", "LOW JAB", [80, 60, 170], 5, LOW, { guard: "low" }),
      sweep: normal("bull-sweep", "SWEEP", [180, 90, 360], 11, SWEEP, { guard: "low", knockdown: true }),
      air: normal("bull-air", "DIVING HORN", [110, 160, 120], 10, AIR, { guard: "overhead" }),
      special: normal("bull-special", "HORN ATTACK", [220, 720, 340], 22, { x: 20, y: 60, w: 70, h: 100 }, {
        kind: "dash",
        energyCost: 40,
        selfVx: 1200,
        // Travel + horn hitbox + the victim's body reaches about 3/4 stage.
        range: 600,
        launch: 520,
        knockdown: true,
        chip: 3,
        knockback: 300,
        blockstun: 400,
      }),
    },
    specialName: "HORN ATTACK",
    specialHint: "flaming rush and horn uppercut · three-quarter range",
  },
  {
    id: "bear",
    name: "BEAR",
    title: "THE SHORT",
    tagline: "Waits. Then the whole market drops.",
    palette: { body: "#2f5fd6", trim: "#f2ead2", skin: "#f1f4f6", accent: "#8fd3ff" },
    maxHealth: 120,
    energyBars: 1,
    walkSpeed: 130,
    jumpVy: 580,
    width: 70,
    height: 155,
    crouchHeight: 105,
    weight: 1.25,
    moves: {
      lp: normal("bear-lp", "PAW", [80, 60, 160], 6, JAB),
      hp: normal("bear-hp", "MAUL", [220, 100, 320], 16, STRAIGHT, { knockback: 460 }),
      lk: normal("bear-lk", "STOMP", [100, 70, 200], 7, KICK),
      hk: normal("bear-hk", "BEAR TRAP", [240, 120, 340], 15, ROUNDHOUSE, { knockback: 400 }),
      crlk: normal("bear-crlk", "LOW SWIPE", [90, 60, 180], 6, LOW, { guard: "low" }),
      sweep: normal("bear-sweep", "SWEEP", [190, 90, 380], 12, SWEEP, { guard: "low", knockdown: true }),
      air: normal("bear-air", "DROP CLAW", [120, 160, 130], 11, AIR, { guard: "overhead" }),
      special: normal("bear-special", "ICE SLAM", [800, 180, 420], 24, { x: -80, y: 0, w: 160, h: 100 }, {
        kind: "iceSlam",
        energyCost: 40,
        range: 400,
        guard: "high",
        knockdown: true,
        chip: 4,
        knockback: 360,
        blockstun: 460,
      }),
    },
    specialName: "ICE SLAM",
    specialHint: "forward leap and ice-crystal slam · half-screen reach",
  },
  {
    id: "quant",
    name: "QUANT",
    title: "THE ALGO",
    tagline: "Ten thousand trades a second. All of them kicks.",
    palette: { body: "#1f7a8c", trim: "#0f3f4a", skin: "#f5d7c0", accent: "#bfff5e" },
    maxHealth: 100,
    energyBars: 1,
    walkSpeed: 200,
    jumpVy: 680,
    width: 54,
    height: 145,
    crouchHeight: 95,
    weight: 0.95,
    moves: {
      lp: normal("quant-lp", "TICK", [50, 50, 110], 4, JAB),
      hp: normal("quant-hp", "SPIKE", [160, 80, 240], 11, STRAIGHT, { knockback: 340 }),
      lk: normal("quant-lk", "SNAP KICK", [70, 60, 140], 6, KICK),
      hk: normal("quant-hk", "SCISSOR KICK", [180, 100, 260], 12, ROUNDHOUSE, { knockback: 320 }),
      crlk: normal("quant-crlk", "LOW TICK", [60, 60, 130], 4, LOW, { guard: "low" }),
      sweep: normal("quant-sweep", "SWEEP", [150, 80, 320], 9, SWEEP, { guard: "low", knockdown: true }),
      air: normal("quant-air", "AIR SPIKE", [90, 150, 100], 8, AIR, { guard: "overhead" }),
      special: normal("quant-special", "MATH CIRCLE", [240, 600, 360], 18, { x: 0, y: 0, w: 0, h: 0 }, {
        kind: "circle",
        energyCost: 45,
        range: 400,
        chip: 2,
        knockback: 260,
        blockstun: 300,
      }),
    },
    specialName: "MATH CIRCLE",
    specialHint: "three expanding math rings · half-screen reach",
  },
  {
    id: "whale",
    name: "WHALE",
    title: "THE POSITION",
    tagline: "Moves markets. Moves slowly. Moves you.",
    palette: { body: "#e3a92a", trim: "#1c1c1c", skin: "#f0c8a8", accent: "#ffd166" },
    maxHealth: 120,
    energyBars: 1,
    walkSpeed: 115,
    jumpVy: 560,
    width: 80,
    height: 160,
    crouchHeight: 110,
    weight: 1.35,
    moves: {
      lp: normal("whale-lp", "FLIPPER", [90, 60, 170], 6, JAB),
      hp: normal("whale-hp", "BREACH", [240, 110, 360], 18, STRAIGHT, { knockback: 500 }),
      lk: normal("whale-lk", "TAIL TAP", [110, 70, 210], 8, KICK),
      hk: normal("whale-hk", "TAIL SLAP", [260, 120, 380], 17, ROUNDHOUSE, { knockback: 440, knockdown: true }),
      crlk: normal("whale-crlk", "LOW FLIPPER", [100, 60, 200], 6, LOW, { guard: "low" }),
      sweep: normal("whale-sweep", "TIDE SWEEP", [200, 100, 400], 13, SWEEP, { guard: "low", knockdown: true }),
      air: normal("whale-air", "BELLY FLOP", [130, 170, 150], 13, AIR, { guard: "overhead" }),
      special: normal("whale-special", "WATER ORB", [500, 80, 320], 0, { x: 0, y: 0, w: 0, h: 0 }, {
        kind: "orb",
        energyCost: 35,
      }),
    },
    specialName: "WATER ORB",
    specialHint: "stationary 3-second trap · up to 3 orbs",
  },
  {
    id: "bernard",
    name: "BERNARD",
    title: "THE ANCHOR",
    tagline: "When the market moves, he breaks the story.",
    palette: { body: "#1f2e52", trim: "#0b1328", skin: "#c58d6c", accent: "#48c8ff" },
    maxHealth: 100,
    energyBars: 5,
    walkSpeed: 155,
    jumpVy: 610,
    width: 62,
    height: 152,
    crouchHeight: 102,
    weight: 1.05,
    moves: {
      lp: normal("bernard-lp", "MIC CHECK", [65, 55, 135], 5, JAB),
      hp: normal("bernard-hp", "LIVE CUT", [180, 85, 280], 13, STRAIGHT, { knockback: 380 }),
      lk: normal("bernard-lk", "PRESS STEP", [85, 65, 165], 7, KICK),
      hk: normal("bernard-hk", "DEADLINE KICK", [210, 105, 300], 14, ROUNDHOUSE, { knockback: 360 }),
      crlk: normal("bernard-crlk", "LOW SCOOP", [75, 55, 155], 5, LOW, { guard: "low" }),
      sweep: normal("bernard-sweep", "WIRE SWEEP", [170, 85, 340], 11, SWEEP, { guard: "low", knockdown: true }),
      air: normal("bernard-air", "AIRTIME", [100, 150, 120], 10, AIR, { guard: "overhead" }),
      special: normal("bernard-special", "REDLINE VISION", [300, 1000, 360], 16, { x: 18, y: 112, w: 960, h: 6 }, {
        kind: "beam", scanning: true, energyCost: 45, chip: 2, knockback: 180, blockstun: 320,
      }),
      specialForward: normal("bernard-dash", "DEADLINE RUSH", [220, 720, 340], 27, { x: 20, y: 60, w: 70, h: 100 }, {
        kind: "dash", energyCost: 60, selfVx: 1800, range: 960, launch: 520, knockdown: true, chip: 3, knockback: 300, blockstun: 400,
      }),
      specialBack: normal("bernard-ice", "COLD FRONT", [800, 180, 420], 28, { x: -140, y: 0, w: 280, h: 140 }, {
        kind: "iceSlam", energyCost: 65, range: 520, guard: "low", knockdown: true, chip: 4, knockback: 360, blockstun: 460,
      }),
      specialDownForward: normal("bernard-circle", "FULL COVERAGE", [280, 700, 360], 23, { x: 0, y: 0, w: 0, h: 0 }, {
        kind: "circle", energyCost: 55, range: 150, circleTravel: 360, chip: 3, knockback: 260, blockstun: 300,
      }),
      specialDown: normal("bernard-orb", "NEWS BUBBLE", [500, 80, 320], 0, { x: 0, y: 0, w: 0, h: 0 }, {
        kind: "orb", energyCost: 60, orb: { radius: 120, y: 135, offset: 260, life: 5500 },
      }),
      specialUltimate: normal("bernard-breaking-news", "BREAKING NEWS", [2200, 900, 500], 40, { x: 0, y: 0, w: 320, h: 320 }, {
        kind: "breakingNews", energyCost: 300, guard: "unblockable", knockdown: true, knockback: 420,
      }),
      specialUp: normal("bernard-special-up", "REDLINE RAIN", [360, 120, 650], 10, { x: 0, y: 0, w: 0, h: 0 }, {
        kind: "rain", energyCost: 75, guard: "unblockable", knockback: 80, hitstun: 180,
      }),
    },
    specialName: "REDLINE VISION",
    specialHint: "continuous eye scan · powered roster specials · Breaking News",
  },
  {
    id: "primey",
    name: "PRIMEY",
    title: "THE HOUSE",
    tagline: "The house always wins. Politely.",
    palette: { body: "#f2f4f8", trim: "#1b2450", skin: "#e6e9f2", accent: "#4fe3ff" },
    maxHealth: 105,
    energyBars: 1,
    walkSpeed: 190,
    jumpVy: 640,
    width: 56,
    height: 120,
    crouchHeight: 82,
    weight: 0.9,
    moves: {
      lp: normal("primey-lp", "PING", [55, 50, 120], 4, { x: 26, y: 70, w: 62, h: 26 }),
      hp: normal("primey-hp", "HARD FORK", [160, 80, 250], 12, { x: 26, y: 66, w: 78, h: 34 }, { knockback: 360 }),
      lk: normal("primey-lk", "SERVO KICK", [75, 60, 150], 6, { x: 26, y: 44, w: 74, h: 30 }),
      hk: normal("primey-hk", "PISTON KICK", [180, 100, 260], 13, { x: 26, y: 52, w: 90, h: 44 }, { knockback: 340 }),
      crlk: normal("primey-crlk", "LOW PING", [65, 60, 140], 4, { x: 26, y: 4, w: 70, h: 22 }, { guard: "low" }),
      sweep: normal("primey-sweep", "SWEEP", [160, 80, 330], 10, { x: 26, y: 2, w: 92, h: 22 }, { guard: "low", knockdown: true }),
      air: normal("primey-air", "DROP KICK", [100, 150, 110], 9, { x: 8, y: -8, w: 66, h: 44 }, { guard: "overhead" }),
      special: normal("primey-special", "PRIME LASER", [120, 160, 250], 5, { x: 18, y: 41, w: 960, h: 10 }, {
        kind: "beam",
        energyCost: 20,
        chip: 1,
        knockback: 120,
        blockstun: 160,
      }),
    },
    specialName: "PRIME LASER",
    specialHint: "full-screen chest laser · light damage",
  },
]

export function characterById(id: CharacterId): CharacterDef {
  const found = CHARACTERS.find((c) => c.id === id)
  if (!found) throw new Error(`unknown fighter ${id}`)
  return found
}
