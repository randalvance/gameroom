// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackroomsAudio } from './backrooms-audio'

const settings = { effects: .8, music: .5, musicMuted: false }
function harness() {
  const sources: { loop: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended?: () => void }[] = []
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = []
  const context = {
    state: 'running', destination: {}, currentTime: 0,
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    createGain: () => { const gain = { gain: { value: 0 }, connect: vi.fn() }; gains.push(gain); return gain },
    createBufferSource: () => { const source = { loop: false, playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(source); return source },
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 32 }),
  }
  const ctor = vi.fn(function () { return context })
  vi.stubGlobal('AudioContext', ctor)
  const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
  vi.stubGlobal('fetch', fetcher)
  return { sources, gains, context, ctor, fetcher }
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
afterEach(() => vi.unstubAllGlobals())

describe('Backrooms sound lifetime', () => {
  it('does not create a context or download anything until Start', async () => {
    const h = harness(); const audio = createBackroomsAudio(settings)
    audio.setSettings(settings)
    expect(h.ctor).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
    audio.start(); await settle()
    expect(h.ctor).toHaveBeenCalledTimes(1)
    expect(h.fetcher).toHaveBeenCalledTimes(7)
    expect(h.sources.filter(source => source.loop)).toHaveLength(1)
    audio.close()
  })
  it('does not download muted music, then starts it when enabled during play', async () => {
    const h = harness(); const audio = createBackroomsAudio({ ...settings, musicMuted: true })
    audio.start(); await settle()
    expect(h.fetcher.mock.calls.some(([url]) => url.endsWith('/halls.mp3'))).toBe(false)
    audio.setSettings(settings); await settle()
    expect(h.sources.filter(source => source.loop)).toHaveLength(1)
    audio.close()
  })
  it.each(['pause', 'close'] as const)('never plays deferred entry or music after %s', async action => {
    const h = harness(); const resolves: ((value: unknown) => void)[] = []
    h.context.decodeAudioData.mockImplementation(() => new Promise(done => { resolves.push(done) }))
    const audio = createBackroomsAudio(settings); audio.start(); await settle()
    audio[action](); resolves.forEach(resolve => resolve({ duration: 32 })); await settle()
    expect(h.sources).toHaveLength(0)
    audio.close(); expect(h.context.close).toHaveBeenCalledOnce()
    expect((h.fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true)
  })
  it('bounds rapid fire and stops all voices on pause; resumes from cached buffers', async () => {
    const h = harness(); const audio = createBackroomsAudio(settings)
    audio.start(); await settle()
    for (let i = 0; i < 40; i++) audio.play('laser')
    const active = () => h.sources.filter(source => source.start.mock.calls.length && !source.stop.mock.calls.length)
    expect(active().length).toBeLessThanOrEqual(9) // eight effects + one music source
    audio.pause(); expect(active()).toHaveLength(0)
    const count = h.sources.length; audio.play('laser'); expect(h.sources).toHaveLength(count)
    audio.start(); await settle(); expect(h.fetcher).toHaveBeenCalledTimes(7)
    audio.close(); expect(active()).toHaveLength(0)
  })
  it('applies live volume changes and ends music while the game-over cue plays', async () => {
    const h = harness(); const audio = createBackroomsAudio(settings)
    audio.start(); await settle()
    audio.setSettings({ effects: 0, music: .2, musicMuted: false })
    const before = h.sources.length; audio.play('laser'); expect(h.sources).toHaveLength(before)
    expect(h.gains.map(gain => gain.gain.value)).toEqual([0, .2])
    audio.setSettings(settings); audio.end()
    expect(h.sources.filter(source => source.loop).every(source => source.stop.mock.calls.length)).toBe(true)
    expect(h.sources.at(-1)?.loop).toBe(false)
    audio.close()
  })
  it('silently tolerates unavailable audio and network failures', async () => {
    const h = harness(); h.fetcher.mockRejectedValue(new Error('offline'))
    const audio = createBackroomsAudio(settings); audio.start(); await settle()
    expect(h.sources).toHaveLength(0); audio.close()
    vi.stubGlobal('AudioContext', undefined)
    const silent = createBackroomsAudio(settings)
    expect(() => { silent.start(); silent.play('laser'); silent.close() }).not.toThrow()
  })

  it('downloads secret cues only on approach, caches them, and plays the reveal over the paused dialog', async () => {
    const h = harness(); const audio = createBackroomsAudio(settings)
    audio.start(); await settle()
    expect(h.fetcher).toHaveBeenCalledTimes(7)
    audio.preloadNewsroom(); audio.preloadNewsroom(); await settle()
    expect(h.fetcher).toHaveBeenCalledTimes(11)
    const count = h.sources.length
    audio.pause('newsroom-open'); await settle()
    expect(h.sources.length).toBe(count + 1)
    expect(h.sources.at(-1)?.loop).toBe(false)
    audio.close()
  })

  it('cancels a slow warning cue when the player quits before it decodes', async () => {
    const h = harness(); const audio = createBackroomsAudio(settings)
    audio.start(); await settle()
    let resolve!: (value: unknown) => void
    h.context.decodeAudioData.mockImplementation(() => new Promise(done => { resolve = done }))
    audio.pause('newsroom-open'); await settle()
    const count = h.sources.length
    audio.close(); resolve({ duration: .8 }); await settle()
    expect(h.sources).toHaveLength(count)
  })
})
