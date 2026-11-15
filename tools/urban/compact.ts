// Bounded, one-asset build and software review. Does not discover/build core assets or start a server.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { COMPACT } from "../../assets/source/urban/vehicles/compact/asset.ts";
import { compactMesh, compactRig, COPPER_COMPACT, DETAIL_COLORS } from "../../assets/source/urban/vehicles/compact/model.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { asPicture, baseMips, encodePng, packedMips, readPicture, type Picture } from "../pack/image.ts";
import { manifestOf } from "../pack/manifest.ts";
import { rgbaTexture, writeTextureFile } from "../pack/texture.ts";
import { buildPack } from "../pack/write.ts";
// Reuse the small frame-packet stage: this performs a real render through Rasterizer, without a world/core pack.
import { Stage } from "../../tests/fixtures/stage.ts";

export { COMPACT, compactMesh, compactRig, COPPER_COMPACT };
export const COMPACT_SOURCE = resolve(import.meta.dir, "../../assets/source/urban/vehicles/compact");

function packed(): Picture {
  const size = COMPACT.textures.runtimeTop, data = new Uint8Array(size * size * 4);
  // Engine packing is R occlusion, G roughness, B metalness. Enamel is dielectric; no invented normals.
  for (let p = 0; p < data.length; p += 4) data.set([255, 158, 0, 255], p);
  return {width:size, height:size, channels:4, depth:8, data};
}

/** Tiny constant-color swatches keep the entire vehicle within the engine's three-section limit. */
export function compactDetails(role: "base" | "mro"): Picture {
  const size=64, data=new Uint8Array(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const k=Math.min(6,Math.floor(x/8));
    const rgb=role==="base" ? DETAIL_COLORS[k]! : [255,[158,230,76,128,112,128,230][k]!,k===3?220:0];
    data.set([...rgb,255],(y*size+x)*4);
  }
  return {width:size,height:size,channels:4,depth:8,data};
}

/** Reusable upload shim for a larger native stage containing this car and other actors. */
export function uploadCompactTextures(stage: Stage, maps: ReadonlyMap<string,Uint8Array[]>): void {
  stage.pack.header.textures?.forEach((texture,slot) => {
    const mips=maps.get(texture.id);
    if (mips) stage.texture(slot,texture.role,mips);
  });
}

