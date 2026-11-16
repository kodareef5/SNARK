// A survivor on a built map as her client sees her over the shoulder, served by a host in this process and drawn by the
// software rasterizer: bun tools/mapworld/survivor-view.ts <file.snmap> <x> <z> <out.png> [--face DEG] [--pitch DEG]
// [--drink] [--tier TIER] [--size WxH]
//
// She is put at (x, z) facing --face degrees from north. With --drink she is thirsty and presses E where she stands, and
// what that gave her is said: a drink comes only in water (server/use.ts). Prints where she stood and the water there.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { V_WATER } from "../../shared/sim/vitals.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { encodePng } from "../snap/png.ts";
import { Rasterizer } from "../snap/raster.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const [path, xs, zs, out] = args;
if (!path || !xs || !zs || !out) {
  console.error("bun tools/mapworld/survivor-view.ts <file.snmap> <x> <z> <out.png> [--face DEG] [--pitch DEG] [--drink] [--tier TIER] [--size WxH]");
  process.exit(2);
}
const [width, height] = (arg("size") ?? "1280x720").split("x").map(Number) as [number, number];

const h = new Harness({}, 1, 60, { dev: true, map: new Uint8Array(readFileSync(path)) });
const pack = parsePack(corePackBytes());
const app = new App(h.join("ada", {}, { manual: true, look: defaultLook() }), h.reg, pack);
app.ui.settings.tier = (arg("tier") ?? "medium") as typeof app.ui.settings.tier;
let packet = app.frame(0, width, height);
const run = (ms: number): void => h.run(ms, (now) => (packet = app.frame(now, width, height)));
run(500);
const s = app.session;
h.say(s, "enablecheats");
h.say(s, `tp ${xs} ${zs}`);
app.controls.yaw = (Number(arg("face") ?? 0) * Math.PI) / 180;
app.controls.pitch = (Number(arg("pitch") ?? -15) * Math.PI) / 180;
run(2000);
const ents = h.world.ents;
const e = h.ent(s);
const hf = h.world.hf;
const said: Record<string, unknown> = { x: ents.x[e], y: ents.y[e], z: ents.z[e], ground: hf.heightAt(ents.x[e]!, ents.z[e]!), water: hf.waterAt(ents.x[e]!, ents.z[e]!), swimming: ents.mode[e] === MODE_SWIM };
if (args.includes("--drink")) {
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.survival.add(rec, V_WATER, -50);
  run(200);
  const before = h.host.survival.value(rec, V_WATER);
  app.key("KeyE", true);
  run(100);
  app.key("KeyE", false);
  run(300);
  said.drank = Number((h.host.survival.value(rec, V_WATER) - before).toFixed(2));
}
app.view.thirdPerson = true;
run(100);
const raster = new Rasterizer(width, height, pack, s.world!.hf);
// The rasterizer saw none of the uploads earlier frames carried, so the scene sends them again.
app.scene!.resetUploads();
packet = app.frame(h.now + 1, width, height);
raster.render(packet!);
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), encodePng(width, height, raster.color));
console.log(JSON.stringify(said));
process.exit(0);
