/** Native rest, working poses and matched previous-pack studies.
 * Before/after uses the original pack from a supplied file (--before), with identical camera and dyes.
 * Run from the repository root: bun assets/source/core/creatures/parasaur/review.ts [--before=FILE].
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { NEUTRAL } from "../../../../../client/core/render/surface.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { sampleClip } from "../../../../../shared/anim/clip.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { PARASAUR_DYES } from "../../../../../content/creatures/parasaur.ts";

const dir = resolve("var/parasaur/views");
mkdirSync(dir, { recursive: true });
const asset = (await findAssets(resolve("assets/source"))).find(a => a.id === "core:parasaur")!;
const maps = materialsOf(asset);
const samplePalette = parsePack(new Uint8Array(readFileSync(asset.file))).palette;
const before = process.argv.find(a => a.startsWith("--before="))?.slice(9);

// Every anatomical comparison uses an identical camera, including its focal distance.
const shots = [
  ["profile","idle",0,90,3,1.72,-.54,2.55], ["quarter","idle",0,56,10,1.78,-.30,2.58],
  ["crest","idle",0,68,7,2.90,2.30,1.12], ["face","idle",0,48,6,2.69,2.54,.72],
  ["saddle","idle",0,59,19,1.77,-.25,2.58], ["tack","idle",0,54,26,2.15,.61,.94],
  ["approach","idle",0,64,7,1.72,-.34,2.58], ["hoof","idle",0,62,8,.37,.97,.72],
  ["hurt","idle",0,56,10,1.78,-.30,2.58],["decay","death",45,62,11,.84,-.35,2.67],
  ["walk","walk",5,80,5,1.70,-.43,2.55],["run","run",7,80,5,1.68,-.42,2.55],
  ["swim","swim",12,70,5,1.68,-.39,2.58],["call","call",20,61,5,1.93,-.25,2.69],
  ["attack","attack",11,76,4,1.68,-.36,2.57], ["prone","torpor_idle",20,62,12,.86,-.42,2.65],
] as const;

for (const [version, file] of [["new",asset.file], ...(before?[["previous",before]]:[])]) {
  for (const style of ["paint","clay"] as const) {
    const bytes = new Uint8Array(readFileSync(file!)), pack = parsePack(bytes);
    // The archived pack carries an older palette. Match the actual four RGB
    // swatches so a palette reordering cannot color the comparison.
    if (version === "previous") for (const i of PARASAUR_DYES) pack.palette.set(samplePalette.slice(i*4,i*4+4),i*4);
    if (style === "clay") for (let i=0; i<pack.palette.length; i+=4) pack.palette.set([172,169,154],i);
    const rig = buildRig(pack.header.rigs[0]!,pack.clips)!;
    const view = new ModelView(pack,900,560,[.79,.81,.79]);
    if (version==="new") for (const [i,t] of (pack.header.textures??[]).entries()) {
      const m = maps.find(m => t.id === m.id+"/"+t.role)!;
      const clay = t.role === "base" ? [172,169,154,255] : NEUTRAL[t.role].slice(0,t.role==="normal"?2:4);
      view.texture(i,t.role,style==="clay"?[Uint8Array.from(clay)]:rgbaOf(m,t.role,t.top).pictures);
    }
    for (const [shot,clip,frame,around,above,cy,cz,radius] of shots) {
      if (version==="previous" && !["profile","quarter","walk","run"].includes(shot)) continue;
      if (style==="clay" && !["profile","quarter","crest","walk","run","swim"].includes(shot)) continue;
      sampleClip(rig.clips.get(clip)!,frame,rig.a);
      solve(rig,rig.a,rig.solved);
      view.draw({mesh:pack.meshIndex.get("core:parasaur")!, level:shot==="approach"?2:0,
        also:["saddle","tack"].includes(shot)?[pack.meshIndex.get("core:saddle_parasaur/worn")!]:[],
        rig,colors:PARASAUR_DYES,around,above,centre:[0,cy,cz],radius,
        textured:version==="new", layer:shot==="hurt"?48:shot==="decay"?96:0});
      writeFileSync(join(dir,`${version}-${style}-${shot}.png`),encodePng(view.raster.width,view.raster.height,view.raster.color));
    }
    if (version==="new" && style==="paint") {
      const motion = new ModelView(pack,420,250,[.79,.81,.79]);
      for (const [i,t] of pack.header.textures!.entries()) {
        const m = maps.find(m=>t.id===m.id+"/"+t.role)!;
        motion.texture(i,t.role,rgbaOf(m,t.role,t.top).pictures);
      }
      for (const clipName of ["walk","run","swim"]) {
        const clip=rig.clips.get(clipName)!;
        for (let frame=0;frame<clip.frames;frame++) {
          sampleClip(clip,frame,rig.a); solve(rig,rig.a,rig.solved);
          motion.draw({mesh:pack.meshIndex.get("core:parasaur")!,level:1,rig,colors:PARASAUR_DYES,
            around:64,above:6,centre:[0,1.66,-.35],radius:2.47,textured:true});
          writeFileSync(join(dir,`motion-${clipName}-${frame}.png`),encodePng(motion.raster.width,motion.raster.height,motion.raster.color));
        }
      }
    }
  }
}