/** Native pack + streamed RGBA textures, ready for the existing loader. All paths stay within this asset. */
export function buildCompact(): {bytes: Uint8Array; manifest: Manifest; maps: ReadonlyMap<string,Uint8Array[]>} {
  const source = readPicture(resolve(COMPACT_SOURCE, COMPACT.textures.base));
  const base = baseMips(source).slice(0, Math.log2(COMPACT.textures.runtimeTop) + 1);
  const mro = packedMips(packed());
  const maps = new Map([[`${COMPACT.id}/paint-base`,base],[`${COMPACT.id}/paint-packed`,mro],[`${COMPACT.id}/details-base`,baseMips(compactDetails("base"))],[`${COMPACT.id}/details-packed`,packedMips(compactDetails("mro"))]]);
  const bytes = buildPack([compactMesh()], defaultPalette(), [], [compactRig()]);
  const pack = parsePack(bytes);
  const texture = writeTextureFile("rgba", pack.header.textures!.map((t) => rgbaTexture(t.role, maps.get(t.id)!)));
  const manifest = manifestOf("compact.pack", bytes);
  manifest.files.push({name:"compact.rgba.tex", bytes:texture.bytes.length, role:"tex", format:"rgba"});
  manifest.textures!.forEach((t, k) => {t.in.rgba = {file:1, at:texture.placed[k]!.at, hash:texture.placed[k]!.hash};});
  parseManifest(JSON.stringify(manifest));
  const dest = resolve(COMPACT_SOURCE, "dist");
  mkdirSync(dest, {recursive:true});
  writeFileSync(resolve(dest, "compact.pack"), bytes);
  writeFileSync(resolve(dest, "compact.rgba.tex"), texture.bytes);
  writeFileSync(resolve(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(resolve(COMPACT_SOURCE, "tex/paint-base-256.png"), encodePng(asPicture(base.at(-1)!)));
  writeFileSync(resolve(COMPACT_SOURCE, COMPACT.textures.packed), encodePng(packed()));
  writeFileSync(resolve(COMPACT_SOURCE,"tex/details-base-64.png"),encodePng(compactDetails("base")));
  writeFileSync(resolve(COMPACT_SOURCE,"tex/details-packed-64.png"),encodePng(compactDetails("mro")));
  return {bytes, manifest, maps};
}

/** Closed, open-driver-door, rear and flat-small-size views with the exact streamed material. */
export function reviewCompact(built: ReturnType<typeof buildCompact>): void {
  const pack = parsePack(built.bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
  const render = (size: number, from: readonly number[], door = 0, level = 0, inPack=pack, id: string=COMPACT.id): Uint8ClampedArray => {
    const stage = new Stage(inPack, size, size);
    [stage.cam.x, stage.cam.y, stage.cam.z] = [from[0]!, from[1]!, from[2]!];
    stage.cam.yaw = Math.atan2(-stage.cam.x, -stage.cam.z);
    stage.cam.pitch = Math.atan2(.75 - stage.cam.y, Math.hypot(stage.cam.x,stage.cam.z));
    stage.cam.fovY = .7;
    stage.begin();
    uploadCompactTextures(stage,built.maps);
    const bone = stage.pose(rig, {x:0,y:0,z:0}, (rot) => {
      // Left door opens toward +X: a negative rotation about its Y hinge swings its rear edge outward.
      rot[5*4+1] = Math.sin(-door/2); rot[5*4+3] = Math.cos(-door/2);
    });
    stage.add(id, level, {x:0,y:0,z:0,bone});
    return stage.render().slice();
  };
  const dir = resolve(COMPACT_SOURCE, "review"); mkdirSync(dir, {recursive:true});
  const rows = [
    {name:"front-closed",size:384,from:[5,3.1,6],door:0,level:0},
    {name:"front-door-open",size:384,from:[5,3.1,6],door:1.15,level:0},
    {name:"rear-closed",size:384,from:[-5,2.5,-6],door:0,level:0},
    {name:"readability-128",size:128,from:[5,3.1,6],door:0,level:1},
    {name:"readability-48",size:48,from:[5,3.1,6],door:0,level:2},
    {name:"readability-16",size:16,from:[5,3.1,6],door:0,level:2},
  ];
  const width = 1152, height = 544, sheet = new Uint8Array(width*height*4);
  for (let p=0;p<sheet.length;p+=4) sheet.set([26,31,35,255],p);
  rows.forEach((r,k) => {
    const data = render(r.size,r.from,r.door,r.level);
    writeFileSync(resolve(dir,`${r.name}.png`), encodePng({width:r.size,height:r.size,channels:4,depth:8,data:new Uint8Array(data)}));
    const x = k < 3 ? k*384 : [0,384,768][k-3]!, y = k < 3 ? 0 : 400;
    // Small views stay at their actual pixel size; enlarging would hide a silhouette failure.
    for (let row=0;row<r.size;row++) sheet.set(data.subarray(row*r.size*4,(row+1)*r.size*4),((y+row)*width+x)*4);
  });
  writeFileSync(resolve(dir,"sheet.png"),encodePng({width,height,channels:4,depth:8,data:sheet}));
  // Two replaceable presentations share one mechanical contract and the same seven-bone rig.
  const variants=parsePack(buildPack([compactMesh(),compactMesh(COPPER_COMPACT)],defaultPalette(),[],[compactRig()]));
  const pair=new Uint8Array(768*384*4);
  for (const [k,id] of [COMPACT.id,COPPER_COMPACT.id].entries()) {
    const data=render(384,[5,3.1,6],0,0,variants,id);
    for (let row=0;row<384;row++) pair.set(data.subarray(row*384*4,(row+1)*384*4),(row*768+k*384)*4);
  }
  writeFileSync(resolve(dir,"paint-variants.png"),encodePng({width:768,height:384,channels:4,depth:8,data:pair}));
  const source = readFileSync(resolve(COMPACT_SOURCE,COMPACT.textures.base));
  const report = {id:COMPACT.id, triangles:pack.header.meshes[0]!.lods.map((l)=>l.indexCount/3), vertices:pack.header.meshes[0]!.lods.map((l)=>l.vertexCount), bones:rig.bones, packBytes:built.bytes.length, streamBytes:built.manifest.files[1]!.bytes, sourceSha256:createHash("sha256").update(source).digest("hex"), runtimeTop:COMPACT.textures.runtimeTop, views:rows.map(({name,size,level,door})=>({name,size,level,doorRadians:door})), limitations:["Original rough geometry; no artist-authored clips or glass transparency.","Paint base is AI-generated; normal map intentionally absent; packed material is a constant authoring choice.","Door render tests presentation only, not authoritative entry/exit or collision.","Not registered in core content or the live scene; standalone native pack is the integration shim."]};
  writeFileSync(resolve(dir,"report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({asset:COMPACT.id,triangles:report.triangles,packBytes:report.packBytes,streamBytes:report.streamBytes,review:resolve(dir,"sheet.png")}));
}

if (import.meta.main) reviewCompact(buildCompact());
