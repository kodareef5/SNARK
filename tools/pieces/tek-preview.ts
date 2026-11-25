// Run after building the Tek art and client: bun tools/pieces/tek-preview.ts
import { resolve } from "node:path";
import { serveFile } from "../../server/files.ts";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import type { Loadout } from "../../shared/loadout/book.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { EAST, SOUTH, WEST, join, start, type Built } from "../../tests/fixtures/slots.ts";

/** Two Tek panels share an edge and a Metal panel closes the same row. */
export function stageWalls(w: Built): number[] {
  const base = w.reg.index.get("core:foundation_metal")!;
  const tek = w.reg.index.get("core:wall_tek")!;
  const metal = w.reg.index.get("core:wall_metal")!;
  const hp = w.reg.maxHp;
  const centre = start(w, base, PROVING_SPAWN.x - 0.4, 0, PROVING_SPAWN.z + 6.2, 4400, 7, hp[base]);
  const left = join(w, centre, base, EAST, 0, hp[base]);
  const right = join(w, centre, base, WEST, 0, hp[base]);
  const walls = [join(w, left, tek, SOUTH, 0, hp[tek]), join(w, centre, tek, SOUTH, 0, hp[tek]), join(w, right, metal, SOUTH, 0, hp[metal])];
  if (walls.some((ref) => ref < 0)) throw new Error("The preview walls need three free bays");
  return walls;
}

if (import.meta.main) {
  const server = startServer({
    dev: true, hostname: "127.0.0.1", port: Number(process.env.PORT ?? 18794), probeScene: true,
    config: loadConfigFolder(DEV_CONFIG, ["?AllowThirdPersonPlayer=False"]).rules,
    routes: (req, url) => {
      if (url.pathname === "/tek-wall.mp4") return serveFile(resolve(import.meta.dir, "../../planning/workstreams/art"), req);
      if (url.pathname !== "/wall" && url.pathname !== "/dusk") return null;
      const w = server.host.world;
      w.dayOffset = offsetForHour(w.tick, url.pathname === "/dusk" ? 18.75 : 15.5, w.clock);
      server.host.game.replication.markAllOwn();
      return Response.redirect(new URL("/play.html?quick&name=Builder", url).href);
    },
  });
  stageWalls(server.host.world);
  const { store } = server.host.loadouts;
  const kit: Loadout = {
    id: "field", label: "Wall preview", note: "The silencer leaves the impact visible.", respawn: true,
    entries: [
      { item: "core:pistol", count: 1, place: "hotbar", ammo: "core:round_pistol", attach: "core:silencer" },
      { item: "core:round_pistol", count: 60, place: "bag" },
    ],
  };
  const book = { ...store.book, loadouts: [...store.book.loadouts, kit], assign: { player: kit.id, admin: kit.id } };
  if (!store.save(book, store.book.revision, "preview", "Wall review").ok) throw new Error("The preview needs its field kit");
  console.log(`Tek wall in daylight or at dusk: http://127.0.0.1:${server.port}/wall or /dusk`);
}
