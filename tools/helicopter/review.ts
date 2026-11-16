// Native client review: real server occupancy/replication, App cameras, streamed asset pack and software renderer.
// bun tools/helicopter/review.ts --source assets/source --out var/helicopter-preview/review
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_ROTOR, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { HELICOPTER_ART } from "../../content/vehicles/helicopter-art.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { quatUnrotate } from "../../shared/math/quat.ts";
import { BTN_MOD } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dress } from "../../server/commands/combat.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { SOURCE } from "../art/source.ts";

type Moment = "exterior" | "cockpit" | "bank" | "inverted" | "damage" | "wreck" | "distant" | "rotor";
interface Shot { name: string; kind: string; moment: Moment; tier: "high" | "lowpoly"; fps?: number; lookPitch?: number }
const SHOTS: readonly Shot[] = [
  { name: "01-civilian-occupied", kind: "core:helicopter", moment: "exterior", tier: "high" },
  { name: "02-rescue-occupied", kind: "core:helicopter_rescue", moment: "exterior", tier: "high" },
  { name: "03-police-occupied", kind: "core:helicopter_police", moment: "exterior", tier: "high" },
  { name: "04-pilot-cockpit", kind: "core:helicopter", moment: "cockpit", tier: "high" },
  { name: "04a-pilot-controls", kind: "core:helicopter", moment: "cockpit", tier: "high", lookPitch: -.3 },
  { name: "05-banked-flight", kind: "core:helicopter", moment: "bank", tier: "high" },
  { name: "06-inverted-flight", kind: "core:helicopter", moment: "inverted", tier: "high" },
  { name: "07-worn-rescue", kind: "core:helicopter_rescue", moment: "damage", tier: "high" },
  { name: "08-inverted-salvage", kind: "core:helicopter", moment: "wreck", tier: "high" },
  { name: "09-distant-lowpoly", kind: "core:helicopter_police", moment: "distant", tier: "lowpoly" },
  { name: "10-rotor-at-30fps", kind: "core:helicopter", moment: "rotor", tier: "high", fps: 30 },
  { name: "11-rotor-at-60fps", kind: "core:helicopter", moment: "rotor", tier: "high", fps: 60 },
];

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  // As tools/snap.settle does: keep the graphics card's real uploads without rasterizing every warm-up frame.
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet);
  [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

function capture(shot: Shot, pack: Pack, files: GameFiles, width: number, height: number, out: string) {
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, h = new Harness({}, 197, 60, { dev: true, map: writeMap(flatMap(4)), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("reviewer", {}, { manual: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = shot.tier; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null;
  let follow = () => {};
  const frame = (now: number) => {
    follow(); port.advance(now); packet = app.frame(now, width, height);
    if (packet && session.world) {
      raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest);
      uploadOnly(raster, packet);
    }
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(600); session.text("enablecheats"); run(250);
    session.text("tp 110 110"); run(250);
    const me = h.client(session)!, record = h.host.records.byPid.get(me.pid)!;
    const e = h.host.spawnVehicle(shot.kind, 128, 128, record.team, 0, { fuel: .9 });
    if (e < 0) throw new Error(`${shot.name}: aircraft could not be placed`);
    const ents = h.world.ents, vehicle = h.host.records.byPid.get(ents.pid[e]!)!, def = reg.vehicle[vehicle.kind]!;
    if (def.movement !== "rotor") throw new Error(`${shot.kind}: review requires a rotorcraft definition`);
    const cockpit = shot.moment === "cockpit", pilotSession = cockpit ? session : h.join("pilot");
    run(500);
    const pilot = h.client(pilotSession)!;
    ents.setPosition(pilot.ent, 129.75, 0, 128.65); pilot.ownDirty = true;
    const pilotRecord = h.host.records.byPid.get(pilot.pid)!; pilotRecord.team = record.team;
    if (h.host.urban.mount(pilot, e) !== 0) throw new Error(`${shot.name}: pilot could not board`);
    const crew: number[] = [pilot.ent];
    for (const [index, seat] of def.seats.filter(s => !s.driver).entries()) {
      const actor = h.host.spawnCreature("core:civilian", 128 + seat.entry[0], 128 + seat.entry[2], 1);
      if (actor < 0) throw new Error(`${shot.name}: passenger spawn failed`);
      const rec = h.host.records.byPid.get(ents.pid[actor]!)!; rec.team = record.team;
      if (index === 1) for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) dress(h.host, rec, reg.index.get(`core:flak_${part}`)!);
      if (h.host.urban.seatNpc(actor, e, seat.id) !== 0) throw new Error(`${shot.name}: passenger ${seat.id} could not board`);
      crew.push(actor);
    }
    run(1200);
    if (crew.some(actor => ents.seat[actor] !== e + 1)) throw new Error(`${shot.name}: native seat transaction did not commit`);
    if (cockpit) {
      if (app.view.thirdPerson) { app.key("KeyV", true); app.key("KeyV", false); }
      // Use the actual cockpit mouse-look mapping: controls.pitch alone is world gaze, not cabin-relative look.
      if (shot.lookPitch) app.look(0, -shot.lookPitch / LOOK_SPEED);
    }
    else { session.text("fly"); run(100); }
    if (!cockpit) h.pilots[h.sessions.indexOf(pilotSession)]!.buttons = BTN_MOD;
    const airborne = shot.moment === "bank" || shot.moment === "inverted" || shot.moment === "wreck";
    const centre = new Float64Array(3);
    const focus = () => {
      const wreck = shot.moment === "wreck" ? [...h.host.corpses.bodies.values()].find(b => b.kind === vehicle.kind) : null;
      const state = wreck?.wreck ?? { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[ents.vrow[e]!]!, pitch: 0, roll: 0,
        qx: ents.vehicleQx[ents.vrow[e]!]!, qy: ents.vehicleQy[ents.vrow[e]!]!, qz: ents.vehicleQz[ents.vrow[e]!]!, qw: ents.vehicleQw[ents.vrow[e]!]! };
      vehiclePoint(state, [0, 1.4, -.8], centre);
      return { x: centre[0]!, y: centre[1]!, z: centre[2]!, id: wreck?.e ?? e };
    };
    follow = () => {
      if (cockpit) return;
      const at = focus(), far = shot.moment === "distant" ? 98 : 11, dx = far * .65, dz = far * .76;
      const eye = at.y + (airborne ? 2.5 : 1.1);
      ents.setPosition(me.ent, at.x + dx, eye - 1.62, at.z + dz); me.ownDirty = true;
      app.controls.yaw = Math.atan2(-dx, -dz); app.controls.pitch = Math.atan2(at.y - eye, far);
    };
    // Let the real card streaming settle at the requested native view before changing the aircraft's state.
    run(1500);
    if (airborne) {
      ents.setPosition(e, 128, 30, 128); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      if (shot.moment === "bank") { ents.vehicleQz[ents.vrow[e]!] = Math.sin(.7 / 2); ents.vehicleQw[ents.vrow[e]!] = Math.cos(.7 / 2); }
      else { ents.vehicleQx[ents.vrow[e]!] = 1; ents.vehicleQw[ents.vrow[e]!] = 0; }
    }
    if (airborne || shot.moment === "rotor" || shot.moment === "damage") {
      ents.vehicleEngineOn[ents.vrow[e]!] = 1; ents.vehicleRotorRpm[ents.vrow[e]!] = 410;
      ents.vehicleCollective[ents.vrow[e]!] = airborne ? (def.spec.mass + ents.vehiclePayloadMass[ents.vrow[e]!]!) / def.spec.liftMass : 0;
    }
    if (shot.moment === "damage") {
      h.host.survival.hurt(vehicle, 950, 0); ents.vehicleEngineCondition[ents.vrow[e]!] = .25; ents.vehicleRotorCondition[ents.vrow[e]!] = .45;
    }
    h.host.urban.changed(e); pilot.ownDirty = true;
    if (shot.moment === "wreck") h.host.survival.hurt(vehicle, 1e6, 0);
    run(400);
    const draw = () => {
      const p = packet;
      if (!p || !raster) throw new Error(`${shot.name}: the native App did not produce a frame`);
      let cockpitEye: number[] | undefined;
      if (cockpit) {
        if (app.view.thirdPerson) throw new Error(`${shot.name}: capture is still in the chase camera`);
        const own = session.own, local = new Float64Array(3);
        quatUnrotate([own.vehicleQx, own.vehicleQy, own.vehicleQz, own.vehicleQw], 0, p.camX - own.x, p.camY - own.y, p.camZ - own.z, local, 0);
        cockpitEye = [...local];
        if (cockpitEye.some((v, i) => v < HELICOPTER_ART.interior.min[i]! || v > HELICOPTER_ART.interior.max[i]!)) throw new Error(`${shot.name}: cockpit eye is outside the measured cabin: ${cockpitEye.join(", ")}`);
      }
      raster.render(p); drawUi(raster.color, width, height, app.ui.frame);
      const draws: { mesh: string; lod: number; layer: number }[] = [];
      for (let i = 0; i < p.drawCount; i++) {
        const mesh = files.manifest.meshes[p.drawMesh[i]!]!.id;
        if (mesh.startsWith("core:helicopter")) draws.push({ mesh, lod: p.drawLod[i]!, layer: p.drawLayer[i]! });
      }
      let rotorCards = 0;
      for (let i = 0; i < p.detailCount; i++) if ((p.detailWords[i * DETAIL_FLOATS + DETAIL.misc]! & (DETAIL_ROTOR << 8)) !== 0) rotorCards++;
      return { pixels: raster.color.slice(), draws, rotorCards, dropped: p.dropped, skipped: p.skipped, camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch, roll: app.cam.roll, thirdPerson: app.view.thirdPerson, cockpitEye } };
    };
    const first = draw();
    if (first.draws.length === 0) throw new Error(`${shot.name}: the actual frame drew no helicopter mesh`);
    if (shot.moment === "wreck" && !first.draws.some(draw => draw.mesh === def.wreck)) throw new Error(`${shot.name}: native corpse did not select the authored wreck mesh ${def.wreck}`);
    if ((airborne && shot.moment !== "wreck" || shot.moment === "rotor") && first.rotorCards !== def.rotors.length) throw new Error(`${shot.name}: full-speed aircraft did not draw every rotor's swept coverage`);
    if (first.dropped || first.skipped) throw new Error(`${shot.name}: native frame dropped ${first.dropped} or skipped ${first.skipped} draws`);
    writeFileSync(resolve(out, `${shot.name}.png`), encodePng(width, height, first.pixels));
    if (shot.moment === "rotor") {
      const strip = new Uint8ClampedArray(width * 3 * height * 2 * 4);
      for (let i = 0; i < 6; i++) {
        if (i) run(1000 / shot.fps!);
        const picture = i ? draw() : first, ox = i % 3 * width, oy = Math.floor(i / 3) * height;
        for (let y = 0; y < height; y++) strip.set(picture.pixels.subarray(y * width * 4, (y + 1) * width * 4), ((oy + y) * width * 3 + ox) * 4);
      }
      writeFileSync(resolve(out, `${shot.name}-sequence.png`), encodePng(width * 3, height * 2, strip));
    }
    return { ...shot, width, height, seated: crew.filter(actor => ents.seat[actor] === e + 1).length, camera: first.camera, draws: first.draws, rotorCards: first.rotorCards, dropped: first.dropped, skipped: first.skipped,
      damage: shot.moment === "damage" ? { engine: ents.vehicleEngineCondition[ents.vrow[e]!], rotor: ents.vehicleRotorCondition[ents.vrow[e]!] } : undefined };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = resolve(value("--source") ?? SOURCE), out = resolve(value("--out") ?? "var/helicopter-preview/review");
  const [width, height] = (value("--size") ?? "960x640").split("x").map(Number) as [number, number];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("--size must be 320x240 through 1920x1080");
  const bytes = corePack(source), pack = parsePack(bytes);
  for (const id of ["core:helicopter", "core:helicopter_rescue", "core:helicopter_police", "core:helicopter_wreck"]) {
    const mesh = pack.header.meshes.find(m => m.id === id);
    if (!mesh || mesh.lods.length < 6 || mesh.skeleton !== "core:helicopter") throw new Error(`${id}: build the authored helicopter asset with all six LODs before native review`);
  }
  mkdirSync(out, { recursive: true });
  const named = await namedTextures(source);
  const files = splitWithTextures(bytes, t => {
    const texture = named.get(t.id); if (!texture) throw new Error(`Missing native texture ${t.id}`);
    return rgbaOf(texture.material, t.role, t.top);
  }), selected = SHOTS.filter(shot => !value("--only") || shot.name.includes(value("--only")!));
  if (selected.length === 0) throw new Error("--only matched no review case");
  const report = [];
  for (const shot of selected) { console.log(`Native review ${shot.name}`); report.push(capture(shot, pack, files, width, height, out)); }
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "Harness → server seats/replication → App → streamed native pack → Rasterizer", shots: report,
    temporalNote: "Rotor sequences preserve discrete native frames at the named sampling rate. Inspect main and tail direction/visibility; static images cannot establish smooth motion or handling feel." }, null, 2));
  console.log(`${out}: ${report.length} native client views`);
}
