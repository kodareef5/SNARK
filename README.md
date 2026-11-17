# SNARK: Miami Devolved

A browser survival parody with persistent multiplayer worlds.

- **Zero dependencies.** TypeScript on [Bun](https://bun.com) and nothing else: the renderer, the file formats, the
  texture and sound coding and the map builder are all here.
- **Runs on a phone.** In the phone's own browser, at 60 frames a second on an iPhone. Played with a keyboard and
  mouse or a gamepad.
- **Real cities at full scale.** Public map data in, a playable map out: `tools/mapdata` and `tools/mapworld`.
- **Easy to fork and hack.** The game is data in `content/`, a server is set up as an ARK server is (`config/`), and
  `bun run check` tests for regressions.

## Gameplay systems

**ARK**

- **Playable** — harvesting, engrams, crafting, snapped bases, tribes, knockout taming and breeding. Ride a saddled raptor or parasaur. A mounted pteranodon can take off, hover, barrel-roll and land.
- **Partial** — loot tables roll item quality and blueprints. Supply drops have no world spawner.
- **Missing** — artifact runs, boss arenas and ascension.

**GTA**

- **Playable** — drive a compact car, pilot a motorboat or fly a helicopter. Vehicles carry passengers and cargo, burn fuel and persist across restarts.
- **Partial** — civilians can take seats and players can carjack a driver. Ambient traffic and civilian routes are missing.
- **Missing** — wanted levels, police pursuits, missions and heists.

## Run it

```sh
bun install
bun run dev        # http://localhost:8787
```

A source checkout starts on the generated proving ground. The build makes a survivor mannequin,
trees, building pieces and block creatures and vehicles from the game definitions. Installed art
packs supply their own models. City maps need their separate map data.

To build the game and its wiki as static files, run `bun run build` and then `bun run wiki`.

MIT licence.
