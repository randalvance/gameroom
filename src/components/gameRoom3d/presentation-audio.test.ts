import { describe, expect, it } from "vitest"
import { PresentationAudioPlayer } from "./presentation-audio"

class FakeAudio {
  currentTime = 9
  muted = true
  volume = 0
  pauses = 0
  plays = 0
  reject = true

  pause() { this.pauses += 1 }
  play() {
    this.plays += 1
    return this.reject ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve()
  }
}

describe("PresentationAudioPlayer", () => {
  it("retries a blocked reveal cue after a trusted interaction", async () => {
    const audio = new FakeAudio()
    const player = new PresentationAudioPlayer(audio)

    player.sync("draw:1", { muted: false, volume: 0.8 })
    await Promise.resolve()
    expect(audio.plays).toBe(1)

    audio.reject = false
    player.unlock()
    await Promise.resolve()
    expect(audio.plays).toBe(2)
    expect(audio.currentTime).toBe(0)
    expect(audio.muted).toBe(false)
    expect(audio.volume).toBe(0.8)
  })
})
