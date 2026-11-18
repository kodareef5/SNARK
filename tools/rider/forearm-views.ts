// Reproduce native full-arm before/after evidence without changing source skin, controls or fitted hand contact.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeBones} from '../../client/core/render/characters.ts';
import {Pose} from '../../shared/anim/clip.ts';
import {HUMAN,HUMAN_BONES} from '../../shared/anim/human.ts';
import {defaultLook,lookScales,REGION_COUNT,setRegion} from '../../shared/anim/look.ts';
import {createMountMotion,mountPose} from '../../shared/anim/mount.ts';
import {fitRiderControls,RIDER_TARGET_FLOATS} from '../../shared/anim/rider-controls.ts';
import {RiderGrips} from '../../shared/anim/rider-grips.ts';
import {solve,Solved} from '../../shared/anim/skeleton.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {defaultPalette} from '../../shared/pack/palette.ts';
import {buildPack,unpackMeshes,type SourceMesh} from '../pack/write.ts';
import {ModelView} from '../snap.ts';
import {encodePng} from '../snap/png.ts';
const pack=parsePack(new Uint8Array(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk'))),meshes=unpackMeshes(pack),motion=createMountMotion();
const folder='var/rider-grip/forearm-production';mkdirSync(folder,{recursive:true});
const report=[];
for(const sex of ['f','m'])for(const outfit of ['bare','hide']){
 const rig=pack.header.rigs.find(r=>r.id===`human_${sex}`)!,rest=Float32Array.from(rig.rest),look=defaultLook(),scales=new Float32Array(HUMAN_BONES*3);
 for(let r=0;r<REGION_COUNT;r++)setRegion(look,r,1);for(const r of [2,5,8,11,12,15,19])setRegion(look,r,-1);lookScales(look,scales);
 const prefix=`core:human_${sex}/${outfit==='bare'?'':`armor/${outfit}/`}`;
 const worn=meshes.filter(m=>m.id.startsWith(prefix)&&['head','torso','hands','legs','feet'].includes(m.id.slice(prefix.length)));
 if(outfit!=='bare')worn.push(meshes.find(m=>m.id===`core:human_${sex}/head`)!);
 let before:Float32Array|null=null,bones:Float32Array|null=null;
 for(const [name,twist] of [['current',0],['aligned',75]] as const){
  const pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),targets=new Float64Array(RIDER_TARGET_FLOATS),mat=new Float32Array(HUMAN_BONES*12);
  targets.set([23,.19,.86,.27,-.19,.86,.27,.42,.29,.38,-.42,.29,.38,.48,.47,.27,-.48,.47,.27]);targets.set([.017,-.12,.13,twist],27);
  mountPose(motion,{role:'ride',tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scales);
  const grip=new RiderGrips().update(rig.grips!.find(g=>g.mesh===`${prefix}hands`)!,look,.017,-.12,.13),residual=fitRiderControls(pose,solved,rest,scales,targets,true,undefined,null,grip);writeBones(mat,0,solved,rest,scales,0,0,0,0);
  report.push({sex,outfit,name,residual,jointError:before?Math.max(...before.map((v,i)=>Math.abs(v-solved.pos[i]!))):0,handMatrixError:bones?Math.max(...[9,13,22,23,24,25,26,27,28,29].flatMap(b=>Array.from(mat.slice(b*12,b*12+12),(v,i)=>Math.abs(v-bones![b*12+i]!)))):0});
  before=solved.pos.slice();bones=mat.slice();
  const baked:SourceMesh[]=worn.map(mesh=>{const lod=mesh.lods[0]!,p=new Float32Array(lod.positions.length);
   for(let v=0;v<p.length/3;v++)for(let a=0;a<3;a++){const k=lod.bones![v]!*12+a*4;p[v*3+a]=mat[k]!*lod.positions[v*3]!+mat[k+1]!*lod.positions[v*3+1]!+mat[k+2]!*lod.positions[v*3+2]!+mat[k+3]!;}
   return{id:mesh.id,lods:[{positions:p,indices:lod.indices,colors:new Uint8Array(p.length/3).fill(7)}]};});
  for(const sign of [-1,1]){const positions:number[]=[],indices:number[]=[];
   for(const y of [.74,.99])for(let n=0;n<48;n++)positions.push(sign*.19+Math.cos(n*Math.PI/24)*.017,y,.27+Math.sin(n*Math.PI/24)*.017);
   for(let n=0;n<48;n++){const k=(n+1)%48;indices.push(n,k,n+48,k,k+48,n+48);}
   baked.push({id:`witness:bar${sign}`,lods:[{positions:Float32Array.from(positions),indices:Uint32Array.from(indices),colors:new Uint8Array(96).fill(2)}]});
  }
  const out=parsePack(buildPack(baked,defaultPalette()));
  for(const [label,around,above]of [['front',0,20],['side',105,15],['back',180,20]] as const){const view=new ModelView(out,700,700,[.8,.83,.86]);view.draw({mesh:0,also:baked.slice(1).map((_,i)=>i+1),level:0,around,above,centre:[.15,.98,.12],radius:.42,rig:null,colors:[7,7,7,7,7,7]});writeFileSync(`${folder}/${sex}-${outfit}-${name}-${label}.png`,encodePng(700,700,view.raster.color));}
 }
}
writeFileSync(`${folder}/invariance.json`,JSON.stringify({source:'assets/source/core/humans/human-bodies/human-bodies.snpk',sha256:createHash('sha256').update(readFileSync('assets/source/core/humans/human-bodies/human-bodies.snpk')).digest('hex'),scope:'Actual finest native male/female short-wide bare and hide outfits; selected side/front/back views. Existing shoulder and armor gaps remain. Hardware is a finite17mm witness cylinder, not whole species saddle clearance.',samples:report},null,2));console.log(report);
