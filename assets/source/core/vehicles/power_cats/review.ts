// Render the shipped packs from both quarters, at the pilot socket and at every LOD.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POWER_CATS } from "../../../../../content/vehicles/power-cats.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Stage } from "../../../../../tests/fixtures/stage.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { unpackMeshes, type SourceLod } from "../../../../../tools/pack/write.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

/** X intersections of a transverse line at the specified height and station, including either hull. */
function section(lod: SourceLod, y: number, z: number, bone?: number): number[] {
  const p = lod.positions, hits: number[] = [];
  for (let i = 0; i < lod.indices.length; i += 3) {
    if (bone !== undefined && lod.bones?.[lod.indices[i]!] !== bone) continue;
    const a = 3 * lod.indices[i]!, b = 3 * lod.indices[i + 1]!, c = 3 * lod.indices[i + 2]!;
    const by = p[b + 1]! - p[a + 1]!, bz = p[b + 2]! - p[a + 2]!;
    const cy = p[c + 1]! - p[a + 1]!, cz = p[c + 2]! - p[a + 2]!;
    const det = by * cz - cy * bz;
    if (Math.abs(det) < 1e-8) continue;
    const dy = y - p[a + 1]!, dz = z - p[a + 2]!;
    const u = (dy * cz - cy * dz) / det, v = (by * dz - dy * bz) / det;
    if (u >= 0 && v >= 0 && u + v <= 1) hits.push(p[a]! + u * (p[b]! - p[a]!) + v * (p[c]! - p[a]!));
  }
  return hits.sort((a, b) => a - b);
}

const assets = await findAssets();
const width = 900, height = 480;
for (const model of POWER_CATS) {
  const asset = assets.find(a => a.id === model.id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(asset.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  const levels = unpackMeshes(pack)[mesh]!.lods;
  if (levels.length !== 6) throw Error(`${model.id} has ${levels.length} levels`);
  for (const [level, lod] of levels.entries()) {
    const widths: number[] = [];
    for (const z of [-.23, .037, .21].map(s => s * model.length)) {
      const sides = section(lod, model.draft, z);
      const port = sides.find(v => v > 0), starboard = sides.findLast(v => v < 0);
      if (sides.length !== 4 || port === undefined || starboard === undefined ||
          port < model.sponsonX * .35 || -starboard < model.sponsonX * .35)
        throw Error(`${model.id} L${level} tunnel section at Z=${z}: ${sides}`);
      widths.push(port - starboard);
    }
    // Probe above the hub on each propeller disk. An odd number of hull crossings puts the screw inside its keel.
    for (const [x, y, z] of [model.propeller, model.secondPropeller]) {
      const hull = section(lod, y + .14, z, rig.names.indexOf("chassis"));
      if (hull.filter(v => v < x).length % 2) throw Error(`${model.id} L${level} encloses its propeller at X=${x}`);
    }
    for (const name of ["steering", "propeller", "propeller_starboard"]) {
      if (!lod.bones?.includes(rig.names.indexOf(name))) throw Error(`${model.id} L${level} lost ${name}`);
    }
    console.log(`${model.id} L${level}: ${lod.indices.length / 3} triangles, measured tunnel widths ${widths.map(v => v.toFixed(2)).join(", ")} m`);
  }
  const materials = materialsOf(asset);
  const textures = (pack.header.textures ?? []).map(t => rgbaOf(materials.find(m => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));
  const colors = asset.spec.kind === "creature" ? asset.spec.regions.map(r => r.sample) : [];
  const folder = join(asset.dir, "ref", "review");
  mkdirSync(folder, { recursive: true });
  const write = (file: string, data: Uint8Array, w = width, h = height) =>
    writeFileSync(join(folder, file + ".png"), encodePng(w, h, data));
  const view = new ModelView(pack, width, height, [.82,.84,.86]);
  rig.a.rest();
  solve(rig, rig.a, rig.solved);
  textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));
  const centre = [0, model.height * .46, -.08] as const;
  const radius = model.length * .364;
  const draw = (level: number, around: number, above: number) =>
    view.draw({ mesh, level, around, above, centre, radius, colors, rig, textured: level < 2 });
  draw(0, 44, 17);
  write("front", new Uint8Array(view.raster.color));
  draw(0, 216, 15);
  write("stern", new Uint8Array(view.raster.color));
  view.draw({ mesh, level: 0, around: 195, above: -23, centre: [0, model.draft, -model.length * .31],
    radius: model.length * .27, colors, rig, textured: true });
  write("drives", new Uint8Array(view.raster.color));
  const lodW = width / 3, lodH = height / 3;
  const sheet = new Uint8Array(3 * lodW * 2 * lodH * 4);
  for (let level = 0; level < 6; level++) {
    draw(level, 36, 12);
    for (let y = 0; y < lodH; y++) for (let x = 0; x < lodW; x++) {
      const i = (y * 3 * width + x * 3) * 4, j = (((level / 3 | 0) * lodH + y) * width + level % 3 * lodW + x) * 4;
      sheet.set(view.raster.color.subarray(i, i + 4), j);
    }
  }
  write("levels", sheet, width, 2 * lodH);
  const stage = new Stage(pack, width, height);
  [stage.cam.x, stage.cam.y, stage.cam.z] = model.camera;
  [stage.cam.yaw, stage.cam.pitch, stage.cam.fovY] = [0, -.30, 1.27];
  stage.begin();
  textures.forEach((t, slot) => stage.texture(slot, t.role, t.pictures));
  const origin = { x: 0, y: 0, z: 0 };
  const ahead = { x: 2.7, y: 0, z: model.length * 2.35, yaw: 1.14 };
  stage.add(asset.id, 0, { ...origin, bone: stage.pose(rig, origin), regions: colors });
  stage.add(asset.id, 0, { ...ahead, bone: stage.pose(rig, ahead), regions: [14, 101, 101] });
  write("driver", new Uint8Array(stage.render()));
}
