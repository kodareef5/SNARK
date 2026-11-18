// Measure finite source hit envelopes; does not mutate the asset or native pack.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePack} from '../../shared/pack/pack.ts';
import {unpackMeshes} from '../pack/write.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
const bytes=readFileSync('assets/source/core/creatures/stego/stego.snpk'),pack=parsePack(bytes),rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const mesh=unpackMeshes(pack).find(m=>m.id==='core:stego')!.lods[0]!;
const groups=[...Array.from({length:16},(_,i)=>[`plate_${String(i).padStart(2,'0')}`]),['skull','lid_l','lid_r'],['jaw'],...['neck_1','neck_2','neck_3'].map(name=>[name]),...['l','r'].flatMap(side=>[[`hind_upper_${side}`],[`hind_lower_${side}`,`hind_foot_${side}`]])];
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
const report=[];
for(const names of groups){
 const ids=names.map(n=>rig.names.indexOf(n)),bone=ids[0]!,points:number[][]=[];
 for(let v=0;v<mesh.positions.length/3;v++)if(ids.includes(mesh.bones![v]!))points.push(Array.from(mesh.positions.slice(v*3,v*3+3)));
 const mean=[0,1,2].map(k=>points.reduce((s,p)=>s+p[k]!,0)/points.length),centred=points.map(p=>p.map((v,k)=>v-mean[k]!));
 const covariance=[0,1,2].map(i=>[0,1,2].map(j=>centred.reduce((s,p)=>s+p[i]!*p[j]!,0)));
 let axis=[.31,.47,.83];
 for(let step=0;step<64;step++){const next=covariance.map(row=>dot(row,axis)),length=Math.hypot(...next);if(length<1e-12)break;axis=next.map(v=>v/length);}
 const candidates=[];
 // Surface tessellation density is not anatomical importance. An orbit with
 // many small faces can make PCA choose the width; test cardinal directions
 // too and retain the smallest actual finite enclosing volume.
 for(const direction of [axis,[1,0,0],[0,1,0],[0,0,1]]){
 const projection=centred.map(p=>{const t=dot(p,direction);return {t,rho:Math.hypot(...p.map((v,k)=>v-t*direction[k]!))};});
 const minRadius=Math.max(.003,...projection.map(p=>p.rho));
 for(let step=0;step<=20;step++){
  const radius=minRadius*(1+step/100)+.0001;
  let low=Math.min(...projection.map(p=>p.t+Math.sqrt(radius*radius-p.rho*p.rho))),high=Math.max(...projection.map(p=>p.t-Math.sqrt(radius*radius-p.rho*p.rho)));
  if(high<low)low=high=(low+high)/2;
  const local=(t:number)=>direction.map((v,k)=>mean[k]!+v*t-rig.rest[bone*3+k]!);
  const length=high-low,volume=Math.PI*radius*radius*length+4/3*Math.PI*radius**3;
  candidates.push({a:local(low),b:local(high),radius,volume});
 }
 }
 candidates.sort((a,b)=>a.volume-b.volume);
 report.push({bone:names[0],covers:names,vertices:points.length,fullFiniteEnvelope:candidates[0],note:'Finite capsule contains all selected rest vertices; this is not triangle-accurate hit shape. Native posed rays must independently measure misses and empty-space hits.'});
}
writeFileSync('var/stego-review/hit-envelope.json',JSON.stringify({packSha256:createHash('sha256').update(bytes).digest('hex'),groups:report},null,2)+'\n');
console.log(report.map(r=>[r.bone,r.vertices,r.fullFiniteEnvelope!.radius]));
