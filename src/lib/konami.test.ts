import { describe, expect, it, vi } from "vitest"
import { createKonamiDetector, konamiTokenForKey, KONAMI_KEYBOARD, KONAMI_TOUCH, type KonamiToken } from "./konami"

function feed(detector: ReturnType<typeof createKonamiDetector>, tokens: readonly KonamiToken[]) {
  for (const token of tokens) detector.push(token)
}

describe("konami detector", () => {
  it.each([
    [..."wwssadadba"],
    [..."WWSSADADBA"],
    ["w", "ArrowUp", "s", "ArrowDown", "a", "ArrowRight", "ArrowLeft", "d", "b", "a"],
  ])("accepts WASD and mixed arrow directions: %j", (...keys: string[]) => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    for (const key of keys.slice(0, -1)) {
      const token = konamiTokenForKey(key)
      if (token) detector.push(token)
    }
    expect(onTrigger).not.toHaveBeenCalled()
    detector.push(konamiTokenForKey(keys.at(-1)!)!)
    expect(onTrigger).toHaveBeenCalledOnce()
  })

  it("does not substitute the left arrow for the final A letter", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, [...KONAMI_KEYBOARD.slice(0, -1), "left"])
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it("fires on the keyboard spelling: arrows, B, A", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, KONAMI_KEYBOARD)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it("fires on the touch spelling: the D-pad, then TALK", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, KONAMI_TOUCH)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it("does not fire on a near miss, and recovers once the code is re-entered", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, ["up", "up", "down", "down", "left", "right", "left", "right", "a", "b"])
    expect(onTrigger).not.toHaveBeenCalled()
    feed(detector, KONAMI_KEYBOARD)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it("matches the tail of a noisy stream — earlier stray presses do not matter", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, ["left", "a", "talk", "up", ...KONAMI_KEYBOARD])
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it("resets after firing so the code must be entered in full again", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, KONAMI_KEYBOARD)
    detector.push("a")
    detector.push("talk")
    expect(onTrigger).toHaveBeenCalledTimes(1)
    feed(detector, KONAMI_TOUCH)
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it("reset() clears a partial entry", () => {
    const onTrigger = vi.fn()
    const detector = createKonamiDetector(onTrigger)
    feed(detector, KONAMI_KEYBOARD.slice(0, 9))
    detector.reset()
    detector.push("a")
    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe("konamiTokenForKey", () => {
  it("maps the arrow keys and the two letters, either case", () => {
    expect(konamiTokenForKey("ArrowUp")).toBe("up")
    expect(konamiTokenForKey("ArrowDown")).toBe("down")
    expect(konamiTokenForKey("ArrowLeft")).toBe("left")
    expect(konamiTokenForKey("ArrowRight")).toBe("right")
    expect(konamiTokenForKey("b")).toBe("b")
    expect(konamiTokenForKey("B")).toBe("b")
    expect(konamiTokenForKey("a")).toBe("a")
    expect(konamiTokenForKey("A")).toBe("a")
  })

  it("ignores unrelated keys", () => {
    for (const key of [" ", "Enter", "Escape"]) expect(konamiTokenForKey(key)).toBeNull()
  })
})
