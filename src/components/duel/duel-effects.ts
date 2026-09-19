// The duel's effects: the sim says what happened (DuelEvent); this turns a
// batch of those into short-lived items the screen animates — a lunge on an
// attacker, a floating number on whatever was hit, a glow on a pump or heal,
// a ghost where a creature died, the cast spell held up in the middle. Pure
// mapping plus one small hook that expires a batch after FX_MS.
import { useEffect, useRef, useState } from "react"
import type { CreatureCard, SpellCard } from "./cards"
import type { DuelEvent, Side, Target } from "./duel-sim"

/** How long a batch of effects stays on screen. Shorter than the house's
 * step, so one move's effects are gone before the next move's arrive. */
export const FX_MS = 850

export type FxKey = `c:${number}` | `p:${Side}` | "cast"
export const creatureKey = (uid: number): FxKey => `c:${uid}`
export const playerKey = (side: Side): FxKey => `p:${side}`

export type FxItem =
  | { id: number; key: FxKey; kind: "lunge"; side: Side }
  | { id: number; key: FxKey; kind: "hit"; text: string }
  | { id: number; key: FxKey; kind: "glow"; tone: "gain" | "pump"; text: string }
  | { id: number; key: FxKey; kind: "summon" }
  | { id: number; key: FxKey; kind: "cast"; side: Side; card: SpellCard }
  | { id: number; key: FxKey; kind: "ghost"; side: Side; index: number; card: CreatureCard; tone: "dissolve" | "bounce" }

const targetKey = (target: Target): FxKey =>
  target.kind === "creature" ? creatureKey(target.uid) : playerKey(target.side)

/** One batch of events → the items to show, all tagged with the batch id. */
export function fxFromEvents(events: readonly DuelEvent[], id: number): FxItem[] {
  const items: FxItem[] = []
  for (const e of events) {
    switch (e.kind) {
      case "cast": items.push({ id, key: "cast", kind: "cast", side: e.side, card: e.card }); break
      case "summon": items.push({ id, key: creatureKey(e.uid), kind: "summon" }); break
      case "attack": for (const a of e.attackers) items.push({ id, key: creatureKey(a.uid), kind: "lunge", side: e.side }); break
      case "damage": items.push({ id, key: targetKey(e.target), kind: "hit", text: `-${e.amount}` }); break
      case "heal": items.push({ id, key: playerKey(e.side), kind: "glow", tone: "gain", text: `+${e.amount}` }); break
      case "pump": items.push({ id, key: creatureKey(e.uid), kind: "glow", tone: "pump", text: `+${e.power}/+${e.toughness}` }); break
      case "destroyed": items.push({ id, key: creatureKey(e.uid), kind: "ghost", side: e.side, index: e.index, card: e.card, tone: "dissolve" }); break
      case "bounce": items.push({ id, key: creatureKey(e.uid), kind: "ghost", side: e.side, index: e.index, card: e.card, tone: "bounce" }); break
    }
  }
  return items
}

/** The effects currently on screen for the latest batches of events. */
export function useDuelEffects(events: readonly DuelEvent[] | undefined): FxItem[] {
  const [items, setItems] = useState<FxItem[]>([])
  const seq = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => {
    if (!events || events.length === 0) return
    const id = ++seq.current
    const fresh = fxFromEvents(events, id)
    if (fresh.length === 0) return
    setItems((cur) => [...cur, ...fresh])
    timers.current.push(window.setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), FX_MS))
  }, [events])
  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t) }, [])
  return items
}

/** The CSS classes a card or life badge wears for its effects. */
export function fxClasses(items: readonly FxItem[]): string {
  const out: string[] = []
  for (const i of items) {
    if (i.kind === "lunge") out.push(`duel-fx-lunge-${i.side}`)
    else if (i.kind === "hit") out.push("duel-fx-hit")
    else if (i.kind === "glow") out.push(`duel-fx-glow-${i.tone}`)
    else if (i.kind === "summon") out.push("duel-fx-summon")
  }
  return out.join(" ")
}
