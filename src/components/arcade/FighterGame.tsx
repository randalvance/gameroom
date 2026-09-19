// The arcade screen: attract mode, character select, the fight, results.
//
// The React tree is the chrome — menus, the pause sheet, the touch pad — and
// the fight itself runs in a requestAnimationFrame loop over the pure sim,
// drawing straight to a canvas. Input is collected on window in the capture
// phase and stopped there, so a jump or a jab never walks the character in
// the room underneath (which is inert anyway while the cabinet is up).
//
// Solo: WASD move · U/I punches · J/K kicks · O special.
// Versus: 1P WASD + F/G punches, V/B kicks, R special;
//         2P arrows + U/I punches, J/K kicks, O special (numpad aliases remain).
// Touch gets a D-pad and the same five buttons for 1P; the CPU takes the other
// side. Holding up while pressing special selects Bernard's rain cast.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createKonamiDetector, konamiTokenForKey } from "~/lib/konami"
import { track } from "~/lib/analytics"
import { createArcadeSoundBank, type ArcadeSoundBank } from "./arcade-audio"
import { cuesForEvent } from "./audio-cues"
import { buildCpuLadder } from "./arcade-ladder"
import { loadBernardUnlock, saveBernardUnlock } from "./arcade-unlock"
import { CHARACTERS, type CharacterId } from "./characters"
import { createCpu } from "./fight-ai"
import { createFightRenderer, type FightRenderer } from "./fight-renderer"
import { createFight, EMPTY_INPUT, stepFight, type FightInput, type FightState } from "./fight-sim"
import { loadFighterSprites, loadStageImages } from "./sprite-loader"
import { GAME_ROOM_STAGE, NEWSROOM_STAGE } from "./battle-stages"
import { UI_ART } from "./ui-atlas.generated"
import "./arcade.css"

type Screen = "title" | "select" | "ladder" | "fight"
type Mode = "cpu" | "versus" | "boss"
type Button = "lp" | "hp" | "lk" | "hk" | "sp"
type Dir = "up" | "down" | "left" | "right"
interface Ladder { opponents: readonly CharacterId[]; fightIndex: number }
interface MatchResult { winner: 0 | 1 | null; hasNextLadderFight: boolean; fightNumber: number }

const STEP_MS = 1000 / 60
const MAX_STEPS_PER_FRAME = 5
/** How long the fight waits for the atlases before starting with puppets. */
const SPRITE_LOAD_TIMEOUT_MS = 5000
const BERNARD_INDEX = CHARACTERS.findIndex((fighter) => fighter.id === "bernard")
const labelsFor = (mode: Mode): [string, string] => mode === "versus" ? ["1P", "2P"] : mode === "boss" ? ["1P", "BERNARD"] : ["1P", "CPU"]

/** A fighter's square portrait, face-centred, as a background. */
function portraitStyle(id: CharacterId): React.CSSProperties {
  return {
    backgroundImage: `url(${UI_ART.portraits[id]})`,
    backgroundSize: "cover",
    backgroundPosition: "center 22%",
    backgroundRepeat: "no-repeat",
  }
}
/** How long the locked-in roster faces off before the fight loads. */
const VERSUS_MS = 1400

const P1_KEYS: Record<string, Dir | Button> = {
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
  KeyU: "lp", KeyI: "hp", KeyJ: "lk", KeyK: "hk", KeyO: "sp",
}
const P1_VERSUS_KEYS: Record<string, Dir | Button> = {
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
  KeyF: "lp", KeyG: "hp", KeyV: "lk", KeyB: "hk", KeyR: "sp",
}
const P2_KEYS: Record<string, Dir | Button> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  KeyU: "lp", KeyI: "hp", KeyJ: "lk", KeyK: "hk", KeyO: "sp",
  Numpad4: "lp", Numpad5: "hp", Numpad1: "lk", Numpad2: "hk", Numpad6: "sp",
}
/**
 * Some virtual keyboards and automation deliver keydown with an empty `code`.
 * The physical-key map above is the one that matters (it is layout-proof);
 * this recovers the same names from `key` when `code` is missing.
 */
