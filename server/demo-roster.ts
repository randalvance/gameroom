// The demo event: twelve desks of five, plus two white exhibition desks.
//
// Made rather than stored, so the room is full without a database and the
// shape of a real roster stays visible: a team is an id, a name, whether it is
// competing, and its people. Swap this for your own loader and nothing else
// changes.

import type { TeamDTO } from "~/lib/event-types"

const FIRST = [
  "Wei Ming", "Aisha", "Priya", "Jun Hao", "Farah", "Daniel", "Siti", "Ryan",
  "Mei Ling", "Arjun", "Nadia", "Kelvin", "Hannah", "Tariq", "Yuki", "Zara",
  "Dylan", "Amara", "Ivan", "Grace", "Rahul", "Chloe", "Marcus", "Leila",
  "Noah", "Aria", "Ken", "Divya", "Theo", "Sofia", "Omar", "Ella",
  "Bryan", "Mira", "Lucas", "Ines", "Haruto", "Nia", "Felix", "Rania",
  "Jonas", "Talia", "Andre", "Suki", "Pedro", "Anika", "Milo", "Yara",
  "Caleb", "Rosa", "Viktor", "Lena", "Sean", "Nora", "Adam", "Iris",
  "Toby", "Freya", "Kai", "Maya",
]

const TEAM_NAMES = [
  "SIGNAL", "ARBITRAGE", "VOLATILITY", "LIQUIDITY", "MOMENTUM", "CARRY",
  "BASIS", "SPREAD", "DELTA", "GAMMA", "THETA", "VEGA",
]

/** Players per desk in the demo. The room seats up to six. */
const TEAM_SIZE = 5

export function demoTeams(): TeamDTO[] {
  const competing: TeamDTO[] = TEAM_NAMES.map((name, teamIdx) => ({
    id: `team-${teamIdx + 1}`,
    name: `TEAM ${String(teamIdx + 1).padStart(2, "0")} · ${name}`,
    competing: true,
    players: Array.from({ length: TEAM_SIZE }, (_, seat) => {
      const n = teamIdx * TEAM_SIZE + seat
      return {
        id: `p-${n}`,
        name: FIRST[n % FIRST.length]!,
        role: "student" as const,
        // null is "auto": the room derives a stable character from the seat,
        // which is what an unassigned player looks like in the real event.
        spriteId: null,
        spriteSheet: null,
      }
    }),
  }))

  // The white desks. Nothing marks them out but their colour — walking up and
  // pressing interact at one deals you into Table Stakes.
  const exhibition: TeamDTO[] = ["MARKET MAKERS", "THE HOUSE"].map((name, i) => ({
    id: `exhibition-${i + 1}`,
    name,
    competing: false,
    players: Array.from({ length: 3 }, (_, seat) => ({
      id: `x-${i}-${seat}`,
      name: FIRST[(TEAM_NAMES.length * TEAM_SIZE + i * 3 + seat) % FIRST.length]!,
      role: "student" as const,
      spriteId: null,
      spriteSheet: null,
    })),
  }))

  return [...competing, ...exhibition]
}
