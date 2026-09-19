// Drawing the fight.
//
// A 2D canvas spanning the full viewport. Extra room is visible on unusually
// wide/tall screens; the complete arena and jump height remain in view. See
// sprite-atlas.generated.ts): the shell hands the loaded images over with
// setSprites, and sprite-frames.ts decides which frame a fighter shows. Until
// an atlas arrives — or if it never does — a procedural puppet stands in:
// head, torso, two arms, two legs, posed from the same state in the
// character's palette, so a failed download costs the look, not the game.
//
// The stage is the game room redrawn as a side-view arena, in three parallax
// layers (stage-atlas.generated.ts): the far wall and the tables slide against
// the fighters' midpoint while the floor, the play plane, stays put. Until the
// layers load — or if they never do — a procedural night skyline stands in.
//
// The renderer owns only cosmetic state: sparks, screen shake, the health
// bars' slow red "damage trail". The sim is the truth; `onEvent` receives the
// sim's events so the cosmetics can react.

import { ENERGY_PER_BAR, type CharacterDef } from "./characters"
import { canCastSpecial, MAX_WATER_ORBS, ROUNDS_TO_WIN, STAGE_WIDTH, timerSeconds, type FightEvent, type FightState, type Fighter } from "./fight-sim"
import { FIGHTER_ATLASES } from "./fighter-atlases"
import { moveFamily, pickSpriteFrame } from "./sprite-frames"
import { loadEffectImages, type EffectImages, type SpriteImages, type StageImages } from "./sprite-loader"
import { GAME_ROOM_STAGE, type BattleStage } from "./battle-stages"
import { FAR_OVERSCAN, placeLayer, stageCameraOffset, stageFloorY } from "./stage-parallax"
import { drawSpecialEffects } from "./special-effects"
import { breakingNewsGeometry, BREAKING_NEWS_HOVER_HEIGHT } from "./special-motion"

export const VIEW_W = STAGE_WIDTH
export const VIEW_H = 540
/** The floor line of the procedural fallback backdrop. */
const FALLBACK_FLOOR_Y = 470
// A canvas font string cannot carry a CSS variable — the whole declaration is
// rejected and the text falls back to 10px sans-serif — so the family is
// spelled out. The app ships Press Start 2P via @fontsource.
const FONT = '"Press Start 2P", "VT323", monospace'

interface Spark {
  x: number
  y: number
  life: number
  max: number
  kind: "hit" | "block" | "ko"
  heavy: boolean
  angle: number
}

interface Building {
  x: number
  w: number
  h: number
  windows: number[]
}

export interface FightRenderer {
  render(state: FightState, nowMs: number, labels: [string, string]): void
  /** The fighters' atlas images, once loaded; a missing id keeps its puppet. */
  setSprites(images: SpriteImages): void
  /** The stage's parallax layers, once loaded; without the far layer the
   * procedural backdrop stays. */
  setStage(images: StageImages, definition?: BattleStage): void
  setEffects(images: EffectImages): void
  onEvent(event: FightEvent): void
  resize(): void
  dispose(): void
}

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Where a move is in its swing: 0 → fully extended (1) → back to 0. */
function moveExtension(f: Fighter): number {
  const move = f.move
  if (!move) return 0
  const live = move.startup + move.active
  if (f.moveMs < move.startup) return easeOut(f.moveMs / move.startup) * 0.85
  if (f.moveMs < live) return 1
  return Math.max(0, 1 - (f.moveMs - live) / Math.max(1, move.recovery))
}

type Limb = { angle: number; reach: number }

interface Pose {
  /** Torso lean, radians; forward positive. */
  lean: number
  /** Vertical squash of the whole body (crouch). */
  crouch: number
  frontArm: Limb
  backArm: Limb
  frontLeg: Limb
  backLeg: Limb
  /** Lying flat. */
  down: boolean
  guard: boolean
}

