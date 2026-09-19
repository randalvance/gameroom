import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WINNERS_FLASH_MS, winnersBannerText, WinnersBanner } from "./WinnersBanner"
import type { WinnersState } from "~/lib/winners-ceremony"

const TEAMS = [
  { id: "team-a", name: "TEAM 01" },
  { id: "team-b", name: "TEAM 02" },
  { id: "team-c", name: "TEAM 03" },
]

const state = (podium: WinnersState["podium"], nonce = 1): WinnersState => ({
  startedAt: 0,
  nonce,
  podium,
})

describe("winnersBannerText", () => {
  it("names the team just announced with its place", () => {
    expect(winnersBannerText(state([{ place: 3, teamId: "team-b", announcedAt: 1 }]), TEAMS)).toEqual({
      place: 3,
      name: "TEAM 02",
    })
    expect(
      winnersBannerText(
        state([
          { place: 3, teamId: "team-b", announcedAt: 1 },
          { place: 2, teamId: "team-a", announcedAt: 2 },
        ]),
        TEAMS,
      ),
    ).toEqual({ place: 2, name: "TEAM 01" })
  })

  it("is nothing before the first place is read, and with no ceremony", () => {
    expect(winnersBannerText(state([]), TEAMS)).toBeNull()
    expect(winnersBannerText(null, TEAMS)).toBeNull()
  })

  it("is nothing for a team this room does not know", () => {
    expect(winnersBannerText(state([{ place: 3, teamId: "ghost", announcedAt: 1 }]), TEAMS)).toBeNull()
  })
})

describe("WinnersBanner", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("flashes the place and the team, then settles into a chip", () => {
    render(<WinnersBanner winners={state([{ place: 3, teamId: "team-c", announcedAt: 1 }])} teams={TEAMS} />)
    const banner = screen.getByTestId("winners-banner")
    expect(banner.textContent).toContain("3RD PLACE")
    expect(banner.textContent).toContain("TEAM 03")
    expect(banner.dataset.place).toBe("3")
    expect(banner.dataset.flashing).toBe("true")
    act(() => vi.advanceTimersByTime(WINNERS_FLASH_MS + 1))
    expect(screen.getByTestId("winners-banner").dataset.flashing).toBe("false")
  })

  it("flashes again for the next place, and crowns the winner", () => {
    const third = state([{ place: 3, teamId: "team-c", announcedAt: 1 }])
    const view = render(<WinnersBanner winners={third} teams={TEAMS} />)
    act(() => vi.advanceTimersByTime(WINNERS_FLASH_MS + 1))
    expect(screen.getByTestId("winners-banner").dataset.flashing).toBe("false")
    view.rerender(
      <WinnersBanner
        winners={state([
          ...third.podium,
          { place: 2, teamId: "team-a", announcedAt: 2 },
          { place: 1, teamId: "team-b", announcedAt: 3 },
        ])}
        teams={TEAMS}
      />,
    )
    const banner = screen.getByTestId("winners-banner")
    expect(banner.dataset.flashing).toBe("true")
    expect(banner.textContent).toContain("CHAMPIONS")
    expect(banner.textContent).toContain("1ST PLACE")
    expect(banner.textContent).toContain("TEAM 02")
  })

  it("is gone when the ceremony ends, and silent while nobody has been called", () => {
    const view = render(<WinnersBanner winners={state([{ place: 3, teamId: "team-c", announcedAt: 1 }])} teams={TEAMS} />)
    view.rerender(<WinnersBanner winners={null} teams={TEAMS} />)
    expect(screen.queryByTestId("winners-banner")).toBeNull()
    view.rerender(<WinnersBanner winners={state([])} teams={TEAMS} />)
    expect(screen.queryByTestId("winners-banner")).toBeNull()
  })
})
