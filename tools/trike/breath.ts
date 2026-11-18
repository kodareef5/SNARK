// Posed breathing witnesses from the shipped native skeleton and clips.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { sampleClip } from '../../shared/anim/clip.ts';
import { buildRig } from '../../shared/anim/rigs.ts';
import { boneToModel, solve } from '../../shared/anim/skeleton.ts';
import { parsePack } from '../../shared/pack/pack.ts';

const bytes=readFileSync('assets/source/core/creatures/trike/trike.snpk');
const pack=parsePack(new Uint8Array(bytes)),rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const point=new Float64Array(3),ranges:Record<string,unknown>={};
for(const name of ['idle','swim','swim_idle','torpor_in','torpor_idle','torpor_out']){
 const clip=rig.clips.get(name)!;
 const sides:Record<string,number[]>={breath_l:[Infinity,-Infinity],breath_r:[Infinity,-Infinity]};
 const accessible=[Infinity,-Infinity];
 for(let frame=0;frame<clip.frames;frame++){
  sampleClip(clip,frame,rig.a);solve(rig,rig.a,rig.solved);
  let higher=-Infinity;
  for(const key of Object.keys(sides)){
   const socket=rig.sockets.get(key)!;
   boneToModel(rig.solved,socket.bone,socket.x,socket.y,socket.z,point);
   sides[key]![0]=Math.min(sides[key]![0]!,point[1]!);
   sides[key]![1]=Math.max(sides[key]![1]!,point[1]!);
   higher=Math.max(higher,point[1]!);
  }
  accessible[0]=Math.min(accessible[0]!,higher);accessible[1]=Math.max(accessible[1]!,higher);
 }
 ranges[name]={frames:clip.frames,sides,accessible_upper_opening:accessible};
}
const report={pack_sha256:createHash('sha256').update(bytes).digest('hex'),
 scope:'Every integer native frame of the named clips. Height is relative to the creature origin. The higher accessible paired opening is retained separately; one submerged nostril does not imply both are submerged.',ranges};
writeFileSync('var/trike-art/breath-witnesses.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
