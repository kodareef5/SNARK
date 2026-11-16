// Native occupied cabin review using the real body, armor and proportion scales; no placeholder mannequins.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeBones } from "../../../../../../client/core/render/characters.ts";
import { HELICOPTER_ART as H } from "../../../../../../content/vehicles/helicopter-art.ts";
import { Pose } from "../../../../../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, SOCKET_EYE } from "../../../../../../shared/anim/human.ts";
import { defaultLook, REGION_COUNT, lookScales, setRegion } from "../../../../../../shared/anim/look.ts";
import { fitPilotControls } from "../../../../../../shared/anim/mount-controls.ts";
import { createMountMotion, mountPose } from "../../../../../../shared/anim/mount.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { Solved, solve } from "../../../../../../shared/anim/skeleton.ts";
import { quatAxis, quatRotate } from "../../../../../../shared/math/quat.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { SKIN_BASE, HAIR_BASE, EYE_BASE } from "../../../../../../shared/pack/palette.ts";
import { findAssets } from "../../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../../tools/art/materials.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../../../../../../tools/pack/write.ts";
import { rgbaOf } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";
import { Stage } from "../../../../../../tests/fixtures/stage.ts";
const args=process.argv.slice(2),out=args[args.indexOf('--out')+1];if(!out)throw new Error('--out DIR');mkdirSync(out,{recursive:true});
const asset=(await findAssets()).find(a=>a.id===H.id)!;
const helicopter=parsePack(new Uint8Array(readFileSync(asset.file)));
const human=parsePack(new Uint8Array(readFileSync(new URL('../../../humans/human-bodies/human-bodies.snpk',import.meta.url))));
const humanMeshes=unpackMeshes(human),pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),scale=new Float32Array(HUMAN_BONES*3),matrix=new Float32Array(HUMAN_BONES*12);
const materials=materialsOf(asset);
for(const extreme of ['large','small']) {
 const bodies:SourceMesh[]=[],driverEye=[0,0,0];
 for(const [seat,anchor] of Object.entries(H.anchors).filter(([name])=>name.startsWith('seat_'))) {
  const sex=seat.endsWith('right')||seat.includes('passenger')?'f':'m';
  const rest=Float32Array.from(human.header.rigs.find(r=>r.id===`human_${sex}`)!.rest),look=defaultLook();
  for(let region=0;region<REGION_COUNT;region++)setRegion(look,region,extreme==='large'?1:-1);lookScales(look,scale);
  mountPose(createMountMotion(),{role:seat==='seat_driver'?'pilot':'cabin',tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scale);
  if(seat==='seat_driver')fitPilotControls(pose,solved,rest,scale,{position:H.anchors.collective.map((v,k)=>v-anchor[k]!)},{position:H.anchors.cyclic.map((v,k)=>v-anchor[k]!)});
  if(seat==='seat_driver'){
   const eye=SOCKET_EYE,b=eye.bone;quatRotate(solved.rot,b*4,eye.x*scale[b*3]!,eye.y*scale[b*3+1]!,eye.z*scale[b*3+2]!,driverEye,0);
   for(let k=0;k<3;k++)driverEye[k]!+=solved.pos[b*3+k]!+anchor[k]!-solved.pos[k]!;
  }
  writeBones(matrix,0,solved,rest,scale,anchor[0]-solved.pos[0]!,anchor[1]-solved.pos[1]!,anchor[2]-solved.pos[2]!,0);
  const selected=humanMeshes.filter(m=>m.id===`core:human_${sex}/head`||m.id.startsWith(`core:human_${sex}/armor/hide/`));
  for(const mesh of selected){const fine=mesh.lods[0]!,positions=new Float32Array(fine.positions.length);
   for(let v=0;v<positions.length/3;v++)for(let influence=0;influence<(fine.joints&&fine.weights?4:1);influence++){
    const weight=fine.weights?.[v*4+influence]??1,bone=fine.joints?.[v*4+influence]??fine.bones![v]!;if(weight===0)continue;
    for(let axis=0;axis<3;axis++){const k=bone*12+axis*4;positions[v*3+axis]!+=weight*(matrix[k]!*fine.positions[v*3]!+matrix[k+1]!*fine.positions[v*3+1]!+matrix[k+2]!*fine.positions[v*3+2]!+matrix[k+3]!);}
   }
   bodies.push({id:`review:${seat}/${mesh.id}`,lods:[{positions,colors:fine.colors,indices:fine.indices}]});
  }
 }
 const pack=parsePack(buildPack([...unpackMeshes(helicopter),...bodies],helicopter.palette,[],helicopter.header.rigs));
 const rig=buildRig(pack.header.rigs.find(r=>r.id===H.id)!,pack.clips)!;
 const textures=(pack.header.textures??[]).map(t=>rgbaOf(materials.find(m=>t.id===`${m.id}/${t.role}`)!,t.role,t.top,null));
 for(const [name,around,above,distance,open] of [['front',35,14,7.8,0],['side',90,10,7.4,0],['doors_open',55,16,7.0,1.1],['rear_doors',125,14,6.8,1.1],['controls',54,26,3.0,1.4],['pilot_forward',0,0,0,0],['pilot_controls',0,0,0,0]] as const){
  if(args.includes('--pilot')&&!name.startsWith('pilot_'))continue;
  const width=1400,height=950,stage=new Stage(pack,width,height),a=around*Math.PI/180,e=above*Math.PI/180;
  stage.cam.x=Math.sin(a)*Math.cos(e)*distance;stage.cam.y=1.45+Math.sin(e)*distance;stage.cam.z=Math.cos(a)*Math.cos(e)*distance;
  stage.cam.yaw=a+Math.PI;stage.cam.pitch=-e;stage.cam.fovY=.78;
  if(name.startsWith('pilot_')){
   [stage.cam.x,stage.cam.y,stage.cam.z]=driverEye as [number,number,number];
   stage.cam.yaw=-.05;stage.cam.pitch=name==='pilot_controls'?-.55:-.12;stage.cam.fovY=1.2;
  }
  stage.begin();textures.forEach((t,k)=>stage.texture(k,t.role,t.pictures));
  const bone=stage.pose(rig,{x:0,y:0,z:0},rot=>{for(const [name,sign] of [['door_front_left',-1],['door_rear_left',-1],['door_front_right',1],['door_rear_right',1]] as const)quatAxis(rot,rig.names.indexOf(name)*4,0,1,0,open*sign);});
  stage.add(H.id,0,{x:0,y:0,z:0,bone,regions:[103,86,101]});
  for(const body of bodies)if(!(name.startsWith('pilot_')&&body.id.startsWith('review:seat_driver/')&&body.id.endsWith('/head')))stage.add(body.id,0,{x:0,y:0,z:0,regions:[SKIN_BASE+3,104,EYE_BASE+1,HAIR_BASE+2,105,91]});
  const path=`${out}/occupied_${extreme}_${name}.png`;writeFileSync(path,encodePng(width,height,new Uint8Array(stage.render())));console.log(path);
 }
}
