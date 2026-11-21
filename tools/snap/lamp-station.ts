// bun tools/snap/lamp-station.ts <miami.snmap> <built assets directory> [east north]
//
// The GPU bench's lamp station (tools/bench/gpu.ts CITY_PLACES.lamp), or the place of another of its stations in metres
// from the map's centre as the bench gives them, at 22:00 on high, the view turned round in eight steps as the bench's
// turns: for each, whether the street lamp lights (render/lamp.ts), and what its map takes, casters and triangles,
// against the cascades'.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { MapStatics, mapHeightfield, parseMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { LAMP_BIT } from "../../client/core/render/lamp.ts";
import { DRAW_RANGED, DRAW_TEXTURED, LAMP_AT } from "../../client/core/render/packet.ts";
import { provingView, settle } from "../snap.ts";

const [mapPath, assets] = process.argv.slice(2);
if (!mapPath || !assets) throw new Error("Expected Miami map and built assets directory");
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));
const centre = (map.dims.chunksX * 64) / 2;
const [east, north] = process.argv.length > 5 ? [Number(process.argv[4]), Number(process.argv[5])] : [889, -2961];
const [x, z] = [centre - east, centre + north];
const t = map.statics, rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) if (Math.hypot(t.x[i]! - x, t.z[i]! - z) < 260) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
const v = provingView(640, 360, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote } = v;
scene.assets.tier = tierOf("high");
scene.viewHeight = 360;
scene.hour = 22;
[cam.x, cam.y, cam.z, cam.pitch] = [x, hf.heightAt(x, z) + 1.7, z, 0];
v.nodes.retain(Math.floor(z / 64) * map.dims.chunksX + Math.floor(x / 64), 64, 3, () => false);
for (let k = 0; k < 8; k++) {
  cam.yaw = (k / 8) * 2 * Math.PI;
  settle(v);
  const p = scene.build(cam, remote);
  let lamp = 0, lampTris = 0, all = 0;
  for (let e = 0; e < p.casterCount; e++) {
    const tris = ((p.casterFlags[e]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.casterIndexCount[e]! / 3 : scene.assets.table.tris[p.casterMesh[e]!]?.[p.casterLod[e]!] ?? 0) * p.casterInstances[e]!;
    all += tris;
    if ((p.casterCascades[e]! & LAMP_BIT) === 0) continue;
    lamp++;
    lampTris += tris;
  }
  console.log(`yaw ${(k * 45).toString().padStart(3)}: lamp ${p.frame[LAMP_AT + 3]! > 0 ? "lights" : "out"}, shows ${scene.streetLamps.shows.toFixed(2)}, lens ${Array.from(p.frame.subarray(LAMP_AT, LAMP_AT + 3), (n) => n.toFixed(1)).join(" ")}; its map ${lamp} casters, ${Math.round(lampTris / 1000)}k triangles; all casters ${p.casterCount}, ${Math.round(p.castTriangles / 1000)}k triangles cast`);
}
