import { describe, expect, it } from "vitest"
import { cuesForEvent, type AudioCue, type CueContext } from "./audio-cues"
import { createFight, type FightEvent, type FightState } from "./fight-sim"

const ctx = (over: Partial<CueContext> = {}): CueContext => ({
  mode: "cpu",
  takes: () => 2,
  random: () => 0.9,
  ...over,
})

const ev = (type: FightEvent["type"], player: 0 | 1 = 0, heavy?: boolean): FightEvent => ({ type, player, heavy })
const kinds = (cues: AudioCue[]) => cues.map((c) => (c.kind === "voice" ? `voice:${c.fighter}:${c.line}` : c.kind === "music" ? `music:${c.name}` : `${c.kind}:${c.name}`))

describe("fight audio cues", () => {
  it("opens round one with the card, the fight music and the first fighter's line", () => {
    const state = createFight("bull", "bear")
    expect(kinds(cuesForEvent(ev("intro"), state, ctx()))).toEqual(["announce:round1", "music:fight", "voice:bull:intro"])
  })

  it("calls FINAL ROUND only when both sides are on match point", () => {
    const state = createFight("bull", "bear")
    state.round = 2
    state.wins = [1, 0]
    expect(kinds(cuesForEvent(ev("intro"), state, ctx()))[0]).toBe("announce:round2")
    state.round = 3
    state.wins = [1, 1]
    expect(kinds(cuesForEvent(ev("intro"), state, ctx()))[0]).toBe("announce:final_round")
  })

  it("rings the bell and shouts FIGHT", () => {
    expect(kinds(cuesForEvent(ev("fight"), createFight("bull", "bear"), ctx()))).toEqual(["sfx:round_bell", "announce:fight"])
  })

  it("voices heavy swings and specials but not light jabs", () => {
    const state = createFight("quant", "whale")
    expect(cuesForEvent(ev("attack", 0, false), state, ctx())).toEqual([])
    expect(kinds(cuesForEvent(ev("attack", 1, true), state, ctx()))).toEqual(["voice:whale:attack"])
    expect(kinds(cuesForEvent(ev("special", 0), state, ctx()))).toEqual(["sfx:math_circle", "voice:quant:special"])
  })

  it.each([
    ["bull", "horn_attack"], ["bear", "ice_slam"], ["quant", "math_circle"],
    ["whale", "water_orb"], ["primey", "prime_laser"], ["bernard", "redline_vision"],
  ] as const)("gives %s its own special effect and voice", (fighter, effect) => {
    const state = createFight(fighter, "bull")
    expect(kinds(cuesForEvent(ev("special", 0), state, ctx()))).toEqual([`sfx:${effect}`, `voice:${fighter}:special`])
  })

  it("uses a distinct rain callout even when Bernard's casting move has been interrupted", () => {
    const state = createFight("bernard", "bull")
    state.fighters[0].move = null
    expect(kinds(cuesForEvent({ ...ev("special", 0), moveId: "bernard-special-up" }, state, ctx())))
      .toEqual(["sfx:laser_rain", "voice:bernard:specialUp"])
  })

  it("the victim, not the attacker, grunts on a hit", () => {
    const state = createFight("bull", "bear")
    expect(kinds(cuesForEvent(ev("hit", 0, true), state, ctx()))).toEqual(["sfx:hit_heavy", "voice:bear:hurt"])
    expect(kinds(cuesForEvent(ev("hit", 1, false), state, ctx({ random: () => 0.9 })))).toEqual(["sfx:hit_light"])
    expect(kinds(cuesForEvent(ev("hit", 1, false), state, ctx({ random: () => 0.1 })))).toEqual(["sfx:hit_light", "voice:bull:hurt"])
  })

  it.each([
    ["bernard-dash", "horn_attack", "dash"],
    ["bernard-ice", "ice_slam", "ice"],
    ["bernard-circle", "math_circle", "circle"],
    ["bernard-orb", "water_orb", "orb"],
    ["bernard-breaking-news", "breaking_news_charge", "breakingNews"],
  ])("keeps %s's distinct callout after its move is interrupted", (moveId, effect, line) => {
    const state = createFight("bernard", "bull")
    state.fighters[0].move = null
    expect(kinds(cuesForEvent({ type: "special", player: 0, moveId }, state, ctx())))
      .toEqual([`sfx:${effect}`, `voice:bernard:${line}`])
  })

  it.each([
    ["specialRelease", "breaking_news_release"],
    ["specialImpact", "breaking_news_impact"],
  ] as const)("sounds Breaking News %s separately without repeating the spoken callout", (type, effect) => {
    const state = createFight("bernard", "bull")
    expect(kinds(cuesForEvent({ type, player: 0, moveId: "bernard-breaking-news" }, state, ctx())))
      .toEqual([`sfx:${effect}`])
  })

  it("picks a take within the fighter's available lines", () => {
    const state = createFight("bull", "bear")
    const cue = cuesForEvent(ev("special", 0), state, ctx({ takes: () => 3, random: () => 0.99 }))[1]
    expect(cue).toMatchObject({ kind: "voice", take: 2 })
    expect(cuesForEvent(ev("special", 0), state, ctx({ takes: () => 0 }))).toHaveLength(1)
  })

  it("on a knockout the loser cries out and the announcer calls it", () => {
    const state = createFight("bull", "primey")
    expect(kinds(cuesForEvent(ev("ko", 0), state, ctx()))).toEqual(["sfx:ko", "announce:ko", "voice:primey:ko"])
  })

  it("announces a perfect only when the round winner took no damage", () => {
    const state = createFight("bull", "bear")
    state.roundWinner = 0
    expect(kinds(cuesForEvent(ev("roundwin", 0), state, ctx()))).toEqual(["sfx:round_win", "announce:perfect"])
    state.fighters[0].health -= 1
    expect(kinds(cuesForEvent(ev("roundwin", 0), state, ctx()))).toEqual(["sfx:round_win"])
  })

  it("ends the match with victory or game over music and the right call", () => {
    const state = createFight("bull", "bear")
    state.matchWinner = 0
    expect(kinds(cuesForEvent(ev("matchover", 0), state, ctx()))).toEqual(["music:victory", "announce:you_win", "voice:bull:win"])
    state.matchWinner = 1
    expect(kinds(cuesForEvent(ev("matchover", 1), state, ctx()))).toEqual(["music:gameover", "announce:you_lose", "voice:bear:win"])
    // Two players: somebody always wins, so it is always the victory theme.
    expect(kinds(cuesForEvent(ev("matchover", 1), state, ctx({ mode: "versus" })))).toEqual(["music:victory", "announce:player_two_wins", "voice:bear:win"])
    state.matchWinner = null
    expect(kinds(cuesForEvent(ev("matchover", 0), state, ctx()))).toEqual(["music:gameover", "announce:draw"])
  })
})

describe("fight state carries the intro flag", () => {
  it("is present on a fresh fight", () => {
    const state: FightState = createFight("bull", "bear")
    expect(state.introAnnounced).toBe(false)
  })
})
