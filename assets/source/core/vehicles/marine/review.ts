// The vessels in the water as a player sees them, through the whole client (server seats, streamed packs, the sky and
// the sea) drawn by the software rasterizer: each from a dock 10 m off its quarter and from 100 m, at noon and under a
// low sun; from its helm; hurt at its last stage in the wear story its colours give it; destroyed over a bay its main
// deck's height deep, drawn as its sunk form where it settles; and its two wreck forms set there as a map sets them, the
// damaged one afloat and the sunk one on the bed. Nothing is written outside --out.
//
//   bun assets/source/core/vehicles/marine/review.ts --out DIR core:thunderbolt ... [--shots dock,low,far,helm,hurt,destroyed,wrecks] [--size 960x600]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../../../../client/core/app.ts";
import type { FramePacket } from "../../../../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { MARINE_MODELS } from "../../../../../content/vehicles/marine-fleet.ts";
import { hulkOf, waterlineOf } from "../../../../../content/vehicles/harbour-wrecks.ts";
import { formWaterlines } from "../../../../../tools/boat/wrecks.ts";
import { defaultLook } from "../../../../../shared/anim/look.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { MODE_SWIM } from "../../../../../shared/sim/character.ts";
import { F_GROUNDED } from "../../../../../shared/sim/entities.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic } from "../../../../../shared/world/mapfile.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { Harness } from "../../../../../tests/fixtures/net.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = value("out") ?? "";
const [W, H] = (value("size") ?? "960x600").split("x").map(Number) as [number, number];
const SHOTS = (value("shots") ?? "dock,low,far,helm,hurt,destroyed,wrecks").split(",");
const ids = args.filter((a, i) => a.startsWith("core:") && !["out", "size", "shots"].includes(args[i - 1]?.slice(2) ?? ""));
/** Where the vessel is moored, and where its wrecks lie: the bay's bed is `bay` metres down, the rest 9. */
const AT = { x: 160, z: 150 }, BAY = { x: 200, z: 210 };

function water(bay: number, reach: number): MapData {
  const hf = new Heightfield({ chunksX: 6, chunksZ: 6 }, 2, -32, 1 / 256), statics: MapStatic[] = [];
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) {
    const px = x * hf.cell, pz = z * hf.cell;
    // A dry quay along the south, open water, and a bay whose bed rises gently to its floor.
    const d = Math.hypot(px - BAY.x, pz - BAY.z);
    let y = pz < 60 ? 0.6 : pz < 70 ? 0.6 - (pz - 60) * 0.96 : -9;
    if (d < reach * 1.6) y = Math.max(y, -9 + (9 - bay) * Math.min(1, (reach * 1.6 - d) / (reach * 0.6)));
    hf.setSample(x, z, y);
    hf.tint[z * hf.nx + x] = y > -0.5 ? 4 : 1;
  }
  return { id: "preview:marine-review", dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: 0, heights: hf.heights, tint: hf.tint, statics, nodes: [], spawns: [{ name: "Quay", x: 160, z: 40, yaw: 0 }] };
}

/**
 * Plays one shot of vessel `id` through the whole client, handing `each` every frame the client makes and `last` the
 * frame to look at, with the world's ground.
 */