const KEY_FALLBACK: Record<string, string> = {
  w: "KeyW", s: "KeyS", a: "KeyA", d: "KeyD", u: "KeyU", i: "KeyI", j: "KeyJ", k: "KeyK", o: "KeyO",
  f: "KeyF", g: "KeyG", v: "KeyV", b: "KeyB", r: "KeyR",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  "4": "Numpad4", "5": "Numpad5", "1": "Numpad1", "2": "Numpad2", "6": "Numpad6",
  " ": "Space", enter: "Enter", escape: "Escape",
}
const codeOf = (event: KeyboardEvent): string => event.code || KEY_FALLBACK[event.key.toLowerCase()] || ""
const BUTTONS: readonly Button[] = ["lp", "hp", "lk", "hk", "sp"]
const BERNARD_MOVES = [
  ["special", "SPECIAL", "Duck the eye scan"],
  ["specialForward", "FORWARD + SPECIAL", "Full-range flaming charge"],
  ["specialBack", "BACK + SPECIAL", "Jumping ice slam"],
  ["specialDownForward", "DOWN + FORWARD + SPECIAL", "Fired magic circle"],
  ["specialDown", "DOWN + SPECIAL", "Large water prison"],
  ["specialUp", "UP + SPECIAL", "Marked laser rain"],
  ["specialUltimate", "DOWN, THEN UP + SPECIAL", "Charge and throw; shelter beneath Bernard"],
] as const
const bernardMoves = CHARACTERS.find(c => c.id === "bernard")!.moves
function BernardMoveList() {
  return <details className="ar-move-list"><summary>BERNARD MOVE LIST</summary>
    <p>Forward and back are relative to your opponent. SPECIAL is O in solo play. In 2P: R for 1P, O for 2P.</p>
    <dl>{BERNARD_MOVES.map(([key, control, hint]) => {
      const move = bernardMoves[key]!
      return <div key={key}><dt>{control}</dt><dd>{move.label} · {move.energyCost} energy · {hint}</dd></div>
    })}</dl>
  </details>
}
const isButton = (v: Dir | Button): v is Button => (BUTTONS as readonly string[]).includes(v)

/** Held directions plus buttons pressed since the last sim step. */
class InputPad {
  held = { up: false, down: false, left: false, right: false }
  pressed = new Set<Button>()
  down(what: Dir | Button) {
    if (isButton(what)) this.pressed.add(what)
    else this.held[what] = true
  }
  up(what: Dir | Button) {
    if (!isButton(what)) this.held[what] = false
  }
  clear() {
    this.held = { up: false, down: false, left: false, right: false }
    this.pressed.clear()
  }
  /** Consume: the edges fire on exactly one step. */
  take(): FightInput {
    const input: FightInput = {
      ...EMPTY_INPUT,
      ...this.held,
      lp: this.pressed.has("lp"),
      hp: this.pressed.has("hp"),
      lk: this.pressed.has("lk"),
      hk: this.pressed.has("hk"),
      sp: this.pressed.has("sp"),
    }
    this.pressed.clear()
    return input
  }
}

export interface FighterGameProps {
  onExit: () => void
  /** The site's fixed effects volume, 0..1. */
  volume: number
  /** The site's music setting: the arcade's music follows it. */
  music?: { volume: number; muted: boolean }
}

