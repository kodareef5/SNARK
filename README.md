# SNARK: Miami Devolved

A browser survival parody with persistent multiplayer worlds.

- **Zero dependencies.** TypeScript on [Bun](https://bun.com) and nothing else: the renderer, the file formats, the
  texture and sound coding and the map builder are all here.
- **Runs on a phone.** In the phone's own browser, at 60 frames a second on an iPhone. Played with a keyboard and
  mouse or a gamepad.
- **Real cities at full scale.** Public map data in, a playable map out: `tools/mapdata` and `tools/mapworld`.
- **Easy to fork and hack.** The game is data in `content/`, a server is set up as an ARK server is (`config/`), and
  `bun run check` tests for regressions.

## Run it

```sh
bun install
bun run dev        # http://localhost:8787
```

The game needs its art to build, and the art is not in this repository.

## Art, patches, collaboration

261977334+kodareef5@users.noreply.github.com

MIT licence.
