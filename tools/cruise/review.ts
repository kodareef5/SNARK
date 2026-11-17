// Actual native App, streamed production packs and authoritative map collision; no separate cruise renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { App } from "../../client/core/app.ts";
import { DRAW_RANGED, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { SURFACE_MATERIAL } from "../../content/surfaces.ts";
import { CRUISE_COLLISION_INSTANCES, CRUISE_COLLISION_PROTOTYPES, CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { cruiseFootprintContains, type CruiseRoom } from "../../content/landmarks/cruise-layout.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import type { ClipSet } from "../../shared/anim/clip.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { hashBytes, hashString } from "../../shared/hash.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { allClips } from "../../shared/pack/clips.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { meshKnown, parseManifest } from "../../shared/pack/manifest.ts";
import { MODE_GHOST, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { mapHeightfield, parseMap, writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { LANDMARKS, SOURCE } from "../art/source.ts";
import { buildClient } from "../build-client.ts";
import type { GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { seedCruisePreview } from "./dev.ts";
import { assertCruiseMap, assertCruisePlaced } from "./preflight.ts";
import { auditCruiseFirstFrame } from "./first-frame.ts";
import { cruiseHash, verifyCruiseGroups, type CruisePackedGroups } from "./packed-groups.ts";
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
  /** Authoritative world time, changed through the ordinary dev command before the review settles. */
  readonly hour?: number;
  /** Captures the genuine map spawn and its authored facing, without a setup placement or look adjustment. */
  readonly arrival?: boolean;
  /** Important authored silhouette points that must all fit the ordinary camera. */
  readonly framePoints?: readonly (readonly [number, number, number])[];
  /** Real hull witnesses, separate from conservative virtual envelope corners. */
  readonly sightlinePoints?: readonly (readonly [number, number, number])[];
  /** Far shots intentionally let the native map proxy take over after structure rows leave interest. */
  readonly far?: boolean;
  /** Save a genuine nearby flat fallback while the production fine levels stream. */
  readonly coldFallback?: boolean;
}

/** Deliberate viewpoints consume the authored geometry, floor and eye anchors; only camera composition is preview-owned. */
export function cruiseReviewShots(map: MapData): readonly CruiseShot[] {
  const p = cruiseWorldPoint, { dimensions, views } = CRUISE_LAYOUT, c = CRUISE_COURSE;
  const hf = mapHeightfield(map), focus = p([0, 32, 0]);
  const framePoints: (readonly [number, number, number])[] = [];
  for (const x of [-dimensions.bridgeBeam / 2, dimensions.bridgeBeam / 2]) for (const y of [0, dimensions.provisionalHighestY]) for (const z of [dimensions.minZ, dimensions.maxZ]) framePoints.push(p([x, y, z]));
  const sightlinePoints = [p([dimensions.waterlineBeam / 2, 0, 0]), p([0, 3, dimensions.minZ]), p([0, 3, dimensions.maxZ])];
  const spectator = (at: readonly number[]): readonly [number, number, number] => p([at[0]!, at[1]! - 1.62, at[2]!]);
  const shots: CruiseShot[] = [{ name: "01-authentic-arrival", feet: [c.spawn.x, hf.heightAt(c.spawn.x, c.spawn.z), c.spawn.z], target: focus,
    mode: "walk", tier: "high", arrival: true, framePoints, sightlinePoints },
    { name: "02-shore-comparison", feet: [c.scenic.x, hf.heightAt(c.scenic.x, c.scenic.z), c.scenic.z], target: p([0, 28, -100]), mode: "walk", tier: "high" }];
  for (const tier of ["medium", "high"] as const) shots.push({ name: `03-port-profile-${tier}`, feet: spectator([400, 60, 0]), target: focus, mode: "spectator", tier, framePoints });
  // Eye origins stay on the source's real route/floor anchors. Look directions are composed toward the
  // actual furniture or architectural feature, rather than blindly aiming seven metres down every aisle.
  const instances = new Map(CRUISE_LAYOUT.instances.map(instance => [instance.id, instance]));
  const prototypes = new Map(CRUISE_LAYOUT.prototypes.map(prototype => [prototype.id, prototype]));
  const rooms = new Map<string, CruiseRoom>(CRUISE_LAYOUT.rooms.map(room => [room.id, room]));
  const fitting = (id: string, local?: readonly number[]): readonly number[] => {
    const instance = instances.get(id), prototype = instance && prototypes.get(instance.prototype);
    if (!instance?.placed || !prototype) throw new Error(`Cruise review fitting is missing: ${id}`);
    const bounds = prototype.visualBounds, point = local ?? bounds.min.map((value: number, axis: number) => (value + bounds.max[axis]!) / 2);
    return cruisePoint(instance.at[0]!, instance.at[1]!, instance.at[2]!, Math.round(instance.yaw * 65536 / 360), point);
  };
  const pearl = CRUISE_LAYOUT.pearl.center;
  const slideRuns = CRUISE_LAYOUT.instances.filter(instance => instance.placed && instance.id.startsWith("slide_0_") &&
    prototypes.get(instance.prototype)?.category === "waterpark").sort((a, b) => Number(a.id.split("_").at(-1)) - Number(b.id.split("_").at(-1)));
  if (!slideRuns.length) throw new Error("Cruise review requires the authored first slide course");
  const targets: Readonly<Record<string, readonly number[]>> = {
    promenade: [pearl[0]!, pearl[1]! - 1.8, pearl[2]!], pearl_cafe: fitting("cafe_sofa_1"),
    central_park: fitting("plant_8_8_1"), surfside: fitting("surfside_play_1"),
    theater: fitting("theater_screen"), dining_5: fitting("dining_table_5_1_14"), bridge: fitting("bridge_console_6"),
    grove: fitting("lounger_18_2"), thrill: fitting(slideRuns[Math.floor(slideRuns.length / 2)]!.id), hideaway: fitting("hideaway_pool", [0, -.18, 0]),
    medical: fitting("medical_fit_1_-14"), sample_interior: fitting("sample_interior", [2, 1.2, 1.6]),
    sample_suite: fitting("sample_suite", [2, 1.2, 1.6]), sample_ocean: fitting("sample_ocean", [2, 1.2, 1.6]),
    pearl, main_bar: fitting("main_bar_counter"), giovanni: fitting("giovanni_table_1"), casino: fitting("casino_table_5_1"),
    absolute_zero: fitting("ice_bench_1_1"), fitness: fitting("fitness_1_1"), spa: fitting("spa_1_1"),
    crew: fitting("crew_fit_1_12"), laundry: fitting("laundry_fit_1_-14"), galley: fitting("galley_fit_1_14"),
    engine: fitting("engine_fit_1_12"), workshop: fitting("workshop_fit_1_12"),
    chill: fitting("lounger_15_17"), pool_edge: fitting("prototype_pool", [0, -.18, 0]), cloud: fitting("lounger_17_2"),
    grove_upper: [0, rooms.get("grove_upper")!.bounds.min[1]! + .8, 68],
    waterpark: fitting(slideRuns[0]!.id), windjammer: fitting("windjammer_table_2"), pool_under: fitting("pool_lounge_sofa_1"),
  };
  const promenadeApproach = CRUISE_LAYOUT.routes.find(route => route.id === "pearl_arrival")?.anchors[1];
  if (!promenadeApproach) throw new Error("Cruise review requires the authored Promenade approach to the Pearl");
  const localViews = views.map(view => ({ ...view, at: view.id === "promenade" ? promenadeApproach : view.at, target: targets[view.id] ?? view.target }));
  // One room per distinct public/service destination; repeated dining floors share the deck-five view.
  for (const id of Object.keys(targets)) if (!localViews.some(view => view.id === id)) {
    const room = CRUISE_LAYOUT.rooms.find(room => room.id === id);
    if (!room) throw new Error(`Cruise review destination is missing: ${id}`);
    localViews.push({ id, at: room.routeTarget, target: targets[id]!, deck: room.deck, section: room.section, mode: "walk" });
  }
  const dome = rooms.get("aquadome")!;
  localViews.push({ id: "aquadome_lounge", at: [...dome.routeTarget], target: fitting("aquadome_pod_1_1"), deck: dome.deck, section: dome.section, mode: "walk" },
    { id: "aquatheater", at: [...dome.routeTarget], target: fitting("aquatheater_stage"), deck: dome.deck, section: dome.section, mode: "walk" });
  const roomAlias: Readonly<Record<string, string>> = { cabin_9: "cabin_9_0", dome_inside: "aquadome", aquadome_lounge: "aquadome", aquatheater: "aquadome" };
  for (const view of localViews) {
    const room = rooms.get(roomAlias[view.id] ?? view.id);
    if (!room) throw new Error(`Cruise review view has no authored room: ${view.id}`);
    if (view.at.some((value, axis) => value < room.bounds.min[axis]! - .02 || value > room.bounds.max[axis]! + .02) ||
        (room.footprint && !cruiseFootprintContains(room.footprint, view.at[0]!, view.at[2]!)))
      throw new Error(`Cruise review feet are outside the occupied room: ${view.id}`);
  }
  const medium = new Set(["cabin_9", "dome_inside", "aquadome_lounge", "aquatheater", "promenade", "central_park", "thrill", "bridge", "engine", "chill"]);
  for (const view of localViews) for (const tier of medium.has(view.id) ? ["medium", "high"] as const : ["high"] as const)
    shots.push({ name: `interior-${view.id}-${tier}`, feet: p(view.at), target: p(view.target), mode: view.mode as "walk" | "spectator", tier,
      coldFallback: ["aquatheater", "promenade", "cabin_9"].includes(view.id) });
  const promenade = localViews.find(view => view.id === "promenade" && view.mode === "walk");
  if (!promenade) throw new Error("Cruise review requires the authored Royal Promenade anchor");
  shots.push({ name: "04-portrait-promenade", feet: p(promenade.at), target: p(promenade.target), mode: "walk", tier: "high", portrait: true },
    { name: "05-shoulder-promenade", feet: p(promenade.at), target: p(promenade.target), mode: "walk", tier: "high", thirdPerson: true },
    { name: "night-public-promenade", feet: p(promenade.at), target: p(promenade.target), mode: "walk", tier: "high", hour: 21 });
  const park = localViews.find(view => view.id === "central_park")!;
  shots.push({ name: "07-open-canyon", feet: p(park.at), target: p([0, 46, 45]), mode: "walk", tier: "high" },
    { name: "08-starboard-profile", feet: spectator([-400, 42, 0]), target: focus, mode: "spectator", tier: "high", framePoints },
    { name: "09-bow-quarter", feet: spectator([-250, 68, 270]), target: p([0, 32, 30]), mode: "spectator", tier: "high", framePoints },
    { name: "10-stern-quarter", feet: spectator([-250, 68, -270]), target: p([0, 32, -30]), mode: "spectator", tier: "high", framePoints });
  // Close native-mesh detail views, intentionally cropped at the ordinary FOV.
  // Whole-envelope certification belongs to the separate 400 m profiles.
  shots.push({ name: "12-near-starboard-profile", feet: spectator([-185, 48, 0]), target: focus, mode: "spectator", tier: "high" },
    { name: "13-near-port-profile", feet: spectator([185, 48, 0]), target: focus, mode: "spectator", tier: "high" },
    { name: "12-near-starboard-profile-medium", feet: spectator([-185, 48, 0]), target: focus, mode: "spectator", tier: "medium" },
    { name: "13-near-port-profile-medium", feet: spectator([185, 48, 0]), target: focus, mode: "spectator", tier: "medium" });
  const lifeboat = fitting("lifeboat_1_6");
  shots.push({ name: "11-lifeboat-berth", feet: spectator([lifeboat[0]! + 19, lifeboat[1]! + 2.5, lifeboat[2]! + 2]),
    target: p(lifeboat), mode: "spectator", tier: "high" });
  shots.push({ name: "night-exterior", feet: spectator([-400, 42, 0]), target: focus, mode: "spectator", tier: "high", far: true, framePoints, hour: 21 });
  shots.push({ name: "06-flat-profile", feet: spectator([-400, 42, 0]), target: focus, mode: "spectator", tier: "lowpoly", framePoints });
  for (const distance of [280, 650, 900, 1300, 2000]) shots.push({ name: `far-${distance}m`, feet: spectator([-distance, 42, 0]), target: focus, mode: "spectator", tier: "high", far: true, framePoints });
  return shots;
}

/** Eight ordinary look directions at the three measured high-density destinations, on both unchanged tiers. */
export function cruiseHeadingShots(shots: readonly CruiseShot[]): readonly CruiseShot[] {
  return ["chill", "promenade", "casino"].flatMap(destination => {
    const source = shots.find(shot => shot.name === `interior-${destination}-high`);
    if (!source) throw new Error(`Cruise heading sweep lacks ${destination}`);
    const dx = source.target[0] - source.feet[0], dz = source.target[2] - source.feet[2];
    return (["medium", "high"] as const).flatMap(tier => Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle);
      return { ...source, tier, name: `sweep-${destination}-${tier}-${String(i * 45).padStart(3, "0")}`,
        target: [source.feet[0] + dx * c + dz * s, source.target[1], source.feet[2] - dx * s + dz * c] as const };
    }));
  });
}

const isShipMesh = (id: string): boolean => id.startsWith("cruise:") && !id.startsWith("cruise:port_");

/** Read the actual production build, including its initially unknown paged core meshes. */
async function cruiseFiles(names: readonly string[]): Promise<GameFiles & { boot: Pack; firstFrame: ReturnType<typeof auditCruiseFirstFrame> }> {
  // Rebuild here so source/pack ownership checks and rendered files cannot silently
  // refer to different revisions. Use the production compression for its census.
  await buildClient({ quick: false });
  const firstFrame = auditCruiseFirstFrame(names);
  if (!firstFrame.pass) throw new Error(`Combined cruise-map first-frame budget exceeded: ${JSON.stringify(firstFrame)}`);
  const assets = resolve(import.meta.dir, "../../client/dist/assets");
  const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
  if (!manifest.pages?.length || !manifest.meshes.some(mesh => !meshKnown(mesh))) throw new Error("Cruise review requires main's cold paged core manifest");
  const files: Uint8Array[] = manifest.files.map(file => readFileSync(join(assets, file.name)));
  let joined = { manifest, boot: parsePack(files[manifest.boot]!) };
  for (const name of names) {
    const own = parseManifest(readFileSync(join(assets, "landmarks", `${name}.json`), "utf8"));
    const bytes = own.files.map(file => readFileSync(join(assets, "landmarks", file.name)));
    joined = joinLandmark(joined, { manifest: own, boot: parsePack(bytes[own.boot]!) }, "landmarks");
    files.push(...bytes.filter((_, index) => index !== own.boot));
  }
  return { ...joined, files, firstFrame };
}

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet); [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

function capture(shot: CruiseShot, map: MapData, pack: Pack, clips: ClipSet, files: GameFiles, width: number, height: number, out: string, recordCpu: boolean, images: boolean, assetLatencyMs: number) {
  // Residency learns page rows in place. Each camera needs its own initial
  // manifest so an earlier view cannot turn a cold-load check into a warm one.
  files = { ...files, manifest: structuredClone(files.manifest) };
  const unknownAtStart = files.manifest.meshes.filter(mesh => !meshKnown(mesh)).length;
  if (!unknownAtStart) throw new Error(`${shot.name}: core pages were hydrated before the cold review began`);
  const built = compileContent(CORE_CONTENT); if (!built.registry) throw new Error(built.errors.join("\n"));
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips, rigs: pack.header.rigs }, built.registry);
  const reg = h.reg, placement = assertCruiseMap(map, reg);
  const placed = assertCruisePlaced(map, h.world.structs, reg);
  const boot = pack, port = new FakeNet(files.files, { keep: true, latencyMs: assetLatencyMs });
  const session = h.join("Cruise visitor", {}, { manual: true, look: defaultLook() });
  session.staticsArrived(h.world.statics!);
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = shot.tier; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null;
  let coldSetup = shot.arrival === true;
  type ColdFallback = { frame: number; file: string | null; feet: number[]; positionError: number; streaming: { flying: number; waiting: number; meshUploads: number; textureUploads: number; cityBehind: number }; meshes: { id: string; lod: number; distance: number }[] };
  let fallback: ColdFallback | null = null;
  const cellCenters = new Map(CRUISE_LAYOUT.cells.map(cell => [cell.id, cruiseWorldPoint(cell.origin)]));
  let quietFrames = 0, measure = false, measuredUploadFrames = 0;
  let resumedStreaming: unknown;
  const rejectedSamples: { uploadFrames: number; lastUpload: unknown }[] = [];
  const frameTimes: number[] = [], coldTimes: number[] = [];
  const cold = { pages: files.manifest.pages!.length, unknownAtStart, frames: 0, maxDraws: 0, maxTriangles: 0, maxCasters: 0, maxCityMakeMs: 0, maxCityMissing: 0, maxCityBehind: 0, maxResidentBytes: 0, maxUploadBytes: 0, dropped: 0, skipped: 0, casterDropped: 0 };
  const frame = (now: number) => {
    port.advance(now);
    const started = performance.now(); packet = app.frame(now, width, height); const elapsed = performance.now() - started;
    const residency = app.scene?.assets.residency;
    const streaming = !packet || !residency || residency.flying > 0 || residency.waiting > 0 || packet.assetUploads.length > 0 || packet.texUploads.length > 0 || (app.scene?.city?.stats.behind ?? 0) > 0;
    quietFrames = streaming ? 0 : quietFrames + 1;
    if (measure) { frameTimes.push(elapsed); if (streaming) {
      measuredUploadFrames++;
      resumedStreaming = { now, flying: residency?.flying, waiting: residency?.waiting, cityBehind: app.scene?.city?.stats.behind,
        meshes: packet?.assetUploads.map(upload => [files.manifest.meshes[upload.mesh]?.id, upload.level]), textures: packet?.texUploads.length };
    } }
    if (packet) {
      coldTimes.push(elapsed); cold.frames++;
      cold.maxDraws = Math.max(cold.maxDraws, packet.drawCount); cold.maxTriangles = Math.max(cold.maxTriangles, packet.triangles);
      cold.maxCasters = Math.max(cold.maxCasters, packet.casterCount); cold.maxCityMakeMs = Math.max(cold.maxCityMakeMs, app.scene?.city?.stats.makeMs ?? 0);
      cold.maxCityMissing = Math.max(cold.maxCityMissing, app.scene?.city?.stats.missing ?? 0); cold.maxCityBehind = Math.max(cold.maxCityBehind, app.scene?.city?.stats.behind ?? 0);
      cold.maxResidentBytes = Math.max(cold.maxResidentBytes, (residency?.stats.used ?? 0) + (residency?.reserved ?? 0));
      cold.maxUploadBytes = Math.max(cold.maxUploadBytes, packet.assetUploads.reduce((sum, upload) => sum + upload.data.byteLength, 0) + packet.texUploads.reduce((sum, upload) => sum + upload.data.byteLength, 0));
      cold.dropped += packet.dropped; cold.skipped += packet.skipped; cold.casterDropped += packet.casterDropped;
    }
    if (images && packet && session.world) { raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest); uploadOnly(raster, packet); }
    if (shot.coldFallback && !fallback && coldSetup && streaming && packet &&
        Math.hypot(session.own.x-shot.feet[0], session.own.y-shot.feet[1], session.own.z-shot.feet[2]) < 1) {
      const meshes: { id: string; lod: number; distance: number }[] = [];
      for (let i = 0; i < packet.drawCount; i++) {
        const mesh = files.manifest.meshes[packet.drawMesh[i]!], center = mesh && cellCenters.get(mesh.id), lod = packet.drawLod[i]!;
        if (!mesh || !center || lod < (mesh.flat ?? 0)) continue;
        const distance = Math.hypot(center[0]-packet.camX, center[1]-packet.camY, center[2]-packet.camZ);
        if (distance < 32) meshes.push({ id: mesh.id, lod, distance });
      }
      if (meshes.length) {
        const file = images ? `${shot.name}-cold-fallback-scene.png` : null;
        fallback = { frame: cold.frames, file, feet: [session.own.x, session.own.y, session.own.z],
          positionError: Math.hypot(session.own.x-shot.feet[0], session.own.y-shot.feet[1], session.own.z-shot.feet[2]),
          streaming: { flying: residency?.flying ?? 0, waiting: residency?.waiting ?? 0, meshUploads: packet.assetUploads.length,
            textureUploads: packet.texUploads.length, cityBehind: app.scene?.city?.stats.behind ?? 0 }, meshes };
        if (file && raster) { raster.render(packet); writeFileSync(resolve(out, file), encodePng(width, height, raster.color)); }
      }
    }
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(1200); seedCruisePreview(h.host); run(300);
    if (shot.hour !== undefined) {
      const response = h.host.exec(`settime ${shot.hour}`); run(300);
      if (!response.startsWith("time is ")) throw new Error(`${shot.name}: world clock command failed: ${response}`);
      if (Math.abs(hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock) - shot.hour) > .1) throw new Error(`${shot.name}: authoritative world time command did not take effect`);
    }
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
    coldSetup = true;
    run(3600);
    let corrections = session.stats.corrections, accepted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      // A quiet lull can precede a delayed visibility/LOD request. Retry only
      // within this bound; rejected sample timings and every packet peak stay
      // in cold/settling evidence. The accepted window is wholly upload-free.
      for (let waits = 0; quietFrames < 180 && waits < 48; waits++) run(250);
      if (quietFrames < 180) throw new Error(`${shot.name}: production asset streaming never settled for CPU sampling`);
      const before = { ...cold }, beforeTimes = coldTimes.length;
      corrections = session.stats.corrections;
      frameTimes.length = 0; measuredUploadFrames = 0; resumedStreaming = undefined;
      // Harness.run rounds virtual durations up to client frames. Advancing
      // one frame at a time avoids a floating deadline occasionally adding181.
      measure = true;
      for (let sample = 0; sample < 180; sample++) run(1);
      measure = false;
      if (measuredUploadFrames) {
        rejectedSamples.push({ uploadFrames: measuredUploadFrames, lastUpload: resumedStreaming });
        continue;
      }
      if (frameTimes.length !== 180) throw new Error(`${shot.name}: accepted sampling window must contain exactly 180 frames`);
      Object.assign(cold, before); coldTimes.length = beforeTimes;
      accepted = true;
      break;
    }
    if (!accepted) throw new Error(`${shot.name}: streaming persisted through bounded sampling retries: ${JSON.stringify(rejectedSamples)}`);
    const p = packet as FramePacket | null, render = raster as Rasterizer | null;
    if (!p || (images && !render) || !app.scene) throw new Error(`${shot.name}: native App produced no frame`);
    if (shot.arrival && Math.hypot(ents.x[me.ent]! - shot.feet[0], ents.z[me.ent]! - shot.feet[2]) > .25) throw new Error(`${shot.name}: spawn search displaced the visitor from the authored arrival`);
    if (shot.mode === "walk") {
      if (!(ents.flags[me.ent]! & F_GROUNDED) || ents.mode[me.ent] !== MODE_WALK) throw new Error(`${shot.name}: visitor is not standing on the authored floor`);
      if (Math.abs(ents.y[me.ent]! - shot.feet[1]) > .15) throw new Error(`${shot.name}: requested floor and real support disagree`);
      if (!capsuleFree(h.world, p.camX, p.camY - .06, p.camZ, .06, .12)) throw new Error(`${shot.name}: normal camera intersects native collision`);
      if (p.camY < h.world.hf.waterAt(p.camX, p.camZ)) throw new Error(`${shot.name}: interior camera is incorrectly underwater`);
    }
    const draws: { mesh: string; lod: number; instances: number; triangles: number }[] = [];
    for (let i = 0; i < p.drawCount; i++) {
      const mesh = files.manifest.meshes[p.drawMesh[i]!], lod = p.drawLod[i]!, count = p.drawInstances[i]!;
      if (!mesh) continue; // Native particles have no mesh.
      const triangles = ((p.drawFlags[i]! & (DRAW_RANGED | DRAW_TEXTURED)) !== 0 ? p.drawIndexCount[i]! / 3 : mesh.levels[lod]?.tris ?? 0) * count;
      if (isShipMesh(mesh.id) || mesh.id === "core:far") draws.push({ mesh: mesh.id, lod, instances: count, triangles });
    }
    const tier = app.scene.assets.tier;
    const faults: string[] = [];
    const capturedFallback = fallback as ColdFallback | null;
    if (shot.coldFallback && !capturedFallback) faults.push("requested nearby cold flat fallback was not observed while streaming at the intended floor");
    if (shot.coldFallback && images && (!capturedFallback?.file || !existsSync(resolve(out, capturedFallback.file)))) faults.push("requested cold fallback image was not saved");
    const worldSurfaces = app.scene.assets.residency.textureState().filter(texture => texture.id.startsWith(`${SURFACE_MATERIAL}/`));
    if (tier.lit && (worldSurfaces.length !== 3 || worldSurfaces.some(texture => texture.have < 0))) faults.push("native world-surface texture references are not resident");
    if (p.dropped || p.skipped || p.casterDropped) faults.push("native rendering dropped draws or shadow casters");
    if (cold.dropped || cold.skipped || cold.casterDropped) faults.push("native rendering dropped draws or shadow casters during cold streaming");
    if (p.drawCount > tier.budget.draws || p.triangles > tier.budget.triangles) faults.push("frame exceeds unchanged tier submission budget");
    if (app.scene.city && (app.scene.city.stats.missing || app.scene.city.stats.behind)) faults.push("far city did not settle");
    if (session.stats.corrections !== corrections) faults.push("prediction corrected after settling");
    const origin = CRUISE_COURSE.vessel, shipRows = cruiseStatics(origin.x, origin.y, origin.z, origin.yaw);
    const shipChunks = [...new Set(shipRows.map(s => chunkAt(map.dims, s.x, s.z)))];
    const handover = shipChunks.map(chunk => ({ chunk, complete: session.world!.city?.complete(chunk) ?? false, far: app.scene!.city?.isFar(chunk) ?? false }));
    if (!draws.some(draw => isShipMesh(draw.mesh)) && !(handover.some(chunk => chunk.far) && draws.some(draw => draw.mesh === "core:far"))) throw new Error(`${shot.name}: ship has neither native mesh nor map proxy draws`);
    for (const row of handover) if (row.complete === row.far) faults.push(`chunk ${row.chunk} has inconsistent near/far ownership`);
    if (shot.far && !handover.some(chunk => chunk.far)) throw new Error(`${shot.name}: requested distant review never exercised the native far handover`);
    const framing = (shot.framePoints ?? []).map(point => {
      const projected = new Float32Array(3);
      if (!app.cam.project(...point, projected) || projected[0]! < .02 || projected[0]! > .98 || projected[1]! < .02 || projected[1]! > .98) throw new Error(`${shot.name}: authored silhouette point ${point.join(",")} is clipped by the camera`);
      return { point, screen: [...projected] };
    });
    const sightlines = (shot.sightlinePoints ?? []).map(point => {
      const dx = point[0] - p.camX, dy = point[1] - p.camY, dz = point[2] - p.camZ, distance = Math.hypot(dx, dy, dz);
      const hit = castWorld(h.world, p.camX, p.camY, p.camZ, dx / distance, dy / distance, dz / distance, distance);
      if (hit !== HIT_NONE) {
        const kind = hit === HIT_STRUCTURE ? h.world.structs.chunks[Math.floor(rayHit.ref / 65536)]?.kind[rayHit.ref % 65536] : undefined;
        if (kind === undefined || !isShipMesh(reg.defs[kind]!.id)) throw new Error(`${shot.name}: terrain or another object hides the authored silhouette point ${point.join(",")}`);
      }
      return { point, shoreSightlineClear: true };
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
      placement: { ...placement, actualPlaced: placed.length, cruiseInstances: shipRows.length, auxiliaryPortAndKoruInstances: map.statics.length - shipRows.length },
      budget: { tier: tier.name, ...tier.budget, gpuBytes: tier.gpuBytes, uploadBytes: tier.uploadBytes },
      cold: { ...cold, assetLatencyMs, assetTransport: `${assetLatencyMs}ms fixed asset-request latency, unlimited bandwidth, no loss; native per-frame upload budgets remain enabled.`, medianMs: coldTimes[Math.floor(coldTimes.length / 2)], p95Ms: coldTimes[Math.ceil(coldTimes.length * .95) - 1], maxMs: coldTimes.at(-1),
        retries: rejectedSamples.length, rejectedSamples, fallback: capturedFallback,
        scope: "App.frame from cold client arrival through placement and streaming, including every discarded sample; excludes the accepted window and server/network/raster/GPU work." },
      shipTarget: { triangles: draws.filter(draw => isShipMesh(draw.mesh)).reduce((sum, draw) => sum + draw.triangles, 0), draws: draws.filter(draw => isShipMesh(draw.mesh)).length, targetTriangles: 1000000, targetDraws: 600, note: "Near cruise meshes only; shared far-city draws are reported separately and include port/Koru geometry." },
      residency: { ...app.scene.assets.residency?.stats }, worldSurfaces, casterCount: p.casterCount,
      city: app.scene.city?.stats, handover, assets: app.scene.assets.line(),
      camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch, thirdPerson: app.view.thirdPerson },
      lighting: { worldHour: hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock), clientHour: app.scene.hour, scope: "Native world clock, sky and supported ambient/sun shading; software RGB does not composite GPU shadow maps." },
      state: { x: ents.x[me.ent], y: ents.y[me.ent], z: ents.z[me.ent], mode: ents.mode[me.ent], grounded: !!(ents.flags[me.ent]! & F_GROUNDED) },
      framing, sightlines,
      settledCorrections: session.stats.corrections - corrections,
      fixture: shot.arrival ? "Genuine map arrival, authored spawn facing and ordinary first-person camera; no setup placement or look adjustment." : "One authoritative setup placement before settling; walking views then use ordinary player movement and camera collision. Exterior views use an identified spectator." };
  } finally { h.host.shutdown(); }
}

