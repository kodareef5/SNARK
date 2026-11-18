// Direct native material/pose review. No approximate replacement geometry.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {ModelView} from '../snap.ts';
import {encodePng} from '../snap/png.ts';
import {rgbaOf} from '../snap/files.ts';
import {findAssets} from '../art/assets.ts';
import {materialsOf} from '../art/materials.ts';
import {parsePack} from '../../shared/pack/pack.ts';
import {buildRig} from '../../shared/anim/rigs.ts';
import {sampleClip} from '../../shared/anim/clip.ts';
import {solve} from '../../shared/anim/skeleton.ts';
import {NEUTRAL} from '../../client/core/render/surface.ts';
import {STEGO_DYES} from '../../content/creatures/stego.ts';
const asset=(await findAssets(resolve('assets/source'))).find(a=>a.id==='core:stego')!;
const previous=process.argv.find(a=>a.startsWith('--pack='))?.slice(7);
const junctions=process.argv.includes('--junctions');
if(previous&&!junctions)throw new Error('An alternate pack is supported only for neutral gait views');
const bytes=readFileSync(previous??asset.file),pack=parsePack(new Uint8Array(bytes)),rig=buildRig(pack.header.rigs[0]!,pack.clips)!;
const mats=materialsOf(asset),view=new ModelView(pack,1400,1000,[.80,.83,.86]);
const prefix=process.argv[2]??'current';
const images:{file:string;sha256:string;pose:unknown}[]=[];
function save(name:string,pose:unknown){
 const file=`var/stego-review/${prefix}-native-${name}.png`,png=encodePng(view.raster.width,view.raster.height,view.raster.color);
 writeFileSync(file,png);images.push({file,sha256:createHash('sha256').update(png).digest('hex'),pose});
}
const textures=(pack.header.textures??[]).map(t=>({t,pictures:rgbaOf(mats.find(m=>t.id===`${m.id}/${t.role}`)!,t.role,t.top).pictures}));
function materials(clay=false){
 for(const [slot,{t,pictures}]of textures.entries()){
  const neutral=t.role==='base'?[155,155,155,255]:t.role==='mro'?[255,180,0,255]:NEUTRAL[t.role];
  view.texture(slot,t.role,clay?[Uint8Array.from(neutral.slice(0,t.role==='normal'?2:4))]:pictures);
 }
}
materials();
const anatomy=process.argv.includes('--anatomy');
const cases=anatomy? [
 {name:'side',clip:'idle',frame:0,around:90,above:3,centre:[0,1.90,-1.52],radius:4.05,textured:true},
 {name:'quarter',clip:'idle',frame:0,around:59,above:9,centre:[0,1.92,-1.62],radius:3.78,textured:true},
 {name:'plate',clip:'idle',frame:0,around:77,above:17,centre:[.34,3.08,-.55],radius:1.17,textured:true},
 {name:'manus',clip:'idle',frame:0,around:30,above:10,centre:[.69,.24,1.21],radius:.50,textured:true},
 {name:'pes',clip:'idle',frame:0,around:72,above:12,centre:[.77,.24,-.43],radius:.54,textured:true},
 {name:'standing-limb',clip:'idle',frame:0,around:66,above:4,centre:[.68,.90,.87],radius:1.03,textured:true},
 {name:'flank',clip:'idle',frame:0,around:90,above:6,centre:[.85,1.60,.26],radius:1.08,textured:true},
] as const:junctions? [
 {name:'shoulder-touchdown',clip:'walk',frame:45,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'hip-swing',clip:'walk',frame:35,around:80,above:8,centre:[.78,1.35,-.52],radius:1.0,textured:false},
 {name:'shoulder-run',clip:'run',frame:9,around:-80,above:8,centre:[-.65,1.05,.85],radius:1.10,textured:false},
 {name:'hip-run',clip:'run',frame:32,around:80,above:8,centre:[.78,1.35,-.52],radius:1.0,textured:false},
] as const:process.argv.includes('--details')? [
 {name:'forelimb-clay',clip:'idle',frame:0,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'forelimb-stance',clip:'walk',frame:12,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'forelimb-toeoff',clip:'walk',frame:25,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'forelimb-swing',clip:'walk',frame:35,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'forelimb-touchdown',clip:'walk',frame:45,around:80,above:8,centre:[.65,1.05,.85],radius:1.10,textured:false},
 {name:'neck-clay',clip:'idle',frame:0,around:65,above:8,centre:[0,1.45,1.85],radius:1.25,textured:false},
 {name:'plate-clay',clip:'idle',frame:0,around:80,above:8,centre:[-.25,3.15,-.65],radius:1.35,textured:false},
 {name:'mouth-clay',clip:'call',frame:29,around:65,above:8,centre:[0,1.55,2.45],radius:.85,textured:false},
 {name:'mouth-top',clip:'call',frame:29,around:65,above:30,centre:[0,1.55,2.45],radius:.85,textured:true},
] as const : [
 {name:'face',clip:'idle',frame:0,around:65,above:8,centre:[0,1.27,2.5],radius:.65},
 {name:'mouth',clip:'call',frame:29,around:65,above:8,centre:[0,1.55,2.45],radius:.85},
 {name:'body',clip:'idle',frame:0,around:58,above:14,centre:[0,1.95,-1.50],radius:4.65},
 {name:'swim',clip:'swim',frame:15,around:65,above:12,centre:[0,1.95,-1.50],radius:4.65},
 {name:'impale-acquire',clip:'impale_in',frame:25,around:160,above:10,centre:[-1,1.9,-1.6],radius:4.65},
 {name:'impale-lift',clip:'impale_hold',frame:15,around:160,above:10,centre:[-1,1.9,-1.6],radius:4.65},
 {name:'fall',clip:'fall',frame:15,around:65,above:12,centre:[0,1.9,-1.50],radius:4.65},
 {name:'torpor',clip:'torpor_idle',frame:0,around:65,above:12,centre:[0,.95,-1.50],radius:4.65},
 {name:'death-middle',clip:'death',frame:35,around:65,above:12,centre:[0,1.5,-1.50],radius:4.65},
 {name:'death-limp',clip:'death',frame:52,around:65,above:12,centre:[0,.95,-1.50],radius:4.65},
]as const;
for(const c of cases){
 sampleClip(rig.clips.get(c.clip)!,c.frame,rig.a);solve(rig,rig.a,rig.solved);
 materials('textured' in c&&!c.textured);
 view.draw({mesh:pack.meshIndex.get('core:stego')!,level:0,around:c.around,above:c.above,centre:c.centre,radius:c.radius,rig,colors:STEGO_DYES,textured:true});
 save(c.name,c);
}
sampleClip(rig.clips.get('idle')!,0,rig.a);solve(rig,rig.a,rig.solved);
for(const layer of anatomy||junctions||process.argv.includes('--details')?[]:[16,32,48,64,80,96]){
 view.draw({mesh:pack.meshIndex.get('core:stego')!,level:0,around:65,above:12,centre:[0,1.95,-1.50],radius:4.65,rig,colors:STEGO_DYES,textured:true,layer});
 save(`damage-${layer}`,{clip:'idle',frame:0,layer,around:65,above:12,centre:[0,1.95,-1.50],radius:4.65});
}
writeFileSync(`var/stego-review/${prefix}-native${anatomy?'-anatomy':junctions?'-junctions':process.argv.includes('--details')?'-details':''}-images.json`,JSON.stringify({packSha256:createHash('sha256').update(bytes).digest('hex'),scope:'Actual finest packed geometry and named native clips. ModelView RGBA texture fallback is capped at1024; these are not compressed2K client-material or GPU residency evidence.',width:view.raster.width,height:view.raster.height,images},null,2)+'\n');
