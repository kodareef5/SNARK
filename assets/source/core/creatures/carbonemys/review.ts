// Native species, clips and original material maps; optionally renders a worn saddle with the same solved rig.
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { join,resolve } from "node:path";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { sampleClip } from "../../../../../shared/anim/clip.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { boneToModel,solve } from "../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { nearestColour } from "../../../../../shared/pack/palette.ts";

const path=process.argv[2]??"var/carbonemys/views";
mkdirSync(path,{recursive:true});
const asset=(await findAssets(resolve("assets/source"))).find(a=>a.id==="core:carbonemys")!;
if (asset.spec.kind!=="creature") throw new Error("Missing Carbonemys native asset");
const bytes=readFileSync(asset.file),pack=parsePack(bytes);
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const materials=materialsOf(asset),view=new ModelView(pack,1100,760,[.74,.80,.82]);
for(const [slot,t]of pack.header.textures!.entries()){
  const material=materials.find(m=>t.id===m.id+"/"+t.role)!;
  view.texture(slot,t.role,rgbaOf(material,t.role,t.top).pictures);
}
const colors=asset.spec.regions!.map(r=>r.sample);
const dyed=[[59,85,69],[155,119,65],[96,110,132],[167,130,98],[64,51,55],[211,187,138]].map(([r,g,b])=>nearestColour(pack.palette,r!,g!,b!));
const rows=[];
const shots=[
  ["quarter","idle",0,42,13,0,.93,.08,2.42],["profile","idle",0,89,6,0,.95,.06,2.46],
  ["shell","idle",0,137,40,0,1.16,-.12,2.05],["head","idle",0,48,10,0,1.21,1.97,.69],
  ["saddle","idle",0,47,19,0,1.12,.05,2.49],["saddle-close","idle",0,74,28,0,1.65,.44,1.03],
  ["plastron","idle",0,132,-56,0,.83,-.04,2.22],
  ["walk","walk",7,58,8,0,.83,.09,2.35],["run","run",5,58,8,0,.83,.09,2.35],
  ["swim","swim",7,44,6,0,.85,.08,2.39],["bite","attack",10,62,7,0,1.10,1.74,.94],
  ["guard","retract",18,46,23,0,.99,.52,1.83],["torpor","torpor_idle",18,54,8,0,.81,.05,2.32],
  ["death","death",43,65,11,0,.79,.08,2.35],["dyed","idle",0,43,16,0,.93,.08,2.41],
  ["hurt","idle",0,56,19,0,.93,.08,2.41],["decay","death",43,56,19,0,.80,.08,2.41],
] as const;
for(const [name,clip,frame,around,above,x,y,z,radius]of shots){
  sampleClip(rig.clips.get(clip)!,frame,rig.a);solve(rig,rig.a,rig.solved);
  view.draw({mesh:pack.meshIndex.get("core:carbonemys")!,also:name.startsWith("saddle")?[pack.meshIndex.get("core:saddle_carbonemys/worn")!]:[],level:0,rig,colors:name==="dyed"?dyed:colors,around,above,centre:[x,y,z],radius,textured:true,layer:name==="hurt"?48:name==="decay"?96:0});
  const png=encodePng(view.raster.width,view.raster.height,view.raster.color);
  writeFileSync(join(path,name+".png"),png);
  rows.push({name,clip,frame,sha256:createHash("sha256").update(png).digest("hex")});
}
const jaw=rig.names.indexOf("skull"),attack=[];
for(let t=0;t<25;t++){
  sampleClip(rig.clips.get("attack")!,t,rig.a);solve(rig,rig.a,rig.solved);
  const p=[0,0,0];boneToModel(rig.solved,jaw,0,-.055,.608,p);attack.push(p.map(v=>+v.toFixed(5)));
}
writeFileSync(join(path,"views.json"),JSON.stringify({packSha256:createHash("sha256").update(bytes).digest("hex"),rig:rig.id,colors,bodyLods:pack.header.meshes[0]!.lods.map(l=>l.indexCount/3),attackMouthByTick:attack,rows},null,2)+"\n");
