// Actual native weighted skin against a visible metre grid. No proxy boxes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {writeBones} from '../../client/core/render/characters.ts';
import {sampleClip} from '../../shared/anim/clip.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {boneToModel,solve,Solved} from '../../shared/anim/skeleton.ts';
import {Ragdoll} from '../../shared/anim/ragdoll.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {defaultPalette,nearestColour} from '../../shared/pack/palette.ts';
import {buildPack,unpackMeshes,type SourceMesh} from '../pack/write.ts';
import {findAssets} from '../art/assets.ts';
import {materialsOf} from '../art/materials.ts';
import {ModelView} from '../snap.ts';
import {rgbaOf} from '../snap/files.ts';
import {encodePng} from '../snap/png.ts';
import {CORE_CONTENT} from '../../content/core.ts';
import {compileContent} from '../../shared/content/registry.ts';
import {Heightfield,TERRAIN_CELL} from '../../shared/world/heightfield.ts';
import {StructureStore} from '../../shared/world/structures.ts';
function flatWorld(){
 const dims={chunksX:2,chunksZ:2},reg=compileContent(CORE_CONTENT).registry!;
 const hf=new Heightfield(dims,TERRAIN_CELL,-32,1/256);
 for(let j=0;j<hf.nz;j++)for(let i=0;i<hf.nx;i++)hf.setSample(i,j,0);
 return {hf,structs:new StructureStore(dims,reg.halfX,reg.halfY,reg.halfZ,null,reg.parts)};
}
import {STEGO_DYES} from '../../content/creatures/stego.ts';
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:stego')!,materials=materialsOf(asset);
const bytes=readFileSync(asset.file),packSha256=createHash('sha256').update(bytes).digest('hex');
const source=parsePack(new Uint8Array(bytes)),rig=buildRig(source.header.rigs[0]!,source.clips)!;
const mesh=unpackMeshes(source).find(m=>m.id==='core:stego')!,fine=mesh.lods[0]!,matrix=new Float32Array(rig.bones*12),palette=defaultPalette();
const prefix=process.argv[2]??'current';
function skin(normals=false):SourceMesh{
 const positions=new Float32Array(fine.positions.length),nn=normals&&fine.normals?new Float32Array(fine.normals.length):undefined;
 for(let v=0;v<positions.length/3;v++)for(let axis=0;axis<3;axis++){
  let p=0,n=0;
  for(let k=0;k<4;k++){const w=fine.weights![v*4+k]!,i=fine.joints![v*4+k]!*12+axis*4;
   p+=w*(matrix[i]!*fine.positions[v*3]!+matrix[i+1]!*fine.positions[v*3+1]!+matrix[i+2]!*fine.positions[v*3+2]!+matrix[i+3]!);
   if(nn)n+=w*(matrix[i]!*fine.normals![v*3]!+matrix[i+1]!*fine.normals![v*3+1]!+matrix[i+2]!*fine.normals![v*3+2]!);
  }
  positions[v*3+axis]=p;if(nn)nn[v*3+axis]=n;
 }
 return {...mesh,rig:undefined,skeleton:undefined,lods:[{...fine,positions,normals:nn,tangents:undefined,bones:undefined,joints:undefined,weights:undefined}]};
}
const floorPoints:number[]=[],floorIndices:number[]=[],floorColors:number[]=[];
function quad(x0:number,z0:number,x1:number,z1:number,y:number,c:number){const first=floorPoints.length/3;floorPoints.push(x0,y,z0,x1,y,z0,x1,y,z1,x0,y,z1);floorColors.push(c,c,c,c);floorIndices.push(first,first+2,first+1,first,first+3,first+2);}
quad(-6,-8,6,5,0,nearestColour(palette,103,112,115));
for(let x=-6;x<=6;x++)quad(x-.006,-8,x+.006,5,.001,nearestColour(palette,66,75,79));
for(let z=-8;z<=5;z++)quad(-6,z-.006,6,z+.006,.001,nearestColour(palette,66,75,79));
const floor:SourceMesh={id:'review:ground',lods:[{positions:Float32Array.from(floorPoints),indices:Uint32Array.from(floorIndices),colors:Uint8Array.from(floorColors),error:0}]};
function draw(name:string,posed:SourceMesh){
 const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
 if(process.argv.includes("--no-render")||(only&&!only.some(n=>name.startsWith(n))))return;
 const pack=parsePack(buildPack([posed,floor],palette)),view=new ModelView(pack,1400,1000,[.8,.83,.86]);
 for(const[slot,t]of(pack.header.textures??[]).entries()){const m=materials.find(m=>t.id===`${m.id}/${t.role}`)!;view.texture(slot,t.role,rgbaOf(m,t.role,t.top).pictures);}
 for(const [label,around,above]of[['side',90,4],['quarter',65,16]]as const){
  view.draw({mesh:pack.meshIndex.get('core:stego')!,also:[pack.meshIndex.get('review:ground')!],level:0,around,above,centre:[0,1.3,-1.5],radius:4.85,rig:null,colors:STEGO_DYES,textured:true});
  writeFileSync(`var/stego-review/${prefix}-floor-${name}-${label}.png`,encodePng(1400,1000,view.raster.color));
 }
}
const report:{clip:string;frames:number;minimum:number;worstFrame:number;highestContact:number;frameHighestContact:number;vertex:number;bone:string;byBone:Record<string,number>;breathing:{minimumUpperOpening:number;maximumUpperOpening:number;frameAtMinimum:number}}[]=[];
for(const name of ['idle','torpor_in','torpor_idle','torpor_out','death']){
 const clip=rig.clips.get(name)!,row={clip:name,frames:0,minimum:Infinity,worstFrame:0,highestContact:-Infinity,frameHighestContact:0,vertex:0,bone:'',byBone:{}as Record<string,number>,breathing:{minimumUpperOpening:Infinity,maximumUpperOpening:-Infinity,frameAtMinimum:0}};
 const end=name==='death'?rig.ragdoll!.limp:clip.frames-1;
 for(let frame=0;frame<=end;frame+=.5){
  sampleClip(clip,frame,rig.a);solve(rig,rig.a,rig.solved);writeBones(matrix,0,rig.solved,rig.rest,null,0,0,0,0);
  const posed=skin(),p=posed.lods[0]!.positions;row.frames++;
  let upper=-Infinity;const at=[0,0,0];
  for(const name of ['breath_l','breath_r']){const socket=rig.sockets.get(name)!;boneToModel(rig.solved,socket.bone,socket.x,socket.y,socket.z,at);upper=Math.max(upper,at[1]!);}
  if(upper<row.breathing.minimumUpperOpening){row.breathing.minimumUpperOpening=upper;row.breathing.frameAtMinimum=frame;}
  row.breathing.maximumUpperOpening=Math.max(row.breathing.maximumUpperOpening,upper);
  let frameMinimum=Infinity;for(let v=0;v<p.length/3;v++){const y=p[v*3+1]!,bone=rig.names[fine.bones![v]!]!;frameMinimum=Math.min(frameMinimum,y);row.byBone[bone]=Math.min(row.byBone[bone]??Infinity,y);if(y<row.minimum){row.minimum=y;row.worstFrame=frame;row.vertex=v;row.bone=bone;}}
  if(frameMinimum>row.highestContact){row.highestContact=frameMinimum;row.frameHighestContact=frame;}
 }
 report.push(row);
 sampleClip(clip,row.worstFrame,rig.a);solve(rig,rig.a,rig.solved);writeBones(matrix,0,rig.solved,rig.rest,null,0,0,0,0);draw(`${name}-worst`,skin(true));
}
const now=new Solved(rig.bones),before=new Solved(rig.bones),doll=new Ragdoll(rig,rig.ragdoll!),world=flatWorld();
sampleClip(rig.clips.get('death')!,rig.ragdoll!.limp,rig.a);solve(rig,rig.a,now);sampleClip(rig.clips.get('death')!,rig.ragdoll!.limp-1,rig.a);solve(rig,rig.a,before);
doll.start(now,before,64,0,64,0,1);let rested=-1;
for(let frame=1;frame<=180;frame++){const awake=doll.step(world,1/60);if(!awake&&rested<0)rested=frame/60;}
doll.pose(now);writeBones(matrix,0,now,rig.rest,null,0,0,0,0);const dead=skin(true);draw('ragdoll-3s',dead);
const p=dead.lods[0]!.positions;let low=Infinity;const byBone:Record<string,number>={};for(let i=1;i<p.length;i+=3){low=Math.min(low,p[i]!);const bone=rig.names[fine.bones![(i-1)/3]!]!;byBone[bone]=Math.min(byBone[bone]??Infinity,p[i]!);}
writeFileSync(`var/stego-review/${prefix}-lifecycle.json`,JSON.stringify({packSha256,scope:'All actual finest native weighted vertices sampled every half frame on y=0. Death source only through physics handoff. Grid is one metre. No hidden floor offset. ModelView material captures use its 1K RGBA fallback, not the live compressed 2K client material.',clips:report,ragdoll:{seconds:3,rested,capsuleDepth:doll.deepest(world),skinMinimum:low,byBone}},null,2)+'\n');
console.log(report.map(r=>[r.clip,r.minimum,r.worstFrame,r.bone]),{rested,skinMinimum:low,capsuleDepth:doll.deepest(world)});
