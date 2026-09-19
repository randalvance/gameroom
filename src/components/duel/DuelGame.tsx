// The duel over the room: deck select → board → result. DOM cards (buttons),
// so touch, keyboard and the tests all drive the same controls. The rules live
// in duel-sim.ts and the house in duel-ai.ts; this file only sequences them
// and draws the state. Keys are captured on window and stopped so nothing
// walks the character in the room underneath.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { track } from "~/lib/analytics"
import type { Card, DeckId } from "./cards"
import { spellTargeting } from "./cards"
import { CARD_ART, CARD_BACK, DECK_ART, MANA_CRYSTAL, PLAYMAT } from "./card-art.generated"
import { DECKS, DECK_BY_ID } from "./decks"
import { houseBlocks, houseNextMainAction } from "./duel-ai"
import { creatureKey, fxClasses, playerKey, useDuelEffects, type FxItem } from "./duel-effects"
import { cuesForEvents } from "./audio-cues"
import { KEYWORD_LABEL, effectText, inspectDetails, useCardInspect, type InspectTarget } from "./duel-inspect"
import { duelHint, worthPlaying } from "./duel-hints"
import { combatMarks, type CombatLink, type CombatMarks } from "./duel-combat"
import { createDuelAudio, type DuelAudio } from "./duel-audio"
import {
  canAttack, canBlock, castable, createDuel, declareAttackers, declareBlocks, effectivePower, effectiveToughness,
  endTurn, legalTargets, playCard, type Creature, type DuelState, type Side, type Target,
} from "./duel-sim"
import "./duel.css"

/** How long the house pauses between its moves, so each can be read. */
export const HOUSE_STEP_MS = 600

export interface DuelGameProps {
  houseDeck: DeckId
  houseName: string
  /** Fixed shuffle seed; tests pass one, the room leaves it to the clock. */
  seed?: number
  /** The site's effects volume, 0..1; the music sits under it. */
  volume?: number
  onExit: () => void
  onWin: (houseDeck: DeckId) => void
  /** Test-only: the house's opening life. */
  debugHouseLife?: number
}

type Screen = "select" | "board" | "result"

/** Hints are on until a player turns them off; the choice is theirs, per browser. */
const HINTS_KEY = "duel.hints"
function readHintsOn(): boolean {
  try { return window.localStorage.getItem(HINTS_KEY) !== "off" } catch { return true }
}
function saveHintsOn(on: boolean) {
  try { window.localStorage.setItem(HINTS_KEY, on ? "on" : "off") } catch { /* private window: this visit only */ }
}

function CardFace({ card, creature }: { card: Card; creature?: Creature }) {
  const power = creature ? effectivePower(creature) : card.kind === "creature" ? card.power : null
  const toughness = creature ? effectiveToughness(creature) - creature.damage : card.kind === "creature" ? card.toughness : null
  return (
    <span className={`duel-face duel-face--${card.deck}`}>
      <span className="duel-cost" aria-hidden="true">{card.cost}</span>
      <img className="duel-art" src={CARD_ART[card.id]} alt="" draggable={false} />
      <span className="duel-name">{card.name}</span>
      <span className="duel-text">
        {card.kind === "creature"
          ? (card.keyword ? KEYWORD_LABEL[card.keyword] : " ")
          : effectText(card.effect)}
      </span>
      {power !== null && (
        <span className={`duel-pt${creature && creature.damage > 0 ? " duel-pt--hurt" : ""}`} aria-hidden="true">{power}/{toughness}</span>
      )}
    </span>
  )
}

