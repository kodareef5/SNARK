// An isolated local game with a saddled pair per survivor team. All riding and animation go through the ordinary host.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serveFile } from "../../server/files.ts";
import type { Host } from "../../server/host.ts";
import { startServer } from "../../server/main.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { buildClientApart } from "../build-client.ts";

const animals = [
  { id: "core:raptor", x: 116, z: 103, yaw: 49152, food: "core:meat" },
  { id: "core:parasaur", x: 127, z: 107, yaw: 49152, food: "core:berry" },
] as const;

export function paddock(): MapData {
  const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const x = i * hf.cell, z = j * hf.cell;
    const pool = Math.min(1, Math.max(0, (x - 170) / 30));
    const hill = Math.max(0, 1 - Math.hypot((x - 90) / 52, (z - 185) / 40));
    hf.setSample(i, j, 1 - pool * 6 + hill * hill * 9);
    hf.tint[j * hf.nx + i] = pool > 0.2 ? 4 : 17;
  }
  return {
    id: "preview:raptor-parasaur", dims: hf.dims, minY: hf.minY, stepY: hf.stepY,
    heights: hf.heights, tint: hf.tint, seaLevel: 0, statics: [], nodes: [],
    spawns: [{ name: "Paddock", x: 120, z: 95, yaw: 0 }],
  };
}

function welcome(host: Host): void {
  const { world, records } = host;
  const previous = host.game.onBody;
  host.game.onBody = client => {
    previous?.(client);
    const owner = records.byPid.get(client.pid);
    if (!owner?.team) return;
    for (const animal of animals) {
      const kind = world.reg.index.get(animal.id)!;
      const def = world.reg.defs[kind];
      const living = [...records.byPid.values()].filter(r => !r.dead && !r.corpse && world.reg.defs[r.kind]?.type === "species");
      if (living.some(r => r.team === owner.team && r.kind === kind)) continue;
      for (const row of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const z = animal.z + 18 * row;
        const free = living.every(r => {
          const e = records.entOf.get(r.pid);
          const x0 = e === undefined ? r.x : world.ents.x[e]!;
          const z0 = e === undefined ? r.z : world.ents.z[e]!;
          return Math.hypot(x0 - animal.x, z0 - z) > 7;
        });
        if (!free) continue;
        const e = host.spawnCreature(animal.id, animal.x, z, 40, "admin");
        if (e < 0) continue;
        const rec = records.byPid.get(world.ents.pid[e]!)!;
        if (!host.taming.give(rec, owner, 0, "forced")) throw Error(`Could not give ${animal.id} to the review team`);
        rec.yaw = world.ents.yaw[e] = host.creatures.mind.look[e] = animal.yaw;
        rec.saddle = world.reg.saddleFits.indexOf(kind);
        if (def?.type === "species" && rec.genome) {
          for (const [slot, region] of (def.regions ?? []).entries()) {
            if (region) rec.genome.colors[slot] = region.colors[0]![0];
          }
          world.ents.setLook(e, rec.genome.level, rec.genome.colors, rec.name);
        }
        host.items.mint(rec, world.reg.index.get(animal.food)!, 120);
        records.dirty.add(rec.pid);
        host.refreshBody(rec);
        break;
      }
    }
  };
}

if (import.meta.main) {
  const folder = resolve(import.meta.dir, "../../var/raptor-parasaur");
  const dist = resolve(folder, "client");
  mkdirSync(folder, { recursive: true });
  if (!process.argv.includes("--built")) await buildClientApart({ quick: true, dist });
  const manifest = parseManifest(readFileSync(resolve(dist, "assets/manifest.json"), "utf8"));
  for (const { id } of animals) {
    const body = manifest.meshes.find(m => m.id === id);
    if (body?.rig === undefined) throw Error(`Rebuild the review client with the ${id} body rig.`);
    if (id === "core:parasaur") {
      const saddle = manifest.meshes.find(m => m.id === "core:saddle_parasaur/worn");
      if (saddle?.rig !== body.rig) throw Error("Rebuild the review client with the fitted Parasaur saddle.");
    }
  }
  const map = resolve(folder, "paddock.snmp");
  writeFileSync(map, writeMap(paddock()));
  const evidence = resolve(import.meta.dir, "../../planning/evidence/raptor-parasaur");
  const server = startServer({
    hostname: "127.0.0.1", port: Number(process.env.PORT ?? 8797), dev: true,
    clientDir: dist, map, dbPath: resolve(folder, "review.db"),
    routes: (req, url) => url.pathname === "/review.png" ? serveFile(evidence, req, "/playing-distance.png") : null,
  });
  const world = server.host.world;
  world.dayOffset = offsetForHour(world.tick, 15, world.clock);
  welcome(server.host);
  stopOnSignals(() => server.stop());
  console.log(`Raptor and Parasaur paddock at http://127.0.0.1:${server.port}/  ·  E mount/dismount  ·  Shift sprint  ·  F inventory`);
}
