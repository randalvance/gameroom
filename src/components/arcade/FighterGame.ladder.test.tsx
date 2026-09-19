import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import FighterGame from "./FighterGame"

const sim = vi.hoisted(() => ({ winner: 0 as 0 | 1, create: vi.fn() }))
vi.mock("./arcade-audio", () => ({ createArcadeSoundBank: () => ({ preload() {}, sfx() {}, music() {}, duck() {}, cue() {}, takes: () => 1, setVolumes() {}, close() {} }) }))
vi.mock("./arcade-ladder", () => ({ buildCpuLadder: () => ["bear", "quant", "bernard"] }))
vi.mock("./fight-renderer", () => ({ createFightRenderer: () => ({ setSprites() {}, setStage() {}, render() {}, resize() {}, dispose() {}, onEvent() {} }) }))
vi.mock("./sprite-loader", () => ({ loadFighterSprites: async () => ({}), loadStageImages: async () => ({}) }))
vi.mock("./fight-sim", async importOriginal => {
  const original = await importOriginal<typeof import("./fight-sim")>()
  return { ...original, createFight: (...args: Parameters<typeof original.createFight>) => {
    sim.create(...args); return original.createFight(...args)
  }, stepFight: (state: ReturnType<typeof original.createFight>) => {
    state.phase = "matchover"; state.matchWinner = sim.winner; state.events = []; return state
  } }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.localStorage.clear() })

it("hides locked Bernard in the ladder and preserves stage two on rematch and fighter changes", async () => {
  vi.useFakeTimers(); sim.create.mockClear(); sim.winner = 0
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1400) }) }
  const finish = async (winner: 0 | 1) => {
    sim.winner = winner; act(() => { frame(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
  }
  const start = async () => { fireEvent.click(screen.getByRole("button", { name: /START FIGHT/ })); await act(async () => {}) }
  render(<FighterGame onExit={() => {}} volume={0} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
  fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
  fireEvent.click(screen.getByRole("button", { name: "LOCK IN BULL" })); await settle()
  let ladder = screen.getByRole("region", { name: "Arcade ladder" })
  expect(within(ladder).getAllByRole("listitem")).toHaveLength(3)
  expect(ladder.textContent).toMatch(/BEAR.*QUANT.*\?\?\?/)
  expect(within(ladder).queryByText("BERNARD")).toBeNull()
  expect(sim.create).not.toHaveBeenCalled()
  await start(); expect(sim.create).toHaveBeenLastCalledWith("bull", "bear", undefined)
  await finish(0)
  fireEvent.click(screen.getByRole("button", { name: "CONTINUE TO FIGHT 2" }))
  expect(screen.getByRole("button", { name: "START FIGHT 2" })).toBeTruthy()
  await start(); await finish(1)
  fireEvent.click(screen.getByRole("button", { name: "Rematch" }))
  expect(screen.getByRole("button", { name: "START FIGHT 2" })).toBeTruthy()
  await start(); expect(sim.create).toHaveBeenLastCalledWith("bull", "quant", undefined)
  await finish(1)
  fireEvent.click(screen.getByRole("button", { name: "Choose fighter" }))
  const opponent = screen.getByRole("listitem", { name: /QUANT/ })
  expect(opponent.getAttribute("aria-disabled")).toBe("true")
  fireEvent.click(opponent)
  expect(screen.getByRole("button", { name: "LOCK IN BULL" })).toBeTruthy()
  fireEvent.keyDown(window, { code: "KeyD" }); fireEvent.keyDown(window, { code: "KeyD" })
  expect((screen.getByRole("button", { name: "CURRENT OPPONENT" }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(window, { code: "Enter" })
  expect(screen.queryByRole("region", { name: "Arcade ladder" })).toBeNull()
  fireEvent.click(screen.getByRole("listitem", { name: "BEAR" }))
  fireEvent.click(screen.getByRole("button", { name: "LOCK IN BEAR" })); await settle()
  await start(); expect(sim.create).toHaveBeenLastCalledWith("bear", "quant", undefined)
  await finish(0)
  fireEvent.click(screen.getByRole("button", { name: "CONTINUE TO FIGHT 3" }))
  ladder = screen.getByRole("region", { name: "Arcade ladder" })
  expect(within(ladder).getAllByText("CLEARED")).toHaveLength(2)
  await start(); expect(sim.create).toHaveBeenLastCalledWith("bear", "bernard", {bossSlot:1})
})
