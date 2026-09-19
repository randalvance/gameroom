// What the room calls itself.
//
// One string, drawn across the top of the wall-wide screen behind the desks.
// It is a module-level setting rather than a prop because the wall is painted
// onto a canvas texture deep inside the scene, and threading a prop down to
// one fillText would put a rendering detail in every signature between here
// and there.
//
// Set it once, before the room mounts:
//
//     setRoomTitle("#YOURHACKATHON 2027")

let title = "THE GAME ROOM"

/** The headline on the wall screen. */
export function roomTitle(): string {
  return title
}

/** Rename the wall. Takes effect on the screen's next repaint. */
export function setRoomTitle(next: string): void {
  title = next.trim() || "THE GAME ROOM"
}
