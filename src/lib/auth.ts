// Who someone is in the room, as far as the room cares.
//
// A role decides what the room SHOWS a visitor — the colour of the ring under
// their feet, whether the gamemaster's music command reaches their speakers —
// and nothing about what they may reach. The host decides who is what and
// passes it in.

export type Role = "visitor" | "host" | "screen"

/** The roles the room knows. Iteration order drives any selector built on it. */
export const KNOWN_ROLES: ReadonlySet<Role> = new Set(["visitor", "host", "screen"])

/** A role from whatever the host stored, defaulting to `visitor`. */
export function normalizeRole(raw: unknown): Role {
  if (typeof raw === "string" && KNOWN_ROLES.has(raw as Role)) return raw as Role
  return "visitor"
}
