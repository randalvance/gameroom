import { describe, expect, it } from 'vitest'
import { createGame, stepGame, fireLaser, moveBody, canStand, ENTRANCE, EXIT, LEVEL, CELL, type Enemy } from './simulation'

const idle = { forward: 0, strafe: 0, fire: false, interact: false }
function enemy(kind: Enemy['kind'], x: number, z: number): Enemy {
  return { id: 99, kind, x, z, hp: kind === 'hopper' ? 3 : 2, cooldown: 0, phase: 0, chargeX: 0, chargeZ: 0 }
}

describe('Backrooms simulation', () => {
  it('keeps the opening halls empty while players learn the controls', () => {
    const game = createGame()
    expect(game.enemies).toHaveLength(12)
    expect(game.enemies.every(enemy => enemy.z >= 4 * CELL && canStand(enemy.x, enemy.z, .4))).toBe(true)
    for (let i = 0; i < 1200; i++) stepGame(game, idle, .05)
    expect(game.player.health).toBe(100)
    expect(game.enemies.every(enemy => enemy.z >= 4 * CELL)).toBe(true)
  })
  it('keeps chasing and dashing enemies outside the starting halls', () => {
    for (const kind of ['puff', 'hopper'] as const) {
      const game = createGame()
      game.player.x = 19.5; game.player.z = 11.9
      game.enemies = [{ ...enemy(kind, 19.5, 12.6), phase: .5, chargeX: 0, chargeZ: -1 }]
      for (let i = 0; i < 100; i++) stepGame(game, idle, .05)
      expect(game.enemies[0]!.z).toBeGreaterThanOrEqual(12.4)
      expect(game.player.health).toBe(100)
    }
  })
  it('stops enemy bubbles at the starting halls', () => {
    const game = createGame(); game.enemies = []
    game.player.x = 19.5; game.player.z = 11.9
    game.projectiles = [{ x: 19.5, z: 12.05, dx: 0, dz: -3.2, life: 5 }]
    stepGame(game, idle, .05)
    expect(game.projectiles).toHaveLength(0)
    expect(game.player.health).toBe(100)
  })
  it('provides a bounded walkable route from entrance to exit', () => {
    const seen = new Set<string>()
    const queue: [number, number][] = [[Math.floor(ENTRANCE.x / CELL), Math.floor(ENTRANCE.z / CELL)]]
    while (queue.length) {
      const [x, z] = queue.shift()!
      const key = `${x},${z}`
      if (seen.has(key) || !canStand((x + .5) * CELL, (z + .5) * CELL)) continue
      seen.add(key)
      queue.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1])
    }
    expect(seen.has(`${Math.floor(EXIT.x / CELL)},${Math.floor(EXIT.z / CELL)}`)).toBe(true)
    expect(canStand(-1, 4)).toBe(false)
    expect(canStand(LEVEL[0]!.length * CELL + 1, 4)).toBe(false)
  })
  it('stops a body at walls, including movement longer than a wall thickness', () => {
    const body = { ...ENTRANCE }
    moveBody(body, -100, 0)
    expect(body.x).toBeGreaterThan(CELL)
    expect(canStand(body.x, body.z)).toBe(true)
  })
  it('normalizes diagonal player speed', () => {
    const straight = createGame(); straight.enemies = []
    const diagonal = createGame(); diagonal.enemies = []
    stepGame(straight, { ...idle, forward: 1 }, .05)
    stepGame(diagonal, { ...idle, forward: 1, strafe: 1 }, .05)
    expect(Math.hypot(diagonal.player.x - ENTRANCE.x, diagonal.player.z - ENTRANCE.z)).toBeCloseTo(Math.hypot(straight.player.x - ENTRANCE.x, straight.player.z - ENTRANCE.z))
  })
  it('hits only the closest enemy in the laser path and respects the firing cooldown', () => {
    const game = createGame()
    game.player.yaw = Math.PI / 2; game.player.pitch = 0
    game.enemies = [enemy('puff', ENTRANCE.x + 2, ENTRANCE.z), { ...enemy('puff', ENTRANCE.x + 4, ENTRANCE.z), id: 100 }]
    fireLaser(game)
    expect(game.enemies.map(e => e.hp)).toEqual([1, 2])
    fireLaser(game)
    expect(game.enemies[0]!.hp).toBe(1)
  })
  it('does not let lasers pass through walls or hit when aimed far above a creature', () => {
    const game = createGame()
    game.player.yaw = -Math.PI / 2
    game.enemies = [enemy('puff', -1, game.player.z)]
    fireLaser(game)
    expect(game.enemies[0]!.hp).toBe(2)
    game.shotCooldown = 0; game.player.yaw = Math.PI / 2; game.player.pitch = 1
    game.enemies = [enemy('puff', game.player.x + 3, game.player.z)]
    fireLaser(game)
    expect(game.enemies[0]!.hp).toBe(2)
  })
  it('turns defeated enemies into confetti once', () => {
    const game = createGame(); game.player.yaw = Math.PI / 2
    game.enemies = [{ ...enemy('puff', game.player.x + 2, game.player.z), hp: 1 }]
    fireLaser(game)
    expect(game.enemies).toHaveLength(0)
    expect(game.popped).toBe(1)
    expect(game.events.filter(event => event.type === 'pop')).toHaveLength(1)
  })
  it('puffs chase, hoppers wind up before dashing, and prisms fire bubbles', () => {
    for (const kind of ['puff', 'hopper', 'prism'] as const) {
      const game = createGame(); game.player.x = 7; game.player.z = 16.5
      game.enemies = [enemy(kind, 10, game.player.z)]
      const startX = game.enemies[0]!.x
      stepGame(game, idle, .05)
      if (kind === 'puff') expect(game.enemies[0]!.x).toBeLessThan(startX)
      if (kind === 'hopper') { expect(game.enemies[0]!.phase).toBeGreaterThan(0); expect(game.enemies[0]!.x).toBe(startX) }
      if (kind === 'prism') expect(game.projectiles.length).toBe(1)
    }
  })
  it('applies contact damage with invulnerability and ends on zero health', () => {
    const game = createGame()
    game.player.z = 16.5
    game.enemies = [enemy('puff', game.player.x + .3, game.player.z)]
    stepGame(game, idle, .05)
    expect(game.player.health).toBeLessThan(100)
    const health = game.player.health
    stepGame(game, idle, .05)
    expect(game.player.health).toBe(health)
    game.player.health = 1; game.player.invulnerable = 0
    stepGame(game, idle, .05)
    expect(game.status).toBe('dead')
  })
  it('lets players quit through the entrance before defeating any enemies', () => {
    const early = createGame(); stepGame(early, { ...idle, interact: true }, .01)
    expect(early.status).toBe('exited')
    expect(early.popped).toBe(0)
  })
  it.each([0, 11])('keeps the final exit locked with only %i enemies defeated', popped => {
    const game = createGame(); game.player.x = EXIT.x; game.player.z = EXIT.z
    game.enemies = game.enemies.slice(popped); game.popped = popped
    stepGame(game, { ...idle, interact: true }, .01)
    expect(game.status).toBe('playing')
  })
  it('completes the level at the exit only after all enemies are defeated', () => {
    const complete = createGame(); complete.player.x = EXIT.x; complete.player.z = EXIT.z
    complete.enemies = []; complete.popped = 12
    stepGame(complete, idle, .01)
    expect(complete.status).toBe('won')
  })
  it('freezes terminal states and creates a fresh retry', () => {
    const game = createGame(); game.status = 'dead'; game.player.health = 0
    const before = JSON.stringify(game)
    stepGame(game, { ...idle, forward: 1, fire: true }, .1)
    expect(JSON.stringify(game)).toBe(before)
    const retry = createGame()
    expect(retry.player.health).toBe(100)
    expect(retry.status).toBe('playing')
    expect(retry.enemies.length).toBeGreaterThan(0)
    expect(new Set(retry.enemies.map(e => e.kind)).size).toBe(3)
  })
})

describe('pitched laser intersections', () => {
  it.each([
    { name: 'ceiling', pitch: Math.PI / 4, y: 3 },
    { name: 'floor', pitch: -Math.PI / 4, y: 0 },
  ])('ends on the aimed $name before a distant wall or enemy', ({ pitch, y }) => {
    const game = createGame()
    game.player.yaw = Math.PI / 2
    game.player.pitch = pitch
    game.enemies = [enemy('puff', game.player.x + 4, game.player.z)]
    fireLaser(game)
    const shot = game.events.find(event => event.type === 'shot')!
    expect(shot.x).toBeCloseTo(game.player.x + 1.5)
    expect(shot.y).toBeCloseTo(y)
    expect(shot.z).toBeCloseTo(game.player.z)
    expect(game.enemies[0]!.hp).toBe(2)
    // The endpoint stays on the original aiming ray, without vertical clamping.
    expect((shot.y - 1.5) / (shot.x - game.player.x)).toBeCloseTo(Math.tan(pitch))
  })
})