export default function FighterGame({ onExit, volume, music = { volume: 0.5, muted: false } }: FighterGameProps) {
  const [screen, setScreen] = useState<Screen>("title")
  const [welcome, setWelcome] = useState(() => {
    try { return window.localStorage.getItem("impact-hackers.welcome-seen") !== "true" } catch { return true }
  })
  const welcomeRef = useRef(welcome)
  welcomeRef.current = welcome
  const dismissWelcome = useCallback(() => {
    try { window.localStorage.setItem("impact-hackers.welcome-seen", "true") } catch { /* storage is optional */ }
    setWelcome(false)
  }, [])
  const [mode, setMode] = useState<Mode>("cpu")
  const [cursor, setCursor] = useState<[number, number]>([0, 1])
  const [locked, setLocked] = useState<[boolean, boolean]>([false, false])
  const [paused, setPaused] = useState(false)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [touchMode, setTouchMode] = useState(false)
  const [round, setRound] = useState(1)
  const [loadingSprites, setLoadingSprites] = useState(false)
  const [bernardUnlocked, setBernardUnlocked] = useState(false)
  const [ladder, setLadder] = useState<Ladder | null>(null)
  const bernardTouchSpecial = useRef("")

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<ArcadeSoundBank | null>(null)
  const pads = useRef<[InputPad, InputPad]>([new InputPad(), new InputPad()])
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const screenRef = useRef<Screen>("title")
  const pausedRef = useRef(false)
  const modeRef = useRef<Mode>("cpu")
  const cursorRef = useRef(cursor)
  const lockedRef = useRef(locked)
  const bernardUnlockedRef = useRef(bernardUnlocked)
  const ladderRef = useRef<Ladder | null>(ladder)
  screenRef.current = screen
  pausedRef.current = paused
  modeRef.current = mode
  cursorRef.current = cursor
  lockedRef.current = locked
  bernardUnlockedRef.current = bernardUnlocked
  ladderRef.current = ladder

  const audio = () => {
    if (!audioRef.current) audioRef.current = createArcadeSoundBank({ effects: volume, music: music.volume, musicMuted: music.muted })
    return audioRef.current
  }
  useEffect(() => { audioRef.current?.setVolumes({ effects: volume, music: music.volume, musicMuted: music.muted }) }, [volume, music.volume, music.muted])
  useEffect(() => () => {
    audioRef.current?.close()
    audioRef.current = null
  }, [])
  // The screen's music, and the sheets ducking it. The fight's own music
  // changes (victory, game over) arrive as cues from the sim's events.
  useEffect(() => {
    const bank = audio()
    if (screen === "title") { bank.preload("ui"); bank.music("title") }
    else if (screen === "select" || screen === "ladder") bank.music("select")
  }, [screen])
  useEffect(() => { audio().duck(paused) }, [paused])
  useEffect(() => {
    setTouchMode(typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
  }, [])
  useEffect(() => { setBernardUnlocked(loadBernardUnlock()) }, [])

  const leave = useCallback(() => {
    onExitRef.current()
  }, [])

  const labels = labelsFor(mode)

  const unlockBernard = useCallback(() => {
    if (bernardUnlockedRef.current) return
    saveBernardUnlock()
    setBernardUnlocked(true)
    audio().sfx("unlock_jingle")
  }, [])
  const unlockBernardRef = useRef(unlockBernard)
  unlockBernardRef.current = unlockBernard
  const konami = useMemo(() => createKonamiDetector(() => {
    track("arcade.bernard_konami_unlocked", { already_unlocked: bernardUnlockedRef.current })
    unlockBernardRef.current()
  }), [])

  // ------------------------------------------------------------ menus

  const startSelect = useCallback((next: Mode) => {
    audio().sfx("select_confirm")
    setMode(next)
    setCursor([0, next === "boss" ? BERNARD_INDEX : 1])
    setLocked(next === "boss" ? [false, true] : [false, false])
    setResult(null)
    setLadder(null)
    setPaused(false)
    setScreen("select")
  }, [])

  const moveCursor = useCallback((slot: 0 | 1, delta: number) => {
    if (lockedRef.current[slot]) return
    audio().sfx("select_move")
    setCursor((c) => {
      const next: [number, number] = [c[0], c[1]]
      next[slot] = (c[slot] + delta + CHARACTERS.length) % CHARACTERS.length
      return next
    })
  }, [])

  const lockIn = useCallback((slot: 0 | 1) => {
    if (lockedRef.current[slot]) return
    const retryOpponent = modeRef.current === "cpu" ? ladderRef.current?.opponents[ladderRef.current.fightIndex] : undefined
    if ((slot === 0 && CHARACTERS[cursorRef.current[slot]]?.id === retryOpponent)
      || (!bernardUnlockedRef.current && CHARACTERS[cursorRef.current[slot]]?.id === "bernard")) {
      audio().sfx("select_move")
      return
    }
    audio().sfx("select_confirm")
    setLocked((l) => {
      const next: [boolean, boolean] = [l[0], l[1]]
      next[slot] = true
      return next
    })
  }, [])

  const unlock = useCallback((slot: 0 | 1) => {
    if (!lockedRef.current[slot]) return
    audio().sfx("select_move")
    setLocked((l) => {
      const next: [boolean, boolean] = [l[0], l[1]]
      next[slot] = false
      return next
    })
  }, [])

  // Both sides locked → the fight starts. The CPU picks for itself, once,
  // the moment 1P locks in; the second pass through here sees both locks.
  useEffect(() => {
    if (screen !== "select") return
    if (mode === "cpu" && locked[0] && !locked[1]) {
      const run = ladderRef.current ?? { opponents: buildCpuLadder(CHARACTERS[cursorRef.current[0]]!.id), fightIndex: 0 }
      const pick = CHARACTERS.findIndex((fighter) => fighter.id === run.opponents[run.fightIndex])
      setLadder(run)
      setCursor((c) => [c[0], pick])
      setLocked([true, true])
      return
    }
    if (!(locked[0] && locked[1])) return
    audio().sfx("versus_sting")
    audio().preload("fight", [CHARACTERS[cursor[0]]!.id, CHARACTERS[cursor[1]]!.id])
    const id = window.setTimeout(() => setScreen(mode === "cpu" ? "ladder" : "fight"), VERSUS_MS)
    return () => window.clearTimeout(id)
  }, [locked, mode, screen, cursor])

  // ------------------------------------------------------------ the fight

  const fightRef = useRef<{ state: FightState; renderer: FightRenderer } | null>(null)
  const [fightKey, setFightKey] = useState(0)

  useEffect(() => {
    if (screen !== "fight") return
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: FightRenderer
    try {
      renderer = createFightRenderer(canvas)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The cabinet's screen could not start.")
      return
    }
    const p1 = CHARACTERS[cursorRef.current[0]]!.id as CharacterId
    const activeLadder = modeRef.current === "cpu" ? ladderRef.current : null
    const p2 = activeLadder?.opponents[activeLadder.fightIndex] ?? CHARACTERS[cursorRef.current[1]]!.id as CharacterId
    const bossMatch = modeRef.current === "boss" || (activeLadder !== null && activeLadder.fightIndex === activeLadder.opponents.length - 1 && p2 === "bernard")
    const stage = bossMatch ? NEWSROOM_STAGE : GAME_ROOM_STAGE
    const state = createFight(p1, p2, bossMatch ? { bossSlot: 1 } : undefined)
    track("arcade.match_started", { mode: modeRef.current, p1, p2, boss: bossMatch })
    if (bossMatch) track("arcade.bernard_boss_reached", { mode: modeRef.current })
    fightRef.current = { state, renderer }
    const cpu = modeRef.current === "versus" ? null : createCpu(1)
    const bank = audio()
    // Ladder opponents change without revisiting character selection.
    bank.preload("fight", [p1, p2])
    const cueContext = { mode: modeRef.current === "boss" ? "cpu" : modeRef.current, takes: (fighter: CharacterId, line: Parameters<typeof bank.takes>[1]) => bank.takes(fighter, line), random: Math.random }
    pads.current[0].clear()
    pads.current[1].clear()
    setResult(null)
    setPaused(false)
    setRound(1)
    let raf = 0
    let previous = 0
    let carry = 0
    let finished = false
    let lastRound = 1
    let cancelled = false

    const frame = (now: number) => {
      if (!fightRef.current) return
      const dt = previous ? Math.min(now - previous, 120) : STEP_MS
      previous = now
      if (!pausedRef.current && !finished) {
        carry += dt
        let steps = 0
        while (carry >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
          const inputs: [FightInput, FightInput] = [
            pads.current[0].take(),
            cpu ? cpu.next(state, STEP_MS) : pads.current[1].take(),
          ]
          if (state.fighters[0].id === "bernard" && inputs[0].sp && bernardTouchSpecial.current) {
            inputs[0].specialId = bernardTouchSpecial.current
          }
          stepFight(state, inputs, STEP_MS)
          for (const event of state.events) {
            renderer.onEvent(event)
            for (const cue of cuesForEvent(event, state, cueContext)) bank.cue(cue)
          }
          if (state.round !== lastRound) {
            lastRound = state.round
            setRound(state.round)
          }
          if (state.phase === "matchover" && !finished) {
            finished = true
            if (bossMatch && state.matchWinner === 0) {
              track("arcade.bernard_boss_beaten", { mode: modeRef.current })
              unlockBernardRef.current()
            }
            const hasNextLadderFight = activeLadder !== null && state.matchWinner === 0 && activeLadder.fightIndex < activeLadder.opponents.length - 1
            window.setTimeout(() => setResult({ winner: state.matchWinner, hasNextLadderFight, fightNumber: (activeLadder?.fightIndex ?? 0) + 1 }), 1600)
          }
          carry -= STEP_MS
          steps += 1
        }
        if (steps === MAX_STEPS_PER_FRAME) carry = 0
      }
      renderer.render(state, now, labelsFor(modeRef.current))
      raf = requestAnimationFrame(frame)
    }
    // The fighters' art first, so the bell never rings over blank space; a
    // slow or failed download starts the fight anyway, on the puppets.
    setLoadingSprites(true)
    const timeout = new Promise<[Record<string, never>, Record<string, never>]>((resolve) => window.setTimeout(() => resolve([{}, {}]), SPRITE_LOAD_TIMEOUT_MS))
    void Promise.race([Promise.all([loadFighterSprites([p1, p2]), loadStageImages(stage)]), timeout]).then(([images, stageImages]) => {
      if (cancelled) return
      renderer.setSprites(images)
      renderer.setStage(stageImages, stage)
      setLoadingSprites(false)
      raf = requestAnimationFrame(frame)
    })
    const onResize = () => renderer.resize()
    window.addEventListener("resize", onResize)
    const onHidden = () => { if (document.hidden && state.phase !== "matchover") setPaused(true) }
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onHidden)
      renderer.dispose()
      fightRef.current = null
    }
  }, [screen, fightKey])

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    // Keep title-screen inputs independent of the last mode: B must remain
    // available for the Konami code after returning from versus selection.
    const p1Keys = () => modeRef.current === "versus" && screenRef.current !== "title" ? P1_VERSUS_KEYS : P1_KEYS
    const onKeyDown = (event: KeyboardEvent) => {
      const current = screenRef.current
      const code = codeOf(event)
      const p1 = p1Keys()[code]
      const p2 = P2_KEYS[code]
      const isGameKey = p1 !== undefined || p2 !== undefined || code === "Escape" || code === "Enter" || code === "Space"
      const konamiToken = current === "title" ? konamiTokenForKey(event.key) : null
      if (!isGameKey && !konamiToken) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return

      if (welcomeRef.current) {
        if (code === "Enter" || code === "Space") dismissWelcome()
        return
      }
      if (current === "title") {
        if (konamiToken) konami.push(konamiToken)
        if (code === "Escape") { leave(); return }
        if (code === "Enter" || code === "Space" || (p1 && isButton(p1)) || (p2 && isButton(p2))) startSelect("cpu")
        return
      }
      if (current === "select") {
        if (code === "Escape") {
          if (lockedRef.current[0] || lockedRef.current[1]) { unlock(0); unlock(1) } else { audio().sfx("select_move"); setScreen("title") }
          return
        }
        const act = (slot: 0 | 1, what: Dir | Button | undefined) => {
          if (!what) return
          if (what === "left") moveCursor(slot, -1)
          else if (what === "right") moveCursor(slot, 1)
          else if (what === "up") moveCursor(slot, -3)
          else if (what === "down") moveCursor(slot, 3)
          else lockIn(slot)
        }
        if (code === "Enter" || code === "Space") { lockIn(0); return }
        act(0, p1)
        if (modeRef.current === "versus") act(1, p2)
        return
      }
      if (current === "ladder") {
        if (code === "Escape") { setLadder(null); setLocked([false, false]); setScreen("select") }
        else if (code === "Enter" || code === "Space" || (p1 && isButton(p1))) { audio().sfx("versus_sting"); setScreen("fight") }
        return
      }
      // fight
      if (code === "Escape") {
        if (fightRef.current?.state.phase === "matchover") return
        audio().sfx("pause")
        setPaused((p) => !p)
        pads.current[0].clear()
        pads.current[1].clear()
        return
      }
      if (pausedRef.current) return
      if (p1) pads.current[0].down(p1)
      if (p2 && modeRef.current === "versus") pads.current[1].down(p2)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const code = codeOf(event)
      const p1 = p1Keys()[code]
      const p2 = P2_KEYS[code]
      if (p1) pads.current[0].up(p1)
      if (p2) pads.current[1].up(p2)
    }
    const onBlur = () => {
      pads.current[0].clear()
      pads.current[1].clear()
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [dismissWelcome, leave, lockIn, moveCursor, startSelect, unlock])

  // ------------------------------------------------------------ touch pad

  const padButton = (what: Dir | Button, label: string, className: string, aria: string) => (
    <button
      key={what}
      type="button"
      className={`ar-pad-btn ${className}`}
      aria-label={aria}
      onPointerDown={(event) => {
        event.preventDefault()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* gone */ }
        pads.current[0].down(what)
      }}
      onPointerUp={() => pads.current[0].up(what)}
      onPointerCancel={() => pads.current[0].up(what)}
      onLostPointerCapture={() => pads.current[0].up(what)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  )

  const rematch = () => {
    audio().sfx("select_confirm")
    setResult(null)
    setPaused(false)
    if (mode === "cpu" && ladder) setScreen("ladder")
    else setFightKey((k) => k + 1)
  }
  const nextLadderFight = () => {
    audio().sfx("select_confirm")
    setLadder((current) => current ? { ...current, fightIndex: current.fightIndex + 1 } : current)
    setResult(null)
    setPaused(false)
    setScreen("ladder")
  }
  const chooseFighter = (preserveRun = false) => {
    audio().sfx("select_move")
    setResult(null)
    setPaused(false)
    setLocked([false, false])
    if (!preserveRun) setLadder(null)
    setScreen("select")
  }

  // ------------------------------------------------------------ render

  const selectedP1 = CHARACTERS[cursor[0]]!
  const retryOpponent = mode === "cpu" ? ladder?.opponents[ladder.fightIndex] : undefined
  const selectedOpponent = selectedP1.id === retryOpponent
  const selectedP1Locked = (selectedP1.id === "bernard" && !bernardUnlocked) || selectedOpponent

  return (
    <div className="ar-root" role="dialog" aria-modal="true" aria-label="Impact Hackers arcade cabinet">
      <div className="ar-bezel">
        <div className="ar-screen">
          {screen === "fight" && !error && (
            <canvas ref={canvasRef} className="ar-canvas" aria-label={`Fight: ${labels[0]} versus ${labels[1]}, round ${round}`} />
          )}
          {screen === "fight" && !error && loadingSprites && (
            <p className="ar-loading" role="status">LOADING FIGHTERS…</p>
          )}
          <div className="ar-scanlines" aria-hidden="true" />

          {welcome && (
            <section className="ar-panel ar-welcome" role="alertdialog" aria-modal="true" aria-labelledby="arcade-welcome-title" aria-describedby="arcade-welcome-message" style={{ backgroundImage: `url(${UI_ART.screens.title.url})` }}>
              <div className="ar-welcome-card">
                <h1 id="arcade-welcome-title">Welcome to Impact Hackers</h1>
                <div id="arcade-welcome-message">
                  <p>Fight and win against two opponents to face the secret boss.</p>
                  <p>This game is best played with sound or headphones.</p>
                </div>
                <button autoFocus className="ar-button ar-primary" onClick={dismissWelcome}>OK</button>
              </div>
            </section>
          )}

          {screen === "title" && !welcome && (
            <section className="ar-panel ar-title" style={{ backgroundImage: `url(${UI_ART.screens.title.url})` }}>
              {/* The art carries the title; the heading stays for readers. */}
              <h1 className="ar-sr-only">Impact Hackers</h1>
              <div className="ar-title-menu">
              <span className="ar-eyebrow">FIVE TRADERS · FINAL BOSS · BEST OF THREE</span>
              <div className="ar-actions">
                <button autoFocus className="ar-button ar-primary" onClick={() => startSelect("cpu")}>1P VS CPU <span aria-hidden="true">→</span></button>
                {!touchMode && <button className="ar-button" onClick={() => startSelect("versus")}>2P VERSUS (one keyboard)</button>}
                <button className="ar-button" onClick={leave}>Walk away</button>
              </div>
              {!touchMode && (
                <p className="ar-fine">
                  SOLO: WASD move · U/I punch · J/K kick · O special<br />
                  2P VERSUS — 1P: WASD · F/G punch · V/B kick · R special &nbsp;·&nbsp; 2P: arrows · U/I punch · J/K kick · O special<br />
                  Energy starts full each round. Hit or get hit to refill energy. Specials spend energy; low health fills it faster. Hold back to block. ESC pauses.
                </p>
              )}
              {touchMode && <p className="ar-fine">D-pad to move · tap to attack · energy starts full each round · hits refill energy · SP spends energy · hold back to block</p>}
              {bernardUnlocked && <BernardMoveList />}
              {bernardUnlocked && <p className="ar-unlock">BERNARD UNLOCKED</p>}
              </div>
            </section>
          )}

          {screen === "select" && (
            <section className="ar-panel ar-select" aria-label="Choose your fighter" style={{ backgroundImage: `url(${UI_ART.screens.select.url})` }}>
              <span className="ar-eyebrow">{mode === "cpu" ? "1P — CHOOSE YOUR FIGHTER" : mode === "boss" ? "FINAL BOSS — CHOOSE YOUR FIGHTER" : "1P LEFT SIDE · 2P RIGHT SIDE — CHOOSE YOUR FIGHTERS"}</span>
              <div className="ar-grid" role="list">
                {CHARACTERS.map((c, i) => {
                  const isLockedBoss = c.id === "bernard" && !bernardUnlocked
                  const isOpponent = c.id === retryOpponent
                  const p1Here = cursor[0] === i
                  const p2Here = (mode === "versus" || mode === "boss") && cursor[1] === i
                  return (
                    <div
                      key={c.id}
                      role="listitem"
                      aria-label={isLockedBoss ? "??? — locked fighter" : c.name}
                      aria-disabled={isLockedBoss || isOpponent}
                      className={`ar-card${isOpponent ? " ar-card-opponent" : ""}${isLockedBoss ? " ar-card-secret" : ""}${p1Here ? " ar-card-p1" : ""}${p2Here ? " ar-card-p2" : ""}${(p1Here && locked[0]) || (p2Here && locked[1]) ? " ar-card-locked" : ""}`}
                      style={{ "--body": c.palette.body, "--trim": c.palette.trim, "--accent": c.palette.accent, "--skin": c.palette.skin } as React.CSSProperties}
                      onClick={() => {
                        if (locked[0] || isLockedBoss || isOpponent) return
                        if (cursor[0] === i) lockIn(0)
                        else { audio().sfx("select_move"); setCursor((cur) => [i, cur[1]]) }
                      }}
                    >
                      <div className="ar-portrait" style={portraitStyle(c.id)} aria-hidden="true" />
                      {isLockedBoss ? <>
                        <b>???</b>
                        <span className="ar-card-title">???</span>
                        <span className="ar-card-tag">CLASSIFIED</span>
                        <span className="ar-card-special"><em>CLASSIFIED</em></span>
                      </> : <>
                        <b>{c.name}</b>
                        <span className="ar-card-title">{c.title}</span>
                        <span className="ar-card-tag">{c.tagline}</span>
                        <span className="ar-card-special"><em>{c.specialName}</em> — {c.specialHint} · {c.moves.special.energyCost ?? 0} energy</span>
                        {c.moves.specialUp && <span className="ar-card-special"><em>UP + SPECIAL</em> — {c.moves.specialUp.label} · {c.moves.specialUp.energyCost ?? 0} energy</span>}
                        <span className="ar-card-stats">HP {c.maxHealth} · SPEED {Math.round(c.walkSpeed / 20)} · {c.energyBars} ENERGY {c.energyBars === 1 ? "BAR" : "BARS"}</span>
                      </>}
                      {isOpponent && <span className="ar-opponent-label">CURRENT OPPONENT</span>}
                      {p1Here && <span className="ar-tag ar-tag-p1">1P</span>}
                      {p2Here && <span className="ar-tag ar-tag-p2">{mode === "boss" ? "BOSS" : "2P"}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="ar-actions">
                <button className="ar-button ar-primary" onClick={() => lockIn(0)} disabled={locked[0] || selectedP1Locked}>
                  {locked[0] ? (mode === "cpu" || locked[1] ? "READY…" : "WAITING FOR 2P") : selectedOpponent ? "CURRENT OPPONENT" : selectedP1Locked ? "BOSS LOCKED — CHALLENGE HIM" : `LOCK IN ${selectedP1.name}`}
                </button>
                <button className="ar-button" onClick={() => { audio().sfx("select_move"); setScreen("title") }}>Back</button>
              </div>
              <p className="ar-fine">{touchMode ? "Tap a fighter, tap again to lock in." : "Move with the stick, any attack button locks in. ESC backs out."}</p>
              {!touchMode && mode === "versus" && <p className="ar-fine">1P: WASD to choose · F to lock in. 2P: arrows to choose · U to lock in.</p>}
              <p className="ar-fine">Energy starts full each round. Land hits or take hits to refill it; specials spend it.</p>
              {bernardUnlocked && (cursor[0] === BERNARD_INDEX || (mode === "versus" && cursor[1] === BERNARD_INDEX)) && <BernardMoveList />}
              {mode === "cpu" && <p className="ar-run-status">{ladder ? `RETRY FIGHT ${ladder.fightIndex + 1} · CHOOSE ANY FIGHTER EXCEPT YOUR OPPONENT` : "ARCADE RUN · THREE FIGHTS · BERNARD WAITS AT THE END"}</p>}
              {locked[0] && locked[1] && (
                <div className="ar-versus" aria-label={`${CHARACTERS[cursor[0]]!.name} versus ${CHARACTERS[cursor[1]]!.name}`}>
                  <div className="ar-versus-side" style={portraitStyle(CHARACTERS[cursor[0]]!.id)}>
                    <b>{labels[0]}</b><span>{CHARACTERS[cursor[0]]!.name}</span>
                  </div>
                  <em>VS</em>
                  <div className="ar-versus-side ar-versus-right" style={portraitStyle(CHARACTERS[cursor[1]]!.id)}>
                    <b>{labels[1]}</b><span>{CHARACTERS[cursor[1]]!.name}</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {screen === "ladder" && ladder && (
            <section className="ar-panel ar-ladder" aria-label="Arcade ladder" style={{ backgroundImage: `url(${UI_ART.screens.select.url})` }}>
              <span className="ar-eyebrow">ARCADE RUN · {selectedP1.name}</span>
              <h1>THE ROAD TO VICTORY</h1>
              <p className="ar-intro">FIGHT {ladder.fightIndex + 1} OF {ladder.opponents.length} · YOUR NEXT CHALLENGER</p>
              <ol className="ar-ladder-path">
                {ladder.opponents.map((id, index) => {
                  const fighter = CHARACTERS.find(c => c.id === id)!
                  const current = index === ladder.fightIndex
                  const cleared = index < ladder.fightIndex
                  const lockedBoss = id === "bernard" && !bernardUnlocked
                  return <li key={`${index}-${id}`} className={`ar-ladder-stop${lockedBoss ? " ar-ladder-secret" : ""}${current ? " ar-ladder-current" : ""}${cleared ? " ar-ladder-cleared" : ""}`} aria-current={current ? "step" : undefined}>
                    <span className="ar-ladder-number">0{index + 1}</span>
                    <div className="ar-ladder-portrait" style={portraitStyle(id)} aria-hidden="true" />
                    <div className="ar-ladder-caption"><span>{cleared ? "CLEARED" : current ? "UP NEXT" : "COMING UP"}</span><h2>{lockedBoss ? "???" : fighter.name}</h2><p>{lockedBoss ? "CLASSIFIED" : index === 2 ? "THE NEWSROOM" : "THE GAME ROOM"}</p></div>
                  </li>
                })}
              </ol>
              <div className="ar-actions">
                <button autoFocus className="ar-button ar-primary" onClick={() => { audio().sfx("versus_sting"); setScreen("fight") }}>START FIGHT {ladder.fightIndex + 1}</button>
                <button className="ar-button" onClick={() => startSelect("cpu")}>Quit run</button>
              </div>
            </section>
          )}

          {screen === "fight" && error && (
            <section className="ar-panel">
              <span className="ar-eyebrow">SCREEN BURN</span>
              <h1>NO PICTURE</h1>
              <p className="ar-intro">{error}</p>
              <div className="ar-actions">
                <button className="ar-button ar-primary" onClick={() => { setError(null); setScreen("select") }}>Back to select</button>
                <button className="ar-button" onClick={leave}>Walk away</button>
              </div>
            </section>
          )}

          {screen === "fight" && !error && paused && !result && (
            <section className="ar-panel ar-sheet" aria-label="Paused">
              <span className="ar-eyebrow">PAUSED</span>
              <h1>TIME OUT</h1>
              {bernardUnlocked && (cursor[0] === BERNARD_INDEX || (mode === "versus" && cursor[1] === BERNARD_INDEX)) && <BernardMoveList />}
              <div className="ar-actions">
                <button autoFocus className="ar-button ar-primary" onClick={() => { audio().sfx("select_confirm"); setPaused(false) }}>Resume</button>
                <button className="ar-button" onClick={() => chooseFighter()}>{mode === "cpu" ? "Quit run" : "Choose fighter"}</button>
                <button className="ar-button" onClick={leave}>Walk away</button>
              </div>
            </section>
          )}

          {screen === "fight" && !error && result && (
            <section className="ar-panel ar-sheet" aria-label="Match result">
              <span className="ar-eyebrow">MATCH OVER</span>
              <h1>{result.hasNextLadderFight ? `FIGHT ${result.fightNumber} CLEARED` : result.winner === null ? "DRAW GAME" : `${labels[result.winner]} WINS`}</h1>
              <div className="ar-actions">
                {result.hasNextLadderFight
                  ? <button autoFocus className="ar-button ar-primary" onClick={nextLadderFight}>CONTINUE TO FIGHT {result.fightNumber + 1}</button>
                  : <button autoFocus className="ar-button ar-primary" onClick={rematch}>Rematch</button>}
                <button className="ar-button" onClick={() => chooseFighter(mode === "cpu" && result.winner !== 0)}>Choose fighter</button>
                {mode === "cpu" && <button className="ar-button" onClick={() => startSelect("cpu")}>Quit run</button>}
                <button className="ar-button" onClick={leave}>Walk away</button>
              </div>
            </section>
          )}
        </div>

        {screen === "fight" && !error && !touchMode && (
          <footer className="ar-legend" aria-label="Move list">
            <div className="ar-legend-row">
              <b>1P</b>
              <span><b>A / D</b> MOVE</span>
              <span><b>W</b> JUMP · <b>S</b> CROUCH</span>
              <span><b>{mode === "versus" ? "F / G" : "U / I"}</b> LIGHT / HEAVY PUNCH</span>
              <span><b>{mode === "versus" ? "V / B" : "J / K"}</b> LIGHT / HEAVY KICK</span>
              <span><b>{mode === "versus" ? "R" : "O"}</b> SPECIAL</span>
            </div>
            {mode === "versus" && <div className="ar-legend-row ar-legend-p2">
              <b>2P</b>
              <span><b>← / →</b> MOVE</span>
              <span><b>↑</b> JUMP · <b>↓</b> CROUCH</span>
              <span><b>U / I</b> LIGHT / HEAVY PUNCH</span>
              <span><b>J / K</b> LIGHT / HEAVY KICK</span>
              <span><b>O</b> SPECIAL</span>
            </div>}
            <div className="ar-legend-row ar-legend-help">
              <span>HOLD BACK TO BLOCK</span>
              <span>SPECIALS COST ENERGY</span>
              <span><b>ESC</b> PAUSE</span>
              {bernardUnlocked && (cursor[0] === BERNARD_INDEX || (mode === "versus" && cursor[1] === BERNARD_INDEX)) && <span><b>ESC</b> BERNARD MOVE LIST</span>}
            </div>
          </footer>
        )}
      </div>

      {screen === "fight" && !error && touchMode && !paused && !result && (
        <div className="ar-touch" aria-label="Touch controls">
          <div className="ar-dpad">
            {padButton("up", "▲", "ar-dpad-up", "Jump")}
            {padButton("left", "◀", "ar-dpad-left", "Move left")}
            {padButton("down", "▼", "ar-dpad-down", "Crouch")}
            {padButton("right", "▶", "ar-dpad-right", "Move right")}
          </div>
          <div className="ar-buttons">
            {cursor[0] === BERNARD_INDEX && <select className="ar-special-select" aria-label="Bernard special move" defaultValue={bernardTouchSpecial.current} onChange={event => { bernardTouchSpecial.current = event.target.value }}>
              <option value="">Direction + SP</option>
              {BERNARD_MOVES.map(([key]) => <option key={key} value={bernardMoves[key]!.id}>{bernardMoves[key]!.label} · {bernardMoves[key]!.energyCost}</option>)}
            </select>}
            {padButton("lp", "LP", "ar-btn-lp", "Light punch")}
            {padButton("hp", "HP", "ar-btn-hp", "Heavy punch")}
            {padButton("lk", "LK", "ar-btn-lk", "Light kick")}
            {padButton("hk", "HK", "ar-btn-hk", "Heavy kick")}
            {padButton("sp", "SP", "ar-btn-sp", "Special move")}
          </div>
          <button type="button" className="ar-pause" aria-label="Pause" onClick={() => setPaused(true)}>Ⅱ</button>
        </div>
      )}
    </div>
  )
}
