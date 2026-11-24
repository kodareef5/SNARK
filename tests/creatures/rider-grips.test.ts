import {expect} from "bun:test";
import {readFileSync} from "node:fs";
import {writeBones} from "../../client/core/render/characters.ts";
import {NO_CLIPS,Pose} from "../../shared/anim/clip.ts";
import {B_FINGERTIPS_L,B_FINGERTIPS_R,HUMAN,HUMAN_BONES,SLOT_HANDS} from "../../shared/anim/human.ts";
import {defaultLook,lookScales,LOOK_SEX,REGION_COUNT,setRegion} from "../../shared/anim/look.ts";
import {createMountMotion,mountPose} from "../../shared/anim/mount.ts";
import {fitRiderControls,RIDER_GRIPS,RIDER_TARGET_FLOATS} from "../../shared/anim/rider-controls.ts";
import {gripPose,RiderGrips,validGrip} from "../../shared/anim/rider-grips.ts";
import {solve,Solved,zoneHit} from "../../shared/anim/skeleton.ts";
import {AnimState,HumanAnim} from "../../shared/anim/pose.ts";
import {raySeated} from "../fixtures/seated-ray.ts";
import {parsePack} from "../../shared/pack/pack.ts";
import {GEAR_COUNT,GEAR_WORN} from "../../shared/sim/entities.ts";
import {EntityRecord} from "../../server/records.ts";
import {SeatedGrips} from "../../server/rider-grips.ts";
import {HandSurface} from "../../tools/pack/grips.ts";
import {orderPack} from "../../tools/pack/order.ts";
import {splitPack} from "../../tools/pack/split.ts";
import {buildPack,unpackMeshes} from "../../tools/pack/write.ts";
import {fromArt,test} from "../fixtures/needs-art.ts";
import {coreRegistry} from "../fixtures/world.ts";

