// Who sees which trades on the Trading Alpha desk.
//
// Kept as a pure function, away from the query that uses it, because the rule
// is the part worth testing: it decides what one team may read about another,
// and it has to hold for five roles whose teams are established three different
// ways (a student's seat, an admin's switcher, nobody's).

import type { Role } from "./auth"

export type TradeScope =
  | { kind: "all" } // the whole market tape
  | { kind: "team"; teamId: string } // only trades this team was a side of
  | { kind: "none" } // nothing to show — no team to scope to

export interface TradeScopeInput {
  role: Role
  // The seat the caller holds, resolved SERVER-side. Null for everyone who
  // trades through the switcher rather than a seat.
  membershipTeamId: string | null
  // The team the desk is currently acting for. This arrives from the CLIENT,
  // so it is honoured only where the caller may legitimately act for any team.
  actingTeamId?: string
}

// The desk shows the team it is acting for; a student is never shown the whole
// market. Orders and positions already follow the acting team (both come from
// the portfolio the desk fetches for it) — this keeps the tape in step.
export function tradeScopeFor({ role, membershipTeamId, actingTeamId }: TradeScopeInput): TradeScope {
  if (role === "student") {
    // actingTeamId is deliberately unused: a student is scoped to their own
    // seat, never to a team id the browser asked for.
    return membershipTeamId ? { kind: "team", teamId: membershipTeamId } : { kind: "none" }
  }
  // An admin acts for a team through the switcher, so the tape follows it.
  if (role === "admin" && actingTeamId) {
    return { kind: "team", teamId: actingTeamId }
  }
  // Mentors, judges and viewers read the market unfiltered — by role, so a seat
  // one of them happens to hold never narrows the tape without them asking.
  return { kind: "all" }
}
