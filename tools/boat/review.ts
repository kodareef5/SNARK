// Real server seating/replication, native App cameras, streamed boat packs and software-rendered review artifacts.
// bun tools/boat/review.ts --source assets/source --out var/boat-preview/review
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import { DETAIL, DETAIL_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { BOAT_ART } from "../../content/vehicles/boat-art.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { quatUnrotate } from "../../shared/math/quat.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dress } from "../../server/commands/combat.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { SOURCE } from "../art/source.ts";
import { BOAT_COURSE, boatCourse } from "./course.ts";

type Moment = "exterior" | "helm" | "chase" | "moving" | "capsize" | "damage" | "wreck" | "distant";
interface Shot { name: string; kind: string; moment: Moment; tier: "high" | "lowpoly"; lookPitch?: number; portrait?: boolean }
const SHOTS: readonly Shot[] = [
  { name: "01-civilian-occupied", kind: "core:boat", moment: "exterior", tier: "high" },
  { name: "02-rescue-occupied", kind: "core:boat_rescue", moment: "exterior", tier: "high" },
  { name: "03-police-occupied", kind: "core:boat_police", moment: "exterior", tier: "high" },
  { name: "04-pilot-helm", kind: "core:boat", moment: "helm", tier: "high" },
  { name: "04a-pilot-controls", kind: "core:boat", moment: "helm", tier: "high", lookPitch: -.35 },
  { name: "05-moving-wake", kind: "core:boat", moment: "moving", tier: "high" },
  { name: "06-capsize", kind: "core:boat", moment: "capsize", tier: "high" },
  { name: "07-worn-rescue", kind: "core:boat_rescue", moment: "damage", tier: "high" },
  { name: "08-sunken-salvage", kind: "core:boat", moment: "wreck", tier: "high" },
  { name: "09-distant-flat", kind: "core:boat_police", moment: "distant", tier: "lowpoly" },
  { name: "10-portrait-helm", kind: "core:boat", moment: "helm", tier: "high", portrait: true },
  { name: "11-native-chase", kind: "core:boat", moment: "chase", tier: "high" },
  { name: "12-flat-occupied", kind: "core:boat", moment: "exterior", tier: "lowpoly" },
];

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0; raster.render(packet);
  [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

function capture(shot: Shot, pack: Pack, files: GameFiles, width: number, height: number, out: string) {
  const built = compileContent(CORE_CONTENT); if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, h = new Harness({}, 197, 60, { dev: true, map: writeMap(boatCourse()), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("reviewer", {}, { manual: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = shot.tier; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null, follow = () => {};
  const frame = (now: number) => {
    follow(); port.advance(now); packet = app.frame(now, width, height);
    if (packet && session.world) { raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest); uploadOnly(raster, packet); }
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(600); session.text("enablecheats"); run(250);
    const me = h.client(session)!, record = h.host.records.byPid.get(me.pid)!, at = BOAT_COURSE.review;
    const e = h.host.spawnVehicle(shot.kind, at.x, at.z, record.team, 0, { fuel: .9 });
    if (e < 0) throw new Error(`${shot.name}: boat could not be placed in native water`);
    const ents = h.world.ents, vessel = h.host.records.byPid.get(ents.pid[e]!)!, def = reg.vehicle[vessel.kind]!;
    if (def.movement !== "boat") throw new Error(`${shot.kind}: review requires a boat definition`);
    const nativeView = shot.moment === "helm" || shot.moment === "chase", helm = shot.moment === "helm";
    const pilotSession = nativeView ? session : h.join("pilot"); run(500);
    const pilot = h.client(pilotSession)!, pilotRecord = h.host.records.byPid.get(pilot.pid)!; pilotRecord.team = record.team;
    const enter = (actor: number) => {
      const ladder = BOAT_ART.anchors.boarding_water;
      ents.setPosition(actor, ents.x[e]! + ladder[0], -.75 * reg.move[ents.kind[actor]!]!.height, ents.z[e]! + ladder[2]);
      ents.mode[actor] = MODE_SWIM; ents.flags[actor] = ents.flags[actor]! & ~F_GROUNDED;
    };
    enter(pilot.ent); pilot.ownDirty = true;
    if (h.host.urban.mount(pilot, e) !== 0) throw new Error(`${shot.name}: pilot could not use the ladder`);
    run(1400); const crew = [pilot.ent];
    for (const [index, seat] of def.seats.filter(s => !s.driver).entries()) {
      const actor = h.host.spawnCreature("core:civilian", BOAT_COURSE.spawn.x + index * 2, BOAT_COURSE.spawn.z, 1);
      if (actor < 0) throw new Error(`${shot.name}: passenger spawn failed`);
      const rec = h.host.records.byPid.get(ents.pid[actor]!)!; rec.team = record.team;
      if (index === 1) for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) dress(h.host, rec, reg.index.get(`core:flak_${part}`)!);
      enter(actor);
      if (h.host.urban.seatNpc(actor, e, seat.id) !== 0) throw new Error(`${shot.name}: passenger ${seat.id} could not board`);
      crew.push(actor); run(1400);
    }
    if (crew.some(actor => ents.seat[actor] !== e + 1)) throw new Error(`${shot.name}: native seat transaction did not commit`);
    const observerCorrections = session.stats.corrections, pilotCorrections = pilotSession.stats.corrections;
    if (nativeView) {
      if (app.view.thirdPerson === helm) { app.key("KeyV", true); app.key("KeyV", false); }
      if (shot.lookPitch) app.look(0, -shot.lookPitch / LOOK_SPEED);
    } else { session.text("fly"); run(100); }
    const centre = new Float64Array(3);
    const focus = () => {
      const wreck = shot.moment === "wreck" ? [...h.host.corpses.bodies.values()].find(b => b.kind === vessel.kind) : null;
      const pose = wreck?.wreck ?? { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[e]!, pitch: 0, roll: 0,
        qx: ents.vehicleQx[e]!, qy: ents.vehicleQy[e]!, qz: ents.vehicleQz[e]!, qw: ents.vehicleQw[e]! };
      vehiclePoint(pose, [0, .9, -.3], centre); return { x: centre[0]!, y: centre[1]!, z: centre[2]!, wreck };
    };
    follow = () => {
      if (nativeView) return;
      const target = focus(), far = shot.moment === "distant" ? 85 : shot.moment === "wreck" ? 9 : 7.5;
      const dx = far * .65, dz = far * (shot.moment === "moving" || shot.moment === "damage" ? -.76 : .76), eye = target.y + (shot.moment === "wreck" ? 1.2 : 2.3);
      ents.setPosition(me.ent, target.x + dx, eye - 1.62, target.z + dz); me.ownDirty = true;
      app.controls.yaw = Math.atan2(-dx, -dz); app.controls.pitch = Math.atan2(target.y - eye, far);
    };
    run(1500);
    const controls = h.pilots[h.sessions.indexOf(pilotSession)]!;
    if (shot.moment === "moving") { controls.moveZ = 127; run(5200); controls.moveX = -35; run(800); }
    if (shot.moment === "damage") {
      h.host.survival.hurt(vessel, 700, 0); run(100);
      ents.vehicleEngineCondition[e] = .4; h.host.urban.changed(e); controls.moveZ = 20; run(1200);
    }
    if (shot.moment === "capsize" || shot.moment === "wreck") {
      ents.setPosition(e, at.x, .65, at.z); ents.vehicleQx[e] = 1; ents.vehicleQy[e] = ents.vehicleQz[e] = ents.vehicleQw[e] = 0;
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0; ents.vehicleFlooding[e] = shot.moment === "wreck" ? 1 : 0;
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
      h.host.urban.changed(e); pilot.ownDirty = true;
      if (shot.moment === "wreck") { h.host.survival.hurt(vessel, 1e6, 0); run(4500); }
    }
    run(400);
    const draw = () => {
      const p = packet; if (!p || !raster) throw new Error(`${shot.name}: native App produced no frame`);
      let helmEye: number[] | undefined;
      if (helm) {
        if (app.view.thirdPerson) throw new Error(`${shot.name}: capture is still in chase view`);
        const own = session.own, local = new Float64Array(3);
        quatUnrotate([own.vehicleQx, own.vehicleQy, own.vehicleQz, own.vehicleQw], 0, p.camX - own.x, p.camY - own.y, p.camZ - own.z, local, 0);
        helmEye = [...local];
        if (helmEye.some((v, i) => v < BOAT_ART.interior.min[i]! || v > BOAT_ART.interior.max[i]!)) throw new Error(`${shot.name}: helm camera outside measured interior: ${helmEye.join(", ")}`);
      }
      raster.render(p); const scenePixels = raster.color.slice(); drawUi(raster.color, width, height, app.ui.frame);
      const particles = { wake: 0, spray: 0, smoke: 0, invalidWater: 0 }, rendered = { wake: 0, spray: 0, smoke: 0 }, pool = app.scene!.details.pool;
      for (let i = 0; i < pool.count; i++) {
        const id = pack.header.details?.effects[pool.effect[i]!]!.id ?? "";
        if (!id.startsWith("core:boat")) continue;
        const kind = id.endsWith("/wake_foam") ? "wake" : id.endsWith("/bow_spray") ? "spray" : id.endsWith("/engine_smoke") ? "smoke" : null;
        if (kind) {
          particles[kind]++;
          // Match the actual submitted card by its centre and atlas cell, including its nonzero visible alpha.
          // Counting the live pool alone would accept particles culled before the real render packet.
          for (let j = 0; j < p.detailCount; j++) {
            const o = j * DETAIL_FLOATS, misc = p.detailWords[o + DETAIL.misc]!;
            if ((misc & 255) === pool.cell[i] && ((misc >>> 16) & 255) > 0 &&
              Math.abs(p.details[o]! + p.camX - pool.x[i]!) < .001 &&
              Math.abs(p.details[o + 1]! + p.camY - pool.y[i]!) < .001 &&
              Math.abs(p.details[o + 2]! + p.camZ - pool.z[i]!) < .001) { rendered[kind]++; break; }
          }
        }
        if (id.endsWith("/wake_foam") || id.endsWith("/bow_spray")) {
          const water = h.world.hf.waterAt(pool.x[i]!, pool.z[i]!);
          if (!Number.isFinite(water) || Math.abs(pool.plane[i]! - water) > .05 || h.world.hf.heightAt(pool.x[i]!, pool.z[i]!) >= water) particles.invalidWater++;
        }
      }
      const draws: { mesh: string; lod: number; layer: number }[] = [];
      for (let i = 0; i < p.drawCount; i++) { const mesh = files.manifest.meshes[p.drawMesh[i]!]!.id; if (mesh.startsWith("core:boat")) draws.push({ mesh, lod: p.drawLod[i]!, layer: p.drawLayer[i]! }); }
      return { pixels: raster.color.slice(), scenePixels, draws, particles, rendered, details: p.detailCount, dropped: p.dropped, skipped: p.skipped,
        camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch, roll: app.cam.roll, thirdPerson: app.view.thirdPerson, helmEye } };
    };
    const first = draw();
    if (!first.draws.length) throw new Error(`${shot.name}: actual frame drew no boat mesh`);
    if (shot.moment === "wreck" && !first.draws.some(draw => draw.mesh === def.wreck)) throw new Error(`${shot.name}: native corpse did not select ${def.wreck}`);
    if (shot.moment === "damage" && (!first.draws.some(draw => draw.layer !== 0) || first.rendered.smoke === 0)) throw new Error(`${shot.name}: real damage layer and running damaged-engine smoke must both be visible`);
    if (shot.moment === "moving" && (first.rendered.wake === 0 || first.rendered.spray === 0 || first.particles.invalidWater)) throw new Error(`${shot.name}: actual water must carry rendered wake and spray: ${JSON.stringify({ particles: first.particles, rendered: first.rendered })}`);
    if (shot.moment === "wreck") {
      const wreck = focus().wreck?.wreck;
      if (!wreck || wreck.y >= -.5 || 1 - 2 * (wreck.qx * wreck.qx + wreck.qz * wreck.qz) > -.9) throw new Error(`${shot.name}: salvage lost its submerged inverted rigid pose`);
    }
    if (first.dropped || first.skipped) throw new Error(`${shot.name}: native frame dropped ${first.dropped} or skipped ${first.skipped} draws`);
    writeFileSync(resolve(out, `${shot.name}.png`), encodePng(width, height, first.pixels));
    if (!nativeView) writeFileSync(resolve(out, `${shot.name}-scene.png`), encodePng(width, height, first.scenePixels));
    const sequence = [], state = shot.moment === "wreck" ? { ...focus().wreck?.wreck } : { x: ents.x[e], y: ents.y[e], z: ents.z[e], speed: Math.hypot(ents.vx[e]!, ents.vz[e]!), engine: ents.vehicleEngineCondition[e], flooding: ents.vehicleFlooding[e] };
    if (shot.moment === "moving") {
      const strip = new Uint8ClampedArray(width * 3 * height * 4);
      for (let i = 0; i < 3; i++) { if (i) run(100); const picture = i ? draw() : first;
        if (!picture.rendered.wake || !picture.rendered.spray || picture.particles.invalidWater) throw new Error(`${shot.name}: frame ${i} lost its native marine effects`);
        sequence.push({ atMs: h.now, details: picture.details, particles: picture.particles, rendered: picture.rendered });
        for (let y = 0; y < height; y++) strip.set(picture.pixels.subarray(y * width * 4, (y + 1) * width * 4), (y * width * 3 + i * width) * 4);
      }
      writeFileSync(resolve(out, `${shot.name}-sequence.png`), encodePng(width * 3, height, strip));
    }
    return { ...shot, width, height, seated: crew.filter(actor => ents.seat[actor] === e + 1).length, camera: first.camera, draws: first.draws, details: first.details, particles: first.particles, rendered: first.rendered, sequence, dropped: first.dropped, skipped: first.skipped,
      prediction: { observerCorrections: session.stats.corrections - observerCorrections, pilotCorrections: pilotSession.stats.corrections - pilotCorrections,
        observerFollowsByTeleport: !nativeView, note: "Exterior observer corrections follow deliberate per-frame camera relocation. Pilot corrections are counted separately; capsize, damage and wreck scenes also inject deliberate authoritative state changes." },
      state };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = resolve(value("--source") ?? SOURCE), out = resolve(value("--out") ?? "var/boat-preview/review");
  const [width, height] = (value("--size") ?? "960x640").split("x").map(Number) as [number, number];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("--size must be 320x240 through 1920x1080");
  console.log(`Loading native packs and material catalog from ${source}`);
  const bytes = corePack(source), pack = parsePack(bytes);
  for (const id of ["core:boat", "core:boat_rescue", "core:boat_police", "core:boat_wreck"]) {
    const mesh = pack.header.meshes.find(m => m.id === id);
    if (!mesh || mesh.lods.length < 6 || mesh.skeleton !== "core:boat") throw new Error(`${id}: build the authored boat asset with all six LODs before native review`);
    if (id !== "core:boat_wreck") {
      const cues = pack.header.details?.sheets.find(s => s.owner === id)?.cues;
      if (!cues?.boat_wake || !cues.boat_spray || !cues.engine_smoke) throw new Error(`${id}: rebuild core:details with the authored marine cues before native review`);
    }
  }
  mkdirSync(out, { recursive: true }); const named = await namedTextures(source);
  console.log("Preparing cached native texture files");
  const files = splitWithTextures(bytes, t => { const texture = named.get(t.id); if (!texture) throw new Error(`Missing native texture ${t.id}`); return rgbaOf(texture.material, t.role, t.top); });
  const selected = SHOTS.filter(shot => !value("--only") || shot.name.includes(value("--only")!));
  if (!selected.length) throw new Error("--only matched no review case");
  const report: Record<string, unknown>[] = [], packHash = hashBytes(bytes).toString(16).padStart(8, "0");
  if (value("--only") && existsSync(resolve(out, "report.json"))) report.push(...JSON.parse(readFileSync(resolve(out, "report.json"), "utf8")).shots.filter((s: { name: string }) => !selected.some(shot => shot.name === s.name)));
  for (const shot of selected) { console.log(`Native review ${shot.name}`); report.push({ ...capture(shot, pack, files, shot.portrait ? Math.min(width, 540) : width, shot.portrait ? 960 : height, out), packHash }); }
  report.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "Harness → server seats/replication → App → streamed native pack → Rasterizer", shots: report,
    temporalNote: "Moving-wake sequence contains three actual client frames approximately 0.1 seconds apart, with exact times recorded. Static images and software rendering do not establish subjective handling feel or browser GPU performance." }, null, 2));
  console.log(`${out}: ${report.length} native client views`);
}