/** The enlarged card and its explanation, shown while a card is held. */
function InspectOverlay({ target, state }: { target: InspectTarget; state: DuelState | null }) {
  const d = inspectDetails(target, state ?? undefined)
  return (
    <div className="duel-inspect" role="dialog" aria-label={`Card details: ${d.title}`}>
      <div className="duel-inspect-card" aria-hidden="true">
        <CardFace card={target.card} creature={target.creature} />
      </div>
      <div className="duel-inspect-panel">
        <h2 className="duel-inspect-title">{d.title}</h2>
        <p className="duel-inspect-type">{d.typeLine}{d.stats ? ` · ${d.stats}` : ""}</p>
        <ul className="duel-inspect-lines">
          {d.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="duel-inspect-flavor">{d.flavor}</p>
      </div>
    </div>
  )
}

/** The numbers that float off a card or life badge. */
function FxFloats({ items }: { items: readonly FxItem[] }) {
  return (
    <>
      {items.map((i, n) => {
        if (i.kind === "hit") return <span key={`${i.id}-${n}`} className="duel-float duel-float--hit" aria-hidden="true">{i.text}</span>
        if (i.kind === "glow") return <span key={`${i.id}-${n}`} className={`duel-float duel-float--${i.tone}`} aria-hidden="true">{i.text}</span>
        return null
      })}
    </>
  )
}

const SWORD = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3H21v6.5l-9.8 9.8 1.4 1.4-1.4 1.4-2.1-2.1-3.4 3.4-1.4-1.4 3.4-3.4-2.1-2.1 1.4-1.4 1.4 1.4L14.5 3Zm1 2-8.5 8.5 3.5 3.5L19 8.5V5h-3.5Z" fill="currentColor"/></svg>
)
const SHIELD = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 2.2 6 2.2V11c0 3.9-2.5 7.4-6 8.8-3.5-1.4-6-4.9-6-8.8V6.4l6-2.2Z" fill="currentColor"/></svg>
)

/** The sword and shield worn by a creature in combat. */
function CombatBadges({ uid, marks }: { uid: number; marks: CombatMarks | null }) {
  if (!marks) return null
  return (
    <>
      {marks.attacking.has(uid) && <span className="duel-badge duel-badge--attack" title="Attacking">{SWORD}</span>}
      {marks.blocking.has(uid) && <span className="duel-badge duel-badge--block" title="Blocking">{SHIELD}</span>}
    </>
  )
}

/**
 * Lines from each blocker to the attacker it blocks, measured off the cards
 * themselves (data-uid) so they follow the layout at any size and track the
 * cards while they lunge.
 */
