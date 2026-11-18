import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ModelView } from '../../tools/snap.ts';
import { encodePng } from '../../tools/snap/png.ts';
import { rgbaOf } from '../../tools/snap/files.ts';
import { findAssets } from '../../tools/art/assets.ts';
import { materialsOf } from '../../tools/art/materials.ts';
import { bindBuiltTextures } from '../art/built-textures.ts';
import { parsePack } from '../../shared/pack/pack.ts';
import { buildRig } from '../../shared/anim/rigs.ts';
import { sampleClip } from '../../shared/anim/clip.ts';
import { solve } from '../../shared/anim/skeleton.ts';
import { TRIKE,TRIKE_DYES } from '../../content/creatures/trike.ts';
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:trike')!;
const option=(key:string):string|undefined=>process.argv.find(arg=>arg.startsWith('--'+key+'='))?.slice(key.length+3);
const packFile=option('pack')??asset.file;
const pack=parsePack(new Uint8Array(readFileSync(packFile)));
const rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const mats=materialsOf(asset), view=new ModelView(pack,1600,1100,[.80,.83,.86]);
const prefix=process.argv[2]??'iteration-06';
const clay=process.argv.includes('--clay');
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7);
const gaits=process.argv.includes('--gaits'), eyes=process.argv.includes('--eyes');
const dist=option('built'), format=option('format')??'bc';
if(dist && !clay){
 if(format!=='bc'&&format!=='astc')throw new Error('Use bc or astc for the built texture format.');
 bindBuiltTextures(view,pack,resolve(dist),format);
} else for(const [slot,t] of (pack.header.textures??[]).entries()){
 const m=mats.find(m=>t.id===`${m.id}/${t.role}`)!;
 const texture=rgbaOf(m,t.role,t.top);
 const neutral=t.role==='base'?[180,180,180,255]:t.role==='normal'?[128,128]:t.role==='mro'?[255,220,0,255]:[0,0,0,0];
 const pictures=clay?texture.pictures.map(p=>{const out=new Uint8Array(p.length);for(let i=0;i<out.length;i++)out[i]=neutral[i%neutral.length]!;return out;}):texture.pictures;
 view.texture(slot,t.role,pictures);
}
const cases=[
 {name:'head-closed',clip:'idle',frame:0,around:65,above:10,centre:[0,2.03,2.26],radius:1.15},
 {name:'head-blink',clip:'idle',frame:90,around:65,above:10,centre:[0,2.03,2.26],radius:1.15},
 {name:'head-open',clip:'call',frame:25,around:65,above:9,centre:[0,2.0,2.26],radius:1.15},
 {name:'head-side-open',clip:'call',frame:25,around:90,above:0,centre:[0,2.0,2.26],radius:1.15},
 {name:'body',clip:'idle',frame:0,around:58,above:14,centre:[0,1.55,-.48],radius:4.3},
 {name:'side',clip:'idle',frame:0,around:90,above:0,centre:[0,1.55,-.48],radius:4.3},
 {name:'front',clip:'idle',frame:0,around:0,above:4,centre:[0,1.55,1.8],radius:2.2},
 {name:'charge',clip:'charge',frame:0,around:90,above:0,centre:[0,1.4,-.48],radius:4.3},
 {name:'torpor',clip:'torpor_idle',frame:0,around:65,above:18,centre:[0,.85,-.48],radius:4.3},
] as const;
for(const c of cases){if(gaits||eyes||(only&&c.name!==only))continue;sampleClip(rig.clips.get(c.clip)!,c.frame,rig.a);solve(rig,rig.a,rig.solved);view.draw({mesh:pack.meshIndex.get('core:trike')!,level:0,around:c.around,above:c.above,centre:c.centre,radius:c.radius,rig,colors:TRIKE_DYES,textured:true});writeFileSync(`var/trike-art/${prefix}-native-${c.name}.png`,encodePng(view.raster.width,view.raster.height,view.raster.color));}
if(eyes){
 const bone=rig.names.indexOf('eye_l'),mesh=pack.meshIndex.get('core:trike')!;
 for(const frame of [0,88,90]){
  sampleClip(rig.clips.get('idle')!,frame,rig.a); solve(rig,rig.a,rig.solved);
  const centre:[number,number,number]=[rig.solved.pos[bone*3]!,rig.solved.pos[bone*3+1]!,rig.solved.pos[bone*3+2]!];
  view.draw({mesh,level:0,around:74,above:8,centre,radius:.215,rig,colors:TRIKE_DYES,textured:true});
  writeFileSync(`var/trike-art/${prefix}-native-eye-${frame}.png`,encodePng(view.raster.width,view.raster.height,view.raster.color));
 }
}
if(gaits){
 const rows=[];
 for(const end of ['front','back'] as const){
  const centre:[number,number,number]=end==='front'?[.65,1.08,.55]:[.65,1.08,-1.40];
  for(const name of ['idle','walk','run'] as const){
   const clip=rig.clips.get(name)!;
   // Authored left-foot phase offsets and duty fractions; frame is allowed
   // to be fractional so toe-off and touchdown are inspected exactly.
   const offset=end==='front'?0:name==='walk'?.75:.62;
   const duty=name==='walk'?.60:.39;
   const phases=name==='idle'?[['neutral',0] as const]:[
    ['stance',duty*.5] as const,['toeoff',duty] as const,
    ['swing',(1+duty)*.5] as const,['touchdown',0] as const];
   for(const [phase,p] of phases){
    const frame=name==='idle'?0:((p-offset+1)%1)*clip.frames;
    sampleClip(clip,frame,rig.a);solve(rig,rig.a,rig.solved);
    view.draw({mesh:pack.meshIndex.get('core:trike')!,level:0,around:82,above:4,centre,radius:1.28,rig,colors:TRIKE_DYES,textured:true});
    const file=`var/trike-art/${prefix}-native-${end}-${name}-${phase}.png`;
    writeFileSync(file,encodePng(view.raster.width,view.raster.height,view.raster.color));
    rows.push({file,end,clip:name,phase,frame,footPhase:p,around:82,above:4,centre,radius:1.28});
   }
  }
 }
 writeFileSync(`var/trike-art/${prefix}-gaits.json`,JSON.stringify({pack_sha256:createHash('sha256').update(readFileSync(packFile)).digest('hex'),scope:'Actual native finest skin, identical per-limb camera. Local source poses without terrain correction. Material views use the 1K RGBA fallback.',clay,rows},null,2)+'\n');
}
if(process.argv.includes('--lifecycle')){
 const species=TRIKE.find(d=>d.type==='species')!;
 if(species.type!=='species')throw new Error('Missing Trike content');
 for(const layer of [16,32,48,64,80,96]){
  const dead=layer>48,clip=rig.clips.get(dead?'death':'idle')!;
  sampleClip(clip,dead?clip.frames-1:0,rig.a);solve(rig,rig.a,rig.solved);
  view.draw({mesh:pack.meshIndex.get('core:trike')!,level:0,around:58,above:dead?24:14,
   centre:[0,dead?.85:1.55,-.48],radius:4.3,rig,colors:TRIKE_DYES,textured:true,layer});
  writeFileSync(`var/trike-art/${prefix}-native-layer-${layer}.png`,encodePng(view.raster.width,view.raster.height,view.raster.color));
 }
 for(const index of [1,2,3]){
  sampleClip(rig.clips.get('idle')!,0,rig.a);solve(rig,rig.a,rig.solved);
  const colors=species.regions!.map(r=>r!.colors[index%r!.colors.length]![0]);
  view.draw({mesh:pack.meshIndex.get('core:trike')!,level:0,around:58,above:14,centre:[0,1.55,-.48],radius:4.3,rig,colors,textured:true});
  writeFileSync(`var/trike-art/${prefix}-native-colour-${index}.png`,encodePng(view.raster.width,view.raster.height,view.raster.color));
 }
}
if(process.argv.includes('--lods')){
 const mesh=pack.meshIndex.get('core:trike')!;
 sampleClip(rig.clips.get('idle')!,0,rig.a);solve(rig,rig.a,rig.solved);
 for(let level=0;level<pack.header.meshes[mesh]!.lods.length;level++){
  view.draw({mesh,level,around:58,above:14,centre:[0,1.55,-.48],radius:4.3,rig,colors:TRIKE_DYES,textured:true});
  writeFileSync(`var/trike-art/${prefix}-native-lod-${level}.png`,encodePng(view.raster.width,view.raster.height,view.raster.color));
 }
}
