// Add one vehicle to the actual game build while retaining every byte of the existing core mesh/texture streams.
// Only the small boot header/blob and manifest are merged; the usual browser entrypoints are bundled separately.
import { copyFileSync, linkSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { COMPACT, COPPER_COMPACT, compactMesh, compactRig } from "./source.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack, setTexture, textureOf, type PackHeader } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { brotli } from "../build-client.ts";
import { buildTextures, type TextureSource } from "../pack/encode.ts";
import { baseMips, packedMips, readPicture } from "../pack/image.ts";
import { partHash } from "../pack/manifest.ts";
import { splitPack } from "../pack/split.ts";
import { buildPack, PackBlob } from "../pack/write.ts";

const ROOT=resolve(import.meta.dir,"../..");
export const INTEGRATED_DIST=resolve(ROOT,"client/dist");
export const DEFAULT_CORE_DIST="/home/user/Desktop/SNARK/client/dist";
/** Task-owned immutable inode references on the core source filesystem; survives another checkout rebuilding dist. */
export const CORE_ASSET_CACHE="/home/user/.cache/snark-gta-integration-20261115/assets";

/** Atomic replacement avoids ever modifying a reused hardlink in place. */
function writeOwn(path:string,bytes:Uint8Array|string):void {
  const temp=`${path}.${process.pid}.tmp`;writeFileSync(temp,bytes);renameSync(temp,path);
}

/** Content-addressed files are immutable. On another filesystem use an explicit read-only source reference. */
function reuse(source:string,dest:string):"linked"|"referenced" {
  if(source===dest)throw new Error("urban build destination must be isolated from the core source");
  try {
    if(lstatSync(dest).isSymbolicLink()&&readlinkSync(dest)===source)return "referenced";
    unlinkSync(dest);
  } catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  try {linkSync(source,dest);return "linked";}
  catch(error){if((error as NodeJS.ErrnoException).code!=="EXDEV")throw error;symlinkSync(source,dest);return "referenced";}
}

function pinCoreAsset(source:string,cache:string,expectedBytes:number):string {
  const name=basename(source);
  if(!/\.[0-9a-f]{16}\./.test(name))throw new Error("only immutable content-addressed core files may be shared");
  mkdirSync(cache,{recursive:true});
  const sourceStat=statSync(source),cacheStat=statSync(cache),pinned=join(cache,name);
  if(sourceStat.dev!==cacheStat.dev)throw new Error("core asset cache is on another filesystem; choose a task-owned cache on the source filesystem, no bulk copy performed");
  if(sourceStat.size!==expectedBytes)throw new Error(`core asset size changed while building: ${name}`);
  let linked=false;
  try{linkSync(source,pinned);linked=true;}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  const stat=statSync(pinned);
  // An earlier build may already pin this exact content hash after main has replaced its path with a new inode.
  if(stat.size!==expectedBytes||stat.dev!==sourceStat.dev||(linked&&stat.ino!==sourceStat.ino))throw new Error(`core cache differs from its immutable source: ${name}`);
  return pinned;
}

function compactTextureSources():TextureSource[] {
  const dir=resolve(ROOT,"assets/source/urban/vehicles/compact/tex");
  return ([
    ["details-base","details-base-512.png","base",512],["details-packed","details-packed-512.png","mro",512],
    ["paint-base","paint-base-512.png","base",512],["paint-packed","paint-packed-512.png","mro",512],
    ["upholstery-base","upholstery-base-512.png","base",512],["upholstery-packed","upholstery-packed-512.png","mro",512],
  ]as const).map(([id,path,role,top])=>({id:`${COMPACT.id}/${id}`,role,top,mips:()=>{
    const picture=readPicture(join(dir,path));return role==="base"?baseMips(picture):packedMips(picture);
  }}));
}

export interface IntegratedAssetReport {
  coreMeshes:number;
  totalMeshes:number;
  coreTextures:number;
  totalTextures:number;
  reusedFiles:number;
  /** References into the task-owned coreAssetCache, never the mutable lifetime of another dist folder. */
  sourceReferences:number;
  encodedMegapixels:number;
  bootBytes:number;
  addedBytes:number;
  clipHash:number;
  dist:string;
  coreAssetCache:string;
}

/** Append compact assets without decoding, requantizing or regenerating the dodo, humans or any other core art. */
export async function buildIntegratedAssets(opts:{baseDist?:string;dist?:string;cache?:string}={}):Promise<IntegratedAssetReport> {
  const base=resolve(opts.baseDist??DEFAULT_CORE_DIST),dist=resolve(opts.dist??INTEGRATED_DIST);
  if(base===dist)throw new Error("urban build needs an isolated destination");
  const sourceAssets=join(base,"assets"),target=join(dist,"assets"),cache=resolve(opts.cache??CORE_ASSET_CACHE);mkdirSync(target,{recursive:true});
  if(cache===sourceAssets||cache.startsWith(`${sourceAssets}/`))throw new Error("core cache must be owned by this task, outside the source dist");
  const manifest=parseManifest(readFileSync(join(sourceAssets,"manifest.json"),"utf8"));
  if(manifest.meshes.some((m)=>m.id.startsWith("urban:")))throw new Error("core source already contains urban assets; choose the unmodified core dist");
  if(!manifest.meshes.some((m)=>m.id==="core:dodo")||!manifest.meshes.some((m)=>m.id.startsWith("core:human_m/")))throw new Error("core source must retain the actual dodo and current human art");
  const coreMeshes=manifest.meshes.length,coreTextures=manifest.textures?.length??0;
  const oldBootFile=manifest.files[manifest.boot]!,oldBoot=parsePack(new Uint8Array(readFileSync(join(sourceAssets,oldBootFile.name))));
  if(oldBoot.clips.hash!==manifest.clipHash)throw new Error("core boot and manifest clip hashes disagree");
  const palette=defaultPalette();
  if(oldBoot.palette.some((value,index)=>value!==palette[index]))throw new Error("core source palette differs from this checkout");

  const added=splitPack(buildPack([compactMesh(),compactMesh(COPPER_COMPACT)],palette,[],[compactRig()]),"urban");
  // A GPU picks one variant globally. Encode all three for only these six small maps, on one worker.
  const textures=await buildTextures(added.manifest,compactTextureSources(),"urban",{workers:1});
  const addBoot=parsePack(added.files[0]!.bytes),rigOffset=oldBoot.header.rigs.length;
  const materialOffset=manifest.materials?.length??0,textureOffset=manifest.textures?.length??0;
  const blob=new PackBlob();blob.append(oldBoot.blob);const addedAt=blob.append(addBoot.blob);
  const header:PackHeader=structuredClone(oldBoot.header);
  header.rigs.push(...addBoot.header.rigs);
  for(const mesh of addBoot.header.meshes) header.meshes.push({...mesh,rig:mesh.rig===undefined?undefined:mesh.rig+rigOffset,lods:mesh.lods.map((lod)=>({...lod,indexOffset:lod.indexOffset+addedAt,vertexOffset:lod.vertexOffset+addedAt}))});
  const mergedBytes=blob.file(header),merged=parsePack(mergedBytes);
  if(merged.clips.hash!==oldBoot.clips.hash)throw new Error("urban merge changed core animation clips");
  const bootName=`core-urban.boot.${partHash(mergedBytes)}.snpk`;
  let reusedFiles=0,sourceReferences=0;
  for(let file=0;file<manifest.files.length;file++){
    if(file===manifest.boot)continue;
    const name=manifest.files[file]!.name;
    if(basename(name)!==name)throw new Error("core asset filename must be local");
    const pinned=pinCoreAsset(join(sourceAssets,name),cache,manifest.files[file]!.bytes);
    if(reuse(pinned,join(target,name))==="referenced")sourceReferences++;
    reusedFiles++;
  }
  writeOwn(join(target,bootName),mergedBytes);writeOwn(join(target,`${bootName}.br`),brotli(mergedBytes,true));
  manifest.files[manifest.boot]={name:bootName,bytes:mergedBytes.length,role:"boot"};
  const bootDelta=merged.blobAt-oldBoot.blobAt;
  for(const mesh of manifest.meshes)for(const level of mesh.levels){
    if(level.file===manifest.boot)level.at+=bootDelta;
    if(level.surface?.file===manifest.boot)level.surface.at+=bootDelta;
  }

  const fileMap:number[]=[manifest.boot];
  const files=[...added.files,...textures.files];let addedBytes=0;
  for(let file=1;file<files.length;file++){
    const one=files[file]!,description=added.manifest.files[file]!;
    const name=one.name.replace(/\.(\w+)$/,`.${partHash(one.bytes)}.$1`);
    fileMap[file]=manifest.files.length;
    manifest.files.push({...description,name,bytes:one.bytes.length});
    writeOwn(join(target,name),one.bytes);addedBytes+=one.bytes.length;
  }
  for(const mesh of added.manifest.meshes){
    const moved=structuredClone(mesh);if(moved.rig!==undefined)moved.rig+=rigOffset;
    for(const level of moved.levels){
      if(level.file===0)level.at=merged.blobAt+addedAt+level.at-addBoot.blobAt;
      level.file=fileMap[level.file]!;
      if(level.surface){if(level.surface.file===0)level.surface.at=merged.blobAt+addedAt+level.surface.at-addBoot.blobAt;level.surface.file=fileMap[level.surface.file]!;}
      if(level.sections)for(let i=0;i<level.sections.length;i+=3)level.sections[i]!+=materialOffset;
    }
    manifest.meshes.push(moved);
  }
  manifest.materials??=[];
  for(const material of added.manifest.materials??[]){
    const moved={...material};for(const role of TEXTURE_ROLES){const texture=textureOf(moved,role);if(texture>=0)setTexture(moved,role,texture+textureOffset);}
    manifest.materials.push(moved);
  }
  manifest.textures??=[];
  for(const texture of added.manifest.textures??[]){
    const moved=structuredClone(texture);for(const variant of Object.values(moved.in))variant.file=fileMap[variant.file]!;
    manifest.textures.push(moved);
  }
  // Keep every existing mesh/page/texture/icon index. Only appended records and original boot byte positions change.
  parseManifest(JSON.stringify(manifest));
  const json=JSON.stringify(manifest);writeOwn(join(target,"manifest.json"),json);writeOwn(join(target,"manifest.json.br"),brotli(new TextEncoder().encode(json),true));
  const report={coreMeshes,totalMeshes:manifest.meshes.length,coreTextures,totalTextures:manifest.textures.length,reusedFiles,sourceReferences,encodedMegapixels:textures.report.megapixels,bootBytes:mergedBytes.length,addedBytes,clipHash:manifest.clipHash,dist,coreAssetCache:cache};
  writeOwn(join(dist,"urban-build.json"),JSON.stringify({...report,baseDist:base},null,2)+"\n");
  return report;
}

/** Rebundle the actual game shell/workers and copy the actual client page; no alternate UI or world. */
export async function bundleIntegratedClient(dist=INTEGRATED_DIST):Promise<{jsBytes:number}> {
  mkdirSync(dist,{recursive:true});
  const entrypoints=["client/shell/main.ts","client/voice/voice-worker.ts","client/voice/voice-capture.ts","client/voice/voice-playback.ts","client/assets/assets-worker.ts"].map((file)=>join(ROOT,file));
  const result=await Bun.build({entrypoints,outdir:dist,naming:"[name].[ext]",target:"browser",minify:true,sourcemap:"linked"});
  if(!result.success)throw new Error(result.logs.map(String).join("\n"));
  copyFileSync(join(ROOT,"client/index.html"),join(dist,"index.html"));
  for(const name of ["index.html",...result.outputs.filter((o)=>o.path.endsWith(".js")).map((o)=>basename(o.path))])writeOwn(join(dist,`${name}.br`),brotli(new Uint8Array(readFileSync(join(dist,name))),true));
  return {jsBytes:result.outputs.find((o)=>o.path.endsWith("main.js"))!.size};
}

if(import.meta.main){
  if(!process.argv.includes("--bundle-only"))console.log(JSON.stringify(await buildIntegratedAssets({baseDist:process.env.SNARK_CORE_DIST})));
  if(!process.argv.includes("--assets-only"))console.log(JSON.stringify(await bundleIntegratedClient()));
}
