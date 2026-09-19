// What a move sounds like: sim events → clip names, each at most once per
// batch, in the order the move happened. Pure, so the mapping is pinned by a
// test: a burn spell crackles rather than thudding, a summon is a card slap
// and a whump, a destroyed creature shatters.
import type { DuelSfxName } from "./duel-audio.generated"
import type { DuelEvent } from "./duel-sim"

export function cuesForEvents(events: readonly DuelEvent[]): DuelSfxName[] {
  const out: DuelSfxName[] = []
  const add = (name: DuelSfxName) => { if (!out.includes(name)) out.push(name) }
  for (const e of events) {
    switch (e.kind) {
      case "cast":
        add("spell")
        if (e.card.effect.kind === "damage") add("burn")
        if (e.card.effect.kind === "drain") add("drain")
        break
      case "summon": add("card"); add("summon"); break
      case "attack": add("attack"); break
      case "damage": if (!out.includes("burn") && !out.includes("drain")) add("hit"); break
      case "heal": if (!out.includes("drain")) add("heal"); break
      case "pump": add("pump"); break
      case "destroyed": add("destroy"); break
      case "bounce": add("bounce"); break
    }
  }
  return out
}
