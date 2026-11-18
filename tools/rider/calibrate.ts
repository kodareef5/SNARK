// Development inspection of the native calibration; the source builder will own final metadata generation.
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {parsePack} from "../../shared/pack/pack.ts";
import {unpackMeshes} from "../../tools/pack/write.ts";
import {calibrateHand} from "../../tools/pack/grips.ts";
const pack=parsePack(new Uint8Array(readFileSync("assets/source/core/humans/human-bodies/human-bodies.snpk"))),meshes=unpackMeshes(pack),out=[];
for(const mesh of meshes.filter(m=>m.id.endsWith("/hands"))){
 const rig=pack.header.rigs.find(r=>r.id===mesh.rig)!,result=calibrateHand(mesh,Float32Array.from(rig.rest));out.push(result);
 console.log(mesh.id,Math.min(...result.checks.map(r=>r.clearance)),Math.max(...result.checks.flatMap(r=>r.contacts)),Math.max(...result.checks.map(r=>r.gap)));
}
mkdirSync("var/rider-grip",{recursive:true});
writeFileSync("var/rider-grip/calibration.json",JSON.stringify(out,null,2));
