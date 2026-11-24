// Draws a tier's pieces as a client draws them, finishes, recipes, weathering and all, with the software rasterizer:
//
//   bun tools/pieces/look.ts metal                 var/pieces/close-metal.png and tiers-metal.png
//   bun tools/pieces/look.ts metal --hour 15       at another hour (9 lights the pieces at a slant)
//   bun tools/pieces/look.ts metal --only wall     the shots whose names begin so, each its own file as well
//   bun tools/pieces/look.ts metal --sheet odd     one sheet: close, tiers or odd
//
// close-<tier>.png is every form from near on high; tiers-<tier>.png the same house on high, medium, a phone's medium
// and low poly, then from 30 and 60 m; odd-<tier>.png is a wall in bases at 0, 17 and 45 degrees and 30 degrees round
// in the base at 17, each from square in front, and a house at 23 degrees from outside, from 20 m and from inside. The
// pieces are the packs' under assets/source: build a tier first (`bun run art -- core:metal`). It reads every texture
// of the game once, so the first run takes minutes. A frame is drawn with the ground under a wall known, as on a map
// that has far shadows, so the flat program weathers a piece and wears its edges as it does there.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { FRAME } from "../../client/core/render/packet.ts";
import { houseScene, provingView, type ProvingView } from "../snap.ts";
import { gameFiles, type GameFiles } from "../snap/files.ts";
import { Canvas } from "./sheet.ts";

/** A shot: where the eye stands from the row's first piece or the house's middle, in metres, and its yaw and pitch in degrees. */
type Shot = readonly [name: string, x: number, y: number, z: number, yaw: number, pitch: number];

const [W, H] = [640, 480];
/** The house stands where the snap tool's does; the row of single forms 16 m south of it, 5 m apart, their fronts to the north. */
const HOUSE = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2] as const;
const ROW = [HOUSE[0] - 14, HOUSE[1] - 16] as const;
const STEP = 5;
const FORMS = ["wall", "doorframe", "windowframe", "foundation", "ceiling", "pillar", "stairs", "door_open"] as const;
const at = (form: (typeof FORMS)[number]): number => FORMS.indexOf(form) * STEP;

/** From the row's first piece, on the ground there. */
const CLOSE: readonly Shot[] = [
  ["wall", at("wall"), 1.5, 4.6, 180, 0],
  ["wall foot", at("wall") + 1.9, 0.75, 1.5, 208, -12],
  ["wall head", at("wall") - 1.9, 2.5, 1.6, 140, 4],
  ["doorframe and door", at("doorframe") + 0.5, 1.5, 4.4, 186, -1],
  ["door", at("doorframe") - 0.25, 1.45, 1.9, 174, -2],
  ["windowframe", at("windowframe"), 1.6, 3.4, 180, -1],
  ["window sill", at("windowframe") + 1.1, 1.75, 1.2, 222, -14],
  ["foundation", at("foundation") + 2.6, 1.0, 3.2, 222, -22],
  ["ceiling from under", at("ceiling") + 1.2, 0.5, 2.6, 200, 38],
  ["pillar foot", at("pillar") + 0.9, 0.7, 1.3, 215, -14],
  ["pillar head", at("pillar") + 1.0, 1.9, 1.5, 214, 22],
  ["stairs", at("stairs") + 3.6, 2.4, -4.4, -39, -18],
  ["stair treads", at("stairs") - 0.4, 1.1, -2.7, 6, -24],
  ["open door", at("door_open") + 2.2, 1.4, 1.9, 232, -2],
];
/** From the house's middle, on its floor. */
const HOUSE_SHOTS: readonly Shot[] = [["house", -6.5, 3.6, -9.5, 34, -17], ["house, 30 m", -17, 2.2, -24.5, 34.5, -3], ["house, 60 m", -34, 1.6, -49, 34.5, 0]];
/** The walls at odd yaws stand 28 m south of the row, 6 m apart; the turned house 30 m east of them, its door to the north-east. */
const ODD = [ROW[0] - 6, ROW[1] - 28] as const;
const ODD_YAWS = [0, 17, 45, 47] as const;
const TURNED = [ODD[0] + 34, ODD[1] + 2] as const;
const TURN = 203;
const UNITS = 65536 / 360;
/** A point of the turned house's own, in the world's x and z. */
const turned = (x: number, z: number): [number, number] => {
  const a = (TURN * Math.PI) / 180;
  return [TURNED[0] + Math.cos(a) * x + Math.sin(a) * z, TURNED[1] + Math.cos(a) * z - Math.sin(a) * x];
};

