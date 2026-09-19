// The four decks, as approved in the design spec. Numbers here are the ONLY
// thing a balance pass touches. Each card carries the prompt its art was
// generated from, so a re-roll starts from the same brief.
import type { Card, DeckDef, DeckId, Keyword, SpellEffect } from "./cards"
import { shuffle, type Rng } from "./rng"
import { DECK_IDS } from "./house-deck"

/** Copies per unique card, in the deck's cost order: the cheap four get three. */
export const COPIES = [3, 3, 3, 3, 2, 2, 2, 2] as const

const STYLE = "painterly fantasy trading-card illustration, dramatic warm rim light, rich detail, no text, no border, no logo"
const PALETTE: Record<DeckId, string> = {
  bulls: "crimson and ember orange palette, sparks and heat haze",
  bears: "deep violet and ash grey palette, cold fog",
  quants: "teal and gold palette, glowing circuitry and geometric sigils",
  whales: "deep sea blue and kelp green palette, shafts of underwater light",
}
export const artPrompt = (deck: DeckId, subject: string) => `${subject}, ${PALETTE[deck]}, ${STYLE}`

const c = (deck: DeckId, slug: string, name: string, cost: number, power: number, toughness: number, flavor: string, art: string, keyword?: Keyword): Card =>
  ({ kind: "creature", id: `${deck}/${slug}`, deck, name, cost, power, toughness, keyword, flavor, art: artPrompt(deck, art) })
const s = (deck: DeckId, slug: string, name: string, cost: number, effect: SpellEffect, flavor: string, art: string): Card =>
  ({ kind: "spell", id: `${deck}/${slug}`, deck, name, cost, effect, flavor, art: artPrompt(deck, art) })

const bulls: DeckDef = {
  id: "bulls", name: "Bulls", color: "red", pitch: "Fast creatures and burn. Win before the gas runs out.",
  cards: [
    c("bulls", "day-trader", "Day Trader", 1, 2, 1, "Buys the open, sells the close, sleeps never.", "a wiry bull-headed trader in a red waistcoat lunging forward with three glowing phones", "haste"),
    s("bulls", "leveraged-long", "Leveraged Long", 1, { kind: "pump", power: 3, toughness: 0 }, "Ten times the position, ten times the stomach ache.", "a towering pillar of red candlestick charts rising into the sky, a small figure riding the top"),
    c("bulls", "momentum-chaser", "Momentum Chaser", 2, 3, 1, "Late to the party. Loudest one there.", "a bull charging through a stock exchange floor scattering paper, motion blur", "haste"),
    s("bulls", "short-squeeze", "Short Squeeze", 2, { kind: "damage", amount: 3, target: "any" }, "The shorts covered. The shorts screamed.", "a giant red fist crushing a cluster of tiny bear figures, sparks flying"),
    c("bulls", "meme-stock", "Meme Stock", 3, 4, 2, "Fundamentals are a social construct.", "a rocket-shaped creature made of confetti and neon, grinning, launching from a smartphone"),
    c("bulls", "pump-rally", "Pump Rally", 3, 3, 3, "Everybody in. Nobody ask why.", "a crowd of red-armoured bull warriors raising banners on a rising staircase of charts", "haste"),
    s("bulls", "flash-crash", "Flash Crash", 3, { kind: "damage", amount: 4, target: "player" }, "Three seconds. Everything gone.", "a lightning bolt striking a stock ticker board, glass shattering outward"),
    c("bulls", "raging-bull", "Raging Bull", 4, 5, 3, "Do not stand in front of it.", "a colossal armoured bull wreathed in flame, horns lowered, trampling a marble floor", "trample"),
  ],
}

const bears: DeckDef = {
  id: "bears", name: "Bears", color: "black", pitch: "Removal and drain, then one crash to end it.",
  cards: [
    c("bears", "short-seller", "Short Seller", 1, 1, 2, "Profits from your misery. Politely.", "a hooded bear in a grey suit counting coins that drip from a wilting chart", "lifelink"),
    c("bears", "bearish-analyst", "Bearish Analyst", 2, 2, 2, "Has never once been wrong. Or right.", "a bespectacled bear at a lectern pointing at a downward graph, violet fog", "lifelink"),
    s("bears", "bankruptcy", "Bankruptcy", 2, { kind: "drain", amount: 3 }, "Chapter eleven, verse one.", "a marble bank facade crumbling into ash while violet coins flow into a shadowed hand"),
    c("bears", "vulture-fund", "Vulture Fund", 3, 3, 3, "Circles. Waits. Buys the bones.", "a vulture-headed banker perched on a pile of broken safes, violet sky", "lifelink"),
    s("bears", "liquidation", "Liquidation", 3, { kind: "destroy" }, "Everything must go.", "a great violet guillotine falling over a stack of glowing contracts"),
    s("bears", "bear-raid", "Bear Raid", 4, { kind: "damage", amount: 5, target: "creature" }, "Coordinated. Brutal. Over lunch.", "a pack of shadowy bears surging down a dark trading floor, papers frozen mid-air"),
    c("bears", "grizzly", "Grizzly", 5, 5, 5, "Not bearish. Bear.", "a massive grizzly bear in a torn suit roaring on a stock exchange balcony"),
    c("bears", "market-crash", "Market Crash", 6, 7, 6, "It was always going to end this way.", "an avalanche of black stone tumbling down a mountain of graphs onto a city of lights", "trample"),
  ],
}

