/** Bounded game rules: random key carrier per run, deterministic simulation updates. */
export const CELL = 3
export const MAIN_COLUMNS = 15
const HALLS = [
  '###############',
  '#.............#',
  '#....#....#...#',
  '#....#....#...#',
  '#.####.####.#.#',
  '#...........#.#',
  '###.###.###.#.#',
  '#.....#.......#',
  '#.###.#.####..#',
  '#...#.........#',
  '#...#####.##..#',
  '#.............#',
  '###############',
] as const
export const LEVEL = HALLS.map((row, z) => (z === 7 ? `${row.slice(0, -1)}D` : row) + (z >= 5 && z <= 9 ? z === 7 ? '..T..#' : '.....#' : '######'))
export const NEWSROOM = { door: { x: 43.5, z: 22.5 }, bernard: { x: 55.5, z: 22.5 }, minX: 45, maxX: 60, minZ: 15, maxZ: 30 } as const
export const ENTRANCE = { x: 4.5, z: 4.5 }
export const EXIT = { x: 40.5, z: 34.5 }
export const EXIT_REACH = 1.25
// The opening halls above the first dividing wall are a safe place to learn controls.
const START_AREA_END_Z = 4 * CELL
export type Body = { x: number; z: number }
export type Enemy = Body & { id: number; kind: 'puff' | 'hopper' | 'prism'; hp: number; cooldown: number; phase: number; chargeX: number; chargeZ: number }
const SPAWNS: readonly [Enemy['kind'], number, number][] = [
  ['puff', 6, 5], ['hopper', 10, 7], ['prism', 9, 9],
  ['puff', 3, 5], ['prism', 8, 5], ['hopper', 13, 5],
  ['hopper', 3, 7], ['puff', 9, 7], ['prism', 12, 9],
  ['puff', 2, 10], ['hopper', 8, 11], ['prism', 12, 11],
]
export const ENEMY_COUNT = SPAWNS.length
export type GameEvent = { type: 'pop'; x: number; z: number; kind: Enemy['kind'] } | { type: 'shot'; x: number; y: number; z: number } | { type: 'hurt' | 'newsroom-open' | 'bernard-rage' | 'bernard-step' | 'bernard-hit' }
export type Game = {
  player: Body & { yaw: number; pitch: number; health: number; invulnerable: number }
  enemies: Enemy[]
  projectiles: (Body & { dx: number; dz: number; life: number })[]
  events: GameEvent[]
  shotCooldown: number
  time: number
  popped: number
  status: 'playing' | 'dead' | 'won' | 'exited'
  deathCause?: 'bernard'
  newsroom: { key: { carrierId: number; position: Body | null; collected: boolean }; notice: 'key-found' | 'key-needed' | null; open: boolean; warningPending: boolean; bernard: Body & { enraged: boolean; rageTime: number; path: Body[]; repathIn: number; stepIn: number } }
}
export type Input = { forward: number; strafe: number; fire: boolean; interact: boolean }
export function createGame(): Game {
  return {
    player: { ...ENTRANCE, yaw: Math.PI / 2, pitch: 0, health: 100, invulnerable: 0 },
    enemies: SPAWNS.map(([kind, x, z], id) => ({ id, kind, x: (x + .5) * CELL, z: (z + .5) * CELL, hp: kind === 'hopper' ? 3 : 2, cooldown: .8 + id * .13, phase: 0, chargeX: 0, chargeZ: 0 })),
    projectiles: [], events: [], shotCooldown: 0, time: 0, popped: 0, status: 'playing',
    newsroom: { key: { carrierId: Math.floor(Math.random() * ENEMY_COUNT), position: null, collected: false }, notice: null, open: false, warningPending: false, bernard: { ...NEWSROOM.bernard, enraged: false, rageTime: 0, path: [], repathIn: 0, stepIn: 0 } },
  }
}
function wall(x: number, z: number, newsroomOpen = false, rayHeight?: number) {
  const cell = LEVEL[Math.floor(z / CELL)]?.[Math.floor(x / CELL)]
  if (cell === 'T' && rayHeight !== undefined) return rayHeight < 1.1
  return cell !== '.' && !(cell === 'D' && newsroomOpen)
}
export function canStand(x: number, z: number, radius = .27, newsroomOpen = false): boolean {
  return !wall(x - radius, z - radius, newsroomOpen) && !wall(x + radius, z - radius, newsroomOpen) && !wall(x - radius, z + radius, newsroomOpen) && !wall(x + radius, z + radius, newsroomOpen)
}
export function moveBody(body: Body, dx: number, dz: number, radius = .27, newsroomOpen = false) {
  // Substeps prevent tunnelling even when a caller supplies a large displacement.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .15))
  for (let i = 0; i < steps; i++) {
    if (canStand(body.x + dx / steps, body.z, radius, newsroomOpen)) body.x += dx / steps
    if (canStand(body.x, body.z + dz / steps, radius, newsroomOpen)) body.z += dz / steps
  }
}
function wallDistance(x: number, z: number, dx: number, dz: number, max: number, newsroomOpen = false, slope = 0) {
  for (let distance = 0; distance < max; distance += .075) if (wall(x + dx * distance, z + dz * distance, newsroomOpen, 1.5 + slope * distance)) return distance
  return max
}
function moveEnemy(enemy: Enemy, dx: number, dz: number) {
  // Keep the whole collision body below the safe halls, including a hopper's dash.
  const next = { x: enemy.x, z: enemy.z }
  moveBody(next, dx, dz, .4)
  if (next.z >= START_AREA_END_Z + .4) Object.assign(enemy, next)
  else moveBody(enemy, dx, 0, .4)
}
function visible(a: Body, b: Body, newsroomOpen = false) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z)
  return wallDistance(a.x, a.z, (b.x - a.x) / distance, (b.z - a.z) / distance, distance, newsroomOpen) >= distance
}
export function fireLaser(game: Game) {
  if (game.status !== 'playing' || game.newsroom.warningPending || game.newsroom.notice || game.shotCooldown > 0) return
  game.shotCooldown = .19
  const { player } = game
  const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw)
  const slope = Math.tan(player.pitch)
  // Distances are horizontal; intersect the 0m floor / 3m ceiling before targets.
  const verticalRange = slope > 0 ? 1.5 / slope : slope < 0 ? -1.5 / slope : Infinity
  let distance = wallDistance(player.x, player.z, dx, dz, Math.min(30, verticalRange), game.newsroom.open, slope)
  let hit: Enemy | undefined
  for (const enemy of game.enemies) {
    const ex = enemy.x - player.x, ez = enemy.z - player.z
    const along = ex * dx + ez * dz
    const sideways = Math.abs(ex * dz - ez * dx)
    const height = 1.5 + slope * along
    if (along > 0 && along < distance && sideways < .65 && height > .2 && height < 2.0) { hit = enemy; distance = along }
  }
  const bernard = game.newsroom.bernard
  if (game.newsroom.open) {
    const ex = bernard.x - player.x, ez = bernard.z - player.z
    const along = ex * dx + ez * dz, sideways = Math.abs(ex * dz - ez * dx), height = 1.5 + slope * along
    if (along > 0 && along < distance && sideways < bernardHitWidth(bernard, height)) {
      distance = along; hit = undefined
      if (!bernard.enraged) { bernard.enraged = true; game.events.push({ type: 'bernard-rage' }) }
    }
  }
  game.events.push({ type: 'shot', x: player.x + dx * distance, y: 1.5 + slope * distance, z: player.z + dz * distance })
  if (hit && --hit.hp <= 0) {
    game.events.push({ type: 'pop', x: hit.x, z: hit.z, kind: hit.kind })
    game.enemies = game.enemies.filter(enemy => enemy !== hit)
    const key = game.newsroom.key
    if (hit.id === key.carrierId && !key.collected && !key.position) key.position = { x: hit.x, z: hit.z }
    game.popped++
    player.health = Math.min(100, player.health + 4)
  }
}
/** Match the model's seated-to-standing pose, including its narrower head. */
export function bernardStandProgress(rageTime: number): number {
  const t = Math.max(0, Math.min(1, rageTime / .7))
  return t * t * (3 - 2 * t)
}
function bernardHitWidth(bernard: Game['newsroom']['bernard'], height: number): number {
  const stand = bernard.enraged ? bernardStandProgress(bernard.rageTime) : 0
  const hips = .8 + .255 * stand, headY = (hips + 1.09) * .85
  // Elliptical head cross-section prevents shots through empty air beside it.
  if (height > (hips + .8) * .85) {
    const normalized = (height - headY) / .3
    return Math.abs(normalized) < 1 ? .255 * Math.sqrt(1 - normalized ** 2) : 0
  }
  if (height > hips * .85) return .36 // Jacket / bent arms.
  // The separated legs are narrower than the jacket, especially when seated.
  return height > .24 * (1 - stand) + .08 * stand ? .22 : 0
}
function hurt(game: Game, amount: number) {
  if (game.player.z < START_AREA_END_Z || game.player.invulnerable > 0) return
  game.player.health = Math.max(0, game.player.health - amount)
  game.player.invulnerable = .85
  game.events.push({ type: 'hurt' })
  if (game.player.health <= 0) game.status = 'dead'
}
export function stepGame(game: Game, input: Input, elapsed: number) {
  if (game.status !== 'playing' || game.newsroom.warningPending || game.newsroom.notice) return
  const dt = Math.min(.05, Math.max(0, elapsed))
  const p = game.player
  game.time += dt
  p.invulnerable = Math.max(0, p.invulnerable - dt)
  game.shotCooldown = Math.max(0, game.shotCooldown - dt)
  const scale = 4.3 * dt / Math.max(1, Math.hypot(input.forward, input.strafe))
  moveBody(p, (Math.sin(p.yaw) * input.forward - Math.cos(p.yaw) * input.strafe) * scale, (Math.cos(p.yaw) * input.forward + Math.sin(p.yaw) * input.strafe) * scale, .27, game.newsroom.open)
  const key = game.newsroom.key
  if (key.position && !key.collected && Math.hypot(p.x - key.position.x, p.z - key.position.z) < 1 && visible(p, key.position, game.newsroom.open)) {
    key.collected = true; key.position = null; game.newsroom.notice = 'key-found'; return
  }
  if (input.interact && canInspectNewsroom(game)) {
    if (!key.collected) { game.newsroom.notice = 'key-needed'; return }
    game.newsroom.open = true; game.newsroom.warningPending = true
    game.events.push({ type: 'newsroom-open' }); return
  }
  if (input.interact && Math.hypot(p.x - ENTRANCE.x, p.z - ENTRANCE.z) < 2.1) { game.status = 'exited'; return }
  if (game.enemies.length === 0 && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) < EXIT_REACH) { game.status = 'won'; return }
  if (input.fire) fireLaser(game)
  stepBernard(game, dt)
  if (game.player.health <= 0) return
  for (const enemy of game.enemies) {
    const distance = Math.hypot(p.x - enemy.x, p.z - enemy.z)
    const dx = (p.x - enemy.x) / Math.max(.01, distance), dz = (p.z - enemy.z) / Math.max(.01, distance)
    enemy.cooldown -= dt
    if (p.z >= START_AREA_END_Z && distance < 13 && visible(enemy, p, game.newsroom.open)) {
      if (enemy.kind === 'puff') moveEnemy(enemy, dx * dt * 1.05, dz * dt * 1.05)
      else if (enemy.kind === 'prism') {
        if (distance < 4) moveEnemy(enemy, -dx * dt * .65, -dz * dt * .65)
        if (enemy.cooldown <= 0 && game.projectiles.length < 24) {
          game.projectiles.push({ x: enemy.x, z: enemy.z, dx: dx * 3.2, dz: dz * 3.2, life: 5 })
          enemy.cooldown = 2.1
        }
      } else if (enemy.phase <= 0 && enemy.cooldown <= 0) {
        enemy.phase = 1.15; enemy.chargeX = dx; enemy.chargeZ = dz; enemy.cooldown = 2.4
      }
    }
    if (enemy.kind === 'hopper' && enemy.phase > 0) {
      enemy.phase = Math.max(0, enemy.phase - dt)
      if (enemy.phase < .55) moveEnemy(enemy, enemy.chargeX * dt * 6, enemy.chargeZ * dt * 6)
    }
    if (Math.hypot(p.x - enemy.x, p.z - enemy.z) < .95) hurt(game, enemy.kind === 'hopper' ? 18 : 10)
    if (p.health <= 0) return
  }
  game.projectiles = game.projectiles.filter(projectile => {
    projectile.x += projectile.dx * dt; projectile.z += projectile.dz * dt; projectile.life -= dt
    if (projectile.z < START_AREA_END_Z || projectile.life <= 0 || !canStand(projectile.x, projectile.z, .12, game.newsroom.open)) return false
    if (Math.hypot(projectile.x - p.x, projectile.z - p.z) < .5) { hurt(game, 12); return false }
    return true
  })
}

