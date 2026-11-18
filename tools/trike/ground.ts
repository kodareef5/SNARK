// Actual native posed triangles against a physical metre-grid ground plane.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeBones } from '../../client/core/render/characters.ts';
import { sampleClip } from '../../shared/anim/clip.ts';
import { Ragdoll } from '../../shared/anim/ragdoll.ts';
import { buildRig } from '../../shared/anim/rigs.ts';
import { boneToModel,solve,Solved } from '../../shared/anim/skeleton.ts';
import { parsePack } from '../../shared/pack/pack.ts';
import { defaultPalette,nearestColour } from '../../shared/pack/palette.ts';
import { buildPack,unpackMeshes,type SourceMesh } from '../pack/write.ts';
import { ModelView } from '../snap.ts';
import { encodePng } from '../snap/png.ts';
import { rgbaOf } from '../snap/files.ts';
import { findAssets } from '../art/assets.ts';
import { materialsOf } from '../art/materials.ts';
import { TRIKE_DYES } from '../../content/creatures/trike.ts';
import { flatWorld } from '../../tests/fixtures/world.ts';

const bytes=readFileSync('assets/source/core/creatures/trike/trike.snpk'),native=parsePack(new Uint8Array(bytes));
const source=unpackMeshes(native).find(m=>m.id==='core:trike')!,rig=buildRig(native.header.rigs[0]!,native.clips)!;
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:trike')!,materials=materialsOf(asset);
const textures=new Map((native.header.textures??[]).map(t=>[t.id,rgbaOf(materials.find(m=>t.id===`${m.id}/${t.role}`)!,t.role,t.top).pictures]));
const palette=defaultPalette(),colours=[nearestColour(palette,93,100,92),nearestColour(palette,118,123,112)];
const ragdoll=process.argv.includes('--ragdoll');
const grade=Number(process.argv.find(a=>a.startsWith('--grade='))?.slice(8)??0);
const yaw=Number(process.argv.find(a=>a.startsWith('--yaw='))?.slice(6)??0);
const lift=Number(process.argv.find(a=>a.startsWith('--lift='))?.slice(7)??.15);
if(!Number.isFinite(lift)||lift<0||lift>5)throw new Error('Review lift must be between 0 and 5 metres');
const slope=ragdoll?Math.tan(grade*Math.PI/180):0;
const world=ragdoll?flatWorld():null;
if(world&&slope)for(let z=0;z<world.hf.nz;z++)for(let x=0;x<world.hf.nx;x++)world.hf.setSample(x,z,(z*world.hf.cell-64)*slope);
const fp:number[]=[],fi:number[]=[],fn:number[]=[],fc:number[]=[];
for(let x=-5;x<5;x++)for(let z=-6;z<5;z++){
 const n=fp.length/3;fp.push(x,slope*z,z,x,slope*(z+1),z+1,x+1,slope*(z+1),z+1,x+1,slope*z,z);
 fi.push(n,n+1,n+2,n,n+2,n+3);
 for(let i=0;i<4;i++){fn.push(0,1/Math.hypot(1,slope),-slope/Math.hypot(1,slope));fc.push(colours[(x+z+20)%2]!);}
}
const floor:SourceMesh={id:'review:ground',lods:[{positions:Float32Array.from(fp),indices:Uint32Array.from(fi),normals:Float32Array.from(fn),colors:Uint8Array.from(fc),error:0}]};
const report=[];
const selected=process.argv.find(v=>v.startsWith('--clip='))?.slice(7);
const selectedFrame=process.argv.find(v=>v.startsWith('--frame='))?.slice(8);
const measureOnly=process.argv.includes('--measure-only');
const allFrames=process.argv.includes('--all-frames');
const airways=process.argv.includes('--airways');
const cases:[string,number][]=ragdoll?[0,30,60,180,360].map(frame=>['limp',frame]):airways?[['idle',0],['swim',0],['torpor_in',32],['torpor_idle',0],['torpor_out',42],['torpor_out',85]]:allFrames?['torpor_in','torpor_idle','torpor_out','death'].flatMap(name=>Array.from({length:rig.clips.get(name)!.frames},(_,frame)=>[name,frame] as [string,number])):
 [['idle',0],['torpor_in',32],['torpor_idle',0],['torpor_out',42],['fall',12],['land',6],['death',75]];
