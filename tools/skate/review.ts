// Native review of the skateboard: a real server, the App's cameras and HUD, the streamed pack and the software renderer.
// A rider pushes along a kerb, pops, flips, spins, grabs, grinds, slides, launches off a kicker and holds H for the trick
// list. Each moment is a picture; --clip also keeps every frame of the run for a video. The built pack is kept in the
// out folder and used again; --fresh builds it anew (the rider's poses, the camera and the HUD are code, not the pack).
// bun tools/skate/review.ts [--out var/skate-review] [--size 1050x680] [--clip] [--fresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { skatePiece } from "../../content/skate-park.ts";
import { BOARD_ID } from "../../content/vehicles/skateboard.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { SKATE_MOVES } from "../../shared/sim/skate-state.ts";
import { trickName } from "../../shared/sim/skate-tricks.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dress } from "../../server/commands/combat.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SOURCE } from "../art/source.ts";
import { corePack, namedTextures, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";
import { drawUi } from "../snap/ui.ts";

function uploadOnly(raster: Rasterizer, packet: FramePacket): void {
  if (!(packet.uploads.length + packet.drops.length + packet.assetUploads.length + packet.assetDrops.length + packet.texUploads.length + packet.texDrops.length)) return;
  // As tools/snap.settle does: keep the graphics card's real uploads without rasterizing every warm-up frame.
  const counts = [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] as const;
  packet.drawCount = packet.tileCount = packet.casterCount = packet.cascadeCount = 0;
  raster.render(packet);
  [packet.drawCount, packet.tileCount, packet.casterCount, packet.cascadeCount] = counts;
}

/** A street along +Z: a walk with its kerb, a bench and a rail beside the line, and a kicker in the road far ahead. */
function street() {
  const statics = Array.from({ length: 10 }, (_, i) => ({ kind: "core:zruin_zwalk8g_concrete", x: 99.82, y: .075, z: 80 + i * 8, yaw: 49152 }));
  statics.push({ kind: "core:zzstreet_bench", x: 105, y: 0, z: 118, yaw: 16384 });
  statics.push({ kind: skatePiece("rail"), x: 105, y: .225, z: 130, yaw: 16384 });
  statics.push({ kind: skatePiece("kicker"), x: 101, y: .25, z: 214, yaw: 0 });
  return statics;
}

export function review(pack: Pack, files: GameFiles, width: number, height: number, out: string, clip: boolean): string[] {
  const built = compileContent(CORE_CONTENT);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const reg = built.registry, h = new Harness({}, 197, 60, { dev: true, map: writeMap(flatMap(4, { statics: street() })), clips: pack.clips, rigs: pack.header.rigs }, reg);
  const boot = parsePack(files.files[0]!), port = new FakeNet(files.files, { keep: true });
  const s = h.join("rider", {}, { manual: true, look: defaultLook() });
  const app = new App(s, reg, boot, { manifest: files.manifest, port });
  app.ui.settings.tier = "high"; app.ui.settings.steady = false;
  let raster: Rasterizer | null = null, packet: FramePacket | null = null, nextFrame = 0, frames = 0;
  const shots: string[] = [];
  const draw = (): Uint8Array => {
    if (!raster || !packet) throw new Error("no frame yet");
    raster.render(packet); drawUi(raster.color, width, height, app.ui.frame);
    return encodePng(width, height, raster.color);
  };
  const frame = (now: number) => {
    port.advance(now); packet = app.frame(now, width, height);
    if (!packet || !s.world) return;
    raster ??= new Rasterizer(width, height, boot, s.world.hf, files.manifest);
    if (clip && s.driving >= 0 && now >= nextFrame) { nextFrame = now + 1000 / 24; writeFileSync(resolve(out, "frames", `${String(frames++).padStart(4, "0")}.png`), draw()); }
    else uploadOnly(raster, packet);
  };
  const run = (ms: number) => h.run(ms, frame);
  const key = (code: string, down: boolean) => app.key(code, down);
  const tap = (code: string, ms = 70) => { key(code, true); run(ms); key(code, false); };
  const shot = (name: string) => {
    const skate = s.own.skate, what = skate ? `${SKATE_MOVES[skate.move]} ${trickName(skate.trick)} ${skate.points}×${skate.chain} bank ${skate.bank}` : "on foot";
    console.log(`${name}: ${what}`);
    writeFileSync(resolve(out, `${name}.png`), draw());
    shots.push(name);
  };
  try {
    frame(0); run(650); s.text("enablecheats"); run(300); s.text("tp 102 96"); run(400);
    const c = h.client(s)!, rec = h.host.records.byPid.get(c.pid)!;
    for (const part of ["shirt", "pants", "boots"]) dress(h.host, rec, reg.index.get(`core:cloth_${part}`)!);
    const e = h.host.spawnVehicle(BOARD_ID, 101, 96, rec.team, 0);
    if (e < 0 || h.host.urban.mount(c, e) !== 0) throw new Error("could not step onto the board");
    run(900);
    app.controls.yaw = -.6;
    key("KeyW", true); run(1500); shot("01-pushing");
    key("Space", true); run(330); shot("02-crouch"); key("Space", false); run(90);
    tap("KeyR", 60); run(120); shot("03-kickflip"); run(700);
    key("Space", true); run(360); key("Space", false); run(60);
    key("KeyA", true); run(120); shot("04-spin"); run(330); key("KeyA", false); run(700); shot("05-landed-switch");
    // Catch the kerb on the left: pop, hold Shift, steer onto it.
    key("KeyW", false); key("ShiftLeft", true);
    key("Space", true); run(240); key("Space", false);
    for (let t = 0; t < 15; t++) { run(34); if (process.env.SKATE_TRACE) console.log("trace", s.own.x.toFixed(2), s.own.y.toFixed(3), s.own.z.toFixed(1), SKATE_MOVES[s.own.skate?.move ?? 0], s.own.skate?.keys, s.own.vy.toFixed(2)); }
    shot("06-grind");
    key("ShiftLeft", false); run(900); shot("07-banked");
    key("KeyW", true); run(900);
    key("Space", true); run(330); key("Space", false); run(60);
    key("KeyD", true); key("KeyC", true); run(60); key("KeyD", false); run(300); shot("08-indy"); key("KeyC", false); run(800);
    key("KeyH", true); run(120); shot("09-trick-list"); key("KeyH", false); run(200);
    // Up the kicker: crouch on its slope and pop at its lip, then a 360 with an indy over the top.
    key("KeyW", true);
    for (let t = 0; t < 400 && s.own.z < 212.6; t++) run(34);
    key("KeyW", false); key("Space", true);
    for (let t = 0; t < 100 && s.own.z < 214.7 && s.driving >= 0; t++) run(34);
    key("Space", false); run(100); key("KeyD", true); key("KeyC", true); run(250); shot("10-kicker-air"); run(300); key("KeyD", false); key("KeyC", false); run(1200); shot("11-after-kicker");
  } finally { h.host.shutdown(); }
  return shots;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const out = resolve(value("--out") ?? "var/skate-review"), clip = args.includes("--clip");
  const [width, height] = (value("--size") ?? "1050x680").split("x").map(Number) as [number, number];
  mkdirSync(clip ? resolve(out, "frames") : out, { recursive: true });
  const cache = resolve(out, "pack"), kept = resolve(cache, "manifest.json");
  let files: GameFiles, bytes: Uint8Array;
  if (existsSync(kept) && !args.includes("--fresh")) {
    const manifest = JSON.parse(readFileSync(kept, "utf8")) as GameFiles["manifest"] & { count: number };
    bytes = new Uint8Array(readFileSync(resolve(cache, "core.pack")));
    files = { manifest, files: Array.from({ length: manifest.count }, (_, i) => new Uint8Array(readFileSync(resolve(cache, `${i}.bin`)))) };
  } else {
    bytes = corePack(SOURCE);
    const named = await namedTextures(SOURCE);
    files = splitWithTextures(bytes, (t) => {
      const texture = named.get(t.id);
      if (!texture) throw new Error(`Missing native texture ${t.id}`);
      return rgbaOf(texture.material, t.role, t.top);
    });
    mkdirSync(cache, { recursive: true });
    writeFileSync(resolve(cache, "core.pack"), bytes);
    files.files.forEach((f, i) => writeFileSync(resolve(cache, `${i}.bin`), f));
    writeFileSync(kept, JSON.stringify({ ...files.manifest, count: files.files.length }));
  }
  const pack = parsePack(bytes);
  const shots = review(pack, files, width, height, out, clip);
  console.log(`${out}: ${shots.length} pictures${clip ? ", and frames/ for a clip" : ""}`);
}
