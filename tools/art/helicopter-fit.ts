// Actual finest human/armor/hair vertices, skinned by the engine's bone matrices against the authored inner shell.
import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { HELICOPTER_ART as H } from "../../content/vehicles/helicopter-art.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, B_NECK, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_SEX, REGION_COUNT, lookScales, setRegion } from "../../shared/anim/look.ts";
import { fitPilotControls } from "../../shared/anim/mount-controls.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatAxis, quatMul, quatRotate } from "../../shared/math/quat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
export interface FitCase { margin: number; mesh: string; sex: string; seat: string; profile: string; at: number[]; }
export interface FitReport { pointsTested: number; worst: FitCase; headWorst: FitCase; controlsWorst: FitCase; headMotionAllowance: number; pilotProfiles: number; gripResidual: number; failures: FitCase[]; }

/** Every finest body/armor/hair vertex on every seat, with independent scale intervals covering the full creator range. */
export function auditHelicopterFit(bounds = true, headSweep = true, exhaustiveControls = false): FitReport {
const file=new URL('../../assets/source/core/humans/human-bodies/human-bodies.snpk',import.meta.url);
const pack=parsePack(new Uint8Array(readFileSync(file))),meshes=unpackMeshes(pack);
const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),scales=new Float32Array(HUMAN_BONES*3),matrices=new Float32Array(HUMAN_BONES*12);
const rings=JSON.parse(readFileSync(new URL('../../assets/source/core/vehicles/helicopter/ref/interior.json',import.meta.url),'utf8')) as number[][][];
function clearance(x:number,y:number,z:number):number {
 let lo=0; while(lo<rings.length-2 && rings[lo+1]![0]![2]!<z)lo++;
 const a=rings[lo]!,b=rings[lo+1]!,t=(z-a[0]![2]!)/(b[0]![2]!-a[0]![2]!);
 if(t<0||t>1)return -Math.min(Math.abs(z-a[0]![2]!),Math.abs(z-b[0]![2]!));
 let margin=Infinity;
 for(let k=0;k<a.length;k++) {
  const j=(k+1)%a.length;const px=a[k]![0]!*(1-t)+b[k]![0]!*t,py=a[k]![1]!*(1-t)+b[k]![1]!*t;
  const qx=a[j]![0]!*(1-t)+b[j]![0]!*t,qy=a[j]![1]!*(1-t)+b[j]![1]!*t;
  // The authoring ring runs clockwise in XY.
  margin=Math.min(margin,((qx-px)*(y-py)-(qy-py)*(x-px))/-Math.hypot(qx-px,qy-py));
 }
 return margin;
}
let worst={margin:Infinity,mesh:'',sex:'',seat:'',profile:'',at:[] as number[]},count=0;
let headWorst:FitCase={...worst},controlsWorst:FitCase={...worst};
const failures:FitCase[]=[];

const lowScale=new Float32Array(HUMAN_BONES*3),highScale=new Float32Array(HUMAN_BONES*3);
for(const [to,value] of [[lowScale,-1],[highScale,1]] as const){const look=defaultLook();for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,value);lookScales(look,to);}
const rotation=new Float64Array(4),unit=[0,0,0];
let headMotionAllowance=0,gripResidual=0,pilotProfiles=0;
const armBones=new Set([7,8,9,11,12,13,22,23,24,25,26,27]);
const controlRegions=[6,7,8,9,10,11,16,17,18,19,20,21];
const controls=[...(exhaustiveControls?Array.from({length:1<<controlRegions.length},(_,i)=>`controls_${i}`):['controls_plain','controls_small','controls_large',...Array.from({length:REGION_COUNT*2},(_,i)=>`controls_mixed_${i}`)]),...Array.from({length:exhaustiveControls?512:32},(_,i)=>`controls_sample_${i}`)];
/** Minimum clearance of an entire axis-aligned interval box, including every interpolated loft section between rings.
 * Each side's signed half-plane is quadratic along z; check endpoints and its stationary point, not just eight corners. */
