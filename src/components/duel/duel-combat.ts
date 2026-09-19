// Who is attacking, who is blocking, and which blocker is on which attacker —
// for the sword and shield badges and the lines between blocker and attacker.
// Pure, from the state plus the player's in-progress choices, so every phase
// is pinned by a test; the screen only measures cards and draws.
import type { DuelEvent, DuelState } from "./duel-sim"

export interface CombatLink {
  /** The blocking creature. */
  blocker: number
  /** The attacking creature it blocks. */
  attacker: number
  /** "planned" while blocks are being chosen; "combat" as a fight resolves. */
  kind: "planned" | "combat"
}

export interface CombatMarks {
  attacking: Set<number>
  blocking: Set<number>
  links: CombatLink[]
}

export interface CombatUi {
  /** Your attackers picked but not yet sent. */
  chosenAttackers: readonly number[]
  /** Your blocks so far, attacker → your blocker, while the house attacks. */
  blockAssign: Readonly<Record<number, number>>
  /** Your creature picked to block, waiting for an attacker click. */
  pendingBlocker: number | null
  /** True while the last move's effects are still on screen. */
  effectsShowing: boolean
}

export function combatMarks(state: DuelState, ui: CombatUi): CombatMarks {
  const attacking = new Set<number>()
  const blocking = new Set<number>()
  const links: CombatLink[] = []

  // Declared attackers waiting on blocks (either side attacking).
  for (const uid of state.attackers) attacking.add(uid)

  if (state.phase === "blocks" && state.active === "house") {
    for (const [a, b] of Object.entries(ui.blockAssign)) {
      attacking.add(Number(a))
      blocking.add(b)
      links.push({ blocker: b, attacker: Number(a), kind: "planned" })
    }
    if (ui.pendingBlocker !== null) blocking.add(ui.pendingBlocker)
  }

  if (state.active === "you" && state.phase === "main" && !state.attacked) {
    for (const uid of ui.chosenAttackers) attacking.add(uid)
  }

  // A fight that just resolved: show who fought whom while its effects play.
  if (ui.effectsShowing) {
    const attack = state.events.find((e): e is Extract<DuelEvent, { kind: "attack" }> => e.kind === "attack")
    for (const a of attack?.attackers ?? []) {
      attacking.add(a.uid)
      if (a.blockerUid !== null) {
        blocking.add(a.blockerUid)
        links.push({ blocker: a.blockerUid, attacker: a.uid, kind: "combat" })
      }
    }
  }

  return { attacking, blocking, links }
}
