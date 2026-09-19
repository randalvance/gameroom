// The presentation running order: what the gamemaster draws when the code
// freeze lands and the teams have to present, and how the room reveals it.
//
// Pure, for the same reason game-room-control.ts is: the hub stores it, the
// console asks for it, the 3D room animates it and the wall screen draws it,
// and all four have to agree on what "the third presenter" means. Everything
// that turns the state into a moment — which desk the spotlight is on at
// second nine, whether the room is still dark — is a function of the state
// and a clock, so a client that connects halfway through the reveal (or
// reconnects after it) lands on the same picture as one that watched it.

import type { TeamDTO } from "./event-types"

/**
 * The running order as the hub holds it and the wire carries it.
 *
 * Team IDS, not desk indices: the room seats teams by array order, and the
 * console and the room load that array separately. An id survives a roster
 * reload; a desk index would quietly hand the wrong team the wrong slot.
 */
export interface PresentationState {
  /** Team ids, first presenter first. */
  order: string[]
  /**
   * Epoch ms the reveal began. Clients replay the sweep from here rather
   * than from when the frame arrived, so a tab opened after the draw lands on
   * the finished board instead of running a private reveal of its own.
   */
  revealedAt: number
  /**
   * Which draw this is. A redraw can land the same order twice, and the room
   * still has to run the reveal again — the gamemaster asked for one.
   */
  nonce: number
  /** The team on stage right now (team id), or null between presenters. */
  spotlight: string | null
  /**
   * Teams that have finished presenting, as the gamemaster marked them off.
   *
   * A SET, not a count: teams do not always present in the order drawn (one
   * is out of the room, another swaps) and the gamemaster marks whoever
   * actually finished. Optional on the wire so a state stamped before this
   * existed still parses — read it through `donePresenting`.
   */
  done?: string[]
}

/** Who has finished, from a state that may predate the field. */
export function donePresenting(state: Pick<PresentationState, "done">): readonly string[] {
  return state.done ?? []
}

/** The room goes dark for this long before the first spotlight lands. */
export const REVEAL_LEAD_MS = 1500
/** How long the spotlight rests on each desk before moving to the next. */
export const REVEAL_STEP_MS = 1800
/** The last spotlight lingers this long before the house lights come up. */
export const REVEAL_TAIL_MS = 2000

/**
 * The colour a presentation ordinal wears, on the desk and on the wall. Not a
 * medal colour and not the field's teal: a "3RD" over a desk has meant third
 * PLACE all day, and the only thing that stops it being read that way is that
 * it no longer looks like a placing.
 */
export const PRESENTATION_COLOR = 0xff6ad5
export const PRESENTATION_CSS_COLOR = "#ff6ad5"

/**
 * And the colour a slot wears once that team has presented: a room glancing at
 * the desks should see how far down the order the afternoon has got without
 * reading a single number — green behind, hot pink still to come.
 *
 * A DEEP green, deliberately. The obvious brighter one (#3fc46e, the wall's
 * own gain colour) sits a shade away from the teal that RANK_COLORS.field
 * paints an ordinary leaderboard placing — and the desks that are not in the
 * draw at all are wearing exactly that through the presentations. Two greens
 * a room apart, meaning "already presented" and "not presenting", is the one
 * confusion this colour exists to avoid.
 */
export const PRESENTATION_DONE_COLOR = 0x2f9c5a
export const PRESENTATION_DONE_CSS_COLOR = "#2f9c5a"

/**
 * Where the reveal has got to at `now`.
 *
 * `revealed` is how many slots are showing their ordinal — the sweep has
 * reached slot `revealed - 1`. `sweepSlot` is the slot the spotlight is
 * resting on mid-sweep, null before it starts and after it ends. `dark` is
 * whether the house lights are down: through the whole reveal, and again for
 * as long as a team is under the spotlight.
 */
export interface RevealProgress {
  revealed: number
  sweepSlot: number | null
  dark: boolean
  /** The sweep has finished — the ordinals are all up and the lights are back. */
  done: boolean
}

