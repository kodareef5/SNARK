// Offline finite-cylinder audit of complete native outfits, including deterministic interior creator looks.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeBones} from '../../client/core/render/characters.ts';
import {Pose} from '../../shared/anim/clip.ts';
import {HUMAN,HUMAN_BONES} from '../../shared/anim/human.ts';
import {defaultLook,lookScales,REGION_COUNT,setRegion} from '../../shared/anim/look.ts';
import {createMountMotion,mountPose} from '../../shared/anim/mount.ts';
import {fitRiderControls,RIDER_TARGET_FLOATS} from '../../shared/anim/rider-controls.ts';
let alignment=0;
import {RiderGrips} from '../../shared/anim/rider-grips.ts';
import {solve,Solved} from '../../shared/anim/skeleton.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {unpackMeshes} from '../pack/write.ts';
const bytes=readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk');
const source=parsePack(bytes),meshes=unpackMeshes(source),motion=createMountMotion();
type V=readonly[number,number,number];
function clip(p:V[],height:number,above:boolean):V[]{
 const q:V[]=[];for(let i=0;i<p.length;i++){
  const a=p[i]!,b=p[(i+1)%p.length]!,ia=above?a[1]>=height:a[1]<=height,ib=above?b[1]>=height:b[1]<=height;
  if(ia)q.push(a);if(ia!==ib){const t=(height-a[1])/(b[1]-a[1]);q.push([a[0]+(b[0]-a[0])*t,height,a[2]+(b[2]-a[2])*t]);}
 }return q;
}
function radial(poly:V[]):number{
 if(poly.length<3)return Infinity;let inside=false,best=Infinity;
 for(let i=0;i<poly.length;i++){
  const a=poly[i]!,b=poly[(i+1)%poly.length]!,dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,-(a[0]*dx+a[2]*dz)/n)):0;
  best=Math.min(best,Math.hypot(a[0]+t*dx,a[2]+t*dz));if((a[2]>0)!==(b[2]>0)&&0<(b[0]-a[0])*(-a[2])/(b[2]-a[2])+a[0])inside=!inside;
 }return inside?0:best;
}


function measure(sex:string,profile:string,dx=0,dy=0,dz=0,hardware='trike',customLook:Uint8Array|null=null,glove='hide',outfit='hide'){
 const rig=source.header.rigs.find(r=>r.id===`human_${sex}`)!,rest=Float32Array.from(rig.rest),look=customLook??defaultLook();
 if(!customLook&&profile!=='default'){for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,1);for(const r of [2,5,8,11,12,15,19])setRegion(look,r,profile==='short-wide'?-1:1);}
 const scale=new Float32Array(HUMAN_BONES*3),pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),t=new Float64Array(RIDER_TARGET_FLOATS);
 t.set(hardware==='trike'?[17,.19+dx,.86+dy,.27+dz,-.19-dx,.86+dy,.27+dz]:[17,.17+dx,.86+dy,.27+dz,-.17-dx,.86+dy,.27+dz]);
 t[30]=alignment;t[27]=hardware==='trike'?.017:.018;t[28]=hardware==='trike'?-.12:-.11;t[29]=hardware==='trike'?.13:.11;
 lookScales(look,scale);mountPose(motion,{role:'ride',tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scale);
 const grip=new RiderGrips().update(rig.grips!.find(g=>g.mesh===`core:human_${sex}/${glove==='bare'?'':`armor/${glove}/`}hands`)!,look,t[27]!,-.12,.13);
 const residual=fitRiderControls(pose,solved,rest,scale,t,true,undefined,null,grip),rows=new Float32Array(HUMAN_BONES*12);
 writeBones(rows,0,solved,rest,scale,0,0,0,0);
 const selected=['head','torso','hands','legs','feet'].map(slot=>meshes.find(m=>m.id===`core:human_${sex}/${(slot==='hands'?glove:outfit)==='bare'?'':`armor/${slot==='hands'?glove:outfit}/`}${slot}`)!);
 if(outfit!=='bare')selected.push(meshes.find(m=>m.id===`core:human_${sex}/head`)!);
 let clearance=Infinity,worst:any=null;
 for(const mesh of selected){const lod=mesh.lods[0]!;
 for(let side=0;side<2;side++)for(let i=0;i<lod.indices.length;i+=3){
  const ids=[lod.indices[i]!,lod.indices[i+1]!,lod.indices[i+2]!];if(ids.every(v=>side?lod.positions[v*3]!>0:lod.positions[v*3]!<0))continue;
  const poly=ids.map(v=>{const k=lod.bones![v]!*12,x=lod.positions[v*3]!,y=lod.positions[v*3+1]!,z=lod.positions[v*3+2]!;return[rows[k]!*x+rows[k+1]!*y+rows[k+2]!*z+rows[k+3]!-t[1+side*3]!,rows[k+4]!*x+rows[k+5]!*y+rows[k+6]!*z+rows[k+7]!-t[2+side*3]!,rows[k+8]!*x+rows[k+9]!*y+rows[k+10]!*z+rows[k+11]!-t[3+side*3]!] as V;});
  const distance=radial(clip(clip(poly,t[28]!,true),t[29]!,false))-t[27]!;
  if(distance<clearance){clearance=distance;worst={mesh:mesh.id,side,triangle:i/3,bones:ids.map(v=>HUMAN.names[lod.bones![v]!]),rest:ids.map(v=>[...lod.positions.slice(v*3,v*3+3)]),poly};}
 }
 }
 return {sex,profile,dx,dy,dz,hardware,outfit,glove,clearance,residual,worst,joints:[7,8,9,26].map(b=>({bone:HUMAN.names[b],position:[...solved.pos.slice(b*3,b*3+3)]}))};
}

