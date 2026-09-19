import { describe, expect, it } from 'vitest'
import { createGame, stepGame, fireLaser, canStand, canInspectNewsroom, NEWSROOM, ENEMY_COUNT, EXIT } from './simulation'
const idle = { forward: 0, strafe: 0, fire: false, interact: false }
function atDoor() {
  const game = createGame(); game.newsroom.key.collected = true
  game.player.x = 41.5; game.player.z = 22.5; game.player.yaw = Math.PI / 2
  return game
}
function inStudio() {
  const game = atDoor(); game.newsroom.open = true
  game.player.x = 49.5; game.player.z = 22.5
  return game
}

describe('Bernard’s hidden studio', () => {
  it('conceals a solid door; only nearby players facing it can discover it', () => {
    const game = createGame()
    expect(canInspectNewsroom(game)).toBe(false)
    expect(canStand(NEWSROOM.door.x, NEWSROOM.door.z)).toBe(false)
    game.newsroom.key.collected = true
    Object.assign(game.player, atDoor().player)
    game.player.yaw = -Math.PI / 2
    expect(canInspectNewsroom(game)).toBe(false)
    stepGame(game, { ...idle, interact: true }, .05)
    expect(game.newsroom.open).toBe(false)
    game.player.yaw = Math.PI / 2
    expect(canInspectNewsroom(game)).toBe(true)
    stepGame(game, { ...idle, interact: true, fire: true }, .05)
    expect(game.newsroom.open).toBe(true)
    expect(game.newsroom.warningPending).toBe(true)
    expect(game.newsroom.bernard.enraged).toBe(false)
    expect(game.events.map(e => e.type)).toEqual(['newsroom-open'])
    expect(canStand(NEWSROOM.door.x, NEWSROOM.door.z, .27, true)).toBe(true)
  })
  it('freezes the entire simulation until the warning is acknowledged', () => {
    const game = atDoor(); stepGame(game, { ...idle, interact: true }, .01)
    const before = JSON.stringify(game)
    stepGame(game, { ...idle, forward: 1, fire: true }, .05); fireLaser(game)
    expect(JSON.stringify(game)).toBe(before)
  })
  it('keeps Bernard seated and neutral until a laser intersects him', () => {
    const game = inStudio()
    for (let i = 0; i < 30; i++) stepGame(game, idle, .05)
    expect(game.newsroom.bernard).toMatchObject({ ...NEWSROOM.bernard, enraged: false })
    game.player.yaw = 0; fireLaser(game)
    expect(game.newsroom.bernard.enraged).toBe(false)
    game.shotCooldown = 0; game.player.yaw = Math.PI / 2; game.player.pitch = 1
    fireLaser(game)
    expect(game.newsroom.bernard.enraged).toBe(false)
    game.shotCooldown = 0; game.player.pitch = 0
    fireLaser(game)
    expect(game.newsroom.bernard.enraged).toBe(true)
    expect(game.events.filter(e => e.type === 'bernard-rage')).toHaveLength(1)
    game.shotCooldown = 0; fireLaser(game)
    expect(game.events.filter(e => e.type === 'bernard-rage')).toHaveLength(1)
    expect(game.popped).toBe(0)
    expect(game.enemies).toHaveLength(ENEMY_COUNT)
  })
  it('does not punish a visible miss beside the seated head', () => {
    const game = inStudio(); game.player.z += .49
    fireLaser(game)
    expect(game.newsroom.bernard.enraged).toBe(false)
  })
  it('does not extend the seated torso hit region into air beside his legs', () => {
    const game = inStudio()
    Object.assign(game.player, { x: 58.5, z: 22.89, yaw: -Math.PI / 2, pitch: Math.atan(-1.2 / 3) })
    fireLaser(game)
    expect(game.newsroom.bernard.enraged).toBe(false)
  })
  it('blocks shots through the concealed wall, desk and closer monsters', () => {
    const closed = atDoor(); fireLaser(closed)
    expect(closed.newsroom.bernard.enraged).toBe(false)
    const low = inStudio(); low.player.pitch = -.1; fireLaser(low)
    expect(low.newsroom.bernard.enraged).toBe(false)
    const blocked = inStudio()
    blocked.enemies = [{ ...blocked.enemies[0]!, x: 50.5, z: 22.5 }]
    fireLaser(blocked)
    expect(blocked.enemies[0]!.hp).toBe(1)
    expect(blocked.newsroom.bernard.enraged).toBe(false)
  })
  it('paths around the desk and out of the room without crossing walls', () => {
    const game = inStudio(); game.enemies = []
    game.newsroom.bernard.enraged = true
    game.player.x = 40.5; game.player.z = 22.5
    let reachedHall = false
    for (let i = 0; i < 450 && game.status === 'playing'; i++) {
      stepGame(game, idle, .05)
      const b = game.newsroom.bernard
      expect(canStand(b.x, b.z, .4, true)).toBe(true)
      if (b.x < 42) reachedHall = true
    }
    expect(reachedHall).toBe(true)
    expect(game.status).toBe('dead')
    expect(game.deathCause).toBe('bernard')
  })
  it('kills with one contact even at full health and with normal invulnerability', () => {
    const game = inStudio()
    Object.assign(game.newsroom.bernard, { x: game.player.x + .4, z: game.player.z, enraged: true, rageTime: 1 })
    game.player.invulnerable = .85
    stepGame(game, idle, .01)
    expect(game.player.health).toBe(0)
    expect(game.status).toBe('dead')
    expect(game.events.some(e => e.type === 'bernard-hit')).toBe(true)
    const retry = createGame()
    expect(retry.newsroom.open).toBe(false)
    expect(retry.newsroom.bernard.enraged).toBe(false)
    expect(retry.deathCause).toBeUndefined()
  })
  it('does not add Bernard to the normal enemy requirement', () => {
    const game = inStudio(); game.enemies = []; game.popped = 12
    Object.assign(game.player, EXIT)
    stepGame(game, idle, .01)
    expect(game.status).toBe('won')
    expect(game.newsroom.bernard.enraged).toBe(false)
  })
})
