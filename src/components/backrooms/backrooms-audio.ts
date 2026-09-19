/** Owned by the lazy Backrooms chunk. No context or asset requests before Start. */
export type AudioSettings = { effects: number; music: number; musicMuted: boolean }
export type Effect = 'laser' | 'pop' | 'hurt' | 'step' | 'enter' | 'gameover' | 'newsroom-open' | 'bernard-rage' | 'bernard-step' | 'bernard-hit'
const EFFECTS: readonly Effect[] = ['laser', 'pop', 'hurt', 'step', 'enter', 'gameover']
const NEWSROOM_EFFECTS: readonly Effect[] = ['newsroom-open', 'bernard-rage', 'bernard-step', 'bernard-hit']
const ROOT = '/assets/backrooms/audio/'

export function createBackroomsAudio(initial: AudioSettings) {
  let settings = initial
  let ctx: AudioContext | null = null
  let effectsGain: GainNode | null = null, musicGain: GainNode | null = null
  let running = false, closed = false, epoch = 0
  let secretsWanted = false, threat = false
  let music: AudioBufferSourceNode | null = null
  const voices = new Set<AudioBufferSourceNode>()
  const decoded = new Map<string, AudioBuffer>()
  const pending = new Map<string, Promise<AudioBuffer | null>>()
  const abort = new AbortController()

  function load(name: string): Promise<AudioBuffer | null> {
    if (pending.has(name)) return pending.get(name)!
    const context = ctx
    const result = (async () => {
      try {
        if (!context || closed) return null
        const response = await fetch(`${ROOT}${name}.mp3`, { signal: abort.signal })
        if (!response.ok || closed) return null
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        if (closed) return null
        decoded.set(name, buffer)
        return buffer
      } catch { return null } // Audio failure must never stop the game.
    })()
    pending.set(name, result)
    return result
  }
  function stop(source: AudioBufferSourceNode) {
    source.onended = null
    try { source.stop() } catch { /* already ended */ }
    source.disconnect()
  }
  function stopMusic() { if (music) stop(music); music = null }
  function stopVoices() { for (const source of voices) stop(source); voices.clear() }
  function effect(name: Effect) {
    const buffer = decoded.get(name)
    if (!ctx || !effectsGain || !buffer || settings.effects <= 0 || closed) return
    // Holding fire cannot accumulate unbounded simultaneous voices.
    if (voices.size >= 8) { const oldest = voices.values().next().value!; stop(oldest); voices.delete(oldest) }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(effectsGain)
    voices.add(source)
    source.onended = () => { voices.delete(source); source.disconnect() }
    source.start()
  }
  function syncMusic() {
    if (!running || closed || settings.musicMuted || settings.music <= 0) { stopMusic(); return }
    if (!ctx || !musicGain || music) return
    const context = ctx, output = musicGain, version = epoch
    void load('halls').then(buffer => {
      if (!buffer || !running || closed || version !== epoch || music || settings.musicMuted || settings.music <= 0) return
      music = context.createBufferSource()
      music.buffer = buffer; music.loop = true; music.playbackRate.value = threat ? 1.22 : 1; music.connect(output); music.start()
    })
  }
  function applySettings() {
    if (effectsGain) effectsGain.gain.value = Math.max(0, Math.min(1, settings.effects))
    if (musicGain) musicGain.gain.value = settings.musicMuted ? 0 : Math.max(0, Math.min(1, settings.music))
    if (settings.effects <= 0) stopVoices()
    else if (running) {
      for (const name of EFFECTS) void load(name)
      if (secretsWanted) for (const name of NEWSROOM_EFFECTS) void load(name)
    }
    syncMusic()
  }
  return {
    start() {
      if (closed || running) return
      if (!ctx) {
        const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Constructor) return
        try {
          ctx = new Constructor()
          effectsGain = ctx.createGain(); effectsGain.connect(ctx.destination)
          musicGain = ctx.createGain(); musicGain.connect(ctx.destination)
        } catch { void ctx?.close().catch(() => {}); ctx = null; return }
      }
      // Called synchronously from the Start/Resume gesture, including on iOS.
      void ctx.resume().catch(() => {})
      running = true
      const version = ++epoch
      applySettings()
      if (settings.effects > 0) void load('enter').then(() => { if (running && !closed && version === epoch) effect('enter') })
    },
    play(name: Effect) { if (running) effect(name) },
    preloadNewsroom() {
      secretsWanted = true
      if (ctx && running && !closed && settings.effects > 0) for (const name of NEWSROOM_EFFECTS) void load(name)
    },
    setThreat(active: boolean) { threat = active; if (music) music.playbackRate.value = active ? 1.22 : 1 },
    setSettings(next: AudioSettings) { settings = next; if (!closed) applySettings() },
    pause(cue?: Effect) {
      running = false; epoch++; stopMusic(); stopVoices()
      if (cue && ctx && !closed && settings.effects > 0) {
        const version = epoch
        void load(cue).then(() => { if (!closed && version === epoch) effect(cue) })
      }
    },
    end(cue: Effect = 'gameover') { running = false; epoch++; stopMusic(); stopVoices(); effect(cue) },
    close() {
      if (closed) return
      closed = true; running = false; epoch++; abort.abort(); stopMusic(); stopVoices()
      decoded.clear(); pending.clear(); void ctx?.close().catch(() => {})
    },
  }
}
export type BackroomsAudio = ReturnType<typeof createBackroomsAudio>
