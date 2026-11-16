// Native App review: a real player operates the winch with E, while another client watches the synchronized rig.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import plan from "../../content/landmarks/koru-sails.json" with { type: "json" };
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MODE_GHOST, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { sailsProgress } from "../../shared/sim/sails.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import { koruWorldPoint } from "../koru/course.ts";
import { seedKoruPreview } from "../koru/dev.ts";
import { koruSailsCourse } from "./course.ts";

export interface SailShot {
  readonly name: string;
  readonly progress: number;
  readonly eye: readonly number[];
  readonly target: readonly number[];
  readonly tier?: "high" | "lowpoly";
  readonly reverse?: boolean;
}

export function sailReviewShots(): readonly SailShot[] {
  const eye = KORU_LAYOUT.views.profile, target = [0, 30, 8];
  return [
    { name: "01-lowered-broadside", progress: 0, eye, target },
    { name: "02-quarter-hoist", progress: .25, eye, target },
    { name: "03-half-hoist", progress: .5, eye, target },
    { name: "04-three-quarter-hoist", progress: .75, eye, target },
    { name: "05-raised-broadside", progress: 1, eye, target },
    { name: "06-raised-bow", progress: 1, eye: KORU_LAYOUT.views.bowQuarter, target },
    { name: "07-lowered-flat", progress: 0, eye, target, tier: "lowpoly" },
    { name: "08-raised-flat", progress: 1, eye, target, tier: "lowpoly" },
    { name: "09-reversed-half", progress: .5, eye, target, reverse: true },
    ...[280, 650, 900].map(distance => ({ name: `far-${distance}m-raised`, progress: 1, eye: [-distance, 35, -10], target })),
  ];
}

function uploadsOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.assetUploads.length + packet.texUploads.length + packet.drops.length + packet.assetDrops.length + packet.texDrops.length)) return;
  const draws = packet.drawCount, tiles = packet.tileCount, casters = packet.casterCount, cascades = packet.cascadeCount;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet);
  packet.drawCount = draws; packet.tileCount = tiles; packet.casterCount = casters; packet.cascadeCount = cascades;
}

