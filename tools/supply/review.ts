// A supply drop met through the game as a player meets it (planning/workstreams/supply.md): a real server, the
// client's own App with its keys, prompt and inventory, the pack, and the software renderer. One drop is called, seen
// from far off and from near, watched down, opened at its level and emptied, pictured at each moment and checked as it
// goes.
//
//   bun tools/supply/review.ts [--out var/supply/review] [--size 960x600] [--tier high]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { KEY_OPEN_TAKE_ALL } from "../../client/core/ui/inventory.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { POSE_NAMES } from "../../shared/sim/supply.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
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
  const out = resolve(value("--out") ?? "var/supply/review");
  const [width, height] = (value("--size") ?? "960x600").split("x").map(Number) as [number, number];
  const tier = (value("--tier") ?? "high") as "high";
  mkdirSync(out, { recursive: true });
  const bytes = corePack(SOURCE), pack = parsePack(bytes);
  const named = await namedTextures(SOURCE);
  const files = splitWithTextures(bytes, (t) => {
    const texture = named.get(t.id);
    if (!texture) throw new Error(`no texture ${t.id}`);
    return rgbaOf(texture.material, t.role, t.top);
  });
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry;
  // Level ground a kilometre on a side, with one obelisk in its north-west to send the drop.
  const map = writeMap(flatMap(16, { tideEyes: [{ name: "Review", color: "blue", x: 200, z: 200, y: 0, yaw: 0, radius: 70 }] }));
  const h = new Harness({}, 211, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map, log: () => {} }, reg);
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
  const shots: { name: string; note: string; prompt: string; state: string; shafts: number; capsules: number; props: number }[] = [];
  const drawn = (id: string): number => {
    let n = 0;
    for (let i = 0; i < packet!.drawCount; i++) if (files.manifest.meshes[packet!.drawMesh[i]!]!.id.startsWith(id)) n++;
    return n;
  };
  const { supply } = h.host;
  const state = (): string => (session.supply.rows[0] ? POSE_NAMES[app.supply.stateOf(session.supply.rows[0])]! : "none");
  const shoot = (name: string, note: string) => {
    if (!packet || !raster) throw new Error(`${name}: the App made no frame`);
    raster.render(packet);
    drawUi(raster.color, width, height, app.ui.frame);
    writeFileSync(resolve(out, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`), encodePng(width, height, raster.color.slice()));
    const shot = { name, note, prompt: app.hud.prompt, state: state(), shafts: app.supply.shafts, capsules: app.supply.capsules, props: drawn("core:supply_capsule") + drawn("box") };
    shots.push(shot);
    console.log(`${shots.length} ${name}: ${shot.state}; shafts drawn ${shot.shafts}, capsules ${shot.capsules}; prompt "${shot.prompt}"`);
  };
  const must = (what: string, ok: boolean) => { if (!ok) throw new Error(`drop review: ${what}`); };
  const last = () => shots[shots.length - 1]!;
  /** Stands at (x, z) looking at (tx, tz), the eye raised `pitch` radians. */
  const stand = (x: number, z: number, tx: number, tz: number, pitch = 0) => {
    session.text(`tp ${x} ${z}`);
    app.controls.yaw = Math.atan2(tx - x, tz - z);
    app.controls.pitch = pitch;
    run(500);
  };
  try {
    frame(0);
    run(600);
    session.text("enablecheats");
    run(250);
    const me = h.host.records.byPid.get(h.client(session)!.pid)!;
    const [X, Z] = [640, 660];
    stand(X - 30, Z - 30, X, Z, 0.25);
    session.text(`supply call ${X} ${Z} blue arms plain 90`);
    run(400);
    const d = supply.drops[0]!;
    must("the console called a blue Arms drop", d !== undefined && d.tierKey === "blue" && d.clsKey === "arms" && d.sender === 0);
    must("her client was told of it", session.supply.rows.length === 1 && session.supply.rows[0]!.id === d.id && session.supply.tiers[0]!.level === 25);
    run(2200);
    shoot("called", "forty metres from where it will land, two seconds after the call: its shaft stands, and nothing lies there yet");
    must("the shaft is drawn", last().shafts === 1 && last().capsules === 0 && last().state === "coming");

    // From half a kilometre off, across the map.
    stand(260, 300, X, Z, 0.12);
    shoot("far", "from 520 m: the shaft is still there to be found by looking");
    must("the shaft is drawn from far off", last().shafts === 1);

    // Brought down in twelve seconds: the cast is under way, the capsule seen arriving.
    stand(X - 60, Z - 40, X, Z, 0.5);
    session.text(`supply land ${d.id} 12`);
    run(300);
    must("it is on its way down", ["flying", "braking"].includes(supply.state(d)));
    h.run(Math.max(0, ((d.land - d.brake - h.world.tick) / TICK_RATE) * 1000 + 2500), frame);
    if (process.env.PROBE) console.log("probe", { serverTick: h.world.tick, clientTick: app.supply.tick, sessionTick: session.serverTick, server: [d.called, d.release, d.land, d.brake, d.left], row: session.supply.rows.map((r) => [r.called, r.release, r.land, r.brake, r.left]), version: session.supplyVersion, serverState: supply.state(d) });
    shoot("braking", "seventy metres off, as it brakes down its shaft: the capsule in the air over its place");
    must("the capsule is drawn in the air", last().state === "braking" && last().capsules === 1 && last().shafts === 1);
    h.run(Math.max(0, ((d.land - h.world.tick) / TICK_RATE) * 1000 + 1500), frame);
    must("it has landed as a capsule", d.landed && h.host.records.byPid.has(d.pid) && session.supply.rows[0]!.landed);

    // Stood back from, to see the whole of it; and from the other side.
    stand(X + 4.2, Z - 4.2, X, Z, -0.12);
    run(6500);
    shoot("standing", "six metres off, eight seconds after it landed: legs splayed, louvres open, its collars and its top-mark");
    stand(X - 3.2, Z + 3.6, X, Z, -0.1);
    shoot("around", "from its other side");
    // Walked up to, below its level: the prompt says the level, and E does nothing.
    stand(X, Z - 3.2, X, Z, -0.3);
    shoot("landed", "three metres from it, at level 1: the prompt names it and the level it opens at");
    must(`the prompt says its level ("${last().prompt}")`, last().prompt === "Blue Arms drop  opens at level 25");
    tap("KeyE");
    run(300);
    must("it stays shut below its level", session.open === null && !d.opened);
    session.text("addxp 60000");
    run(400);
    must(`she is at its level (${h.host.progression.level(me)})`, h.host.progression.level(me) >= 25 && session.progress.level >= 25);
    must(`the prompt offers to open it ("${app.hud.prompt}")`, app.hud.prompt === "E  open Blue Arms drop");
    tap("KeyE");
    run(400);
    must("it is open, and her client knows it is only taken from", session.open?.name === "Blue Arms drop" && session.open.takeOnly === true && d.opened);
    // The bag opens with it.
    if (!app.ui.inventory.open) tap("KeyI");
    run(300);
    const held = session.open!.inventory.used();
    shoot("open", `the capsule open beside her bag, holding ${held} stacks, with Take all at its head`);
    must("Take all is offered", app.ui.frame.nodes.some((n) => n.key === KEY_OPEN_TAKE_ALL && n.text === "Take all"));
    const before = { mine: session.inventory!.used(), corrections: session.stats.corrections };
    app.ui.inventory.pointer(0, KEY_OPEN_TAKE_ALL, 0, session);
    run(900);
    must(`she has all ${held} stacks`, session.inventory!.used() === before.mine + held);
    must("the capsule is gone and its drop is leaving", !h.host.records.byPid.has(d.pid) && d.left > 0 && session.open === null && session.supply.rows[0]!.left === d.left);
    // Before she is moved again, which is a correction of its own.
    must(`the prediction agreed while she opened and emptied it (${session.stats.corrections - before.corrections} corrections)`, session.stats.corrections === before.corrections);
    if (app.ui.inventory.open) tap("KeyI");
    stand(X - 20, Z - 20, X, Z, 0.5);
    run(1500);
    shoot("leaving", "twenty metres off as it goes: the capsule shut and climbing, its shaft fading");
    must("the capsule is drawn climbing", last().state === "leaving" && last().capsules === 1);
    run(12000);
    must("nothing is left of it", supply.drops.length === 0 && session.supply.rows.length === 0);
    shoot("gone", "the ground bare again");
    must("nothing is drawn of it", last().shafts === 0 && last().capsules === 0 && last().state === "none");
    must("nothing was made or lost", h.host.items.audit().length === 0);
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ generated: new Date().toISOString(), pipeline: "Harness server, App with its own keys, streamed pack, Rasterizer", tier, size: [width, height], stacks: held, shots }, null, 2));
    console.log(`${out}: ${shots.length} pictures of one drop from its call to its going`);
  } finally {
    h.host.shutdown();
  }
}
