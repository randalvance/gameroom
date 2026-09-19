// The duel is a separate chunk the room downloads only when a student sits
// down at a white desk. That holds only while nothing outside this folder
// imports the game's data: the decks, the art map, the sound, the game
// itself. The room may import the loading shell, the desk → deck lookup, and
// types. The harness is the one deliberate exception (it IS the game).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "../..")
const ALLOWED = new Set(["DuelPortal", "house-deck", "load-duel"])
const EXEMPT = new Set(["__duel-harness.tsx"])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== "node_modules") yield* walk(path) }
    else if (/\.(ts|tsx)$/.test(name)) yield path
  }
}

describe("the duel stays lazy", () => {
  it("nothing outside components/duel imports the game's data at module level", () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file)
      if (rel.startsWith("components/duel/") || EXEMPT.has(rel)) continue
      const src = readFileSync(file, "utf8")
      for (const m of src.matchAll(/^(import[^\n]*from\s+["'](?:~\/components\/duel|\.\.?\/(?:\.\.\/)*components\/duel)\/([\w.-]+)["'])/gm)) {
        const [, statement, module] = m
        if (/^import\s+type\b/.test(statement!) || ALLOWED.has(module!)) continue
        offenders.push(`${rel} → duel/${module}`)
      }
    }
    expect(offenders).toEqual([])
  })
  it("the loading shell itself only knows the game as a type and a dynamic import", () => {
    const shell = readFileSync(join(__dirname, "DuelPortal.tsx"), "utf8")
    expect(shell).not.toMatch(/^import\s+(?!type\b)[^\n]*from\s+["']\.\/(DuelGame|decks|card-art\.generated|duel-audio|duel-sim|duel-ai)["']/m)
    const loader = readFileSync(join(__dirname, "load-duel.ts"), "utf8")
    expect(loader).toMatch(/import\("\.\/DuelGame"\)/)
    expect(loader).not.toMatch(/^import\s/m)
  })
  it("the desk → deck lookup carries no card data", () => {
    const src = readFileSync(join(__dirname, "house-deck.ts"), "utf8")
    expect(src).not.toMatch(/^import\s+(?!type\b)/m)
  })
})
