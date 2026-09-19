export type RoomMoveDirection = "up" | "down" | "left" | "right"

export function createRoomLocalInput() {
  const keysDown: Record<RoomMoveDirection, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
  }
  let disabled = false

  const releaseMovement = () => {
    keysDown.up = keysDown.down = keysDown.left = keysDown.right = false
  }

  return {
    setDisabled(next: boolean) {
      disabled = next
      if (disabled) releaseMovement()
    },
    setMoveInput(direction: RoomMoveDirection, active: boolean) {
      if (disabled && active) return
      keysDown[direction] = active
    },
    movement() {
      if (disabled) return { dx: 0, dy: 0 }
      return {
        dx: (keysDown.right ? 1 : 0) - (keysDown.left ? 1 : 0),
        dy: (keysDown.down ? 1 : 0) - (keysDown.up ? 1 : 0),
      }
    },
    canInteract() {
      return !disabled
    },
    releaseMovement,
  }
}
