// Projects points on a conservative interior ellipsoid into native renders. Every ray
// through this volume should meet an opaque outer surface in front of the sample.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { sampleClip } from "../../../../../shared/anim/clip.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { PICK_SKY } from "../../../../../tools/snap/raster.ts";
import asset from "./asset.ts";

const name = "assets/source/core/creatures/carbonemys/carbonemys.snpk";
const pack = parsePack(readFileSync(name));
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
sampleClip(rig.clips.get("idle")!, 0, rig.a);
solve(rig, rig.a, rig.solved);
const view = new ModelView(pack, 420, 310, [.74, .8, .82]);
const out = process.argv[2] ?? "var/carbonemys/shell-review";
mkdirSync(out, { recursive: true });
const points: number[][] = [];
for (let lat = -28; lat <= 28; lat++) {
  for (let lon = 0; lon < 112; lon++) {
    const az = lon * Math.PI / 56, el = lat * Math.PI / 56;
    points.push([1.01 * Math.cos(el) * Math.cos(az), 1.01 + .37 * Math.sin(el), -.07 + 1.38 * Math.cos(el) * Math.sin(az)]);
  }
}
const reports = [];
const levelCount = pack.header.meshes[0]!.lods.length;
for (let level = 0; level < levelCount; level++) {
  let rays = 0, sky = 0, behind = 0;
  const checks: { around: number; above: number; sky: number; behind: number }[] = [];
  for (const above of [-75, -25, 9, 43, 82]) {
    for (const around of [0, 45, 90, 135, 180, 225, 270, 315]) {
      view.draw({mesh:pack.meshIndex.get("core:carbonemys")!,level,rig,colors:asset.regions.map(r=>r.sample),
        around,above,centre:[0,1,-.07],radius:2.45});
      const p = [0, 0, 0];
      let missing = 0, past = 0;
      for (const [x,y,z] of points) {
        view.project(x!,y!,z!,p);
        const i = Math.floor(p[1]!) * view.raster.width + Math.floor(p[0]!);
        if (view.raster.pickKind[i] === PICK_SKY) missing++;
        else if (view.raster.depth[i]! > p[2]! + .001) past++;
      }
      if (missing || past) checks.push({around,above,sky:missing,behind:past});
      rays += points.length; sky += missing; behind += past;
      if ((around===45 && above===9)||(around===135 && above===43)||(around===0 && above===82)||(around===180 && above===-75)) {
        writeFileSync(join(out,`lod${level}-${around}-${above}.png`),encodePng(420,310,view.raster.color));
      }
    }
  }
  reports.push({level,angles:40,rays,sky,behind,checks});
}
writeFileSync(join(out,"shell-coverage.json"),JSON.stringify(reports,null,2)+"\n");
console.log(reports.map(({level,rays,sky,behind})=>({level,rays,sky,behind})));
if (reports.some(r=>r.sky||r.behind)) process.exitCode=1;
