import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createRenderer } from './renderer'
import { useSiteAudio } from '../SiteAudio'
import { createBackroomsAudio, type BackroomsAudio } from './backrooms-audio'
import { CELL, ENTRANCE, EXIT, EXIT_REACH, ENEMY_COUNT, LEVEL, MAIN_COLUMNS, NEWSROOM, canInspectNewsroom, createGame, stepGame, type Game } from './simulation'
import { track } from '~/lib/analytics'
import './backrooms.css'

type Phase = 'title' | 'playing' | 'paused' | 'locked' | 'warning' | 'key-found' | 'key-needed' | 'dead' | 'won' | 'error'
const BUTTON = 'br-button'

export default function BackroomsGame({ onExit, hideKonamiHint = false }: { onExit: () => void; hideKonamiHint?: boolean }) {
  const { effectsVolume, musicMuted, musicVolume, toggleMusic } = useSiteAudio()
  const [effectsMuted, setEffectsMuted] = useState(false)
  const sound = useRef<BackroomsAudio | null>(null)
  const soundSettings = useRef({ effects: effectsVolume, music: musicVolume, musicMuted })
  soundSettings.current = { effects: effectsMuted ? 0 : effectsVolume, music: musicVolume, musicMuted }
  useEffect(() => { sound.current?.setSettings(soundSettings.current) }, [effectsVolume, effectsMuted, musicVolume, musicMuted])
  const host = useRef<HTMLDivElement>(null)
  const healthBar = useRef<HTMLDivElement>(null)
  const healthText = useRef<HTMLSpanElement>(null)
  const poppedText = useRef<HTMLSpanElement>(null)
  const locationDot = useRef<SVGGElement>(null)
  const ladderHint = useRef<HTMLButtonElement>(null)
  const newsroomHint = useRef<HTMLButtonElement>(null)
  const damage = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const onExitRef = useRef(onExit); onExitRef.current = onExit
  const control = useRef({ start: () => {}, pause: () => {} })
  const touch = useRef({ forward: 0, strafe: 0, fire: false, interact: false })
  const firePressed = useRef(false)
  const interactPressed = useRef(false)
  const moveOrigin = useRef<{ id: number; x: number; y: number } | null>(null)
  const moveKnob = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('title')
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState('')
  const [mouseHint, setMouseHint] = useState('Mouse to aim · hold click to fire')
  const [touchMode, setTouchMode] = useState(false)
  const phaseRef = useRef<Phase>('title')
  const leave = () => { control.current.pause(); onExitRef.current() }
  const newsroomRevealed = gameRef.current?.newsroom.open ?? false
  const hasNewsroomKey = gameRef.current?.newsroom.key.collected ?? false

  useEffect(() => {
    if (!host.current) return
    let graphics: ReturnType<typeof createRenderer>
    try { graphics = createRenderer(host.current, { hideKonamiHint }) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Graphics could not start.')
      phaseRef.current = 'error'; setPhase('error'); return
    }
    const game = createGame(); gameRef.current = game
    const audio = createBackroomsAudio(soundSettings.current); sound.current = audio
    let footsteps = 0
    let exitPromptShown = false
    let disposed = false, raf = 0, previous = 0, hudTime = 0, locked = false, mouseFire = false
    let lookPointer: { id: number; x: number; y: number } | null = null
    const keys = new Set<string>()
    const isTouch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    setTouchMode(isTouch)
    function changePhase(next: Phase) { phaseRef.current = next; setPhase(next) }
    function clearInput() {
      keys.clear(); mouseFire = false; lookPointer = null; firePressed.current = false; interactPressed.current = false
      touch.current = { forward: 0, strafe: 0, fire: false, interact: false }; moveOrigin.current = null
      if (moveKnob.current) moveKnob.current.style.transform = 'translate(0px, 0px)'
    }
    function releaseLock() { if (document.pointerLockElement === graphics.canvas) document.exitPointerLock?.() }
    function pause() {
      audio.pause()
      if (phaseRef.current !== 'playing') return
      cancelAnimationFrame(raf); clearInput(); changePhase('paused'); releaseLock()
    }
    function updateHud() {
      if (healthBar.current) healthBar.current.style.width = `${game.player.health}%`
      if (healthText.current) healthText.current.textContent = `${game.player.health}`
      if (poppedText.current) poppedText.current.textContent = `${game.popped} / ${ENEMY_COUNT}`
      if (locationDot.current) locationDot.current.setAttribute('transform', `translate(${game.player.x / CELL * 7},${game.player.z / CELL * 7}) rotate(${-game.player.yaw * 180 / Math.PI})`)
      if (ladderHint.current) ladderHint.current.hidden = Math.hypot(game.player.x - ENTRANCE.x, game.player.z - ENTRANCE.z) >= 2.1
      if (newsroomHint.current) newsroomHint.current.hidden = !canInspectNewsroom(game)
      if (damage.current) damage.current.style.opacity = game.player.invulnerable > .6 ? '.38' : '0'
    }
    function frame(now: number) {
      if (disposed || phaseRef.current !== 'playing') return
      const dt = previous ? Math.min((now - previous) / 1000, .05) : 0
      previous = now
      if (keys.has('ArrowLeft')) game.player.yaw += dt * 1.7
      if (keys.has('ArrowRight')) game.player.yaw -= dt * 1.7
      if (keys.has('ArrowUp')) game.player.pitch = Math.min(1.05, game.player.pitch + dt)
      if (keys.has('ArrowDown')) game.player.pitch = Math.max(-1.05, game.player.pitch - dt)
      const beforeX = game.player.x, beforeZ = game.player.z
      if (Math.hypot(game.player.x - NEWSROOM.door.x, game.player.z - NEWSROOM.door.z) < 4.5) audio.preloadNewsroom()
      stepGame(game, {
        forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.current.forward,
        strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.current.strafe,
        fire: firePressed.current || mouseFire || keys.has('Space') || touch.current.fire,
        interact: interactPressed.current || touch.current.interact,
      }, dt)
      // A press survives release until a simulation step, even at low frame rates.
      firePressed.current = false
      interactPressed.current = false
      touch.current.interact = false
      // Rendering consumes the event queue; sound observes it first.
      for (const event of game.events) {
        if (event.type === 'shot') audio.play('laser')
        else if (event.type === 'hurt' || event.type === 'pop' || event.type === 'bernard-step') audio.play(event.type)
        else if (event.type === 'bernard-rage') { audio.setThreat(true); audio.play('bernard-rage'); track('backrooms.bernard_attacked') }
        else if (event.type === 'newsroom-open') track('backrooms.newsroom_found')
        if (event.type === 'pop' && game.enemies.length === 0) track('backrooms.all_enemies_defeated')
      }
      footsteps += Math.hypot(game.player.x - beforeX, game.player.z - beforeZ)
      if (footsteps >= 1.6) { audio.play('step'); footsteps %= 1.6 }
      graphics.render(game, dt)
      hudTime += dt
      if (hudTime > .08) { updateHud(); hudTime = 0 }
      if (game.newsroom.notice) {
        audio.pause(game.newsroom.notice === 'key-found' ? 'enter' : undefined)
        updateHud(); clearInput(); changePhase(game.newsroom.notice); releaseLock(); return
      }
      if (game.newsroom.warningPending) {
        audio.pause('newsroom-open'); updateHud(); clearInput(); changePhase('warning'); releaseLock(); return
      }
      if (game.status === 'exited') {
        audio.pause()
        clearInput(); changePhase('paused'); releaseLock(); onExitRef.current(); return
      }
      if (game.status === 'won') {
        track('backrooms.escaped')
        audio.pause(); updateHud(); clearInput(); changePhase('won'); releaseLock(); return
      }
      if (game.status === 'dead') { if (game.deathCause === 'bernard') track('backrooms.killed_by_bernard'); audio.end(game.deathCause === 'bernard' ? 'bernard-hit' : 'gameover'); updateHud(); clearInput(); changePhase('dead'); releaseLock(); return }
      const exitDistance = Math.hypot(game.player.x - EXIT.x, game.player.z - EXIT.z)
      // Resume inside the doorway without immediately reopening the panel.
      // Re-arm only after walking away so approaching it again shows progress.
      if (exitDistance > EXIT_REACH + .75) exitPromptShown = false
      if (game.enemies.length > 0 && exitDistance < EXIT_REACH && !exitPromptShown) {
        exitPromptShown = true
        audio.pause(); updateHud(); clearInput(); changePhase('locked'); releaseLock(); return
      }
      raf = requestAnimationFrame(frame)
    }
    function start() {
      if (disposed || game.status !== 'playing' || phaseRef.current === 'playing') return
      if (phaseRef.current === 'warning') game.newsroom.warningPending = false
      if (phaseRef.current === 'key-found' || phaseRef.current === 'key-needed') game.newsroom.notice = null
      audio.start()
      clearInput(); previous = 0; changePhase('playing'); raf = requestAnimationFrame(frame)
      if (!isTouch && graphics.canvas.requestPointerLock) {
        try {
          const request = graphics.canvas.requestPointerLock()
          Promise.resolve(request).then(() => { if (disposed || phaseRef.current !== 'playing') releaseLock() }).catch(() => { if (!disposed) setMouseHint('Drag to aim · hold click / Space to fire · arrows also aim') })
        } catch { setMouseHint('Drag to aim · hold click / Space to fire · arrows also aim') }
      } else if (!isTouch) setMouseHint('Drag to aim · hold click / Space to fire · arrows also aim')
    }
    const onLock = () => {
      const hasLock = document.pointerLockElement === graphics.canvas
      if (locked && !hasLock && phaseRef.current === 'playing') pause()
      locked = hasLock
    }
    const onLockError = () => { if (!disposed) setMouseHint('Drag to aim · hold click / Space to fire · arrows also aim') }
    const onHidden = () => { if (document.hidden) pause() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.code)) {
        event.preventDefault(); event.stopPropagation()
        // A held key cleared by a modal needs a fresh press before resuming.
        if (event.repeat && !keys.has(event.code)) return
        keys.add(event.code)
        if (event.code === 'Space' && !event.repeat) firePressed.current = true
        if (event.code === 'KeyE' && !event.repeat) interactPressed.current = true
        if (event.code === 'Escape') pause()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => { keys.delete(event.code) }
    function aim(dx: number, dy: number) { game.player.yaw -= dx * .0026; game.player.pitch = Math.max(-1.05, Math.min(1.05, game.player.pitch - dy * .0026)) }
    const onMouseMove = (event: MouseEvent) => { if (phaseRef.current === 'playing' && document.pointerLockElement === graphics.canvas) aim(event.movementX, event.movementY) }
    const onPointerDown = (event: PointerEvent) => {
      if (phaseRef.current !== 'playing' || event.button !== 0) return
      event.preventDefault()
      if (event.pointerType !== 'touch') { mouseFire = true; firePressed.current = true }
      if (document.pointerLockElement !== graphics.canvas) { lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; graphics.canvas.setPointerCapture?.(event.pointerId) }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (phaseRef.current !== 'playing' || lookPointer?.id !== event.pointerId) return
      aim(event.clientX - lookPointer.x, event.clientY - lookPointer.y); lookPointer.x = event.clientX; lookPointer.y = event.clientY
    }
    const onPointerUp = (event: PointerEvent) => { if (event.pointerType !== 'touch') mouseFire = false; if (lookPointer?.id === event.pointerId) lookPointer = null }
    const onContextLost = (event: Event) => { event.preventDefault(); pause(); setError('The graphics context was interrupted. Retry to reload the level.'); changePhase('error') }
    control.current = { start, pause }
    changePhase('title'); updateHud(); graphics.render(game, 0)
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', pause); window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('visibilitychange', onHidden); document.addEventListener('pointerlockchange', onLock); document.addEventListener('pointerlockerror', onLockError)
    graphics.canvas.addEventListener('pointerdown', onPointerDown); graphics.canvas.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerUp)
    graphics.canvas.addEventListener('webglcontextlost', onContextLost)
    return () => {
      audio.close(); sound.current = null
      disposed = true; cancelAnimationFrame(raf); clearInput()
      window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', pause); window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('visibilitychange', onHidden); document.removeEventListener('pointerlockchange', onLock); document.removeEventListener('pointerlockerror', onLockError)
      graphics.canvas.removeEventListener('pointerdown', onPointerDown); graphics.canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp)
      graphics.canvas.removeEventListener('webglcontextlost', onContextLost)
      releaseLock(); graphics.dispose(); gameRef.current = null; control.current = { start: () => {}, pause: () => {} }
    }
  }, [generation, hideKonamiHint])

  function moveStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    moveOrigin.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = moveOrigin.current
    if (!origin || origin.id !== event.pointerId) return
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y, length = Math.max(36, Math.hypot(dx, dy))
    touch.current.strafe = dx / length; touch.current.forward = -dy / length
    if (moveKnob.current) moveKnob.current.style.transform = `translate(${dx / length * 30}px, ${dy / length * 30}px)`
  }
  function moveEnd() { moveOrigin.current = null; touch.current.forward = 0; touch.current.strafe = 0; if (moveKnob.current) moveKnob.current.style.transform = 'translate(0px, 0px)' }
  const retry = () => { setError(''); setGeneration(value => value + 1) }

  return <div className="br-root" role="dialog" aria-modal="true" aria-label="The Backrooms mini-game">
    <div ref={host} className="br-world" aria-label="First-person Backrooms view" />
    <div className="br-grain" />
    <div ref={damage} className="br-damage" />
    <header className="br-hud">
      <div className="br-status"><span className="br-eyebrow">SUBLEVEL 01 / THE BACKROOMS</span><strong>DEFEAT ALL {ENEMY_COUNT} ENEMIES</strong><span className="br-subtitle">Then reach the green exit to finish.</span></div>
      <button className="br-pause" onClick={() => control.current.pause()} disabled={phase !== 'playing'} aria-label="Pause game">Ⅱ <span>ESC</span></button>
    </header>
    {hasNewsroomKey && !newsroomRevealed && <div className="br-key-badge" role="status"><svg viewBox="0 0 32 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M12 7h17v6m-6-6v5" fill="none" stroke="currentColor" strokeWidth="3"/></svg>SECRET KEY</div>}
    <div className="br-crosshair" aria-hidden="true"><i /><b /></div>
    <div className="br-map" aria-label="Level map: you are the white arrow, exit is green">
      <span>YOU ARE HERE</span>
      <svg viewBox={`0 0 ${(newsroomRevealed ? LEVEL[0]!.length : MAIN_COLUMNS) * 7} ${LEVEL.length * 7}`}>
        {LEVEL.flatMap((row, z) => [...(newsroomRevealed ? row : row.slice(0, MAIN_COLUMNS))].map((cell, x) => cell === '#' || cell === 'T' || cell === 'D' && !newsroomRevealed ? <rect key={`${x}-${z}`} x={x * 7} y={z * 7} width="7" height="7" fill="#a39354" /> : null))}
        <rect x={ENTRANCE.x / CELL * 7 - 2} y={ENTRANCE.z / CELL * 7 - 2} width="4" height="4" fill="#efbe67" />
        <rect x={EXIT.x / CELL * 7 - 3} y={EXIT.z / CELL * 7 - 3} width="6" height="6" fill="#78f0b3" />
        <g ref={locationDot}><circle r="3.4" fill="#282821" /><path d="M 0,4 L -2.5,-2.5 L 2.5,-2.5 Z" fill="white" /></g>
      </svg>
      <span>↟ LADDER <b>■ EXIT</b></span>
    </div>
    <button ref={ladderHint} className="br-ladder" hidden onClick={() => { touch.current.interact = true }} disabled={phase !== 'playing'}><kbd>E</kbd> Climb back upstairs ↟</button>
    <button ref={newsroomHint} className="br-ladder br-inspect" hidden onClick={() => { touch.current.interact = true }} disabled={phase !== 'playing'}><kbd>E</kbd> {hasNewsroomKey ? 'Unlock secret door' : 'Inspect keyhole'}</button>
    <footer className="br-bottom">
      <div className="br-vitals"><div><span>♥ HEALTH</span><strong><span ref={healthText}>100</span><small> / 100</small></strong></div><div className="br-health-track"><div ref={healthBar} /></div></div>
      <div className="br-score"><span>ENEMIES DEFEATED</span><strong ref={poppedText}>0 / {ENEMY_COUNT}</strong><small>+4 health per pop</small></div>
      {!touchMode && <div className="br-controls"><b>W A S D</b> move · {mouseHint}<br /><b>E</b> interact · <b>ESC</b> pause · unlimited lasers</div>}
    </footer>
    {touchMode && phase === 'playing' && <div className="br-touch">
      <div className="br-move" aria-label="Drag to move" onPointerDown={moveStart} onPointerMove={moveDrag} onPointerUp={moveEnd} onPointerCancel={moveEnd} onLostPointerCapture={moveEnd}><div ref={moveKnob}>✥</div><span>MOVE</span></div>
      <span className="br-look-label">DRAG VIEW TO LOOK</span>
      <button className="br-fire" aria-label="Hold to fire lasers" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touch.current.fire = true; firePressed.current = true }} onPointerUp={() => { touch.current.fire = false }} onPointerCancel={() => { touch.current.fire = false }} onLostPointerCapture={() => { touch.current.fire = false }}>✧<span>FIRE</span></button>
    </div>}
    {phase !== 'playing' && <div className="br-overlay">
      <section className={`br-panel${phase === 'title' ? ' br-title' : ''}`}>
        <span className="br-eyebrow">YOU FOUND SOMETHING YOU WEREN’T SUPPOSED TO.</span>
        <h1>{phase === 'title' ? 'THE BACKROOMS' : phase === 'key-found' ? 'A MYSTERIOUS KEY' : phase === 'key-needed' ? 'A LOCKED DOOR' : phase === 'warning' ? 'Do not hurt Bernard Goh, or else...' : phase === 'paused' ? 'TAKE A BREATHER' : phase === 'locked' ? 'EXIT LOCKED' : phase === 'won' ? 'ROOM CLEARED' : phase === 'dead' ? gameRef.current?.deathCause === 'bernard' ? 'BERNARD WARNED YOU' : 'OUT OF SPARKLE' : 'GRAPHICS BREAK'}</h1>
        <p className="br-intro">{phase === 'title' ? 'The lights are humming. The carpet is questionable. And the locals are surprisingly adorable.' : phase === 'key-found' ? 'This key seems to open a secret hidden room, find it and discover a surprise!' : phase === 'key-needed' ? 'This door needs a key, perhaps one of the enemies has it?' : phase === 'warning' ? 'You found the secret newsroom. The legend is off duty. Keep your lasers to yourself.' : phase === 'paused' ? 'Your adventure is paused. The confetti can wait.' : phase === 'locked' ? 'Defeat every enemy to unlock this exit. Keep fighting, or quit this run and return upstairs.' : phase === 'won' ? 'Every enemy defeated. The exit is open — time to get back to those hackathon tasks.' : phase === 'dead' ? gameRef.current?.deathCause === 'bernard' ? 'One hit. Off the air. Maybe leave the news anchor alone next time.' : 'The locals got a little too enthusiastic. Take another run?' : error}</p>
        {(phase === 'locked' || phase === 'won') && <div className="br-exit-progress" role="status">
          <strong>Enemies defeated: {gameRef.current?.popped ?? 0} / {ENEMY_COUNT}</strong>
          <span>{phase === 'won' ? 'All done. You can head upstairs.' : `${ENEMY_COUNT - (gameRef.current?.popped ?? 0)} more required to open the exit.`}</span>
        </div>}
        {phase === 'title' && <>
          <div className="br-mission"><span>YOUR MISSION</span><p>Defeat <b>all {ENEMY_COUNT} enemies</b>, then reach the <b>green EXIT</b> to finish. You can quit through the pause menu, at the exit, or using the entrance ladder.</p></div>
          <div className="br-creatures"><div><i>☁</i><b>PUFF</b><span>Soft. Slow. Follows you.</span></div><div><i>♧</i><b>HOPPER</b><span>Winds up. Dashes!</span></div><div><i>◇</i><b>PRISM</b><span>Sends floating bubbles.</span></div></div>
          <p className="br-instructions">{touchMode ? 'Left thumb to move · drag the view to aim · hold FIRE' : 'WASD to move · mouse to aim · hold click to fire'}<br />{touchMode ? 'Tap the ladder prompt to leave. Pause at any time.' : 'E at the ladder · Escape to pause · arrow keys also aim'}</p>
        </>}
        <div className="br-actions">
          <button autoFocus className={`${BUTTON} br-primary`} onClick={phase === 'won' ? leave : phase === 'title' || phase === 'paused' || phase === 'locked' || phase === 'warning' || phase === 'key-found' || phase === 'key-needed' ? () => control.current.start() : retry}>{phase === 'title' ? 'Enter the Backrooms' : phase === 'key-found' ? 'Find the room' : phase === 'key-needed' ? 'Keep searching' : phase === 'warning' ? 'Understood' : phase === 'paused' ? 'Resume exploring' : phase === 'locked' ? 'Keep fighting' : phase === 'won' ? 'Return to game room' : 'Try again'} <span aria-hidden="true">→</span></button>
          {phase !== 'won' && <button className={BUTTON} onClick={leave}>Quit to game room</button>}
        </div>
        <div className="br-audio" aria-label="Backrooms sound settings">
          <button onClick={toggleMusic} aria-pressed={!musicMuted}>Music {musicMuted ? 'off' : 'on'}</button>
          <button onClick={() => setEffectsMuted(value => !value)} aria-pressed={!effectsMuted}>Effects {effectsMuted ? 'off' : 'on'}</button>
        </div>
        <span className="br-fine">ALL LASERS. ALL CONFETTI. NO HARD FEELINGS.</span>
      </section>
    </div>}
  </div>
}