export function canInspectNewsroom(game: Game): boolean {
  if (game.newsroom.open || game.status !== 'playing') return false
  const dx = NEWSROOM.door.x - game.player.x, dz = NEWSROOM.door.z - game.player.z
  const distance = Math.hypot(dx, dz)
  return distance < 2.5 && (dx * Math.sin(game.player.yaw) + dz * Math.cos(game.player.yaw)) / Math.max(.01, distance) > .7
}

/** One small breadth-first search, at most four times a second, for one pursuer. */
function pursuitPath(from: Body, target: Body): Body[] {
  const width = LEVEL[0]!.length, total = width * LEVEL.length
  const start = Math.floor(from.z / CELL) * width + Math.floor(from.x / CELL)
  const goal = Math.floor(target.z / CELL) * width + Math.floor(target.x / CELL)
  if (start === goal) return []
  const previous = new Int16Array(total).fill(-1), queue = [start]
  previous[start] = start
  for (let i = 0; i < queue.length && previous[goal] === -1; i++) {
    const cell = queue[i]!, x = cell % width, z = Math.floor(cell / width)
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx! < 0 || nx! >= width || nz! < 0 || nz! >= LEVEL.length) continue
      const next = nz! * width + nx!
      if (previous[next] !== -1 || !canStand((nx! + .5) * CELL, (nz! + .5) * CELL, .4, true)) continue
      previous[next] = cell; queue.push(next)
    }
  }
  if (previous[goal] === -1) return []
  const path: Body[] = []
  for (let cell = goal; cell !== start; cell = previous[cell]!) path.push({ x: (cell % width + .5) * CELL, z: (Math.floor(cell / width) + .5) * CELL })
  return path.reverse()
}

