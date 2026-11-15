// Pictures of wild pteranodons where the server has flown them (planning/reference/flyers-plan.md, FL3), drawn by snap's
// renderer: 100 put down as tools/bench/flyers.ts puts them, left `--minutes` (2 by default), then seen from each camera of
// `--views` (x, y over the ground, z, yaw, pitch, in metres and degrees, semicolons between), or without it from two cameras
// on one in the air near the middle of the rest: from 30 m behind it and above, and from open ground looking up. Until the
// art replaces it, a pteranodon is a grey box.
//
//   bun tools/snap/flyers.ts [--map FILE] [--at X,Z] [--minutes N] [--views "x,y,z,yaw,pitch;..."] [--out DIR]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chunkAt } from "../../shared/coords.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { openSky } from "../../server/behavior.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { flock, watched } from "../../tests/fixtures/flyers.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "./png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mapPath = arg("map");
const bytes = mapPath ? new Uint8Array(readFileSync(mapPath)) : null;
const mapFile = bytes ? parseMap(bytes) : undefined;
const [cx, cz] = (arg("at")?.split(",").map(Number) ?? [PROVING_POOL.x, PROVING_POOL.z]) as [number, number];
const minutes = Number(arg("minutes") ?? 2);
const out = resolve(arg("out") ?? "artifacts/flyers");
const [w, h] = (arg("size") ?? "960x540").split("x").map(Number) as [number, number];

// The server's flight.
const { h: harness } = watched([[cx, cz]], { ...(bytes ? { map: bytes as Uint8Array<ArrayBuffer> } : {}), wakeRadius: 5 });
const list = flock(harness, 100, (rng) => {
  const a = rng.float() * Math.PI * 2;
  const d = 120 * Math.sqrt(rng.float());
  return [cx + Math.sin(a) * d, cz + Math.cos(a) * d];
});
harness.run(minutes * 60 * 1000);
const ents = harness.world.ents;
const hf = harness.world.hf;

/** A camera at (x, y, z) looking at (tx, ty, tz), as a view: y over the ground there, and degrees. */
const aim = (x: number, y: number, z: number, tx: number, ty: number, tz: number): [number, number, number, number, number] => [
  x, y - hf.heightAt(x, z), z,
  (Math.atan2(tx - x, tz - z) * 180) / Math.PI,
  (Math.atan2(ty - y, Math.hypot(tx - x, tz - z)) * 180) / Math.PI,
];
// The flyer in the air nearest the middle of those in the air is the one framed.
const up = list.filter((e) => ents.mode[e] === 5);
const mid = [0, 1, 2].map((k) => up.reduce((a, e) => a + [ents.x, ents.y, ents.z][k]![e]!, 0) / Math.max(1, up.length));
const focus = up.reduce((best, e) => (Math.hypot(ents.x[e]! - mid[0]!, ents.z[e]! - mid[2]!) < Math.hypot(ents.x[best]! - mid[0]!, ents.z[best]! - mid[2]!) ? e : best), up[0] ?? list[0]!);
const at: [number, number, number] = [ents.x[focus]!, ents.y[focus]! + 1, ents.z[focus]!];
const views: [number, number, number, number, number][] = arg("views")?.split(";").map((v) => v.split(",").map(Number) as [number, number, number, number, number]) ?? [];
if (views.length === 0) {
  // From free air 30 m behind it and a little above, the way round nearest behind it first.
  const back = Math.atan2(-ents.vx[focus]!, -ents.vz[focus]!);
  for (let k = 0; k < 16 && views.length < 1; k++) {
    const a = back + (k % 2 === 0 ? k / 2 : -(k + 1) / 2) * (Math.PI / 8);
    const [x, y, z] = [at[0] + Math.sin(a) * 30, at[1] + 8, at[2] + Math.cos(a) * 30];
    if (capsuleFree(harness.world, x, y - 1, z, 1, 2)) views.push(aim(x, y, z, ...at));
  }
  // From open ground 20 to 120 m off, where a survivor could stand and look up at it.
  for (let d = 20; d <= 120 && views.length < 2; d += 10) {
    for (let k = 0; k < 16; k++) {
      const [x, z] = [at[0] + Math.sin((k * Math.PI) / 8) * d, at[2] + Math.cos((k * Math.PI) / 8) * d];
      const y = hf.heightAt(x, z);
      if (y < hf.seaLevel || !openSky(harness.world, 1, x, y, z)) continue;
      views.push(aim(x, y + 1.7, z, ...at));
      break;
    }
  }
}

mkdirSync(out, { recursive: true });
views.forEach(([x, y, z, yaw, pitch], i) => {
  const view = provingView(w, h, undefined, undefined, mapFile);
  // Each body where the server has it, posed as it sent it.
  const r = view.remote;
  r.count = 0;
  r.tick = harness.world.tick;
  for (const e of list) {
    const n = r.count++;
    r.id[n] = 1000 + n;
    r.kind[n] = ents.kind[e]!;
    r.x[n] = ents.x[e]!;
    r.y[n] = ents.y[e]!;
    r.z[n] = ents.z[e]!;
    r.yaw[n] = (ents.yaw[e]! / 65536) * Math.PI * 2;
    r.flags[n] = ents.flags[e]! & 3;
    r.anim[n] = ents.anim[e]!;
    r.cue[n] = ents.cue[e]!;
  }
  // A camera's y is over the ground there.
  view.cam.x = x;
  view.cam.z = z;
  view.cam.y = view.hf.heightAt(x, z) + y;
  view.cam.yaw = (yaw * Math.PI) / 180;
  view.cam.pitch = (pitch * Math.PI) / 180;
  if (mapFile) view.nodes.retain(chunkAt(mapFile.dims, x, z), 4, 1, () => false);
  view.render();
  const file = join(out, `view-${i + 1}.png`);
  writeFileSync(file, encodePng(w, h, view.raster.color));
  const aloft = list.filter((e) => ents.mode[e] === 5).length;
  console.log(`${file}  ${aloft} of ${list.length} in the air`);
});
harness.host.shutdown();
process.exit(0);