function boxClearance(low: number[], high: number[]): number {
 if(low[2]!<rings[0]![0]![2]!||high[2]!>rings.at(-1)![0]![2]!)return -1;
 let margin=Infinity;
 for(let section=0;section<rings.length-1;section++){
  const a=rings[section]!,b=rings[section+1]!,za=a[0]![2]!,zb=b[0]![2]!;
  if(high[2]!<za||low[2]!>zb)continue;
  const start=Math.max(0,(low[2]!-za)/(zb-za)),end=Math.min(1,(high[2]!-za)/(zb-za));
  for(let k=0;k<a.length;k++){
   const j=(k+1)%a.length,ax=a[k]![0]!,ay=a[k]![1]!,dax=b[k]![0]!-ax,day=b[k]![1]!-ay;
   const dx=a[j]![0]!-ax,dy=a[j]![1]!-ay,ddx=b[j]![0]!-b[k]![0]!-dx,ddy=b[j]![1]!-b[k]![1]!-dy;
   const length=Math.max(Math.hypot(dx+ddx*start,dy+ddy*start),Math.hypot(dx+ddx*end,dy+ddy*end));
   for(const x of [low[0]!,high[0]!])for(const y of [low[1]!,high[1]!]){
    const q2=-ddx*day+ddy*dax,q1=ddx*(y-ay)-dx*day-ddy*(x-ax)+dy*dax,q0=dx*(y-ay)-dy*(x-ax);
    const at=(t:number):number=>(q2*t+q1)*t+q0;
    let peak=Math.max(at(start),at(end));const stationary=-q1/(2*q2);
    if(q2<0&&stationary>start&&stationary<end)peak=Math.max(peak,at(stationary));
    margin=Math.min(margin,-peak/length);
   }
  }
 }
 return margin;
}

