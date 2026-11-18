import {expect} from "bun:test";
import {readFileSync} from "node:fs";
import {writeBones} from "../../client/core/render/characters.ts";
import {NO_CLIPS,Pose} from "../../shared/anim/clip.ts";
import {HUMAN,HUMAN_BONES} from "../../shared/anim/human.ts";
import {defaultLook,lookScales,REGION_COUNT,setRegion} from "../../shared/anim/look.ts";
import {createMountMotion,mountPose} from "../../shared/anim/mount.ts";
import {fitRiderControls,RIDER_GRIPS,RIDER_TARGET_FLOATS,RIDER_FOREARM_ALIGNMENT} from "../../shared/anim/rider-controls.ts";
import {RiderGrips} from "../../shared/anim/rider-grips.ts";
import {solve,Solved,rayZones,zoneHit} from "../../shared/anim/skeleton.ts";
import {AnimState,HumanAnim} from "../../shared/anim/pose.ts";
import {raySeated} from "../fixtures/seated-ray.ts";
import {parsePack} from "../../shared/pack/pack.ts";
import {unpackMeshes,type SourceMesh} from "../../tools/pack/write.ts";
import {fromArt,test} from "../fixtures/needs-art.ts";
const source=fromArt(()=>parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk",import.meta.url)))));
const meshes=fromArt(()=>unpackMeshes(source));
const motion=createMountMotion();
function targets(stego=false):Float64Array{
 const t=new Float64Array(RIDER_TARGET_FLOATS);t.set(stego?[23,.17,.86,.27,-.17,.86,.27,.29,.06,.30,-.29,.06,.30,.36,.45,.36,-.36,.45,.36]:[23,.19,.86,.27,-.19,.86,.27,.42,.29,.38,-.42,.29,.38,.48,.47,.27,-.48,.47,.27]);
 t.set(stego?[.018,-.11,.11,75]:[.017,-.12,.13,75],27);return t;
}
function looks():Uint8Array[]{
 const plain=defaultLook(),short=defaultLook(),tall=defaultLook(),smallHands=defaultLook();
 for(let i=0;i<REGION_COUNT;i++){setRegion(short,i,1);setRegion(tall,i,1);setRegion(smallHands,i,1);}
 for(const i of [2,5,8,11,12,15,19])setRegion(short,i,-1);
 setRegion(smallHands,11,-1);
 return[plain,short,tall,smallHands];
}
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


function clearance(mesh:SourceMesh,rows:Float32Array,t:Float64Array):number{
 const lod=mesh.lods[0]!;let best=Infinity;
 for(let side=0;side<2;side++)for(let i=0;i<lod.indices.length;i+=3){
  const ids=[lod.indices[i]!,lod.indices[i+1]!,lod.indices[i+2]!];
  if(ids.every(v=>side?lod.positions[v*3]!>0:lod.positions[v*3]!<0))continue;
  const poly=ids.map(v=>{const k=lod.bones![v]!*12,x=lod.positions[v*3]!,y=lod.positions[v*3+1]!,z=lod.positions[v*3+2]!;return[rows[k]!*x+rows[k+1]!*y+rows[k+2]!*z+rows[k+3]!-t[1+side*3]!,rows[k+4]!*x+rows[k+5]!*y+rows[k+6]!*z+rows[k+7]!-t[2+side*3]!,rows[k+8]!*x+rows[k+9]!*y+rows[k+10]!*z+rows[k+11]!-t[3+side*3]!] as V;});
  best=Math.min(best,radial(clip(clip(poly,t[28]!,true),t[29]!,false))-t[27]!);
 }
 return best;
}
function fitted(rest:Float32Array,scale:Float32Array|null,t:Float64Array,grip:Float64Array|null,hands=true){
 const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),rows=new Float32Array(HUMAN_BONES*12);
 mountPose(motion,{role:"ride",tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scale);
 const residual=fitRiderControls(pose,solved,rest,scale,t,hands,undefined,null,grip);writeBones(rows,0,solved,rest,scale,0,0,0,0);
 return{pose,solved,rows,residual};
}

test("native full outfits clear upright bars with bounded forearm alignment and invariant joints/hand wrap",()=>{
 let minimum=Infinity,residual=0,jointError=0,handError=0,oldCuff=Infinity,count=0,limbTwist=0;
 for(const rig of source.header.rigs){
  const rest=Float32Array.from(rig.rest),prefix=`core:${rig.id}/`;
  const outfits=["","armor/cloth/","armor/hide/"].map(gear=>["head","torso","legs","feet"].map(slot=>meshes.find(m=>m.id===`${prefix}${gear}${slot}`)!));
  outfits[1]!.push(outfits[0]![0]!);outfits[2]!.push(outfits[0]![0]!);
  for(const profile of rig.grips!)for(const look of looks())for(const t of [targets(),targets(true)]){
   const scale=new Float32Array(HUMAN_BONES*3);lookScales(look,scale);
   const grip=new RiderGrips().update(profile,look,t[27]!,t[28]!,t[29]!,0,75)!;
   const legacy=t.slice();legacy[RIDER_FOREARM_ALIGNMENT]=0;const before=fitted(rest,scale,legacy,grip),after=fitted(rest,scale,t,grip);
   residual=Math.max(residual,after.residual);
   for(let i=0;i<before.solved.pos.length;i++)jointError=Math.max(jointError,Math.abs(before.solved.pos[i]!-after.solved.pos[i]!));
   for(const b of [9,13,22,23,24,25,26,27,28,29])for(let i=0;i<12;i++)handError=Math.max(handError,Math.abs(before.rows[b*12+i]!-after.rows[b*12+i]!));
   for(const b of [8,12]){let dot=0;for(let i=0;i<4;i++)dot+=before.solved.rot[b*4+i]!*after.solved.rot[b*4+i]!;limbTwist=Math.max(limbTwist,2*Math.acos(Math.min(1,Math.abs(dot))));}
   const glove=meshes.find(m=>m.id===profile.mesh)!;
   oldCuff=Math.min(oldCuff,clearance(outfits[2]![1]!,before.rows,t));
   for(const outfit of outfits){for(const mesh of [...outfit,glove])minimum=Math.min(minimum,clearance(mesh,after.rows,t));count++;}
  }
 }
 expect(count).toBe(144);expect(oldCuff).toBeLessThan(-.01);expect(minimum).toBeGreaterThanOrEqual(0);
 expect(residual).toBeLessThan(.000001);expect(jointError).toBeLessThan(.000001);expect(handError).toBeLessThan(.000002);
 expect(limbTwist).toBeLessThan(75*Math.PI/180+.00001);expect(limbTwist).toBeGreaterThan(Math.PI/4);
});

test("forearm opt-in preserves legacy, passenger and missing-calibration behavior and invalidates the native cache",()=>{
 const rig=source.header.rigs.find(r=>r.id==="human_f")!,rest=Float32Array.from(rig.rest),profile=rig.grips!.find(g=>g.mesh.includes("hide"))!,look=defaultLook(),cache=new RiderGrips(),t=targets();
 const grip=cache.update(profile,look,.017,-.12,.13)!.slice(),revision=cache.revision;
 expect(cache.update(profile,look,.017,-.12,.13,0,75)).toEqual(grip);expect(cache.revision).toBe(revision+1);
 cache.update(profile,look,.017,-.12,.13,0,75);expect(cache.revision).toBe(revision+1);
 setRegion(look,8,1);cache.update(profile,look,.017,-.12,.13,0,75);expect(cache.revision).toBe(revision+2);
 const legacy=t.slice(0,30),zero=t.slice();zero[RIDER_FOREARM_ALIGNMENT]=0;
 expect(fitted(rest,null,legacy,grip).pose.rot).toEqual(fitted(rest,null,zero,grip).pose.rot);
 expect(fitted(rest,null,t,grip,false).pose.rot).toEqual(fitted(rest,null,zero,grip,false).pose.rot);
 expect(fitted(rest,null,t,null).pose.rot).toEqual(fitted(rest,null,zero,null).pose.rot);
 expect(fitted(rest,null,t,null).residual).toBe(Infinity);
 const off=t.slice();off[0]!&=~RIDER_GRIPS;const plain=off.slice();plain[RIDER_FOREARM_ALIGNMENT]=0;
 expect(fitted(rest,null,off,grip).pose.rot).toEqual(fitted(rest,null,plain,grip).pose.rot);
 for(const invalid of [-1,91,NaN,Infinity]){
  const bad=t.slice();bad[RIDER_FOREARM_ALIGNMENT]=invalid;expect(cache.update(profile,look,.017,-.12,.13,0,invalid)).toBeNull();
  const fallback=fitted(rest,null,bad,grip);expect(fallback.residual).toBe(Infinity);expect([...fallback.solved.pos,...fallback.solved.rot].every(Number.isFinite)).toBe(true);
  expect(fallback.pose.rot).toEqual(fitted(rest,null,zero,grip).pose.rot);
 }
});

test("authoritative seated rays match the same aligned forearm pose without changing canonical torso policy",()=>{
 const rig=source.header.rigs[0]!,profile=rig.grips![0]!,t=targets(),grip=new RiderGrips().update(profile,null,.017,-.12,.13,0,75)!;
 const actual=fitted(HUMAN.rest,null,t,grip),anim=new HumanAnim(NO_CLIPS),st=new AnimState(),frame=new Float64Array([0,0,0,1,0,0,0,1,0,0,0,1]);
 let hits=0;for(let x=.1;x<.5;x+=.04)for(let y=.65;y<1.1;y+=.04){
  const expected=rayZones(HUMAN,actual.solved,x,y,2,0,0,-1,4),distance=zoneHit.t;
  expect(raySeated(anim,st,0,frame,true,x,y,2,0,0,-1,4,0,t,0,null,grip)).toBe(expected);expect(zoneHit.t).toBeCloseTo(distance,6);if(expected)hits++;
 }
 expect(hits).toBeGreaterThan(10);
 const legacy=t.slice();legacy[RIDER_FOREARM_ALIGNMENT]=0;const before=raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,legacy,0,null,grip),distance=zoneHit.t;
 expect(raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,t,0,null,grip)).toBe(before);expect(zoneHit.t).toBe(distance);
});
