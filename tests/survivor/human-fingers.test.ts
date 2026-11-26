import {expect,test} from "bun:test";
import {artTest,fromArt} from "../fixtures/needs-art.ts";
import {readFileSync} from "node:fs";
import {writeBones} from "../../client/core/render/characters.ts";
import {Pose,sampleClip} from "../../shared/anim/clip.ts";
import {B_FINGERS_L,B_FINGERS_R,B_FINGERTIPS_L,B_FINGERTIPS_R,HUMAN,HUMAN_BONES,SLOT_HANDS} from "../../shared/anim/human.ts";
import {defaultLook,lookScales,setRegion} from "../../shared/anim/look.ts";
import {createMountMotion,mountPose} from "../../shared/anim/mount.ts";
import {AnimState,HumanAnim,humanPose} from "../../shared/anim/pose.ts";
import {solve,Solved} from "../../shared/anim/skeleton.ts";
import {parsePack} from "../../shared/pack/pack.ts";
import {unpackMeshes} from "../../tools/pack/write.ts";
import {convertClips,convertHumanClips,HUMAN_SOURCE_JOINTS} from "../../tools/pack/anim.ts";
import {readGltf} from "../../tools/pack/gltf.ts";
import {fileURLToPath} from "node:url";

const read=(path:string)=>parsePack(new Uint8Array(readFileSync(new URL(path,import.meta.url))));
const old=read("../fixtures/art/human-bodies.snpk"),fresh=fromArt(()=>read("../../assets/source/core/humans/human-bodies/human-bodies.snpk"));
const clips=read("../fixtures/art/human-clips.snpk").clips;

test("distal fingers append to the native source topology without changing old bones or hit zones",()=>{
 expect([B_FINGERTIPS_L,B_FINGERTIPS_R,HUMAN_BONES]).toEqual([28,29,30]);
 expect(HUMAN.parent[B_FINGERTIPS_L]).toBe(B_FINGERS_L);expect(HUMAN.parent[B_FINGERTIPS_R]).toBe(B_FINGERS_R);
 expect(HUMAN.zoneBones).toBe(20);
 for(const tip of [B_FINGERTIPS_L,B_FINGERTIPS_R]){expect(HUMAN.zone[tip]).toBe(0);expect(HUMAN.slot[tip]).toBe(SLOT_HANDS);}
});

artTest("authored distal finger rests keep every other rest of the frozen bodies",()=>{
 for(const rig of fresh.header.rigs){
  const prior=old.header.rigs.find(r=>r.id===rig.id)!;
  expect(rig.rest.slice(0,B_FINGERTIPS_L*3)).toEqual(prior.rest.slice(0,B_FINGERTIPS_L*3));
  for(const [tip,parent] of [[B_FINGERTIPS_L,B_FINGERS_L],[B_FINGERTIPS_R,B_FINGERS_R]]){
   const reach=Math.hypot(...[0,1,2].map(k=>rig.rest[tip!*3+k]!-rig.rest[parent!*3+k]!));
   expect(reach).toBeGreaterThan(.025);expect(reach).toBeLessThan(.045);
  }
 }
});

test("clips and seated replacements hold the fingertips straight at integral and fractional frames",()=>{
 const clip=clips.clips[clips.index.get("human/idle")!]!,pose=new Pose(HUMAN_BONES),anim=new HumanAnim(clips),st=new AnimState();
 expect(clip.bones).toBe(HUMAN_BONES);expect(anim.idle).toBe(clip);
 const clear=()=>{for(let b=28;b<30;b++)expect([...pose.rot.slice(b*4,b*4+4)]).toEqual([0,0,0,1]);};
 for(const frame of [0,3.5,clip.frames+1.5]){
  pose.rot.fill(.3,28*4);sampleClip(clip,frame,pose);clear();expect([...pose.rot,...pose.root].every(Number.isFinite)).toBe(true);
  pose.rot.fill(.3,28*4);humanPose(anim,st,frame,pose);clear();
 }
 const profile=createMountMotion({ride:clip});expect(profile.rejected).toEqual([]);
 pose.rot.fill(.3,28*4);mountPose(profile,{role:"ride",tick:2,startTick:0,durationTicks:10},pose);clear();
 const rest=Float32Array.from(old.header.rigs[0]!.rest),solved=new Solved(HUMAN_BONES);
 solve(HUMAN,pose,solved,rest);expect([...solved.pos,...solved.rot].every(Number.isFinite)).toBe(true);
});

artTest("new source clip conversion preserves old motion and appends identity rather than importing unsolicited finger gestures",()=>{
 const gltf=readGltf(fileURLToPath(new URL("../../assets/raw/quaternius/animation-library/UAL1_Standard.glb",import.meta.url)));
 const spec=[{source:"Idle_Loop",id:"human/idle"}],before=convertClips(gltf,HUMAN_SOURCE_JOINTS.slice(0,28),HUMAN.parent,spec).clips[0]!,after=convertHumanClips(gltf,spec).clips[0]!;
 expect(after.bones).toBe(30);expect(after.frames).toBe(before.frames);expect(after.root).toEqual(before.root);
 for(let frame=0;frame<after.frames;frame++){
  expect(after.rot.slice(frame*120,frame*120+112)).toEqual(before.rot.slice(frame*112,(frame+1)*112));
  expect([...after.rot.slice(frame*120+112,(frame+1)*120)]).toEqual([0,0,0,1,0,0,0,1]);
 }
});

artTest("cooked bodies keep vertices on the distal finger bones in the two finest levels",()=>{
 let tips=0;
 for(const m of unpackMeshes(fresh))if(m.id.endsWith("/hands"))for(const lod of m.lods.slice(0,2)){
  let n=0;for(const b of lod.bones!)if(b===28||b===29)n++;
  expect(n).toBeGreaterThan(0);tips+=n;
 }
 expect(tips).toBeGreaterThan(1000);
});
