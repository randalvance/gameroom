import { useEffect, useRef, useState, type ComponentType } from "react"
import type { DeckId } from "./cards"
import type { DuelGameProps } from "./DuelGame"
import { loadDuel } from "./load-duel"
import { logger } from "~/lib/logger"

export interface DuelPortalProps {
  active: boolean
  houseDeck: DeckId
  houseName: string
  /** The site's fixed effects volume, 0..1. */
  volume: number
  onExit: () => void
  onWin: (houseDeck: DeckId) => void
}

/** Only this small loading shell is part of the main game-room bundle. */
export function DuelPortal({ active, houseDeck, houseName, volume, onExit, onWin }: DuelPortalProps) {
  const [Game, setGame] = useState<ComponentType<DuelGameProps> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement
    shellRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [active])
  useEffect(() => {
    if (!active) {
      setGame(null)
      return
    }
    let cancelled = false
    setFailed(false)
    loadDuel().then((module) => {
      if (!cancelled) setGame(() => module.default)
    }).catch((error: unknown) => {
      // The room keeps working; a run of these means the chunk is unreachable.
      logger.warn("duel.chunk_load_failed", { houseDeck, attempt }, error)
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [active, attempt, houseDeck])
  if (!active) return null
  return (
    <div ref={shellRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Card duel"
      className="fixed inset-0 z-[100] bg-ink text-white outline-none">
      {Game ? <Game houseDeck={houseDeck} houseName={houseName} volume={volume} onExit={onExit} onWin={onWin} /> : (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-display text-xl text-coin">TABLE STAKES</h1>
          <p role={failed ? "alert" : "status"} className="font-body text-2xl">
            {failed ? "The deck slid off the table… connection lost. Try again?" : "SHUFFLING…"}
          </p>
          {failed && <button className="border-2 border-coin px-4 py-2 font-mono" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
          <button className="border-2 border-sky px-4 py-2 font-mono" onClick={onExit}>Back to game room</button>
        </div>
      )}
    </div>
  )
}
