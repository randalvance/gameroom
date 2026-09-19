// The doors: when the room opens to players.
//
// The room reads the time from the SERVER, along with the server's own "now",
// so a laptop clock set a day ahead cannot open the doors early. A hub that
// does not answer leaves the room open — a standalone room with no gate is the
// sensible default, and a host that wants one serves this route.

import { apiGet } from "./client"

export interface StudentAccessView {
  opensAtMs: number
  /** The server's clock when this was read, so the holding screen counts from
   * the same "now" the gate decides with, not the visitor's laptop. */
  serverNowMs: number
}

/** Doors already open: the default when there is no hub to ask. */
export function openDoors(): StudentAccessView {
  return { opensAtMs: 0, serverNowMs: Date.now() }
}

export function getStudentAccessFn(): Promise<StudentAccessView> {
  return apiGet<StudentAccessView>("/api/doors", openDoors())
}
