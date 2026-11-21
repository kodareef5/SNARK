// bun tools/snap/street-study.ts <miami.snmap> <built assets directory> <output directory>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { placedPriority } from "../../client/core/render/street-reflections.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLASS, DETAIL_TIRE, DRAW_TEXTURED, FRAME, MAX_CONTACTS, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView, settle } from "../snap.ts";
import { encodePng } from "./png.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Def } from "../../shared/content/defs.ts";
import { effectsOff, packetWithout, sceneWithout, tierWithout } from "../../client/core/passes.ts";
import { PICK_ENTITY } from "./raster.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
mkdirSync(out, { recursive: true });
const map = parseMap(Bun.mmap(mapPath), true, true);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name)));
const rows: MapStatic[] = [], counts = new Map<string, number>();
const t = map.statics, population = new Uint32Array(t.kinds.length);
for (let i = 0; i < t.kind.length; i++) {
  const kind = t.kinds[t.kind[i]!]!;
  population[t.kind[i]!]!++;
  if (kind.includes("zutility_") || kind.includes("zdrain_")) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  if (Math.hypot(t.x[i]! - 8600, t.z[i]! - 8000) < 280) rows.push({ kind, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
}
const carX = 8649, carZ = 7898;
const propName = process.argv.find(arg => arg.startsWith("--prop="))?.slice(7);
if (propName) rows.push({ kind: "core:"+propName, x: carX, z: carZ, y: mapHeightfield(map).heightAt(carX,carZ), yaw: 0 });
// --rows=FILE puts rows into the study and takes rows out of it, to judge a piece before any map holds it: each
// {kind, x, z, yaw} with yaw in degrees, standing `up` metres over the ground at its middle (a walk's 0.075 where not
// given), or {kind, x, z, drop: true} for the study's row of that kind within half a metre. A kind the content does not
// have is a study piece: a static `half` big, drawn as the pack's mesh of that id, and in no game's content.
const studyDefs: Def[] = [];
for (const row of JSON.parse(readFileSync(process.argv.find(arg => arg.startsWith("--rows="))?.slice(7) ?? "/dev/null", "utf8") || "[]") as { kind: string; x: number; z: number; yaw?: number; up?: number; drop?: boolean; half?: [number, number, number] }[]) {
  if (row.drop) {
    const at = rows.findIndex((r) => r.kind === row.kind && Math.hypot(r.x - row.x, r.z - row.z) < 0.5);
    if (at < 0) throw new Error(`--rows: no ${row.kind} at ${row.x}, ${row.z} to take out`);
    rows.splice(at, 1);
    continue;
  }
  if (row.half && !studyDefs.some((d) => d.id === row.kind)) studyDefs.push({ type: "structure", class: "static", id: row.kind, mesh: "box", half: row.half, color: 102, hp: 16000, material: "core:mat_stone", near: true });
  rows.push({ kind: row.kind, x: row.x, z: row.z, y: mapHeightfield(map).heightAt(row.x, row.z) + (row.up ?? 0.075), yaw: Math.round(((row.yaw ?? 0) / 360) * 65536) & 0xffff });
}
const studyReg = studyDefs.length > 0 ? { reg: compileContent([...CORE_CONTENT, ...studyDefs]).registry!, pack: new Uint8Array() } : undefined;
const hd = process.argv.includes("--hd");
const width = hd ? 1280 : 560, height = hd ? 720 : 312;
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, studyReg);
const { cam, scene, remote, hf, raster } = v;
scene.assets.tier = tierOf("high");
scene.viewHeight = height;
const hour = Number(process.argv.find(arg => arg.startsWith("--hour="))?.slice(7) ?? 12.5);
if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error("--hour must be in [0,24)");
scene.hour = hour;
cam.fovY = 57 * Math.PI / 180;
const vehicleName = process.argv.find(arg => arg.startsWith("--vehicle="))?.slice(10) ?? "compact";
const vehicleId = "core:" + vehicleName;
const vehicleKind = v.reg.index.get(vehicleId);
const vehicle = vehicleKind === undefined ? null : v.reg.vehicle[vehicleKind];
if (!vehicle || !isWheelVehicle(vehicle)) throw new Error("Expected a driveable road vehicle: " + vehicleId);
// The studied car's paint, a palette index: 41 is blue, 230 black.
const paint = Number(process.argv.find(arg => arg.startsWith("--paint="))?.slice(8) ?? 41);
if (!Number.isInteger(paint) || paint < 1 || paint > 255) throw new Error("--paint must be a palette index from 1 to 255");
/** The front right wheel's rest centre on the studied car's rig, and its bone. */
function frontRight(): { bone: number; at: readonly [number, number, number] } {
  const rig = v.pack.header.rigs!.find(r => r.id === vehicle!.id)!;
  const bone = rig.names?.indexOf("wheel_front_right") ?? -1;
  if (bone < 0) throw new Error("Missing front wheel on " + vehicle!.id);
  return { bone, at: rig.rest.slice(bone*3,bone*3+3) as [number,number,number] };
}
function look(x: number, z: number, tx: number, tz: number, ty: number, eye = 1.6): void {
  cam.x = x;
  cam.z = z;
  cam.y = hf.heightAt(x, z) + eye;
  cam.yaw = Math.atan2(tx - x, tz - z);
  cam.pitch = Math.atan2(ty - cam.y, Math.hypot(tx - x, tz - z));
  const chunk = Math.floor(z / 64) * map.dims.chunksX + Math.floor(x / 64);
  v.nodes.retain(chunk, 64, 3, () => false);
}
function shot(name: string): void {
  const frames = settle(v);
  scene.now += 310;
  const p = v.render();
  scene.now += 200;
  v.render();
  const f = FRAME.reflection, weight = p.frame[f + 3]!;
  if (!p.street || weight < 0.9) throw new Error(name + " has no settled local capture");
  const on = raster.color.slice();
  p.frame[f + 3] = 0;
  raster.render(p);
  let changed = 0, peak = 0, sum = 0;
  for (let i = 0; i < on.length; i += 4) {
    const change = Math.max(...[0, 1, 2].map((c) => Math.abs(on[i + c]! - raster.color[i + c]!)));
    if (change) changed++;
    sum += change;
    peak = Math.max(peak, change);
  }
  if (!changed) throw new Error(name + " has no changed pixels");
  writeFileSync(join(out, name + "-local.png"), encodePng(width, height, on));
  writeFileSync(join(out, name + "-sky.png"), encodePng(width, height, raster.color));
  p.frame[f + 3] = weight;
  console.log(
    name,
    JSON.stringify({
      frames,
      changed,
      peak,
      mean: sum / (width * height),
      revision: p.street.revision,
      anchor: [cam.x + p.frame[f]!, cam.y + p.frame[f + 1]!, cam.z + p.frame[f + 2]!],
    }),
  );
}

let eligible = 0;
for (let i = 0; i < population.length; i++) {
  if (placedPriority(v.reg.defs[v.reg.index.get(t.kinds[i]!) ?? 0] ?? null)) eligible += population[i]!;
}
console.log("eligible placed statics", eligible, "of", t.kind.length);
console.log("Miami fixture census", Object.fromEntries(counts), "statics in study", rows.length);
const gpu = process.argv.includes("--gpu");
const view = propName ? "prop" : process.argv.find(arg => arg.startsWith("--view="))?.slice(7);
const looksFile = process.argv.find((arg) => arg.startsWith("--looks="))?.slice(8);
const looks = looksFile ? JSON.parse(readFileSync(looksFile, "utf8")) as { name: string; at: [number, number, number]; to: [number, number, number]; cars?: boolean }[] : null;
if (!gpu && !view && !looks) {
  look(8540, 8073, 8535.5, 8084.54, 7.1);
  shot("storefront");
  look(8524.7, 8077, 8527.49, 8084.40, 6.6);
  shot("shutter");
  look(8645, 7865, 8642.98, 7857.99, 7.1);
  shot("sign");
  look(8681.06, 7910.325, 8679.86, 7906.625, 5.72);
  shot("cabinet");
  look(8671.1, 7894.15, 8669.47, 7896.65, 4.95, 0.92);
  shot("drain");
}
for (let i = 0; i < 2; i++) {
  remote.id[i] = 1701 + i;
  remote.kind[i] = i === 0 ? vehicleKind! : v.reg.index.get("core:compact")!;
  remote.x[i] = carX + i * 3.25;
  remote.z[i] = carZ + i * 2.2;
  remote.y[i] = hf.heightAt(remote.x[i]!, remote.z[i]!);
  remote.yaw[i] = -0.22;
  remote.flags[i] = 1;
  remote.colors[i * 6] = i === 0 ? paint : 41;
}
remote.count = propName ? 0 : 2;
if (propName && !v.reg.index.has("core:"+propName)) throw new Error("Unknown road prop " + propName);
look(carX - 4.3, carZ - 3.9, carX + 0.7, carZ + 0.6, hf.heightAt(carX, carZ) + 0.78);
// --looks=FILE draws each camera of the file on the GPU, as <name>.png, in place of the reflection study: {name, at: [x,
// z, eye over the ground], to: [x, z, height over the ground there], cars?: false}, at --hour, with --off= effects off
// as a page's ?off= has them (client/core/passes.ts). Each says the frame's draws and triangles, and the walk kit's; the
// study has no near city, so every static is drawn as an instance and its draws are not a client's (tools/bench/census.ts).
if (looks) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome is required for the looks");
  const off = effectsOff(process.argv.find((arg) => arg.startsWith("--off="))?.slice(6) ?? "");
  scene.assets.tier = tierWithout(tierOf("high"), off);
  sceneWithout(scene, off);
  const shot = new Shot("street-looks", width, height, hf, files[0]!);
  shot.manifest = manifest;
  shot.shadows = true;
  const load = scene.assets.residency, lines: string[] = [];
  const kit = /zwalk8|zcurbramp|zzzcurb/;
  const passed = await litProbe(chrome, [{
    name: "Street looks",
    shots() {
      for (const l of looks) {
        look(l.at[0], l.at[1], l.to[0], l.to[1], hf.heightAt(l.to[0], l.to[1]) + l.to[2], l.at[2]);
        remote.count = l.cars === false ? 0 : 2;
        for (let frame = 0; ; frame++) {
          if (frame > 900) throw new Error(l.name + " did not settle");
          scene.now += 1000 / 60;
          v.port!.advance(scene.now);
          const p = scene.build(cam, remote);
          const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
          if (frame > 30 && !loading && !load.flying && !load.waiting && (p.tier.reflectionHz === 0 || p.frame[FRAME.reflection + 3] === 1)) {
            packetWithout(p, off);
            let draws = 0, tris = 0;
            for (let d = 0; d < p.drawCount; d++) {
              if (!kit.test(manifest.meshes[p.drawMesh[d]!]?.id ?? "")) continue;
              draws++;
              tris += ((p.drawFlags[d]! & DRAW_TEXTURED) !== 0 ? p.drawIndexCount[d]! / 3 : scene.assets.table.tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]!;
            }
            lines.push(`${l.name}: ${p.drawCount} draws, ${p.triangles} triangles, ${p.casterCount} casters; the walk kit drawn as instances ${draws} draws, ${tris} triangles`);
            shot.add(p, true);
            break;
          }
          p.drawCount = p.tileCount = p.casterCount = 0;
          shot.add(p);
        }
      }
      return [shot];
    },
    judge(back) {
      looks.forEach((l, i) => writeFileSync(join(out, l.name + ".png"), encodePng(width, height, back.pixels(shot.key, shot.read[i]!)!)));
      return { ok: true, lines: [back.device.renderer, ...lines] };
    },
  }]);
  process.exit(passed ? 0 : 1);
}
// Close inspection uses the same authored cars, road and lighting as the wide view.
if (view) {
  const yaw = remote.yaw[0]!, c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (x: number, z: number) => [carX + c*x+s*z, carZ - s*x+c*z] as const;
  const heightAtCar = hf.heightAt(carX, carZ);
  const inspect = (x: number, y: number, z: number, tx: number, ty: number, tz: number): void => {
    const from = world(x,z), to = world(tx,tz);
    look(from[0],from[1],to[0],to[1],heightAtCar+ty,heightAtCar+y-hf.heightAt(from[0],from[1]));
  };
  if (view === "prop") {
    remote.yaw[0] = 0;
    const trailer = propName === "box_trailer", tanker = propName!.startsWith("tanker_");
    if (trailer) inspect(-7.8,1.5,-7,0,1.20,-3.3);
    else if (tanker) inspect(-9.0,2.3,7.0,0,1.3,0);
    else inspect(-4.4,1.2,3.8,0,0.65,0);
  }
  else if (view === "wheel") {
    remote.steering[0] = 0.32;
    const [x,y,z] = frontRight().at;
    const scale = vehicle.spec.wheelRadius/0.3;
    inspect(x-0.69*scale,y+0.10*scale,z+0.53*scale,x-0.04*scale,y,z);
  }
  else if (view === "arch") {
    // Low, behind and outside the front right wheel, steered so the tyre swings out and shows the arch behind it:
    // the sill in front, the door's shut line, the arch's lip and inside, the tyre and the rim.
    remote.steering[0] = 0.32;
    const [x,y,z] = frontRight().at;
    const scale = vehicle.spec.wheelRadius/0.3, side = Math.sign(x) || -1;
    inspect(x+1.17*side*scale,y+0.25*scale,z-0.95*scale,x+0.02*side*scale,y+0.03*scale,z-0.15*scale);
  }
  else if (view === "side") inspect(-5.9,1.03,2.75,0,0.57,0);
  else if (view === "front") inspect(-0.15,1.62,3.7,0,1.10,0.04);
  else if (view === "oblique") inspect(-2.1,1.55,1.45,0,1.17,0.50);
  else if (view === "driver") inspect(0.42,1.11,0.17,0.42,1.14,6.0);
  else throw new Error("Unknown --view");
  scene.roadFinish = 1;
}
function hideCards(p: FramePacket, flags: number): number {
  let hidden = 0;
  for (let i=0; i<p.detailCount; i++) {
    const at = i*DETAIL_FLOATS+DETAIL.misc;
    if (((p.detailWords[at]! >>> 8) & 255) !== flags) continue;
    p.detailWords[at]! &= 0xff00ffff;
    hidden++;
  }
  return hidden;
}
function different(a: Uint8Array, b: Uint8Array, least: number): number {
  let changed = 0;
  for (let i=0; i<a.length; i+=4) {
    if (Math.max(Math.abs(a[i]!-b[i]!), Math.abs(a[i+1]!-b[i+1]!), Math.abs(a[i+2]!-b[i+2]!)) >= least) changed++;
  }
  return changed;
}
// The arch study's pictures are named for the car, its paint and the hour, so one folder can hold all of them.
const archName = `arch-${vehicleName}-${paint}-${String(Math.floor(hour)).padStart(2,"0")}${String(Math.round(hour%1*60)).padStart(2,"0")}`;
/** Which pixels of the studied car's picture are its front right wheel (1) and the rest of it (2), from the software render. */
let archParts: Uint8Array | null = null;
/** 8-bit luma at quantiles of the pixels of `picture` that `parts` marks `part`, near the wheel on screen. */
function archLuma(picture: Uint8Array, part: number): string {
  let x0 = width, x1 = 0, y0 = height, y1 = 0;
  for (let i = 0; i < archParts!.length; i++) {
    if (archParts![i] !== 1) continue;
    const x = i % width, y = Math.floor(i / width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  // The body round the wheel: its box on screen grown by a third each way.
  const gx = (x1 - x0) / 3, gy = (y1 - y0) / 3, lumas: number[] = [];
  for (let i = 0; i < archParts!.length; i++) {
    const x = i % width, y = Math.floor(i / width);
    if (archParts![i] !== part || x < x0 - gx || x > x1 + gx || y < y0 - gy || y > y1 + gy) continue;
    lumas.push(0.2126*picture[i*4]! + 0.7152*picture[i*4+1]! + 0.0722*picture[i*4+2]!);
  }
  lumas.sort((a, b) => a - b);
  const at = (q: number) => Math.round(lumas[Math.min(lumas.length-1, Math.floor(q*lumas.length))] ?? 0);
  return `${lumas.length} px, luma p10 ${at(0.1)} p25 ${at(0.25)} median ${at(0.5)} p90 ${at(0.9)} p99 ${at(0.99)}`;
}
if (view === "arch") {
  settle(v);
  scene.now += 510;
  v.render();
  const wheel = frontRight().bone + 1;
  archParts = new Uint8Array(width * height);
  for (let i = 0; i < archParts.length; i++) {
    if (raster.pickKind[i] !== PICK_ENTITY || raster.pickId[i] !== 1701) continue;
    archParts[i] = raster.pickBone[i] === wheel ? 1 : 2;
  }
  const picture = Uint8Array.from(raster.color);
  writeFileSync(join(out, archName + "-software.png"), encodePng(width, height, picture));
  console.log(archName, "software wheel", archLuma(picture, 1), "| body round it", archLuma(picture, 2));
  if (!gpu) process.exit(0);
  // The same scene goes to the GPU from the start, as after a lost context.
  scene.resetUploads();
}
if (!gpu && view) {
  settle(v);
  scene.now += 510;
  const p = v.render(), full = Uint8Array.from(raster.color);
  writeFileSync(join(out,view+"-software.png"),encodePng(width,height,full));
  hideCards(p,DETAIL_GLASS);
  raster.render(p);
  if (view === "wheel") {
    const shadowed = Uint8Array.from(raster.color);
    hideCards(p,DETAIL_TIRE);
    raster.render(p);
    const bare = Uint8Array.from(raster.color);
    p.frame.fill(0,FRAME.tireContacts);
    raster.render(p);
    const contact = different(shadowed,bare,2), bulge = different(bare,Uint8Array.from(raster.color),2);
    console.log("software wheel, changed pixels", { contact, bulge });
    if (contact < 20 || bulge < 20) throw new Error("wheel contact or deformation missing");
  } else if (different(full,Uint8Array.from(raster.color),3) < 100) throw new Error("windshield missing");
  process.exit(0);
}
if (gpu) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome is required for the WebGL study");
  const shot = new Shot("miami-compacts", width, height, hf, files[0]!);
  shot.manifest = manifest;
  shot.shadows = true;
  shot.repeats = 16;
  const load = scene.assets.residency;
  const finishes = process.argv.includes("--finishes");
  const studies: string[] = [];
  let sunUp = true;
  const readStudy = (name: string) => {
    studies.push(name);
    shot.add(scene.packet, true);
  };
  const passed = await litProbe(chrome, [{
    name: "Miami street reflections",
    shots() {
      let restoring = false;
      for (let frame = 0; frame < 500; frame++) {
        scene.now += 1000 / 60;
        v.port!.advance(scene.now);
        const p = scene.build(cam, remote);
        const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length +
          p.texDrops.length;
        if (!loading && !load.flying && !load.waiting && p.frame[FRAME.reflection + 3] === 1) {
          if (view) {
            shot.add(p, true);
            if (view === "arch") return [shot];
            if (view === "prop") {
              const strength = p.frame[FRAME.reflection+3]!;
              p.frame[FRAME.reflection+3] = 0;
              shot.add(p,true);
              p.frame[FRAME.reflection+3] = strength;
              const saved = p.frame.slice(FRAME.contact, FRAME.contact+8*MAX_CONTACTS);
              p.frame.fill(0,FRAME.contact,FRAME.contact+8*MAX_CONTACTS);
              shot.add(p,true);
              p.frame.set(saved,FRAME.contact);
              const prop = v.reg.defs[v.reg.index.get("core:"+propName)!]!;
              if (prop.type !== "structure") throw new Error("Expected a placed vehicle prop");
              const instances = p.drawInstances.slice(0,p.drawCount);
              for (let d=0; d<p.drawCount; d++) if (manifest.meshes[p.drawMesh[d]!]!.id === prop.mesh) p.drawInstances[d] = 0;
              shot.add(p,true);
              p.drawInstances.set(instances);
              return [shot];
            }
            if (view === "wheel" || view === "side") {
              // Same light, geometry and old ellipsoid, with only the chassis footprint switched off.
              const original = p.frame.slice(FRAME.contact,FRAME.contact+8*MAX_CONTACTS);
              for (let j=0; j<MAX_CONTACTS; j++) {
                const at = FRAME.contact+8*j+6;
                p.frame[at] = Math.abs(p.frame[at]!);
              }
              shot.add(p,true);
              p.frame.set(original,FRAME.contact);
              const capture = p.frame[FRAME.reflection+3]!;
              p.frame[FRAME.reflection+3] = 0;
              shot.add(p,true);
              p.frame[FRAME.reflection+3] = capture;
            }
            const savedCards = view === "wheel" ? p.detailWords.slice(0,p.detailCount*DETAIL_FLOATS) : null;
            if (!hideCards(p,DETAIL_GLASS)) throw new Error(view + " has no windshield");
            shot.add(p, true);
            if (view === "wheel") {
              hideCards(p,DETAIL_TIRE);
              shot.add(p,true);
              const supported = p.frame.slice(FRAME.tireContacts);
              p.frame.fill(0,FRAME.tireContacts);
              shot.add(p,true);
              p.frame.set(supported,FRAME.tireContacts);
              p.detailWords.set(savedCards!);
              // Move the other car into the mirror with the main camera, poses and draw lists frozen.
              remote.x[1] = carX-2.9;
              remote.z[1] = carZ-1.4;
              remote.colors[6] = 233;
              const world = { dims: map.dims, hf, structs: v.structs, nodes: v.nodes.store };
              const hidden = new Set<number>();
              scene.street.frame(p,cam,world,remote,hidden,scene.now+260);
              scene.street.frame(p,cam,world,remote,hidden,scene.now+460);
              shot.add(p,true);
            }
            return [shot];
          }
          if (restoring) {
            shot.add(p, true);
            p.frame[FRAME.reflection + 3] = 0;
            shot.add(p, true);
            if (finishes) {
              sunUp = -p.frame[FRAME.moon + 1]! > 0;
              p.frame[FRAME.reflection + 3] = 1;
              for (const [name, gloss, road] of [
                ["gloss-100", 1, 0], ["gloss-135", 1.35, 0], ["gloss-200", 2, 0],
                ["dry-asphalt", 1.35, 1], ["dry-asphalt-deeper-shade", 1.35, 2],
              ] as const) {
                p.frame[FRAME.streetLook] = gloss - 1;
                p.frame[FRAME.streetLook + 2] = road ? 1 : 0;
                p.frame[FRAME.streetLook + 3] = road === 2 ? 1 : 0;
                readStudy(name);
              }
              p.frame[FRAME.streetLook + 2] = p.frame[FRAME.streetLook + 3] = 0;
              // Move a traffic proxy beside the painted door. Keep camera, draw lists and lighting
              // fixed, so every changed screen pixel comes from the changing reflection.
              remote.x[1] = carX - 2.5;
              remote.z[1] = carZ;
              const world = { dims: map.dims, hf, structs: v.structs, nodes: v.nodes.store };
              const hidden = new Set<number>();
              for (const ms of [0, 45, 90, 135, 180]) {
                scene.street.frame(p, cam, world, remote, hidden, scene.now + 270 + ms);
                readStudy("traffic-" + ms + "ms");
              }
            }
            return [shot];
          }
          // Alternate the order to reduce warm-up and GPU clock bias.
          for (const strength of [1, 0, 0, 1, 0, 1, 1, 0]) {
            p.frame[FRAME.reflection + 3] = strength;
            shot.add(p, true);
          }
          p.frame[FRAME.reflection + 3] = 1;
          // Change only the identity read by the finish shader. Every bone, material and camera stays fixed.
          for (let i = 0; i < p.transientCount; i++) if (p.transientIds[i] === 1701) p.transientIds[i] = 9103;
          shot.add(p, true);
          for (let i = 0; i < p.transientCount; i++) if (p.transientIds[i] === 9103) p.transientIds[i] = 1701;
          const tier = p.tier, image = p.street;
          p.tier = { ...tier, reflectionHz: 0 };
          p.street = null;
          p.frame[FRAME.reflection + 3] = 0;
          shot.add(p, true);
          p.tier = tier;
          p.street = image;
          shot.loseAt = shot.frames.length;
          scene.resetUploads();
          restoring = true;
          continue;
        }
        p.drawCount = p.tileCount = p.casterCount = 0;
        shot.add(p);
      }
      throw new Error("Miami WebGL scene did not settle");
    },
    judge(back) {
      const on = back.pixels(shot.key, shot.read[0]!)!;
      if (view === "arch") {
        writeFileSync(join(out, archName + ".png"), encodePng(width, height, on));
        const wheel = archLuma(on, 1), body = archLuma(on, 2);
        const enough = (line: string) => Number(line.split(" ")[0]) > 1500;
        return { ok: enough(wheel) && enough(body), lines: [back.device.renderer, archName + " wheel " + wheel, archName + " body round it " + body] };
      }
      const sky = back.pixels(shot.key, shot.read[1]!)!;
      if (view) {
        writeFileSync(join(out, view + ".png"), encodePng(width, height, on));
        if (view === "prop") {
          const noContact = back.pixels(shot.key,shot.read[2]!)!;
          writeFileSync(join(out,"sky-only.png"),encodePng(width,height,sky));
          writeFileSync(join(out,"no-contact.png"),encodePng(width,height,noContact));
          const hidden = back.pixels(shot.key,shot.read[3]!)!;
          let reflected = 0, visible = 0;
          for (let i=0; i<on.length; i+=4) {
            if (Math.max(Math.abs(on[i]!-hidden[i]!),Math.abs(on[i+1]!-hidden[i+1]!),Math.abs(on[i+2]!-hidden[i+2]!)) < 8) continue;
            visible++;
            if (Math.max(Math.abs(on[i]!-sky[i]!),Math.abs(on[i+1]!-sky[i+1]!),Math.abs(on[i+2]!-sky[i+2]!)) >= 3) reflected++;
          }
          const contact = different(on,noContact,3);
          return { ok: visible > 500 && reflected > 10 && contact > 40, lines: [back.device.renderer, propName+" reflection "+reflected+" of "+visible+" visible prop pixels, ground contact "+contact+" pixels."] };
        }
        const chassisStudy = view === "wheel" || view === "side";
        const open = chassisStudy ? back.pixels(shot.key,shot.read[3]!)! : sky;
        writeFileSync(join(out, view + "-open.png"), encodePng(width, height, open));
        const changed = different(on,open,3);
        let chassis = 0;
        if (chassisStudy) {
          const fallback = back.pixels(shot.key,shot.read[2]!)!;
          writeFileSync(join(out,view+"-no-chassis.png"),encodePng(width,height,sky));
          writeFileSync(join(out,view+"-sky-only.png"),encodePng(width,height,fallback));
          chassis = different(on,sky,3);
          if (view === "side") return { ok: chassis > 200, lines: [back.device.renderer, "Whole-car shadow changed "+chassis+" pixels."] };
        }
        if (view === "wheel") {
          const bare = back.pixels(shot.key, shot.read[4]!)!, unloaded = back.pixels(shot.key,shot.read[5]!)!;
          writeFileSync(join(out,"wheel-no-contact.png"),encodePng(width,height,bare));
          writeFileSync(join(out,"wheel-unloaded.png"),encodePng(width,height,unloaded));
          const contact = different(open,bare,2), deflection = different(bare,unloaded,2);
          const passing = back.pixels(shot.key,shot.read[6]!)!;
          writeFileSync(join(out,"wheel-traffic.png"),encodePng(width,height,passing));
          let rimChanges = 0;
          // In the matched wheel camera the foreground rim occupies this ellipse.
          for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
            const rx=(x/width-0.5)/0.126, ry=(y/height-0.553)/0.235;
            if (rx*rx+ry*ry > 1) continue;
            const i=(y*width+x)*4;
            if (Math.max(Math.abs(on[i]!-passing[i]!),Math.abs(on[i+1]!-passing[i+1]!),Math.abs(on[i+2]!-passing[i+2]!)) >= 5) rimChanges++;
          }
          return { ok: chassis > 200 && contact > 25 && deflection > 25 && rimChanges > 100,
            lines: [back.device.renderer, "Whole-car shadow changed "+chassis+" pixels. Contact shadow changed "+contact+" pixels. Tire deflection changed "+deflection+" pixels. Moving traffic changed "+rimChanges+" foreground rim pixels."] };
        }
        return { ok: changed > 100, lines: [back.device.renderer, view + " glass changed " + changed + " pixels by at least three channel values"] };
      }
      writeFileSync(join(out, hd ? "compacts-webgl-hd-local.png" : "compacts-webgl-local.png"), encodePng(width, height, on));
      writeFileSync(join(out, hd ? "compacts-webgl-hd-sky.png" : "compacts-webgl-sky.png"), encodePng(width, height, sky));
      const changed = different(on, sky, 3);
      const seeded = different(on, back.pixels(shot.key, shot.read[8]!)!, 2);
      const fallback = different(back.pixels(shot.key, shot.read[9]!)!, back.pixels(shot.key, shot.read[1]!)!, 3);
      const restored = different(back.pixels(shot.key, shot.read[10]!)!, back.pixels(shot.key, shot.read[11]!)!, 3);
      const times = shot.read.slice(0, 8).map((k) => back.time(shot.key + "/" + k));
      let studyOK = true;
      if (finishes) {
        const picture = (name: string) => back.pixels(shot.key, shot.read[12 + studies.indexOf(name)]!)!;
        for (const name of studies) writeFileSync(join(out, name + ".png"), encodePng(width, height, picture(name)));
        const original = picture("gloss-135");
        const delta = [0, 45, 90, 135, 180].map(ms => different(original, picture("traffic-" + ms + "ms"), 2));
        const gloss = different(original, picture("gloss-100"), 3), road = different(original, picture("dry-asphalt"), 3);
        const shade = different(picture("dry-asphalt"), picture("dry-asphalt-deeper-shade"), 3);
        console.log("fixed-camera pixel counts", { hour, sunUp, gloss, road, shade, traffic: delta, times: studies.map((_, i) => back.time(shot.key + "/" + shot.read[12 + i])) });
        const shadowOK = sunUp ? shade > 50 : shade === 0;
        studyOK = gloss > 0 && road > 0 && shadowOK && delta[0] === 0 && delta[2]! > 0 && delta[4]! > delta[2]!;
      }
      return {
        ok: studyOK && changed > 200 && seeded > 5 && restored > 200 && fallback === 0,
        lines: [
          back.device.renderer,
          fallback + " pixels differed by three or more between released-capture tier and sky fallback",
          seeded + " pixels changed by two or more when only the car ID changed",
          restored + " pixels changed by three or more after genuine WebGL context loss and restoration",
          changed + " pixels moved by at least three channel values with the view held still",
          "steady frame ms, 16 replays per block, local/sky/sky/local/sky/local/local/sky " + JSON.stringify(times),
        ],
      };
    },
  }]);
  process.exit(passed ? 0 : 1);
}
shot("compacts");
look(carX - 3.6, carZ - 1.45, carX + 0.8, carZ + 0.5, hf.heightAt(carX, carZ) + 0.72);
shot("walk-by");
remote.x[1]! -= 1.8;
remote.z[1]! += 2.0;
shot("traffic-moved");

const clock = scene.street;
const p = scene.packet, world = { dims: map.dims, hf, structs: v.structs, nodes: v.nodes.store }, hidden = new Set<number>();
const samples: number[] = [];
for (let i = 0; i < 280; i++) {
  const start = performance.now();
  remote.z[1]! += i % 2 ? 1 : -1;
  clock.frame(p, cam, world, remote, hidden, scene.now + 500 * (i + 1));
  if (i >= 30) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log("capture ms, 250 updates", JSON.stringify({ median: samples[125], p95: samples[237], max: samples[249] }));
