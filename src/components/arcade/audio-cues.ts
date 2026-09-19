// What the fight sounds like: sim events → sound cues.
//
// The sim emits plain events (a hit landed, a round started); this decides
// which clip answers each one — a sound effect, a fighter's line, the
// announcer, a change of music — and the shell hands the cues to the sound
// bank. Pure, with an injectable random for picking takes, so the mapping is
// pinned by a test: the announcer calls FINAL ROUND when both sides are on
// match point, the loser's KO cry plays on a knockout, and so on.

import type { CharacterId } from "./characters"
import type { FightEvent, FightState } from "./fight-sim"
import { ROUNDS_TO_WIN } from "./fight-sim"
import type { AnnouncerName, MusicName, SfxName, VoiceLine } from "./audio-atlas.generated"

export type AudioCue =
  | { kind: "sfx"; name: SfxName }
  | { kind: "voice"; fighter: CharacterId; line: VoiceLine; take: number }
  | { kind: "announce"; name: AnnouncerName }
  | { kind: "music"; name: MusicName | null }

export interface CueContext {
  /** Who sits on the second side: the machine or a second player. */
  mode: "cpu" | "versus"
  /** Takes available per fighter line, so `take` can be picked here. */
  takes: (fighter: CharacterId, line: VoiceLine) => number
  random: () => number
}

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0)
const SPECIAL_SFX: Record<CharacterId, SfxName> = {
  bull: "horn_attack", bear: "ice_slam", quant: "math_circle",
  whale: "water_orb", primey: "prime_laser", bernard: "redline_vision",
}
const BERNARD_SPECIALS: Record<string, { effect: SfxName; line: VoiceLine }> = {
  "bernard-special-up": { effect: "laser_rain", line: "specialUp" },
  "bernard-dash": { effect: "horn_attack", line: "dash" },
  "bernard-ice": { effect: "ice_slam", line: "ice" },
  "bernard-circle": { effect: "math_circle", line: "circle" },
  "bernard-orb": { effect: "water_orb", line: "orb" },
  "bernard-breaking-news": { effect: "breaking_news_charge", line: "breakingNews" },
}

export function cuesForEvent(event: FightEvent, state: FightState, ctx: CueContext): AudioCue[] {
  const cues: AudioCue[] = []
  const fighterOf = (p: 0 | 1): CharacterId => state.fighters[p].id
  const voice = (p: 0 | 1, line: VoiceLine) => {
    const fighter = fighterOf(p)
    const count = ctx.takes(fighter, line)
    if (count <= 0) return
    cues.push({ kind: "voice", fighter, line, take: Math.min(count - 1, Math.floor(ctx.random() * count)) })
  }
  switch (event.type) {
    case "intro": {
      const finalRound = state.wins[0] === ROUNDS_TO_WIN - 1 && state.wins[1] === ROUNDS_TO_WIN - 1
      cues.push({ kind: "announce", name: finalRound ? "final_round" : state.round === 1 ? "round1" : "round2" })
      if (state.round === 1) {
        cues.push({ kind: "music", name: "fight" })
        voice(0, "intro")
      } else {
        voice(1, "intro")
      }
      break
    }
    case "fight":
      cues.push({ kind: "sfx", name: "round_bell" }, { kind: "announce", name: "fight" })
      break
    case "attack":
      if (event.heavy) voice(event.player, "attack")
      break
    case "outOfEnergy":
      voice(event.player, "outOfEnergy")
      break
    case "special": {
      const special = fighterOf(event.player) === "bernard" ? BERNARD_SPECIALS[event.moveId ?? ""] : undefined
      cues.push({ kind: "sfx", name: special?.effect ?? SPECIAL_SFX[fighterOf(event.player)] })
      voice(event.player, special?.line ?? "special")
      break
    }
    case "specialRelease":
    case "specialImpact":
      if (event.moveId === "bernard-breaking-news") {
        cues.push({ kind: "sfx", name: event.type === "specialRelease" ? "breaking_news_release" : "breaking_news_impact" })
      }
      break
    case "hit": {
      cues.push({ kind: "sfx", name: event.heavy ? "hit_heavy" : "hit_light" })
      // The victim grunts on heavies, and now and then on lights.
      if (event.heavy || ctx.random() < 0.35) voice(other(event.player), "hurt")
      break
    }
    case "block":
      cues.push({ kind: "sfx", name: "block" })
      break
    case "whiff":
      cues.push({ kind: "sfx", name: "whiff" })
      break
    case "jump":
      cues.push({ kind: "sfx", name: "jump" })
      break
    case "land":
      cues.push({ kind: "sfx", name: "land" })
      break
    case "ko":
      cues.push({ kind: "sfx", name: "ko" }, { kind: "announce", name: "ko" })
      voice(other(event.player), "ko")
      break
    case "timeout":
      cues.push({ kind: "sfx", name: "timeout_buzzer" }, { kind: "announce", name: "time_over" })
      break
    case "roundwin": {
      cues.push({ kind: "sfx", name: "round_win" })
      const winner = state.roundWinner
      if (winner !== null && state.fighters[winner].health === state.fighters[winner].def.maxHealth) {
        cues.push({ kind: "announce", name: "perfect" })
      }
      break
    }
    case "matchover": {
      const winner = state.matchWinner
      if (winner === null) {
        cues.push({ kind: "music", name: "gameover" }, { kind: "announce", name: "draw" })
        break
      }
      const playerWon = winner === 0 || ctx.mode === "versus"
      cues.push({ kind: "music", name: playerWon ? "victory" : "gameover" })
      if (ctx.mode === "cpu") cues.push({ kind: "announce", name: winner === 0 ? "you_win" : "you_lose" })
      else cues.push({ kind: "announce", name: winner === 0 ? "player_one_wins" : "player_two_wins" })
      voice(winner, "win")
      break
    }
  }
  return cues
}
