import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const graphics = vi.hoisted(() => ({ dispose: vi.fn(), render: vi.fn() }))
const rendererOptions = vi.hoisted(() => vi.fn())
const audio = vi.hoisted(() => ({ start: vi.fn(), pause: vi.fn(), end: vi.fn(), close: vi.fn(), play: vi.fn(), setSettings: vi.fn(), preloadNewsroom: vi.fn(), setThreat: vi.fn() }))
vi.mock('./backrooms-audio', () => ({ createBackroomsAudio: () => audio }))
vi.mock('../SiteAudio', () => ({ useSiteAudio: () => ({ effectsVolume: .8, musicVolume: .35, musicMuted: false, toggleMusic: vi.fn() }) }))
vi.mock('./renderer', () => ({ createRenderer: (host: HTMLElement, options?: { hideKonamiHint?: boolean }) => { rendererOptions(options); const canvas = document.createElement('canvas'); host.appendChild(canvas); return { canvas, render: graphics.render, dispose: graphics.dispose } } }))
import BackroomsGame from './BackroomsGame'
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'pointerLockElement')
  Reflect.deleteProperty(document, 'exitPointerLock')
  Reflect.deleteProperty(document, 'hidden')
})
describe('Backrooms lifecycle', () => {
  it('does not construct the Konami clue for arcade discoverers', () => {
    const view = render(<BackroomsGame onExit={() => {}} hideKonamiHint />)
    expect(rendererOptions).toHaveBeenLastCalledWith({ hideKonamiHint: true })
    view.unmount()
  })

  it('starts sound only on Play and stops it on pause, exit and unmount', () => {
    const view = render(<BackroomsGame onExit={() => {}} />)
    expect(audio.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
    expect(audio.start).toHaveBeenCalledOnce()
    fireEvent.blur(window)
    expect(audio.pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Effects on' }))
    expect(audio.setSettings).toHaveBeenLastCalledWith({ effects: 0, music: .35, musicMuted: false })
    fireEvent.click(screen.getByRole('button', { name: 'Resume exploring' }))
    expect(audio.start).toHaveBeenCalledTimes(2)
    fireEvent.blur(window)
    fireEvent.click(screen.getByRole('button', { name: 'Quit to game room' }))
    expect(audio.pause).toHaveBeenCalledTimes(3)
    view.unmount()
    expect(audio.close).toHaveBeenCalledOnce()
  })
  it('explains controls and provides an immediate upstairs return', () => {
    const onExit = vi.fn(); const view = render(<BackroomsGame onExit={onExit} />)
    expect(screen.getByRole('heading', { name: 'THE BACKROOMS' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quit to game room' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(graphics.dispose).toHaveBeenCalledTimes(1)
  })
  it('pauses on focus loss and offers an explicit resume', () => {
    const view = render(<BackroomsGame onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
    fireEvent.blur(window)
    expect(screen.getByRole('heading', { name: 'TAKE A BREATHER' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume exploring' })).toBeTruthy()
    view.unmount()
  })

  it('cancels animation when the tab becomes hidden', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const view = render(<BackroomsGame onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByRole('heading', { name: 'TAKE A BREATHER' })).toBeTruthy()
    expect(cancel).toHaveBeenCalled()
    view.unmount()
  })

  it('pauses when the browser releases pointer lock', () => {
    const view = render(<BackroomsGame onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: view.container.querySelector('canvas') })
    fireEvent(document, new Event('pointerlockchange'))
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
    fireEvent(document, new Event('pointerlockchange'))
    expect(screen.getByRole('heading', { name: 'TAKE A BREATHER' })).toBeTruthy()
    view.unmount()
  })
})

it('releases a pointer lock granted after the game already paused', async () => {
  const view = render(<BackroomsGame onExit={() => {}} />)
  const canvas = view.container.querySelector('canvas')!
  let grant!: () => void
  Object.defineProperty(canvas, 'requestPointerLock', { configurable: true, value: () => new Promise<void>(resolve => { grant = resolve }) })
  const release = vi.fn()
  Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: release })
  fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
  fireEvent.blur(window)
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas })
  grant()
  await Promise.resolve()
  expect(release).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
  view.unmount()
})

describe('fire presses between animation frames', () => {
  function startWithManualFrames(mobile = false, onExit = vi.fn()) {
    if (mobile) {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    }
    let nextFrame!: FrameRequestCallback
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1 })
    const view = render(<BackroomsGame onExit={onExit} />)
    const game = graphics.render.mock.calls[0]![0] as import('./simulation').Game
    fireEvent.click(screen.getByRole('button', { name: 'Enter the Backrooms' }))
    return { view, game, onExit, frame: (time: number) => { act(() => { nextFrame(time) }) } }
  }

  it.each(['mouse', 'keyboard', 'touch'] as const)('fires one shot after a quick %s press and release before RAF', input => {
    const { view, game, frame } = startWithManualFrames(input === 'touch')
    if (input === 'keyboard') {
      fireEvent.keyDown(window, { code: 'Space' })
      fireEvent.keyUp(window, { code: 'Space' })
    } else {
      const target = input === 'touch' ? screen.getByRole('button', { name: 'Hold to fire lasers' }) : view.container.querySelector('canvas')!
      Object.defineProperty(target, 'setPointerCapture', { configurable: true, value: () => {} })
      fireEvent.pointerDown(target, { button: 0, pointerType: input === 'touch' ? 'touch' : 'mouse', pointerId: 1 })
      fireEvent.pointerUp(target, { button: 0, pointerType: input === 'touch' ? 'touch' : 'mouse', pointerId: 1 })
    }
    frame(16)
    expect(game.events.filter(event => event.type === 'shot')).toHaveLength(1)
    expect(audio.play).toHaveBeenCalledWith('laser')
    for (let time = 66; time <= 366; time += 50) frame(time)
    expect(game.events.filter(event => event.type === 'shot')).toHaveLength(1)
    view.unmount()
  })

  it('keeps held autofire subject to its cooldown', () => {
    const { view, game, frame } = startWithManualFrames()
    fireEvent.keyDown(window, { code: 'Space' })
    frame(16)
    frame(66)
    expect(game.events.filter(event => event.type === 'shot')).toHaveLength(1)
    for (let time = 116; time <= 266; time += 50) frame(time)
    expect(game.events.filter(event => event.type === 'shot')).toHaveLength(2)
    fireEvent.keyUp(window, { code: 'Space' })
    view.unmount()
  })

  it('plays events before the renderer consumes them, and stops audio at the exit', () => {
    const { view, game, frame } = startWithManualFrames()
    graphics.render.mockImplementation(current => current.events.splice(0))
    game.events.push({ type: 'pop', x: 4, z: 4, kind: 'puff' }, { type: 'hurt' })
    frame(16)
    expect(audio.play.mock.calls).toEqual([['pop'], ['hurt']])
    expect(game.events).toHaveLength(0)
    game.player.x = 40.5; game.player.z = 34.5
    frame(66)
    expect(audio.pause).toHaveBeenCalledOnce()
    view.unmount()
    graphics.render.mockReset()
  })

  it('ends the music on death and disposes the old audio bank on retry', () => {
    const { view, game, frame } = startWithManualFrames()
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: view.container.querySelector('canvas') })
    fireEvent(document, new Event('pointerlockchange'))
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => {
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
      fireEvent(document, new Event('pointerlockchange'))
    } })
    game.status = 'dead'
    frame(16)
    expect(audio.end).toHaveBeenCalledOnce()
    expect(audio.pause).not.toHaveBeenCalled() // releasing aim must not cut off the game-over cue
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(audio.close).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('plays footsteps for distance traveled, but stays silent when pushing into a wall', () => {
    const { view, game, frame } = startWithManualFrames()
    fireEvent.keyDown(window, { code: 'KeyW' })
    for (let time = 16; time < 466; time += 50) frame(time)
    expect(audio.play).toHaveBeenCalledWith('step')
    // Face the outside wall and let the player settle against it.
    game.player.x = 3.3; game.player.yaw = -Math.PI / 2
    for (let time = 466; time < 966; time += 50) frame(time)
    audio.play.mockClear()
    for (let time = 966; time < 1966; time += 50) frame(time)
    expect(audio.play).not.toHaveBeenCalled()
    view.unmount()
  })

  it.each([false, true])('shows the door requirement and offers quitting (mobile: %s)', mobile => {
    const { view, game, onExit, frame } = startWithManualFrames(mobile)
    game.popped = 5; game.enemies = game.enemies.slice(5)
    game.player.x = 40.5; game.player.z = 34.5
    frame(16)
    expect(screen.getByRole('heading', { name: 'EXIT LOCKED' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Enemies defeated: 5 / 12')
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Return to game room' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quit to game room' }))
    expect(onExit).toHaveBeenCalledOnce()
    expect(game.status).toBe('playing') // quitting does not award a completion
    view.unmount()
  })

  it('lets players resume and leave the locked door without trapping them in the panel', () => {
    const { view, game, frame } = startWithManualFrames()
    game.player.x = 40.5; game.player.z = 34.5
    frame(16)
    const health = game.player.health
    const before = JSON.stringify(game)
    frame(40)
    expect(JSON.stringify(game)).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Keep fighting' }))
    frame(66); frame(116)
    expect(screen.queryByRole('heading', { name: 'EXIT LOCKED' })).toBeNull()
    expect(game.player.health).toBe(health)
    game.player.x = 37.5; frame(166)
    game.player.x = 40.5; frame(216)
    expect(screen.getByRole('heading', { name: 'EXIT LOCKED' })).toBeTruthy()
    view.unmount()
  })

  it('shows the complete count and waits for the return button after all enemies are defeated', () => {
    const { view, game, onExit, frame } = startWithManualFrames()
    game.enemies = []; game.popped = 12
    game.player.x = 40.5; game.player.z = 34.5
    frame(16)
    expect(screen.getByRole('heading', { name: 'ROOM CLEARED' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Enemies defeated: 12 / 12')
    expect(onExit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Return to game room' }))
    expect(onExit).toHaveBeenCalledOnce()
    expect(game.status).toBe('won')
    view.unmount()
  })

  it('does not show a locked exit when the final enemy is defeated in the doorway', () => {
    const { view, game, frame } = startWithManualFrames()
    game.popped = 11
    game.player.x = 40.5; game.player.z = 34.5; game.player.yaw = -Math.PI / 2
    game.enemies = [{ ...game.enemies[0]!, x: 38.5, z: 34.5, hp: 1 }]
    fireEvent.keyDown(window, { code: 'Space' })
    frame(16)
    expect(game.popped).toBe(12)
    expect(screen.queryByRole('heading', { name: 'EXIT LOCKED' })).toBeNull()
    frame(66)
    expect(screen.getByRole('heading', { name: 'ROOM CLEARED' })).toBeTruthy()
    view.unmount()
  })

  it.each(['keyboard', 'touch'] as const)('opens the hidden studio with %s and blocks held fire until acknowledgment', input => {
    const { view, game, frame } = startWithManualFrames(input === 'touch')
    expect(view.container.querySelector('.br-map svg')?.getAttribute('viewBox')).toBe('0 0 105 91')
    game.newsroom.key.collected = true
    game.player.x = 41.5; game.player.z = 22.5; game.player.yaw = Math.PI / 2
    frame(16); frame(66); frame(116)
    if (input === 'keyboard') {
      fireEvent.keyDown(window, { code: 'KeyE' }); fireEvent.keyUp(window, { code: 'KeyE' })
    } else fireEvent.click(screen.getByRole('button', { name: /Inspect keyhole/ }))
    fireEvent.keyDown(window, { code: 'Space' })
    frame(166)
    expect(screen.getByRole('heading', { name: 'Do not hurt Bernard Goh, or else...' })).toBeTruthy()
    expect(game.newsroom.open).toBe(true)
    expect(game.newsroom.bernard.enraged).toBe(false)
    const before = JSON.stringify(game); frame(216)
    expect(JSON.stringify(game)).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }))
    fireEvent.keyDown(window, { code: 'Space', repeat: true })
    frame(266)
    expect(game.newsroom.warningPending).toBe(false)
    expect(game.events.some(event => event.type === 'shot')).toBe(false)
    expect(view.container.querySelector('.br-map svg')?.getAttribute('viewBox')).toBe('0 0 147 91')
    view.unmount()
  })

  it.each(['keyboard', 'touch'])('shows the locked keyhole hint using %s', input => {
    const { view, game, frame } = startWithManualFrames(input === 'touch')
    Object.assign(game.player, { x: 41.5, z: 22.5, yaw: Math.PI / 2 })
    frame(16); frame(66); frame(116)
    if (input === 'keyboard') fireEvent.keyDown(window, { code: 'KeyE' })
    else fireEvent.click(screen.getByRole('button', { name: /Inspect keyhole/ }))
    frame(166)
    expect(screen.getByText('This door needs a key, perhaps one of the enemies has it?')).toBeTruthy()
    expect(game.newsroom.open).toBe(false)
    const before = JSON.stringify(game); frame(216); expect(JSON.stringify(game)).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Keep searching' }))
    fireEvent.keyDown(window, { code: 'KeyE', repeat: true }); frame(266)
    expect(game.newsroom.notice).toBeNull()
    view.unmount()
  })
  it('pauses for key pickup, shows its message and inventory, then resumes without held fire', () => {
    const { view, game, frame } = startWithManualFrames()
    game.newsroom.key.position = { x: game.player.x + .4, z: game.player.z }
    fireEvent.keyDown(window, { code: 'Space' }); frame(16)
    expect(screen.getByText('This key seems to open a secret hidden room, find it and discover a surprise!')).toBeTruthy()
    expect(screen.getByText('SECRET KEY')).toBeTruthy()
    expect(game.events.some(e => e.type === 'shot')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Find the room' }))
    fireEvent.keyDown(window, { code: 'Space', repeat: true }); frame(66)
    expect(game.events.some(e => e.type === 'shot')).toBe(false)
    expect(game.newsroom.notice).toBeNull()
    view.unmount()
  })

  it('offers retry and quit after Bernard catches the player', () => {
    const { view, game, frame } = startWithManualFrames()
    game.newsroom.open = true; game.player.z = 22.5
    Object.assign(game.newsroom.bernard, { enraged: true, rageTime: 1, x: game.player.x + .3, z: game.player.z })
    frame(16)
    expect(screen.getByRole('heading', { name: 'BERNARD WARNED YOU' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quit to game room' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('heading', { name: 'THE BACKROOMS' })).toBeTruthy()
    view.unmount()
  })
})
