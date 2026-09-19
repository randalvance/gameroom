import { describe, expect, it } from "vitest"
import { crownsFor, eggTier, roleMarker, CROWN_SIDE_OFFSET } from "./crowns"

describe("eggTier", () => {
  it("earns nothing for one pet, so the first crown is worth having", () => {
    expect(eggTier(0)).toBeNull()
    expect(eggTier(1)).toBeNull()
  })

  it("climbs bronze, silver, gold", () => {
    expect(eggTier(2)).toBe("bronze")
    expect(eggTier(3)).toBe("silver")
    expect(eggTier(4)).toBe("gold")
  })

  it("stays gold if a fifth pet ever arrives", () => {
    expect(eggTier(5)).toBe("gold")
  })
})

describe("roleMarker", () => {
  it("marks the staff, each with their own", () => {
    expect(roleMarker("admin")).toBe("jewel")
    expect(roleMarker("judge")).toBe("scales")
    expect(roleMarker("mentor")).toBe("compass")
    expect(roleMarker("viewer")).toBe("eye")
  })

  it("leaves students bare: the room is theirs, not a parade of hardware", () => {
    expect(roleMarker("student")).toBeNull()
  })
})

describe("crownsFor", () => {
  it("gives a student with four pets the gold crown alone, centred", () => {
    expect(crownsFor("student", 4)).toEqual([{ kind: "gold", offset: 0 }])
  })

  it("gives staff both, side by side, role on the left", () => {
    expect(crownsFor("judge", 3)).toEqual([
      { kind: "scales", offset: -CROWN_SIDE_OFFSET },
      { kind: "silver", offset: CROWN_SIDE_OFFSET },
    ])
  })

  it("centres a role marker when there are no pets to show", () => {
    expect(crownsFor("admin", 1)).toEqual([{ kind: "jewel", offset: 0 }])
  })

  it("gives a student with one pet nothing at all", () => {
    expect(crownsFor("student", 1)).toEqual([])
  })

  it("earns staff their egg crown like anyone else", () => {
    expect(crownsFor("mentor", 2).map((crown) => crown.kind)).toEqual(["compass", "bronze"])
  })
})
