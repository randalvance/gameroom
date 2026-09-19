// The Konami code, as the game room hears it.
//
// Two spellings of one secret: on a keyboard it is arrows or WASD — up up
// down down left right left right — then B then A; on the touch pad the same
// eight D-pad presses end on the A/TALK button instead, because a phone has no
// B key. Both are matched against one stream of tokens, so a device is free to
// mix them (arrows on a tablet with a keyboard, say) and either ending fires.
//
// Pure: no DOM, no timers. The route feeds it keys and pad presses and reacts
// to `onTrigger`; the sequence match is what this file is for, and what its
// test pins.

export type KonamiToken = "up" | "down" | "left" | "right" | "b" | "a" | "talk"

const PREFIX: readonly KonamiToken[] = ["up", "up", "down", "down", "left", "right", "left", "right"]
export const KONAMI_KEYBOARD: readonly KonamiToken[] = [...PREFIX, "b", "a"]
export const KONAMI_TOUCH: readonly KonamiToken[] = [...PREFIX, "talk"]

const SEQUENCES = [KONAMI_KEYBOARD, KONAMI_TOUCH] as const

/**
 * The token a keydown contributes, or null for a key that is not part of the
 * code. WASD aliases the arrows; A stays a distinct token so the detector can
 * accept it as left during the prefix and as the required letter at the end.
 */
export function konamiTokenForKey(key: string): KonamiToken | null {
  switch (key) {
    case "ArrowUp": case "w": case "W": return "up"
    case "ArrowDown": case "s": case "S": return "down"
    case "ArrowLeft": return "left"
    case "ArrowRight": case "d": case "D": return "right"
    case "b": case "B": return "b"
    case "a": case "A": return "a"
    default: return null
  }
}

/**
 * Feed tokens in; `onTrigger` fires the moment the tail of the stream spells
 * either sequence, and the stream resets so the next entry starts clean. A
 * wrong key does not have to be undone — the match is always against the most
 * recent tokens, so the player simply starts the code again.
 */
export function createKonamiDetector(onTrigger: () => void) {
  const longest = Math.max(...SEQUENCES.map((sequence) => sequence.length))
  let recent: KonamiToken[] = []
  return {
    push(token: KonamiToken) {
      recent.push(token)
      if (recent.length > longest) recent = recent.slice(recent.length - longest)
      const matched = SEQUENCES.some((sequence) =>
        recent.length >= sequence.length &&
        sequence.every((expected, i) => {
          const actual = recent[recent.length - sequence.length + i]
          return actual === expected || (expected === "left" && actual === "a")
        }))
      if (!matched) return
      recent = []
      onTrigger()
    },
    reset() {
      recent = []
    },
  }
}