function poseFor(f: Fighter, nowMs: number): Pose {
  const bob = Math.sin(nowMs / 260) * 0.06
  const stance: Pose = {
    lean: 0.04,
    crouch: 0,
    frontArm: { angle: -0.9 + bob, reach: 0.55 },
    backArm: { angle: -1.2 + bob, reach: 0.5 },
    frontLeg: { angle: 0.35, reach: 1 },
    backLeg: { angle: -0.35, reach: 1 },
    down: false,
    guard: false,
  }
  switch (f.state) {
    case "walk": {
      const swing = Math.sin(nowMs / 110) * 0.55
      return { ...stance, frontLeg: { angle: swing, reach: 1 }, backLeg: { angle: -swing, reach: 1 }, frontArm: { angle: -0.9 - swing * 0.4, reach: 0.55 }, backArm: { angle: -1.2 + swing * 0.4, reach: 0.5 } }
    }
    case "crouch":
      return { ...stance, crouch: 1, frontLeg: { angle: 0.9, reach: 0.6 }, backLeg: { angle: -0.9, reach: 0.6 }, frontArm: { angle: -0.6, reach: 0.5 }, backArm: { angle: -1.0, reach: 0.45 }, guard: f.guarding }
    case "jump":
      return { ...stance, lean: 0.1, frontLeg: { angle: 0.8, reach: 0.55 }, backLeg: { angle: -0.5, reach: 0.7 }, frontArm: { angle: -1.9, reach: 0.7 }, backArm: { angle: -2.2, reach: 0.6 } }
    case "hitstun":
      return { ...stance, lean: -0.35, frontArm: { angle: -2.0, reach: 0.8 }, backArm: { angle: -2.4, reach: 0.7 }, frontLeg: { angle: 0.5, reach: 0.9 }, backLeg: { angle: -0.2, reach: 1 } }
    case "blockstun":
      return { ...stance, lean: -0.08, guard: true, frontArm: { angle: -1.3, reach: 0.45 }, backArm: { angle: -1.1, reach: 0.4 }, crouch: f.crouching ? 1 : 0 }
    case "knockdown":
    case "ko":
      return { ...stance, down: true }
    case "attack": {
      const move = f.move
      if (!move) return stance
      const ext = moveExtension(f)
      const heavy = move.damage >= 12
      if (f.id === "bernard") {
        if (move.kind === "breakingNews" || move.kind === "rain") {
          const throwing = f.moveMs >= move.startup
          return { ...stance, lean: throwing ? 0.2 : 0, frontArm: { angle: throwing ? -1.5 : -3.05, reach: 1.1 }, backArm: { angle: throwing ? -1.6 : -3.3, reach: 1.05 }, frontLeg: { angle: 0.45, reach: 0.8 }, backLeg: { angle: -0.45, reach: 0.8 } }
        }
        if (move.kind === "circle" || move.kind === "orb") {
          return { ...stance, lean: 0.1, frontArm: { angle: -1.5, reach: 0.7 + ext * 0.4 }, backArm: { angle: -1.6, reach: 0.6 + ext * 0.4 } }
        }
        if (move.kind === "beam") return { ...stance, lean: 0.03, frontArm: { angle: -0.35, reach: 0.65 }, backArm: { angle: -0.2, reach: 0.65 } }
        if (move.kind === "iceSlam") return { ...stance, crouch: f.y <= 0 ? ext : 0, frontArm: { angle: f.y > 0 ? -3 : -0.2, reach: 1 }, backArm: { angle: f.y > 0 ? -3.2 : -0.4, reach: 1 } }
      }
      switch (moveFamily(move)) {
        case "punch":
          return { ...stance, lean: 0.12 + ext * (heavy ? 0.28 : 0.12), crouch: f.crouching ? 1 : 0, frontArm: { angle: -Math.PI / 2 + (1 - ext) * -0.6 + ext * 0.05, reach: 0.55 + ext * 0.75 }, backArm: { angle: -1.4, reach: 0.45 } }
        case "kick":
          return { ...stance, lean: -0.1 * ext, frontLeg: { angle: 0.3 + ext * 1.35, reach: 0.8 + ext * 0.45 }, backLeg: { angle: -0.25, reach: 1 }, frontArm: { angle: -1.4, reach: 0.5 }, backArm: { angle: -2.1, reach: 0.55 } }
        case "low":
          return { ...stance, crouch: 1, frontLeg: { angle: 1.45, reach: 0.5 + ext * 0.9 }, backLeg: { angle: -0.9, reach: 0.6 }, frontArm: { angle: -0.4, reach: 0.5 }, backArm: { angle: -1.0, reach: 0.45 } }
        case "air":
          return { ...stance, lean: 0.25, frontLeg: { angle: 0.9 + ext * 0.6, reach: 0.6 + ext * 0.6 }, backLeg: { angle: -0.9, reach: 0.5 }, frontArm: { angle: -0.9 + ext * 0.8, reach: 0.5 + ext * 0.5 }, backArm: { angle: -2.2, reach: 0.6 } }
        case "dash":
          return { ...stance, lean: 0.55 * ext, frontArm: { angle: -0.2, reach: 0.9 }, backArm: { angle: -2.6, reach: 0.7 }, frontLeg: { angle: 0.9, reach: 1 }, backLeg: { angle: -0.9, reach: 1 } }
        case "projectile":
          return { ...stance, lean: 0.18, frontArm: { angle: -Math.PI / 2 + 0.1, reach: 0.5 + ext * 0.8 }, backArm: { angle: -Math.PI / 2 + 0.1, reach: 0.5 + ext * 0.7 }, frontLeg: { angle: 0.6, reach: 1 }, backLeg: { angle: -0.5, reach: 1 } }
        case "uppercut":
          return { ...stance, lean: -0.15, frontArm: { angle: -Math.PI + 0.15, reach: 0.5 + ext * 0.8 }, backArm: { angle: -0.6, reach: 0.5 }, frontLeg: { angle: 0.9, reach: 0.6 }, backLeg: { angle: -0.3, reach: 0.8 } }
        case "slam":
          return { ...stance, lean: 0.35 * ext, crouch: ext, frontArm: { angle: -Math.PI + 0.3 + ext * 3.2, reach: 0.9 }, backArm: { angle: -Math.PI + 0.1 + ext * 3.0, reach: 0.9 }, frontLeg: { angle: 0.9, reach: 0.7 }, backLeg: { angle: -0.9, reach: 0.7 } }
      }
    }
    // falls through to idle
    default:
      return { ...stance, guard: f.guarding }
  }
}

