// The same camera, pose and light on any revision of the original species folder.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parsePack, lodVertices, VERTEX_BYTES } from "../../../../../shared/pack/pack.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { sampleClip } from "../../../../../shared/anim/clip.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import spec from "./asset.ts";

const directory = resolve(process.argv[2] ?? "assets/source/core/creatures/carbonemys");
const out = resolve(process.argv[3] ?? "var/carbonemys/form");
mkdirSync(out, {recursive:true});
const file = join(directory,"carbonemys.snpk");
const bytes = readFileSync(file);
const pack = parsePack(bytes), clay = parsePack(Uint8Array.from(bytes));
for (const lod of clay.header.meshes[0]!.lods) {
  const v = lodVertices(clay, lod);
  for (let i=6; i<v.length; i+=VERTEX_BYTES) v[i]=91;
}
const materials=materialsOf({id:"core:carbonemys",name:"carbonemys",dir:directory,file,spec});
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const rows=[];
for (const [name,around,above,centre,radius,level,clayOnly] of [
  ["clay-quarter",47,12,[0,.95,.05],2.40,0,true],
  ["clay-profile",90,5,[0,.95,.05],2.46,0,true],
  ["clay-head",56,12,[0,1.15,1.94],.82,0,true],
  ["clay-limb",65,5,[.82,.47,.82],.77,0,true],
  ["game-quarter",47,12,[0,.95,.05],2.40,0,false],
  ["game-lod2",47,12,[0,.95,.05],2.40,2,false],
  ["shell",139,43,[0,1.1,-.1],2,1,false],
  ["face",58,8,[0,1.15,1.95],.82,0,false],
] as const) {
  const view=new ModelView(clayOnly?clay:pack,600,420,[.74,.80,.82]);
  if (!clayOnly) for (const [slot,t] of pack.header.textures!.entries()) {
    const m=materials.find(m=>t.id===m.id+"/"+t.role)!;
    view.texture(slot,t.role,rgbaOf(m,t.role,t.top).pictures);
  }
  sampleClip(rig.clips.get("idle")!,0,rig.a); solve(rig,rig.a,rig.solved);
  view.draw({mesh:0,level,rig,textured:!clayOnly,colors:spec.regions.map(r=>r.sample),around,above,centre,radius});
  const png=encodePng(view.raster.width,view.raster.height,view.raster.color);
  writeFileSync(join(out,name+".png"),png);
  rows.push({name,level,sha256:createHash("sha256").update(png).digest("hex")});
}
writeFileSync(join(out,"renders.json"),JSON.stringify({pack:createHash("sha256").update(bytes).digest("hex"),rows},null,2)+"\n");
