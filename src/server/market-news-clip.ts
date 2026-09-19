// Filmed market-news broadcasts for the wall screen.
//
// The event ran pre-rendered newsroom clips from an asset store, matched to a
// bulletin's text. None of that ships with the library — the films are event
// content, not room code — so these resolve to "no clip", which is exactly the
// path an ad-hoc typed announcement already takes: the wall shows the text
// banner instead. A host with its own clips serves these two routes.

import { apiGet, apiPost } from "./client"

export interface MarketNewsClipRef {
  id: string
  webm: string
  durationMs: number
}

/** The clip for one bulletin, or null for the text banner. */
export function getMarketNewsBroadcastFn(input: {
  data: { message: string }
}): Promise<MarketNewsClipRef | null> {
  return apiPost<MarketNewsClipRef | null>("/api/market-news/broadcast", input.data, null)
}

/** Every clip, so a client can warm them before the room needs one. */
export function listMarketNewsClipsFn(): Promise<MarketNewsClipRef[]> {
  return apiGet<MarketNewsClipRef[]>("/api/market-news/clips", [])
}
