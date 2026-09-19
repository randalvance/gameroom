// The cabinet's other player.
//
// A reactive, slightly forgetful opponent: it re-decides every DECIDE_MS
// rather than every frame, so it has human-ish reaction time and can be
// baited. It reads the sim state directly (distance, whether you are
// attacking, a projectile on its way) and answers with an ordinary
// FightInput — the same struct the keyboard fills — so the sim never knows
// which side is the machine. `random` is injectable for tests.

import type { MoveDef } from "./characters"
import { breakingNewsGeometry } from "./special-motion"
import { canCastSpecial, EMPTY_INPUT, ORB_OFFSET, ORB_RADIUS, RAIN_WIDTH, type FightInput, type FightState } from "./fight-sim"

export const DECIDE_MS = 150

export interface CpuBrain {
  /** The input to feed the sim this step. Call every step. */
  next(state: FightState, dtMs: number): FightInput
}

export function createCpu(slot: 0 | 1, random: () => number = Math.random): CpuBrain {
  const me = slot
  const them: 0 | 1 = slot === 0 ? 1 : 0
  let untilDecide = 0
  let ultimateRound = 0
  let ultimateUsed = false
  /** Directions are held between decisions; buttons fire once on the decision step. */
  let held: Pick<FightInput, "left" | "right" | "up" | "down"> = { left: false, right: false, up: false, down: false }

  const decide = (state: FightState): FightInput => {
    const self = state.fighters[me]
    const foe = state.fighters[them]
    const dx = foe.x - self.x
    const dist = Math.abs(dx)
    const toward = dx >= 0 ? "right" : "left"
    const away = dx >= 0 ? "left" : "right"
    const hold = (dir: "left" | "right" | null, down = false, up = false) => {
      held = { left: dir === "left", right: dir === "right", down, up }
    }
    const ultimate = self.def.moves.specialUltimate
    // Reserve the normal energy cost so the threshold cast is always funded.
    const reserve = self.id === "bernard" && !ultimateUsed ? (ultimate?.energyCost ?? 0) : 0
    const canSpend = (move: MoveDef) => canCastSpecial(state, me, move)
      && self.energy - (move.energyCost ?? 0) >= reserve
    if (self.id === "bernard" && !ultimateUsed && self.health > 0 && self.health <= 50
      && ultimate && self.y <= 0 && ["idle", "walk", "crouch"].includes(self.state)
      && canCastSpecial(state, me, ultimate)) {
      hold(null)
      return { ...EMPTY_INPUT, sp: true, specialId: ultimate.id }
    }
    const roll = random()
    if (foe.state === "attack" && foe.move?.kind === "breakingNews" && roll < 0.9) {
      const geometry = breakingNewsGeometry(foe)
      const safeX = geometry.safeColumn.x + geometry.safeColumn.w / 2
      hold(Math.abs(self.x - safeX) < 5 ? null : self.x > safeX ? "left" : "right")
      return { ...EMPTY_INPUT, ...held }
    }
    if (foe.state === "attack" && foe.move?.scanning && roll < 0.9) {
      hold(null, true)
      return { ...EMPTY_INPUT, ...held }
    }
    const orb = state.orbs.find(orb => orb.owner === them && orb.captured === null
      && Math.abs(orb.x - self.x) < orb.radius + self.def.width / 2 + 100 && self.y < orb.y + orb.radius)
    if (orb && roll < 0.8) {
      // Retreat before reaching the trap. Jumping too late at its rim would
      // collide on takeoff, so only attempt the leap from outside contact.
      const room = Math.abs(orb.x - self.x) > orb.radius + self.def.width / 2 + 35
      hold(orb.x >= self.x ? "left" : "right", false, room && roll > 0.5)
      return { ...EMPTY_INPUT, ...held }
    }
    const incoming = state.projectiles.find((p) => p.owner === them && Math.sign(p.vx) === Math.sign(dx === 0 ? 1 : -dx) && Math.abs(p.x - self.x) < 260)
    const foeAttacking = foe.state === "attack" && foe.move
    const foeDown = foe.state === "knockdown" || foe.state === "hitstun"
    const rain = state.rain.find(lane => lane.owner === them && lane.ageMs >= 0 && lane.ageMs < lane.warningMs
      && Math.abs(self.x - lane.x) < RAIN_WIDTH / 2 + self.def.width / 2)
    if (rain && roll < 0.82) {
      hold(rain.x > 480 ? "left" : "right")
      return { ...EMPTY_INPUT, ...held }
    }
    // Something is coming: block it or hop over it.
    if (incoming) {
      if (roll < 0.45) { hold(away, false); return { ...EMPTY_INPUT, ...held } }
      if (roll < 0.8) { hold(toward, false, true); return { ...EMPTY_INPUT, ...held } }
    }
    // They swung: block at the right height most of the time, or trade.
    if (foeAttacking && dist < 220) {
      const low = foe.move?.guard === "low"
      const overhead = foe.move?.guard === "overhead"
      if (roll < 0.72) { hold(away, low || (!overhead && roll < 0.36)); return { ...EMPTY_INPUT, ...held } }
      if (roll < 0.85 && dist < 120) { hold(null); return { ...EMPTY_INPUT, ...held, lp: true } }
    }
    // Do not hit someone who is down (pretend to be sporting, actually just wait).
    if (foeDown && roll < 0.6) { hold(null); return { ...EMPTY_INPUT, ...held } }
    const rainMove = self.def.moves.specialUp
    if (rainMove?.kind === "rain" && canSpend(rainMove) && dist > 170 && roll < 0.2) {
      hold(null, false, true)
      return { ...EMPTY_INPUT, ...held, sp: true }
    }
    if (self.id === "bernard" && roll >= 0.2 && roll < 0.8) {
      const moves = self.def.moves
      const candidates = [moves.specialForward, moves.specialBack, moves.specialDownForward, moves.specialDown, moves.special]
        .filter((move): move is MoveDef => !!move && canSpend(move)
          && (move.kind === "beam"
            || (move.kind === "orb" && dist < (move.orb?.offset ?? ORB_OFFSET) + (move.orb?.radius ?? ORB_RADIUS) + foe.def.width / 2)
            || (move.kind === "circle" && dist < (move.circleTravel ?? 0) + (move.range ?? 0) + foe.def.width / 2)
            || ((move.kind === "dash" || move.kind === "iceSlam") && dist < (move.range ?? 0) + move.hitbox.w / 2)))
      const chosen = candidates[Math.min(candidates.length - 1, Math.floor((roll - 0.2) / 0.6 * candidates.length))]
      if (chosen) {
        hold(null)
        return { ...EMPTY_INPUT, ...held, sp: true, specialId: chosen.id }
      }
    }
    // In their face. A fair share of the ticks it just stands and guards, so
    // a player who is still finding the buttons gets a moment to breathe.
    if (dist < 110) {
      if (roll < 0.18) { hold(null); return { ...EMPTY_INPUT, ...held, lp: true } }
      if (roll < 0.32) { hold(null); return { ...EMPTY_INPUT, ...held, lk: true } }
      if (roll < 0.44) { hold(null); return { ...EMPTY_INPUT, ...held, hp: true } }
      if (roll < 0.53) { hold(null, true); return { ...EMPTY_INPUT, ...held, hk: true } }
      if (roll < 0.6 && canSpend(self.def.moves.special)) {
        hold(null)
        // Primey's beam trades power for reach. Spending meter on it at
        // point-blank range throws away a stronger normal punish.
        return { ...EMPTY_INPUT, ...held, ...(self.def.moves.special.kind === "beam" ? { hp: true } : { sp: true }) }
      }
      if (roll < 0.75) { hold(away, true); return { ...EMPTY_INPUT, ...held } }
      if (roll < 0.88) { hold(away); return { ...EMPTY_INPUT, ...held } }
      hold(null)
      return { ...EMPTY_INPUT, ...held }
    }
    // Mid range: footsies.
    if (dist < 240) {
      if (roll < 0.35) { hold(toward); return { ...EMPTY_INPUT, ...held } }
      if (roll < 0.5) { hold(null); return { ...EMPTY_INPUT, ...held, hk: true } }
      if (roll < 0.62) { hold(toward, false, true); return { ...EMPTY_INPUT, ...held } }
      if (roll < 0.72 && canSpend(self.def.moves.special)) { hold(null); return { ...EMPTY_INPUT, ...held, sp: true } }
      if (roll < 0.82) { hold(away, true); return { ...EMPTY_INPUT, ...held } }
      hold(null)
      return { ...EMPTY_INPUT, ...held }
    }
    // Far: close in, throw something, or jump in.
    const special = self.def.moves.special
    const canReach = special.kind === "projectile" || special.kind === "beam"
      || (special.kind === "orb" && dist < ORB_OFFSET + ORB_RADIUS + foe.def.width / 2)
      || (special.kind === "circle" && dist < (special.range ?? 0) + foe.def.width / 2)
      || ((special.kind === "dash" || special.kind === "iceSlam") && dist < (special.range ?? 0) + 80)
    if (canReach && canSpend(special) && roll < 0.3) { hold(null); return { ...EMPTY_INPUT, ...held, sp: true } }
    if (roll < 0.8) { hold(toward); return { ...EMPTY_INPUT, ...held } }
    if (roll < 0.92) { hold(toward, false, true); return { ...EMPTY_INPUT, ...held } }
    hold(null)
    return { ...EMPTY_INPUT, ...held }
  }

  return {
    next(state, dtMs) {
      if (ultimateRound !== state.round) {
        ultimateRound = state.round
        ultimateUsed = false
      }
      // Count an actual cast, not an input discarded during hitstop or stun.
      if (state.fighters[me].move?.kind === "breakingNews") ultimateUsed = true
      if (state.phase !== "fight" || state.fighters[me].state === "trapped") {
        held = { left: false, right: false, up: false, down: false }
        untilDecide = 0
        return EMPTY_INPUT
      }
      untilDecide -= dtMs
      if (untilDecide > 0) return { ...EMPTY_INPUT, ...held }
      untilDecide = DECIDE_MS
      const action = decide(state)
      // CPU choices are explicit: old directional motion must not promote a
      // regular special into the once-per-round low-health ultimate.
      if (state.fighters[me].id === "bernard" && action.sp && !action.specialId) {
        const moves = state.fighters[me].def.moves
        action.specialId = action.up ? moves.specialUp!.id : moves.special.id
      }
      return action
    },
  }
}
