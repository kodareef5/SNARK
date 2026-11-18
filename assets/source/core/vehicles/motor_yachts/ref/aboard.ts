// Material reviews from the seat, dock and harbour at the stored texture sizes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME } from "../../../../../../client/core/render/packet.ts";
import { skyFrame, theSky } from "../../../../../../client/core/render/sky.ts";
import { MARINE_MODELS } from "../../../../../../content/vehicles/marine-fleet.ts";
import { waterlineOf } from "../../../../../../content/vehicles/harbour-wrecks.ts";
import { formWaterlines } from "../../../../../../tools/boat/wrecks.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { Stage } from "../../../../../../tests/fixtures/stage.ts";
import { findAssets } from "../../../../../../tools/art/assets.ts";
import { materialsOf, readMaps } from "../../../../../../tools/art/materials.ts";
import { materialMips } from "../../../../../../tools/pack/texture.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";
import { PICK_SKY } from "../../../../../../tools/snap/raster.ts";

const [id, out] = process.argv.slice(2);
if (!id || !out) throw new Error("Expected vessel id and review directory");
const form = id.match(/_(damaged|sunk)$/)?.[1];
const model = MARINE_MODELS.find(m => m.id === id.replace(/_(damaged|sunk)$/, ""));
const asset = (await findAssets()).find(a => a.id === id);
if (!model || asset?.spec.kind !== "creature") throw new Error("No vessel " + id);
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const mesh = pack.header.meshes[pack.meshIndex.get(id)!]!;
const rig = buildRig(pack.header.rigs[mesh.rig!]!, pack.clips)!;
const stage = new Stage(pack, 1200, 800);
const sky = theSky();
stage.raster.skyTable = sky.table;
let hour = 12;
const draw = stage.raster.render.bind(stage.raster);
stage.raster.render = packet => {
  skyFrame(hour, sky, packet.frame);
  packet.sun.set(packet.frame.subarray(FRAME.sun, FRAME.sun + 3));
  packet.frame[FRAME.eyeHeight] = stage.cam.y - water;
  draw(packet);
};
const regions = asset.spec.regions.map(r => r.sample);
const historical = model.id === "core:belvedere";
const water = form === "sunk" ? (historical ? model.beltline-.28+mesh.center[1]-mesh.half[1] : Math.max(1.2,model.beltline*.9)) :
  form === "damaged" ? waterlineOf(model.draft, model.beltline, formWaterlines().get(model.id)) : model.draft;
const [x, y, z] = model.seats[0]!;
const L = model.length;
const targetY = water + (form === "sunk" ? .98 : 1.83);
const poses = JSON.parse(readFileSync(new URL("../../marine/forms.json",import.meta.url),"utf8"));
const dent = form && poses[model.id.slice(5)]?.[form]?.dents[0]?.[0];
const flank = form === "damaged" && dent ? Math.sign(dent[0]) || 1 : form === "sunk" ? -1 : 1;
const quarter = form === "damaged" && dent ? Math.sign(dent[2]) || 1 : flank;
type Shot = { file: string; hour: number; eye: readonly number[]; target: readonly number[]; fov: number };
const exterior: Shot[] = [12, 17.6].flatMap(hour => {
  const light = hour === 12 ? "noon" : "low";
  return [
    { file: "dock-"+light, hour, eye: [flank*(model.beam*.5+10), water+2.6, quarter*4.8],
      target: [0,targetY,quarter*2], fov: 1.02 },
    { file: "harbour-"+light, hour, eye: [-flank*80,water+3.9,-quarter*60],
      target: [0,targetY,0], fov: .88 },
  ];
});
const cameras = exterior.concat(form ? [form === "damaged"
  ? { file: "glass", hour: 12, eye: [.60*model.beam, water+2.23, .306*L],
    target: [.24*model.beam, water+1.70, .199*L], fov: .64 }
  : { file: "glass", hour: 12, eye: [-1.08*model.beam, water+1.36, -.019*L],
    target: [-.46*model.beam, water+.76, .043*L], fov: .65 }
] : [
  { file: "pilot", hour: 12, eye: model.camera, target: [x-.06,y+.47,z+.73], fov: 1.10 },
  { file: "low-sun", hour: 17.6, eye: [-1.42*L,.66*L,-1.10*L], target: [0,model.height*.40,0], fov: .41 },
]);
if (!form && model.id === "core:sovereign")
  cameras.push({file:"pool",hour:12,eye:[2.6,4.32,-17.2],target:[0,2.25,-14.04],fov:.66});
mkdirSync(out, { recursive: true });
for (const [index, shot] of cameras.entries()) {
  hour = shot.hour;
  const [ex, ey, ez] = shot.eye;
  const dx = shot.target[0]! - ex!, dy = shot.target[1]! - ey!, dz = shot.target[2]! - ez!;
  Object.assign(stage.cam, { x: ex, y: ey, z: ez, near: .025, far: Math.max(145,L*6),
    yaw: Math.atan2(dx,dz), pitch: Math.atan2(dy,Math.hypot(dx,dz)), fovY: shot.fov });
  stage.begin();
  if (index === 0) {
    for (const material of materialsOf(asset)) {
      const mips = materialMips(readMaps(material));
      pack.header.textures?.forEach((t, slot) => {
        if (t.id === material.id+"/"+t.role)
          stage.texture(slot, t.role, mips[t.role]!.slice(0,Math.log2(t.top)+1));
      });
    }
  }
  const origin = { x: 0, y: 0, z: 0 };
  stage.add(id, shot.file.startsWith("harbour-") ? 1 : 0, { ...origin, bone: stage.pose(rig,origin), regions });
  const pixels = new Uint8Array(stage.render());
  const ray = [0,0,0];
  const m = stage.cam.viewProj;
  const sea = hour === 12 ? [56,83,91] : [55,61,75];
  for (let i=0; i<stage.raster.pickKind.length; i++) {
    stage.cam.ray(((i%1200)+.5)/1200, (Math.floor(i/1200)+.5)/800, ray);
    if (ray[1]! >= 0) continue;
    const t = (water-ey)/ray[1]!;
    const [rx,ry,rz] = [ray[0]!*t, water-ey, ray[2]!*t];
    const w = m[3]!*rx + m[7]!*ry + m[11]!*rz;
    const zPlane = (m[2]!*rx + m[6]!*ry + m[10]!*rz + m[14]!)/w;
    if (stage.raster.pickKind[i] === PICK_SKY || zPlane < stage.raster.depth[i]!) pixels.set(sea,i*4);
  }
  writeFileSync(join(out, shot.file+".png"),encodePng(1200,800,pixels));
}
