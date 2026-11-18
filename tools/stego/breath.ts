// Prove that each nasal witness stays inside its actual open recess after roll.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {writeBones} from '../../client/core/render/characters.ts';
import {sampleClip} from '../../shared/anim/clip.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {solve,boneToModel} from '../../shared/anim/skeleton.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {defaultPalette,nearestColour} from '../../shared/pack/palette.ts';
import {buildPack,unpackMeshes,type SourceMesh} from '../pack/write.ts';
import {findAssets} from '../art/assets.ts';
import {materialsOf} from '../art/materials.ts';
import {ModelView} from '../snap.ts';
import {rgbaOf} from '../snap/files.ts';
import {encodePng} from '../snap/png.ts';
import {STEGO_DYES} from '../../content/creatures/stego.ts';
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:stego')!,materials=materialsOf(asset),bytes=readFileSync(asset.file);
const source=parsePack(new Uint8Array(bytes)),rig=buildRig(source.header.rigs[0]!,source.clips)!;
const mesh=unpackMeshes(source).find(m=>m.id==='core:stego')!,fine=mesh.lods[0]!,matrix=new Float32Array(rig.bones*12),palette=defaultPalette();
const cases=[['torpor_in',0],['torpor_in',32.5],['torpor_idle',92],['torpor_out',40]]as const,report=[];
function ray(points:Float32Array,origin:number[],direction:number[]){
 let nearest=Infinity,triangle=-1;const p=(v:number)=>Array.from(points.slice(v*3,v*3+3));
 const sub=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]!),dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i]!,0);
 const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
 for(let i=0;i<fine.indices.length;i+=3){
  const a=p(fine.indices[i]!),b=p(fine.indices[i+1]!),c=p(fine.indices[i+2]!),e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);
  if(Math.abs(det)<1e-9)continue;const inv=1/det,s=sub(origin,a),u=inv*dot(s,h);if(u<0||u>1)continue;
  const q=cross(s,e1),v=inv*dot(direction,q);if(v<0||u+v>1)continue;const t=inv*dot(e2,q);if(t>0&&t<nearest){nearest=t;triangle=i/3;}
 }
 return {distance:nearest,triangle,point:origin.map((x,i)=>x+direction[i]!*nearest)};
}
function marker(points:number[][]):SourceMesh{
 const positions:number[]=[],indices:number[]=[],colors:number[]=[];
 for(const at of points){const start=positions.length/3;for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){positions.push(...at.map((x,i)=>x+d[i]!*.004));colors.push(nearestColour(palette,0,210,230));}
  indices.push(...[0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5].map(i=>i+start));}
 return {id:'review:airways',lods:[{positions:Float32Array.from(positions),indices:Uint32Array.from(indices),colors:Uint8Array.from(colors),error:0}]};
}
for(const[clip,frame]of cases){
 sampleClip(rig.clips.get(clip)!,frame,rig.a);solve(rig,rig.a,rig.solved);writeBones(matrix,0,rig.solved,rig.rest,null,0,0,0,0);
 const positions=new Float32Array(fine.positions.length),normals=new Float32Array(fine.normals!.length);
 for(let v=0;v<positions.length/3;v++)for(let axis=0;axis<3;axis++)for(let k=0;k<4;k++){
  const w=fine.weights![v*4+k]!,i=fine.joints![v*4+k]!*12+axis*4;
  positions[v*3+axis]!+=w*(matrix[i]!*fine.positions[v*3]!+matrix[i+1]!*fine.positions[v*3+1]!+matrix[i+2]!*fine.positions[v*3+2]!+matrix[i+3]!);
  normals[v*3+axis]!+=w*(matrix[i]!*fine.normals![v*3]!+matrix[i+1]!*fine.normals![v*3+1]!+matrix[i+2]!*fine.normals![v*3+2]!);
 }
 const row={clip,frame,openings:[]as {name:string;point:number[];triangle:number;surfaceError:number;minimumSkullWeight:number}[]};
 for(const[name,sign]of [['breath_l',1],['breath_r',-1]]as const){
  const s=rig.sockets.get(name)!,at=[0,0,0],origin=[0,0,0];boneToModel(rig.solved,s.bone,s.x,s.y,s.z,at);boneToModel(rig.solved,s.bone,s.x+3*sign,s.y,s.z,origin);
  const direction=at.map((x,i)=>(x-origin[i]!)/3),hit=ray(positions,origin,direction),surfaceError=Math.hypot(...at.map((x,i)=>x-hit.point[i]!));
  let minimumSkullWeight=1;for(let k=0;k<3;k++){const v=fine.indices[hit.triangle*3+k]!;let w=0;for(let j=0;j<4;j++)if(fine.joints![v*4+j]===s.bone)w+=fine.weights![v*4+j]!;minimumSkullWeight=Math.min(minimumSkullWeight,w);}
  row.openings.push({name,point:[...at],triangle:hit.triangle,surfaceError,minimumSkullWeight});
 }
 report.push(row);
 if(process.argv.includes('--no-render'))continue;
 const posed:SourceMesh={...mesh,rig:undefined,skeleton:undefined,lods:[{...fine,positions,normals,tangents:undefined,bones:undefined,joints:undefined,weights:undefined}]};
 const pack=parsePack(buildPack([posed,marker(row.openings.map(o=>o.point))],palette)),view=new ModelView(pack,1100,900,[.8,.83,.86]);
 for(const[slot,t]of(pack.header.textures??[]).entries()){const m=materials.find(m=>t.id===`${m.id}/${t.role}`)!;view.texture(slot,t.role,rgbaOf(m,t.role,t.top).pictures);}
 const centre=row.openings[0]!.point.map((v,i)=>(v+row.openings[1]!.point[i]!)/2)as[number,number,number];
 const socket=rig.sockets.get('breath_l')!,outside=[0,0,0];boneToModel(rig.solved,socket.bone,socket.x+1,socket.y,socket.z,outside);const direction=outside.map((v,i)=>v-row.openings[0]!.point[i]!);
 const around=Math.atan2(direction[0]!,direction[2]!)*180/Math.PI,above=Math.atan2(direction[1]!,Math.hypot(direction[0]!,direction[2]!))*180/Math.PI;
 view.draw({mesh:pack.meshIndex.get('core:stego')!,also:[pack.meshIndex.get('review:airways')!],level:0,around,above,centre,radius:.42,rig:null,colors:STEGO_DYES,textured:true});
 writeFileSync(`var/stego-review/breath-${clip}-${frame}.png`,encodePng(1100,900,view.raster.color));
}
const output={packSha256:createHash('sha256').update(bytes).digest('hex'),sourceSha256:Object.fromEntries(['rig.py','model.py','clips.py'].map(name=>[name,createHash('sha256').update(readFileSync(resolve(asset.dir,name))).digest('hex')])),scope:'Actual native finest weighted skin. Each point is the first nasal surface reached from lateral air in the skull frame; cyan markers are4mm radius. This proves an exposed conservative point within the nasal recess, not that the whole opening is dry.',report};
writeFileSync('var/stego-review/breath-native.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
