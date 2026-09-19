import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import FighterGame from "./FighterGame"

const capture = vi.hoisted(() => ({ step: vi.fn() }))
vi.mock("./arcade-audio", () => ({ createArcadeSoundBank: () => ({ preload() {}, sfx() {}, music() {}, duck() {}, cue() {}, takes: () => 1, setVolumes() {}, close() {} }) }))
vi.mock("./fight-renderer", () => ({ createFightRenderer: () => ({ setSprites() {}, setStage() {}, render() {}, resize() {}, dispose() {}, onEvent() {} }) }))
vi.mock("./sprite-loader", () => ({ loadFighterSprites: async () => ({}), loadStageImages: async () => ({}) }))
vi.mock("./fight-sim", async importOriginal => {
  const original = await importOriginal<typeof import("./fight-sim")>()
  return { ...original, stepFight: (...args: Parameters<typeof original.stepFight>) => {
    capture.step(args[1]); return original.stepFight(...args)
  } }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.localStorage.clear() })

function keyboardGame() {
  vi.useFakeTimers()
  capture.step.mockClear()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never
  let frame: FrameRequestCallback = () => {}
  let now = 1000
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  render(<FighterGame onExit={() => {}} volume={0} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
  return () => {
    capture.step.mockClear()
    act(() => { frame(now); now += 20 })
    // A rendered frame can run two simulation steps. Attack presses are
    // intentionally consumed by the first step, unlike held directions.
    return capture.step.mock.calls[0]![0]
  }
}

it("lets both players lock in using the compact keyboard attack keys", async () => {
  keyboardGame()
  fireEvent.click(screen.getByRole("button", { name: /2P VERSUS/ }))
  fireEvent.keyDown(window, { code: "KeyF", key: "f" })
  expect(screen.getByRole("button", { name: "WAITING FOR 2P" })).toBeTruthy()
  fireEvent.keyDown(window, { code: "KeyU", key: "u" })
  expect(screen.getByRole("button", { name: "READY…" })).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const startFight = screen.queryByRole("button", {name:/START FIGHT/}); if (startFight) fireEvent.click(startFight)
  await act(async () => {})
  expect(screen.getByLabelText("Fight: 1P versus 2P, round 1")).toBeTruthy()
})

it("routes simultaneous compact-keyboard attacks to separate fighters and releases held directions", async () => {
  const sample = keyboardGame()
  fireEvent.click(screen.getByRole("button", { name: /2P VERSUS/ }))
  fireEvent.click(screen.getByRole("button", { name: "LOCK IN BULL" }))
  // Legacy numpad remains an alias, allowing existing players to lock in.
  fireEvent.keyDown(window, { code: "Numpad4", key: "4" })
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const startFight = screen.queryByRole("button", {name:/START FIGHT/}); if (startFight) fireEvent.click(startFight)
  await act(async () => {})
  fireEvent.keyDown(window, { code: "KeyD", key: "d" })
  fireEvent.keyDown(window, { code: "ArrowLeft", key: "ArrowLeft" })
  for (const [p1Key, p2Key, action] of [["F", "U", "lp"], ["G", "I", "hp"], ["V", "J", "lk"], ["B", "K", "hk"], ["R", "O", "sp"]]) {
    fireEvent.keyDown(window, { code: `Key${p1Key}`, key: p1Key!.toLowerCase() })
    const p1Only = sample()
    expect(p1Only[0][action!]).toBe(true)
    expect(p1Only[1][action!]).toBe(false)
    fireEvent.keyUp(window, { code: `Key${p1Key}` })
    fireEvent.keyDown(window, { code: `Key${p2Key}`, key: p2Key!.toLowerCase() })
    const p2Only = sample()
    expect(p2Only[0][action!]).toBe(false)
    expect(p2Only[1][action!]).toBe(true)
    fireEvent.keyUp(window, { code: `Key${p2Key}` })
    fireEvent.keyDown(window, { code: `Key${p1Key}`, key: p1Key!.toLowerCase() })
    fireEvent.keyDown(window, { code: `Key${p2Key}`, key: p2Key!.toLowerCase() })
    const input = sample()
    expect(input[0]).toMatchObject({ right: true, left: false, [action!]: true })
    expect(input[1]).toMatchObject({ left: true, right: false, [action!]: true })
    for (const other of ["lp", "hp", "lk", "hk", "sp"].filter(key => key !== action)) {
      expect(input[0][other]).toBe(false)
      expect(input[1][other]).toBe(false)
    }
    fireEvent.keyUp(window, { code: `Key${p1Key}` })
    fireEvent.keyUp(window, { code: `Key${p2Key}` })
  }
  fireEvent.keyUp(window, { code: "KeyD" })
  fireEvent.keyUp(window, { code: "ArrowLeft" })
  expect(sample().map((input: { left: boolean; right: boolean }) => [input.left, input.right])).toEqual([[false, false], [false, false]])
  fireEvent.keyDown(window, { key: "R" })
  fireEvent.keyDown(window, { key: "O" })
  expect(sample().map((input: { sp: boolean }) => input.sp)).toEqual([true, true])
  fireEvent.keyDown(window, { code: "KeyW" })
  fireEvent.keyDown(window, { code: "ArrowUp" })
  fireEvent.blur(window)
  expect(sample().map((input: { up: boolean }) => input.up)).toEqual([false, false])
})

it("retains solo controls after leaving versus selection and accepts the Konami B ending", async () => {
  const sample = keyboardGame()
  fireEvent.click(screen.getByRole("button", { name: /2P VERSUS/ }))
  fireEvent.click(screen.getByRole("button", { name: "Back" }))
  for (const key of "wwssadadba") fireEvent.keyDown(window, { key, code: `Key${key.toUpperCase()}` })
  expect(screen.getByText("BERNARD UNLOCKED")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
  fireEvent.keyDown(window, { code: "KeyU" })
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const startFight = screen.queryByRole("button", {name:/START FIGHT/}); if (startFight) fireEvent.click(startFight)
  await act(async () => {})
  for (const [key, action] of [["U", "lp"], ["I", "hp"], ["J", "lk"], ["K", "hk"], ["O", "sp"]]) {
    fireEvent.keyDown(window, { code: `Key${key}` })
    expect(sample()[0][action!]).toBe(true)
    fireEvent.keyUp(window, { code: `Key${key}` })
  }
})

it("lets touch players select Breaking News and returns to direction-based controls", async () => {
  vi.useFakeTimers()
  window.localStorage.setItem("impact-hackers.bernard-unlocked", "true")
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }) as never
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  render(<FighterGame onExit={() => {}} volume={0} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
  fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
  fireEvent.click(screen.getByRole("listitem", { name: "BERNARD" }))
  fireEvent.click(screen.getByRole("button", { name: "LOCK IN BERNARD" }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const startFight = screen.queryByRole("button", {name:/START FIGHT/}); if (startFight) fireEvent.click(startFight)
  await act(async () => {})
  const select = screen.getByRole("combobox", { name: "Bernard special move" })
  expect(select.querySelectorAll("option")).toHaveLength(8)
  fireEvent.change(select, { target: { value: "bernard-breaking-news" } })
  fireEvent.pointerDown(screen.getByRole("button", { name: "Special move" }))
  act(() => { frame(1000) })
  expect(capture.step.mock.calls.at(-1)![0][0]).toMatchObject({ sp: true, specialId: "bernard-breaking-news" })
  fireEvent.change(select, { target: { value: "" } })
  fireEvent.pointerDown(screen.getByRole("button", { name: "Special move" }))
  act(() => { frame(1020) })
  expect(capture.step.mock.calls.at(-1)![0][0]).toMatchObject({ sp: true })
  expect(capture.step.mock.calls.at(-1)![0][0].specialId).toBeUndefined()
})
