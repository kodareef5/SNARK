# SNARK: Miami Devolved

An ARK-style browser survival parody with GTA vehicles and persistent multiplayer. TypeScript on Bun, zero runtime dependencies.

- **Renderer.** Native browser graphics with WebGL 2, no Three.js or Unreal Engine. About 60 FPS in our iPhone test.
- **Maps.** Five real-world cities, about 66 km² each. The map format supports up to 16 km per side. [Map builder](tools/mapworld/)
- **Clusters.** One click at an obelisk moves your survivor and gear to another server. Crash recovery prevents lost or duplicated items.
- **PvP.** Movement responds locally. The server checks hits with lag compensation. Multiplayer tests cover high ping and dropped packets.
- **Modding.** Define creatures and engrams in the content files and tune server rates in ARK-style INIs. [Content](content/) · [Server configs](config/)
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
In the GitHub export, run commands that name a tool file from `game/`.

MIT licence.