export function play(id: string, shot: string, pack: ReturnType<typeof parsePack>, files: GameFiles, width: number, height: number,
  each: (p: FramePacket, ground: Heightfield) => void, last: (p: FramePacket, ground: Heightfield) => void): void {
  const model = MARINE_MODELS.find((m) => m.id === id)!;
  const bay = Math.max(1.2, model.beltline * 0.9);
  const map = water(bay, Math.max(26, model.length * 1.5));
  if (shot === "wrecks") {
    // In a row, end to end, broadside to the camera to the north of them, as a city's harbours set them down
    // (tools/boat/wrecks.ts): the damaged one with its keel as deep as its waterline (forms.json), the sunk one on the bed.
    (map.statics as MapStatic[]).push({ kind: hulkOf(id, "damaged"), x: BAY.x - model.length * 0.65, y: -waterlineOf(model.draft, model.beltline, formWaterlines().get(id)), z: BAY.z, yaw: 16384 });
    (map.statics as MapStatic[]).push({ kind: hulkOf(id, "sunk"), x: BAY.x + model.length * 0.65, y: -bay, z: BAY.z, yaw: 16384 });
  }
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, h = new Harness({}, 211, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("reviewer", {}, { manual: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = "high"; app.ui.settings.steady = false;
  let packet: FramePacket | null = null, follow = () => {};
  const frame = (now: number) => {
    follow(); port.advance(now); packet = app.frame(now, width, height);
    if (packet && session.world) each(packet, session.world.hf);
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(600); session.text("enablecheats"); run(200);
    session.text(`settime ${shot === "low" ? "18:35" : "12:00"}`); run(200);
    const me = h.client(session)!, record = h.host.records.byPid.get(me.pid)!;
    const at = shot === "wrecks" ? { x: BAY.x - model.length * 2 - 30, z: BAY.z + model.length * 2 + 20 } : shot === "destroyed" ? BAY : AT;
    const e = h.host.spawnVehicle(id, at.x, at.z, record.team, 0, { fuel: 0.5 });
    if (e < 0) throw new Error(`${id}: could not be put in the water`);
    const ents = h.world.ents, vessel = h.host.records.byPid.get(ents.pid[e]!)!;
    if (shot === "helm") {
      ents.setPosition(me.ent, ents.x[e]! + model.boarding.water[0], -1.2, ents.z[e]! + model.boarding.water[2]);
      ents.mode[me.ent] = MODE_SWIM; ents.flags[me.ent] = ents.flags[me.ent]! & ~F_GROUNDED; me.ownDirty = true;
      if (h.host.urban.mount(me, e) !== 0) throw new Error(`${id}: the pilot could not board`);
      run(1600);
      if (app.view.thirdPerson) { app.key("KeyV", true); app.key("KeyV", false); }
    } else session.text("fly");
    run(400);
    // Hurt to its last stage, short of destroyed.
    const health = CORE_CONTENT.find((d) => d.id === id && d.type === "species") as { stats: { health: readonly number[] } };
    if (shot === "hurt") { h.host.survival.hurt(vessel, Math.round(health.stats.health[0]! * 0.82), 0); run(300); }
    // Destroyed over the bay: the client draws its wreck, the sunk form, as it floods and settles on the bed.
    if (shot === "destroyed") { h.host.survival.hurt(vessel, 1e6, 0); run(9000); }
    const wreck = shot === "destroyed" ? [...h.host.corpses.bodies.values()].find((b) => b.kind === vessel.kind)?.wreck : null;
    if (shot === "destroyed" && !wreck) throw new Error(`${id}: no wreck after it was destroyed`);
    const look = (eye: [number, number, number], target: [number, number, number]) => {
      follow = () => {
        ents.setPosition(me.ent, eye[0], eye[1] - 1.62, eye[2]); me.ownDirty = true;
        const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
        app.controls.yaw = Math.atan2(dx, dz); app.controls.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      };
    };
    const c = wreck ? [wreck.x, Math.max(0.3, wreck.y + model.height * 0.35), wreck.z] as [number, number, number] : [ents.x[e]!, model.height * 0.35, ents.z[e]!] as [number, number, number];
    const reach = Math.max(8, model.length * 0.45 + 3);
    if (shot === "dock" || shot === "low" || shot === "hurt" || shot === "destroyed") look([c[0] + reach * 0.62, 2.4, c[2] + reach * 0.78], c);
    if (shot === "far") look([c[0] + 62, 10, c[2] + 78], c);
    if (shot === "wrecks") look([BAY.x, 2.5 + model.height * 0.25, BAY.z + model.length * 1.25 + 6], [BAY.x, 0.6, BAY.z]);
    run(2500);
    if (!packet || !session.world) throw new Error(`${id} ${shot}: no frame`);
    last(packet, session.world.hf);
  } finally { h.host.shutdown(); }
}

/** A frame that only puts things on the card or takes them off: drawn by the rasterizer with nothing to draw. */
export const sends = (p: FramePacket): boolean => p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length > 0;

/** What the scenes show: the vessels and their wrecks, the sea, the sky and the ground; the rest is sent at 64 pixels. */
const SHOWN = /^core:(needle|thunderbolt|jon_boat|riptide|solstice|meridian|belvedere|sovereign|manta|lagoon|performance_marine|yacht|power_cats|sky|water|zz_world_surfaces)\b/;

/** The core pack, and the game's files split from it with its textures in the rgba variant. */
export async function gameOf(source?: string): Promise<{ pack: ReturnType<typeof parsePack>; files: GameFiles }> {
  const bytes = corePack(source), named = await namedTextures(source);
  return { pack: parsePack(bytes), files: splitWithTextures(bytes, (t) => {
    const texture = named.get(t.id);
    if (!texture) throw new Error(`no texture ${t.id}`);
    return rgbaOf(texture.material, t.role, SHOWN.test(t.id) ? t.top : Math.min(t.top, 64));
  }) };
}

if (import.meta.main) {
  const { pack, files } = await gameOf(value("source"));
  const boot = parsePack(files.files[0]!);
  for (const id of ids) {
    const dir = join(out, id.split(":")[1]!);
    mkdirSync(dir, { recursive: true });
    for (const shot of SHOTS) {
      let raster: Rasterizer | null = null;
      const file = join(dir, `${shot}.png`);
      play(id, shot, pack, files, W, H, (p, ground) => {
        raster ??= new Rasterizer(W, H, boot, ground, files.manifest);
        if (!sends(p)) return;
        const counts = [p.drawCount, p.tileCount, p.casterCount, p.cascadeCount] as const;
        p.drawCount = p.tileCount = p.casterCount = p.cascadeCount = 0;
        raster.render(p);
        [p.drawCount, p.tileCount, p.casterCount, p.cascadeCount] = counts;
      }, (p) => {
        raster!.render(p);
        writeFileSync(file, encodePng(W, H, raster!.color));
      });
      console.log(file);
    }
  }
}
