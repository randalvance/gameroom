import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CUSTOM_SPRITE_ID } from "~/lib/roster"
import type { GameRoomMenuPerson } from "~/lib/game-room-menu"
import { GameRoomMenuSprite } from "./GameRoomMenuSprite"

vi.mock("~/components/sprite/SpriteWalkPreview", () => ({
  SpriteWalkPreview: ({ src, scale, rows, label }: { src: string; scale: number; rows: number[]; label: string }) => (
    <img alt={label} data-rows={rows.join(",")} data-scale={scale} data-src={src} />
  ),
}))

function person(overrides: Partial<GameRoomMenuPerson> = {}): GameRoomMenuPerson {
  return {
    id: "student-1",
    name: "Ada",
    role: "student",
    spriteId: 3,
    spriteSheet: null,
    teamName: "TEAM ALPHA",
    playerIdx: 0,
    teamIdx: 0,
    ...overrides,
  }
}

describe("GameRoomMenuSprite", () => {
  it("uses the selected built-in character sheet", () => {
    render(<GameRoomMenuSprite person={person({ spriteId: 3 })} scale={2} />)

    const preview = screen.getByRole("img", { name: "Ada walking" })
    expect(preview.getAttribute("data-src")).toBe("/assets/room/characters/char_3.png")
    expect(preview.getAttribute("data-scale")).toBe("2")
    expect(preview.getAttribute("data-rows")).toBe("0")
  })

  it("uses a stored custom character sheet", () => {
    render(<GameRoomMenuSprite person={person({ spriteId: CUSTOM_SPRITE_ID, spriteSheet: "data:image/png;base64,sheet" })} scale={3} />)

    const preview = screen.getByRole("img", { name: "Ada walking" })
    expect(preview.getAttribute("data-src")).toBe("data:image/png;base64,sheet")
    expect(preview.getAttribute("data-scale")).toBe("3")
    expect(preview.getAttribute("data-rows")).toBe("0")
  })

  it("uses a derived built-in character sheet when no sprite is assigned", () => {
    render(<GameRoomMenuSprite person={person({ spriteId: null, playerIdx: 2, teamIdx: 1 })} scale={2} />)

    const preview = screen.getByRole("img", { name: "Ada walking" })
    expect(preview.getAttribute("data-src")).toMatch(/^\/assets\/room\/characters\/char_\d+\.png$/)
    expect(preview.getAttribute("data-scale")).toBe("2")
    expect(preview.getAttribute("data-rows")).toBe("0")
  })
})
