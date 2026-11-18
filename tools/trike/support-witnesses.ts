// Exact posed sole witnesses for the current ankle targets, including boots.
// The support fitter will change Y only; the measured X/Z footprint remains.
import {readFileSync,writeFileSync} from 'node:fs';
import {writeBones} from '../../client/core/render/characters.ts';
import {Pose} from '../../shared/anim/clip.ts';
import {HUMAN,HUMAN_BONES,B_FOOT_L,B_FOOT_R} from '../../shared/anim/human.ts';
import {defaultLook,lookScales,setRegion,REGION_COUNT} from '../../shared/anim/look.ts';
import {mountPose,createMountMotion} from '../../shared/anim/mount.ts';
import {fitRiderControls} from '../../shared/anim/rider-controls.ts';
import {Solved,solve} from '../../shared/anim/skeleton.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {unpackMeshes} from '../pack/write.ts';
const pack=parsePack(new Uint8Array(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk'))),meshes=unpackMeshes(pack);
const targets=new Float64Array([7,.19,.86,.27,-.19,.86,.27,.42,.29,.38,-.42,.29,.38,.48,.47,.27,-.48,.47,.27]);
const report=[];
for(const sex of ['m','f'])for(const profile of ['short-wide','tall-wide']){
 const rest=Float32Array.from(pack.header.rigs.find(r=>r.id===`human_${sex}`)!.rest),pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),scales=new Float32Array(HUMAN_BONES*3),look=defaultLook(),mat=new Float32Array(HUMAN_BONES*12);
 for(let i=0;i<REGION_COUNT;i++)setRegion(look,i,1);for(const i of [2,5,8,11,12,15,19])setRegion(look,i,profile==='short-wide'?-1:1);
 mountPose(createMountMotion(),{role:'ride',tick:0,startTick:0,durationTicks:1},pose);lookScales(look,scales);solve(HUMAN,pose,solved,rest,scales);fitRiderControls(pose,solved,rest,scales,targets);writeBones(mat,0,solved,rest,scales,0,-.55,0,0);
 for(const outfit of ['bare','cloth','hide']){
  const mesh=meshes.find(m=>m.id===`core:human_${sex}/${outfit==='bare'?'':`armor/${outfit}/`}feet`)!,lod=mesh.lods[0]!;
  for(const side of [1,-1]){let low=Infinity,witness:number[]=[];let vertex=-1,bone=-1;
   for(let v=0;v<lod.positions.length/3;v++){const b=lod.bones![v]!,k=b*12,p=lod.positions.subarray(v*3,v*3+3),at=[0,1,2].map(a=>mat[k+a*4]!*p[0]!+mat[k+a*4+1]!*p[1]!+mat[k+a*4+2]!*p[2]!+mat[k+a*4+3]!);
    if(at[0]!*side>0&&at[1]!<low){low=at[1]!;witness=at;vertex=v;bone=b;}
   }
   const ankle=side===1?B_FOOT_L:B_FOOT_R;
   report.push({sex,profile,outfit,side,mesh:mesh.id,vertex,bone: HUMAN.names[bone],seatRelative:witness,belowAnkle:solved.pos[ankle*3+1]!-.55-low});
  }
 }
}
writeFileSync('var/trike-art/sole-witnesses.json',JSON.stringify(report,null,2));console.log(report);
