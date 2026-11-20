// bun tools/snap/street-study.ts <miami.snmap> <built assets directory> <output directory>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { placedPriority } from "../../client/core/render/street-reflections.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLASS, DETAIL_TIRE, FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView, settle } from "../snap.ts";
import { encodePng } from "./png.ts";

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
const hd = process.argv.includes("--hd");
const width = hd ? 1280 : 560, height = hd ? 720 : 312;
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) });
const { cam, scene, remote, hf, raster } = v;
scene.assets.tier = tierOf("high");
scene.viewHeight = height;
const hour = Number(process.argv.find(arg => arg.startsWith("--hour="))?.slice(7) ?? 12.5);
if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error("--hour must be in [0,24)");
scene.hour = hour;
cam.fovY = 57 * Math.PI / 180;
const carX = 8649, carZ = 7898;
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
const view = process.argv.find(arg => arg.startsWith("--view="))?.slice(7);
if (!gpu && !view) {
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
  remote.kind[i] = v.reg.index.get("core:compact")!;
  remote.x[i] = carX + i * 3.25;
  remote.z[i] = carZ + i * 2.2;
  remote.y[i] = hf.heightAt(remote.x[i]!, remote.z[i]!);
  remote.yaw[i] = -0.22;
  remote.flags[i] = 1;
  remote.colors[i * 6] = 41;
}
remote.count = 2;
look(carX - 4.3, carZ - 3.9, carX + 0.7, carZ + 0.6, hf.heightAt(carX, carZ) + 0.78);
// Close inspection uses the same authored cars, road and lighting as the wide view.
if (view) {
  const yaw = remote.yaw[0]!, c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (x: number, z: number) => [carX + c*x+s*z, carZ - s*x+c*z] as const;
  const heightAtCar = hf.heightAt(carX, carZ);
  const inspect = (x: number, y: number, z: number, tx: number, ty: number, tz: number): void => {
    const from = world(x,z), to = world(tx,tz);
    look(from[0],from[1],to[0],to[1],heightAtCar+ty,heightAtCar+y-hf.heightAt(from[0],from[1]));
  };
  if (view === "wheel") {
    remote.steering[0] = 0.32;
    inspect(-1.47,0.40,1.78,-0.82,0.30,1.25);
  }
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
            if (!hideCards(p,DETAIL_GLASS)) throw new Error(view + " has no windshield");
            shot.add(p, true);
            if (view === "wheel") {
              hideCards(p,DETAIL_TIRE);
              shot.add(p,true);
              p.frame.fill(0,FRAME.tireContacts);
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
      const on = back.pixels(shot.key, shot.read[0]!)!, sky = back.pixels(shot.key, shot.read[1]!)!;
      if (view) {
        writeFileSync(join(out, view + ".png"), encodePng(width, height, on));
        writeFileSync(join(out, view + "-open.png"), encodePng(width, height, sky));
        const changed = different(on,sky,3);
        if (view === "wheel") {
          const bare = back.pixels(shot.key, shot.read[2]!)!, unloaded = back.pixels(shot.key,shot.read[3]!)!;
          writeFileSync(join(out,"wheel-no-contact.png"),encodePng(width,height,bare));
          writeFileSync(join(out,"wheel-unloaded.png"),encodePng(width,height,unloaded));
          const contact = different(sky,bare,2), deflection = different(bare,unloaded,2);
          return { ok: contact > 25 && deflection > 25, lines: [back.device.renderer, "Contact shadow changed "+contact+" pixels. Tire deflection changed "+deflection+" pixels."] };
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
