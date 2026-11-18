// Native source geometry for the opt-in saddle sole calibration. No inferred
// capsules or toe-joint padding: these are the exact finest skin vertices.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePack} from '../../shared/pack/pack.ts';
import {unpackMeshes} from '../pack/write.ts';
const bytes=new Uint8Array(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk'));
const pack=parsePack(bytes),selected=unpackMeshes(pack).filter(m=>m.id.endsWith('/feet'));
const data={source_sha256:createHash('sha256').update(bytes).digest('hex'),
 rigs:pack.header.rigs.map(r=>({id:r.id,rest:r.rest})),
 meshes:selected.map(m=>{const l=m.lods[0]!;return{id:m.id,skeleton:m.skeleton,rig:m.rig,
  positions:[...l.positions],indices:[...l.indices],bones:l.bones?[...l.bones]:undefined,
  joints:l.joints?[...l.joints]:undefined,weights:l.weights?[...l.weights]:undefined};})};
writeFileSync('var/trike-art/native-foot-support.json',JSON.stringify(data));
console.log(data.meshes.map(m=>({id:m.id,vertices:m.positions.length/3,weighted:!!m.weights})));
