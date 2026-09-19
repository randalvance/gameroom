import { describe, expect, it } from "vitest"
import { createRoomLocalInput } from "./local-input"

describe("createRoomLocalInput", () => {
  it("releases held movement when local input is disabled", () => {
    const input = createRoomLocalInput()
    input.setMoveInput("up", true)
    expect(input.movement()).toEqual({ dx: 0, dy: -1 })

    input.setDisabled(true)

    expect(input.movement()).toEqual({ dx: 0, dy: 0 })
  })

  it("rejects movement and interaction while disabled until explicitly re-enabled", () => {
    const input = createRoomLocalInput()
    input.setDisabled(true)

    input.setMoveInput("right", true)
    expect(input.movement()).toEqual({ dx: 0, dy: 0 })
    expect(input.canInteract()).toBe(false)

    input.setDisabled(false)
    expect(input.movement()).toEqual({ dx: 0, dy: 0 })
    expect(input.canInteract()).toBe(true)

    input.setMoveInput("right", true)
    expect(input.movement()).toEqual({ dx: 1, dy: 0 })
  })
})
