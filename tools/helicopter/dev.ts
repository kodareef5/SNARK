// The real game and native asset pack in an isolated preview save. No remote state or production save is touched.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { foundVehicle, VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import type { Host } from "../../server/host.ts";
import { buildClient } from "../build-client.ts";

/** Ready utility aircraft, worn rescue and police examples, and real seated crew. Persisted once per isolated save. */
export function seedHelicopterPreview(host: Host): number {
  const { world, records } = host, spawn = world.spawn;
  const types = [["core:helicopter", "Utility demonstrator", -18], ["core:helicopter_rescue", "Rescue aircraft", 0], ["core:helicopter_police", "Police aircraft", 18]] as const;
  let made = 0;
  for (const [index, [kind, label, offset]] of types.entries()) {
    const id = `preview-helicopter-${index}`, origin = `${world.mapId}/${id}`;
    if ([...records.byPid.values()].some(rec => new TextDecoder().decode(rec.extra.get(VEHICLE_ORIGIN)) === origin)) continue;
    let entity = -1;
    for (const dz of [-18, -36, 18, 36]) {
      const placement = { id, kind, x: spawn.x + offset, z: spawn.z + dz, yaw: 0, condition: [.48, .9] as const, fuel: [.2, .65] as const };
      const start = index === 0 ? { origin, hull: 1, engine: 1, rotor: 1, fuel: .9 } : foundVehicle(world.mapId, placement, 411);
      entity = host.spawnVehicle(kind, placement.x, placement.z, 0, 0, start);
      if (entity >= 0) break;
    }
    if (entity < 0) throw new Error(`No clear supported preview location for ${kind}; choose a larger landing area.`);
    const record = records.byPid.get(world.ents.pid[entity]!)!;
    record.name = label; records.dirty.add(record.pid); world.ents.setLook(entity, 1, record.genome?.colors ?? null, label);
    if (index === 0) {
      // Cargo can be moved into the player's inventory with the ordinary inventory UI to try servicing and deployment.
      for (const [id, count] of [["core:gasoline", 20], ["core:ingot", 160], ["core:polymer", 40], ["core:electronics", 32], ["core:helicopter_assembly", 1]] as const) host.items.mint(record, world.reg.index.get(id)!, count);
      const def = world.reg.vehicle[record.kind]!;
      for (const seat of def.seats.filter(s => !s.driver)) {
        const actor = host.spawnCreature("core:civilian", world.ents.x[entity]! + seat.entry[0], world.ents.z[entity]! + seat.entry[2], 1);
        if (actor < 0 || host.urban.seatNpc(actor, entity, seat.id) !== 0) throw new Error(`Could not seat preview passenger ${seat.id}`);
      }
    }
    made++;
  }
  return made;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (key: string): string | undefined => { const at = args.indexOf(key); return at >= 0 ? args[at + 1] : undefined; };
  const root = resolve(import.meta.dir, "../..");
  if (args.includes("--built")) {
    if (!existsSync(resolve(root, "client/dist/assets/manifest.json")) || !existsSync(resolve(root, "client/dist/main.js"))) throw new Error("No prepared client build. Run without --built first.");
  } else console.log(JSON.stringify(await buildClient({ quick: true })));
  const folder = value("--config") ?? DEV_CONFIG, { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const dbPath = resolve(value("--db") ?? resolve(root, "var/helicopter-preview/world.db")); mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder), map = value("--map");
  const server = startServer({ dev: true, hostname: value("--host") ?? "127.0.0.1", port: Number(value("--port") ?? 8790), dbPath, config: rules, ...(live ? { live } : {}), ...(map ? { map: resolve(map) } : {}) });
  try { console.log(`Prepared ${seedHelicopterPreview(server.host)} helicopter previews.`); } catch (error) { server.stop(); throw error; }
  stopOnSignals(() => server.stop());
  console.log(`Helicopter preview: http://localhost:${server.port}`);
  console.log(`Isolated save: ${dbPath}`);
  console.log("W/S cyclic · A/D bank · Q/R yaw · Space/Ctrl collective · C assisted/direct · hold X recover · V cockpit/chase · E seats · F cargo/service");
}
