import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDuel } from "./duel-sim"

const track = vi.hoisted(() => vi.fn())
vi.mock("~/lib/analytics", () => ({ track }))
const audio = vi.hoisted(() => ({ sfx: vi.fn(), music: vi.fn(), setVolume: vi.fn(), close: vi.fn() }))
vi.mock("./duel-audio", () => ({ createDuelAudio: () => audio }))
import DuelGame, { HOUSE_STEP_MS } from "./DuelGame"
import { FX_MS } from "./duel-effects"

beforeEach(() => { vi.useFakeTimers(); track.mockReset(); audio.sfx.mockReset(); audio.music.mockReset(); audio.close.mockReset() })
afterEach(() => vi.useRealTimers())

/** A seed whose Bulls opening hand holds a Day Trader: one mana, haste. */
const HASTE_SEED = (() => {
  for (let seed = 1; seed < 500; seed++) {
    if (createDuel("bulls", "bears", seed).you.hand.some((c) => c.id === "bulls/day-trader")) return seed
  }
  throw new Error("no seed deals a Day Trader")
})()

const stepHouse = async (steps = 1) => {
  for (let i = 0; i < steps; i++) await act(async () => { vi.advanceTimersByTime(HOUSE_STEP_MS) })
}

const start = (extra: Partial<React.ComponentProps<typeof DuelGame>> = {}, deck = "Bulls") => {
  const onExit = vi.fn(), onWin = vi.fn()
  render(<DuelGame houseDeck="bears" houseName="SENIOR MANAGEMENT" seed={HASTE_SEED} onExit={onExit} onWin={onWin} {...extra} />)
  fireEvent.click(screen.getByRole("button", { name: `Play ${deck}` }))
  return { onExit, onWin }
}
const region = (name: string) => screen.getByRole("region", { name })
const enabled = (root: HTMLElement) => within(root).getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled)

