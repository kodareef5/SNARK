// The real client/server in a separate local save. Each joining team receives the registered original dinosaurs once.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import type { Host } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { ART } from "../art/source.ts";
import { buildClientApart } from "../build-client.ts";
import { DINOSAUR_COURSE, writeDinosaurCourse } from "./course.ts";

const REVIEW_SPECIES = ["core:trike", "core:stego", "core:raptor"];

const SINGLE_REVIEW: Record<string, { distance: number; yaw: number } | undefined> = {
  "core:pteranodon": {distance: 6, yaw: 43500},
  "core:spino": {distance: 14, yaw: 48500},
};

export async function buildDinosaurReviewClient(options: Parameters<typeof buildClientApart>[0]): Promise<void> {
  if (!ART) throw new Error("Building the dinosaur review requires assets/source. Use --built with a prepared full-art client.");
  await buildClientApart(options);
}

/** Check the prepared client, including when it was built on a different machine. */
export function requireDinosaurReviewArt(dist: string, species: readonly string[] = REVIEW_SPECIES): void {
  const assets = resolve(dist, "assets");
  const manifest = parseManifest(readFileSync(resolve(assets, "manifest.json"), "utf8"));
  const boot = parsePack(readFileSync(resolve(assets, manifest.files[manifest.boot]!.name)));
  for (const def of CORE_CONTENT) {
    if (def.type !== "species" || !species.includes(def.id)) continue;
    const body = manifest.meshes.find(mesh => mesh.id === def.mesh);
    const rig = body?.rig === undefined ? undefined : boot.header.rigs[body.rig];
    const saddle = CORE_CONTENT.find(item => item.type === "item" && item.saddle?.fits === def.id);
    const worn = saddle && manifest.meshes.find(mesh => mesh.id === `${saddle.id}/worn`);
    if (!rig?.names?.length || rig.id !== def.mesh || body?.skeleton !== rig.skeleton || !rig.sockets?.some(socket => socket.name === "seat")) {
      throw new Error(`Dinosaur review requires the ${def.id} body, rig and seat. Rebuild the client from assets/source or use a prepared full-art build.`);
    }
    // The raptor saddle uses its seat socket. Only the two fitted saddles have worn meshes.
    if (def.id !== "core:raptor" && (!worn || worn.rig !== body.rig)) {
      throw new Error(`Dinosaur review requires the fitted saddle for ${def.id}.`);
    }
  }
}

/** Normal creature, tame, saddle and inventory paths; existing owned creatures survive reconnects without duplication. */
export function seedDinosaurPreview(host: Host, owner: EntityRecord, species: readonly string[] = REVIEW_SPECIES): number {
  if (!host.dev || !owner.team) throw new Error("Dinosaur review seeding requires a local development host and a real survivor team");
  const { world, records } = host, reg = world.reg;
  let made = 0;
  for (let index = 0; index < species.length; index++) {
    const id = species[index]!, kind = reg.index.get(id);
    if (kind === undefined) continue; // Each independent species branch can use the same course.
    let owned = false;
    for (const rec of records.byPid.values()) if (rec.kind === kind && rec.team === owner.team && !rec.dead && rec.corpse === null) { owned = true; break; }
    if (owned) continue;
    const single = SINGLE_REVIEW[id];
    const pad = single ? {x: DINOSAUR_COURSE.spawn.x, z: DINOSAUR_COURSE.spawn.z + single.distance} : DINOSAUR_COURSE.pads[index % DINOSAUR_COURSE.pads.length]!;
    let e = -1;
    for (const offset of [0, 24, 48]) { e = host.spawnCreature(id, pad.x, pad.z + offset, 40, "admin"); if (e >= 0) break; }
    if (e < 0) throw new Error(`No clear review pad for ${id}`);
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    if (!host.taming.give(rec, owner, 0, "forced")) throw new Error(`Preview tame refused for ${id}`);
    rec.name = `${id === "core:trike" ? "Trike" : id === "core:stego" ? "Stego" : id.slice(id.indexOf(":") + 1)} review`;
    rec.yaw = single?.yaw ?? 0; world.ents.yaw[e] = rec.yaw;
    if (single) host.creatures.mind.look[e] = rec.yaw;
    const saddle = reg.saddleFits.indexOf(kind);
    if (saddle > 0) rec.saddle = saddle; // Same out-of-ledger worn gear path as gmsummon.
    const food = reg.eats[kind]?.[0];
    if (food !== undefined) host.items.mint(rec, food, 100);
    records.dirty.add(rec.pid); host.refreshBody(rec); made++;
  }
  return made;
}

export function installDinosaurPreview(host: Host, species: readonly string[] = REVIEW_SPECIES): void {
  if (!host.dev) throw new Error("Dinosaur review is development-only");
  if (!species.some(id => host.world.reg.index.has(id))) throw new Error("No requested dinosaur is registered in this branch");
  const previous = host.game.onBody;
  host.game.onBody = client => {
    previous?.(client);
    const owner = host.records.byPid.get(client.pid);
    if (owner) seedDinosaurPreview(host, owner, species);
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (key: string): string | undefined => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const root = resolve(import.meta.dir, "../..");
  const dist = resolve(value("--dist") ?? resolve(root, "client/dist"));
  if (args.includes("--built")) {
    if (!existsSync(resolve(dist, "assets/manifest.json")) || !existsSync(resolve(dist, "main.js"))) throw new Error("No prepared client build. Run without --built first.");
  } else await buildDinosaurReviewClient({ quick: true, dist });
  const species = args.includes("--spino") ? ["core:spino"] : args.includes("--pteranodon") ? ["core:pteranodon"] : REVIEW_SPECIES;
  requireDinosaurReviewArt(dist, species);
  const folder = value("--config") ?? DEV_CONFIG, { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const dbPath = resolve(value("--db") ?? resolve(root, "var/dinosaur-preview/world.db")); mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder), map = value("--map") ? resolve(value("--map")!) : writeDinosaurCourse(resolve(root, "var/dinosaur-preview/course.snmp"));
  const server = startServer({ dev: true, clientDir: dist, hostname: value("--host") ?? "127.0.0.1", port: Number(value("--port") ?? 8796), dbPath, config: rules, map, ...(live ? { live } : {}) });
  installDinosaurPreview(server.host, species);
  stopOnSignals(() => server.stop());
  console.log(`Dinosaur preview: http://localhost:${server.port}\nIsolated save: ${dbPath}`);
  if (args.includes("--pteranodon")) console.log("E mount/dismount · W/A/S/D travel · Space take off");
  else if (args.includes("--spino")) console.log("E mount/dismount · W/A/S/D travel · Shift sprint · primary bite");
  else console.log("E mount/dismount · W/A/S/D travel · Shift run · mouse buttons abilities · R plate mode · F inventory");
}
