// Speaking a typed room announcement aloud — the voice over the venue PA.
//
// Only the admin and viewer screens do this — the big screen and the laptop
// driving the projector and the PA, the same screens that play the filmed
// broadcasts. Every one of them that is open speaks. A room where every laptop spoke would be unlistenable, and students are not
// meant to have the audio at all — which is why the audio never travels in the
// hub frame (that reaches everyone) and is collected here instead, from an
// admin/viewer-only server fn. `enabled` is the client half of that gate; the
// server fn refuses anyone else regardless of what a client claims to be.

import { useEffect, useRef } from "react"
import type { BulletinEvent } from "~/lib/gameRoomNet/protocol"
import { takeRoomSpeechFn } from "~/server/game-room-control"
import { ANNOUNCEMENT_SPEECH_LEAD_MS } from "./useMarketNews"

export interface AnnouncementAudioSettings {
  muted: boolean
  volume: number
}

export function useAnnouncementVoice(
  bulletin: BulletinEvent | null,
  enabled: boolean,
  audio: AnnouncementAudioSettings,
): void {
  const playingRef = useRef<HTMLAudioElement | null>(null)
  // Read through refs so a volume change mid-announcement does not restart it,
  // and so the effect keys on the nonce alone.
  const audioRef = useRef(audio)
  audioRef.current = audio
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const speechMs = bulletin?.speechMs
  const nonce = bulletin?.nonce ?? null

  useEffect(() => {
    // No speechMs means the announcement was never spoken — this deployment
    // has no voice configured, or the vendor failed. Nothing to collect.
    if (!enabledRef.current || nonce === null || !speechMs) return

    let cancelled = false
    let startTimer: ReturnType<typeof setTimeout> | null = null

    const stopPrevious = () => {
      const previous = playingRef.current
      playingRef.current = null
      if (previous) previous.pause()
    }
    // Two voices over one PA is worse than a missed announcement, so the
    // outgoing one stops the moment a new one is asked for — not when its
    // audio arrives.
    stopPrevious()

    // Collected NOW and played later: the round trip overlaps the lead-in
    // rather than following it, so the voice starts on time however slow the
    // fetch was.
    void takeRoomSpeechFn({ data: { nonce } })
      .then((speech) => {
        if (cancelled || !speech) return
        startTimer = setTimeout(() => {
          if (cancelled) return
          const element = new Audio(`data:audio/mpeg;base64,${speech.audioBase64}`)
          element.muted = audioRef.current.muted
          element.volume = audioRef.current.volume
          playingRef.current = element
          void element.play().catch(() => {
            // Autoplay with sound needs a gesture the projector laptop may not
            // have had yet. The banner remains visible even if the browser
            // blocks this first spoken announcement.
          })
        }, ANNOUNCEMENT_SPEECH_LEAD_MS)
      })
      .catch(() => {
        // A failed collection leaves the announcement silent. The wall keeps
        // the message, which is the part that matters.
      })

    return () => {
      cancelled = true
      // A bulletin superseded inside the lead-in must never speak: without
      // this its voice would start after the wall had already moved on to the
      // one that replaced it.
      if (startTimer) clearTimeout(startTimer)
    }
  }, [nonce, speechMs])

  // Keep an in-flight announcement aligned with the room's fixed PA settings,
  // the same way the filmed broadcast's audio is aligned.
  useEffect(() => {
    const element = playingRef.current
    if (!element) return
    element.muted = audio.muted
    element.volume = audio.volume
  }, [audio.muted, audio.volume])

  // Leaving the room stops the voice with it.
  useEffect(() => () => playingRef.current?.pause(), [])
}
