// Physical pad witnesses from the actual finest native weighted surface.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeBones } from '../../client/core/render/characters.ts';
import { sampleClip } from '../../shared/anim/clip.ts';
import { buildRig } from '../../shared/anim/rigs.ts';
import { boneToModel, solve } from '../../shared/anim/skeleton.ts';
import { parsePack } from '../../shared/pack/pack.ts';
import { unpackMeshes } from '../pack/write.ts';

const bytes=readFileSync('assets/source/core/creatures/trike/trike.snpk'),pack=parsePack(new Uint8Array(bytes));
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!,mesh=unpackMeshes(pack).find(m=>m.id==='core:trike')!.lods[0]!;
const matrices=new Float32Array(rig.bones*12),points=new Float64Array(mesh.positions.length),socketAt=new Float64Array(3),report=[];
for(const [clip,frame] of [['idle',0],['walk',8],['run',4],['charge',4]] as const){
 sampleClip(rig.clips.get(clip)!,frame,rig.a);solve(rig,rig.a,rig.solved);writeBones(matrices,0,rig.solved,rig.rest,null,0,0,0,0);
 for(let vertex=0;vertex<points.length/3;vertex++)for(let axis=0;axis<3;axis++){
  let value=0;
  for(let k=0;k<(mesh.weights?4:1);k++){
   const weight=mesh.weights?.[vertex*4+k]??1,bone=mesh.joints?.[vertex*4+k]??mesh.bones![vertex]!,at=bone*12+axis*4;
   value+=weight*(matrices[at]!*mesh.positions[vertex*3]!+matrices[at+1]!*mesh.positions[vertex*3+1]!+matrices[at+2]!*mesh.positions[vertex*3+2]!+matrices[at+3]!);
  }
  points[vertex*3+axis]=value;
 }
 for(const name of ['foot_l','foot_r','rear_foot_l','rear_foot_r']){
  const socket=rig.sockets.get(name)!;boneToModel(rig.solved,socket.bone,socket.x,socket.y,socket.z,socketAt);
  let closest=Infinity,height=Infinity,triangle=-1;
  for(let i=0;i<mesh.indices.length;i+=3){
   const a=mesh.indices[i]!*3,b=mesh.indices[i+1]!*3,c=mesh.indices[i+2]!*3;
   const det=(points[b+2]!-points[c+2]!)*(points[a]!-points[c]!)+(points[c]!-points[b]!)*(points[a+2]!-points[c+2]!);
   if(Math.abs(det)<1e-12)continue;
   const u=((points[b+2]!-points[c+2]!)*(socketAt[0]!-points[c]!)+(points[c]!-points[b]!)*(socketAt[2]!-points[c+2]!))/det;
   const v=((points[c+2]!-points[a+2]!)*(socketAt[0]!-points[c]!)+(points[a]!-points[c]!)*(socketAt[2]!-points[c+2]!))/det,w=1-u-v;
   if(Math.min(u,v,w)<-1e-8)continue;
   const y=u*points[a+1]!+v*points[b+1]!+w*points[c+1]!,distance=Math.abs(y-socketAt[1]!);
   if(distance<closest){closest=distance;height=y;triangle=i/3;}
  }
  report.push({clip,frame,socket:name,point:[...socketAt],surface_height:height,separation:socketAt[1]!-height,triangle});
 }
}
const result={pack_sha256:createHash('sha256').update(bytes).digest('hex'),scope:'Vertical ray through each authored sole witness onto the nearest actual finest native weighted triangle, in four explicit poses. This does not certify terrain fitting or every gait frame.',samples:report};
writeFileSync('var/trike-art/foot-witnesses.json',JSON.stringify(result,null,2)+'\n');
console.log(result);
