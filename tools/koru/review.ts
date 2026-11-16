// Actual native App, streamed production packs and authoritative map collision; no separate yacht renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { MODE_GHOST, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { seedKoruPreview } from "./dev.ts";
import { KORU_COURSE, koruCourse, koruWorldPoint } from "./course.ts";

export interface KoruShot {
  readonly name: string;
  /** World-space feet on an actual floor, or the origin of the deliberate exterior spectator. */
  readonly feet: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly mode: "walk" | "spectator";
  readonly tier: "high" | "lowpoly";
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
export function koruReviewShots(): readonly KoruShot[] {
  const p = koruWorldPoint, { views, dimensions, decks, rig, docking } = KORU_LAYOUT;
  const floor = (index: number, eye: readonly number[]) => p([eye[0]!, decks[index]!.floorY, eye[2]!]);
  const spectator = (eye: readonly number[]) => p([eye[0]!, eye[1]! - 1.62, eye[2]!]);
  const focus = p([0, dimensions.highestMast / 3, 0]);
  const framePoints = [p([-dimensions.beam / 2, 0, dimensions.hullMinZ]), p([dimensions.beam / 2, 0, dimensions.hullMaxZ]), p(dimensions.bowspritTip), ...rig.masts.map(mast => p([0, mast.tipY, mast.z]))];
  const walk = (name: string, deck: number, eye: readonly number[], target: readonly number[], extra: Partial<KoruShot> = {}): KoruShot => ({ name, feet: floor(deck, eye), target: p(target), mode: "walk", tier: "high", ...extra });
  return [
    { name: "01-authentic-arrival", feet: [KORU_COURSE.spawn.x, docking.shoreLanding[1]!, KORU_COURSE.spawn.z], target: focus, mode: "walk", tier: "high", arrival: true, framePoints },
    { name: "02-shore-scenic", feet: [KORU_COURSE.scenic.x, docking.shoreLanding[1]!, KORU_COURSE.scenic.z], target: focus, mode: "walk", tier: "high", framePoints },
    { name: "03-port-profile", feet: spectator(views.profile), target: focus, mode: "spectator", tier: "high", framePoints },
    { name: "04-bow-quarter", feet: spectator(views.bowQuarter), target: focus, mode: "spectator", tier: "high" },
    { name: "05-stern-quarter", feet: spectator(views.sternQuarter), target: focus, mode: "spectator", tier: "high" },
    walk("06-port-gangway", 1, docking.shoreApproach, [docking.arrival[0]!, docking.arrival[1]! + 1.4, docking.arrival[2]!]),
    walk("07-lower-interior", 0, views.lowerInterior, [0, decks[0]!.floorY + 1.4, -23]),
    walk("08-main-salon", 1, views.mainSalon, [-2.5, decks[1]!.floorY + 1.3, -37]),
    walk("09-upper-bridge", 2, views.upperBridge, [0, decks[2]!.floorY + 1.45, 20]),
    walk("10-sun-terrace", 3, views.sunTerrace, [0, decks[3]!.floorY + 1.3, -26]),
    walk("11-grand-stair", 1, views.stairs, [-1, decks[1]!.floorY + 1.5, 1.5]),
    walk("12-portrait-arrival-lobby", 1, views.arrival, [0, decks[1]!.floorY + 1.4, -29], { portrait: true }),
    { name: "13-flat-profile", feet: spectator(views.profile), target: focus, mode: "spectator", tier: "lowpoly", framePoints },
    walk("14-flat-main-salon", 1, views.mainSalon, [-2.5, decks[1]!.floorY + 1.3, -37], { tier: "lowpoly" }),
    walk("15-shoulder-stair", 1, views.stairs, [-1, decks[1]!.floorY + 1.5, 1.5], { thirdPerson: true }),
    ...[280, 650, 900].map((distance, index): KoruShot => ({ name: `${16 + index}-far-${distance}m`, feet: spectator([distance, 35, -10]), target: focus, mode: "spectator", tier: "high", far: true, framePoints })),
  ];
}

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet); [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

function capture(shot: KoruShot, map: MapData, pack: Pack, files: GameFiles, width: number, height: number, out: string) {
  const built = compileContent(CORE_CONTENT); if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("Koru visitor", {}, { manual: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = shot.tier; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null;
  const frame = (now: number) => {
    port.advance(now); packet = app.frame(now, width, height);
    if (packet && session.world) { raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest); uploadOnly(raster, packet); }
  };
  const run = (ms: number) => h.run(ms, frame);
  try {
    frame(0); run(1200); seedKoruPreview(h.host); run(300);
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
    run(3600); const corrections = session.stats.corrections; run(600);
    const p = packet as FramePacket | null, render = raster as Rasterizer | null;
    if (!p || !render || !app.scene) throw new Error(`${shot.name}: native App produced no frame`);
    if (shot.mode === "walk") {
      if (!(ents.flags[me.ent]! & F_GROUNDED) || ents.mode[me.ent] !== MODE_WALK) throw new Error(`${shot.name}: visitor is not standing on the authored floor`);
      if (Math.abs(ents.y[me.ent]! - shot.feet[1]) > .15) throw new Error(`${shot.name}: requested floor and real support disagree`);
      if (!capsuleFree(h.world, p.camX, p.camY - .06, p.camZ, .06, .12)) throw new Error(`${shot.name}: normal camera intersects native collision`);
      if (p.camY < h.world.hf.waterAt(p.camX, p.camZ)) throw new Error(`${shot.name}: interior camera is incorrectly underwater`);
    }
    const draws: { mesh: string; lod: number; instances: number; triangles: number }[] = [];
    let submittedTriangles = 0;
    for (let i = 0; i < p.drawCount; i++) {
      const mesh = files.manifest.meshes[p.drawMesh[i]!]!, lod = p.drawLod[i]!, count = p.drawInstances[i]!;
      const triangles = (p.drawIndexCount[i] ? p.drawIndexCount[i]! / 3 : mesh.levels[lod]?.tris ?? 0) * count;
      submittedTriangles += triangles;
      if (mesh.id.startsWith("core:koru") || mesh.id === "core:far") draws.push({ mesh: mesh.id, lod, instances: count, triangles });
    }
    if (!draws.some(draw => draw.mesh.startsWith("core:koru")) && !shot.far) throw new Error(`${shot.name}: actual frame drew no authored Koru mesh`);
    if (shot.far && !draws.length) throw new Error(`${shot.name}: distant yacht has neither a native mesh nor a map proxy`);
    if (p.dropped || p.skipped || p.casterDropped) throw new Error(`${shot.name}: native rendering dropped draws or shadow casters`);
    const framing = (shot.framePoints ?? []).map(point => {
      const projected = new Float32Array(3);
      if (!app.cam.project(...point, projected) || projected[0]! < .02 || projected[0]! > .98 || projected[1]! < .02 || projected[1]! > .98) throw new Error(`${shot.name}: authored silhouette point ${point.join(",")} is clipped by the camera`);
      return { point, screen: [...projected] };
    });
    render.render(p); const scene = render.color.slice(); drawUi(render.color, width, height, app.ui.frame);
    writeFileSync(resolve(out, `${shot.name}-scene.png`), encodePng(width, height, scene));
    writeFileSync(resolve(out, `${shot.name}.png`), encodePng(width, height, render.color));
    return { ...shot, width, height, draws, submittedTriangles, drawCount: p.drawCount,
      dropped: p.dropped, skipped: p.skipped, casterDropped: p.casterDropped,
      city: app.scene.city?.stats, assets: app.scene.assets.line(),
      camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch, thirdPerson: app.view.thirdPerson },
      state: { x: ents.x[me.ent], y: ents.y[me.ent], z: ents.z[me.ent], mode: ents.mode[me.ent], grounded: !!(ents.flags[me.ent]! & F_GROUNDED) },
      framing,
      settledCorrections: session.stats.corrections - corrections,
      fixture: shot.arrival ? "Genuine map arrival, authored spawn facing and ordinary first-person camera; no setup placement or look adjustment." : "One authoritative setup placement before settling; walking views then use ordinary player movement and camera collision. Exterior views use an identified spectator." };
  } finally { h.host.shutdown(); }
}

/** Runs only production assets through the real App. The plan's coordinates come from the shared authored layout. */
export async function reviewKoru(map: MapData, shots: readonly KoruShot[], args = process.argv.slice(2)): Promise<void> {
  const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = resolve(value("--source") ?? SOURCE), out = resolve(value("--out") ?? "var/koru-preview/review");
  const [width, height] = (value("--size") ?? "1200x800").split("x").map(Number) as [number, number];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("--size must be 320x240 through 1920x1080");
  console.log(`Loading native production packs from ${source}`);
  const bytes = corePack(source), pack = parsePack(bytes), native = pack.header.meshes.filter(m => m.id.startsWith("core:koru"));
  if (!native.length || native.some(m => m.lods.length < 6)) throw new Error("Build the authored Koru production meshes with all six LODs before native review");
  const named = await namedTextures(source);
  console.log("Preparing native mesh and texture streams");
  const files = splitWithTextures(bytes, t => { const texture = named.get(t.id); if (!texture) throw new Error(`Missing production texture ${t.id}`); return rgbaOf(texture.material, t.role, t.top); });
  const only = (value("--only") ?? "").split(",").filter(Boolean), selected = shots.filter(shot => !only.length || only.some(word => shot.name.includes(word)));
  if (!selected.length) throw new Error("--only matched no review scene");
  mkdirSync(out, { recursive: true }); const report: Record<string, unknown>[] = [], packHash = hashBytes(bytes).toString(16).padStart(8, "0");
  if (only.length && existsSync(resolve(out, "report.json"))) report.push(...JSON.parse(readFileSync(resolve(out, "report.json"), "utf8")).shots.filter((s: { name: string }) => !selected.some(shot => shot.name === s.name)));
  for (const shot of selected) {
    console.log(`Native Koru review ${shot.name}`);
    report.push({ ...capture(shot, map, pack, files, shot.portrait ? 540 : width, shot.portrait ? 960 : height, out), packHash });
    report.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "native map → authoritative Harness → App → streamed production packs → native frame packet → Rasterizer", shots: report,
      limits: "Static native software-rendered views establish model, collision-camera and streaming behavior; they do not establish browser GPU performance or identical lit ocean shading." }, null, 2));
  }
  console.log(`${out}: ${report.length} native Koru views`);
}

if (import.meta.main) await reviewKoru(koruCourse(), koruReviewShots());
