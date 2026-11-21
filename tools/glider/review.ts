// The glider flown through the game as a player flies it (planning/workstreams/glider.md): a real server, the client's
// own App with its keys, prediction, pose and cameras, the pack with its textures, and the software renderer. One glide
// over the proving ground, pictured at its moments in third person and from the eye, and checked as it goes.
//
//   bun tools/glider/review.ts [--out var/glider/review] [--size 960x600] [--tier high]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { GLIDE_DIVE, GLIDE_DIVE_SINK, GLIDE_SINK, GLIDE_SPEED } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  // As tools/snap.settle does: take the uploads without rasterizing every frame between pictures.
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet);
  [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const out = resolve(value("--out") ?? "var/glider/review");
  const [width, height] = (value("--size") ?? "960x600").split("x").map(Number) as [number, number];
  const tier = (value("--tier") ?? "high") as "high";
  mkdirSync(out, { recursive: true });
  const bytes = corePack(SOURCE), pack = parsePack(bytes);
  const modelled = pack.header.meshes.some((m) => m.id === "core:frond_glider/dropped");
  const named = await namedTextures(SOURCE);
  const files = splitWithTextures(bytes, (t) => {
    const texture = named.get(t.id);
    if (!texture) throw new Error(`no texture ${t.id}`);
    return rgbaOf(texture.material, t.role, t.top);
  });
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry;
  const h = new Harness({}, 211, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs }, reg);
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
  const tap = (code: string, ms = 70) => { app.key(code, true); run(ms); app.key(code, false); run(40); };
  const shots: { name: string; note: string; glide: number; y: number; vy: number; speed: number; prompt: string; wings: number }[] = [];
  const shoot = (name: string, note: string) => {
    if (!packet || !raster) throw new Error(`${name}: the App made no frame`);
    raster.render(packet);
    drawUi(raster.color, width, height, app.ui.frame);
    writeFileSync(resolve(out, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`), encodePng(width, height, raster.color.slice()));
    let wings = 0;
    for (let i = 0; i < packet.drawCount; i++) if (files.manifest.meshes[packet.drawMesh[i]!]!.id.startsWith("core:frond_glider/wing")) wings++;
    const o = session.own;
    shots.push({ name, note, glide: o.glide, y: +o.y.toFixed(1), vy: +o.vy.toFixed(2), speed: +Math.hypot(o.vx, o.vz).toFixed(2), prompt: app.hud.prompt, wings });
    console.log(`${shots.length} ${name}: glide ${o.glide}, y ${o.y.toFixed(1)}, sink ${(-o.vy).toFixed(2)}, speed ${Math.hypot(o.vx, o.vz).toFixed(2)}, wings drawn ${wings}, prompt "${app.hud.prompt}"`);
  };
  const must = (what: string, ok: boolean) => { if (!ok) throw new Error(`glider review: ${what}`); };
  try {
    frame(0);
    run(600);
    session.text("enablecheats");
    run(250);
    session.text("give frond_glider 1");
    run(250);
    // The reviewer faces up the proving ground's length, at the eye as a survivor begins, and is let go high over dry ground.
    app.controls.yaw = 0;
    app.controls.pitch = -0.12;
    must("it begins at the eye", !app.view.thirdPerson);
    session.text("tp 256 190 110");
    run(700);
    const hp = session.vitals.at(V_HEALTH, session.serverTick);
    must("it carries a glider", session.own.glideGear === 1);
    shoot("falling", "let go, the glider still shut: the prompt names its key");
    must("the prompt offers the glider", app.hud.prompt.includes("open glider"));
    const corrections = session.stats.corrections;
    tap("KeyC");
    must("C threw it open", session.own.glide === 1);
    must("the view stood back for it", app.view.thirdPerson);
    run(60);
    shoot("opening", "a tenth of a second after C: the wings spreading from shut");
    app.key("KeyW", true);
    run(2500);
    shoot("trim", "at its trim: 10 m/s forward, sinking 2.2");
    must("it flies at its trim", Math.abs(Math.hypot(session.own.vx, session.own.vz) - GLIDE_SPEED) < 0.1 && Math.abs(session.own.vy + GLIDE_SINK) < 0.05);
    must("both wings are drawn", shots[shots.length - 1]!.wings >= 2);
    app.key("KeyD", true);
    run(900);
    shoot("slip", "slipping to its right: body and wings rolled about the lashing");
    app.key("KeyD", false);
    // Turned a quarter to its left, as the mouse steers it.
    for (let i = 0; i < 12; i++) { app.look(-(Math.PI / 2 / 12) / LOOK_SPEED, 0); run(60); }
    run(500);
    shoot("turned", "steered a quarter turn to its left with the mouse");
    app.key("ShiftLeft", true);
    run(1300);
    shoot("dive", "Shift held: the wings drawn back, 16 m/s and sinking 7");
    must("it dives", Math.abs(session.own.vy + GLIDE_DIVE_SINK) < 0.1 && Math.hypot(session.own.vx, session.own.vz) > GLIDE_DIVE - 0.5);
    app.key("ShiftLeft", false);
    run(450);
    shoot("pulling-out", "Shift let go: floating level on the dive's speed");
    must("it floats as it pulls out", session.own.vy > -GLIDE_SINK * 0.6);
    run(1500);
    app.key("KeyW", false);
    app.key("KeyS", true);
    run(1300);
    shoot("flare", "the stick back: stopped, the wings tipped up, sinking 1.5");
    app.key("KeyS", false);
    app.key("KeyW", true);
    run(1200);
    // From the eye, where V still puts the view: the wings are overhead, seen by looking well up.
    tap("KeyV");
    app.controls.pitch = 1.25;
    run(500);
    shoot("eye", "first person by V, looking up: the wings overhead and the hands on their handles");
    app.controls.pitch = -0.12;
    tap("KeyV");
    run(300);
    // Folded and thrown open again, then down to the ground.
    tap("KeyC");
    must("C folded it", session.own.glide === 0);
    run(350);
    shoot("folded", "C again: folded, falling");
    tap("KeyC");
    must("C threw it open again", session.own.glide === 1);
    let ticks = 0;
    while (!session.own.grounded && ticks++ < 3600) {
      // Flared over the last metres, as a careful landing is.
      if (session.own.y - session.world!.hf.heightAt(session.own.x, session.own.z) < 4 && app.controls.moveZ > 0) { app.key("KeyW", false); app.key("KeyS", true); }
      run(1000 / 30);
    }
    app.key("KeyS", false);
    app.key("KeyW", false);
    run(400);
    shoot("landed", "on the ground: folded, unhurt, and the view back at the eye");
    must("it landed", session.own.grounded && session.own.glide === 0);
    must("unhurt", session.vitals.at(V_HEALTH, session.serverTick) === hp);
    must(`the prediction agreed throughout (${session.stats.corrections - corrections} corrections)`, session.stats.corrections === corrections);
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ generated: new Date().toISOString(), pipeline: "Harness server, App with its own keys, streamed pack, Rasterizer", tier, modelled, size: [width, height], shots }, null, 2));
    console.log(`${out}: ${shots.length} pictures of one glide${modelled ? "" : " (the stand-in wings: build core:frond-glider for the modelled ones)"}`);
  } finally {
    h.host.shutdown();
  }
}