function build(files: GameFiles, tier: Tier, name: string, hour: number | null): ProvingView {
  const view = provingView(W, H, {}, files);
  view.scene.assets.tier = tier;
  view.scene.viewHeight = H;
  if (hour !== null) view.scene.hour = hour;
  houseScene(view, name);
  const { reg, structs, hf } = view;
  const kind = (form: string): number => reg.index.get(`core:${form}_${name}`) ?? reg.index.get(`core:${form}_wood`)!;
  const ground = hf.heightAt(ROW[0], ROW[1]);
  const add = (form: string, x: number, y: number): void => void structs.add(kind(form), ROW[0] + x, ground + y, ROW[1], 0, 0, 1);
  add("wall", at("wall"), WALL_HEIGHT / 2);
  add("doorframe", at("doorframe"), WALL_HEIGHT / 2);
  add("door", at("doorframe"), DOOR_HEIGHT / 2);
  add("windowframe", at("windowframe"), WALL_HEIGHT / 2);
  add("foundation", at("foundation"), FOUNDATION_THICK / 2);
  add("ceiling", at("ceiling"), WALL_HEIGHT - FLOOR_THICK / 2);
  add("pillar", at("pillar"), WALL_HEIGHT / 2);
  add("stairs", at("stairs"), WALL_HEIGHT / 2);
  add("doorframe", at("door_open"), WALL_HEIGHT / 2);
  add("door_open", at("door_open"), DOOR_HEIGHT / 2);
  const odd = hf.heightAt(ODD[0], ODD[1]);
  ODD_YAWS.forEach((deg, i) => void structs.add(kind("wall"), ODD[0] + i * 6, odd + WALL_HEIGHT / 2, ODD[1], Math.round(deg * UNITS), 0, 1));
  // houseScene's house again, turned.
  const floor = hf.heightAt(TURNED[0], TURNED[1]) + FOUNDATION_THICK, wy = floor + WALL_HEIGHT / 2;
  const set = (form: string, x: number, y: number, z: number, quarters = 0): void => {
    const [wx, wz] = turned(x, z);
    structs.add(kind(form), wx, y, wz, (Math.round(TURN * UNITS) + quarters * 16384) & 65535, 0, 1);
  };
  for (const ox of [-1.5, 1.5]) for (const oz of [-1.5, 1.5]) set("foundation", ox, floor - FOUNDATION_THICK / 2, oz);
  set("doorframe", -1.5, wy, -3);
  set("door_open", -1.5, floor + DOOR_HEIGHT / 2, -3);
  set("windowframe", 1.5, wy, -3);
  for (const o of [-1.5, 1.5]) {
    set("wall", o, wy, 3);
    set("wall", 3, wy, o, 1);
  }
  set("wall", -3, wy, 1.5, 1);
  set("windowframe", -3, wy, -1.5, 1);
  set("ceiling", -1.5, floor + WALL_HEIGHT + FLOOR_THICK / 2, 1.5);
  set("ceiling", 1.5, floor + WALL_HEIGHT + FLOOR_THICK / 2, 1.5);
  set("stairs", 1.5, floor + (WALL_HEIGHT + FLOOR_THICK) / 2, -1.5);
  set("pillar", -0.25, floor + WALL_HEIGHT / 2, 0.25);
  return view;
}

/** snap.ts settle, each frame drawn with the ground under a wall known where the scene has no far shadows to say so. */
function settle(view: ProvingView): void {
  const { scene, cam, remote, raster, port } = view, r = scene.assets.residency;
  for (let frame = 1; frame <= 5000; frame++) {
    scene.now += 1000 / 60;
    port?.advance(scene.now);
    const p = scene.build(cam, remote);
    const done = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length === 0 && r.flying === 0 && r.waiting === 0;
    if (!done) p.drawCount = p.tileCount = 0;
    if (p.frame[FRAME.farScale] === 0) [p.frame[FRAME.farScale], p.frame[FRAME.farAt], p.frame[FRAME.farAt + 1]] = [-1 / 4, cam.x / 4, cam.z / 4];
    raster.render(p);
    if (done) return;
  }
  throw new Error("the card was still being filled after 5000 frames");
}

