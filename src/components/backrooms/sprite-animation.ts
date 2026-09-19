export const SPRITE_FRAME_COUNT = 4

export function spriteFrame(time: number, framesPerSecond: number, phase = 0) {
  return Math.floor(time * framesPerSecond + phase) % SPRITE_FRAME_COUNT
}

export function spriteFrameOffset(frame: number) {
  return frame / SPRITE_FRAME_COUNT
}
