import { describe, expect, it } from 'vitest'
import { spriteFrame } from './sprite-animation'

describe('spriteFrame', () => {
  it('advances through four frames and loops at the requested rate', () => {
    expect(spriteFrame(0, 4)).toBe(0)
    expect(spriteFrame(.24, 4)).toBe(0)
    expect(spriteFrame(.25, 4)).toBe(1)
    expect(spriteFrame(.75, 4)).toBe(3)
    expect(spriteFrame(1, 4)).toBe(0)
  })

  it('supports an integer phase offset for desynchronised animations', () => {
    expect(spriteFrame(0, 4, 2)).toBe(2)
    expect(spriteFrame(.5, 4, 3)).toBe(1)
  })
})
