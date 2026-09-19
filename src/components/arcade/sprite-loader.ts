// Fetching a fighter's atlas image, once.
//
// The atlases are ordinary PNGs under public/assets/arcade; the game loads
// the two it needs when a fight starts (so the cabinet's first paint costs
// nothing) and keeps them for the session. A failed load resolves to null —
// the renderer then falls back to its procedural puppet rather than a blank
// fighter, so a flaky connection degrades the look, not the game.

import type { CharacterId } from "./characters"
import { FIGHTER_ATLASES } from "./fighter-atlases"
import { GAME_ROOM_STAGE, type BattleStage, type StageLayerName } from "./battle-stages"

export type SpriteImages = Partial<Record<CharacterId, HTMLImageElement>>

export type { StageLayerName } from "./battle-stages"
export type StageImages = Partial<Record<StageLayerName, HTMLImageElement>>
export const EFFECT_URLS = {
  ice: "/assets/arcade/effect-ice-v5.png",
  fire: "/assets/arcade/effect-fire-v5.png",
  orb: "/assets/arcade/effect-water-orb-v7.png",
  explosion: "/assets/arcade/effect-explosion-v1.webp",
} as const
export type EffectImages = Partial<Record<keyof typeof EFFECT_URLS, HTMLImageElement>>

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null)
      return
    }
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

const stageCache = new Map<string, Promise<HTMLImageElement | null>>()
let effectCache: Promise<EffectImages> | undefined

/** Shared raster VFX; the renderer can start while these decode. */
export function loadEffectImages(): Promise<EffectImages> {
  return effectCache ??= Promise.all(Object.entries(EFFECT_URLS).map(async ([key, url]) => [key, await loadImage(url)] as const))
    .then(entries => Object.fromEntries(entries.filter(([, image]) => image)) as EffectImages)
}

/** The stage's parallax layers; a missing key means that layer failed to load. */
export async function loadStageImages(stage: BattleStage = GAME_ROOM_STAGE): Promise<StageImages> {
  const names = Object.keys(stage.layers) as StageLayerName[]
  const loaded = await Promise.all(names.map((name) => {
    const url = stage.layers[name]!.url
    let cached = stageCache.get(url)
    if (!cached) {
      cached = loadImage(url)
      stageCache.set(url, cached)
    }
    return cached
  }))
  const images: StageImages = {}
  names.forEach((name, i) => {
    const image = loaded[i]
    if (image) images[name] = image
  })
  return images
}

const cache = new Map<CharacterId, Promise<HTMLImageElement | null>>()

export function loadFighterSprite(id: CharacterId): Promise<HTMLImageElement | null> {
  const cached = cache.get(id)
  if (cached) return cached
  const atlas = FIGHTER_ATLASES[id]
  const promise = atlas ? loadImage(atlas.url) : Promise.resolve(null)
  cache.set(id, promise)
  return promise
}

/** Both fighters' atlases, keyed by id; a missing key means that load failed. */
export async function loadFighterSprites(ids: readonly CharacterId[]): Promise<SpriteImages> {
  const images: SpriteImages = {}
  const loaded = await Promise.all(ids.map((id) => loadFighterSprite(id)))
  ids.forEach((id, i) => {
    const image = loaded[i]
    if (image) images[id] = image
  })
  return images
}