const quants: DeckDef = {
  id: "quants", name: "Quants", color: "blue", pitch: "Flyers, card draw and a bounce spell. Out-think them.",
  cards: [
    c("quants", "intern-analyst", "Intern Analyst", 1, 1, 1, "Runs the model. Does not understand the model.", "a nervous young analyst hovering on tiny teal glowing wings above a laptop", "flying"),
    s("quants", "backtest", "Backtest", 1, { kind: "draw", amount: 2 }, "Worked perfectly on last year's data.", "an open grimoire projecting teal holographic charts and equations into the air"),
    c("quants", "algo-bot", "Algo Bot", 2, 2, 2, "Trades in microseconds. Judges in nanoseconds.", "a sleek teal-and-gold drone robot with a single glowing eye hovering in a server hall", "flying"),
    s("quants", "arbitrage", "Arbitrage", 2, { kind: "bounce" }, "Buy here, sell there, vanish.", "two mirrored teal portals with a golden coin passing between them"),
    s("quants", "alpha-signal", "Alpha Signal", 2, { kind: "pump", power: 2, toughness: 2, draw: 1 }, "The one number that matters, until it doesn't.", "a golden waveform pulse cutting through a dark teal sea of data"),
    c("quants", "hft-cluster", "HFT Cluster", 3, 3, 2, "Faster than the speed of regret.", "a swarm of small teal glass drones in tight formation streaking light trails", "flying"),
    c("quants", "black-box", "Black Box", 4, 4, 4, "Nobody knows what is inside. It keeps winning.", "a monolithic obsidian cube etched with glowing gold circuitry, floating over a floor of equations"),
    c("quants", "quant-fund", "Quant Fund", 5, 4, 5, "A hundred PhDs and one very large server.", "a cathedral-sized teal-and-gold machine with spinning rings hovering over a city", "flying"),
  ],
}

const whales: DeckDef = {
  id: "whales", name: "Whales", color: "green", pitch: "Ramp your mana, heal, then drop something enormous.",
  cards: [
    c("whales", "sardine-school", "Sardine School", 1, 1, 1, "Individually irrelevant. Collectively, a market.", "a shimmering school of silver sardines forming an arrow in deep blue water"),
    s("whales", "compound-interest", "Compound Interest", 2, { kind: "ramp" }, "Slowly, then all at once.", "a glowing green coral tree growing golden coins as fruit, sunlight shafts through water"),
    s("whales", "dividend", "Dividend", 2, { kind: "heal", amount: 5 }, "Thank you for holding.", "a gentle rain of gold coins falling into calm turquoise water, kelp swaying"),
    c("whales", "blue-chip", "Blue Chip", 3, 3, 4, "Boring. Reliable. Enormous.", "a stately sea turtle with a blue crystal shell drifting past sunken columns"),
    s("whales", "buyback", "Buyback", 3, { kind: "pump", power: 3, toughness: 3 }, "The company believes in itself. Loudly.", "a surge of green energy swelling a shadowy sea creature to twice its size"),
    c("whales", "index-fund", "Index Fund", 4, 4, 4, "Owns a bit of everything. Feels nothing.", "a broad manta ray patterned with a hundred tiny company crests gliding over a reef", "trample"),
    c("whales", "humpback", "Humpback", 5, 6, 5, "Moves the market when it breathes.", "a colossal humpback whale breaching through a wall of green light, water cascading", "trample"),
    c("whales", "sovereign-fund", "Sovereign Fund", 6, 7, 7, "A country's savings, with a tail.", "a leviathan blue whale crowned in gold, kelp banners trailing, a sunken city beneath", "trample"),
  ],
}

export const DECK_BY_ID: Record<DeckId, DeckDef> = { bulls, bears, quants, whales }
export const DECKS: readonly DeckDef[] = DECK_IDS.map((id) => DECK_BY_ID[id])

/** Twenty shuffled cards. */
export function buildDeck(id: DeckId, rng: Rng): Card[] {
  const cards = DECK_BY_ID[id].cards.flatMap((card, i) => Array.from({ length: COPIES[i]! }, () => card))
  return shuffle(cards, rng)
}

// The desk → house deck lookup lives in house-deck.ts so the room can import
// it without this file; re-exported here for the game side and the tests.
export { DECK_IDS, exhibitionOrdinal, houseDeckForDesk } from "./house-deck"
