// Draws a tier's pieces as a client draws them, finishes, recipes, weathering and all, with the software rasterizer:
//
//   bun tools/pieces/look.ts metal                 var/pieces/close-metal.png and tiers-metal.png
//   bun tools/pieces/look.ts metal --hour 15       at another hour (9 lights the pieces at a slant)
//   bun tools/pieces/look.ts metal --only wall     the shots whose names begin so, each its own file as well
//
// close-<tier>.png is every form from near on high; tiers-<tier>.png the same house on high, medium, a phone's medium
// and low poly, then from 30 and 60 m. The pieces are the packs' under assets/source: build a tier first
// (`bun run art -- core:metal`). It reads every texture of the game once, so the first run takes minutes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { houseScene, provingView, settle, type ProvingView } from "../snap.ts";
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
  return view;
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
  const only = value("only");
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
  const close = CLOSE.filter(([shot]) => !only || shot.startsWith(only)).map((shot) => ({ label: shot[0], px: shoot(high, shot, ROW, 0) }));
  if (only) {
    for (const { label, px } of close) {
      const canvas = new Canvas(W, H);
      canvas.enlarge(px, W, H, 1, 0, 0);
      writeFileSync(join(out, `look-${name}-${label.replaceAll(/[ ,]+/g, "-")}.png`), canvas.png());
      say(join(out, `look-${name}-${label.replaceAll(/[ ,]+/g, "-")}.png`));
    }
    return;
  }
  sheet(`close-${name}.png`, `${name} close to, as high draws it`, close, 4);
  const tiers: readonly (readonly [string, Tier])[] = [["high", tierOf("high")], ["medium", tierOf("medium")], ["a phone's medium", forTouch(tierOf("medium"), true)], ["low poly", tierOf("lowpoly")]];
  const shots: { label: string; px: Uint8ClampedArray }[] = [];
  for (const [label, tier] of tiers) {
    const view = label === "high" ? high : build(files, tier, name, hour);
    shots.push({ label: `${label}: house`, px: shoot(view, HOUSE_SHOTS[0]!, HOUSE, FOUNDATION_THICK) }, { label: `${label}: wall`, px: shoot(view, CLOSE[0]!, ROW, 0) });
    if (label === "high" || label === "low poly") for (const far of HOUSE_SHOTS.slice(1)) shots.push({ label: `${label}: ${far[0]}`, px: shoot(view, far, HOUSE, FOUNDATION_THICK) });
  }
  sheet(`tiers-${name}.png`, `${name} on each tier, and from afar`, shots, 4);
}

if (import.meta.main) await main(process.argv.slice(2));
