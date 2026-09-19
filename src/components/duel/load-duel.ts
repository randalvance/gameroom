// Called only after a deliberate acceptance at a white desk. Never preload:
// the game, its art map and stylesheet are a separate chunk the room downloads
// the first time someone sits down to play.
export const loadDuel = () => import("./DuelGame")
