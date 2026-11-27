![A rider flies over Biscayne Bay at twilight beneath the blue Tide Eye, with the live desktop HUD visible](docs/media/hero.webp)

# SNARK · Miami Devolved

ARK-style dinosaur survival and GTA-style vehicles in a persistent multiplayer browser game. [Changelog](CHANGELOG.txt)

- **Any city** · A procedural map pipeline turns public data into a playable city, with room for agents to add to it. Launching with Miami and four more real cities: Tampa, Las Vegas, Los Angeles, San Francisco. Each map spans roughly 16 km by 16 km.
- **Survival** · Form tribes, unlock engrams, craft gear, snap bases together. Knock out, tame, breed and ride dinosaurs.
- **Vehicles** · Cars, trucks and a bus, boats from jet skis to yachts, and helicopters. Passengers, cargo, fuel and persistent parking.
- **Multiplayer** · Client-predicted movement, lag-compensated hits, crash-safe survivor and gear transfers between servers.
- **Engine** · Native WebGL 2, TypeScript on Bun, zero runtime dependencies. An iPhone benchmark hit a 17 ms median frame at minute ten with 800 bodies.
- **Modding** · Content packs define creatures and engrams. ARK-style INIs tune servers. MCP agents harvest, craft and ride as players.

**Run locally** `bun install --frozen-lockfile && bun run dev` → `localhost:8787`

[Map pipeline](tools/maps/README.md) · [Art & downloads](distribution/README.md) · [Agent setup](agent/README.md#run-it) · [Benchmarks](planning/quality/performance.md) · [Code license](LICENSE)

[![The wiki’s Rex dossier, item index and home page with three mounted flyers at daybreak](docs/media/wiki.webp)](docs/media/wiki.webp)

[![The cluster admin’s map replay, supply drops and Vegas ball screens](docs/media/admin-views.webp)](docs/media/admin-views.webp)

[![Play the four-second clip of a Zephyr kickflipping over a semi beside a ridden Rex](docs/media/zephyr.webp)](docs/media/zephyr.mp4 "Play the four-second Zephyr kickflip")

[![Six mobile gameplay screens surrounding the SNARK emblem on the Miami waterfront](docs/media/mobile.webp)](docs/media/mobile.webp)

[![A Wraith banks over the Vegas ball as its screen changes from lava to ocean at sunset](docs/media/vegas-jet.webp)](docs/media/vegas-jet.webp)

[![At the Lookout, a plasma bolt leaves a survivor’s rifle as a damage number hangs over a red-lit raptor](docs/media/lookout.webp)](docs/media/lookout.webp)

[![One SNARK city compared with Miami, GTA V, GTA VI and The Island at the same scale](docs/media/map-size.webp)](docs/media/map-size.webp)
