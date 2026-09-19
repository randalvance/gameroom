import { useCallback, useEffect, useRef, useState } from "react"
import type { BulletinEvent } from "~/lib/gameRoomNet/protocol"
import { getMarketNewsBroadcastFn } from "~/server/market-news-clip"
import { apiUrl } from "~/server/client"

/** The filmed broadcast for a scripted market event, once the server names it. */
export interface MarketNewsClip {
  id: string
  webm: string
  durationMs: number
}

export interface MarketNews {
  message: string
  affectedSymbol: string
  /**
   * The video to play on the wall, or null for the text banner.
   *
   * Null on arrival and for the whole of a lookup that finds nothing — an
   * ad-hoc bulletin the game master types during the day keeps the banner it
   * has always had. Every scripted event has a film, so a null here is an
   * ad-hoc notice rather than an event without one.
   */
  clip: MarketNewsClip | null
  /**
   * A scripted market event the wall has no film for. The banner stays up on
   * its usual hold, but headed MARKET EVENT ONGOING rather than as a generic
   * announcement — the room is told this is the market moving, not a notice.
   */
  placeholder: boolean
}

/** The banner's header line: what kind of bulletin the wall is showing. */
export function marketNewsHeader(news: MarketNews): string {
  return news.placeholder ? "◆ MARKET EVENT ONGOING ◆" : "◆ ANNOUNCEMENT ◆"
}

/** How long a text-only bulletin holds the wall. */
const MARKET_NEWS_DURATION_MS = 12_000
/**
 * The beat after a broadcast's last frame before the wall goes back to the
 * clock. The scene reverts on the video's own `ended` event; this is the
 * backstop for a clip that stalls or never fires one, so it is a little longer
 * than the clip rather than exactly its length.
 */
const MARKET_NEWS_CLIP_TAIL_MS = 1_500

/**
 * The beat between a bulletin landing and its voice starting.
 *
 * The room's cameras are still swinging to face the wall when the banner goes
 * up, and a voice that began on that same frame talked over the move — the
 * announcement was half-read before anyone was looking at it. This lets the
 * turn finish and the message settle on the wall first.
 *
 * Shared with the wall's hold rather than living beside the audio: the banner
 * has to stay up for the lead-in AND the read, or it would clear out from
 * under the voice.
 */
export const ANNOUNCEMENT_SPEECH_LEAD_MS = 5_000
const MARKET_NEWS_MESSAGE_MAX = 500

/**
 * How long to wait before rebuilding a feed the browser has given up on.
 *
 * EventSource reconnects by itself while it can, but a reconnect that lands on
 * a non-2xx puts it in CLOSED, which is terminal — and the proxy answers 502
 * whenever the exchange blips. The room then goes deaf for the rest of the
 * session: the first market event plays, and nothing after it ever arrives
 * until someone reloads the page.
 *
 * Long enough not to hammer a feed that is genuinely down, short enough that a
 * room left running through a blip is listening again well before the next
 * scripted event.
 */
const MARKET_NEWS_REVIVE_MS = 5_000

/**
 * What is on the room's wall right now.
 *
 * Two sources feed one state machine. The exchange's SSE feed carries the real
 * scripted market events; `pushed` carries a bulletin the gamemaster aimed at
 * the room alone from the console's GAME ROOM tab — a replayed broadcast, or
 * an ad-hoc notice. They land identically here on purpose: the banner, the
 * clip lookup and the hold are the room's behaviour, not the sender's.
 *
 * `listensToExchange` false keeps the exchange feed shut: a student waiting
 * for the doors is refused /api/prices/stream, and a feed that is refused
 * would only retry every few seconds. Bulletins still land.
 */
