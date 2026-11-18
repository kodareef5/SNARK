// Draw the equipped and bare animal with its production mesh, game rig and noon light.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { sampleClip } from "../../../../../../shared/anim/clip.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../../shared/anim/skeleton.ts";
import { findAssets } from "../../../../../../tools/art/assets.ts";
import { materialsOf, mipsOf } from "../../../../../../tools/art/materials.ts";
import { eachTexture } from "../../../../../../tools/pack/encode.ts";
import { decodeBc5, decodeBc7 } from "../../../../../../tools/pack/bc.ts";
import { ModelView } from "../../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";

const asset = (await findAssets()).find(a=>a.id==="core:raptor")!;
if (asset.spec.kind!=="creature") throw Error("Raptor asset missing");
const bytes=readFileSync(asset.file), pack=parsePack(bytes);
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const view=new ModelView(pack,900,550,[.73,.77,.77]);
const mats=materialsOf(asset), colors=asset.spec.regions!.map(r=>r.sample);
const body=pack.meshIndex.get(asset.id)!, saddle=pack.meshIndex.get("core:saddle_raptor/worn")!;
const out=resolve("var/raptor/review"); mkdirSync(out,{recursive:true});
const quick=process.argv.includes("--rgba");
const textures=(pack.header.textures??[]).map(t=>{
  const mat=mats.find(m=>t.id===m.id+"/"+t.role)!;
  return {...t,mat,mips:()=>mipsOf(mat,t.role,t.top)};
});
if (quick) textures.forEach((t,i)=>view.texture(i,t.role,rgbaOf(t.mat,t.role,t.top).pictures));
else {
  let i=0;
  await eachTexture(textures,{workers:3},async variants=>{
    const t=textures[i]!;
    const mips=variants.bc.pictures.map((bytes,k)=>{
      const side=1<<k;
      if(t.role!=="normal") return decodeBc7(bytes,side,side);
      const rgba=decodeBc5(bytes,side,side);
      return Uint8Array.from({length:side*side*2},(_,j)=>rgba[(j>>1)*4+(j&1)]!);
    });
    view.texture(i++,t.role,mips);
  });
}
const whole=[0,.81,-.39] as const;
const shots: {id:string; clip:string; frame:number; around:number; above:number; centre:readonly number[]; radius:number; level:number; tack:boolean}[]=[];
function draw(id:string,clip:string,frame:number,around:number,above:number,centre:readonly [number,number,number],radius:number,level=0,tack=false) {
  shots.push({id,clip,frame,around,above,centre,radius,level,tack});
  sampleClip(rig.clips.get(clip)!,frame,rig.a); solve(rig,rig.a,rig.solved);
  view.draw({mesh:body,level,also:tack?[saddle]:[],around,above,centre,radius,rig,colors,textured:true});
  writeFileSync(resolve(out,id+".png"),encodePng(view.raster.width,view.raster.height,view.raster.color));
}
draw("profile","idle",0,89,3,whole,1.29);
draw("quarter","idle",0,48,17,[0,.84,-.22],1.20,2);
draw("distance-profile","idle",0,89,3,whole,8.8,2);
draw("distance-quarter","idle",0,48,17,[0,.84,-.22],8.8,2);
draw("face","idle",0,73,6,[0,1.44,1.116],.245);
draw("claw","idle",0,40,13,[.091,.134,.005],.254);
draw("saddle","idle",0,59,18,[0,1.13,.08],.61,0,true);
draw("wing","idle",0,86,8,[.21,.866,.399],.295);
draw("tail","idle",0,146,37,[0,1.06,-1.83],.41);
for (const frame of [0,3,6,9]) draw("run-"+frame,"run",frame,78,7,whole,1.27,2);
for (const frame of [0,5,11]) draw("bite-"+frame,"attack",frame,72,3,[0,1.26,.91],.59,1);
draw("rest","torpor_idle",21,63,16,[0,.48,-.36],1.21,2);
draw("swim","swim",10,73,10,whole,1.26,2);
for(const [i,t] of textures.entries()) {
  const pixel=t.role==="base"?[185,185,185,255]:t.role==="normal"?[128,128]:t.role==="mro"?[255,215,0,255]:[0,0,0,0];
  view.texture(i,t.role,[Uint8Array.from(pixel)]);
}
draw("clay","idle",0,48,17,[0,.84,-.22],1.20,2);
writeFileSync(resolve(out,"receipt.json"),JSON.stringify({packSha256:createHash("sha256").update(bytes).digest("hex"),textureFormat:quick?"rgba":"bc",light:"game noon",mesh:asset.id,fullProfileLOD:0,matchedQuarterLOD:2,clip:"idle",frame:0,shots},null,2)+"\n");
