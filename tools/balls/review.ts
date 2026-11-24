// A soul ball used through the game as a player uses it (planning/workstreams/soul-ball.md): a real server, the client's
// own App with its keys, prompt and inventory, the pack with its textures, and the software renderer. One tame is kept
// and loosed, pictured at each moment and checked as it goes.
//
//   bun tools/balls/review.ts [--out var/balls/review] [--size 960x600] [--tier high]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { ballInfo } from "../../client/core/balls.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { EVENT_BALL } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";
import type { InventoryScreen } from "../../client/core/ui/inventory.ts";

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
  const out = resolve(value("--out") ?? "var/balls/review");
  const [width, height] = (value("--size") ?? "960x600").split("x").map(Number) as [number, number];
  const tier = (value("--tier") ?? "high") as "high";
  mkdirSync(out, { recursive: true });
  const bytes = corePack(SOURCE), pack = parsePack(bytes);
  const modelled = pack.header.meshes.some((m) => m.id === "core:soul_ball/dropped");
  const named = await namedTextures(SOURCE);
  const files = splitWithTextures(bytes, (t) => {
    const texture = named.get(t.id);
    if (!texture) throw new Error(`no texture ${t.id}`);
    return rgbaOf(texture.material, t.role, t.top);
  });
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry;
  const [BALL, FULL, RAPTOR] = [reg.index.get("core:soul_ball")!, reg.index.get("core:soul_ball_full")!, reg.index.get("core:raptor")!];
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
  /** One click, held until `done` or a second has passed, and then two frames more for the client to hear of it. */
  const strike = (done: () => boolean) => {
    app.mouseButton(0, true);
    for (let k = 0; k < 30 && !done(); k++) run(1000 / 30);
    app.mouseButton(0, false);
    run(70);
  };
  const shots: { name: string; note: string; prompt: string; balls: number; raptors: number; flashes: number }[] = [];
  const drawn = (id: string): number => {
    let n = 0;
    for (let i = 0; i < packet!.drawCount; i++) if (files.manifest.meshes[packet!.drawMesh[i]!]!.id.startsWith(id)) n++;
    return n;
  };
  const shoot = (name: string, note: string) => {
    if (!packet || !raster) throw new Error(`${name}: the App made no frame`);
    raster.render(packet);
    drawUi(raster.color, width, height, app.ui.frame);
    writeFileSync(resolve(out, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`), encodePng(width, height, raster.color.slice()));
    const shot = { name, note, prompt: app.hud.prompt, balls: drawn("core:soul_ball"), raptors: drawn("core:raptor"), flashes: app.scene?.shots?.balls.length ?? 0 };
    shots.push(shot);
    console.log(`${shots.length} ${name}: balls drawn ${shot.balls}, raptors drawn ${shot.raptors}, flashes ${shot.flashes}, prompt "${shot.prompt}"`);
  };
  const must = (what: string, ok: boolean) => { if (!ok) throw new Error(`ball review: ${what}`); };
  try {
    frame(0);
    run(600);
    session.text("enablecheats");
    run(250);
    // On the proving ground's flat, looking up its length, with a ball and a saddled raptor of her own four metres ahead.
    session.text("tp 256 190");
    app.controls.yaw = 0;
    app.controls.pitch = -0.1;
    run(500);
    session.text("give soul_ball 1");
    run(250);
    session.text("gmsummon raptor 20");
    run(400);
    const me = h.host.records.byPid.get(h.client(session)!.pid)!;
    const tame = [...h.host.records.byPid.values()].find((r) => r.kind === RAPTOR && r.team === me.team)!;
    must("a raptor of hers stands ahead, saddled", tame !== undefined && tame.saddle !== 0 && h.host.records.entOf.has(tame.pid));
    // The client asks for a name, as it does for every new tame, and is given one.
    must("the client asks its name", app.ui.naming.open);
    app.ui.naming.edit("Bitey");
    tap("Enter");
    run(300);
    must("it is named", tame.name === "Bitey" && !app.ui.naming.open);
    tame.stance = 0;
    const inv = h.host.items.inv(me);
    h.host.items.move(me, inv.item.indexOf(BALL), me, inv.hotbar, 0);
    run(300);
    tap("Digit1");
    run(900);
    must("the empty ball is in her hand", session.inventory!.item[session.inventory!.hotbar + session.held] === BALL);
    shoot("eye", "from the eye, where no body is drawn: Bitey ahead, and the prompt naming what a click would keep");
    must("the prompt offers to keep it", app.hud.prompt.includes("click  keep Bitey"));
    tap("KeyV");
    run(500);
    must("V stood the view back", app.view.thirdPerson);
    shoot("before", "third person: the survivor, the empty ball in her hand, and Bitey saddled ahead");
    must("the ball is drawn in her hand", shots[shots.length - 1]!.balls > 0);
    const before = { raptors: shots[shots.length - 1]!.raptors, corrections: session.stats.corrections };
    must("the raptor is drawn", before.raptors > 0);

    // The click. Its strike is the throw's, a sixth of a second in.
    strike(() => tame.stored !== 0);
    must("it is in the ball", tame.stored !== 0 && !h.host.records.entOf.has(tame.pid) && h.host.items.inv(me).item[inv.hotbar] === FULL);
    shoot("keeping", "just after the strike: the flash where it stood, closing");
    must("the flash is drawn", shots[shots.length - 1]!.flashes > 0);
    run(600);
    shoot("kept", "the ground bare, the ball full, and the prompt offering to loose it");
    must("the raptor is gone from the view", shots[shots.length - 1]!.raptors === 0);
    must("the prompt offers to loose it", app.hud.prompt === "click  loose Bitey");
    must("her client was told what the ball holds", session.kept[0].get(inv.hotbar)?.name === "Bitey" && session.kept[0].get(inv.hotbar)?.kind === RAPTOR);

    // The inventory's line about it, with the full ball picked up.
    const line = ballInfo(reg, FULL, session.kept[0].get(inv.hotbar), session.inventory!.spoilAt[inv.hotbar]!, session.serverTick);
    must(`the inventory's line names it and its charge ("${line}")`, /^soul ball holds Bitey, raptor, level \d+; (30|29) days left$/.test(line));
    tap("KeyI");
    run(300);
    app.ui.screen<InventoryScreen>("inventory").hoverBox = 0;
    app.ui.screen<InventoryScreen>("inventory").hover = inv.hotbar;
    run(100);
    shoot("inventory", "the bag open, the pointer on the full ball: the line at the foot says what it holds and the charge it has left");
    tap("KeyI");
    app.controls.pitch = -0.25;
    run(400);

    // Loosed where she looks, a little way up the ground.
    strike(() => tame.stored === 0);
    must("it is out again", tame.stored === 0 && h.host.records.entOf.has(tame.pid) && h.host.items.inv(me).item[inv.hotbar] === BALL);
    run(170);
    shoot("loosing", "a quarter of a second after the strike: the flash opening round it where it comes out");
    must("the flash is drawn", shots[shots.length - 1]!.flashes > 0);
    run(900);
    shoot("loosed", "Bitey out again where she looked, saddle on, and the ball empty");
    must("the raptor is drawn again", shots[shots.length - 1]!.raptors > 0);
    must("it kept its saddle and its name", tame.saddle !== 0 && tame.name === "Bitey");
    must("her client knows the ball is empty", session.kept[0].size === 0);
    must("both were seen and heard", session.events.filter((e) => e.kind === EVENT_BALL).length === 0 && h.host.balls.kept === 1 && h.host.balls.loosed === 1);
    must(`the prediction agreed throughout (${session.stats.corrections - before.corrections} corrections)`, session.stats.corrections === before.corrections);
    must("nothing was made or lost", h.host.items.audit().length === 0);
    writeFileSync(resolve(out, "report.json"), JSON.stringify({ generated: new Date().toISOString(), pipeline: "Harness server, App with its own keys, streamed pack, Rasterizer", tier, modelled, size: [width, height], line, shots }, null, 2));
    console.log(`${out}: ${shots.length} pictures of one keep and one loose${modelled ? "" : " (the stand-in ball: build core:soul-ball for the modelled one)"}`);
  } finally {
    h.host.shutdown();
  }
}
