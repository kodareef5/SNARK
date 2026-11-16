// Isolated cruise preview; all earlier preview processes and saves remain independent.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Host } from "../../server/host.ts";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { buildClient } from "../build-client.ts";
import { CRUISE_COURSE, writeCruiseCourse } from "./course.ts";

/** An ordinary motorboat, persisted once under the independent map's stable authored origin. */
export function seedCruisePreview(host: Host): number {
  const origin = `${host.world.mapId}/cruise-utility-launch`;
  if ([...host.records.byPid.values()].some(rec => new TextDecoder().decode(rec.extra.get(VEHICLE_ORIGIN)) === origin)) return 0;
  const at = CRUISE_COURSE.utility, e = host.spawnVehicle("core:boat", at.x, at.z, 0, at.yaw, { origin, hull: 1, engine: 1, fuel: .85 });
  if (e < 0) throw new Error("Cruise tender berth is obstructed or too shallow");
  const rec = host.records.byPid.get(host.world.ents.pid[e]!)!;
  rec.name = "Cruise port utility launch"; host.records.dirty.add(rec.pid);
  host.world.ents.setLook(e, 1, rec.genome?.colors ?? null, rec.name);
  host.items.mint(rec, host.world.reg.index.get("core:gasoline")!, 20);
  return 1;
}

export async function startCruisePreview(map: string, args = process.argv.slice(2)): Promise<void> {
  const value = (key: string) => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const root = resolve(import.meta.dir, "../..");
  if (args.includes("--built")) {
    if (!existsSync(resolve(root, "client/dist/assets/manifest.json")) || !existsSync(resolve(root, "client/dist/main.js"))) throw new Error("No prepared client build. Run without --built first.");
  } else console.log(JSON.stringify(await buildClient({ quick: true })));
  const folder = value("--config") ?? DEV_CONFIG, { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const dbPath = resolve(value("--db") ?? resolve(root, "var/cruise-preview/world.db")); mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder), server = startServer({ dev: true, hostname: value("--host") ?? "127.0.0.1", port: Number(value("--port") ?? 8794), dbPath, config: rules, map: resolve(map), ...(live ? { live } : {}) });
  try { console.log(`Prepared ${seedCruisePreview(server.host)} cruise port utility launch.`); } catch (error) { server.stop(); throw error; }
  stopOnSignals(() => server.stop());
  console.log(`Cruise port: http://localhost:${server.port}\nIndependent save: ${dbPath}`);
  console.log("Walk down the terminal promenade to the ship's gangway. Koru and the utility launch occupy the adjacent berth.");
  console.log("W/A/S/D walk - Mouse look - Shift run - V first/third person - E interact.");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--map");
  await startCruisePreview(at >= 0 ? process.argv[at + 1]! : writeCruiseCourse());
}