/**
 * What the reveal is computed from: the wire state or the room's resolved
 * copy — the clock only needs the slot count, the start, and whether a team
 * is under the spotlight, and both carry those.
 */
export type RevealClock =
  | Pick<PresentationState, "order" | "revealedAt" | "spotlight">
  | Pick<RoomPresentation, "order" | "revealedAt" | "spotlightTeamIdx">

export function revealProgress(state: RevealClock, now: number): RevealProgress {
  const n = state.order.length
  const elapsed = now - state.revealedAt
  const spotlit = ("spotlight" in state ? state.spotlight : state.spotlightTeamIdx) !== null
  if (elapsed < REVEAL_LEAD_MS) {
    return { revealed: 0, sweepSlot: null, dark: true, done: false }
  }
  const slot = Math.floor((elapsed - REVEAL_LEAD_MS) / REVEAL_STEP_MS)
  if (slot < n) {
    return { revealed: slot + 1, sweepSlot: slot, dark: true, done: false }
  }
  const done = elapsed >= REVEAL_LEAD_MS + n * REVEAL_STEP_MS + REVEAL_TAIL_MS
  return { revealed: n, sweepSlot: null, dark: !done || spotlit, done }
}

/**
 * Below this the spotlight counts as out, and the house lights may start
 * coming back up. See houseDimGoal.
 */
export const SPOT_OUT_LEVEL = 0.02

/**
 * Where the house lights should head this frame, given where they are
 * (`current`), where the reveal wants them (`target`) — 0 full, 1 dark — and
 * how lit the spotlight still is.
 *
 * Falling is immediate: the room going dark IS the cue that something is
 * about to happen. RISING waits for the spot to be out, because the two used
 * to cross-fade at once and that lit the room twice over for the second
 * either side of every handover — the house already half back up while the
 * spot was still half lit. Blooming, that overshoot was the flash at the end
 * of the sweep and on every LIGHTS UP.
 */
export function houseDimGoal(current: number, target: number, spotLevel: number): number {
  const brightening = target < current
  return brightening && spotLevel > SPOT_OUT_LEVEL ? current : target
}

/** How long the whole reveal takes, lead-in and tail included. */
export function revealDurationMs(teamCount: number): number {
  return REVEAL_LEAD_MS + teamCount * REVEAL_STEP_MS + REVEAL_TAIL_MS
}

/**
 * A fresh running order. Fisher-Yates over the team ids, so every order is
 * equally likely — the point of a randomizer that a room of students is about
 * to watch is that nobody can say it favoured anyone. `random` is injectable
 * for the tests; the store passes the platform's.
 */
export function shuffleTeams(
  teams: readonly Pick<TeamDTO, "id">[],
  random: () => number = Math.random,
): string[] {
  const ids = teams.map((team) => team.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  }
  return ids
}

/**
 * The gamemaster's spotlight request. A team id or null (lights up), and the
 * store checks the id is actually in the running order — a spotlight on a
 * team that is not presenting is a mis-click, not a request.
 */
export function parseSpotlightInput(input: unknown): string | null {
  const teamId = (input as { teamId?: unknown } | null)?.teamId
  if (teamId === null || teamId === undefined) return null
  if (typeof teamId === "string" && teamId.trim()) return teamId
  throw new Error("INVALID_INPUT: teamId must be a team id or null")
}

/**
 * The gamemaster marking a team off, or putting one back: `{ teamId, done }`.
 * `done` defaults to true — the button that is pressed ninety-nine times out
 * of a hundred is the one that says a team has finished.
 */
export function parseDoneInput(input: unknown): { teamId: string; done: boolean } {
  const o = (input ?? {}) as Record<string, unknown>
  if (typeof o.teamId !== "string" || !o.teamId.trim()) {
    throw new Error("INVALID_INPUT: teamId required")
  }
  if (o.done !== undefined && typeof o.done !== "boolean") {
    throw new Error("INVALID_INPUT: done must be true or false")
  }
  return { teamId: o.teamId, done: o.done !== false }
}

