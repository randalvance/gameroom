import { useEffect, useRef, useState, type ComponentType } from "react"
import { loadBackrooms } from "./load-backrooms"

/** Only this small loading shell is part of the main game-room bundle. */
export function BackroomsPortal({ active, onExit, hideKonamiHint = false }: { active: boolean; onExit: () => void; hideKonamiHint?: boolean }) {
  const [Game, setGame] = useState<ComponentType<{ onExit: () => void; hideKonamiHint?: boolean }> | null>(null)
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
    loadBackrooms().then((module) => {
      if (!cancelled) setGame(() => module.default)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [active, attempt])
  if (!active) return null
  return (
    <div ref={shellRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="The Backrooms"
      className="fixed inset-0 z-[100] bg-ink text-white outline-none">
      {Game ? <Game onExit={onExit} hideKonamiHint={hideKonamiHint} /> : (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-display text-xl text-coin">THE BACKROOMS</h1>
          <p role={failed ? "alert" : "status"} className="font-body text-2xl">
            {failed ? "The ladder leads nowhere… connection lost. Try again?" : "CLIMBING DOWN…"}
          </p>
          {failed && <button className="border-2 border-coin px-4 py-2 font-mono" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
          <button className="border-2 border-sky px-4 py-2 font-mono" onClick={onExit}>Back to game room</button>
        </div>
      )}
    </div>
  )
}
