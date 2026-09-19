import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import type { ComponentType } from "react"

const load = vi.hoisted(() => vi.fn())
vi.mock("./load-arcade", () => ({ loadArcade: load }))
import { ArcadePortal, type ArcadeGameProps } from "./ArcadePortal"

const loaded = { default: ({ onExit, volume }: ArcadeGameProps) => <button onClick={onExit}>Leave arcade {volume}</button> }
beforeEach(() => load.mockReset())

it("downloads nothing until the cabinet is used, then leaves through the game's exit", async () => {
  load.mockResolvedValue(loaded)
  const onExit = vi.fn()
  const view = render(<ArcadePortal active={false} volume={0.5} onExit={onExit} />)
  expect(load).not.toHaveBeenCalled()
  view.rerender(<ArcadePortal active volume={0.5} onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Leave arcade 0.5" }))
  expect(load).toHaveBeenCalledTimes(1)
  expect(onExit).toHaveBeenCalledOnce()
})

it("offers retry and return on a failed download", async () => {
  load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(loaded)
  const onExit = vi.fn()
  render(<ArcadePortal active volume={0.5} onExit={onExit} />)
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
  expect(await screen.findByRole("button", { name: "Leave arcade 0.5" })).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
})

it("a late download cannot reopen the game after walking away", async () => {
  let resolve!: (module: { default: ComponentType<ArcadeGameProps> }) => void
  load.mockReturnValue(new Promise((done) => { resolve = done }))
  const onExit = vi.fn()
  const view = render(<ArcadePortal active volume={0.5} onExit={onExit} />)
  fireEvent.click(screen.getByRole("button", { name: "Back to game room" }))
  expect(onExit).toHaveBeenCalledOnce()
  view.rerender(<ArcadePortal active={false} volume={0.5} onExit={onExit} />)
  await act(async () => resolve(loaded))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Leave arcade 0.5" })).toBeNull())
})
