// A map event met through the game as a player meets it (planning/workstreams/map-events.md): a real server, the
// client's own App with the streamed pack, and the software renderer. The server's engine is not needed: the feeds a
// UFO's would send are made here by hand and sent as S_MAPEVENT is. One craft is called over the reviewer, seen coming,
// high, on its low pass with its beam on, from its side and by night, brought down and falling, and at rest with its
// smoke from near and far; then a site's columns. Each moment is pictured and checked as it goes.
//
//   bun tools/mapevent/review.ts [--out var/mapevent/review] [--size 960x600] [--tier high] [--stand-in] [--full]
//
// Every texture but the events' own is made 64 pixels across, which keeps it within 10 GB; --full makes them whole.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import "../../client/core/mapevent-late.ts";
import { CRAFT_FALLING, CRAFT_FLYING, CRAFT_REST, craftAt } from "../../client/core/mapevent/craft.ts";
import type { ShownCraft } from "../../client/core/mapevent/shown.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE, type MapEventFeed, type MapEventRow } from "../../shared/mapevent/wire.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildTrack, fallPose, newCraftPose, trackPose, type PathPoint } from "../../shared/sim/craft.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { LIGHT_COLUMN, SMOKE_COLUMN, STAND_IN_LOOK, UFO_LOOK, craftRow, eventRow, siteRow, tell } from "../../tests/fixtures/mapevent.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet);
  [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const out = resolve(value("--out") ?? "var/mapevent/review");
  const [width, height] = (value("--size") ?? "960x600").split("x").map(Number) as [number, number];
  const tier = (value("--tier") ?? "high") as "high";
  const look = args.includes("--stand-in") ? STAND_IN_LOOK : UFO_LOOK;
  mkdirSync(out, { recursive: true });
  const bytes = corePack(SOURCE), pack = parsePack(bytes);
  const named = await namedTextures(SOURCE);
  const files = splitWithTextures(bytes, (t) => {
    const texture = named.get(t.id);
    if (!texture) throw new Error(`no texture ${t.id}`);
    return rgbaOf(texture.material, t.role, args.includes("--full") || t.id.startsWith("core:ufo/") ? t.top : Math.min(t.top, 64));
  });
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry;
  // Level ground two kilometres on a side.
  const map = writeMap(flatMap(32));
  const h = new Harness({}, 211, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map, log: () => {} } as never, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const session = h.join("reviewer", {}, { manual: true, look: defaultLook() });
  const app = new App(session, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = tier;
  app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null;
  const frame = (now: number) => {
    port.advance(now);
    packet = app.frame(now, width, height);
    if (packet && session.world) {
      raster ??= new Rasterizer(width, height, boot, session.world.hf, files.manifest);
      uploadOnly(raster, packet);
    }
  };
  const run = (ms: number) => h.run(ms, frame);
  const ground = (x: number, z: number): number => session.world!.hf.heightAt(x, z);
  const shots: { name: string; note: string; craft: number; beams: number; smokes: number; columns: number; draws: number; far: number }[] = [];
  const pose = newCraftPose();
  const craft = (): ShownCraft | null => (app.mapEvents.shown?.parts.find((p) => p.type === "craft") as ShownCraft | undefined) ?? null;
  /** What the craft is doing where it is drawn now. */
  const where = (): number => { const c = craft(); return c ? craftAt(c, app.mapEvents.shown!.tick, pose) : -1; };
  const eye = () => [session.own.x, session.own.y + 1.6, session.own.z] as const;
  const shoot = (name: string, note: string) => {
    if (!packet || !raster) throw new Error(`${name}: the App made no frame`);
    raster.render(packet);
    drawUi(raster.color, width, height, app.ui.frame);
    writeFileSync(resolve(out, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`), encodePng(width, height, raster.color.slice()));
    const [ex, ey, ez] = eye();
    const state = where();
    const far = state === CRAFT_FLYING || state === CRAFT_FALLING || state === CRAFT_REST ? Math.round(Math.hypot(pose.x - ex, pose.y - ey, pose.z - ez)) : 0;
    const pass = app.scene!.mapEventPass;
    const shot = { name, note, craft: pass?.craft ?? 0, beams: pass?.beams ?? 0, smokes: pass?.smokes ?? 0, columns: pass?.columns ?? 0, draws: pass?.draws ?? 0, far };
    shots.push(shot);
    console.log(`${shots.length} ${name}: craft ${shot.craft}, beams ${shot.beams}, smokes ${shot.smokes}, columns ${shot.columns}, ${shot.draws} draws, ${far} m`);
  };
  const must = (what: string, ok: boolean) => { if (!ok) throw new Error(`map event review: ${what}`); };
  const last = () => shots[shots.length - 1]!;
  /** Looks from the eye at (x, y, z). */
  const lookAt = (x: number, y: number, z: number): void => {
    const [ex, ey, ez] = eye();
    app.controls.yaw = Math.atan2(x - ex, z - ez);
    app.controls.pitch = Math.atan2(y - ey, Math.hypot(x - ex, z - ez));
  };
  /** Looks at the craft where it is drawn. */
  const follow = (): void => {
    where();
    lookAt(pose.x, pose.y, pose.z);
  };
  const stand = (x: number, z: number) => {
    session.text(`tp ${x} ${z}`);
    run(500);
  };
  try {
    frame(0);
    run(600);
    session.text("enablecheats");
    run(250);
    if (app.view.thirdPerson) {
      app.key("KeyV", true);
      run(70);
      app.key("KeyV", false);
      run(200);
    }
    const [X, Z] = [1024, 1024];
    stand(X, Z);
    // In high from the south-west, down low over the reviewer with its beam on, and up and away to the north-east.
    const points: PathPoint[] = [
      { x: 200, y: 300, z: 300, speed: 90, low: false },
      { x: 700, y: 260, z: 760, speed: 70, low: false },
      { x: 980, y: 100, z: 1040, speed: 30, low: true },
      { x: 1080, y: 100, z: 1100, speed: 30, low: true },
      { x: 1500, y: 280, z: 1400, speed: 80, low: false },
      { x: 2000, y: 320, z: 2000, speed: 90, low: false },
    ];
    const called = h.world.tick, start = called + 4 * TICK_RATE;
    let row = craftRow(points, { stage: 0 });
    const event = (more: Partial<MapEventRow> = {}): MapEventFeed => ({ looks: [{ type: "craft", craft: look }], rows: [eventRow(start, [row], { called, state: h.world.tick < start ? MAPEVENT_NOTICE : MAPEVENT_LIVE, ...more })] });
    tell(h, session, event());
    run(600);
    lookAt(points[0]!.x, points[0]!.y, points[0]!.z);
    run(100);
    shoot("coming", "four seconds before it comes: called, nothing yet in the sky");
    must("nothing is drawn yet", last().craft === 0);
    h.run(Math.max(0, ((start - h.world.tick) / TICK_RATE) * 1000 + 6000), (now) => { frame(now); follow(); });
    tell(h, session, event());
    run(100);
    follow();
    run(50);
    shoot("high", "six seconds after it came: high over the ground, seen from below");
    must("the craft is drawn in the sky", last().craft === 1 && where() === CRAFT_FLYING);
    for (let k = 0; k < 600 && !(where() === CRAFT_FLYING && pose.low > 0.9); k++) h.run(100, (now) => { frame(now); follow(); });
    must("its beam came on", pose.low > 0.9);
    follow();
    run(60);
    shoot("scan", "its low pass with its beam on, seen from where the reviewer stands");
    must("the beam is drawn", last().beams === 1);
    stand(pose.x + 160, pose.z + 60);
    follow();
    run(60);
    shoot("scan-side", "the low pass from 170 m to its side: the beam down to the ground");
    session.text("settime 23");
    run(400);
    follow();
    run(60);
    shoot("night", "the same at eleven at night");
    session.text("settime 12");
    run(400);
    // Brought down where it is: its fall worked out here as every party works it out, to the ground under it.
    where();
    const down = Math.ceil(app.mapEvents.shown!.tick) + 10;
    const track = buildTrack(row.points), at = newCraftPose();
    trackPose(track, (down - start) / TICK_RATE, at);
    const fell = newCraftPose();
    let ticks = 1;
    for (; ticks < 60 * TICK_RATE; ticks++) {
      fallPose(at.x, at.y, at.z, at.vx, at.vy, at.vz, ticks / TICK_RATE, row.gravity, row.bleed, fell);
      if (fell.y <= ground(fell.x, fell.z) + row.half) break;
    }
    row = { ...row, stage: 3, down, impact: down + ticks, rx: fell.x, ry: ground(fell.x, fell.z), rz: fell.z };
    tell(h, session, event());
    h.run(1500, (now) => { frame(now); follow(); });
    shoot("falling", "brought down: guttering and tipping over as it falls");
    must("it is drawn falling", where() === CRAFT_FALLING && last().craft === 1);
    h.run(Math.max(0, ((row.impact - h.world.tick) / TICK_RATE) * 1000 + 1500), frame);
    stand(row.rx + 40, row.rz + 25);
    lookAt(row.rx, row.ry + 2, row.rz);
    run(300);
    shoot("wreck", "fifty metres from where it came to rest: the wreck, its smoke standing over it");
    must("the wreck and its smoke are drawn", last().craft === 1 && last().smokes === 1);
    stand(row.rx + 400, row.rz + 260);
    lookAt(row.rx, row.ry + 120, row.rz);
    run(300);
    shoot("wreck-far", "from 480 m: the smoke over the map shows where it lies");
    must("the smoke is drawn from far off", last().smokes === 1);
    const ended = h.world.tick;
    tell(h, session, event({ state: MAPEVENT_ENDED, ended }));
    run(6000);
    lookAt(row.rx, row.ry + 120, row.rz);
    run(100);
    shoot("wreck-thinning", "six seconds after its event ended: the smoke thinning");
    // A site's columns: smoke where something fell and a beacon of light, from 200 m.
    const sx = 1300, sz = 700;
    stand(sx - 150, sz - 130);
    const sites: MapEventFeed = {
      looks: [{ type: "column", column: SMOKE_COLUMN }, { type: "column", column: LIGHT_COLUMN }],
      rows: [eventRow(h.world.tick, [siteRow(sx, ground(sx, sz), sz, { id: 1, look: 0 }), siteRow(sx + 60, ground(sx + 60, sz + 40), sz + 40, { id: 2, look: 1 })], { id: 9, kind: "signal", sound: "" })],
    };
    tell(h, session, sites);
    lookAt(sx + 30, ground(sx, sz) + 60, sz + 20);
    run(3000);
    shoot("sites", "a column of smoke and one of light, from 200 m");
    must("both columns are drawn", last().columns === 2);
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ generated: new Date().toISOString(), pipeline: "Harness server, feeds by hand, App, streamed pack, Rasterizer", tier, look: look === UFO_LOOK ? "ufo" : "stand-in", size: [width, height], shots }, null, 2));
    console.log(`${out}: ${shots.length} pictures of a craft from its call to its rest, and a site`);
  } finally {
    h.host.shutdown();
  }
}
