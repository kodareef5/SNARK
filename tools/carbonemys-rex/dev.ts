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

const REVIEW_SPECIES = ["core:carbonemys", "core:rex"];

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
    // Rex v2 has no saddle yet (planning/workstreams/rex2.md); every other species must bring its fitted saddle.
    const saddled = !saddle || (worn && worn.rig === body?.rig);
    if (!rig?.names?.length || rig.id !== def.mesh || body?.skeleton !== rig.skeleton || !saddled) {
      throw new Error(`Dinosaur review requires the original ${def.id} body, rig and fitted saddle. Rebuild the client from assets/source or use a prepared full-art build.`);
    }
  }
}

/** Reserve room for the visible head and tail as well as the locomotion capsule. */
function placePreviewCreature(host: Host, id: string, kind: number, pad: { x: number; z: number }, frontRow = false): number {
  const { world, records } = host;
  const reach = world.anims[kind]?.rig.reach ?? world.reg.bodyRadius[kind]!;
  // Try the team nearest the entrance first, then rows along the open ground. Occupants may have been ridden away.
  const neighbours = [];
  for (const other of records.byPid.values()) {
    if (other.dead || other.corpse || world.reg.defs[other.kind]?.type !== "species") continue;
    const ent = records.entOf.get(other.pid);
    neighbours.push({
      x: ent === undefined ? other.x : world.ents.x[ent]!,
      z: ent === undefined ? other.z : world.ents.z[ent]!,
      reach: reach + (world.anims[other.kind]?.rig.reach ?? world.reg.bodyRadius[other.kind]!),
    });
  }
  const offsets = frontRow
    ? [0, 6, 12, 24, 48].flatMap(dz => [0, -6, 6, -12, 12, -24, 24, -36, 36].map(dx => [dx, dz] as const))
    : [0, -36, 36, -72, 72, -108].flatMap(dx => [0, 24, -24, 48, -48, 72, -72, 96, -96].map(dz => [dx, dz] as const));
  for (const [dx, dz] of offsets) {
    const x = pad.x + dx, z = pad.z + dz;
    if (world.hf.heightAt(x, z) <= world.hf.waterAt(x, z)) continue;
    if (neighbours.some(other => Math.hypot(x - other.x, z - other.z) < other.reach)) continue;
    const e = host.spawnCreature(id, x, z, 40, "admin");
    if (e >= 0) return e;
  }
  return -1;
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
    const rex = id === "core:rex" || id === "core:rex2";
    const frontRow = rex && species.every(s => s === "core:rex" || s === "core:rex2");
    const pad = frontRow
      ? { x: DINOSAUR_COURSE.spawn.x, z: DINOSAUR_COURSE.spawn.z + 13, yaw: 45056 }
      : DINOSAUR_COURSE.pads[index % DINOSAUR_COURSE.pads.length]!;
    const e = placePreviewCreature(host, id, kind, pad, frontRow);
    if (e < 0) continue;
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    if (!host.taming.give(rec, owner, 0, "forced")) throw new Error(`Preview tame refused for ${id}`);
    rec.name = `${id === "core:rex2" ? "T. rex v2" : rex ? "T. rex" : "Carbonemys"} review`;
    rec.yaw = world.ents.yaw[e] = host.creatures.mind.look[e] = pad.yaw;
    const saddle = reg.saddleFits.indexOf(kind);
    if (saddle > 0) rec.saddle = saddle; // Same out-of-ledger worn gear path as gmsummon.
    host.items.mint(rec, reg.index.get(rex ? "core:meat" : "core:berry")!, 100);
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
  // --rex2 puts Rex v2 beside the Rex while it is built.
  const species = args.includes("--rex2") ? ["core:rex", "core:rex2"] : args.includes("--rex-only") ? ["core:rex"] : REVIEW_SPECIES;
  requireDinosaurReviewArt(dist, species);
  const folder = value("--config") ?? DEV_CONFIG, { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const dbPath = resolve(value("--db") ?? resolve(root, "var/carbonemys-rex/world.db")); mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder), map = value("--map") ? resolve(value("--map")!) : writeDinosaurCourse(resolve(root, "var/carbonemys-rex/course.snmp"));
  const server = startServer({ dev: true, clientDir: dist, hostname: value("--host") ?? "127.0.0.1", port: Number(value("--port") ?? 8796), dbPath, config: rules, map, ...(live ? { live } : {}) });
  installDinosaurPreview(server.host, species);
  stopOnSignals(() => server.stop());
  console.log(`Dinosaur preview: http://localhost:${server.port}\nIsolated save: ${dbPath}`);
  console.log("E mount/dismount · W/A/S/D travel · Shift run · LMB bite · Rex RMB roar · aim down to dive with Carbonemys · F inventory");
}
