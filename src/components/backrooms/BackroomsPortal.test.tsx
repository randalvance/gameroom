import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import type { ComponentType } from "react"

const load = vi.hoisted(() => vi.fn())
vi.mock("./load-backrooms", () => ({ loadBackrooms: load }))
import { BackroomsPortal } from "./BackroomsPortal"

const loaded = {
  default: ({ onExit, hideKonamiHint = false }: { onExit: () => void; hideKonamiHint?: boolean }) => (
    <><output>{hideKonamiHint ? "Konami clue hidden" : "Konami clue shown"}</output><button onClick={onExit}>Finish level</button></>
  ),
}
beforeEach(() => load.mockReset())

it("downloads nothing until entry, then leaves through the game's exit", async () => {
  load.mockResolvedValue(loaded)
  const onExit = vi.fn()
  const view = render(<BackroomsPortal active={false} onExit={onExit} />)
  expect(load).not.toHaveBeenCalled()
  view.rerender(<BackroomsPortal active onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Finish level" }))
  expect(load).toHaveBeenCalledTimes(1)
  expect(onExit).toHaveBeenCalledOnce()
})

it("hides the exit clue for a player who has discovered the arcade", async () => {
  load.mockResolvedValue(loaded)
  render(<BackroomsPortal active hideKonamiHint onExit={vi.fn()} />)
  expect(await screen.findByText("Konami clue hidden")).toBeTruthy()
})

it("offers retry and return on a failed download", async () => {
  load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(loaded)
  const onExit = vi.fn()
  render(<BackroomsPortal active onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
  expect(await screen.findByRole("button", { name: "Finish level" })).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
})

it("a late download cannot reopen the game after returning upstairs", async () => {
  let resolve!: (module: { default: ComponentType<{ onExit: () => void }> }) => void
  load.mockReturnValue(new Promise((done) => { resolve = done }))
  const onExit = vi.fn()
  const view = render(<BackroomsPortal active onExit={onExit} />)
  fireEvent.click(screen.getByRole("button", { name: "Back to game room" }))
  expect(onExit).toHaveBeenCalledOnce()
  view.rerender(<BackroomsPortal active={false} onExit={onExit} />)
  await act(async () => resolve(loaded))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Finish level" })).toBeNull())
})