/**
 * The room's view of the order: the same state with each team id resolved
 * to the desk it sits at. Ids the room does not know are dropped rather than
 * kept as a hole — a slot the room cannot point a light at is not a slot the
 * room can reveal — and the wall names them from the labels it has.
 */
export interface RoomPresentation {
  /** Desk indices, first presenter first. */
  order: number[]
  revealedAt: number
  nonce: number
  /** The desk under the spotlight, or null. */
  spotlightTeamIdx: number | null
  /** Desks whose team has finished presenting. */
  doneTeamIdxs: number[]
}

export function roomPresentation(
  state: PresentationState | null,
  teams: readonly Pick<TeamDTO, "id">[],
): RoomPresentation | null {
  if (!state) return null
  const byId = new Map(teams.map((team, idx) => [team.id, idx]))
  const order = state.order
    .map((id) => byId.get(id))
    .filter((idx): idx is number => idx !== undefined)
  const spotlightTeamIdx = state.spotlight === null ? null : byId.get(state.spotlight) ?? null
  const doneTeamIdxs = donePresenting(state)
    .map((id) => byId.get(id))
    .filter((idx): idx is number => idx !== undefined)
  return { order, revealedAt: state.revealedAt, nonce: state.nonce, spotlightTeamIdx, doneTeamIdxs }
}

/**
 * Has this desk's team presented already? The room asks per desk, every
 * frame it repaints a numeral, so this stays a plain membership test.
 */
export function isDeskDone(presentation: RoomPresentation, teamIdx: number): boolean {
  return presentation.doneTeamIdxs.includes(teamIdx)
}

/** The 1-based presentation slot of each desk, aligned with the desks. */
export function presentationSlotsByTeamIdx(
  presentation: RoomPresentation,
  teamCount: number,
): (number | null)[] {
  const slots: (number | null)[] = Array.from({ length: teamCount }, () => null)
  presentation.order.forEach((teamIdx, slot) => {
    if (teamIdx >= 0 && teamIdx < teamCount) slots[teamIdx] = slot + 1
  })
  return slots
}

/** One entry on the wall's running-order page. */
export interface PresentationBoardEntry {
  /** 1-based presentation slot. */
  slot: number
  label: string
  /** Whether the sweep has reached this slot yet; before that it reads "?". */
  revealed: boolean
  /** This is the team under the spotlight now. */
  live: boolean
  /** This team has presented — the wall ticks it and greens its number. */
  done: boolean
}

export interface PresentationBoard {
  entries: PresentationBoardEntry[]
  /** The team on stage, when there is one — the wall leads with it. */
  spotlight: { slot: number; label: string } | null
  /** How many have presented, and out of how many — the wall's progress. */
  doneCount: number
  total: number
}

/** The running order as the wall screen draws it at `now`. */
export function presentationBoard(
  presentation: RoomPresentation,
  teamLabels: readonly string[],
  now: number,
): PresentationBoard {
  const { revealed } = revealProgress(presentation, now)
  const entries = presentation.order.map((teamIdx, i) => ({
    slot: i + 1,
    label: teamLabels[teamIdx] ?? `TEAM ${teamIdx + 1}`,
    revealed: i < revealed,
    live: presentation.spotlightTeamIdx === teamIdx,
    // Only once the sweep has got here: a slot still reading "?" must not
    // give away which team it is by ticking it.
    done: i < revealed && isDeskDone(presentation, teamIdx),
  }))
  const liveEntry = entries.find((entry) => entry.live)
  return {
    entries,
    spotlight: liveEntry ? { slot: liveEntry.slot, label: liveEntry.label } : null,
    doneCount: entries.filter((entry) => entry.done).length,
    total: entries.length,
  }
}

/** "1ST" / "2ND" / "11TH" — the ordinal the banner and the toast read. */
export function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}TH`
  switch (n % 10) {
    case 1:
      return `${n}ST`
    case 2:
      return `${n}ND`
    case 3:
      return `${n}RD`
    default:
      return `${n}TH`
  }
}
