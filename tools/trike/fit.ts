import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {writeBones} from '../../client/core/render/characters.ts';
import {Pose,sampleClip} from '../../shared/anim/clip.ts';
import {HUMAN,HUMAN_BONES} from '../../shared/anim/human.ts';
import {defaultLook,lookColors,lookScales,setRegion,REGION_COUNT} from '../../shared/anim/look.ts';
import {mountPose,createMountMotion} from '../../shared/anim/mount.ts';
import {RIDER_TARGET_FLOATS,fitRiderControls} from '../../shared/anim/rider-controls.ts';
import {RiderSoles} from '../../shared/anim/rider-soles.ts';
import {RiderGrips} from '../../shared/anim/rider-grips.ts';
import {riderTargets,seatFrame} from '../../shared/anim/seat.ts';
import {Solved,solve} from '../../shared/anim/skeleton.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {defaultPalette,nearestColour,REGION_BASE} from '../../shared/pack/palette.ts';
import {buildPack,unpackMeshes,type SourceMesh} from '../../tools/pack/write.ts';
import {ModelView} from '../../tools/snap.ts';
import {encodePng} from '../../tools/snap/png.ts';
import {rgbaOf} from '../../tools/snap/files.ts';
import {findAssets} from '../../tools/art/assets.ts';
import {materialsOf} from '../../tools/art/materials.ts';
import {TRIKE,TRIKE_DYES} from '../../content/creatures/trike.ts';
import {CORE_CONTENT} from '../../content/core.ts';
const trike=parsePack(new Uint8Array(readFileSync('assets/source/core/creatures/trike/trike.snpk')));
const humanSource=parsePack(new Uint8Array(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk')));
// The ordinary native writer derives exact sole witnesses from the finest
// quantized feet. No hand-authored ankle or boot offset enters this review.
const human=parsePack(buildPack(unpackMeshes(humanSource),humanSource.palette,[],humanSource.header.rigs));
const creatures=unpackMeshes(trike),humans=unpackMeshes(human),rig=buildRig(trike.header.rigs[0]!,trike.clips)!;
const saddle=TRIKE.find(d=>d.type==='item'&&d.id==='core:saddle_trike');
if(saddle?.type!=='item'||!saddle.saddle)throw new Error('Trike saddle content is missing');
const seat=saddle.saddle.seats[0]!;
const palette=defaultPalette(),skin=nearestColour(palette,169,129,103),cloth=nearestColour(palette,48,55,62);
const bodyColors=new Uint8Array(6);lookColors(defaultLook(),bodyColors);bodyColors[0]=skin;bodyColors[1]=cloth;
const outfitColors=new Map(['cloth','hide'].map(name=>{
 const item=CORE_CONTENT.find(d=>d.id===`core:${name}_boots`);
 if(item?.type!=='item'||!item.wear)throw new Error(`Missing registered ${name} colours`);
 const colors=bodyColors.slice();colors[1]=item.wear.colors[0];colors[4]=item.wear.colors[1];colors[5]=item.wear.colors[2];
 return [name,colors] as const;
}));
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:trike')!,materials=materialsOf(asset);
const textures=new Map((trike.header.textures??[]).map(t=>{
 const material=materials.find(m=>t.id===`${m.id}/${t.role}`)!;
 return [t.id,rgbaOf(material,t.role,t.top).pictures] as const;
}));
function deform(mesh:SourceMesh,mat:Float32Array,frame?:Float64Array):SourceMesh {
 const a=mesh.lods[0]!,positions=new Float32Array(a.positions.length),normals=a.normals?new Float32Array(a.normals.length):undefined,tangents=a.tangents?new Float32Array(a.tangents):undefined;
 for(let v=0;v<positions.length/3;v++)for(let axis=0;axis<3;axis++){
  let p=0,n=0,t=0;
  for(let k=0;k<(a.weights?4:1);k++){const w=a.weights?.[v*4+k]??1,b=a.joints?.[v*4+k]??a.bones![v]!,i=b*12+axis*4;
   p+=w*(mat[i]!*a.positions[v*3]!+mat[i+1]!*a.positions[v*3+1]!+mat[i+2]!*a.positions[v*3+2]!+mat[i+3]!);
   if(normals)n+=w*(mat[i]!*a.normals![v*3]!+mat[i+1]!*a.normals![v*3+1]!+mat[i+2]!*a.normals![v*3+2]!);
   if(tangents)t+=w*(mat[i]!*a.tangents![v*4]!+mat[i+1]!*a.tangents![v*4+1]!+mat[i+2]!*a.tangents![v*4+2]!);
  } positions[v*3+axis]=p;if(normals)normals[v*3+axis]=n;if(tangents)tangents[v*4+axis]=t;
 }
 if(frame)for(let v=0;v<positions.length/3;v++){
  const p=positions.slice(v*3,v*3+3),n=normals?.slice(v*3,v*3+3),t=tangents?.slice(v*4,v*4+3);
  for(let axis=0;axis<3;axis++){
   positions[v*3+axis]=frame[axis]!+frame[3+axis*3]!*p[0]!+frame[4+axis*3]!*p[1]!+frame[5+axis*3]!*p[2]!;
   if(normals&&n)normals[v*3+axis]=frame[3+axis*3]!*n[0]!+frame[4+axis*3]!*n[1]!+frame[5+axis*3]!*n[2]!;
   if(tangents&&t)tangents[v*4+axis]=frame[3+axis*3]!*t[0]!+frame[4+axis*3]!*t[1]!+frame[5+axis*3]!*t[2]!;
  }
 }
 const tint=mesh.id.includes('/armor/')?outfitColors.get(mesh.id.split('/')[2]!)!:bodyColors;
 const colors=mesh.id.includes('human_')?Uint8Array.from(a.colors,c=>c>=REGION_BASE&&c<REGION_BASE+6?tint[c-REGION_BASE]!:c):a.colors;
 return {...mesh,skeleton:undefined,rig:undefined,lods:[{...a,positions,colors,normals,tangents,bones:undefined,joints:undefined,weights:undefined}]};
}
const cases=[['idle',0],['walk',8],['attack',5],['charge_windup',60],['charge',7]] as const;
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7),hands=process.argv.includes('--hands');
const measureOnly=process.argv.includes('--measure-only');
const report=[];
for(const sex of ['m','f'])for(const profile of ['short-wide','tall-wide'])for(const outfit of ['bare','cloth','hide'])for(const [clip,frame] of cases){
 if(selected&&selected!==`${sex}:${profile}:${outfit}:${clip}`)continue;
 const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),scales=new Float32Array(HUMAN_BONES*3),look=defaultLook();
 for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,1);
 for(const r of [2,5,8,11,12,15,19])setRegion(look,r,profile==='short-wide'?-1:1);
 const humanRig=human.header.rigs.find(r=>r.id===`human_${sex}`)!,rest=Float32Array.from(humanRig.rest);
 const prefix=`core:human_${sex}/${outfit==='bare'?'':`armor/${outfit}/`}`;
 const points=humanRig.soles!.find(s=>s.mesh===`${prefix}feet`)!.points;
 sampleClip(rig.clips.get(clip)!,frame,rig.a);solve(rig,rig.a,rig.solved);
 const targets=new Float64Array(RIDER_TARGET_FLOATS),origin=new Float64Array(12),cr=new Float32Array(rig.bones*12);
 if(!riderTargets(rig,rig.solved,seat,targets))throw new Error('missing rider targets');
 seatFrame(rig.solved,rig.sockets.get('seat')!,0,0,0,0,origin);
 mountPose(createMountMotion(),{role:'ride',tick:frame,startTick:0,durationTicks:1},pose);lookScales(look,scales);solve(HUMAN,pose,solved,rest,scales);
 const soles=new RiderSoles().update(points,rest,look);
 const handProfile=humanRig.grips!.find(g=>g.mesh===`${prefix}hands`)!;
 if(!handProfile)throw new Error(`Missing measured native hand profile: ${prefix}hands`);
 const grips=new RiderGrips().update(handProfile,look,.017,-.12,.13);
 const residual=fitRiderControls(pose,solved,rest,scales,targets,true,undefined,soles,grips),hr=new Float32Array(HUMAN_BONES*12);
 writeBones(cr,0,rig.solved,rig.rest,null,0,0,0,0);writeBones(hr,0,solved,rest,scales,0,0,0,0);
 const worn=humans.filter(m=>m.id.startsWith(prefix)&&['head','torso','hands','legs','feet'].includes(m.id.slice(prefix.length)));
 if(worn.length!==5)throw new Error(`Missing actual native outfit parts: ${prefix}`);
 // Production replaces torso/limbs but overlays helmets on the bare head.
 if(outfit!=='bare')worn.push(humans.find(m=>m.id===`core:human_${sex}/head`)!);
 const meshes=[...creatures.map(m=>deform(m,cr)),...worn.map(m=>deform(m,hr,origin))];
 report.push({sex,profile,outfit,clip,frame,residual,seat:[...origin.slice(0,3)],seatFrame:[...origin],targets:[...targets],meshes:meshes.map(m=>({id:m.id,positions:[...m.lods[0]!.positions],indices:[...m.lods[0]!.indices]}))});
 if(measureOnly){console.log(sex,profile,outfit,clip,residual);continue;}
 const pack=parsePack(buildPack(meshes,palette)),view=new ModelView(pack,1200,1000,[.80,.83,.86]);
 for(const [slot,t]of(pack.header.textures??[]).entries())view.texture(slot,t.role,textures.get(t.id)!);
 const centre:[number,number,number]=hands?[0,1,2].map(a=>origin[a]!+origin[3+a*3]!*.19+origin[4+a*3]!*.86+origin[5+a*3]!*.27) as [number,number,number]:[origin[0]!,origin[1]!+.85,origin[2]!+.1];
 view.draw({mesh:pack.meshIndex.get('core:trike')!,also:pack.header.meshes.map((_,i)=>i).filter(i=>i!==pack.meshIndex.get('core:trike')),level:0,around:hands?105:65,above:hands?12:16,centre,radius:hands?.25:1.45,rig:null,colors:TRIKE_DYES,textured:true});
 writeFileSync(`var/trike-art/rider-${sex}-${profile}-${outfit}-${clip}${hands?'-hands':''}.png`,encodePng(1200,1000,view.raster.color));
 console.log(sex,profile,outfit,clip,residual);
}
if(!selected)writeFileSync('var/trike-art/rider-native-geometry.json',JSON.stringify(report));