export function createFightRenderer(canvas: HTMLCanvasElement): FightRenderer {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("The cabinet's screen could not start (no 2D canvas).")
  const sparks: Spark[] = []
  let sprites: SpriteImages = {}
  let stage: StageImages = {}
  let stageDefinition: BattleStage = GAME_ROOM_STAGE
  let effects: EffectImages = {}
  /** Where the fighters' feet are this frame: the art's baseline on the
   * stage, the fallback's line otherwise. */
  let floorY = FALLBACK_FLOOR_Y
  let viewH = VIEW_H
  let viewW = VIEW_W
  let minimumViewH = VIEW_H
  let shake = 0
  let shakeSeed = 0
  /** Slow-following health, for the red trail under the bars. */
  const trail = [1, 1]
  let lastNow = 0
  let comboFlash: { player: 0 | 1; count: number; until: number } | null = null
  let disposed = false
  void loadEffectImages().then(images => { if (!disposed) effects = images })

  const rng = seeded(20260915)
  const buildings: Building[] = []
  let bx = -20
  while (bx < viewW + 40) {
    const w = 34 + Math.floor(rng() * 50)
    const h = 90 + Math.floor(rng() * 190)
    const windows: number[] = []
    const cols = Math.max(1, Math.floor((w - 8) / 12))
    const rows = Math.max(1, Math.floor((h - 12) / 14))
    for (let i = 0; i < cols * rows; i++) windows.push(rng())
    buildings.push({ x: bx, w, h, windows })
    bx += w + 6 + Math.floor(rng() * 10)
  }

  const resize = () => {
    const box = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(box.width * dpr))
    const h = Math.max(1, Math.round(box.height * dpr))
    // Keep at least the full jump/HUD height on ultrawide displays, extending
    // the backdrop sideways instead of cropping heads or stretching bodies.
    viewH = box.width > 0 && box.height > 0 ? Math.max(minimumViewH, VIEW_W * box.height / box.width) : minimumViewH
    viewW = box.width > 0 && box.height > 0 ? viewH * box.width / box.height : VIEW_W
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  const onEvent = (event: FightEvent) => {
    if (event.type === "hit" || event.type === "block") {
      const heavy = Boolean(event.heavy)
      sparks.push({ x: event.x ?? viewW / 2, y: event.y ?? 100, life: 0, max: heavy ? 320 : 220, kind: event.type, heavy, angle: Math.random() * Math.PI })
      if (event.type === "hit") shake = Math.max(shake, heavy ? 14 : 6)
    }
    if (event.type === "ko" || event.type === "timeout") shake = Math.max(shake, 18)
  }

  const px = (x: number) => x + (viewW - STAGE_WIDTH) / 2
  const py = (y: number) => floorY - y

  /** The illustrated room: far wall, tables, floor, each slid by its factor. */
  function drawStage(state: FightState) {
    const offset = stageCameraOffset([state.fighters[0].x, state.fighters[1].x], STAGE_WIDTH)
    ctx!.fillStyle = "#05060f"
    ctx!.fillRect(0, 0, viewW, viewH)
    for (const name of ["far", "tables", "floor"] as const) {
      const image = stage[name]
      const layer = stageDefinition.layers[name]
      if (!image || !layer) continue
      const at = placeLayer(layer, offset, { w: viewW, h: viewH }, name === "far" ? FAR_OVERSCAN : undefined)
      const floorOffset = floorY - stageFloorY(viewH, viewW)
      // A full-scene backdrop must cover both edges even without a separate
      // floor layer, including on tall or ultrawide displays.
      const y = name === "far" ? Math.min(0, Math.max(viewH - at.h, at.y + floorOffset)) : at.y + floorOffset
      ctx!.drawImage(image, at.x, y, at.w, at.h)
    }
  }

  function drawBackdrop(nowMs: number) {
    const sky = ctx!.createLinearGradient(0, 0, 0, floorY)
    sky.addColorStop(0, "#050716")
    sky.addColorStop(0.55, "#131a4a")
    sky.addColorStop(1, "#3a1e5a")
    ctx!.fillStyle = sky
    ctx!.fillRect(0, 0, viewW, viewH)
    // moon
    ctx!.fillStyle = "#f4f0d8"
    ctx!.beginPath()
    ctx!.arc(790, 90, 34, 0, Math.PI * 2)
    ctx!.fill()
    ctx!.fillStyle = "#e5dfc0"
    ctx!.beginPath()
    ctx!.arc(802, 80, 7, 0, Math.PI * 2)
    ctx!.arc(776, 100, 5, 0, Math.PI * 2)
    ctx!.fill()
    // skyline
    for (const b of buildings) {
      const top = floorY - 30 - b.h
      ctx!.fillStyle = "#0b0d24"
      ctx!.fillRect(b.x, top, b.w, b.h + 30)
      const cols = Math.max(1, Math.floor((b.w - 8) / 12))
      b.windows.forEach((v, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const lit = v > 0.45 && (v > 0.5 || Math.floor(nowMs / 900 + v * 40) % 7 !== 0)
        if (!lit) return
        ctx!.fillStyle = v > 0.9 ? "#ffd166" : v > 0.7 ? "#9ec5ff" : "#5c7bd9"
        ctx!.fillRect(b.x + 4 + col * 12, top + 6 + row * 14, 7, 9)
      })
    }
    // floor: trading-floor tiles vanishing toward the skyline
    const floor = ctx!.createLinearGradient(0, floorY - 30, 0, viewH)
    floor.addColorStop(0, "#1d2350")
    floor.addColorStop(1, "#0a0c22")
    ctx!.fillStyle = floor
    ctx!.fillRect(0, floorY - 30, viewW, viewH - floorY + 30)
    ctx!.strokeStyle = "rgba(80, 112, 224, 0.35)"
    ctx!.lineWidth = 1
    for (let x = -200; x < viewW + 200; x += 80) {
      ctx!.beginPath()
      ctx!.moveTo(viewW / 2 + (x - viewW / 2) * 0.55, floorY - 30)
      ctx!.lineTo(x, viewH)
      ctx!.stroke()
    }
    for (const y of [floorY - 30, floorY - 10, floorY + 20, viewH - 8]) {
      ctx!.beginPath()
      ctx!.moveTo(0, y)
      ctx!.lineTo(viewW, y)
      ctx!.stroke()
    }
  }

  function drawShadow(f: Fighter) {
    const w = f.def.width * 1.3
    const fade = Math.max(0.25, 1 - f.y / 400)
    ctx!.fillStyle = `rgba(0,0,0,${0.45 * fade})`
    ctx!.beginPath()
    ctx!.ellipse(px(f.x), py(0) + 6, (w / 2) * fade + 6, 7, 0, 0, Math.PI * 2)
    ctx!.fill()
  }

  function drawHeadPiece(def: CharacterDef, r: number) {
    const p = def.palette
    switch (def.id) {
      case "bull":
        ctx!.fillStyle = p.accent
        for (const s of [-1, 1]) {
          ctx!.beginPath()
          ctx!.moveTo(s * r * 0.6, -r * 0.5)
          ctx!.lineTo(s * r * 1.35, -r * 1.35)
          ctx!.lineTo(s * r * 0.95, -r * 0.2)
          ctx!.closePath()
          ctx!.fill()
        }
        break
      case "bear":
        ctx!.fillStyle = p.body
        for (const s of [-1, 1]) {
          ctx!.beginPath()
          ctx!.arc(s * r * 0.75, -r * 0.75, r * 0.38, 0, Math.PI * 2)
          ctx!.fill()
        }
        break
      case "quant":
        ctx!.fillStyle = p.accent
        ctx!.fillRect(-r * 0.95, -r * 0.25, r * 1.9, r * 0.45)
        ctx!.fillStyle = "#071a1f"
        ctx!.fillRect(-r * 0.8, -r * 0.15, r * 1.6, r * 0.25)
        break
      case "whale":
        ctx!.fillStyle = p.accent
        ctx!.beginPath()
        ctx!.moveTo(-r * 0.2, -r * 0.7)
        ctx!.lineTo(r * 0.3, -r * 1.7)
        ctx!.lineTo(r * 0.7, -r * 0.55)
        ctx!.closePath()
        ctx!.fill()
        break
    }
  }

  function limb(ox: number, oy: number, angle: number, length: number, thickness: number, color: string, facing: number) {
    // Two segments with a slight bend at the joint, so a limb reads as a limb.
    const a = angle
    const midX = ox + Math.cos(a) * length * 0.5 * facing
    const midY = oy + Math.sin(a) * length * 0.5
    const endX = ox + Math.cos(a) * length * facing
    const endY = oy + Math.sin(a) * length
    ctx!.strokeStyle = color
    ctx!.lineWidth = thickness
    ctx!.lineCap = "round"
    ctx!.lineJoin = "round"
    ctx!.beginPath()
    ctx!.moveTo(ox, oy)
    ctx!.lineTo(midX + Math.sin(a) * 3 * facing, midY - Math.cos(a) * 3)
    ctx!.lineTo(endX, endY)
    ctx!.stroke()
    return [endX, endY] as const
  }

  /** The fighter from its atlas: the frame sprite-frames picks, anchored at
   * the feet, mirrored for a left-facing fighter, laid flat when down. */
  function drawSpriteFighter(f: Fighter, image: HTMLImageElement, nowMs: number, flash: boolean) {
    const atlas = FIGHTER_ATLASES[f.id]!
    const pick = pickSpriteFrame(f, nowMs)
    const frame = atlas.poses[pick.pose]?.[pick.index] ?? atlas.poses.idle[0]!
    // One scale per fighter, from the idle frame, so every pose keeps the
    // art's proportions and a standing fighter is exactly def.height tall.
    const s = f.def.height / atlas.poses.idle[0]!.h
    ctx!.save()
    ctx!.translate(px(f.x), py(f.y))
    ctx!.scale(f.facing, 1)
    if (pick.lying) {
      // On the back, head away from the opponent, body resting on the floor.
      ctx!.translate(0, -frame.ax * s)
      ctx!.rotate(-Math.PI / 2)
    }
    if (flash || pick.hit) ctx!.filter = "brightness(1.9) saturate(0.4)"
    const anchorX = f.state === "trapped" ? frame.w / 2 : frame.ax
    ctx!.drawImage(image, frame.x, frame.y, frame.w, frame.h, -anchorX * s, -frame.ay * s, frame.w * s, frame.h * s)
    ctx!.filter = "none"
    ctx!.restore()
  }

  function drawFighter(f: Fighter, nowMs: number, flash: boolean) {
    const def = f.def
    const p = def.palette
    const facing = f.facing
    const x = px(f.x)
    const feetY = py(f.y)
    drawShadow(f)
    const image = sprites[f.id]
    if (image && FIGHTER_ATLASES[f.id]) {
      drawSpriteFighter(f, image, nowMs, flash)
      ctx!.save()
      ctx!.translate(x, feetY)
      if (f.guarding && f.state !== "attack" && f.y <= 0) {
        ctx!.strokeStyle = "rgba(143, 211, 255, 0.85)"
        ctx!.lineWidth = 3
        ctx!.beginPath()
        const cy = -(f.crouching ? def.crouchHeight : def.height) * 0.5
        ctx!.arc(def.width * 0.55 * facing, cy, def.height * 0.36, -Math.PI / 2 - 0.3 * facing, Math.PI / 2 + 0.3 * facing, facing === -1)
        ctx!.stroke()
      }
      if (f.invulnMs > 0 && f.state !== "ko") {
        ctx!.strokeStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(nowMs / 40)})`
        ctx!.lineWidth = 2
        ctx!.strokeRect(-def.width / 2, -def.height, def.width, def.height)
      }
      ctx!.restore()
      return
    }
    const pose = poseFor(f, nowMs)
    const scale = def.height / 150
    ctx!.save()
    ctx!.translate(x, feetY)
    if (pose.down) {
      // Flat on the floor, head away from the opponent.
      ctx!.rotate((-Math.PI / 2) * facing)
      ctx!.translate(0, -def.width * 0.35)
    }
    const crouch = 1 - pose.crouch * 0.33
    const legLen = 52 * scale * crouch
    const torsoH = 52 * scale * crouch
    const torsoW = def.width * 0.62
    const hipY = -legLen
    const shoulderY = hipY - torsoH
    const headR = 15 * scale
    const skin = flash ? "#ffffff" : p.skin
    const body = flash ? "#ffffff" : p.body
    const trim = flash ? "#dddddd" : p.trim

    // back limbs first
    limb(-torsoW * 0.15 * facing, hipY, Math.PI / 2 + pose.backLeg.angle * facing, legLen * pose.backLeg.reach, 12 * scale, trim, 1)
    const backShoulderX = -torsoW * 0.3 * facing
    limb(backShoulderX, shoulderY + 8, Math.PI / 2 + pose.backArm.angle * facing, 46 * scale * pose.backArm.reach, 10 * scale, trim, 1)

    // torso
    ctx!.save()
    ctx!.translate(0, hipY)
    ctx!.rotate(pose.lean * facing)
    ctx!.fillStyle = body
    ctx!.beginPath()
    ctx!.roundRect(-torsoW / 2, -torsoH, torsoW, torsoH + 8, 8)
    ctx!.fill()
    ctx!.fillStyle = trim
    ctx!.fillRect(-torsoW / 2, -torsoH * 0.35, torsoW, 6)
    // head
    ctx!.translate(torsoW * 0.1 * facing, -torsoH - headR * 0.9)
    ctx!.fillStyle = skin
    ctx!.beginPath()
    ctx!.arc(0, 0, headR, 0, Math.PI * 2)
    ctx!.fill()
    drawHeadPiece(def, headR)
    // eye
    ctx!.fillStyle = "#101020"
    ctx!.fillRect(headR * 0.25 * facing - 2, -3, 4, 5)
    ctx!.restore()

    // front limbs
    limb(torsoW * 0.15 * facing, hipY, Math.PI / 2 + pose.frontLeg.angle * facing, legLen * pose.frontLeg.reach, 13 * scale, body, 1)
    const frontShoulderX = torsoW * 0.3 * facing
    const [hx, hy] = limb(frontShoulderX, shoulderY + 6, Math.PI / 2 + pose.frontArm.angle * facing, 46 * scale * pose.frontArm.reach, 11 * scale, body, 1)
    // fist
    ctx!.fillStyle = skin
    ctx!.beginPath()
    ctx!.arc(hx, hy, 7 * scale, 0, Math.PI * 2)
    ctx!.fill()
    if (pose.guard && !pose.down) {
      ctx!.strokeStyle = "rgba(143, 211, 255, 0.85)"
      ctx!.lineWidth = 3
      ctx!.beginPath()
      ctx!.arc(torsoW * 0.55 * facing, shoulderY + torsoH * 0.45, torsoH * 0.75, -Math.PI / 2 - 0.3 * facing, Math.PI / 2 + 0.3 * facing, facing === -1)
      ctx!.stroke()
    }
    if (f.invulnMs > 0 && f.state !== "ko") {
      ctx!.strokeStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(nowMs / 40)})`
      ctx!.lineWidth = 2
      ctx!.strokeRect(-def.width / 2, -def.height, def.width, def.height)
    }
    ctx!.restore()
  }

  function drawProjectiles(state: FightState, nowMs: number) {
    for (const proj of state.projectiles) {
      const owner = state.fighters[proj.owner]
      const glow = owner.def.palette.accent
      const cx = px(proj.x)
      const cy = py(proj.y)
      const image = sprites[owner.id]
      const art = FIGHTER_ATLASES[owner.id]?.projectile
      if (owner.id === "bernard") {
        const direction = Math.sign(proj.vx) || 1
        const streak = proj.w * 1.55
        ctx!.save()
        ctx!.translate(cx, cy)
        ctx!.scale(direction, 1)
        ctx!.rotate(-Math.atan((proj.vy ?? 0) / Math.abs(proj.vx || 1)))
        const gradient = ctx!.createLinearGradient(-streak, 0, streak, 0)
        gradient.addColorStop(0, "rgba(255, 25, 48, 0)")
        gradient.addColorStop(0.28, "rgba(255, 42, 64, 0.75)")
        gradient.addColorStop(0.68, "#fff4f4")
        gradient.addColorStop(1, "#ff1834")
        ctx!.globalCompositeOperation = "lighter"
        ctx!.shadowColor = "#ff172f"
        ctx!.shadowBlur = 24
        ctx!.fillStyle = gradient
        ctx!.fillRect(-streak, -proj.h * 0.24, streak * 2, proj.h * 0.48)
        ctx!.shadowBlur = 7
        ctx!.fillStyle = "#ffffff"
        ctx!.fillRect(-proj.w * 0.3, -proj.h * 0.08, proj.w * 1.15, proj.h * 0.16)
        ctx!.restore()
        continue
      }
      if (image && art) {
        // The fireball lifted off the ranged release frame, leading with the
        // ball (the art travels right), sized a little over the hitbox.
        const s = (proj.h * 1.7) / art.h
        ctx!.save()
        ctx!.translate(cx, cy)
        ctx!.scale(Math.sign(proj.vx) || 1, 1)
        ctx!.shadowColor = glow
        ctx!.shadowBlur = 22
        ctx!.drawImage(image, art.x, art.y, art.w, art.h, -art.w * s * 0.6, -art.h * s / 2, art.w * s, art.h * s)
        ctx!.restore()
        continue
      }
      ctx!.save()
      ctx!.shadowColor = glow
      ctx!.shadowBlur = 18
      ctx!.fillStyle = glow
      // a green candle with a wick, streaking along
      ctx!.fillRect(cx - proj.w / 4, cy - proj.h / 2, proj.w / 2, proj.h)
      ctx!.fillRect(cx - 2, cy - proj.h / 2 - 8, 4, proj.h + 16)
      ctx!.globalAlpha = 0.35
      for (let i = 1; i <= 3; i++) ctx!.fillRect(cx - proj.w / 4 - Math.sign(proj.vx) * i * 14, cy - proj.h / 2 + i * 3, proj.w / 2, proj.h - i * 6)
      ctx!.restore()
      void nowMs
    }
  }

  function drawSparks(dtMs: number) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!
      s.life += dtMs
      if (s.life >= s.max) {
        sparks.splice(i, 1)
        continue
      }
      const t = s.life / s.max
      const cx = px(s.x)
      const cy = py(s.y)
      ctx!.save()
      ctx!.translate(cx, cy)
      ctx!.rotate(s.angle)
      ctx!.globalAlpha = 1 - t
      if (s.kind === "block") {
        ctx!.strokeStyle = "#8fd3ff"
        ctx!.lineWidth = 4
        ctx!.beginPath()
        ctx!.arc(0, 0, 10 + t * 26, 0, Math.PI * 2)
        ctx!.stroke()
      } else {
        const rays = s.heavy ? 10 : 6
        const r = (s.heavy ? 30 : 18) * (0.6 + t)
        ctx!.fillStyle = s.heavy ? "#ffd166" : "#ffffff"
        ctx!.beginPath()
        for (let k = 0; k < rays * 2; k++) {
          const a = (k / (rays * 2)) * Math.PI * 2
          const rr = k % 2 === 0 ? r : r * 0.45
          ctx!.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        ctx!.closePath()
        ctx!.fill()
      }
      ctx!.restore()
    }
  }

  function text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", outline = true) {
    ctx!.font = `${size}px ${FONT}`
    ctx!.textAlign = align
    ctx!.textBaseline = "middle"
    if (outline) {
      ctx!.lineWidth = Math.max(2, size / 5)
      ctx!.strokeStyle = "#000"
      ctx!.lineJoin = "round"
      ctx!.strokeText(str, x, y)
    }
    ctx!.fillStyle = color
    ctx!.fillText(str, x, y)
  }

  function drawHud(state: FightState, nowMs: number, dtMs: number, labels: [string, string]) {
    const barW = (viewW - 160) / 2
    const barH = 22
    const top = 26
    const centre = viewW / 2
    for (const slot of [0, 1] as const) {
      const f = state.fighters[slot]
      const ratio = f.health / f.def.maxHealth
      const target = ratio
      const current = trail[slot]!
      trail[slot] = current > target ? Math.max(target, current - dtMs / 900) : target
      const left = slot === 0 ? centre - 40 - barW : centre + 40
      ctx!.fillStyle = "#000"
      ctx!.fillRect(left - 3, top - 3, barW + 6, barH + 6)
      ctx!.fillStyle = "#3a0d16"
      ctx!.fillRect(left, top, barW, barH)
      // the remaining bar is anchored at the OUTER edge; damage eats in from the centre
      const drawSeg = (amount: number, color: string) => {
        const w = barW * amount
        ctx!.fillStyle = color
        ctx!.fillRect(slot === 0 ? left : left + barW - w, top, w, barH)
      }
      drawSeg(trail[slot]!, "#d03a3a")
      drawSeg(ratio, ratio > 0.3 ? "#ffd166" : "#ff5d5d")
      ctx!.fillStyle = "rgba(255,255,255,0.25)"
      ctx!.fillRect(left, top, barW, 4)
      const name = f.def.name
      text(`${labels[slot]}  ${name}`, slot === 0 ? left + 4 : left + barW - 4, top + barH + 18, 11, "#fff", slot === 0 ? "left" : "right")
      const energyY = top + barH + 35
      const capacity = f.def.energyBars * ENERGY_PER_BAR
      const energy = Math.max(0, Math.min(capacity, f.energy))
      const cost = f.def.moves.special.energyCost ?? 0
      const ready = canCastSpecial(state, slot, f.def.moves.special)
      ctx!.fillStyle = "#050918"
      ctx!.fillRect(left - 2, energyY - 2, barW + 4, 14)
      const gap = 4
      const segmentW = (barW - gap * (f.def.energyBars - 1)) / f.def.energyBars
      for (let bar = 0; bar < f.def.energyBars; bar++) {
        const offset = bar * (segmentW + gap)
        const segmentLeft = slot === 0 ? left + offset : left + barW - offset - segmentW
        ctx!.fillStyle = "#152840"
        ctx!.fillRect(segmentLeft, energyY, segmentW, 10)
        const filledW = segmentW * Math.max(0, Math.min(1, energy / ENERGY_PER_BAR - bar))
        ctx!.fillStyle = ready ? "#55e4ff" : "#347caf"
        ctx!.fillRect(slot === 0 ? segmentLeft : segmentLeft + segmentW - filledW, energyY, filledW, 10)
      }
      const costOffset = segmentW * cost / ENERGY_PER_BAR + gap * Math.max(0, Math.ceil(cost / ENERGY_PER_BAR) - 1)
      const thresholdX = slot === 0 ? left + costOffset : left + barW - costOffset
      ctx!.fillStyle = "#fff"
      ctx!.fillRect(thresholdX - 1, energyY - 1, 2, 12)
      text(`ENERGY ${Math.floor(energy)}/${capacity}${ready ? " · READY" : ""}`, slot === 0 ? left : left + barW, energyY + 22, 8, ready ? "#96efff" : "#a3b9ce", slot === 0 ? "left" : "right")
      if (f.state === "trapped") {
        const orb = state.orbs.find(orb => orb.captured === slot)
        text(`TRAPPED ${((orb?.remainingMs ?? 0) / 1000).toFixed(1)}s`, slot === 0 ? left : left + barW, energyY + 39, 8, "#6cd7ff", slot === 0 ? "left" : "right")
      } else if (f.def.moves.special.kind === "orb") {
        const count = state.orbs.filter(orb => orb.owner === slot).length
        text(`ORBS ${count}/${MAX_WATER_ORBS}`, slot === 0 ? left : left + barW, energyY + 39, 8, "#6cd7ff", slot === 0 ? "left" : "right")
      }
      // round pips
      for (let i = 0; i < ROUNDS_TO_WIN; i++) {
        const won = state.wins[slot] > i
        const cx = slot === 0 ? left + barW - 14 - i * 22 : left + 14 + i * 22
        ctx!.fillStyle = won ? "#bfff5e" : "#1b2450"
        ctx!.strokeStyle = "#000"
        ctx!.lineWidth = 2
        ctx!.beginPath()
        ctx!.arc(cx, top + barH + 18, 7, 0, Math.PI * 2)
        ctx!.fill()
        ctx!.stroke()
      }
    }
    // clock
    ctx!.fillStyle = "#000"
    ctx!.fillRect(centre - 34, top - 6, 68, 44)
    const seconds = timerSeconds(state)
    text(String(seconds).padStart(2, "0"), centre, top + 16, 24, seconds <= 10 ? "#ff5d5d" : "#fff", "center", false)

    // combo counter
    for (const slot of [0, 1] as const) {
      const f = state.fighters[slot]
      if (f.combo >= 2 && (!comboFlash || comboFlash.player !== slot || comboFlash.count !== f.combo)) comboFlash = { player: slot, count: f.combo, until: nowMs + 900 }
    }
    if (comboFlash && nowMs < comboFlash.until) {
      const x = comboFlash.player === 0 ? 60 : viewW - 60
      text(`${comboFlash.count} HIT`, x, 120, 20, "#ffd166", comboFlash.player === 0 ? "left" : "right")
      text("COMBO", x, 146, 12, "#fff", comboFlash.player === 0 ? "left" : "right")
    }

    // banners
    const banner = (line: string, sub?: string, color = "#ffd166") => {
      text(line, centre, viewH / 2 - 30, 40, color)
      if (sub) text(sub, centre, viewH / 2 + 22, 14, "#fff")
    }
    if (state.phase === "intro") {
      if (state.phaseMs < 1200) banner(`ROUND ${state.round}`)
      else banner("FIGHT!", undefined, "#ff5d5d")
    } else if (state.phase === "ko") {
      const timedOut = state.timerMs <= 0 && state.fighters.every((f) => f.state !== "ko")
      banner(timedOut ? "TIME OVER" : "K.O.", state.roundWinner === null ? "DRAW" : `${labels[state.roundWinner]} TAKES THE ROUND`)
    } else if (state.phase === "matchover") {
      const winner = state.matchWinner
      banner(winner === null ? "DRAW GAME" : `${labels[winner]} WINS`, winner === null ? undefined : state.fighters[winner].def.tagline.toUpperCase())
    }
  }

  return {
    render(state, nowMs, labels) {
      if (disposed) return
      minimumViewH = VIEW_H
      for (const f of state.fighters) {
        if (f.state !== "attack" || f.move?.kind !== "breakingNews") continue
        // Frame the largest overhead sphere from the start of the cast, so
        // the camera holds still while it grows. The floor stays at 86% of
        // the viewport, and the other fighters keep their usual framing.
        const peak = breakingNewsGeometry({ ...f, y: BREAKING_NEWS_HOVER_HEIGHT, moveMs: f.move.startup - 0.001 })
        minimumViewH = Math.max(minimumViewH, (peak.ballY + peak.radius * 1.16 + 130) / 0.86)
      }
      resize()
      const dtMs = lastNow ? Math.min(100, nowMs - lastNow) : 16
      lastNow = nowMs
      const sx = canvas.width / viewW
      const sy = canvas.height / viewH
      ctx.setTransform(sx, 0, 0, sy, 0, 0)
      ctx.imageSmoothingEnabled = false
      let ox = 0, oy = 0
      if (shake > 0) {
        shakeSeed += 1
        ox = Math.sin(shakeSeed * 12.9898) * shake
        oy = Math.cos(shakeSeed * 78.233) * shake * 0.6
        shake = Math.max(0, shake - dtMs / 18)
      }
      ctx.save()
      ctx.translate(ox, oy)
      floorY = viewH * 0.86
      if (stage.far) drawStage(state)
      else drawBackdrop(nowMs)
      drawSpecialEffects(ctx, state, nowMs, px, py, "back", effects)
      // The fighter that was hit most recently draws on top.
      const order: (0 | 1)[] = state.fighters[0].state === "hitstun" || state.fighters[0].state === "knockdown" ? [1, 0] : [0, 1]
      for (const slot of order) {
        const f = state.fighters[slot]
        const flash = (f.state === "hitstun" && f.stateMs < 80) || (state.hitstop > 0 && f.state === "hitstun")
        drawFighter(f, nowMs, flash)
      }
      drawProjectiles(state, nowMs)
      drawSpecialEffects(ctx, state, nowMs, px, py, "front", effects)
      drawSparks(dtMs)
      ctx.restore()
      drawHud(state, nowMs, dtMs, labels)
    },
    setSprites(images) {
      sprites = images
    },
    setStage(images, definition = GAME_ROOM_STAGE) {
      stage = images
      stageDefinition = definition
    },
    setEffects(images) {
      effects = images
    },
    onEvent,
    resize,
    dispose() {
      disposed = true
      sparks.length = 0
    },
  }
}
