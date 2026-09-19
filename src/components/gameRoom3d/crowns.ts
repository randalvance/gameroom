// What floats above a character's head.
//
// Two sorts, and a person may wear one of each:
//
//   - a ROLE marker, from their account — staff only, students go bare;
//   - an EGG crown, earned by hatching the title screen's pets: bronze for
//     two, silver for three, gold for all four.
//
// Worn side by side rather than stacked, role on the left, so a glance along a
// row of desks reads roles in one column and achievements in the other. A
// single crown sits centred instead.
//
// While its wearer is speaking the room hides them and the speech bubble takes
// the space: transient things must not push permanent ones around, and a crown
// that bobbed every time somebody talked would read as a fault.
//
// Arithmetic only — no three.js — so the rules are pinned by tests and the
// scene is left with the drawing.

/** The roles the room knows. Anything else is treated as a student. */
export type CrownRole = "admin" | "judge" | "mentor" | "viewer" | "student"

/** A role marker, or the metal of an egg crown. */
export type CrownKind =
  | "jewel"
  | "scales"
  | "compass"
  | "eye"
  | "bronze"
  | "silver"
  | "gold"

export type EggTier = "bronze" | "silver" | "gold"

export interface Crown {
  kind: CrownKind
  /** Sideways offset from the head, in world units: negative is left. */
  offset: number
}

/** How far either side of centre a pair sits. Half a crown's width, so the two
 * of them are not much wider than one. */
export const CROWN_SIDE_OFFSET = 0.26

/**
 * The crown earned by hatching pets. One pet earns nothing: the first crown
 * should be worth having.
 */
export function eggTier(pets: number): EggTier | null {
  if (pets >= 4) return "gold"
  if (pets === 3) return "silver"
  if (pets === 2) return "bronze"
  return null
}

/**
 * What a role wears. Staff are marked so a student can find them across a
 * crowded room; students themselves wear nothing, or the room fills up with
 * hardware and the egg crowns stop standing out.
 */
export function roleMarker(role: CrownRole): CrownKind | null {
  switch (role) {
    case "admin": return "jewel"
    case "judge": return "scales"
    case "mentor": return "compass"
    case "viewer": return "eye"
    case "student": return null
  }
}

/** Everything this character wears, left to right. */
export function crownsFor(role: CrownRole, pets: number): Crown[] {
  const marker = roleMarker(role)
  const tier = eggTier(pets)
  if (marker && tier) {
    return [
      { kind: marker, offset: -CROWN_SIDE_OFFSET },
      { kind: tier, offset: CROWN_SIDE_OFFSET },
    ]
  }
  const only = marker ?? tier
  return only ? [{ kind: only, offset: 0 }] : []
}
