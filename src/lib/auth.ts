// Who someone is in the room, as far as the room cares.
//
// The event site this came from resolved this from Clerk, server-side, and
// nothing about that belongs in an embeddable component. What is left is the
// vocabulary: a role decides what the room SHOWS you (the crown over your
// head, whether the gamemaster's music command reaches your speakers, whether
// the menu offers the console) and nothing about what you may reach. The host
// decides who is what and passes it in.

export type Role = "student" | "viewer" | "mentor" | "judge" | "admin"

/** The roles the room knows. Iteration order drives any selector built on it. */
export const KNOWN_ROLES: ReadonlySet<Role> = new Set([
  "student",
  "viewer",
  "mentor",
  "judge",
  "admin",
])

/**
 * A role from whatever the host stored, defaulting to `student`.
 *
 * "participant" maps to "student" because that is what it used to be called
 * and old rows outlive renames.
 */
export function normalizeRole(raw: unknown): Role {
  if (raw === "participant") return "student"
  if (typeof raw === "string" && KNOWN_ROLES.has(raw as Role)) return raw as Role
  return "student"
}
