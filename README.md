![An armoured survivor rides a pteranodon over Miami at sunrise while the red obelisk fires its beam](docs/media/hero.webp)

# SNARK · Miami Devolved

ARK-style dinosaur survival and GTA-style vehicles in a persistent multiplayer browser game. [Changelog](CHANGELOG.txt)

- **Any city** · A procedural map pipeline turns public data into a playable city, with room for agents to add to it. Launching with Miami and four more real cities: Tampa, Las Vegas, Los Angeles, San Francisco. About 66 km² each.
- **Survival** · Form tribes, unlock engrams, craft gear, snap bases together. Knock out, tame, breed and ride dinosaurs.
- **Vehicles** · Cars, trucks and a bus, boats from jet skis to yachts, and helicopters. Passengers, cargo, fuel and persistent parking.
- **Multiplayer** · Client-predicted movement, lag-compensated hits, crash-safe survivor and gear transfers between servers.
- **Engine** · Native WebGL 2, TypeScript on Bun, zero runtime dependencies. An iPhone benchmark hit a 17 ms median frame at minute ten with 800 bodies.
- **Modding** · Content packs define creatures and engrams. ARK-style INIs tune servers. MCP agents harvest, craft and ride as players.

**Run locally** `bun install --frozen-lockfile && bun run dev` → `localhost:8787`

<p align="center">
  <img src="docs/media/roster.webp" width="32%" alt="The ten creatures on South Beach with a survivor for scale">
  <img src="docs/media/rex.webp" width="32%" alt="A survivor rides a Tyrannosaurus through Bayfront Park">
  <img src="docs/media/herd.webp" width="32%" alt="Triceratops, Stegosaurus and Parasaurolophus on a Wynwood street">
  <img src="docs/media/boats.webp" width="32%" alt="Eleven boats on the bay off downtown">
  <img src="docs/media/cars.webp" width="32%" alt="Fourteen road vehicles under the downtown towers">
  <img src="docs/media/cruise.webp" width="32%" alt="The cruise ship at the port">
  <img src="docs/media/koru.webp" width="32%" alt="The sailing yacht moored off downtown">
  <img src="docs/media/obelisk.webp" width="32%" alt="The blue obelisk at dusk">
  <img src="docs/media/sunset.webp" width="32%" alt="The pteranodon and the red obelisk at sunset">
</p>

All pictures are frames from the game's own renderer.

[Map pipeline](tools/maps/README.md) · [Art & downloads](distribution/README.md) · [Agent setup](agent/README.md#run-it) · [Benchmarks](planning/quality/performance.md) · [Code license](LICENSE)