function CombatLines({ links, rootRef }: { links: readonly CombatLink[]; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const [segments, setSegments] = useState<Array<CombatLink & { x1: number; y1: number; x2: number; y2: number }>>([])
  const key = links.map((l) => `${l.blocker}-${l.attacker}-${l.kind}`).join(",")
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || links.length === 0) { setSegments([]); return }
    let frame = 0
    const measure = () => {
      const base = root.getBoundingClientRect()
      const centre = (uid: number) => {
        const el = root.querySelector(`[data-uid="${uid}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 }
      }
      const next = links.flatMap((l) => {
        const b = centre(l.blocker), a = centre(l.attacker)
        return a && b ? [{ ...l, x1: b.x, y1: b.y, x2: a.x, y2: a.y }] : []
      })
      setSegments(next)
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    return () => window.cancelAnimationFrame(frame)
  }, [key, rootRef])
  if (links.length === 0) return null
  return (
    <svg className="duel-lines" aria-hidden="true">
      {segments.map((l) => (
        <g key={`${l.blocker}-${l.attacker}`} className={`duel-link duel-link--${l.kind}`} data-blocker={l.blocker} data-attacker={l.attacker}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="duel-link-glow" />
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="duel-link-line" />
          <circle cx={l.x1} cy={l.y1} r="7" className="duel-link-end duel-link-end--block" />
          <circle cx={l.x2} cy={l.y2} r="7" className="duel-link-end duel-link-end--attack" />
        </g>
      ))}
    </svg>
  )
}

/** Live creature buttons with the ghosts of the just-departed slotted where they stood. */
function withGhosts(nodes: React.ReactNode[], ghosts: readonly FxItem[]): React.ReactNode[] {
  const out = nodes.slice()
  const sorted = ghosts.filter((g): g is Extract<FxItem, { kind: "ghost" }> => g.kind === "ghost").sort((a, b) => a.index - b.index)
  for (const g of sorted) {
    out.splice(Math.min(g.index, out.length), 0, (
      <div key={`ghost-${g.id}-${g.key}`} className={`duel-card duel-ghost duel-ghost--${g.tone}`} data-uid={g.key.slice(2)} aria-hidden="true">
        <CardFace card={g.card} />
      </div>
    ))
  }
  return out
}

export default function DuelGame({ houseDeck, houseName, seed, volume = 0.7, onExit, onWin, debugHouseLife }: DuelGameProps) {
  const [screen, setScreen] = useState<Screen>("select")
  const [state, setState] = useState<DuelState | null>(null)
  const [pendingSpell, setPendingSpell] = useState<number | null>(null)
  const [chosenAttackers, setChosenAttackers] = useState<number[]>([])
  const [blockAssign, setBlockAssign] = useState<Record<number, number>>({})
  const [pendingBlocker, setPendingBlocker] = useState<number | null>(null)
  const [hintsOn, setHintsOn] = useState(readHintsOn)
  const { inspecting, setInspecting, bind: holdToInspect } = useCardInspect()
  /** What each focusable card is, for the keyboard's I key. */
  const inspectables = useRef(new Map<string, InspectTarget>())
  const toggleHints = () => setHintsOn((on) => { saveHintsOn(!on); return !on })
  const rootRef = useRef<HTMLDivElement>(null)
  const onWinRef = useRef(onWin)
  onWinRef.current = onWin

  const house = DECK_BY_ID[houseDeck]
  /** You sit down on the house's turf: its faction's playmat is the field. */
  const mat = { backgroundImage: `url(${PLAYMAT[houseDeck]})` }
  const fx = useDuelEffects(state?.events)

  /** Leaving before the end is a funnel drop-off worth counting; leaving the
   * result screen is not (the finish was already reported). */
  const leave = () => {
    if (screen === "select") track("easter_egg.duel_left", { house: houseDeck, stage: "select" })
    else if (screen === "board" && state && state.phase !== "over") {
      track("easter_egg.duel_left", { deck: state.you.deck, house: houseDeck, turn: state.turn, stage: "board" })
    }
    onExit()
  }
  const leaveRef = useRef(leave)
  leaveRef.current = leave

  // Sound: made on mount, closed on leave; the volume follows the site's.
  const audioRef = useRef<DuelAudio | null>(null)
  useEffect(() => {
    audioRef.current = createDuelAudio(volume)
    return () => { audioRef.current?.close(); audioRef.current = null }
  }, [])
  useEffect(() => { audioRef.current?.setVolume(volume) }, [volume])
  useEffect(() => {
    if (!state?.events.length) return
    for (const cue of cuesForEvents(state.events)) audioRef.current?.sfx(cue)
  }, [state?.events])
  // A bell when your turn comes round; the house draws at the start of its.
  useEffect(() => {
    if (!state || screen !== "board" || state.turn === 1) return
    audioRef.current?.sfx(state.active === "you" ? "turn" : "draw")
  }, [state?.turn, state?.active, screen])
  useEffect(() => {
    if (screen === "board") audioRef.current?.music("table")
    else if (screen === "result") audioRef.current?.music(state?.winner === "you" ? "win" : "lose")
    else audioRef.current?.music(null)
  }, [screen])
  const fxFor = (key: string) => fx.filter((i) => i.key === key)
  const castFx = fx.find((i): i is Extract<FxItem, { kind: "cast" }> => i.kind === "cast")

  const resetChoices = () => {
    setPendingSpell(null)
    setChosenAttackers([])
    setBlockAssign({})
    setPendingBlocker(null)
  }

  const startGame = (deck: DeckId) => {
    track("easter_egg.duel_started", { deck, house: houseDeck })
    audioRef.current?.sfx("confirm")
    let s = createDuel(deck, houseDeck, seed ?? (Date.now() >>> 0))
    if (debugHouseLife !== undefined) s = { ...s, house: { ...s.house, life: debugHouseLife } }
    resetChoices()
    setState(s)
    setScreen("board")
  }

  useEffect(() => { rootRef.current?.focus() }, [screen])

  // The house acts one step at a time, on a timer, so each move can be read.
  useEffect(() => {
    if (!state || screen !== "board" || state.phase === "over") return
    const houseMain = state.active === "house" && state.phase === "main"
    const houseBlocking = state.active === "you" && state.phase === "blocks"
    if (!houseMain && !houseBlocking) return
    const id = window.setTimeout(() => {
      setState((s) => {
        if (!s || s.phase === "over") return s
        if (s.active === "you" && s.phase === "blocks") return declareBlocks(s, "house", houseBlocks(s))
        if (s.active !== "house" || s.phase !== "main") return s
        const action = houseNextMainAction(s)
        if (action.kind === "play") return playCard(s, "house", action.handIdx, action.target)
        if (action.kind === "attack") return declareAttackers(s, "house", action.uids)
        return endTurn(s)
      })
    }, HOUSE_STEP_MS)
    return () => window.clearTimeout(id)
  }, [state, screen])

  // Game over: report, record a win, show the result.
  useEffect(() => {
    if (!state || screen !== "board" || state.phase !== "over") return
    const won = state.winner === "you"
    track("easter_egg.duel_finished", { deck: state.you.deck, house: houseDeck, won, turns: state.turn, reason: state.reason ?? "life" })
    if (won) onWinRef.current(houseDeck)
    setScreen("result")
  }, [state, screen, houseDeck])

  // Keys never reach the room: capture on window and stop them there.
  const inspectingRef = useRef(inspecting)
  inspectingRef.current = inspecting
  const pendingRef = useRef({ spell: pendingSpell, blocker: pendingBlocker })
  pendingRef.current = { spell: pendingSpell, blocker: pendingBlocker }
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === "i" || e.key === "I") {
        const key = (document.activeElement as HTMLElement | null)?.closest?.("[data-inspect]")?.getAttribute("data-inspect")
        const target = key ? inspectables.current.get(key) : undefined
        setInspecting((cur) => (cur ? null : target ?? null))
        return
      }
      if (e.key !== "Escape") return
      if (inspectingRef.current) { setInspecting(null); return }
      if (pendingRef.current.spell !== null || pendingRef.current.blocker !== null) {
        setPendingSpell(null)
        setPendingBlocker(null)
        return
      }
      leaveRef.current()
    }
    const stop = (e: KeyboardEvent) => e.stopPropagation()
    window.addEventListener("keydown", onKeyDown, { capture: true })
    window.addEventListener("keyup", stop, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
      window.removeEventListener("keyup", stop, { capture: true })
    }
  }, [])

  // ------------------------------------------------------------ interactions

  const yourMain = !!state && state.active === "you" && state.phase === "main"
  const houseAttacking = !!state && state.active === "house" && state.phase === "blocks"
  const pendingCard = state && pendingSpell !== null ? state.you.hand[pendingSpell] : undefined
  const targets = state && pendingCard?.kind === "spell" ? legalTargets(state, "you", pendingCard) : []
  const isTarget = (t: Target) => targets.some((x) => x.kind === t.kind && (x.kind === "creature" ? x.uid === (t as { uid: number }).uid : x.side === (t as { side: Side }).side))

  const onHandCard = (idx: number) => {
    if (!state || !yourMain || pendingSpell !== null) return
    const card = state.you.hand[idx]
    if (!card || !castable(state, "you", card)) return
    if (card.kind === "spell" && spellTargeting(card.effect) !== "none") { setPendingSpell(idx); return }
    setState(playCard(state, "you", idx))
  }
  const onTarget = (target: Target) => {
    if (pendingSpell === null) return
    setState((s) => (s ? playCard(s, "you", pendingSpell, target) : s))
    setPendingSpell(null)
  }
  const onYourCreature = (c: Creature) => {
    if (!state) return
    if (pendingSpell !== null) { if (isTarget({ kind: "creature", uid: c.uid })) onTarget({ kind: "creature", uid: c.uid }); return }
    if (yourMain && !state.attacked && canAttack(state, c)) {
      setChosenAttackers((list) => (list.includes(c.uid) ? list.filter((u) => u !== c.uid) : [...list, c.uid]))
      return
    }
    if (houseAttacking) {
      const assigned = Object.entries(blockAssign).find(([, b]) => b === c.uid)
      if (assigned) { setBlockAssign((m) => { const n = { ...m }; delete n[Number(assigned[0])]; return n }); return }
      setPendingBlocker((b) => (b === c.uid ? null : c.uid))
    }
  }
  const onHouseCreature = (c: Creature) => {
    if (!state) return
    if (pendingSpell !== null) { if (isTarget({ kind: "creature", uid: c.uid })) onTarget({ kind: "creature", uid: c.uid }); return }
    if (houseAttacking && pendingBlocker !== null && state.attackers.includes(c.uid)) {
      const blocker = state.you.board.find((b) => b.uid === pendingBlocker)
      if (blocker && canBlock(c, blocker)) {
        setBlockAssign((m) => {
          const n: Record<number, number> = {}
          for (const [a, b] of Object.entries(m)) if (b !== pendingBlocker) n[Number(a)] = b
          n[c.uid] = pendingBlocker
          return n
        })
      }
      setPendingBlocker(null)
    }
  }

  const primary = (() => {
    if (!state) return null
    if (pendingSpell !== null) return { label: "Cancel", run: () => setPendingSpell(null) }
    if (houseAttacking) return {
      label: "Confirm blocks",
      run: () => { setState((s) => (s ? declareBlocks(s, "you", blockAssign) : s)); setBlockAssign({}); setPendingBlocker(null) },
    }
    if (!yourMain) return null
    if (!state.attacked && chosenAttackers.length > 0) return {
      label: `Attack with ${chosenAttackers.length}`,
      run: () => { setState((s) => (s ? declareAttackers(s, "you", chosenAttackers) : s)); setChosenAttackers([]) },
    }
    // No attackers chosen: ending the turn holds back, in one press.
    if (!state.attacked) return {
      label: "End turn",
      run: () => { setState((s) => (s ? endTurn(declareAttackers(s, "you", [])) : s)); setChosenAttackers([]) },
    }
    return { label: "End turn", run: () => setState((s) => (s ? endTurn(s) : s)) }
  })()

  // ------------------------------------------------------------------ screens

  if (screen === "select" || !state) {
    return (
      <div ref={rootRef} tabIndex={-1} className={`duel duel--select duel--mat-${houseDeck}`} style={mat}>
        <h1 className="duel-title">TABLE STAKES</h1>
        <p className="duel-lede">{houseName} plays {house.name}. Choose your deck.</p>
        <div className="duel-decks">
          {DECKS.map((deck) => (
            <button key={deck.id} type="button" className={`duel-deck duel-deck--${deck.id}`} aria-label={`Play ${deck.name}`} onClick={() => startGame(deck.id)}>
              <img className="duel-emblem" src={DECK_ART[deck.id]} alt="" draggable={false} />
              <span className="duel-deck-name">{deck.name}</span>
              <span className="duel-deck-pitch">{deck.pitch}</span>
            </button>
          ))}
        </div>
        <details className="duel-howto" open={hintsOn}>
          <summary>How to play</summary>
          <ul>
            <li>You and the house start at 20 life. Bring the house to 0 to win.</li>
            <li>Each turn you get one more mana, up to 8. A card's cost is the number in its corner.</li>
            <li>Play creatures, then attack with them. A new creature waits a turn before attacking, unless it has Haste.</li>
            <li>The defender blocks attackers with creatures. Damage that gets through comes off life.</li>
            <li>Flying can only be blocked by flyers. Lifelink heals you. Trample pushes extra damage past a blocker.</li>
          </ul>
        </details>
        <button type="button" className="duel-btn duel-btn--quiet" onClick={leave}>Back to the room</button>
      </div>
    )
  }

  if (screen === "result") {
    const won = state.winner === "you"
    return (
      <div ref={rootRef} tabIndex={-1} className={`duel duel--result duel--mat-${houseDeck}`} style={mat}>
        <h1 className="duel-title">{won ? "You win!" : "The house wins."}</h1>
        <p className="duel-lede">
          {state.reason === "deck"
            ? (won ? `${houseName} ran out of cards.` : "You ran out of cards.")
            : (won ? `${houseName} is out of life after ${state.turn} turns.` : `You are out of life after ${state.turn} turns.`)}
        </p>
        <div className="duel-actions">
          <button type="button" className="duel-btn" onClick={() => { setScreen("select"); setState(null) }}>Play again</button>
          <button type="button" className="duel-btn duel-btn--quiet" onClick={onExit}>Back to the room</button>
        </div>
      </div>
    )
  }

  const status = state.phase === "blocks"
    ? (houseAttacking ? "Choose your blockers, then confirm." : "The house is blocking…")
    : pendingSpell !== null ? `Choose a target for ${pendingCard?.name}.`
    : state.active === "you" ? "Your turn" : "House's turn"
  const playerTargetable = (side: Side) => pendingSpell !== null && isTarget({ kind: "player", side })
  const marks = combatMarks(state, {
    chosenAttackers,
    blockAssign,
    pendingBlocker,
    effectsShowing: fx.some((i) => i.kind === "lunge"),
  })
  const hint = hintsOn ? duelHint(state, { pendingCard, chosenAttackers: chosenAttackers.length, pendingBlocker: pendingBlocker !== null }) : null
  const nudgeHand = hint?.nudge === "hand" || hint?.nudge === "hand-and-attackers"
  const nudgeAttackers = hint?.nudge === "attackers" || hint?.nudge === "hand-and-attackers"
  const nudge = (on: boolean) => (on ? " duel-nudge" : "")

  return (
    <div ref={rootRef} tabIndex={-1} className={`duel duel--board duel--mat-${houseDeck}`} style={mat}>
      <div className="duel-topbar">
        <button type="button" className={`duel-life${playerTargetable("house") ? " duel-target" : ""} ${fxClasses(fxFor(playerKey("house")))}`} disabled={!playerTargetable("house")} onClick={() => onTarget({ kind: "player", side: "house" })}>
          House: {state.house.life} life
          <FxFloats items={fxFor(playerKey("house"))} />
        </button>
        <span className="duel-turn">
          <span className="duel-house">{houseName} plays {house.name}</span>
          Turn {state.turn} · {status}
        </span>
        <button type="button" className={`duel-life${playerTargetable("you") ? " duel-target" : ""} ${fxClasses(fxFor(playerKey("you")))}`} disabled={!playerTargetable("you")} onClick={() => onTarget({ kind: "player", side: "you" })}>
          You: {state.you.life} life
          <FxFloats items={fxFor(playerKey("you"))} />
        </button>
      </div>

      <section className="duel-row duel-row--backs" aria-label="House hand">
        {state.house.hand.map((_, i) => <img key={i} className="duel-back" src={CARD_BACK} alt="" draggable={false} />)}
        <span className="duel-count">{state.house.hand.length} cards · {state.house.library.length} in library</span>
      </section>

      <section className="duel-row duel-row--board" aria-label="House board">
        {withGhosts(state.house.board.map((c) => {
          const targetable = pendingSpell !== null && isTarget({ kind: "creature", uid: c.uid })
          const blockable = houseAttacking && pendingBlocker !== null && state.attackers.includes(c.uid)
          const blockedBy = blockAssign[c.uid]
          const mine = fxFor(creatureKey(c.uid))
          const inspectTarget: InspectTarget = { card: c.card, creature: c, owner: "house", where: "board" }
          inspectables.current.set(`c:${c.uid}`, inspectTarget)
          return (
            <span key={c.uid} className="duel-hold" data-inspect={`c:${c.uid}`} data-uid={c.uid} {...holdToInspect(inspectTarget)}>
            <CombatBadges uid={c.uid} marks={marks} />
            <button type="button"
              className={`duel-card${targetable || blockable ? " duel-target" : ""}${state.attackers.includes(c.uid) ? " duel-card--attacking" : ""} ${fxClasses(mine)}`}
              aria-label={`${c.card.name} ${effectivePower(c)}/${effectiveToughness(c)}${state.attackers.includes(c.uid) ? ", attacking" : ""}${blockedBy ? ", blocked" : ""}`}
              aria-pressed={blockedBy !== undefined}
              disabled={!(targetable || blockable)}
              onClick={() => onHouseCreature(c)}>
              <CardFace card={c.card} creature={c} />
              <FxFloats items={mine} />
            </button>
            </span>
          )
        }), fx.filter((i) => i.kind === "ghost" && i.side === "house"))}
        {state.house.board.length === 0 && !fx.some((i) => i.kind === "ghost" && i.side === "house") && <span className="duel-empty">No creatures</span>}
      </section>

      {/* The coach speaks from the middle of the field, between the two sides. */}
      <div className="duel-midline">
        {hint && (
          <p className={`duel-hint duel-hint--${hint.tone}`} role="status" aria-live="polite">{hint.text}</p>
        )}
      </div>

      <section className="duel-row duel-row--board" aria-label="Your board">
        {withGhosts(state.you.board.map((c) => {
          const targetable = pendingSpell !== null && isTarget({ kind: "creature", uid: c.uid })
          const attackable = pendingSpell === null && yourMain && !state.attacked && canAttack(state, c)
          const blocking = Object.values(blockAssign).includes(c.uid)
          const selectable = targetable || attackable || (houseAttacking && pendingSpell === null)
          const pressed = chosenAttackers.includes(c.uid) || blocking || pendingBlocker === c.uid
          const mine = fxFor(creatureKey(c.uid))
          const inspectTarget: InspectTarget = { card: c.card, creature: c, owner: "you", where: "board" }
          inspectables.current.set(`c:${c.uid}`, inspectTarget)
          return (
            <span key={c.uid} className="duel-hold" data-inspect={`c:${c.uid}`} data-uid={c.uid} {...holdToInspect(inspectTarget)}>
            <CombatBadges uid={c.uid} marks={marks} />
            <button type="button"
              className={`duel-card${targetable ? " duel-target" : ""}${!canAttack(state, c) && yourMain ? " duel-card--sick" : ""}${nudge((nudgeAttackers && attackable && !pressed) || (hint?.nudge === "blockers" && !pressed && state.attackers.some((uid) => { const a = state.house.board.find((h) => h.uid === uid); return !!a && canBlock(a, c) })))} ${fxClasses(mine)}`}
              aria-label={`${c.card.name} ${effectivePower(c)}/${effectiveToughness(c)}${blocking ? ", blocking" : ""}`}
              aria-pressed={pressed}
              disabled={!selectable}
              onClick={() => onYourCreature(c)}>
              <CardFace card={c.card} creature={c} />
              <FxFloats items={mine} />
            </button>
            </span>
          )
        }), fx.filter((i) => i.kind === "ghost" && i.side === "you"))}
        {state.you.board.length === 0 && !fx.some((i) => i.kind === "ghost" && i.side === "you") && <span className="duel-empty">No creatures</span>}
      </section>

      <section className="duel-row duel-row--hand" aria-label="Your hand">
        {state.you.hand.map((card, i) => {
          const inspectTarget: InspectTarget = { card, owner: "you", where: "hand" }
          inspectables.current.set(`h:${i}`, inspectTarget)
          return (
            <span key={`${card.id}-${i}`} className="duel-hold" data-inspect={`h:${i}`} {...holdToInspect(inspectTarget)}>
              <button type="button" className={`duel-card duel-card--hand${nudge(nudgeHand && pendingSpell === null && worthPlaying(state, card))}`}
                aria-label={`${card.name}, ${card.cost} mana`}
                aria-keyshortcuts="I"
                disabled={pendingSpell !== null || !castable(state, "you", card)}
                onClick={() => onHandCard(i)}>
                <CardFace card={card} />
              </button>
            </span>
          )
        })}
      </section>

      <div className="duel-bar">
        <span className="duel-mana" role="img" aria-label={`Mana ${state.you.mana} of ${state.you.crystals}`}>
          {Array.from({ length: state.you.crystals }, (_, i) => (
            <img key={i} className={`duel-crystal${i < state.you.mana ? "" : " duel-crystal--spent"}`} src={MANA_CRYSTAL} alt="" draggable={false} />
          ))}
          <span className="duel-mana-count" aria-hidden="true">{state.you.mana}/{state.you.crystals}</span>
        </span>
        <span className="duel-count">{state.you.library.length} in library</span>
        {primary && <button type="button" className={`duel-btn${nudge(hint?.nudge === "primary")}`} onClick={primary.run}>{primary.label}</button>}
        <button type="button" className="duel-btn duel-btn--quiet" aria-pressed={hintsOn} onClick={toggleHints}>Hints {hintsOn ? "on" : "off"}</button>
        <button type="button" className="duel-btn duel-btn--quiet" onClick={leave}>Leave</button>
      </div>

      <CombatLines links={marks.links} rootRef={rootRef} />

      {inspecting && <InspectOverlay target={inspecting} state={state} />}

      {castFx && (
        <div key={castFx.id} className={`duel-castfx duel-castfx--${castFx.side}`} role="status" aria-label={`${castFx.side === "you" ? "You cast" : "The house casts"} ${castFx.card.name}`}>
          <CardFace card={castFx.card} />
        </div>
      )}

      <aside className="duel-log" aria-label="Duel log">
        {state.log.slice(-6).map((line, i) => <div key={`${state.log.length}-${i}`}>{line}</div>)}
      </aside>
    </div>
  )
}
