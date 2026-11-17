# SNARK: Miami Devolved

An ARK-style browser survival parody with GTA vehicles and persistent multiplayer. TypeScript on Bun, zero runtime dependencies.

- **Renderer.** WebGL 2 without Three.js or Unreal Engine. Frustum culling skips offscreen geometry and screen-space error selects mesh LODs. A ten-minute iPhone test with 800 bodies and 2,048 building pieces finished at a median 17 ms per frame (about 60 FPS).
- **Modding.** Creatures and engrams live in `content/`. ARK-style INIs set server rates. The map builder turns public data into full-scale cities. [Server configs](config/) · [Map builder](tools/mapworld/)
- **MCP.** Agents join as survivors to harvest, craft, build and ride with normal player permissions. [Agent setup](agent/README.md#run-it)

## Gameplay systems

**ARK**

- **Playable.** Harvesting, engrams, crafting, snap building, tribes, knockout taming and breeding. Ride raptors and parasaurs, or hover and barrel-roll on a saddled pteranodon.
- **Partial.** Loot tables roll item quality and blueprints. Supply drops still need a spawner.
- **Missing.** Artifact runs, boss arenas and ascension.

**GTA**

- **Playable.** Drive a compact car, pilot a motorboat or fly a helicopter. Vehicles carry passengers and cargo, burn fuel and persist across restarts.
- **Partial.** Civilians can take seats and be carjacked. Ambient traffic and civilian routes are missing.
- **Missing.** Wanted levels, police pursuits, missions and heists.

## Run it

```sh
bun install
bun run dev        # http://localhost:8787
```

The proving ground runs without art packs, using mannequins and block models. Installed models replace them. City maps need separate map data. Play with keyboard and mouse or a gamepad.

Test with `bun run check`. Build the static game and wiki with `bun run build && bun run wiki`.

MIT licence.