const baseline=[];
for(const hardware of ['trike','stego'])for(const sex of ['m','f'])for(const profile of ['default','short-wide','tall-wide'])baseline.push(measure(sex,profile,0,0,0,hardware));
const values=[-1,0,1].map(v=>new Array<number>(REGION_COUNT).fill(v));
for(let region=0;region<REGION_COUNT;region++)for(const value of [-1,1])values.push(Array.from({length:REGION_COUNT},(_,r)=>r===region?value:-value));
for(const width of [-1,1])for(let corner=0;corner<16;corner++){const row=new Array<number>(REGION_COUNT).fill(width);[8,11,12,19].forEach((region,bit)=>row[region]=corner&(1<<bit)?1:-1);values.push(row);}
const looks=values.map(row=>{const look=defaultLook();row.forEach((v,i)=>setRegion(look,i,v));return look;});
// Repeatable interior legal creator values, deliberately separate from the fast regression suite.
let seed=0x41c64e6d;
for(let i=0;i<96;i++){const look=defaultLook();for(let r=0;r<REGION_COUNT;r++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;setRegion(look,r,((seed>>>0)%253-126)/127);}looks.push(look);}
const candidates=[];
for(const allowance of [75]){
 const dx=0,dy=0;alignment=allowance;
 let clearance=Infinity,residual=0,worst:any=null,unreachable:any=null,count=0;
 for(const hardware of ['trike','stego'])for(const sex of ['m','f'])for(const glove of ['bare','cloth','hide'])for(const outfit of ['bare','cloth','hide'])for(const look of looks){
  const result=measure(sex,'coupled',dx,dy,0,hardware,look,glove,outfit);count++;
  if(result.clearance<clearance){clearance=result.clearance;worst={...result,glove,look:[...look]};}
  if(result.residual>residual){residual=result.residual;unreachable={...result,glove,look:[...look]};}
 }
 candidates.push({forearmAlignment:allowance,dx,dy,dz:0,clearance,residual,count,worst,unreachable});
}
const implementation=Object.fromEntries(['shared/anim/rider-controls.ts','shared/anim/rider-grips.ts'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const result={implementation,coverage:{boundaryAndMixed:79,seededInterior:96,seed:'0x41c64e6d'},humanHash:createHash('sha256').update(bytes).digest('hex'),scope:'Native finest COMPLETE bare/cloth/hide replacement outfits plus bare/cloth/hide gloves mixed independently; 79 boundary/mixed plus 96 deterministic interior looks, both sexes and Trike/Stego finite upright hardware. Production 75 degree bounded wrist-aligned forearm twist; actual native geometry unmodified.',baseline,candidates};
mkdirSync('var/rider-grip',{recursive:true});
writeFileSync('var/rider-grip/forearm-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({hash:result.humanHash,baseline:baseline.map(({worst,joints,...x})=>x),candidates:candidates.map(({worst,unreachable,...x})=>x)},null,2));
