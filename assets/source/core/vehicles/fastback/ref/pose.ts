// Render the delivered pack at the driver's eye and in the door-open pose.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FASTBACK_ART } from "../../../../../../content/vehicles/fastback-art.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../../shared/anim/skeleton.ts";
import { quatAxis } from "../../../../../../shared/math/quat.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { Stage } from "../../../../../../tests/fixtures/stage.ts";
import { findAssets } from "../../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";

const {id,anchors}=FASTBACK_ART;
const asset=(await findAssets()).find(a=>a.id===id)!;
const pack=parsePack(new Uint8Array(readFileSync(asset.file)));
const mesh=pack.meshIndex.get(id)!;
const rig=buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!,pack.clips)!;
const materials=materialsOf(asset);
const textures=pack.header.textures!.map(t=>rgbaOf(materials.find(m=>t.id===m.id+"/"+t.role)!,t.role,t.top,null));
const paint=[46,220,91,0,0,0];
const width=880,height=560;
const view=new ModelView(pack,width,height,[.82,.84,.85]);
textures.forEach((t,i)=>view.texture(i,t.role,t.pictures));
rig.a.rest();
quatAxis(rig.a.rot,rig.names.indexOf("door_left")*4,0,1,0,-1.1);
quatAxis(rig.a.rot,rig.names.indexOf("door_right")*4,0,1,0,1.1);
solve(rig,rig.a,rig.solved);
view.draw({mesh,level:0,centre:[0,.72,-.04],radius:2.1,around:63,above:18,rig,colors:paint,textured:true,zoom:1.16});

const stage=new Stage(pack,width,height);
[stage.cam.x,stage.cam.y,stage.cam.z]=anchors.camera_driver;
stage.cam.pitch=-.13;stage.cam.yaw=-.08;stage.cam.fovY=1.22;
const at={x:0,y:0,z:0};
const following={x:.1,y:0,z:5.8};

/** Look for the lead car through the actual packed vehicle in both rendering paths. */
function fromDriver(flat:boolean,withLead:boolean):Uint8Array {
  stage.begin();
  textures.forEach((t,i)=>stage.texture(i,t.role,t.pictures));
  stage.add(id,flat ? 1 : 0,{...at,flat,bone:stage.pose(rig,at),regions:paint});
  if(withLead) stage.add(id,1,{...following,flat,bone:stage.pose(rig,following),regions:[41,220,91,0,0,0]});
  return new Uint8Array(stage.render());
}

const cockpit=fromDriver(false,true);
for(const flat of [false,true]){
  const empty=fromDriver(flat,false);
  const lead=flat ? fromDriver(true,true) : cockpit;
  let visible=0;
  for(let y=0;y<height/2;y++) for(let x=width/4;x<3*width/4;x++){
    const i=(y*width+x)*4;
    if(Math.abs(lead[i]!-empty[i]!)+Math.abs(lead[i+1]!-empty[i+1]!)+Math.abs(lead[i+2]!-empty[i+2]!)>16) visible++;
  }
  if(visible<1000) throw new Error(`Driver sightline occluded. Only ${visible} pixels of lead vehicle visible.`);
  console.log(`${flat ? "Flat":"Textured"} driver sightline reaches ${visible} lead-vehicle pixels.`);
}
const output=new Uint8Array(width*height*8);
for(let y=0;y<height;y++){
  output.set(view.raster.color.subarray(y*width*4,(y+1)*width*4),y*width*8);
  output.set(cockpit.subarray(y*width*4,(y+1)*width*4),y*width*8+width*4);
}
writeFileSync(join(process.argv[2]??import.meta.dir,"native-poses.png"),encodePng(width*2,height,output));