const source=fromArt(()=>parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk",import.meta.url)))));
const meshes=fromArt(()=>unpackMeshes(source));
const motion=createMountMotion();
function targets(stego=false):Float64Array{
 const p=new Float64Array(RIDER_TARGET_FLOATS);p.set(stego?[23,.17,.86,.27,-.17,.86,.27,.29,.06,.30,-.29,.06,.30,.36,.45,.36,-.36,.45,.36]:[23,.19,.86,.27,-.19,.86,.27,.42,.29,.38,-.42,.29,.38,.48,.47,.27,-.48,.47,.27]);
 p[27]=stego?.018:.017;p[28]=stego?-.11:-.12;p[29]=stego?.11:.13;return p;
}
function looks():Uint8Array[]{
 const values=[-1,0,1].map(v=>new Array<number>(REGION_COUNT).fill(v));
 for(let region=0;region<REGION_COUNT;region++)for(const value of [-1,1])values.push(Array.from({length:REGION_COUNT},(_,r)=>r===region?value:-value));
 for(const width of [-1,1])for(let corner=0;corner<16;corner++){
  const row=new Array<number>(REGION_COUNT).fill(width);[8,11,12,19].forEach((region,bit)=>row[region]=corner&(1<<bit)?1:-1);values.push(row);
 }
 const out=values.map(row=>{const look=defaultLook();row.forEach((v,i)=>setRegion(look,i,v));return look;});
 for(let byte=-127;byte<=127;byte++){const look=defaultLook();setRegion(look,11,byte/127);out.push(look);}return out;
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

test("native hand calibration survives repacking, ordering and a boot header without hand geometry",()=>{
 const profiles=source.header.rigs.flatMap(r=>r.grips??[]);expect(profiles.map(p=>p.mesh).sort()).toEqual(meshes.filter(m=>m.id.endsWith("/hands")).map(m=>m.id).sort());expect(profiles.every(validGrip)).toBe(true);
 const bytes=buildPack(meshes,source.palette,[],source.header.rigs),again=parsePack(bytes);
 expect(again.header.rigs).toEqual(source.header.rigs);
 const split=splitPack(orderPack(bytes),"hands",{boot:()=>false}),boot=parsePack(split.files.find(f=>f.role==="boot")!.bytes);
 expect(boot.header.meshes.length).toBe(0);
 const carried=boot.header.rigs.flatMap(r=>r.grips??[]);
 expect(carried.every(validGrip)).toBe(true);
 expect(carried.map(p=>({...p,poses:p.poses.length}))).toEqual(profiles.map(p=>({...p,poses:p.poses.length})));
 let deviation=0;
 for(const [i,p] of carried.entries())for(const [k,point] of p.poses.entries())deviation=Math.max(deviation,Math.abs(point-profiles[i]!.poses[k]!));
 expect(deviation).toBeLessThanOrEqual(5.001e-10);
});

test("dense native radius interpolation retains surface clearance and contact around all native hand meshes",()=>{
 let smallest=Infinity,largestGap=0,largestArc=0,count=0;
 for(const rig of source.header.rigs)for(const profile of rig.grips!)for(const side of [0,1]){
  const surface=new HandSurface(meshes.find(m=>m.id===profile.mesh)!,Float32Array.from(rig.rest),side===1),pose=new Float64Array(12);
  for(let sample=0;sample<=1024;sample++){
   const radius=profile.start+sample/1024*profile.step*(profile.poses.length/12-1);
   expect(gripPose(profile,radius,-.12,.13,null,pose)).toBe(true);
   const result=surface.inspect(pose.subarray(side*6,side*6+6),radius);smallest=Math.min(smallest,result.clearance);largestGap=Math.max(largestGap,...result.contacts);largestArc=Math.max(largestArc,result.gap);count++;
  }
 }
 expect(count).toBe(16400);expect(smallest).toBeGreaterThanOrEqual(0);expect(largestGap).toBeLessThan(.002);expect(largestArc).toBeLessThan(4.4);
});

test("actual native male/female glove triangles clear finite bars across coupled proportions while the pelvis and limb lengths remain fixed",()=>{
 let worstResidual=0,smallest=Infinity,gap=0,count=0,worst="",lengthError=0;
 for(const rig of source.header.rigs)for(const profile of rig.grips!){
  const rest=Float32Array.from(rig.rest),lod=meshes.find(m=>m.id===profile.mesh)!.lods[0]!;
  for(const look of looks())for(const t of [targets(),targets(true)]){
   const scale=new Float32Array(HUMAN_BONES*3),pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),cache=new RiderGrips();
   lookScales(look,scale);mountPose(motion,{role:"ride",tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scale);
   const before=solved.pos.slice(),pelvis=solved.pos.slice(0,3),root=pose.root.slice(),grip=cache.update(profile,look,t[27]!,t[28]!,t[29]!);
   expect(grip).not.toBeNull();const residual=fitRiderControls(pose,solved,rest,scale,t,true,undefined,null,grip);worstResidual=Math.max(worstResidual,residual);
   expect(solved.pos.slice(0,3)).toEqual(pelvis);expect(pose.root).toEqual(root);
   for(let b=1;b<HUMAN_BONES;b++){const p=HUMAN.parent[b]!,length=(v:Float32Array)=>Math.hypot(v[b*3]!-v[p*3]!,v[b*3+1]!-v[p*3+1]!,v[b*3+2]!-v[p*3+2]!);lengthError=Math.max(lengthError,Math.abs(length(before)-length(solved.pos)));}
   const rows=new Float32Array(HUMAN_BONES*12);writeBones(rows,0,solved,rest,scale,0,0,0,0);
   for(let side=0;side<2;side++){
    let closest=Infinity;
    for(let i=0;i<lod.indices.length;i+=3){
     const ids=[lod.indices[i]!,lod.indices[i+1]!,lod.indices[i+2]!];if(ids.every(v=>side?lod.positions[v*3]!>0:lod.positions[v*3]!<0))continue;
     const poly=ids.map(v=>{const k=lod.bones![v]!*12,x=lod.positions[v*3]!,y=lod.positions[v*3+1]!,z=lod.positions[v*3+2]!;return[rows[k]!*x+rows[k+1]!*y+rows[k+2]!*z+rows[k+3]!-t[1+side*3]!,rows[k+4]!*x+rows[k+5]!*y+rows[k+6]!*z+rows[k+7]!-t[2+side*3]!,rows[k+8]!*x+rows[k+9]!*y+rows[k+10]!*z+rows[k+11]!-t[3+side*3]!] as V;});
     closest=Math.min(closest,radial(clip(clip(poly,t[28]!,true),t[29]!,false)));
    }
    if(closest-t[27]!<smallest){smallest=closest-t[27]!;worst=`${profile.mesh} radius=${t[27]} side=${side} look=${[...look]}`;}
    gap=Math.max(gap,closest-t[27]!);
   }
   count++;
  }
 }
 expect(count).toBe(5344);expect(worstResidual).toBeLessThan(.00001);expect(lengthError).toBeLessThan(.000001);
 expect({smallest,worst}).toEqual({smallest:expect.any(Number),worst:expect.any(String)});
 if(smallest<-.000001)throw new Error(`Native hand enters the bar by ${-smallest}m: ${worst}`);
 expect(gap).toBeLessThan(.0003);
});

test("native grip cache follows look/glove/hardware changes and absent or unsupported calibration reports a finite-pose fallback",()=>{
 const rig=source.header.rigs[0]!,bare=rig.grips!.find(g=>!g.mesh.includes("armor"))!,cloth=rig.grips!.find(g=>g.mesh.includes("cloth"))!,look=defaultLook(),cache=new RiderGrips(),t=targets(true),rest=Float32Array.from(rig.rest);
 const original=cache.update(bare,look,.018,-.11,.11)!.slice(),version=cache.revision;cache.update(bare,look,.018,-.11,.11);expect(cache.revision).toBe(version);
 setRegion(look,11,1);expect(cache.update(bare,look,.018,-.11,.11)!.slice()).not.toEqual(original);expect(cache.revision).toBe(version+1);
 expect(cache.update(cloth,look,.018,-.11,.11)).not.toBeNull();expect(cache.revision).toBe(version+2);
 expect(cache.update(cloth,look,.04,-.11,.11)).toBeNull();expect(cache.update(cloth,look,.018,-.01,.01)).toBeNull();expect(cache.update(null,look,.018,-.11,.11)).toBeNull();
 const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES);mountPose(motion,{role:"ride",tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest);
 expect(fitRiderControls(pose,solved,rest,null,t)).toBe(Infinity);expect([...solved.pos,...solved.rot].every(Number.isFinite)).toBe(true);
 for(const b of [B_FINGERTIPS_L,B_FINGERTIPS_R])expect([...pose.rot.slice(b*4,b*4+4)]).toEqual([0,0,0,1]);
 t[0]!&=~RIDER_GRIPS;expect(fitRiderControls(pose,solved,rest,null,t)).toBeLessThan(.00001);
});

test("authority resolves the same actual native glove and look calibration as drawing",()=>{
 const reg=coreRegistry(),kind=reg.index.get("core:survivor")!,rec=new EntityRecord(992,kind),gear=new Uint16Array(GEAR_COUNT),resolved=new SeatedGrips(reg,source.header.rigs),drawn=new RiderGrips(),t=targets(true);
 rec.look=defaultLook();rec.look[LOOK_SEX]=1;setRegion(rec.look,11,-1);
 const rig=source.header.rigs.find(r=>r.id==="human_f")!,bare=rig.grips!.find(p=>!p.mesh.includes("armor"))!,hide=rig.grips!.find(p=>p.mesh.includes("hide"))!;
 expect(resolved.of(rec,gear,t)).toEqual(drawn.update(bare,rec.look,.018,-.11,.11));
 gear[GEAR_WORN+SLOT_HANDS]=reg.index.get("core:hide_gloves")!;expect(resolved.of(rec,gear,t)).toEqual(drawn.update(hide,rec.look,.018,-.11,.11));
 setRegion(rec.look,11,1);expect(resolved.of(rec,gear,t)).toEqual(drawn.update(hide,rec.look,.018,-.11,.11));
 const missing=structuredClone(source.header.rigs);missing.find(r=>r.id==="human_f")!.grips=missing.find(r=>r.id==="human_f")!.grips!.filter(p=>p.mesh!==hide.mesh);
 expect(new SeatedGrips(reg,missing).of(rec,gear,t)).toBeNull();expect(new SeatedGrips(reg,[]).of(rec,gear,t)).toBeNull();
});


test("authoritative seated arm capsules follow actual native grip corrections while canonical torso policy remains unchanged",()=>{
 const rig=source.header.rigs.find(r=>r.id==="human_f")!,profile=rig.grips!.find(g=>g.mesh.includes("hide"))!,look=defaultLook(),t=targets(true),cache=new RiderGrips();setRegion(look,11,1);
 const grip=cache.update(profile,look,t[27]!,t[28]!,t[29]!)!,anim=new HumanAnim(NO_CLIPS),st=new AnimState(),frame=new Float64Array([0,0,0,1,0,0,0,1,0,0,0,1]);expect(grip).not.toBeNull();
 let moved=0;
 for(let x=.12;x<.5;x+=.01)for(let y=.65;y<1.05;y+=.01){
   const old=raySeated(anim,st,0,frame,true,x,y,2,0,0,-1,4,0,t),oldT=zoneHit.t;
   const fitted=raySeated(anim,st,0,frame,true,x,y,2,0,0,-1,4,0,t,0,null,grip);
   if(old!==fitted||Math.abs(oldT-zoneHit.t)>.0001)moved++;
 }
 expect(moved).toBeGreaterThan(5);
 const torso=raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,t),distance=zoneHit.t;
 expect(raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,t,0,null,grip)).toBe(torso);expect(zoneHit.t).toBe(distance);expect(torso).not.toBe(0);
});
