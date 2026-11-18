// Authored stance windows, sampled fractionally from the actual native clips.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { sampleClip } from '../../shared/anim/clip.ts';
import { buildRig } from '../../shared/anim/rigs.ts';
import { boneToModel,solve } from '../../shared/anim/skeleton.ts';
import { parsePack } from '../../shared/pack/pack.ts';
const bytes=readFileSync('assets/source/core/creatures/trike/trike.snpk'),pack=parsePack(new Uint8Array(bytes));
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!,point=new Float64Array(3),samples=[];
for(const name of ['walk','run','charge']){
 const clip=rig.clips.get(name)!,stride=rig.strides.get(name)!,fast=name!=='walk';
 for(const [socketName,offset] of [['foot_l',0],['rear_foot_r',fast?.12:.25],['foot_r',.5],['rear_foot_l',fast?.62:.75]] as const){
  const socket=rig.sockets.get(socketName)!;let origin:number[]|null=null,previous:number[]|null=null,max=0,step=0,frames=0;
  for(let i=0;i<1200;i++){
   const t=i/600,phase=(t+offset)%1;
   if(phase>.0&&phase<(fast?.39:.6)){
    sampleClip(clip,(t%1)*clip.frames,rig.a);solve(rig,rig.a,rig.solved);
    boneToModel(rig.solved,socket.bone,socket.x,socket.y,socket.z,point);point[2]!+=t*stride;
    const p=[...point];origin??=p;
    max=Math.max(max,Math.hypot(...p.map((v,k)=>v-origin![k]!)));
    if(previous)step=Math.max(step,Math.hypot(...p.map((v,k)=>v-previous![k]!)));
    previous=p;frames++;
   }else origin=previous=null;
  }
  samples.push({clip:name,socket:socketName,samples:frames,drift_m:max,step_m:step});
 }
}
const report={pack_sha256:createHash('sha256').update(bytes).digest('hex'),
 scope:'Two native gait cycles at 600 fractional samples/cycle, actual authored stance windows, with declared stride travel. No walk/run blending or terrain correction.',samples};
writeFileSync('var/trike-art/fractional-stride.json',JSON.stringify(report,null,2)+'\n');console.log(report);