export async function reviewKoruSails(args = process.argv.slice(2)): Promise<void> {
  const value = (key: string) => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const source = resolve(value("--source") ?? SOURCE), out = resolve(value("--out") ?? "var/koru-sails-preview/review");
  const only = (value("--only") ?? "").split(",").filter(Boolean), shots = sailReviewShots().filter(shot => !only.length || only.some(word => shot.name.includes(word)));
  const [width, height] = (value("--size") ?? "1200x800").split("x").map(Number) as [number, number];
  if (!shots.length || !Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) throw new Error("Select valid shots and a size from320x240 through1920x1080");
  console.log(`Preparing native sail meshes and textures from ${source}`);
  const bytes = corePack(source), pack = parsePack(bytes), named = await namedTextures(source);
  for (const sail of plan.sails) {
    const mesh = pack.header.meshes.find(mesh => mesh.id === sail.mesh);
    if (!mesh || mesh.lods.length !== 6 || mesh.skeleton !== sail.skeleton) throw new Error(`${sail.mesh}: missing six-level native sail asset`);
  }
  const files = splitWithTextures(bytes, texture => {
    const source = named.get(texture.id); if (!source) throw new Error(`Missing texture ${texture.id}`);
    return rgbaOf(source.material, texture.role, texture.top);
  });
  const built = compileContent(CORE_CONTENT); if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, boot = parsePack(files.files[0]!), map = koruSailsCourse(), report: unknown[] = [];
  mkdirSync(out, { recursive: true });
  for (const shot of shots) {
    console.log(`Native sails ${shot.name}`);
    const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs }, reg);
    try {
      const operator = h.join("Sail operator", {}, { manual: true, city: true }), observer = h.join("Sail observer", {}, { manual: true, city: true });
      const helm = new App(operator, reg, pack), port = new FakeNet(files.files, { keep: true }), app = new App(observer, reg, boot, { manifest: files.manifest, port });
      helm.ui.settings.tier = "lowpoly"; helm.ui.settings.steady = false;
      app.ui.settings.tier = shot.tier ?? "high"; app.ui.settings.steady = false;
      let raster: Rasterizer | null = null, packet: FramePacket | null = null, quiet = 0;
      const run = (ms: number) => h.run(ms, now => {
        helm.frame(now, 640, 480); port.advance(now); packet = app.frame(now, width, height);
        const residency = app.scene?.assets.residency;
        quiet = !packet || !residency || residency.flying || residency.waiting || packet.assetUploads.length || packet.texUploads.length || (app.scene?.city?.stats.behind ?? 0) ? 0 : quiet + 1;
        if (packet && observer.world) { raster ??= new Rasterizer(width, height, boot, observer.world.hf, files.manifest); uploadsOnly(raster, packet); }
      });
      run(1000); seedKoruPreview(h.host); run(100);
      const place = (session: typeof operator, app: App, feet: readonly number[], target: readonly number[], ghost: boolean) => {
        const client = h.client(session)!, ents = h.world.ents;
        ents.setPosition(client.ent, feet[0]!, feet[1]!, feet[2]!); ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
        ents.mode[client.ent] = ghost ? MODE_GHOST : MODE_WALK; ents.flags[client.ent] = ents.flags[client.ent]! & ~F_GROUNDED; client.ownDirty = true;
        const eye = feet[1]! + stanceEye(reg.move[ents.kind[client.ent]!]!, ents.stance[client.ent]!);
        app.controls.yaw = Math.atan2(target[0]! - feet[0]!, target[2]! - feet[2]!);
        app.controls.pitch = Math.atan2(target[1]! - eye, Math.hypot(target[0]! - feet[0]!, target[2]! - feet[2]!));
      };
      place(operator, helm, koruWorldPoint(plan.control.approach), koruWorldPoint(plan.control.aim), false);
      observer.text("enablecheats"); run(100); observer.text("fly"); run(100);
      const eye = koruWorldPoint(shot.eye); place(observer, app, [eye[0], eye[1] - 1.62, eye[2]], koruWorldPoint(shot.target), true);
      run(3600); for (let waits = 0; quiet < 30 && waits < 40; waits++) run(250);
      if (quiet < 30 || !helm.hud.prompt.includes("raise sails")) throw new Error(`${shot.name}: native operator prompt or streaming did not settle: ${helm.hud.prompt}`);
      const press = (target: 0 | 1) => {
        helm.key("KeyE", true); run(80); helm.key("KeyE", false); run(80);
        if (h.host.sails.states()[0]?.target !== target) throw new Error(`${shot.name}: E did not reach authoritative sail control`);
      };
      const progress = () => sailsProgress(observer.sails.states()[0]!, observer.sails.tick());
      const until = (wanted: number, upward: boolean) => {
        for (let frames = 0; frames < 1300 && (upward ? progress() < wanted : progress() > wanted); frames++) run(1000 / 60);
        if (Math.abs(progress() - wanted) > .002) throw new Error(`${shot.name}: synchronized sail clock missed requested phase`);
      };
      if (shot.progress > 0 || shot.reverse) { press(1); until(shot.reverse ? .75 : shot.progress, true); }
      if (shot.reverse) { press(0); until(shot.progress, false); }
      if (shot.progress === 0 || shot.progress === 1) run(1000);
      const p = packet as FramePacket | null, render = raster as Rasterizer | null;
      if (!p || !render || !app.scene) throw new Error("Native App produced no packet");
      const actual = progress(), draws = [];
      for (let d = 0; d < p.drawCount; d++) {
        const mesh = files.manifest.meshes[p.drawMesh[d]!]!;
        if (plan.sails.some(sail => sail.mesh === mesh.id)) draws.push({ mesh: mesh.id, level: p.drawLod[d], flags: p.drawFlags[d], buffer: p.drawBuffer[d], instances: p.drawInstances[d], fade: p.drawFade[d] });
      }
      if (new Set(draws.map(draw => draw.mesh)).size !== 5 || p.dropped || p.skipped || p.casterDropped || app.scene.sails.stats.limited) throw new Error(`${shot.name}: incomplete or limited native sail draw`);
      if (Math.abs(actual - shot.progress) > .002) throw new Error(`${shot.name}: rendered progress mismatch`);
      render.render(p); const scene = render.color.slice(); drawUi(render.color, width, height, app.ui.frame);
      writeFileSync(resolve(out, `${shot.name}-scene.png`), encodePng(width, height, scene));
      writeFileSync(resolve(out, `${shot.name}.png`), encodePng(width, height, render.color));
      report.push({ ...shot, progress: actual, packHash: hashBytes(bytes).toString(16), registryHash: reg.hash.toString(16), mapHash: h.world.mapHash.toString(16), draws,
        render: { ...app.scene.sails.stats }, triangles: p.triangles, drawCount: p.drawCount, boneCount: p.boneCount, dropped: p.dropped, skipped: p.skipped, casterDropped: p.casterDropped,
        state: observer.sails.states()[0], operatorPrompt: helm.hud.prompt, city: app.scene.city?.stats,
        camera: { x: p.camX, y: p.camY, z: p.camZ, yaw: app.cam.yaw, pitch: app.cam.pitch },
        fixture: "Operator placed once on the real control deck; normal App E ray commands the authoritative winch. Observer placed once as an exterior spectator; synchronized server clock drives every pose. No direct progress mutation." });
      writeFileSync(resolve(out, "report.json"), JSON.stringify({ source, generated: new Date().toISOString(), pipeline: "native map → two authoritative clients → real E command → synchronized App poses → native Rasterizer", timing: "Visual review only; no performance measurement", shots: report }, null, 2));
    } finally { h.host.shutdown(); }
  }
  console.log(`${out}: ${report.length} native sail views`);
}

if (import.meta.main) await reviewKoruSails();