function stepBernard(game: Game, dt: number) {
  const b = game.newsroom.bernard
  if (!b.enraged) return
  b.rageTime += dt
  if (b.rageTime < .8) return // Give the red-eye / stand-up cue a readable beat.
  b.repathIn -= dt
  if (b.repathIn <= 0) { b.path = pursuitPath(b, game.player); b.repathIn = .25 }
  while (b.path[0] && Math.hypot(b.path[0].x - b.x, b.path[0].z - b.z) < .12) b.path.shift()
  const target = b.path[0] ?? game.player
  const dx = target.x - b.x, dz = target.z - b.z, distance = Math.hypot(dx, dz)
  const speed = Math.min(distance, 6.2 * dt) / Math.max(.001, distance)
  moveBody(b, dx * speed, dz * speed, .4, true)
  b.stepIn -= dt
  if (b.stepIn <= 0 && Math.hypot(b.x - game.player.x, b.z - game.player.z) < 14) { b.stepIn = .42; game.events.push({ type: 'bernard-step' }) }
  if (Math.hypot(b.x - game.player.x, b.z - game.player.z) < .85 && visible(b, game.player, true)) {
    game.player.health = 0; game.status = 'dead'; game.deathCause = 'bernard'
    game.events.push({ type: 'bernard-hit' })
  }
}
