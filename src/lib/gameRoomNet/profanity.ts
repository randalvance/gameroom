// Chat censoring for the game room. `censor` masks profanity and slurs with
// stars, preserving everything else byte for byte — the line still goes out,
// so a bleeped word never costs the sender their message.
//
// The hard part is not the word list, it is not bleeping innocent text. Two
// rules do that work:
//
//  - A match must sit on word boundaries, so Scunthorpe, classic, assess and
//    Dickinson survive while "this shit" does not.
//  - Letters may be spaced apart (`s h i t`) only if EVERY pair is separated.
//    Allowing separators anywhere would bleep "Jim's hit rate"; requiring all
//    or nothing catches the deliberate evasion without the false positive.
//
// This is a word list, so it is defeatable by anyone determined enough — novel
// spellings and homoglyphs walk straight through. It is aimed at the casual
// nastiness that actually shows up in a room full of participants.

/** Deliberately not exhaustive: strong profanity and slurs only. Mild words
 * (damn, hell, crap) are left alone. Base forms are enough — the matcher
 * handles casing, leetspeak, padded letters and the suffixes below. Compounds
 * that hide their swear mid-word need their own entry, because the boundary
 * rule (rightly) refuses to match inside a longer word. */
const WORDS = [
  "arse", "arsehole", "ass", "asshole", "bastard", "bitch", "bollocks",
  "bullshit", "cock", "cunt", "dick", "douchebag", "dumbass", "fuck",
  "jackass", "motherfucker", "piss", "prick", "pussy", "shit", "slut",
  "twat", "wanker", "whore",
  // Slurs.
  "chink", "coon", "faggot", "kike", "nigga", "nigger", "retard", "spic",
  "tranny",
]

/** Endings a match may absorb, so "fucking" and "bitches" need no entry of
 * their own. Kept short on purpose: a longer list starts swallowing the
 * innocent words the boundary rule protects (assess, Dickinson). */
const SUFFIXES = ["s", "es", "ed", "er", "ers", "ing", "in", "y"]

/** Characters typed in place of letters. */
const LEET: Record<string, string> = {
  "4": "a", "@": "a", "8": "b", "3": "e", "9": "g", "1": "i", "!": "i",
  "|": "i", "0": "o", "5": "s", $: "s", "7": "t", "+": "t", "2": "z",
}

interface Scan {
  /** Normalised letters, in order, with the separators removed. */
  letters: string[]
  /** Where each letter came from in the original text. */
  at: number[]
  /** Whether anything non-letter sat immediately before this letter. */
  gap: boolean[]
}

/** Reduces text to its letters, remembering where each one came from and
 * whether a separator preceded it. Accents are folded, leet is spelled out. */
function scan(text: string): Scan {
  const out: Scan = { letters: [], at: [], gap: [] }
  let pendingGap = false
  // NFD splits accented letters into base + combining mark; dropping the marks
  // leaves the plain letter, so "fück" scans the same as "fuck".
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]!
    const base = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    const ch = LEET[base] ?? base
    if (ch >= "a" && ch <= "z" && ch.length === 1) {
      out.letters.push(ch)
      out.at.push(i)
      out.gap.push(pendingGap)
      pendingGap = false
    } else {
      pendingGap = true
    }
  }
  return out
}

/**
 * Tries to consume `word` from `start`, one letter at a time. `spaced` picks
 * which shape is allowed: separators between every letter, or none at all.
 * With `padded`, a run of the same letter counts once ("shiiiit" is "shit") —
 * suffixes match strictly, or "assess" reads as "ass" + "es" with the last s
 * dismissed as padding. Returns the index just past the match, or -1.
 */
function consume(s: Scan, start: number, word: string, spaced: boolean, padded = true): number {
  let i = start
  for (let w = 0; w < word.length; w++) {
    if (i >= s.letters.length || s.letters[i] !== word[w]) return -1
    if (w > 0 && s.gap[i] !== spaced) return -1
    i++
    // Swallow the padding: "fuuuck" spells the same word as "fuck". Only when
    // the word does not double this letter itself, or the two g's of "faggot"
    // would eat each other.
    if (padded && word[w + 1] !== word[w]) {
      while (i < s.letters.length && s.letters[i] === word[w] && !s.gap[i]) i++
    }
  }
  return i
}

/** Where a match ending at `end` may stop, longest suffix first, once the
 * right-hand boundary is satisfied. Returns -1 if nothing lands cleanly. */
function extend(s: Scan, end: number): number {
  const ends = (i: number) => i >= s.letters.length || s.gap[i]
  if (ends(end)) return end
  for (const suffix of [...SUFFIXES].sort((a, b) => b.length - a.length)) {
    const after = consume(s, end, suffix, false, false)
    if (after !== -1 && !s.gap[end] && ends(after)) return after
  }
  return -1
}

/**
 * Replaces profanity and slurs with stars, one per original character —
 * spacing, casing and length of everything else are untouched. Clean text
 * comes back identical.
 */
export function censor(text: string): string {
  const s = scan(text)
  const masked = text.split("")
  let i = 0
  while (i < s.letters.length) {
    // A match must start a word: either the line does, or a separator ran in
    // front of it. This is what saves "classic" from its "ass".
    if (i === 0 || s.gap[i]) {
      let end = -1
      for (const word of WORDS) {
        for (const spaced of [false, true]) {
          const hit = consume(s, i, word, spaced)
          if (hit === -1) continue
          const stop = extend(s, hit)
          // Longest wins, so "asshole" is not bleeped as "ass" + "hole".
          if (stop > end) end = stop
        }
      }
      if (end !== -1) {
        for (let k = s.at[i]!; k <= s.at[end - 1]!; k++) masked[k] = "*"
        i = end
        continue
      }
    }
    i++
  }
  return masked.join("")
}