for(const sex of ['m','f']) {
 const selected=meshes.filter(m=>m.id.startsWith(`core:human_${sex}/`));
 const rig=pack.header.rigs.find(r=>r.id===`human_${sex}`)!; if(!rig)throw new Error('missing sex rig');
 const rest=Float32Array.from(rig.rest);
 // Between the sampled head looks, bound point motion by angle times radius. This covers continuous yaw/pitch too.
 const neckReach=Math.hypot(...[0,1,2].map(axis=>(rest[B_HEAD*3+axis]!-rest[B_NECK*3+axis]!)*highScale[B_NECK*3+axis]!));
 for(const mesh of selected.filter(m=>/head|hair|beard/.test(m.id))){const lod=mesh.lods[0]!;
  for(let v=0;v<lod.positions.length/3;v++){
   const bone=lod.bones![v]!;if(bone!==B_HEAD&&bone!==B_NECK)continue;
   const radius=Math.hypot(...[0,1,2].map(axis=>(lod.positions[v*3+axis]!-rest[bone*3+axis]!)*highScale[bone*3+axis]!));
   const bound=bone===B_HEAD?Math.PI/4*.2*neckReach+(.4+Math.PI/4*.5)*radius:Math.PI/4*.2*radius;
   headMotionAllowance=Math.max(headMotionAllowance,bound);
  }
 }
 for(const [seat,anchor] of Object.entries(H.anchors).filter(([name])=>name.startsWith('seat_'))) {
  const driver=seat==='seat_driver';
  for(const profile of (bounds?['interval',...(headSweep?[-.8,0,.8]:[]).flatMap(yaw=>[-Math.PI/2,0,Math.PI/2].map(pitch=>`interval_${yaw}_${pitch}`)),...(driver?controls:[])]:['plain','small','large',...Array.from({length:REGION_COUNT},(_,i)=>`region_${i}`)])) {
   const actualControls=profile.startsWith('controls_');
   const look=defaultLook();look[LOOK_SEX]=sex==='m'?0:1;
   if(actualControls){
    pilotProfiles++;
    if(profile==='controls_small'||profile==='controls_large')for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,profile==='controls_small'?-1:1);
    else if(profile.startsWith('controls_mixed_')){const i=Number(profile.slice(15)),base=i<REGION_COUNT?-1:1;for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,r===i%REGION_COUNT?-base:base);}
    else if(profile.startsWith('controls_sample_')){let state=Number(profile.slice(16))+917;for(let r=0;r<REGION_COUNT;r++){state=(Math.imul(state,1664525)+1013904223)>>>0;setRegion(look,r,(state/4294967295)*2-1);}}
    else if(profile!=='controls_plain'){const bits=Number(profile.slice(9));controlRegions.forEach((r,k)=>setRegion(look,r,bits&(1<<k)?1:-1));}
   }
   if(profile==='small'||profile==='large')for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,profile==='small'?-1:1);
   if(profile.startsWith('region_'))setRegion(look,Number(profile.slice(7)),1);
   lookScales(look,scales);mountPose(createMountMotion(),{role:driver?'pilot':'cabin',tick:0,startTick:0,durationTicks:1},pose);
   if(profile.startsWith('interval_')){const [,yaw,pitch]=profile.split('_').map(Number);quatAxis(pose.rot,B_NECK*4,1,0,0,-pitch!*.2);quatAxis(pose.rot,B_HEAD*4,1,0,0,-pitch!*.3);quatAxis(rotation,0,0,1,0,yaw!);quatMul(pose.rot,B_HEAD*4,rotation,0,pose.rot,B_HEAD*4);}
   solve(HUMAN,pose,solved,rest,scales);
   if(driver&&(actualControls||!bounds))gripResidual=Math.max(gripResidual,fitPilotControls(pose,solved,rest,scales,
    {position:H.anchors.collective.map((v,k)=>v-anchor[k]!)},{position:H.anchors.cyclic.map((v,k)=>v-anchor[k]!)}));
   const axes=Array.from({length:HUMAN_BONES},(_,bone)=>[0,1,2].map(axis=>{quatRotate(solved.rot,bone*4,axis===0?1:0,axis===1?1:0,axis===2?1:0,unit,0);return [...unit];}));
   const lower=new Float64Array(HUMAN_BONES*3),upper=new Float64Array(HUMAN_BONES*3);
   for(let bone=1;bone<HUMAN_BONES;bone++){
    const parent=HUMAN.parent[bone]!;
    for(let axis=0;axis<3;axis++){
     let low=lower[parent*3+axis]!,high=upper[parent*3+axis]!;
     for(let k=0;k<3;k++){const coefficient=axes[parent]![k]![axis]!*(rest[bone*3+k]!-rest[parent*3+k]!);low+=coefficient*(coefficient>=0?lowScale:highScale)[parent*3+k]!;high+=coefficient*(coefficient>=0?highScale:lowScale)[parent*3+k]!;}
     lower[bone*3+axis]=low;upper[bone*3+axis]=high;
    }
   }
   writeBones(matrices,0,solved,rest,scales,anchor[0]-solved.pos[0]!,anchor[1]-solved.pos[1]!,anchor[2]-solved.pos[2]!,0);
   for(const mesh of selected){if(profile.startsWith('interval_')&&!/head|hair|beard/.test(mesh.id))continue;const lod=mesh.lods[0]!;let bad=Infinity,badAt:number[]=[];
    for(let v=0;v<lod.positions.length/3;v++){
     const arm=armBones.has(lod.bones![v]!);
     // IK changes the arm rotations with body proportions. Audit those vertices in actual solved control poses;
     // the independent-scale interval proof remains valid for every other bone and for all passenger arms.
     if(bounds&&driver&&(actualControls?!arm:arm))continue;
     const at=[0,0,0];const p=lod.positions.subarray(v*3,v*3+3);
     for(let influence=0;influence<(lod.joints&&lod.weights?4:1);influence++){
      const weight=lod.weights?.[v*4+influence]??1,bone=lod.joints?.[v*4+influence]??lod.bones![v]!;if(weight===0)continue;
      for(let axis=0;axis<3;axis++){const k=bone*12+axis*4;at[axis]!+=weight*(matrices[k]!*p[0]!+matrices[k+1]!*p[1]!+matrices[k+2]!*p[2]!+matrices[k+3]!);}
     }
     const samples:number[][]=[at];
     if(bounds&&!actualControls){
      const lo=[...anchor],hi=[...anchor];
      for(let influence=0;influence<(lod.joints&&lod.weights?4:1);influence++){
       const weight=lod.weights?.[v*4+influence]??1,bone=lod.joints?.[v*4+influence]??lod.bones![v]!;if(weight===0)continue;
       for(let axis=0;axis<3;axis++){
        let l=lower[bone*3+axis]!,h=upper[bone*3+axis]!;
        for(let k=0;k<3;k++){const coefficient=axes[bone]![k]![axis]!*(p[k]!-rest[bone*3+k]!);l+=coefficient*(coefficient>=0?lowScale:highScale)[bone*3+k]!;h+=coefficient*(coefficient>=0?highScale:lowScale)[bone*3+k]!;}
        lo[axis]!+=weight*l;hi[axis]!+=weight*h;
       }
      }
      const margin=boxClearance(lo,hi);count+=8;
      if(margin<bad){bad=margin;badAt=[(lo[0]!+hi[0]!)/2,(lo[1]!+hi[1]!)/2,(lo[2]!+hi[2]!)/2];}
      samples.length=0;
     }
     for(const sample of samples){const margin=clearance(...sample as [number,number,number]);count++;if(margin<bad){bad=margin;badAt=sample;}}
    }
    const result={margin:bad,mesh:mesh.id,sex,seat,profile,at:badAt};if(bad<worst.margin)worst=result;if(actualControls&&bad<controlsWorst.margin)controlsWorst=result;if(/head|hair|beard/.test(mesh.id)&&bad<headWorst.margin)headWorst=result;if(bad<.04)failures.push(result);
   }
  }
 }
}
return { pointsTested: count, worst, headWorst, controlsWorst, headMotionAllowance, pilotProfiles, gripResidual, failures: failures.sort((a,b)=>a.margin-b.margin) };
}
