// The microphone behind the snap.
//
// Holding Shift+Space opens the mic; letting go of either key closes it. The
// mic is never open otherwise — the room does not listen to anyone who is not
// deliberately holding the chord, and the stream's tracks are stopped (not
// just unhooked) the moment the chord breaks, so the browser's recording
// indicator goes out with it. While it is open, each frame's level goes
// through the snap detector and a hit calls `onSnap` once.
//
// A denied permission, a browser with no mediaDevices, or a chord released
// before the permission prompt was answered all end the same way: quietly,
// with nothing open.

import { useEffect, useRef, useState } from "react"
import { createSnapDetector, rmsOf } from "~/lib/snap-detector"

/** True for the keydown that opens the mic: Space with Shift held, not typing. */
export function isSnapChord(e: KeyboardEvent): boolean {
  if (e.code !== "Space" || !e.shiftKey) return false
  if (e.altKey || e.ctrlKey || e.metaKey) return false
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return false
  if (t instanceof HTMLElement && t.isContentEditable) return false
  return true
}

/** True for the keyup that breaks the chord: either of its keys coming up. */
export function breaksSnapChord(e: KeyboardEvent): boolean {
  return e.code === "Space" || e.key === "Shift"
}

interface OpenMic {
  stream: MediaStream
  context: AudioContext
  frame: number
}

export function useSnapMic({ enabled, onSnap }: { enabled: boolean; onSnap: () => void }): { listening: boolean } {
  const [listening, setListening] = useState(false)
  const onSnapRef = useRef(onSnap)
  onSnapRef.current = onSnap

  useEffect(() => {
    if (!enabled) return
    let held = false
    let mic: OpenMic | null = null
    /** Bumped on every release so a permission that lands late finds its
     * request already withdrawn. */
    let generation = 0

    const close = () => {
      held = false
      generation++
      if (!mic) return
      cancelAnimationFrame(mic.frame)
      for (const track of mic.stream.getTracks()) track.stop()
      void mic.context.close().catch(() => { /* already closed */ })
      mic = null
      setListening(false)
    }

    const open = async () => {
      const devices = navigator.mediaDevices
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!devices?.getUserMedia || !Ctor) return
      const mine = generation
      let stream: MediaStream
      try {
        stream = await devices.getUserMedia({ audio: true })
      } catch {
        return
      }
      if (generation !== mine || !held) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      const context = new Ctor()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const detector = createSnapDetector()
      const tick = () => {
        if (!mic) return
        analyser.getByteTimeDomainData(samples)
        if (detector.push(rmsOf(samples), performance.now())) onSnapRef.current()
        mic.frame = requestAnimationFrame(tick)
      }
      mic = { stream, context, frame: 0 }
      mic.frame = requestAnimationFrame(tick)
      setListening(true)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSnapChord(e)) return
      e.preventDefault()
      if (held) return
      held = true
      void open()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (held && breaksSnapChord(e)) close()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", close)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", close)
      close()
    }
  }, [enabled])

  return { listening }
}