function shoot(view: ProvingView, shot: Shot, from: readonly [number, number], up: number): Uint8ClampedArray {
  const [, x, y, z, yaw, pitch] = shot;
  const { cam, hf } = view;
  [cam.x, cam.z] = [from[0] + x, from[1] + z];
  cam.y = hf.heightAt(from[0], from[1]) + up + y;
  [cam.yaw, cam.pitch] = [(yaw * Math.PI) / 180, (pitch * Math.PI) / 180];
  settle(view);
  return view.raster.color.slice();
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const name = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "metal";
  const out = resolve(value("out") ?? "var/pieces");
  const hour = value("hour") === undefined ? null : Number(value("hour"));
  const only = value("only"), wanted = value("sheet");
  mkdirSync(out, { recursive: true });
  const files = await gameFiles();
  const sheet = (file: string, title: string, shots: readonly { label: string; px: Uint8ClampedArray }[], across: number): void => {
    const [gap, head] = [6, 30];
    const canvas = new Canvas(gap + across * (W + gap), head + Math.ceil(shots.length / across) * (H + gap));
    canvas.text(title, 8, 6, undefined, 2);
    shots.forEach(({ label, px }, k) => {
      const [x, y] = [gap + (k % across) * (W + gap), head + Math.floor(k / across) * (H + gap)];
      canvas.enlarge(px, W, H, 1, x, y);
      canvas.fill(x, y, label.length * 6 + 8, 13, [242, 243, 245]);
      canvas.text(label, x + 4, y + 3);
    });
    writeFileSync(join(out, file), canvas.png());
    say(join(out, file));
  };
  const high = build(files, tierOf("high"), name, hour);
  const close = CLOSE.filter(([shot]) => (!only || shot.startsWith(only)) && (!wanted || wanted === "close")).map((shot) => ({ label: shot[0], px: shoot(high, shot, ROW, 0) }));
  if (only) {
    for (const { label, px } of close) {
      const canvas = new Canvas(W, H);
      canvas.enlarge(px, W, H, 1, 0, 0);
      writeFileSync(join(out, `look-${name}-${label.replaceAll(/[ ,]+/g, "-")}.png`), canvas.png());
      say(join(out, `look-${name}-${label.replaceAll(/[ ,]+/g, "-")}.png`));
    }
    return;
  }
  if (!wanted || wanted === "close") sheet(`close-${name}.png`, `${name} close to, as high draws it`, close, 4);
  const tiers: readonly (readonly [string, Tier])[] = [["high", tierOf("high")], ["medium", tierOf("medium")], ["a phone's medium", forTouch(tierOf("medium"), true)], ["low poly", tierOf("lowpoly")]];
  const shots: { label: string; px: Uint8ClampedArray }[] = [];
  for (const [label, tier] of !wanted || wanted === "tiers" ? tiers : []) {
    const view = label === "high" ? high : build(files, tier, name, hour);
    shots.push({ label: `${label}: house`, px: shoot(view, HOUSE_SHOTS[0]!, HOUSE, FOUNDATION_THICK) }, { label: `${label}: wall`, px: shoot(view, CLOSE[0]!, ROW, 0) });
    if (label === "high" || label === "low poly") for (const far of HOUSE_SHOTS.slice(1)) shots.push({ label: `${label}: ${far[0]}`, px: shoot(view, far, HOUSE, FOUNDATION_THICK) });
  }
  if (!wanted || wanted === "tiers") sheet(`tiers-${name}.png`, `${name} on each tier, and from afar`, shots, 4);
  if (wanted && wanted !== "odd") return;
  // Each wall from 4.2 m square in front of it, then the first turned one from arm's length and from its foot.
  const facing = (deg: number, i: number, off: number, out: number, y: number, turn: number, pitch: number): Shot => {
    const a = (deg * Math.PI) / 180;
    return ["", i * 6 + Math.sin(a) * out + Math.cos(a) * off, y, Math.cos(a) * out - Math.sin(a) * off, 180 + deg + turn, pitch];
  };
  const odd = ODD_YAWS.map((deg, i) => ({ label: i < 3 ? `a base at ${deg} degrees` : "30 degrees round in the base at 17", px: shoot(high, facing(deg, i, 0, 4.2, 1.5, 0, 0), ODD, 0) }));
  odd.push({ label: "at 17 degrees, from arm's length", px: shoot(high, facing(17, 1, 0.5, 1.1, 1.55, 14, 2), ODD, 0) }, { label: "at 17 degrees, its foot", px: shoot(high, facing(17, 1, 1.2, 1.3, 0.7, 24, -14), ODD, 0) });
  // The turned house from the north-east, which the sun lights, then from 20 m, then from inside toward its door.
  const from = (x: number, y: number, z: number, yaw: number, pitch: number): Shot => {
    const [wx, wz] = turned(x, z);
    return ["", wx - TURNED[0], y, wz - TURNED[1], yaw + TURN, pitch];
  };
  odd.push({ label: `a house at ${TURN - 180} degrees`, px: shoot(high, from(-6.5, 3.6, -9.5, 34, -17), TURNED, FOUNDATION_THICK) }, { label: "from 20 m", px: shoot(high, from(-11.5, 2.4, -16.5, 35, -5), TURNED, FOUNDATION_THICK) });
  odd.push({ label: "inside, toward the door", px: shoot(high, from(1.2, 1.6, 1.6, 215, 2), TURNED, FOUNDATION_THICK) }, { label: "inside, the far corner", px: shoot(high, from(-1.6, 1.6, -1.4, 50, 6), TURNED, FOUNDATION_THICK) });
  for (const [label, tier] of tiers.slice(1)) odd.push({ label: `${label}: the house`, px: shoot(build(files, tier, name, hour), from(-6.5, 3.6, -9.5, 34, -17), TURNED, FOUNDATION_THICK) });
  sheet(`odd-${name}.png`, `${name} off the world's grid, as high draws it, and the turned house on the other tiers`, odd, 4);
}

if (import.meta.main) await main(process.argv.slice(2));
