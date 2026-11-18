// Native source geometry and production fitted poses against the actual finite upright contact cylinder.
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {writeBones} from "../../client/core/render/characters.ts";
import {Pose} from "../../shared/anim/clip.ts";
import {HUMAN,HUMAN_BONES} from "../../shared/anim/human.ts";
import {defaultLook,lookScales,setRegion} from "../../shared/anim/look.ts";
import {createMountMotion,mountPose} from "../../shared/anim/mount.ts";
import {fitRiderControls,RIDER_TARGET_FLOATS} from "../../shared/anim/rider-controls.ts";
import {RiderGrips} from "../../shared/anim/rider-grips.ts";
import {solve,Solved} from "../../shared/anim/skeleton.ts";
import {parsePack} from "../../shared/pack/pack.ts";
import {defaultPalette} from "../../shared/pack/palette.ts";
import {buildPack,unpackMeshes,type SourceMesh} from "../pack/write.ts";
import {ModelView} from "../snap.ts";
import {encodePng} from "../snap/png.ts";
const pack=parsePack(new Uint8Array(readFileSync("assets/source/core/humans/human-bodies/human-bodies.snpk"))),meshes=unpackMeshes(pack),motion=createMountMotion();
const folder="var/rider-grip/production";mkdirSync(folder,{recursive:true});
const radius=.018,positions:number[]=[],indices:number[]=[];
for(const y of [-.11,.11])for(let n=0;n<48;n++)positions.push(Math.cos(n*Math.PI/24)*radius,y,Math.sin(n*Math.PI/24)*radius);
for(let n=0;n<48;n++){const k=(n+1)%48;indices.push(n,k,n+48,k,k+48,n+48);}
const bar:SourceMesh={id:"witness:18mm-upright",lods:[{positions:Float32Array.from(positions),indices:Uint32Array.from(indices),colors:new Uint8Array(96).fill(2)}]};
const report:unknown[]=[];
for(const rig of pack.header.rigs)for(const profile of rig.grips??[])for(const size of [-1,0,1])for(const side of [0,1]){
 const rest=Float32Array.from(rig.rest),look=defaultLook(),scales=new Float32Array(HUMAN_BONES*3);setRegion(look,11,size);lookScales(look,scales);
 const lod=meshes.find(m=>m.id===profile.mesh)!.lods[0]!,pose=new Pose(HUMAN_BONES),solved=new Solved(HUMAN_BONES),targets=new Float64Array(RIDER_TARGET_FLOATS),mat=new Float32Array(HUMAN_BONES*12);
 targets.set([23,.17,.86,.27,-.17,.86,.27,.29,.06,.30,-.29,.06,.30,.36,.45,.36,-.36,.45,.36]);targets.set([radius,-.11,.11],27);
 mountPose(motion,{role:"ride",tick:0,startTick:0,durationTicks:1},pose);solve(HUMAN,pose,solved,rest,scales);
 const grip=new RiderGrips().update(profile,look,radius,-.11,.11),residual=fitRiderControls(pose,solved,rest,scales,targets,true,undefined,null,grip);writeBones(mat,0,solved,rest,scales,0,0,0,0);
 const p=new Float32Array(lod.positions.length),ids:number[]=[];
 for(let v=0;v<p.length/3;v++)for(let a=0;a<3;a++){const k=lod.bones![v]!*12+a*4;p[v*3+a]=mat[k]!*lod.positions[v*3]!+mat[k+1]!*lod.positions[v*3+1]!+mat[k+2]!*lod.positions[v*3+2]!+mat[k+3]!-targets[1+side*3+a]!;}
 for(let i=0;i<lod.indices.length;i+=3)if([0,1,2].some(k=>(side?-1:1)*lod.positions[lod.indices[i+k]!*3]!>0))ids.push(lod.indices[i]!,lod.indices[i+1]!,lod.indices[i+2]!);
 const hand:SourceMesh={id:"witness:hand",lods:[{positions:p,indices:Uint32Array.from(ids),colors:new Uint8Array(p.length/3).fill(7)}]},baked=parsePack(buildPack([hand,bar],defaultPalette()));
 const name=profile.mesh.replaceAll(":","-").replaceAll("/","-")+`-${size}-${side}`;report.push({mesh:profile.mesh,size,side,residual,grip:Array.from(grip??[])});
 for(const [label,around,above]of [["top",0,89],["inside",side?60:-60,15]] as const){const view=new ModelView(baked,400,400,[.8,.83,.86]);view.draw({mesh:0,also:[1],level:0,around,above,centre:[0,0,0],radius:.15,rig:null,colors:[7,7,7,7,7,7]});writeFileSync(`${folder}/${name}-${label}.png`,encodePng(400,400,view.raster.color));}
}
writeFileSync(`${folder}/poses.json`,JSON.stringify(report,null,2));
