import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import {
  MENU_AUDIO_SETTINGS_KEY,
  MENU_SOUND_URLS,
  advanceMusicQueue,
  currentMusicTrack,
  loadMenuAudioSettings,
  musicPools,
  musicQueueLength,
  musicRequestKey,
  playMenuSound,
  sameMusicPools,
  startMusicQueue,
  type MusicQueue,
  type MusicRequest,
} from "~/lib/menu-sounds"

type SoundEffect = "news"
type SiteAudioContextValue = {
  playSfx: (effect: SoundEffect) => void
  setMusicTrack: (track: MusicRequest | null) => void
  /**
   * Stop the music for something that has to be heard on its own — the filmed
   * market-event broadcast on the game room's wall screen. Releasing it starts
   * the playlist again, unless the user had the music off anyway.
   */
  suspendMusic: (suspended: boolean) => void
  effectsVolume: number
  musicMuted: boolean
  musicVolume: number
  toggleMusic: () => void
  setMusicVolume: (volume: number) => void
}
const SiteAudioContext = createContext<SiteAudioContextValue | null>(null)
const SITE_EFFECTS_VOLUME = 0.8


export function useSiteAudio(): SiteAudioContextValue {
  const value = useContext(SiteAudioContext)
  if (!value) throw new Error("useSiteAudio must be used inside AudioProvider")
  return value
}

export function usePageMusic(track: MusicRequest): void {
  const setMusicTrack = useContext(SiteAudioContext)?.setMusicTrack
  // A playlist is usually handed in as an array, so depend on its contents
  // rather than its identity — otherwise a re-render would reshuffle the queue.
  const trackKey = musicRequestKey(track)
  const trackRef = useRef(track)
  trackRef.current = track

  useEffect(() => {
    if (!setMusicTrack) return
    setMusicTrack(trackRef.current)
    return () => setMusicTrack(null)
  }, [setMusicTrack, trackKey])
}

export function SiteAudioControls({ className = "" }: { className?: string }) {
  const audio = useSiteAudio()

  return (
    <div className={`site-audio-controls ${className}`.trim()}>
      <div className="site-audio-control-row flex items-center gap-2">
        <button type="button" onClick={audio.toggleMusic} aria-label={audio.musicMuted ? "Unmute background music" : "Mute background music"} aria-pressed={audio.musicMuted} className="w-[76px] cursor-pointer border border-sky bg-transparent px-2 py-1 text-left text-[9px] text-sky hover:text-neon">{audio.musicMuted ? "MUSIC OFF" : "MUSIC ON"}</button>
        <input type="range" min="0" max="1" step="0.05" value={audio.musicVolume} onChange={(event) => audio.setMusicVolume(Number(event.target.value))} aria-label="Background music volume" className="w-24 accent-[var(--color-sky)]" />
      </div>
    </div>
  )
}

export function AudioProvider({ children, defaultMuted = true }: { children: ReactNode; defaultMuted?: boolean }) {
  const [initialSettings] = useState(() => loadMenuAudioSettings(defaultMuted))
  const [musicMuted, setMusicMuted] = useState(initialSettings.musicMuted)
  const [musicVolume, setMusicVolume] = useState(initialSettings.musicVolume)
  const [musicSuspended, setMusicSuspended] = useState(false)
  const [musicQueue, setMusicQueue] = useState<MusicQueue | null>(null)
  const musicTrack = currentMusicTrack(musicQueue)
  // A lone track loops natively, which is gapless; a playlist cannot, because
  // looping would suppress the `ended` event the hand-off depends on.
  const loopCurrentTrack = musicQueueLength(musicQueue) <= 1
  const newsAudio = useRef<HTMLAudioElement>(null)
  const backgroundAudio = useRef<HTMLAudioElement>(null)

  const startMusic = useCallback(() => {
    if (musicMuted || musicSuspended) return
    void backgroundAudio.current?.play().catch(() => {
      // Autoplay may require a user gesture in some browsers.
    })
  }, [musicMuted, musicSuspended])

  const playSfx = useCallback((_effect: SoundEffect) => {
    playMenuSound(newsAudio.current)
    startMusic()
  }, [startMusic])

  const setMusicTrack = useCallback((track: MusicRequest | null) => {
    if (track === null) {
      setMusicQueue(null)
      return
    }
    const pools = musicPools(track)
    setMusicQueue((current) => current && sameMusicPools(current.pools.map((pool) => pool.tracks), pools) ? current : startMusicQueue(pools))
  }, [])

  // Hand over to the next track when one finishes: the next pool's turn, and a
  // reshuffle of any pool whose order has run out (see advanceMusicQueue).
  const advanceTrack = useCallback(() => {
    setMusicQueue((current) => current && advanceMusicQueue(current))
  }, [])

  useEffect(() => {
    if (newsAudio.current) {
      newsAudio.current.muted = false
      newsAudio.current.volume = SITE_EFFECTS_VOLUME
    }
    if (backgroundAudio.current) {
      backgroundAudio.current.muted = musicMuted
      backgroundAudio.current.volume = musicVolume
    }
  }, [musicMuted, musicVolume, musicTrack])

  useEffect(() => {
    window.localStorage.setItem(MENU_AUDIO_SETTINGS_KEY, JSON.stringify({ musicMuted, musicVolume }))
  }, [musicMuted, musicVolume])

  useEffect(() => { startMusic() }, [startMusic])

  useEffect(() => {
    const audio = backgroundAudio.current
    if (!audio) return
    audio.currentTime = 0
    audio.load()
    startMusic()
  }, [musicTrack, startMusic])

  useEffect(() => {
    const resumeMusic = () => startMusic()
    window.addEventListener("pointerdown", resumeMusic, { once: true })
    window.addEventListener("keydown", resumeMusic, { once: true })
    return () => {
      window.removeEventListener("pointerdown", resumeMusic)
      window.removeEventListener("keydown", resumeMusic)
    }
  }, [startMusic])

  const suspendMusic = useCallback((suspended: boolean) => setMusicSuspended(suspended), [])

  // A broadcast stops the playlist outright rather than turning it down: an
  // anchor and a soundtrack talking at once is what ducking still left in the
  // room. Releasing goes back through startMusic, so music the user muted
  // stays off rather than being switched on by a clip ending.
  useEffect(() => {
    const audio = backgroundAudio.current
    if (!audio) return
    if (musicSuspended) audio.pause()
    else startMusic()
  }, [musicSuspended, startMusic])

  const toggleMusic = useCallback(() => {
    setMusicMuted((muted) => {
      if (!muted) {
        backgroundAudio.current?.pause()
        if (backgroundAudio.current) backgroundAudio.current.currentTime = 0
      }
      return !muted
    })
  }, [])

  return (
    <SiteAudioContext.Provider value={{ playSfx, setMusicTrack, suspendMusic, effectsVolume: SITE_EFFECTS_VOLUME, musicMuted, musicVolume, toggleMusic, setMusicVolume }}>
      <audio ref={newsAudio} preload="auto" src={MENU_SOUND_URLS.news} />
      {musicTrack && <audio ref={backgroundAudio} autoPlay={!musicSuspended} loop={loopCurrentTrack} muted={musicMuted} onCanPlay={startMusic} onEnded={advanceTrack} preload="auto" src={musicTrack} />}
      {children}
    </SiteAudioContext.Provider>
  )
}