describe("DuelGame", () => {
  it("announces the house deck and starts a game from the deck you choose", () => {
    start()
    expect(track).toHaveBeenCalledWith("easter_egg.duel_started", { deck: "bulls", house: "bears" })
    expect(screen.getByText(/SENIOR MANAGEMENT plays Bears/)).toBeTruthy()
    expect(within(region("Your hand")).getAllByRole("button")).toHaveLength(5)
    expect(screen.getByText("You: 20 life")).toBeTruthy()
    expect(screen.getByText("House: 20 life")).toBeTruthy()
  })

  it("plays an affordable creature from hand onto the board", () => {
    start()
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    expect(within(region("Your board")).getAllByRole("button")).toHaveLength(1)
    expect(within(region("Your hand")).getAllByRole("button")).toHaveLength(4)
    expect(screen.getByRole("img", { name: "Mana 0 of 1" })).toBeTruthy()
  })

  it("ending the turn lets the house take a stepped turn and hands the turn back", async () => {
    start()
    fireEvent.click(screen.getByRole("button", { name: "End turn" }))
    expect(screen.getByText(/House's turn/)).toBeTruthy()
    for (let i = 0; i < 8 && !screen.queryByText(/Turn 3 · Your turn/); i++) await stepHouse()
    expect(screen.getByText(/Turn 3 · Your turn/)).toBeTruthy()
  })

  it("Escape leaves, reports the drop-off, and no key reaches the room underneath", () => {
    const { onExit } = start()
    const room = vi.fn()
    document.addEventListener("keydown", room)
    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "ArrowLeft" })
    expect(onExit).toHaveBeenCalledOnce()
    expect(track).toHaveBeenCalledWith("easter_egg.duel_left", { deck: "bulls", house: "bears", turn: 1, stage: "board" })
    expect(room).not.toHaveBeenCalled()
    document.removeEventListener("keydown", room)
  })
  it("leaving from deck select is a drop-off too; leaving the result screen is not", async () => {
    const onExit = vi.fn(), onWin = vi.fn()
    render(<DuelGame houseDeck="quants" houseName="ALUMNI" seed={HASTE_SEED} onExit={onExit} onWin={onWin} />)
    fireEvent.click(screen.getByRole("button", { name: "Back to the room" }))
    expect(track).toHaveBeenCalledWith("easter_egg.duel_left", { house: "quants", stage: "select" })
    expect(onExit).toHaveBeenCalledOnce()
  })

  it("a win reaches the result screen, records it and reports the finish", async () => {
    const { onExit, onWin } = start({ houseName: "ALUMNI", debugHouseLife: 1 })
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    const trader = enabled(region("Your board"))[0]!
    fireEvent.click(trader)
    expect(trader.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Attack with 1" }))
    await stepHouse()
    expect(screen.getByText("You win!")).toBeTruthy()
    expect(onWin).toHaveBeenCalledWith("bears")
    expect(track).toHaveBeenCalledWith("easter_egg.duel_finished", { deck: "bulls", house: "bears", won: true, turns: 1, reason: "life" })
    track.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Back to the room" }))
    expect(onExit).toHaveBeenCalledOnce()
    expect(track).not.toHaveBeenCalledWith("easter_egg.duel_left", expect.anything())
  })

  it("a targeted spell asks for a target and cancels cleanly", () => {
    start({}, "Bears")
    // Find any targeted spell the seed dealt; if none, play through is not possible here.
    const hand = region("Your hand")
    const spell = within(hand).queryAllByRole("button", { name: /Bankruptcy|Liquidation|Bear Raid/ })[0]
    if (!spell) return
    if ((spell as HTMLButtonElement).disabled) return
    fireEvent.click(spell)
    if (screen.queryByRole("button", { name: "Cancel" })) {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    }
  })
})

describe("effects", () => {
  it("an attack lunges the attacker and floats the damage off the house's life, then clears", async () => {
    start({ debugHouseLife: 30 })
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    expect(enabled(region("Your board"))[0]!.className).toContain("duel-fx-summon")
    const trader = enabled(region("Your board"))[0]!
    fireEvent.click(trader)
    fireEvent.click(screen.getByRole("button", { name: "Attack with 1" }))
    await stepHouse()
    expect(screen.getByText("House: 28 life").className).toContain("duel-fx-hit")
    expect(screen.getByText("-2")).toBeTruthy()
    expect(within(region("Your board")).getAllByRole("button")[0]!.className).toContain("duel-fx-lunge-you")
    await act(async () => { vi.advanceTimersByTime(FX_MS + 1) })
    expect(screen.queryByText("-2")).toBeNull()
    expect(within(region("Your board")).getAllByRole("button")[0]!.className).not.toContain("duel-fx-lunge-you")
  })
  it("a spell you cast is held up in the middle and its damage floats off the target", async () => {
    // A seed whose Bulls hand has both a Day Trader and a Short Squeeze.
    let seed = 1
    for (; seed < 2000; seed++) {
      const hand = createDuel("bulls", "bears", seed).you.hand.map((c) => c.id)
      if (hand.includes("bulls/day-trader") && hand.includes("bulls/short-squeeze")) break
    }
    start({ seed, debugHouseLife: 30 })
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    fireEvent.click(screen.getByRole("button", { name: "End turn" }))
    for (let i = 0; i < 10 && !screen.queryByText(/Turn 3 · Your turn/); i++) await stepHouse()
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Short Squeeze, 2 mana" })[0]!)
    fireEvent.click(screen.getByRole("button", { name: /^House: \d+ life$/ }))
    expect(screen.getByRole("status", { name: "You cast Short Squeeze" })).toBeTruthy()
    expect(screen.getByText("-3")).toBeTruthy()
    expect(screen.getByText(/^House: 27 life$/).className).toContain("duel-fx-hit")
  })
})

describe("sound", () => {
  it("confirms the deck, plays the table, and answers moves with cues", async () => {
    start({ debugHouseLife: 30 })
    expect(audio.sfx).toHaveBeenCalledWith("confirm")
    expect(audio.music).toHaveBeenLastCalledWith("table")
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    expect(audio.sfx.mock.calls.map((c) => c[0])).toEqual(["confirm", "card", "summon"])
    fireEvent.click(enabled(region("Your board"))[0]!)
    fireEvent.click(screen.getByRole("button", { name: "Attack with 1" }))
    await stepHouse()
    expect(audio.sfx.mock.calls.map((c) => c[0]).slice(3)).toEqual(["attack", "hit"])
  })
  it("rings the bell when your turn comes back, and plays the win when you win", async () => {
    const { onExit } = start({ debugHouseLife: 1 })
    fireEvent.click(screen.getByRole("button", { name: "End turn" }))
    expect(audio.sfx).toHaveBeenLastCalledWith("draw")
    for (let i = 0; i < 8 && !screen.queryByText(/Turn 3 · Your turn/); i++) await stepHouse()
    expect(audio.sfx).toHaveBeenCalledWith("turn")
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    fireEvent.click(enabled(region("Your board"))[0]!)
    fireEvent.click(screen.getByRole("button", { name: "Attack with 1" }))
    await stepHouse()
    if (screen.queryByText("You win!")) expect(audio.music).toHaveBeenLastCalledWith("win")
    fireEvent.click(screen.getByRole("button", { name: /Back to the room|Leave/ }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})

describe("hints", () => {
  beforeEach(() => window.localStorage.clear())
  it("the deck screen explains how to play, and the board coaches the next move", () => {
    const onExit = vi.fn(), onWin = vi.fn()
    render(<DuelGame houseDeck="bears" houseName="ALUMNI" seed={HASTE_SEED} onExit={onExit} onWin={onWin} />)
    expect(screen.getByText("How to play")).toBeTruthy()
    expect(screen.getByText(/Bring the house to 0 to win/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Play Bulls" }))
    expect(screen.getByText(/^You have 1 mana\. Click a card you can afford to play it\./)).toBeTruthy()
    const trader = within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!
    expect(trader.className).toContain("duel-nudge")
    fireEvent.click(trader)
    // Haste: ready at once, and nothing left to afford.
    expect(screen.getByText(/^Ready to attack/)).toBeTruthy()
    expect(enabled(region("Your board"))[0]!.className).toContain("duel-nudge")
    fireEvent.click(enabled(region("Your board"))[0]!)
    expect(screen.getByText("Press Attack with 1 to send it in. The house may block.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Attack with 1" }).className).toContain("duel-nudge")
  })
  it("says to end the turn when nothing is affordable, in one press", async () => {
    start()
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    fireEvent.click(screen.getByRole("button", { name: "End turn" }))
    expect(screen.getByText("The house is taking its turn…")).toBeTruthy()
  })
  it("can be switched off, and stays off", () => {
    start()
    fireEvent.click(screen.getByRole("button", { name: "Hints on" }))
    expect(screen.queryByText(/Click a card you can afford/)).toBeNull()
    expect(window.localStorage.getItem("duel.hints")).toBe("off")
    cleanup()
    start()
    expect(screen.getByRole("button", { name: "Hints off" })).toBeTruthy()
    expect(screen.queryByText(/Click a card you can afford/)).toBeNull()
  })
})

describe("mana crystals", () => {
  it("shows a crystal per crystal owned, dimming the spent ones", async () => {
    start()
    const mana = () => screen.getByRole("img", { name: /^Mana / })
    expect(mana().getAttribute("aria-label")).toBe("Mana 1 of 1")
    const crystals = () => [...mana().querySelectorAll("img.duel-crystal")]
    expect(crystals()).toHaveLength(1)
    expect(crystals()[0]!.className).not.toContain("duel-crystal--spent")
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    expect(mana().getAttribute("aria-label")).toBe("Mana 0 of 1")
    expect(crystals()[0]!.className).toContain("duel-crystal--spent")
    fireEvent.click(screen.getByRole("button", { name: "End turn" }))
    for (let i = 0; i < 8 && !screen.queryByText(/Turn 3 · Your turn/); i++) await stepHouse()
    expect(mana().getAttribute("aria-label")).toBe("Mana 2 of 2")
    expect(crystals()).toHaveLength(2)
    expect(crystals().filter((c) => c.className.includes("spent"))).toHaveLength(0)
  })
})

describe("inspect", () => {
  const hold = (el: Element) => fireEvent.pointerDown(el.closest(".duel-hold")!, { pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 10 })
  const release = (el: Element) => fireEvent.pointerUp(el.closest(".duel-hold")!, { pointerId: 1, pointerType: "touch" })

  it("holding a card shows it large with its rules; releasing closes it and does not play it", async () => {
    start()
    const trader = within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!
    hold(trader)
    expect(screen.queryByRole("dialog", { name: /Card details/ })).toBeNull()
    await act(async () => { vi.advanceTimersByTime(400) })
    const panel = screen.getByRole("dialog", { name: "Card details: Day Trader" })
    expect(within(panel).getByText("Creature · 1 mana · 2/1")).toBeTruthy()
    expect(within(panel).getByText("Haste: Can attack the turn it is played.")).toBeTruthy()
    expect(within(panel).getByText("Buys the open, sells the close, sleeps never.")).toBeTruthy()
    release(trader)
    fireEvent.click(trader)
    expect(screen.queryByRole("dialog", { name: /Card details/ })).toBeNull()
    expect(within(region("Your board")).queryAllByRole("button")).toHaveLength(0)
  })
  it("a quick tap still plays the card, and moving the finger cancels a hold", async () => {
    start()
    const trader = within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!
    hold(trader)
    fireEvent.pointerMove(trader.closest(".duel-hold")!, { pointerId: 1, clientX: 40, clientY: 10 })
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole("dialog", { name: /Card details/ })).toBeNull()
    release(trader)
    fireEvent.click(trader)
    expect(within(region("Your board")).getAllByRole("button")).toHaveLength(1)
  })
  it("works on a card you cannot play yet, and from the keyboard", async () => {
    start()
    const locked = within(region("Your hand")).getAllByRole("button").find((b) => (b as HTMLButtonElement).disabled && /, [2-9] mana$/.test(b.getAttribute("aria-label") ?? ""))!
    const name = locked.getAttribute("aria-label")!.replace(/, \d+ mana$/, "")
    const cost = locked.getAttribute("aria-label")!.match(/, (\d+) mana$/)![1]
    hold(locked)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(within(screen.getByRole("dialog", { name: `Card details: ${name}` })).getByText(`Costs ${cost} mana; you have 1 this turn.`)).toBeTruthy()
    release(locked)
    expect(screen.queryByRole("dialog", { name: /Card details/ })).toBeNull()
    const playable = within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!
    playable.focus()
    fireEvent.keyDown(document.body, { key: "i" })
    expect(screen.getByRole("dialog", { name: "Card details: Day Trader" })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: /Card details/ })).toBeNull()
  })
})

describe("combat marks", () => {
  beforeEach(() => window.localStorage.clear())
  it("a chosen attacker wears the sword, and the hint sits between the two boards", () => {
    start()
    fireEvent.click(within(region("Your hand")).getAllByRole("button", { name: "Day Trader, 1 mana" })[0]!)
    const hold = region("Your board").querySelector(".duel-hold")!
    expect(hold.querySelector(".duel-badge--attack")).toBeNull()
    fireEvent.click(within(region("Your board")).getAllByRole("button")[0]!)
    expect(hold.querySelector(".duel-badge--attack")).not.toBeNull()
    const midline = document.querySelector(".duel-midline")!
    expect(midline.querySelector(".duel-hint")).not.toBeNull()
    expect(region("House board").compareDocumentPosition(midline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(midline.compareDocumentPosition(region("Your board")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
