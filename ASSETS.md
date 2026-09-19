# Assets

The MIT licence in `LICENSE` covers the code. The art and audio under
`public/` came with the room and are listed here so you know what you are
redistributing before you ship it.

| Path | What it is | Terms |
| --- | --- | --- |
| `public/assets/room/` | Floors, walls, furniture and the 132 character sheets | MIT — vendored from the [pixel-agents](https://github.com/) project by Pablo De Lucca. The full notice is in `public/assets/room/ATTRIBUTION.md` and must travel with the files. |
| `public/assets/sprites/` | The UI's pixel icons | Drawn for this project. MIT with the code. |
| `public/assets/arcade/`, `public/assets/backrooms/`, `public/assets/duel/`, `public/assets/primey/` | Sprites, stages and card art for the three easter-egg games and the room's mascot | Generated for the hackathon this room was built for. Fine to use and modify here; they are not a stock art pack and carry no separate grant. |
| `public/*.mp3` | The room's ambient loops, the theme in eight arrangements, and the ceremony cues | Made for the same event. Same footing as the game art above. |

If you are publishing something on top of this and the provenance above is not
good enough for you, every one of these is replaceable: the room reads its
sheets from `/assets/room/characters/char_N.png` (see
`src/components/gameRoom/assets.ts`), and the playlists are two arrays in
`src/lib/menu-sounds.ts`.
