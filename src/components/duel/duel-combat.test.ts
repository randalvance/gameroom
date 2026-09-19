import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { CreatureCard } from "./cards"
import { createDuel, declareAttackers, declareBlocks, endTurn, type DuelState, type Side } from "./duel-sim"
import { combatMarks, type CombatUi } from "./duel-combat"

const creature = (id: string) => DECKS.flatMap((d) => d.cards).find((c) => c.id === id) as CreatureCard
const withBoard = (s: DuelState, side: Side, ids: string[]): DuelState => {
  let uid = s.nextUid
  const board = ids.map((id) => ({ uid: uid++, card: creature(id), damage: 0, pumpP: 0, pumpT: 0, enteredTurn: 0 }))
  return { ...s, nextUid: uid, [side]: { ...s[side], board: [...s[side].board, ...board] } }
}
const ui = (over: Partial<CombatUi> = {}): CombatUi => ({ chosenAttackers: [], blockAssign: {}, pendingBlocker: null, effectsShowing: false, ...over })
const sets = (m: ReturnType<typeof combatMarks>) => ({ attacking: [...m.attacking].sort(), blocking: [...m.blocking].sort(), links: m.links })

describe("combatMarks", () => {
  it("marks your chosen attackers before you send them", () => {
    const s = withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/meme-stock", "bulls/day-trader"])
    const [a, b] = s.you.board
    expect(sets(combatMarks(s, ui({ chosenAttackers: [a!.uid] })))).toEqual({ attacking: [a!.uid], blocking: [], links: [] })
    void b
  })
  it("while the house attacks: attackers, your blocks, the pending blocker, and planned lines", () => {
    let s = withBoard(withBoard(endTurn(createDuel("bulls", "bears", 1)), "house", ["bears/grizzly", "bears/vulture-fund"]), "you", ["bulls/meme-stock", "bulls/day-trader"])
    const [g, v] = s.house.board; const [m, d] = s.you.board
    s = declareAttackers(s, "house", [g!.uid, v!.uid])
    const marks = combatMarks(s, ui({ blockAssign: { [g!.uid]: m!.uid }, pendingBlocker: d!.uid }))
    expect(sets(marks)).toEqual({
      attacking: [g!.uid, v!.uid].sort(),
      blocking: [m!.uid, d!.uid].sort(),
      links: [{ blocker: m!.uid, attacker: g!.uid, kind: "planned" }],
    })
  })
  it("as a fight resolves, links who blocked whom, including the house's blocks on your attack", () => {
    let s = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/meme-stock", "bulls/day-trader"]), "house", ["bears/grizzly"])
    const [m, d] = s.you.board; const [g] = s.house.board
    s = declareBlocks(declareAttackers(s, "you", [m!.uid, d!.uid]), "house", { [m!.uid]: g!.uid })
    expect(sets(combatMarks(s, ui({ effectsShowing: true })))).toEqual({
      attacking: [m!.uid, d!.uid].sort(),
      blocking: [g!.uid],
      links: [{ blocker: g!.uid, attacker: m!.uid, kind: "combat" }],
    })
    expect(sets(combatMarks(s, ui({ effectsShowing: false })))).toEqual({ attacking: [], blocking: [], links: [] })
  })
})
