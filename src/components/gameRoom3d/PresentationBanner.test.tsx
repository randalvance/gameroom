import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BANNER_FLASH_MS, bannerText, PresentationBanner } from "./PresentationBanner"

const TEAMS = [
  { id: "team-a", name: "TEAM 01" },
  { id: "team-b", name: "TEAM 02" },
  { id: "team-c", name: "TEAM 03" },
]

const state = (spotlight: string | null, nonce = 1) => ({
  order: ["team-c", "team-a", "team-b"],
  revealedAt: 0,
  nonce,
  spotlight,
})

describe("bannerText", () => {
  it("names the team on stage with its slot in the order", () => {
    expect(bannerText(state("team-a"), TEAMS)).toEqual({ slot: 2, total: 3, name: "TEAM 01" })
  })

  it("is nothing between presenters, and with no order", () => {
    expect(bannerText(state(null), TEAMS)).toBeNull()
    expect(bannerText(null, TEAMS)).toBeNull()
  })

  // A spotlight on a team the room has no desk for is not one the room can
  // announce.
  it("is nothing for a team this room does not know", () => {
    expect(bannerText(state("ghost"), TEAMS)).toBeNull()
  })
})

describe("PresentationBanner", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("flashes the team's slot and name, then settles into a chip", () => {
    render(<PresentationBanner presentation={state("team-c")} teams={TEAMS} />)
    const banner = screen.getByTestId("presentation-banner")
    expect(banner.textContent).toContain("1ST OF 3")
    expect(banner.textContent).toContain("TEAM 03")
    expect(banner.dataset.flashing).toBe("true")
    act(() => vi.advanceTimersByTime(BANNER_FLASH_MS + 1))
    expect(screen.getByTestId("presentation-banner").dataset.flashing).toBe("false")
  })

  it("flashes again for the next presenter", () => {
    const view = render(<PresentationBanner presentation={state("team-c")} teams={TEAMS} />)
    act(() => vi.advanceTimersByTime(BANNER_FLASH_MS + 1))
    expect(screen.getByTestId("presentation-banner").dataset.flashing).toBe("false")
    view.rerender(<PresentationBanner presentation={state("team-a")} teams={TEAMS} />)
    const banner = screen.getByTestId("presentation-banner")
    expect(banner.dataset.flashing).toBe("true")
    expect(banner.textContent).toContain("2ND OF 3")
  })

  it("is gone when the lights come up", () => {
    const view = render(<PresentationBanner presentation={state("team-c")} teams={TEAMS} />)
    view.rerender(<PresentationBanner presentation={state(null)} teams={TEAMS} />)
    expect(screen.queryByTestId("presentation-banner")).toBeNull()
  })
})