export function useMarketNews(
  onNews: () => void,
  pushed?: BulletinEvent | null,
  playsClips = false,
  listensToExchange = true,
): MarketNews | null {
  const [news, setNews] = useState<MarketNews | null>(null)
  const onNewsRef = useRef(onNews)
  onNewsRef.current = onNews
  // Whether THIS client is the one that plays filmed clips (the admin screen
  // driving the projector, or a viewer's). It decides when the chime may sound — see raise().
  const playsClipsRef = useRef(playsClips)
  playsClipsRef.current = playsClips
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Which bulletin is on the wall. A clip lookup is a round trip, and a second
  // event can land while the first is still in flight — the answer to a
  // superseded bulletin must not be hung on the one that replaced it.
  const bulletinSeqRef = useRef(0)

  const raise = useCallback((
    rawMessage: string,
    rawSymbol: string,
    speechMs?: number,
    holdMs?: number,
  ) => {
    const message = rawMessage.trim()
    if (!message) return

    const hold = (ms: number) => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = setTimeout(() => setNews(null), ms)
    }

    const seq = ++bulletinSeqRef.current
    setNews({
      // The exchange's scripted messages are under 200 chars. Bounding an
      // ad-hoc admin bulletin keeps the canvas from measuring unbounded
      // text it can only display across three lines anyway.
      message: message.slice(0, MARKET_NEWS_MESSAGE_MAX),
      affectedSymbol: rawSymbol.trim().toUpperCase(),
      // The banner goes up on this frame. Whether there is a video to cut
      // to is a question for the server, and the wall must not sit blank
      // while it is answered.
      clip: null,
      placeholder: false,
    })
    // The chime, and when it may sound.
    //
    // On a screen that plays filmed clips it must NOT land on top of one: the
    // video opens on its own titles and its anchor speaks, so the clip is the
    // notification. Whether a clip is coming is a round trip away, so that
    // screen waits for the answer and chimes only if none turns up. Everyone
    // else can never overlap a video, so their chime is immediate — making
    // them wait on a lookup whose answer changes nothing would only delay it.
    if (!playsClipsRef.current) onNewsRef.current()

    // The gamemaster's chosen duration, or the room's own default. Either way
    // a FLOOR: a spoken read longer than it still finishes rather than being
    // cut off mid-sentence.
    const floorMs = holdMs && holdMs > 0 ? holdMs : MARKET_NEWS_DURATION_MS
    hold(
      speechMs
        ? Math.max(floorMs, ANNOUNCEMENT_SPEECH_LEAD_MS + speechMs + MARKET_NEWS_CLIP_TAIL_MS)
        : floorMs,
    )

    // The FULL message, not the bounded one: the server matches on the
    // text the exchange published, and a truncated copy would not match.
    getMarketNewsBroadcastFn({ data: { message } })
      .then((broadcast) => {
        if (seq !== bulletinSeqRef.current) return
        // The deferred chime: no clip is coming, so nothing can be talked over.
        // A placeholder has no video and no anchor either, so it chimes too.
        if (!broadcast || "placeholder" in broadcast) {
          if (playsClipsRef.current) onNewsRef.current()
          if (broadcast) {
            setNews((current) => (current ? { ...current, placeholder: true } : current))
          }
          return
        }
        setNews((current) => (current ? { ...current, clip: broadcast } : current))
        hold(broadcast.durationMs + MARKET_NEWS_CLIP_TAIL_MS)
      })
      .catch(() => {
        // No clip, no video: the bulletin keeps its text banner and its hold.
        // A failed lookup must not blank the wall — and on a clip-playing
        // screen the chime it was waiting on is dropped rather than fired
        // late over a video that may yet start.
      })
  }, [])

  useEffect(() => {
    if (!listensToExchange) return
    let source: EventSource | null = null
    let reviveTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const listen = () => {
      const feed = new EventSource(apiUrl("/api/prices/stream"))
      source = feed
      // Only a CLOSED feed needs rebuilding. A transient error leaves it in
      // CONNECTING, where the browser is already retrying and a second feed
      // would just double the load.
      feed.onerror = () => {
        if (stopped || feed.readyState !== 2 /* CLOSED */) return
        if (reviveTimer) clearTimeout(reviveTimer)
        reviveTimer = setTimeout(() => { if (!stopped) listen() }, MARKET_NEWS_REVIVE_MS)
      }
      feed.addEventListener("announcement", onAnnouncement)
    }

    const onAnnouncement = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          message?: unknown
          affected_symbol?: unknown
        }
        if (typeof payload.message !== "string") return
        raise(
          payload.message,
          typeof payload.affected_symbol === "string" ? payload.affected_symbol : "",
        )
      } catch {
        // Ignore malformed exchange frames; the next valid event still lands.
      }
    }

    listen()

    return () => {
      stopped = true
      source?.close()
      if (reviveTimer) clearTimeout(reviveTimer)
    }
  }, [raise, listensToExchange])

  // A bulletin from the gamemaster. Keyed on the nonce rather than the text:
  // replaying one market event twice — a rehearsal, then the real thing — is
  // two bulletins, and the second must raise the banner again.
  const pushedRef = useRef(pushed)
  pushedRef.current = pushed
  const pushedNonce = pushed?.nonce ?? null
  useEffect(() => {
    const bulletin = pushedRef.current
    if (!bulletin) return
    raise(bulletin.message, bulletin.affectedSymbol, bulletin.speechMs, bulletin.holdMs)
  }, [pushedNonce, raise])

  // The hold outlives both sources, so it is released here rather than in
  // either one's cleanup.
  useEffect(() => () => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
  }, [])

  return news
}