for(const [clip,frame] of cases){
 if(selected&&clip!==selected)continue;
 if(selectedFrame!==undefined&&frame!==Number(selectedFrame))continue;
 let dynamics:{awake:boolean;capsule_penetration:number;sleep_seconds:number|null}|undefined;
 if(ragdoll){
  const death=rig.clips.get('death')!,before=new Solved(rig.bones),doll=new Ragdoll(rig,rig.ragdoll!);
  sampleClip(death,rig.ragdoll!.limp-1,rig.a);solve(rig,rig.a,before);
  sampleClip(death,rig.ragdoll!.limp,rig.a);solve(rig,rig.a,rig.solved);
  doll.start(rig.solved,before,64,lift,64,yaw,1);
  let sleep:number|null=null;
  for(let tick=0;tick<frame;tick++)if(!doll.step(world!,1/60)){sleep??=(tick+1)/60;}
  doll.pose(rig.solved);dynamics={awake:doll.awake,capsule_penetration:doll.deepest(world!),sleep_seconds:sleep};
 }else{sampleClip(rig.clips.get(clip)!,frame,rig.a);solve(rig,rig.a,rig.solved);}
 const a=source.lods[0]!,matrices=new Float32Array(rig.bones*12);
 writeBones(matrices,0,rig.solved,rig.rest,null,0,ragdoll?lift:0,0,ragdoll?yaw:0);
 const positions=new Float32Array(a.positions.length),normals=new Float32Array(a.normals!.length),tangents=a.tangents?new Float32Array(a.tangents):undefined;
 for(let v=0;v<positions.length/3;v++)for(let axis=0;axis<3;axis++){
  let p=0,n=0,t=0;
  for(let k=0;k<4;k++){
   const weight=a.weights![v*4+k]!,bone=a.joints![v*4+k]!,at=bone*12+axis*4;
   p+=weight*(matrices[at]!*a.positions[v*3]!+matrices[at+1]!*a.positions[v*3+1]!+matrices[at+2]!*a.positions[v*3+2]!+matrices[at+3]!);
   n+=weight*(matrices[at]!*a.normals![v*3]!+matrices[at+1]!*a.normals![v*3+1]!+matrices[at+2]!*a.normals![v*3+2]!);
   if(tangents)t+=weight*(matrices[at]!*a.tangents![v*4]!+matrices[at+1]!*a.tangents![v*4+1]!+matrices[at+2]!*a.tangents![v*4+2]!);
  }
  positions[v*3+axis]=p;normals[v*3+axis]=n;if(tangents)tangents[v*4+axis]=t;
 }
 let lowest=0,below=0;const boneMin:Record<string,{height:number;point:number[]}>={};
 for(let v=0;v<positions.length/3;v++){
  const clearance=positions[v*3+1]!-slope*positions[v*3+2]!;
  if(clearance<positions[lowest*3+1]!-slope*positions[lowest*3+2]!)lowest=v;
  if(clearance<-.003)below++;
  let influence=0;for(let k=1;k<4;k++)if(a.weights![v*4+k]!>a.weights![v*4+influence]!)influence=k;
  const bone=rig.names[a.joints![v*4+influence]!]!;
  if(!boneMin[bone]||clearance<boneMin[bone]!.height)boneMin[bone]={height:clearance,point:Array.from(positions.slice(v*3,v*3+3))};
 }
 report.push({clip,frame,lowest_vertex:lowest,point:Array.from(positions.slice(lowest*3,lowest*3+3)),clearance:positions[lowest*3+1]!-slope*positions[lowest*3+2]!,vertices_below_3mm:below,bones:boneMin,...(dynamics?{dynamics,grade,yaw,lift}:{})});
 if(measureOnly)continue;
 const mesh:SourceMesh={...source,skeleton:undefined,rig:undefined,lods:[{...a,positions,normals,tangents,bones:undefined,joints:undefined,weights:undefined}]};
 const markerPoints:number[]=[],markerIndices:number[]=[],markerColours:number[]=[],breaths:number[][]=[];
 if(airways)for(const [side,name] of ['breath_l','breath_r'].entries()){
  const s=rig.sockets.get(name)!,point=new Float64Array(3);boneToModel(rig.solved,s.bone,s.x,s.y,s.z,point);breaths.push([...point]);
  const start=markerPoints.length/3;
  for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
   markerPoints.push(...d.map((v,i)=>point[i]!+v*.016));markerColours.push(nearestColour(palette,...(side?[255,108,42]:[42,240,210]) as [number,number,number]));
  }
  for(const t of [[0,2,4],[4,2,1],[1,2,5],[5,2,0],[4,3,0],[1,3,4],[5,3,1],[0,3,5]])markerIndices.push(...t.map(i=>start+i));
 }
 const markers:SourceMesh={id:'review:airways',lods:[{positions:Float32Array.from(markerPoints),indices:Uint32Array.from(markerIndices),colors:Uint8Array.from(markerColours),error:0}]};
 const pack=parsePack(buildPack([mesh,floor,...(airways?[markers]:[])],palette)),view=new ModelView(pack,1500,1000,[.80,.83,.86]);
 for(const [slot,t] of (pack.header.textures??[]).entries())view.texture(slot,t.role,textures.get(t.id)!);
 const views=airways?[['left',65,38],['right',-65,12]] as const:[['quarter',65,18],['side',90,3]] as const;
 for(const [angle,around,above] of views){
  const centre=airways?[0,1,2].map(i=>(breaths[0]![i]!+breaths[1]![i]!)*.5) as [number,number,number]:[0,1,-.5] as [number,number,number];
  view.draw({mesh:pack.meshIndex.get('core:trike')!,also:[pack.meshIndex.get('review:ground')!,...(airways?[pack.meshIndex.get('review:airways')!]:[])],level:0,around,above,
   centre,radius:airways?.65:4.7,rig:null,colors:TRIKE_DYES,textured:true});
  writeFileSync(`var/trike-art/${ragdoll?`ragdoll-${grade}-${yaw}`:airways?'airways':'ground'}-${clip}-${frame}-${angle}.png`,encodePng(1500,1000,view.raster.color));
 }
}
const output={pack_sha256:createHash('sha256').update(bytes).digest('hex'),
 scope:ragdoll?`Actual native skin after authored death handover into the shared rigid-contact solver. Starts ${lift} m above the physical terrain origin; frame is elapsed 60 Hz simulation steps. Skin clearance and capsule penetration are separate measurements.`:airways?'Actual native paired airway sockets marked inside the posed facial geometry. Marker radius 16 mm is visual only and does not alter the breathing witness.':'Native skin matrices and actual finest triangles at named frames, with a rigid 1 m checker plane at Y=0. No pose translation or grounding correction is added by this reviewer. Falling is shown at origin only to reveal authored relative geometry, not a simulated landing.',samples:report};
writeFileSync(`var/trike-art/${ragdoll?`ragdoll-${grade}-${yaw}`:airways?'airway-facial':'ground-contact'}${allFrames?'-all':''}.json`,JSON.stringify(output,null,2)+'\n');
console.log(output);