/** Runs only production assets through the real App. The plan's coordinates come from the shared authored layout. */
export async function reviewCruise(map: MapData, shots: readonly CruiseShot[], args = process.argv.slice(2)): Promise<void> {
  const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const sweep = args.includes("--heading-sweep"), source = resolve(value("--source") ?? SOURCE);
  const out = resolve(value("--out") ?? (sweep ? "var/cruise-preview/heading-capacity" : "var/cruise-preview/review"));
  const [width, height] = (value("--size") ?? "1200x800").split("x").map(Number) as [number, number];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("--size must be 320x240 through 1920x1080");
  const assetLatencyMs = Number(value("--asset-latency-ms") ?? 0);
  if (!Number.isInteger(assetLatencyMs) || assetLatencyMs < 0 || assetLatencyMs > 1000) throw new Error("--asset-latency-ms must be an integer from 0 through 1000");
  // The standard source path also supplies the native world-surface carrier. Its landmark root
  // belongs to this checkout; accepting an arbitrary external source would silently mix snapshots.
  if (source !== resolve(SOURCE)) throw new Error("Sync the matching assets into this checkout before review; --source must be its assets/source directory");
  if (!map.content?.landmarks.includes("cruise") || !map.content.landmarks.includes("koru")) throw new Error("Cruise review requires both map-local landmark packs");
  console.log(`Preparing native core + ${map.content.landmarks.join(" + ")} streams from ${source}`);
  const files = await cruiseFiles(map.content.landmarks), pack = files.boot;
  const native = files.manifest.meshes.filter(m => isShipMesh(m.id)), graybox = args.includes("--graybox");
  const cellIds = new Set(CRUISE_LAYOUT.cells.map(cell => cell.id));
  const standaloneIds = new Set(CRUISE_COLLISION_PROTOTYPES.filter(prototype => prototype.mesh !== "none" && !cellIds.has(prototype.mesh)).map(prototype => prototype.mesh));
  const meshes = new Map(files.manifest.meshes.map(mesh => [mesh.id, mesh]));
  if (!native.length || [...cellIds].some(id => !meshes.has(id))) throw new Error("Build every authored cruise cell before native review");
  let cellStages: { groupsSHA256: string; nativeLevels: Record<string, number>; authoredStages: Record<string, number> } | null = null;
  if (!graybox) {
    const asset = join(LANDMARKS, "cruise"), groupBytes = readFileSync(join(asset, "ref/packed-groups.json"));
    const groups: CruisePackedGroups = JSON.parse(groupBytes.toString());
    verifyCruiseGroups(groups, readFileSync(resolve(import.meta.dir, "../../content/landmarks/cruise-layout.json")), readFileSync(join(asset, "cruise.snpk")));
    if (groups.meshes.length !== cellIds.size || groups.meshes.some(mesh => !cellIds.has(mesh.id))) throw new Error("Packed ownership metadata must cover exactly the authored cruise cells");
    const nativeLevels: Record<string, number> = {}, authoredStages: Record<string, number> = {};
    for (const group of groups.meshes) {
      const mesh = meshes.get(group.id)!;
      if (mesh.levels.length < 2 || mesh.levels.length > 6 || group.levels.length !== mesh.levels.length) throw new Error(`${group.id}: expected 2..6 retained native levels with matching ownership metadata`);
      let previous = -1;
      for (let index = 0; index < group.levels.length; index++) {
        const level = group.levels[index]!, authored = level.authoredLevel;
        if (level.level !== index || !Number.isInteger(authored) || authored < 0 || authored > 5 || authored <= previous || (index === 0 && authored !== 0) ||
            level.triangles <= 0 || level.triangles !== mesh.levels[index]!.tris) throw new Error(`${group.id} L${index}: retained authored stage or native triangle coverage is invalid`);
        previous = authored;
      }
      const stages = group.levels.map(level => level.authoredLevel).join(",");
      nativeLevels[mesh.levels.length] = (nativeLevels[mesh.levels.length] ?? 0) + 1;
      authoredStages[stages] = (authoredStages[stages] ?? 0) + 1;
    }
    cellStages = { groupsSHA256: cruiseHash(groupBytes), nativeLevels, authoredStages };
  }
  // Doors and the independent port signs follow building-piece schedules, which need not have six levels.
  // Their distance/triangle/material budgets are checked by the native art gate; here every referenced
  // standalone must exist with real geometry at each authored level, independently of the cell count.
  for (const id of standaloneIds) {
    const mesh = meshes.get(id);
    if (!mesh?.levels.length || mesh.levels.some(level => level.tris <= 0)) throw new Error(`Missing or empty standalone cruise mesh: ${id}`);
  }
  const standaloneAssets = [...standaloneIds].map(id => ({ id, levels: meshes.get(id)!.levels.length }));
  // The production server poses with all clips, including creature clips split out of boot into
  // streamed files. allClips validates their complete hash against this very manifest.
  const clips = allClips(files.manifest, pack, file => files.files[file]!, stored => new Uint8Array(inflateRawSync(stored)));
  const only = (value("--only") ?? "").split(",").filter(Boolean);
  const selected = (sweep ? cruiseHeadingShots(shots) : shots).filter(shot => !only.length || only.some(word => shot.name.includes(word)));
  if (!selected.length) throw new Error("--only matched no review scene");
  mkdirSync(out, { recursive: true }); const report: Record<string, unknown>[] = [];
  const packHash = files.files.reduce((hash, bytes) => hashBytes(bytes, hash), hashBytes(pack.blob, hashString(JSON.stringify(files.manifest)))).toString(16).padStart(8, "0");
  const compiled = compileContent(CORE_CONTENT); if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const registryHash = withContent(compiled.registry, map.content.defs).hash.toString(16).padStart(8, "0"), mapHash = parseMap(writeMap(map)).hash.toString(16).padStart(8, "0");
  if (only.length && existsSync(resolve(out, "report.json"))) {
    const kept = (JSON.parse(readFileSync(resolve(out, "report.json"), "utf8")).shots as Record<string, unknown>[]).filter(old => !selected.some(shot => shot.name === old.name));
    if (kept.some(old => old.packHash !== packHash || old.registryHash !== registryHash || old.mapHash !== mapHash || old.packedGroupsHash !== (cellStages?.groupsSHA256 ?? null))) throw new Error("Partial review cannot combine different assets, content, map or packed stage metadata; run a complete review");
    report.push(...kept);
  }
  for (const shot of selected) {
    console.log(`Native cruise review ${shot.name}`);
    report.push({ ...capture(shot, map, pack, clips, files, shot.portrait ? 540 : width, shot.portrait ? 960 : height, out, !args.includes("--visual-only"), !args.includes("--no-images") && !sweep, assetLatencyMs), packHash, packedGroupsHash: cellStages?.groupsSHA256 ?? null, assetStage: graybox ? "preliminary graybox" : CRUISE_LAYOUT.phase });
    report.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "native LAND map → authoritative Harness → App → production cold paged core and separate landmark files, streamed assets and world surfaces → native frame packet → optional Rasterizer", packIdentity: "FNV-1a of joined manifest/boot blob and every source stream file, including textures and world surfaces", landmarks: map.content.landmarks, firstFrame: files.firstFrame, authoritativeAnimation: { clips: clips.clips.length, hash: clips.hash, rigs: pack.header.rigs.length }, cellStages, standaloneAssets, layout: { phase: CRUISE_LAYOUT.phase, logicalPrototypes: CRUISE_LAYOUT.prototypes.length, logicalInstances: CRUISE_LAYOUT.instances.filter(instance => instance.placed).length, collisionPrototypes: CRUISE_COLLISION_PROTOTYPES.length, cells: cellIds.size, placedInstances: CRUISE_COLLISION_INSTANCES.filter(instance => instance.placed).length, deckLabels: CRUISE_LAYOUT.decks.map(deck => deck.id) }, shots: report,
      limits: "Static native software-rendered views establish model, collision-camera and streaming behavior; they do not establish browser GPU performance or identical lit ocean shading." }, null, 2));
  }
  console.log(`${out}: ${report.length} native cruise views`);
  if (report.some(row => Array.isArray(row.faults) && row.faults.length)) throw new Error("Cruise prototype exceeded native acceptance; inspect saved per-view faults before proposing a bounded correction");
}

if (import.meta.main) { const map = cruiseCourse(); await reviewCruise(map, cruiseReviewShots(map)); }
