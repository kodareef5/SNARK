// Measured native plantar witnesses around authored touchdown/lift boundaries.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePack} from '../../shared/pack/pack.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {sampleClip} from '../../shared/anim/clip.ts';
import {boneToModel,solve} from '../../shared/anim/skeleton.ts';
const bytes=readFileSync('assets/source/core/creatures/stego/stego.snpk'),pack=parsePack(new Uint8Array(bytes)),rig=buildRig(pack.header.rigs[0]!,pack.clips)!,rows=[];
for(const name of ['walk','run']){
 const clip=rig.clips.get(name)!;
 for(const event of rig.footfalls.get(name)??[]){
  const bone=rig.names[event.bone]!,s=rig.sockets.get(bone)!,at=[0,0,0],sample=(phase:number)=>{sampleClip(clip,phase*clip.frames,rig.a);solve(rig,rig.a,rig.solved);boneToModel(rig.solved,s.bone,s.x,s.y,s.z,at);return [...at];};
  const rest=sample(event.plant)[1]!,around=(phase:number)=>[-.5,0,.5,1].map(delta=>({frameDelta:delta,position:sample(phase+delta/clip.frames),heightAbovePlant:sample(phase+delta/clip.frames)[1]!-rest}));
  rows.push({clip:name,bone,plant:event.plant,lift:event.lift,plantSamples:around(event.plant),liftSamples:around(event.lift)});
 }
}
const report={packSha256:createHash('sha256').update(bytes).digest('hex'),scope:'Actual native plantar socket coordinates; phase0 is hind-left farthest-forward. Plant/lift are native linear-key boundaries, not the unsampled continuous source duty.',rows};
writeFileSync('var/stego-review/footfalls.json',JSON.stringify(report,null,2)+'\n');console.log(rows.map(r=>({clip:r.clip,bone:r.bone,plant:r.plant,lift:r.lift,beforePlant:r.plantSamples[0]!.heightAbovePlant,afterLift:r.liftSamples[2]!.heightAbovePlant})));
