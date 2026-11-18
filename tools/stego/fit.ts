import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {writeBones} from '../../client/core/render/characters.ts';
import {Pose} from '../../shared/anim/clip.ts';
import {HUMAN,HUMAN_BONES} from '../../shared/anim/human.ts';
import {defaultLook,lookScales,setRegion,REGION_COUNT} from '../../shared/anim/look.ts';
import {mountPose,createMountMotion} from '../../shared/anim/mount.ts';
import {RIDER_TARGET_FLOATS,fitRiderControls} from '../../shared/anim/rider-controls.ts';
import {RiderGrips} from '../../shared/anim/rider-grips.ts';
import {soleOffsets} from '../../shared/anim/rider-soles.ts';
import {riderTargets,seatFrame} from '../../shared/anim/seat.ts';
import {Solved,solve,boneToModel} from '../../shared/anim/skeleton.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {CreatureAnim,creaturePose} from '../../shared/anim/creature.ts';
import {AnimState} from '../../shared/anim/pose.ts';
import {ACT_NONE,ACT_SWING,ACT_RELOAD,ACT_HOLD} from '../../shared/sim/weapon.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {defaultPalette,nearestColour,REGION_BASE} from '../../shared/pack/palette.ts';
import {buildPack,unpackMeshes,type SourceMesh} from '../../tools/pack/write.ts';
import {ModelView} from '../../tools/snap.ts';
import {encodePng} from '../../tools/snap/png.ts';
import {rgbaOf} from '../../tools/snap/files.ts';
import {findAssets} from '../../tools/art/assets.ts';
import {materialsOf} from '../../tools/art/materials.ts';
import {STEGO,STEGO_DYES} from '../../content/creatures/stego.ts';
const stego=parsePack(new Uint8Array(readFileSync('assets/source/core/creatures/stego/stego.snpk')));
const human=parsePack(new Uint8Array(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk')));
const creatures=unpackMeshes(stego),humans=unpackMeshes(human),rig=buildRig(stego.header.rigs[0]!,stego.clips)!;
// Repack only temporary native feet so the current compiler derives actual sole witnesses;
// older committed human packs can remain untouched during this isolated species review.
const calibrated=parsePack(buildPack(humans.filter(m=>m.id.endsWith('/feet')),human.palette,[],human.header.rigs));
const saddle=STEGO.find(d=>d.type==='item'&&d.id==='core:saddle_stego');
if(saddle?.type!=='item'||!saddle.saddle)throw new Error('Stego saddle content is missing');
const seat=saddle.saddle.seats[0]!;
const species=STEGO.find(d=>d.type==='species'&&d.id==='core:stego');
if(species?.type!=='species')throw new Error('Stego species missing');
const animator=new CreatureAnim(rig,2.5,3,species.combat);
const palette=defaultPalette(),skin=nearestColour(palette,169,129,103),cloth=nearestColour(palette,48,55,62);
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:stego')!,materials=materialsOf(asset);
const outfits=process.argv.includes('--outfits'),prefix=outfits?'rider-outfit':'rider';
function deform(mesh:SourceMesh,mat:Float32Array,frame?:Float64Array):SourceMesh {
 const a=mesh.lods[0]!,positions=new Float32Array(a.positions.length),normals=a.normals?new Float32Array(a.normals.length):undefined;
 for(let v=0;v<positions.length/3;v++)for(let axis=0;axis<3;axis++){
  let p=0,n=0;
  for(let k=0;k<(a.weights?4:1);k++){const w=a.weights?.[v*4+k]??1,b=a.joints?.[v*4+k]??a.bones![v]!,i=b*12+axis*4;
   p+=w*(mat[i]!*a.positions[v*3]!+mat[i+1]!*a.positions[v*3+1]!+mat[i+2]!*a.positions[v*3+2]!+mat[i+3]!);
   if(normals)n+=w*(mat[i]!*a.normals![v*3]!+mat[i+1]!*a.normals![v*3+1]!+mat[i+2]!*a.normals![v*3+2]!);
  } positions[v*3+axis]=p;if(normals)normals[v*3+axis]=n;
 }
 if(frame)for(let v=0;v<positions.length/3;v++){const p=positions.slice(v*3,v*3+3),n=normals?.slice(v*3,v*3+3);for(let axis=0;axis<3;axis++){
  positions[v*3+axis]=frame[axis]!+frame[3+axis*3]!*p[0]!+frame[4+axis*3]!*p[1]!+frame[5+axis*3]!*p[2]!;
  if(normals&&n)normals[v*3+axis]=frame[3+axis*3]!*n[0]!+frame[4+axis*3]!*n[1]!+frame[5+axis*3]!*n[2]!;
 }}
 const dyes=mesh.id.includes('/armor/cloth/')?[1,15,225]:mesh.id.includes('/armor/hide/')?[227,228,225]:[skin,cloth,skin];
 const colors=mesh.id.includes('human_')?Uint8Array.from(a.colors,c=>c>=REGION_BASE?(dyes[c-REGION_BASE]??skin):c):a.colors;
 return {...mesh,skeleton:undefined,rig:undefined,lods:[{...a,positions,colors,normals,tangents:undefined,bones:undefined,joints:undefined,weights:undefined}]};
}
const cases=[['idle',0,0,ACT_NONE,0],['walk',15,8,ACT_NONE,0],['run',9,20,ACT_NONE,0],['left-sweep',18,8,ACT_SWING,0],['right-sweep',18,8,ACT_SWING,1],['impale',25,8,ACT_RELOAD,0],['impale-lift',15,0,ACT_HOLD,0],['heavy',15,8,ACT_NONE,2],['sharpened',15,8,ACT_NONE,4]] as const;
const report=[];
for(const sex of ['m','f'])for(const profile of ['short-wide','tall-wide'])for(const footwear of ['bare','cloth','hide'])for(const [clip,frame,speed,action,hold] of cases){
 const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),scales=new Float32Array(HUMAN_BONES*3),look=defaultLook();
 for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,1);
 for(const r of [2,5,8,11,12,15,19])setRegion(look,r,profile==='short-wide'?-1:1);
 const humanRig=calibrated.header.rigs.find(r=>r.id===`human_${sex}`)!,rest=Float32Array.from(humanRig.rest);
 const footMesh=`core:human_${sex}/${footwear==='bare'?'':`armor/${footwear}/`}feet`;
 const points=humanRig.soles!.find(s=>s.mesh===footMesh)!.points,offsets=new Float64Array(6);
 const state=new AnimState();state.grounded=true;state.speed=speed;state.setAction(action,hold,0);
 creaturePose(animator,state,frame,rig.a);solve(rig,rig.a,rig.solved);
 const targets=new Float64Array(RIDER_TARGET_FLOATS),origin=new Float64Array(12),cr=new Float32Array(rig.bones*12);
 if(!riderTargets(rig,rig.solved,seat,targets))throw new Error('missing rider targets');
 seatFrame(rig.solved,rig.sockets.get('seat')!,0,0,0,0,origin);
 mountPose(createMountMotion(),{role:'ride',tick:frame,startTick:0,durationTicks:1},pose);lookScales(look,scales);solve(HUMAN,pose,solved,rest,scales);
 if(!soleOffsets(points,rest,scales,offsets))throw new Error('invalid native foot support');
 const handMesh=`core:human_${sex}/${outfits&&footwear!=='bare'?`armor/${footwear}/`:''}hands`;
 const handProfile=human.header.rigs.find(r=>r.id===`human_${sex}`)!.grips!.find(g=>g.mesh===handMesh)!;
 const grips=new RiderGrips().update(handProfile,look,.018,-.11,.11);if(!grips)throw new Error('invalid native hand grasp');
 const residual=fitRiderControls(pose,solved,rest,scales,targets,true,undefined,offsets,grips),hr=new Float32Array(HUMAN_BONES*12);
 writeBones(cr,0,rig.solved,rig.rest,null,0,0,0,0);writeBones(hr,0,solved,rest,scales,0,0,0,0);
 const selected=humans.filter(m=>outfits&&footwear!=='bare'
  ?m.id.startsWith(`core:human_${sex}/armor/${footwear}/`)||m.id===`core:human_${sex}/head`
  :m.id===footMesh||(m.id.startsWith(`core:human_${sex}/`)&&m.id.split('/').length===2&&!m.id.endsWith('/feet')));
 const meshes=[...creatures.map(m=>deform(m,cr)),...selected.map(m=>deform(m,hr,origin))];
 report.push({sex,profile,footwear,clip,frame,residual,seat:[...origin.slice(0,3)],meshes:meshes.map(m=>({id:m.id,positions:[...m.lods[0]!.positions],indices:[...m.lods[0]!.indices]}))});
 const selectedView=process.argv.find(a=>a.startsWith('--select='))?.slice(9);
 if(process.argv.includes('--no-render')||(selectedView&&selectedView!==`${sex}-${profile}-${footwear}-${clip}`)||(clip!=='idle'&&clip!=='left-sweep'&&clip!=='impale-lift'))continue;
 const pack=parsePack(buildPack(meshes,palette)),view=new ModelView(pack,1200,1000,[.80,.83,.86]);
 for(const [slot,t]of(pack.header.textures??[]).entries()){const m=materials.find(m=>t.id===`${m.id}/${t.role}`)!;const tx=rgbaOf(m,t.role,t.top);view.texture(slot,t.role,tx.pictures);}
 view.draw({mesh:pack.meshIndex.get('core:stego')!,also:pack.header.meshes.map((_,i)=>i).filter(i=>i!==pack.meshIndex.get('core:stego')),level:0,around:65,above:16,centre:[origin[0]!,origin[1]!+.85,origin[2]!+.1],radius:1.55,rig:null,colors:STEGO_DYES,textured:true});
 writeFileSync(`var/stego-review/${prefix}-${sex}-${profile}-${footwear}-${clip}.png`,encodePng(1200,1000,view.raster.color));
 if(process.argv.includes('--controls')){
  const socket=rig.sockets.get('grip_l')!,at=[0,0,0];boneToModel(rig.solved,socket.bone,socket.x,socket.y,socket.z,at);
  for(const[label,around]of[['side',90],['front',35]]as const){
   view.draw({mesh:pack.meshIndex.get('core:stego')!,also:pack.header.meshes.map((_,i)=>i).filter(i=>i!==pack.meshIndex.get('core:stego')),level:0,around,above:8,centre:[at[0]!,at[1]!+.02,at[2]!-.05],radius:.52,rig:null,colors:STEGO_DYES,textured:true});
   writeFileSync(`var/stego-review/${prefix}-${sex}-${profile}-${footwear}-${clip}-grip-${label}.png`,encodePng(1200,1000,view.raster.color));
  }
 }
 console.log(sex,profile,footwear,clip,residual);
}
writeFileSync(`var/stego-review/${prefix}-native-geometry.json`,JSON.stringify(report));
