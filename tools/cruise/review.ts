// Actual native App, streamed production packs and authoritative map collision; no separate cruise renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { MODE_GHOST, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { mapHeightfield, parseMap, writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { seedCruisePreview } from "./dev.ts";
import { assertCruiseMap, assertCruisePlaced } from "./preflight.ts";
import { CRUISE_COURSE, cruiseCourse, cruiseWorldPoint } from "./course.ts";

export interface CruiseShot {
  readonly name: string;
  /** World-space feet on an actual floor, or the origin of the deliberate exterior spectator. */
  readonly feet: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly mode: "walk" | "spectator";
  readonly tier: "medium" | "high" | "lowpoly";
  readonly thirdPerson?: boolean;
  readonly portrait?: boolean;
  /** Captures the genuine map spawn and its authored facing, without a setup placement or look adjustment. */
  readonly arrival?: boolean;
  /** Important authored silhouette points that must all fit the ordinary camera. */
  readonly framePoints?: readonly (readonly [number, number, number])[];
  /** Far shots intentionally let the native map proxy take over after structure rows leave interest. */
  readonly far?: boolean;
}

/** Deliberate viewpoints consume the authored geometry, floor and eye anchors; only camera composition is preview-owned. */
export function cruiseReviewShots(map: MapData): readonly CruiseShot[] {
  const p = cruiseWorldPoint, { dimensions, views } = CRUISE_LAYOUT, c = CRUISE_COURSE;
  const hf = mapHeightfield(map), focus = p([0, 32, 0]);
  const framePoints = [p([-dimensions.waterlineBeam / 2, 0, dimensions.minZ]), p([dimensions.waterlineBeam / 2, 0, dimensions.maxZ]),
    p([-dimensions.bridgeBeam / 2, dimensions.provisionalHighestY, 0]), p([dimensions.bridgeBeam / 2, dimensions.provisionalHighestY, 0])];
  const spectator = (at: readonly number[]): readonly [number, number, number] => p([at[0]!, at[1]! - 1.62, at[2]!]);
  const shots: CruiseShot[] = [{ name: "01-authentic-arrival", feet: [c.spawn.x, hf.heightAt(c.spawn.x, c.spawn.z), c.spawn.z], target: focus,
    mode: "walk", tier: "high", arrival: true, framePoints },
    { name: "02-shore-comparison", feet: [c.scenic.x, hf.heightAt(c.scenic.x, c.scenic.z), c.scenic.z], target: p([0, 28, -100]), mode: "walk", tier: "high" }];
  for (const tier of ["medium", "high"] as const) {
    shots.push({ name: `03-port-profile-${tier}`, feet: spectator([400, 42, 0]), target: focus, mode: "spectator", tier, framePoints });
    for (const view of views) shots.push({ name: `interior-${view.id}-${tier}`, feet: p(view.at), target: p(view.target), mode: view.mode as "walk" | "spectator", tier });
  }
  const first = views.find(view => view.mode === "walk");
  if (first) shots.push({ name: "04-portrait-boarding", feet: p(first.at), target: p(first.target), mode: "walk", tier: "high", portrait: true },
    { name: "05-shoulder-boarding", feet: p(first.at), target: p(first.target), mode: "walk", tier: "high", thirdPerson: true });
  shots.push({ name: "06-flat-profile", feet: spectator([-400, 42, 0]), target: focus, mode: "spectator", tier: "lowpoly", framePoints });
  for (const distance of [280, 650, 900, 1300, 2000]) shots.push({ name: `far-${distance}m`, feet: spectator([-distance, 42, 0]), target: focus, mode: "spectator", tier: "high", far: true, framePoints });
  return shots;
}

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet); [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

function capture(shot: CruiseShot, map: MapData, pack: Pack, files: GameFiles, width: number, height: number, out: string, recordCpu: boolean, images: boolean) {
  const built = compileContent(CORE_CONTENT); if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, placement = assertCruiseMap(map, reg), h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const placed = assertCruisePlaced(map, h.world.structs, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("Cruise visitor", {}, { manual: true, city: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = shot.tier; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null;
  let quietFrames = 0, measure = false, measuredUploadFrames = 0;
  const frameTimes: number[] = [], coldTimes: number[] = [];
  const cold = { frames: 0, maxDraws: 0, maxTriangles: 0, maxCasters: 0, maxCityMakeMs: 0, maxCityMissing: 0, maxCityBehind: 0, maxResidentBytes: 0, maxUploadBytes: 0, dropped: 0, skipped: 0, casterDropped: 0 };
  const frame = (now: number) => {
    port.advance(now);
    const started = performance.now(); packet = app.frame(now, width, height); const elapsed = performance.now() - started;
    const residency = app.scene?.assets.residency;
    const streaming = !packet || !residency || residency.flying > 0 || residency.waiting > 0 || packet.assetUploads.length > 0 || packet.texUploads.length > 0 || (app.scene?.city?.stats.behind ?? 0) > 0;
    quietFrames = streaming ? 0 : quietFrames + 1;
    if (measure) { frameTimes.push(elapsed); if (streaming) measuredUploadFrames++; }
    else if (packet) {
      coldTimes.push(elapsed); cold.frames++;
      cold.maxDraws = Math.max(cold.maxDraws, packet.drawCount); cold.maxTriangles = Math.max(cold.maxTriangles, packet.triangles);
      cold.maxCasters = Math.max(cold.maxCasters, packet.casterCount); cold.maxCityMakeMs = Math.max(cold.maxCityMakeMs, app.scene?.city?.stats.makeMs ?? 0);
      cold.maxCityMissing = Math.max(cold.maxCityMissing, app.scene?.city?.stats.missing ?? 0); cold.maxCityBehind = Math.max(cold.maxCityBehind, app.scene?.city?.stats.behind ?? 0);
      cold.maxResidentBytes = Math.max(cold.maxResidentBytes, (residency?.stats.used ?? 0) + (residency?.reserved ?? 0));
      cold.maxUploadBytes = Math.max(cold.maxUploadBytes, packet.assetUploads.reduce((sum, upload) => sum + upload.data.byteLength, 0) + packet.texUploads.reduce((sum, upload) => sum + upload.data.byteLength, 0));
      cold.dropped += packet.dropped; cold.skipped += packet.skipped; cold.casterDropped += packet.casterDropped;
    }
    if (images && packet && session.world) { raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest); uploadOnly(raster, packet); }
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(1200); seedCruisePreview(h.host); run(300);
    const me = h.client(session)!, ents = h.world.ents, move = reg.move[ents.kind[me.ent]!]!;
    if (!shot.arrival) {
      if (shot.mode === "spectator") { session.text("enablecheats"); run(100); session.text("fly"); run(150); }
      // One documented setup placement. Everything after settling uses ordinary prediction, camera collision and rendering.
      ents.setPosition(me.ent, ...shot.feet); ents.vx[me.ent] = ents.vy[me.ent] = ents.vz[me.ent] = 0;
      ents.mode[me.ent] = shot.mode === "spectator" ? MODE_GHOST : MODE_WALK;
      ents.flags[me.ent] = ents.flags[me.ent]! & ~F_GROUNDED; me.ownDirty = true;
      const eye = shot.feet[1] + stanceEye(move, ents.stance[me.ent]!);
      const dx = shot.target[0] - shot.feet[0], dz = shot.target[2] - shot.feet[2];
      app.controls.yaw = Math.atan2(dx, dz); app.controls.pitch = Math.atan2(shot.target[1] - eye, Math.hypot(dx, dz));
    }
    if (app.view.thirdPerson !== !!shot.thirdPerson) { app.key("KeyV", true); app.key("KeyV", false); }
    run(3600);
    for (let waits = 0; quietFrames < 30 && waits < 48; waits++) run(250);
    if (quietFrames < 30) throw new Error(`${shot.name}: production asset streaming never settled for CPU sampling`);
    const corrections = session.stats.corrections;
    if (recordCpu) { measure = true; run(3000); measure = false; } else run(600);
    if (measuredUploadFrames) throw new Error(`${shot.name}: asset streaming resumed during settled CPU sampling`);
    const p = packet as FramePacket | null, render = raster as Rasterizer | null;
    if (!p || (images && !render) || !app.scene) throw new Error(`${shot.name}: native App produced no frame`);
    if (shot.mode === "walk") {
      if (!(ents.flags[me.ent]! & F_GROUNDED) || ents.mode[me.ent] !== MODE_WALK) throw new Error(`${shot.name}: visitor is not standing on the authored floor`);
      if (Math.abs(ents.y[me.ent]! - shot.feet[1]) > .15) throw new Error(`${shot.name}: requested floor and real support disagree`);
      if (!capsuleFree(h.world, p.camX, p.camY - .06, p.camZ, .06, .12)) throw new Error(`${shot.name}: normal camera intersects native collision`);
      if (p.camY < h.world.hf.waterAt(p.camX, p.camZ)) throw new Error(`${shot.name}: interior camera is incorrectly underwater`);
    }
    const draws: { mesh: string; lod: number; instances: number; triangles: number }[] = [];
    for (let i = 0; i < p.drawCount; i++) {
      const mesh = files.manifest.meshes[p.drawMesh[i]!]!, lod = p.drawLod[i]!, count = p.drawInstances[i]!;
      const triangles = (p.drawIndexCount[i] ? p.drawIndexCount[i]! / 3 : mesh.levels[lod]?.tris ?? 0) * count;
      if (mesh.id.startsWith("core:cruise") || mesh.id === "core:far") draws.push({ mesh: mesh.id, lod, instances: count, triangles });
    }
    const tier = app.scene.assets.tier;
    const faults: string[] = [];
    if (p.dropped || p.skipped || p.casterDropped) faults.push("native rendering dropped draws or shadow casters");
    if (p.drawCount > tier.budget.draws || p.triangles > tier.budget.triangles) faults.push("frame exceeds unchanged tier submission budget");
    if (app.scene.city && (app.scene.city.stats.missing || app.scene.city.stats.behind)) faults.push("far city did not settle");
    if (session.stats.corrections !== corrections) faults.push("prediction corrected after settling");
    const shipChunks = [...new Set(map.statics.filter(s => s.kind.startsWith("core:cruise")).map(s => chunkAt(map.dims, s.x, s.z)))];
    const handover = shipChunks.map(chunk => ({ chunk, complete: session.world!.city?.complete(chunk) ?? false, far: app.scene!.city?.isFar(chunk) ?? false }));
    if (!draws.some(draw => draw.mesh.startsWith("core:cruise")) && !(handover.some(chunk => chunk.far) && draws.some(draw => draw.mesh === "core:far"))) throw new Error(`${shot.name}: ship has neither native mesh nor map proxy draws`);
    for (const row of handover) if (row.complete === row.far) faults.push(`chunk ${row.chunk} has inconsistent near/far ownership`);
    if (shot.far && !handover.some(chunk => chunk.far)) throw new Error(`${shot.name}: requested distant review never exercised the native far handover`);
    const framing = (shot.framePoints ?? []).map(point => {
      const projected = new Float32Array(3);
      if (!app.cam.project(...point, projected) || projected[0]! < .02 || projected[0]! > .98 || projected[1]! < .02 || projected[1]! > .98) throw new Error(`${shot.name}: authored silhouette point ${point.join(",")} is clipped by the camera`);
      const dx = point[0] - p.camX, dy = point[1] - p.camY, dz = point[2] - p.camZ, distance = Math.hypot(dx, dy, dz);
      const hit = castWorld(h.world, p.camX, p.camY, p.camZ, dx / distance, dy / distance, dz / distance, distance);
      if (hit !== HIT_NONE) {
        const kind = hit === HIT_STRUCTURE ? h.world.structs.chunks[Math.floor(rayHit.ref / 65536)]?.kind[rayHit.ref % 65536] : undefined;
        if (kind === undefined || !reg.defs[kind]!.id.startsWith("core:cruise")) throw new Error(`${shot.name}: terrain or another object hides the authored silhouette point ${point.join(",")}`);
      }
      return { point, screen: [...projected], shoreSightlineClear: true };
    });
    if (images && render) {
      render.render(p); const scene = render.color.slice(); drawUi(render.color, width, height, app.ui.frame);
      writeFileSync(resolve(out, `${shot.name}-scene.png`), encodePng(width, height, scene));
      writeFileSync(resolve(out, `${shot.name}.png`), encodePng(width, height, render.color));
    }
    frameTimes.sort((a, b) => a - b); coldTimes.sort((a, b) => a - b);
    const percentile = (p: number) => frameTimes[Math.max(0, Math.ceil(frameTimes.length * p) - 1)]!;
    return { ...shot, width, height, registryHash: reg.hash.toString(16).padStart(8, "0"), mapHash: h.world.mapHash.toString(16).padStart(8, "0"), draws, submittedTriangles: p.triangles, drawCount: p.drawCount,
      cpu: recordCpu ? { samples: frameTimes.length, medianMs: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: percentile(1),
        scope: "Settled App.frame wall time only; excludes authoritative server stepping, network delivery, image encoding, software rasterization and browser GPU work." } : { samples: 0, scope: "Visual-only review; CPU timing deliberately omitted." },
      dropped: p.dropped, skipped: p.skipped, casterDropped: p.casterDropped, faults,
      placement: { ...placement, actualPlaced: placed.length, cruiseInstances: map.statics.filter(row => row.kind.startsWith("core:cruise")).length },
      budget: { tier: tier.name, ...tier.budget, gpuBytes: tier.gpuBytes, uploadBytes: tier.uploadBytes },
      cold: { ...cold, medianMs: coldTimes[Math.floor(coldTimes.length / 2)], p95Ms: coldTimes[Math.ceil(coldTimes.length * .95) - 1], maxMs: coldTimes.at(-1),
        scope: "App.frame from cold client arrival through placement and streaming; excludes server/network/raster/GPU work." },
      shipTarget: { triangles: draws.filter(draw => draw.mesh.startsWith("core:cruise")).reduce((sum, draw) => sum + draw.triangles, 0), draws: draws.filter(draw => draw.mesh.startsWith("core:cruise")).length, targetTriangles: 1000000, targetDraws: 600, note: "Near cruise meshes only; shared far-city draws are reported separately and include port/Koru geometry." },
      residency: { ...app.scene.assets.residency?.stats }, casterCount: p.casterCount,
      city: app.scene.city?.stats, handover, assets: app.scene.assets.line(),
      camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch, thirdPerson: app.view.thirdPerson },
      state: { x: ents.x[me.ent], y: ents.y[me.ent], z: ents.z[me.ent], mode: ents.mode[me.ent], grounded: !!(ents.flags[me.ent]! & F_GROUNDED) },
      framing,
      settledCorrections: session.stats.corrections - corrections,
      fixture: shot.arrival ? "Genuine map arrival, authored spawn facing and ordinary first-person camera; no setup placement or look adjustment." : "One authoritative setup placement before settling; walking views then use ordinary player movement and camera collision. Exterior views use an identified spectator." };
  } finally { h.host.shutdown(); }
}

/** Runs only production assets through the real App. The plan's coordinates come from the shared authored layout. */
export async function reviewCruise(map: MapData, shots: readonly CruiseShot[], args = process.argv.slice(2)): Promise<void> {
  const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = resolve(value("--source") ?? SOURCE), out = resolve(value("--out") ?? "var/cruise-preview/review");
  const [width, height] = (value("--size") ?? "1200x800").split("x").map(Number) as [number, number];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("--size must be 320x240 through 1920x1080");
  console.log(`Loading native production packs from ${source}`);
  const bytes = corePack(source), pack = parsePack(bytes), native = pack.header.meshes.filter(m => m.id.startsWith("core:cruise")), graybox = args.includes("--graybox");
  if (!native.length || (!graybox && native.some(m => m.lods.length !== 6))) throw new Error("Build the authored cruise production meshes with all six LODs before native review; --graybox is an explicitly preliminary collision-mesh audit");
  const named = await namedTextures(source);
  console.log("Preparing native mesh and texture streams");
  const files = splitWithTextures(bytes, t => { const texture = named.get(t.id); if (!texture) throw new Error(`Missing production texture ${t.id}`); return rgbaOf(texture.material, t.role, t.top); });
  const only = (value("--only") ?? "").split(",").filter(Boolean), selected = shots.filter(shot => !only.length || only.some(word => shot.name.includes(word)));
  if (!selected.length) throw new Error("--only matched no review scene");
  mkdirSync(out, { recursive: true }); const report: Record<string, unknown>[] = [], packHash = hashBytes(bytes).toString(16).padStart(8, "0");
  const compiled = compileContent(CORE_CONTENT); if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const registryHash = compiled.registry.hash.toString(16).padStart(8, "0"), mapHash = parseMap(writeMap(map)).hash.toString(16).padStart(8, "0");
  if (only.length && existsSync(resolve(out, "report.json"))) {
    const kept = (JSON.parse(readFileSync(resolve(out, "report.json"), "utf8")).shots as Record<string, unknown>[]).filter(old => !selected.some(shot => shot.name === old.name));
    if (kept.some(old => old.packHash !== packHash || old.registryHash !== registryHash || old.mapHash !== mapHash)) throw new Error("Partial review cannot combine different assets, content or map; run a complete review");
    report.push(...kept);
  }
  for (const shot of selected) {
    console.log(`Native cruise review ${shot.name}`);
    report.push({ ...capture(shot, map, pack, files, shot.portrait ? 540 : width, shot.portrait ? 960 : height, out, !args.includes("--visual-only"), !args.includes("--no-images")), packHash, assetStage: graybox ? "preliminary graybox" : "production" });
    report.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "native map → authoritative Harness → App → streamed production packs → native frame packet → optional Rasterizer", layout: { phase: CRUISE_LAYOUT.phase, prototypes: CRUISE_LAYOUT.prototypes.length, placedInstances: CRUISE_LAYOUT.instances.filter(instance => instance.placed).length, deckLabels: CRUISE_LAYOUT.decks.map(deck => deck.id) }, shots: report,
      limits: "Static native software-rendered views establish model, collision-camera and streaming behavior; they do not establish browser GPU performance or identical lit ocean shading." }, null, 2));
  }
  console.log(`${out}: ${report.length} native cruise views`);
  if (report.some(row => Array.isArray(row.faults) && row.faults.length)) throw new Error("Cruise prototype exceeded native acceptance; inspect saved per-view faults before proposing a bounded correction");
}

if (import.meta.main) { const map = cruiseCourse(); await reviewCruise(map, cruiseReviewShots(map)); }
