// The trading authorization rule and its types — PURE, and deliberately free of
// any database import so it stays client-importable.
//
// Same split as user-sync.ts / user-mirror.ts: the trading screen imports the
// types and the server functions, so anything reachable from here that touched
// `@c2i/db` would drag the pg driver (and `Buffer`) into the browser bundle.
// The db-touching half lives in ~/server/team-membership-db.ts.

import type { Role } from "./auth"

export interface TeamMembership {
  teamId: string // accounts.team_id — the shared web/exchange team identity
  teamName: string
}

export interface TradingIdentity {
  role: Role
  membership: TeamMembership | null
}

// Throws a Response (403-equivalent) on refusal; returns cleanly on pass.
// `callerTeam` is the team the caller holds a seat on, or null if none.
//
// Before this rule existed the team code came straight from the client and was
// checked only for existence, so any student could trade as any team.
export function assertTeamAccess(
  role: Role,
  callerTeam: string | null,
  requestedTeam: string,
): void {
  // The gamemaster acts for any team: opening balances, support and smoke tests
  // all need it. This is the one intentional bypass.
  if (role === "admin") return

  if (role !== "student") {
    throw new Response("Trading is limited to students", { status: 403 })
  }
  if (!callerTeam) {
    // Seats are assigned by the organizers directly in the database — there is
    // no self-service join, so this is not something the student can fix.
    throw new Response(
      "You have not been assigned a team yet — ask an organizer",
      { status: 403 },
    )
  }
  if (callerTeam !== requestedTeam) {
    throw new Response("You may only act for your own team", { status: 403 })
  }
}
