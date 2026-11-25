// Run after building the Tek art and client: bun tools/pieces/tek-preview.ts
import { resolve } from "node:path";
import { stageTekSamples } from "./tek-samples.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import type { Host } from "../../server/host.ts";
import { serveFile } from "../../server/files.ts";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import type { Loadout } from "../../shared/loadout/book.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { EAST, SOUTH, WEST, join, set, start, type Built } from "../../tests/fixtures/slots.ts";

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

/** A pitched laboratory, two-storey service bay and outside stair share one rotated lattice. */
export function stageOutpost(w: Built, team: number): number[] {
  const foundation = w.reg.index.get("core:foundation_tek")!;
  const first = start(w, foundation, PROVING_SPAWN.x + 1.5, .03, PROVING_SPAWN.z + 14, 3900, team, w.reg.maxHp[foundation]);
  const frame = w.structs.frameAt(first);
  const placed = [first];
  const put = (name: string, i: number, j: number, level = 0, facing = 0): void => {
    const kind = w.reg.index.get(`core:${name}_tek`)!;
    const ref = set(w, frame, kind, i, j, level, facing, w.reg.maxHp[kind]);
    if (ref < 0) throw new Error(`No preview slot for ${name} at ${i}, ${j}, ${level}`);
    placed.push(ref);
  };
  for (const i of [-5, -3, -1, 1, 3, 5]) for (const j of [1, 3]) {
    if (i !== 1 || j !== 1) put("foundation", i, j);
  }
  for (const i of [-1, 1, 3]) {
    put(i === 1 ? "doorframe" : i === -1 ? "wall" : "windowframe", i, 0, 0, 6);
    put("wall", i, 4);
    put("roof", i, 1, 4);
    put("roof", i, 3, 4, 6);
  }
  put("door", 1, 0, 0, 6);
  for (const j of [1, 3]) for (const i of [-2, 4]) {
    put(i === 4 && j === 3 ? "windowframe" : "wall", i, j, 0, 3);
    if (i === 4) put(j === 1 ? "sloped_wall_right" : "sloped_wall_left", i, j, 4, 3);
  }
  for (const i of [-5, -3]) for (const j of [1, 3]) {
    put("ceiling", i, j, 8);
    if (j === 3) for (const level of [0, 4]) put("wall", i, 4, level);
  }
  put("gateway", -5, 0, 0, 6);
  put("gate", -5, 0, 0, 6);
  for (const j of [1, 3]) {
    for (const level of [0, 4]) put(level === 4 ? "windowframe" : "wall", -6, j, level, 3);
    put("wall", -2, j, 4, 3);
  }
  put("foundation", 1, -1);
  put("foundation", 3, -1);
  put("railing", 4, -1, 0, 3);
  put("stairs", 5, 1);
  put("pillar", 5, 3);
  put("ceiling", 5, 3, 4);
  put("railing", 6, 3, 4, 3);
  put("railing", 5, 4, 4);
  return placed;
}

export function outpostCrew(host: () => Host): ModuleDef {
  let founder = 0;
  return {
    name: "tek_preview", api: 1,
    setup(m) {
      m.on("session.join", event => {
        const preview = host();
        const { records, tribes, world } = preview;
        const rec = records.byPid.get(Number(event.data.pid));
        if (!rec) return;
        if (founder === 0) {
          if (tribes.create(rec, "Outpost crew")) throw new Error("The preview needs a building crew");
          const placed = stageOutpost(world, rec.team);
          stageTekSamples(preview, placed[0]!, rec.team);
          founder = rec.pid;
        } else {
          const owner = records.byPid.get(founder)!;
          if (rec.team !== owner.team && !tribes.invite(owner, rec, true)) tribes.accept(rec);
        }
      });
    },
  };
}

if (import.meta.main) {
  const outpost = process.argv.includes("--outpost");
  const server = startServer({
    dev: true, hostname: "127.0.0.1", port: Number(process.env.PORT ?? (outpost ? 18795 : 18794)), probeScene: !outpost,
    clientDir: process.env.TEK_PREVIEW_DIST,
    modules: outpost ? [outpostCrew(() => server.host)] : undefined,
    config: loadConfigFolder(DEV_CONFIG, ["?AllowThirdPersonPlayer=False", ...(outpost ? ["?DinoCountMultiplier=0", "?bDisableLootCrates=True"] : [])]).rules,
    routes: (req, url) => {
      if (url.pathname === "/tek-wall.mp4") return serveFile(resolve(import.meta.dir, "../../planning/workstreams/art"), req);
      const day = outpost ? "/outpost" : "/wall", dusk = outpost ? "/outpost-dusk" : "/dusk";
      if (url.pathname !== day && url.pathname !== dusk) return null;
      const w = server.host.world;
      w.dayOffset = offsetForHour(w.tick, url.pathname === dusk ? 18.75 : 15.5, w.clock);
      server.host.game.replication.markAllOwn();
      return Response.redirect(new URL("/play.html?quick&name=Builder", url).href);
    },
  });
  if (!outpost) stageWalls(server.host.world);
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
  console.log(`Tek preview at http://127.0.0.1:${server.port}/${outpost ? "outpost or /outpost-dusk" : "wall or /dusk"}`);
}
