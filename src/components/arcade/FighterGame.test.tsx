import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FighterGame from "./FighterGame"
import { CHARACTERS } from "./characters"

// No sound chip in jsdom: the game must run silently.
vi.mock("./arcade-sfx", () => ({
  createArcadeAudio: () => ({
    unlock() {}, select() {}, confirm() {}, fight() {}, hit() {}, block() {}, whiff() {},
    special() {}, jump() {}, ko() {}, roundWin() {}, setVolume() {}, close() {},
  }),
}))

beforeEach(() => {
  window.localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never
})

describe("cabinet menus", () => {
  it("unlocks Bernard with WASD directions and the B A ending on the title screen", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    for (const key of "wwssadadb") fireEvent.keyDown(window, { key, code: `Key${key.toUpperCase()}` })
    expect(screen.queryByText("BERNARD UNLOCKED")).toBeNull()
    fireEvent.keyDown(window, { key: "a", code: "KeyA" })
    expect(screen.getByText("BERNARD UNLOCKED")).toBeTruthy()
  })

  it("opens in attract mode with the roster and a way out", () => {
    const onExit = vi.fn()
    render(<FighterGame onExit={onExit} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    expect(screen.getByRole("heading", { name: /Impact Hackers/i })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Walk away" }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it("1P VS CPU goes to character select, where the stick moves the cursor and a button locks in", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
    expect(screen.getByLabelText("Choose your fighter")).toBeTruthy()
    expect(screen.getByRole("button", { name: `LOCK IN ${CHARACTERS[0]!.name}` })).toBeTruthy()
    fireEvent.keyDown(window, { code: "KeyD" })
    expect(screen.getByRole("button", { name: `LOCK IN ${CHARACTERS[1]!.name}` })).toBeTruthy()
    fireEvent.keyDown(window, { code: "KeyA" })
    fireEvent.keyDown(window, { code: "KeyA" })
    expect(screen.getByRole("button", { name: `LOCK IN ${CHARACTERS[CHARACTERS.length - 1]!.name}` })).toBeTruthy()
    fireEvent.keyDown(window, { code: "KeyU" })
    expect(screen.getByRole("button", { name: "READY…" })).toBeTruthy()
  })

  it("keeps Bernard visible as a locked final-boss silhouette until the Konami code unlocks him", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
    const cards = screen.getAllByRole("listitem")
    expect(cards).toHaveLength(6)
    const mysteryCard = screen.getByRole("listitem", { name: "??? — locked fighter" })
    expect(cards.indexOf(mysteryCard)).toBeGreaterThanOrEqual(3)
    expect(mysteryCard.querySelector(".ar-card-title")?.textContent).toBe("???")
    expect(screen.queryByText("FINAL BOSS")).toBeNull()
    expect(mysteryCard.textContent).not.toMatch(/laser rain|up \+ special|energy|unlock/i)
    expect(screen.queryByText("BERNARD MOVE LIST")).toBeNull()
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { code: "KeyD", key: "d" })
    expect((screen.getByRole("button", { name: "BOSS LOCKED — CHALLENGE HIM" }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
      fireEvent.keyDown(window, { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, key })
    }
    expect(screen.getByText("BERNARD UNLOCKED")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { code: "KeyD", key: "d" })
    expect((screen.getByRole("button", { name: "LOCK IN BERNARD" }) as HTMLButtonElement).disabled).toBe(false)
    const bernardCard = screen.getByRole("listitem", { name: "BERNARD" })
    expect(bernardCard.textContent).toContain("UP + SPECIAL")
    expect(bernardCard.textContent).toContain("HP 100")
    expect(bernardCard.textContent).toContain("5 ENERGY BARS")
    expect(bernardCard.textContent).toContain(`${CHARACTERS.find((fighter) => fighter.id === "bernard")!.moves.specialUp!.energyCost} energy`)
    expect(screen.getByText("BERNARD MOVE LIST")).toBeTruthy()
    expect(screen.getByText(/BREAKING NEWS · 300 energy/)).toBeTruthy()
    expect(screen.getByText("DOWN, THEN UP + SPECIAL")).toBeTruthy()
  })

  it("explains how energy is earned and shows each fighter's special cost", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    expect(screen.getByText(/Energy starts full each round.*Hit or get hit to refill energy/i)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /1P VS CPU/ }))
    expect(screen.getByText(/Energy starts full each round/i)).toBeTruthy()
    for (const fighter of CHARACTERS.filter((entry) => entry.id !== "bernard")) {
      const card = screen.getByRole("listitem", { name: fighter.name })
      expect(card.textContent).toContain(`${fighter.moves.special.energyCost} energy`)
    }
  })

  it("moves vertically between the two rows for both players", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    fireEvent.click(screen.getByRole("button", { name: /2P VERSUS/ }))
    const cards = screen.getAllByRole("listitem")
    fireEvent.keyDown(window, { code: "KeyS" })
    expect(cards[3]!.classList.contains("ar-card-p1")).toBe(true)
    fireEvent.keyDown(window, { code: "KeyW" })
    expect(cards[0]!.classList.contains("ar-card-p1")).toBe(true)
    fireEvent.keyDown(window, { code: "ArrowDown" })
    expect(cards[4]!.classList.contains("ar-card-p2")).toBe(true)
    fireEvent.keyDown(window, { code: "ArrowUp" })
    expect(cards[1]!.classList.contains("ar-card-p2")).toBe(true)
  })

  it("swallows its keys so the room underneath never hears them", () => {
    render(<FighterGame onExit={() => {}} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    const heard = vi.fn()
    window.addEventListener("keydown", heard)
    fireEvent.keyDown(window, { code: "ArrowUp" })
    fireEvent.keyDown(window, { code: "KeyA" })
    fireEvent.keyDown(window, { code: "F5" })
    window.removeEventListener("keydown", heard)
    // The bubbling listener sees only the key the cabinet does not own.
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("Escape on the title screen walks away", () => {
    const onExit = vi.fn()
    render(<FighterGame onExit={onExit} volume={0.5} />)
  const welcomeOk = screen.queryByRole("button", { name: "OK" }); if (welcomeOk) fireEvent.click(welcomeOk)
    fireEvent.keyDown(window, { code: "Escape" })
    expect(onExit).toHaveBeenCalledOnce()
  })
})


it("shows the first-open instructions in an OK pop-up and remembers acknowledgement", () => {
  const first = render(<FighterGame onExit={() => {}} volume={0} />)
  const message = screen.getByRole("alertdialog", {name:"Welcome to Impact Hackers"})
  expect(message.textContent).toContain("Fight and win against two opponents to face the secret boss.")
  expect(message.textContent).toContain("This game is best played with sound or headphones.")
  expect(screen.queryByRole("button", {name:/1P VS CPU/})).toBeNull()
  fireEvent.click(screen.getByRole("button", {name:"OK"}))
  expect(screen.queryByRole("alertdialog")).toBeNull()
  expect(screen.getByRole("button", {name:/1P VS CPU/})).toBeTruthy()
  first.unmount()
  render(<FighterGame onExit={() => {}} volume={0} />)
  expect(screen.queryByRole("alertdialog")).toBeNull()
})
