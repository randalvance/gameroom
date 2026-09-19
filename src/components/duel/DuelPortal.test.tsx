import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import type { ComponentType } from "react"

const load = vi.hoisted(() => vi.fn())
vi.mock("./load-duel", () => ({ loadDuel: load }))
const warn = vi.hoisted(() => vi.fn())
vi.mock("~/lib/logger", () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }))
import { DuelPortal } from "./DuelPortal"
import type { DuelGameProps } from "./DuelGame"

const loaded = { default: ({ onExit, houseName, volume }: DuelGameProps) => <button onClick={onExit}>Leave duel with {houseName} {volume}</button> }
beforeEach(() => load.mockReset())
const props = { houseDeck: "bears" as const, houseName: "ALUMNI", volume: 0.5, onWin: vi.fn() }

it("downloads nothing until a desk is accepted, then leaves through the game's exit", async () => {
  load.mockResolvedValue(loaded)
  const onExit = vi.fn()
  const view = render(<DuelPortal active={false} {...props} onExit={onExit} />)
  expect(load).not.toHaveBeenCalled()
  view.rerender(<DuelPortal active {...props} onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Leave duel with ALUMNI 0.5" }))
  expect(load).toHaveBeenCalledTimes(1)
  expect(onExit).toHaveBeenCalledOnce()
})

it("offers retry and return on a failed download", async () => {
  load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(loaded)
  const onExit = vi.fn()
  render(<DuelPortal active {...props} onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
  expect(await screen.findByRole("button", { name: "Leave duel with ALUMNI 0.5" })).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
  expect(warn).toHaveBeenCalledWith("duel.chunk_load_failed", { houseDeck: "bears", attempt: 0 }, expect.any(Error))
})

it("a late download cannot reopen the game after walking away", async () => {
  let resolve!: (module: { default: ComponentType<DuelGameProps> }) => void
  load.mockReturnValue(new Promise((done) => { resolve = done }))
  const onExit = vi.fn()
  const view = render(<DuelPortal active {...props} onExit={onExit} />)
  fireEvent.click(screen.getByRole("button", { name: "Back to game room" }))
  expect(onExit).toHaveBeenCalledOnce()
  view.rerender(<DuelPortal active={false} {...props} onExit={onExit} />)
  await act(async () => resolve(loaded))
  expect(screen.queryByRole("button", { name: "Leave duel with ALUMNI 0.5" })).toBeNull()
})
