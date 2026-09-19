import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import FighterGame from "./FighterGame"

const audio = vi.hoisted(() => ({ preload: vi.fn(), sfx: vi.fn(), music: vi.fn(), duck: vi.fn(),
  cue: vi.fn(), takes: () => 1, setVolumes: vi.fn(), close: vi.fn() }))
const stages = vi.hoisted(() => ({ load: vi.fn(async (_stage?: unknown) => ({})) }))
vi.mock("./arcade-audio", () => ({ createArcadeSoundBank: () => audio }))
vi.mock("./arcade-ladder", () => ({ buildCpuLadder: () => ["bear", "quant", "bernard"] }))
vi.mock("./fight-renderer", () => ({ createFightRenderer: () => ({
  setSprites() {}, setStage() {}, render() {}, resize() {}, dispose() {}, onEvent() {},
}) }))
vi.mock("./sprite-loader", () => ({ loadFighterSprites: async () => ({}), loadStageImages: stages.load }))
vi.mock("./fight-sim", async importOriginal => {
  const original = await importOriginal<typeof import("./fight-sim")>()
  return { ...original, stepFight: (state: ReturnType<typeof original.createFight>) => {
    state.phase = "matchover"; state.matchWinner = 0; state.events = []
    return state
  } }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it("loads each ladder opponent and enters the newsroom only for Bernard's final fight", async () => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
  fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
  fireEvent.click(screen.getByRole("button", { name: "LOCK IN BULL" }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const startFight = screen.queryByRole("button", {name:/START FIGHT/}); if (startFight) fireEvent.click(startFight)
  await act(async () => {})
  expect(stages.load).toHaveBeenLastCalledWith(expect.objectContaining({
    layers: expect.objectContaining({ far: expect.objectContaining({ url: "/assets/arcade/stage-far-v10.jpg" }) }),
  }))
  for (const opponent of ["quant", "bernard"]) {
    audio.preload.mockClear()
    act(() => { frame(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    fireEvent.click(screen.getByRole("button", { name: /CONTINUE TO FIGHT/ }))
    fireEvent.click(screen.getByRole("button", {name:/START FIGHT/}))
    await act(async () => {})
    expect(audio.preload).toHaveBeenCalledWith("fight", ["bull", opponent])
    expect(stages.load).toHaveBeenLastCalledWith(expect.objectContaining({
      layers: expect.objectContaining({ far: expect.objectContaining({
        url: opponent === "bernard" ? "/assets/arcade/stage-newsroom-v1.jpg" : "/assets/arcade/stage-far-v10.jpg",
      }) }),
    }))
  }
})
