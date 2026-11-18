// Actual finest weighted skin after native ragdoll settling, over32yaws and2sizes.
import{readFileSync,writeFileSync}from'node:fs';import{parsePack}from'../../shared/pack/pack.ts';import{unpackMeshes}from'../../tools/pack/write.ts';import{buildRig}from'../../shared/anim/rigs.ts';import{Pose,sampleClip}from'../../shared/anim/clip.ts';import{Solved,solve}from'../../shared/anim/skeleton.ts';import{Ragdoll}from'../../shared/anim/ragdoll.ts';import{writeBones}from'../../client/core/render/characters.ts';import{CORE_CONTENT}from'../../content/core.ts';import{compileContent}from'../../shared/content/registry.ts';import{Heightfield,TERRAIN_CELL}from'../../shared/world/heightfield.ts';import{StructureStore}from'../../shared/world/structures.ts';
const pack=parsePack(new Uint8Array(readFileSync('assets/source/core/creatures/stego/stego.snpk'))),rig=buildRig(pack.header.rigs[0]!,pack.clips)!,mesh=unpackMeshes(pack).find(m=>m.id==='core:stego')!.lods[0]!,reg=compileContent(CORE_CONTENT).registry!,matrix=new Float32Array(rig.bones*12),report=[];

const pose=(frame:number)=>{const p=new Pose(rig.bones),out=new Solved(rig.bones);sampleClip(rig.clips.get('death')!,frame,p);solve(rig,p,out);return out;};
for(const slope of [0,.35])for(const size of [.5,1])for(let k=0;k<32;k++){
 const dims={chunksX:2,chunksZ:2},hf=new Heightfield(dims,TERRAIN_CELL,-32,1/256);for(let j=0;j<hf.nz;j++)for(let i=0;i<hf.nx;i++)hf.setSample(i,j,i*TERRAIN_CELL*slope);
 const world={hf,structs:new StructureStore(dims,reg.halfX,reg.halfY,reg.halfZ,null,reg.parts)},yaw=k*Math.PI/16,x=64,z=64,y=hf.heightAt(x,z),doll=new Ragdoll(rig,rig.ragdoll!);
 doll.start(pose(rig.ragdoll!.limp),pose(rig.ragdoll!.limp-1),x,y,z,yaw,size);let rested=-1;
 for(let frame=1;frame<=180;frame++)if(!doll.step(world,1/60)&&rested<0)rested=frame/60;
 const out=new Solved(rig.bones);doll.pose(out);writeBones(matrix,0,out,rig.rest,null,x,y,z,yaw,size);let low=Infinity,bone='';
 for(let v=0;v<mesh.positions.length/3;v++){const p=[0,0,0];for(let axis=0;axis<3;axis++)for(let j=0;j<4;j++){const w=mesh.weights![v*4+j]!,m=mesh.joints![v*4+j]!*12+axis*4;p[axis]!+=w*(matrix[m]!*mesh.positions[v*3]!+matrix[m+1]!*mesh.positions[v*3+1]!+matrix[m+2]!*mesh.positions[v*3+2]!+matrix[m+3]!);}const depth=p[1]!-hf.heightAt(p[0]!,p[2]!);if(depth<low){low=depth;bone=rig.names[mesh.bones![v]!]!;}}
 report.push({slope,size,yaw,rested,capsuleDepth:doll.deepest(world),skinMinimum:low,bone});
}
writeFileSync('var/stego-review/native-falls.json',JSON.stringify(report,null,2)+'\n');for(const slope of [0,.35])console.log(slope,report.filter(r=>r.slope===slope).toSorted((a,b)=>a.skinMinimum-b.skinMinimum).slice(0,8),{unsettled:report.filter(r=>r.slope===slope&&r.rested<0).length});
