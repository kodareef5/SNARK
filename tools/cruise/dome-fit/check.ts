import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildPack, unpackMeshes, type SourceLod } from '../../../tools/pack/write.ts';
import { parsePack } from '../../../shared/pack/pack.ts';
import { defaultPalette } from '../../../shared/pack/palette.ts';
import { surfaceError } from '../../../tools/pack/error.ts';
import { measureSurface } from '../../../tools/art/check.ts';
if(process.argv.length!==5)throw Error('usage: bun tools/cruise/dome-fit/check.ts SOURCE_DIR BASELINE_RAW_DIR OUTPUT_DIR');
const source=resolve(process.argv[2]!),raw=resolve(process.argv[3]!),out=resolve(process.argv[4]!),art=resolve(source,'../../../..');
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const layoutBytes=readFileSync(art+'/content/landmarks/cruise-layout.json'), layout=JSON.parse(layoutBytes.toString());
const rawBytes=readFileSync(raw+'/index.json'), base=JSON.parse(rawBytes.toString()), candidate=JSON.parse(readFileSync(out+'/diagnostic-index.json','utf8'));
if(base.layoutSHA256!==sha(layoutBytes)||candidate.layoutSHA256!==base.layoutSHA256)throw Error('layout mismatch');
const kinds=new Set(layout.prototypes.filter((p:any)=>p.art.kind==='dome_dense').map((p:any)=>p.id));
const owners=new Set(layout.instances.flatMap((i:any,n:number)=>kinds.has(i.prototype)?[n]:[]));
const rows:any[]=[], records:any[]=[];
for(const cell of candidate.meshes){
 const old=base.meshes.find((c:any)=>c.id===cell.id);if(!old)throw Error(cell.id);
 const ownersByLevel:number[][]=[], rawLods:SourceLod[]=[];
 for(const original of old.levels){
  const changed=original.authoredLevel===3, level=changed?cell.levels.find((l:any)=>l.authoredLevel===3):original;
  const bytes=readFileSync(join(changed?out:raw,level.file)), data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const positions=new Float32Array(level.triangles*9), ids:number[]=[];
  for(let t=0;t<level.triangles;t++){ids.push(data.getUint32(t*40,true));for(let k=0;k<9;k++)positions[t*9+k]=data.getFloat32(t*40+4+k*4,true);}
  ownersByLevel.push(ids);rawLods.push({positions,indices:Uint32Array.from({length:level.triangles*3},(_,i)=>i),colors:new Uint8Array(level.triangles*3)});
 }
 const pack=parsePack(buildPack([{id:cell.id,lods:rawLods}],defaultPalette())), native=unpackMeshes(pack)[0]!;
 const at=old.levels.findLastIndex((l:any)=>l.authoredLevel<=3);
 const subset=(n:number):SourceLod=>{const lod=native.lods[n]!,positions:number[]=[];if(!lod.indices.every((v,i)=>v===i))throw Error('owner order changed');
  ownersByLevel[n]!.forEach((o,t)=>{if(owners.has(o))positions.push(...lod.positions.slice(t*9,t*9+9));});
  return{positions:Float32Array.from(positions),indices:Uint32Array.from({length:positions.length/3},(_,i)=>i),colors:new Uint8Array(positions.length/3)};};
 const fine=subset(0), coarse=subset(at), topology=measureSurface(native.lods[at]!);
 rows.push({cell:cell.id,triangles:native.lods[at]!.indices.length/3,nativeHalf:pack.header.meshes[0]!.half,
  wholeP95:surfaceError(native.lods[0]!,native.lods[at]!),domeP95:surfaceError(fine,coarse),domeTopology:measureSurface(coarse),topology});
 records.push({cell:cell.id,origin:cell.origin,fine:Array.from(fine.positions),coarse:Array.from(coarse.positions)});
}
writeFileSync(out+'/native-records.json',JSON.stringify(records));
writeFileSync(out+'/native-check.json',JSON.stringify({layoutSHA256:base.layoutSHA256,rawIndexSHA256:sha(rawBytes),candidateIndexSHA256:sha(readFileSync(out+'/diagnostic-index.json')),rows},null,2));
console.log(JSON.stringify({cells:rows.length,maxDomeP95:Math.max(...rows.map(r=>r.domeP95)),maxWholeP95:Math.max(...rows.map(r=>r.wholeP95)),maxTriangles:Math.max(...rows.map(r=>r.triangles)),bad:rows.filter(r=>r.domeP95>.06||r.triangles>1250||r.topology.holes||r.topology.flipped||r.topology.insideOut||r.topology.collapsed)}));

if(rows.some(r=>r.domeP95>.06||r.triangles>1250||['topology','domeTopology'].some(t=>['holes','flipped','insideOut','collapsed'].some(k=>r[t][k]))))throw Error('Native dome geometry gate failed; inspect native-check.json');
