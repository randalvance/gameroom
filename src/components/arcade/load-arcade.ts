// Called only after a deliberate cabinet interaction. Never preload this module:
// the fighter, its renderer and its stylesheet are a separate chunk the room
// downloads the first time someone steps up to play.
export const loadArcade = () => import("./FighterGame")
