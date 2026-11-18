// Native browser preview with its own map and persistent save. The player starts on the dry launch shore.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BOAT_ART } from "../../content/vehicles/boat-art.ts";
import type { Host } from "../../server/host.ts";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { foundVehicle, VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { buildClient } from "../build-client.ts";
import { fleetMarina } from "./marina.ts";
import { BOAT_COURSE, writeBoatCourse } from "./course.ts";

/** Three persistent liveries; the ready utility hull carries ordinary service cargo and three real passengers. */
export function seedBoatPreview(host: Host): number {
  const { world, records } = host, ents = world.ents;
  const types = [["core:boat", "Utility launch"], ["core:boat_rescue", "Rescue launch"], ["core:boat_police", "Police launch"]] as const;
  let made = 0;
  for (const [index, [kind, name]] of types.entries()) {
    const origin = `${world.mapId}/preview-boat-${index}`;
    if ([...records.byPid.values()].some(rec => new TextDecoder().decode(rec.extra.get(VEHICLE_ORIGIN)) === origin)) continue;
    const berth = BOAT_COURSE.berths[index]!, placement = { id: `preview-boat-${index}`, kind, ...berth, yaw: 0, condition: [.6, .92] as const, fuel: [.3, .65] as const };
    const start = index === 0 ? { origin, hull: 1, engine: 1, fuel: .9 } : foundVehicle(world.mapId, placement, 411);
    const e = host.spawnVehicle(kind, berth.x, berth.z, 0, 0, start);
    if (e < 0) throw new Error(`Preview berth for ${kind} is not clear navigable water`);
    const rec = records.byPid.get(ents.pid[e]!)!; rec.name = name; records.dirty.add(rec.pid);
    ents.setLook(e, 1, rec.genome?.colors ?? null, name);
    if (index === 0) {
      for (const [item, count] of [["core:gasoline", 20], ["core:ingot", 160], ["core:polymer", 40], ["core:electronics", 32], ["core:boat_assembly", 1]] as const) host.items.mint(rec, world.reg.index.get(item)!, count);
      const def = world.reg.vehicle[rec.kind]!;
      for (const [i, seat] of def.seats.filter(s => !s.driver).entries()) {
        const actor = host.spawnCreature("core:civilian", BOAT_COURSE.spawn.x + i * 2, BOAT_COURSE.spawn.z, 1);
        if (actor < 0) throw new Error(`Preview passenger ${seat.id} could not be created`);
        const at = BOAT_ART.anchors.boarding_water;
        ents.setPosition(actor, berth.x + at[0], world.hf.waterAt(berth.x, berth.z) - 1.35, berth.z + at[2]);
        ents.mode[actor] = MODE_SWIM; ents.flags[actor] = ents.flags[actor]! & ~F_GROUNDED;
        if (host.urban.seatNpc(actor, e, seat.id) !== 0) throw new Error(`Preview passenger ${seat.id} could not board`);
        // The single stern ladder is a real shared approach. Commit each ordinary action before the next actor uses it.
        for (let tick = 0; tick < def.actionTicks + 20; tick++) host.game.tick();
      }
    }
    made++;
  }
  return made;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (key: string): string | undefined => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const root = resolve(import.meta.dir, "../..");
  if (args.includes("--built")) {
    if (!existsSync(resolve(root, "client/dist/assets/manifest.json")) || !existsSync(resolve(root, "client/dist/main.js"))) throw new Error("No prepared client build. Run without --built first.");
  } else console.log(JSON.stringify(await buildClient({ quick: true })));
  const folder = value("--config") ?? DEV_CONFIG, { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const fleet = args.includes("--fleet"), preview = resolve(root, fleet ? "var/marine-fleet" : "var/boat-preview");
  const dbPath = resolve(value("--db") ?? resolve(preview, "world.db")); mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder), map = value("--map") ? resolve(value("--map")!) : writeBoatCourse(resolve(preview, "course.snmp"), fleet ? fleetMarina() : undefined);
  const server = startServer({ dev: true, hostname: value("--host") ?? "127.0.0.1", port: Number(value("--port") ?? (fleet ? 8792 : 8791)), dbPath, config: rules, map, ...(live ? { live } : {}) });
  if (!fleet) {
    try { console.log(`Prepared ${seedBoatPreview(server.host)} boat previews.`); } catch (error) { server.stop(); throw error; }
  }
  stopOnSignals(() => server.stop());
  console.log(`Boat preview: http://localhost:${server.port}\nIsolated save: ${dbPath}`);
  console.log("W/S ahead/astern · A/D helm · Space neutral · hold Shift precise throttle · V helm/chase · E ladder/seats · F cargo/service/recovery");
}
