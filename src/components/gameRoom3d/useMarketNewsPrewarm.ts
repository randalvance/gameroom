// Pulling the market-event broadcasts into the browser cache before they are
// needed.
//
// A clip is 6-12 MB and nothing asks for it until the game master hits
// BROADCAST — which is the one moment it must not be waited for. The room has
// hours before the first event, so it spends a little of that quietly warming
// the files instead.
//
// This only ever does anything on the screen driving the venue projector —
// the viewer account on the big screen, or the admin laptop. Two independent reasons, and both are wanted:
//
//   - `enabled` is off for anyone but an admin or viewer, so their room never makes the
//     request in the first place — no student ever spends a byte, or a slot on
//     the venue wifi, warming a video they will not be shown.
//   - listMarketNewsClipsFn is admin/viewer-gated server-side regardless, so a client
//     that asked anyway would be told nothing.
//
// The first is the behaviour; the second is the guarantee.

import { useEffect } from "react"
import { listMarketNewsClipsFn } from "~/server/market-news-clip"

/**
 * How long to leave the room alone before warming anything.
 *
 * The room is a 3D scene with its own textures, sprites and audio to fetch on
 * entry, and a 70 MB warm-up competing with that would make the thing the
 * player is actually looking at slower to appear. The first event is not for
 * hours; this can wait a few seconds.
 */
export const MARKET_NEWS_PREWARM_DELAY_MS = 8_000

/** Pull one clip through the HTTP cache without holding it in memory. */
async function warm(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal })
  // Draining the stream is what makes the browser store the response; the
  // chunks themselves are dropped as they arrive, so a 9 MB clip never becomes
  // a 9 MB ArrayBuffer.
  const reader = response.body?.getReader()
  if (!reader) return
  for (;;) {
    const { done } = await reader.read()
    if (done) return
  }
}

/**
 * @param enabled whether this room will ever play a clip — the big screen
 * or admin screen driving the projector. False everywhere else, and then this does nothing at
 * all: no request, no download.
 */
export function useMarketNewsPrewarm(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()

    const timer = setTimeout(async () => {
      let clips
      try {
        clips = await listMarketNewsClipsFn()
      } catch {
        // No list, no warm. The clips still play, just from cold.
        return
      }
      // One at a time: several concurrent multi-megabyte pulls would fight each
      // other and the room's own traffic, and the first clip is the one needed
      // soonest.
      for (const clip of clips) {
        if (controller.signal.aborted) return
        try {
          await warm(clip.webm, controller.signal)
        } catch {
          // Best-effort per clip: a failed warm costs a slower start on the
          // day, not a missing broadcast, and must not stop the others.
        }
      }
    }, MARKET_NEWS_PREWARM_DELAY_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled])
}
