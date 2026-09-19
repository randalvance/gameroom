import { useEffect, useRef, useState, type ComponentType } from "react"
import { loadArcade } from "./load-arcade"

export interface ArcadeGameProps {
  onExit: () => void
  /** The site's fixed effects volume, 0..1. */
  volume: number
  /** The site's music setting, which the arcade's music follows. */
  music?: { volume: number; muted: boolean }
}

/** Only this small loading shell is part of the main game-room bundle. */
export function ArcadePortal({ active, volume, music, onExit }: { active: boolean; volume: number; music?: { volume: number; muted: boolean }; onExit: () => void }) {
  const [Game, setGame] = useState<ComponentType<ArcadeGameProps> | null>(null)
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
    loadArcade().then((module) => {
      if (!cancelled) setGame(() => module.default)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [active, attempt])
  if (!active) return null
  return (
    <div ref={shellRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Arcade cabinet"
      className="fixed inset-0 z-[100] bg-ink text-white outline-none">
      {Game ? <Game onExit={onExit} volume={volume} music={music} /> : (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-display text-xl text-coin">IMPACT HACKERS</h1>
          <p role={failed ? "alert" : "status"} className="font-body text-2xl">
            {failed ? "The cabinet ate your coin… connection lost. Try again?" : "INSERTING COIN…"}
          </p>
          {failed && <button className="border-2 border-coin px-4 py-2 font-mono" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
          <button className="border-2 border-sky px-4 py-2 font-mono" onClick={onExit}>Back to game room</button>
        </div>
      )}
    </div>
  )
}
