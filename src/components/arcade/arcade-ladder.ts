import type { CharacterId } from "./characters"

/** Three CPU opponents per arcade run; Bernard always closes the ladder. */
export function buildCpuLadder(player: CharacterId, random: () => number = Math.random): readonly [CharacterId, CharacterId, "bernard"] {
  const candidates: CharacterId[] = ["bull", "bear", "quant", "whale", "primey"].filter((id) => id !== player) as CharacterId[]
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
  }
  return [candidates[0]!, candidates[1]!, "bernard"]
}
