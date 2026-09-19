export interface PresentationAudioElement {
  currentTime: number
  muted: boolean
  volume: number
  pause(): void
  play(): Promise<void>
}

export class PresentationAudioPlayer {
  private activeKey: string | null = null
  private pendingKey: string | null = null
  private settings = { muted: true, volume: 0.8 }

  constructor(private readonly audio: PresentationAudioElement) {}

  sync(key: string | null, settings: { muted: boolean; volume: number }): void {
    this.settings = settings
    if (key === this.activeKey) return
    this.activeKey = key
    this.pendingKey = key
    this.audio.pause()
    this.audio.currentTime = 0
    if (key !== null) this.playPending()
  }

  unlock(): void {
    if (this.pendingKey !== null) this.playPending()
  }

  private playPending(): void {
    const key = this.pendingKey
    if (key === null) return
    this.audio.muted = this.settings.muted
    this.audio.volume = this.settings.volume
    void this.audio.play().then(() => {
      if (this.pendingKey === key) this.pendingKey = null
    }).catch(() => {
      // Browser autoplay rules defer this cue until the next trusted input.
    })
  }
}
