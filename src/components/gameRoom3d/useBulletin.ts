// What the wall's bulletin says right now, from two senders.
//
// A host raises one through the `bulletin` prop; with the hub in use the
// gamemaster's console pushes one down the stream as well. Either way it goes
// up for its hold and then comes down, and this hook is the one timer both
// hang off, so the wall never carries a stale banner from one sender because
// the other's timer was the one that ran out.

import { useEffect, useRef, useState } from "react"
import type { BulletinEvent } from "~/lib/gameRoomNet/protocol"

/** A bulletin the host wants on the wall. */
export interface RoomBulletin {
  text: string
  /** How long it holds the wall. The room's default when absent. */
  holdSeconds?: number
}

/** How long a bulletin holds the wall when nobody says otherwise. */
export const BULLETIN_DEFAULT_HOLD_MS = 12_000

/** Longest bulletin the wall will carry; it is drawn across three lines. */
export const BULLETIN_MAX_LEN = 500

/**
 * The active bulletin's text, or null while the wall is on its board.
 *
 * `pushed` is keyed on its nonce rather than its text, so the same message
 * sent twice raises the banner twice. `own` is keyed on identity: hand in a
 * new object to raise it again.
 */
export function useBulletin(
  own: RoomBulletin | null | undefined,
  pushed: BulletinEvent | null | undefined,
  onRaise?: () => void,
): string | null {
  const [text, setText] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRaiseRef = useRef(onRaise)
  onRaiseRef.current = onRaise

  const raise = (raw: string, holdMs: number) => {
    const message = raw.trim().slice(0, BULLETIN_MAX_LEN)
    if (!message) return
    setText(message)
    onRaiseRef.current?.()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setText(null), holdMs > 0 ? holdMs : BULLETIN_DEFAULT_HOLD_MS)
  }

  useEffect(() => {
    if (!own) return
    raise(own.text, (own.holdSeconds ?? 0) * 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own])

  const pushedRef = useRef(pushed)
  pushedRef.current = pushed
  const nonce = pushed?.nonce ?? null
  useEffect(() => {
    const bulletin = pushedRef.current
    if (!bulletin || nonce === null) return
    raise(bulletin.message, bulletin.holdMs ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return text
}
