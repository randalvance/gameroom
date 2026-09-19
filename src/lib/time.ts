// Singapore time zone. API reference §5: anything shown to a user (or exported)
// must be SGT (UTC+8). Pin the zone explicitly on every user-facing time render —
// a locale like "en-SG" alone still formats in the viewer's local clock.
export const SGT = "Asia/Singapore"
