// Refit Stego's bone-local weapon contacts to an existing native mesh, preserving every draw and clip byte.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findAssets } from "../art/assets.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fitHitSurface } from "../pack/hit-hulls.ts";
import { PackBlob, unpackMeshes } from "../pack/write.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Give the input Stego pack and the output pack path");
const asset = (await findAssets(resolve("assets/source"))).find(a => a.id === "core:stego")?.spec;
if (asset?.kind !== "creature" || !asset.hitSurfaces) throw new Error("Stego’s authored hit surfaces are required");
const pack = parsePack(readFileSync(input));
const rig = pack.header.rigs.find(r => r.id === "core:stego");
const mesh = unpackMeshes(pack).find(m => m.id === "core:stego")?.lods[0];
if (!rig?.names || !rig.parent || !rig.caps || !mesh?.bones || !mesh.weights || !mesh.joints)
  throw new Error("Stego's weighted finest skin and named hit rig are required");
const skin = { positions: mesh.positions, indices: mesh.indices, bones: mesh.bones, joints: mesh.joints, weights: mesh.weights };
rig.hitSurfaces = asset.hitSurfaces.map(s => fitHitSurface(s, skin, rig.names!, rig.parent!, rig.rest, rig.caps!));
const writer = new PackBlob();
writer.append(pack.blob);
const result = writer.file(pack.header);
if (!Buffer.from(parsePack(result).blob).equals(pack.blob)) throw new Error("Contact refit changed the mesh or animation payload");
writeFileSync(output, result);
