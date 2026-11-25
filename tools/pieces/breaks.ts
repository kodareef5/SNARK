// Pictures of built pieces coming apart as a client draws them (client/core/rubble.ts, fragments.ts), with the
// software rasterizer, the tier's pack and pictures and the world's finishes alone. Under var/pieces/breaks/:
//
//   bun tools/pieces/breaks.ts wood            wall-wood.png: a wall destroyed, mid-break; cottage-wood.png: a cottage blasted
//   --size 640x400   each frame's size; --hour 15 the hour; --only wall or cottage
//
// The wall is struck from behind and crumbles toward the eye. The cottage is blasted at its door: what the blast
// reaches breaks into its fragments, and what stood on that falls whole two ticks on, as a collapse would take it.
// A run reads one tier's pictures and draws one size: about two gigabytes and a minute.

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Falling } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { GONE_BLAST, GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { Asset } from "../art/assets.ts";
import { materialsOf } from "../art/materials.ts";
import { SOURCE } from "../art/source.ts";
import { provingView, type ProvingView } from "../snap.ts";
import { SNAP_CACHE, corePack, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { HAS_SURFACES, worldMaterials, worldSurfaceMeshes } from "../surfaces/build.ts";
import { registry, settle } from "./fort.ts";
import { Canvas } from "./sheet.ts";
import { cottageKeys, wallRowKeys } from "./village.ts";

const TEAM = 7;
/** Where the base has its corner: open ground west of the proving ground's plaza, as the fort's. */
const BASE = [PROVING_SPAWN.x - 70, PROVING_SPAWN.z - 60] as const;
/** The base's yaw: 17 degrees off the grid. */
const TURN = 17;

/** One tier's pack, its asset's pictures and the world's finishes, as a client fetches them. */
async function tierFiles(tier: string): Promise<GameFiles> {
  const dir = join(SOURCE, "core/structures", tier), pack = join(dir, `${tier}.snpk`);
  if (!existsSync(pack)) throw new Error(`${pack} is not built: bun run art -- core:${tier}`);
  const asset: Asset = { id: `core:${tier}`, name: tier, dir, file: pack, spec: (await import(join(dir, "asset.ts"))).default };
  const own = materialsOf(asset);
  // The pack and its asset in a tree of their own, as deep as the art's, so the asset's own imports hold.
  const source = resolve(".cache/lit-breaks"), copy = join(source, "core/structures", tier);
  rmSync(source, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  copyFileSync(join(dir, "asset.ts"), join(copy, "asset.ts"));
  copyFileSync(pack, join(copy, `${tier}.snpk`));
  const [meshes, materials] = HAS_SURFACES ? [worldSurfaceMeshes(), worldMaterials()] : [[], []];
  return splitWithTextures(corePack(source, meshes), (t) => {
    const k = meshes.findIndex((mesh) => mesh.textures!.some((m) => m.id === t.id));
    if (k >= 0) return rgbaOf(materials[k]!, t.role, t.top, SNAP_CACHE);
    const m = own.find((m) => t.id === `${m.id}/${t.role}`);
    if (!m) throw new Error(`texture ${t.id} is neither a finish's nor ${tier}'s`);
    return rgbaOf(m, t.role, t.top, SNAP_CACHE);
  });
}

interface Scene {
  view: ProvingView;
  falling: Falling;
  /** The base's corner in the world, its level 0, and the cosine and sine of its turn. */
  at: readonly [number, number, number];
  turn: readonly [number, number];
  /** Each placed piece's ref by its form's name, in the order set down. */
  refs: { name: string; ref: number }[];
}

/** A view of `keys` set down in a base at TURN degrees, with a client's falling pieces over it. */
function sceneOf(files: GameFiles, tier: string, keys: readonly { name: string; k0: number; k1: number }[], width: number, height: number, hour: number): Scene {
  const reg = registry(tier);
  const view = provingView(width, height, {}, files, undefined, { reg, pack: new Uint8Array(0) });
  view.scene.assets.tier = tierOf("high");
  view.scene.viewHeight = height;
  view.scene.hour = hour;
  view.remote.count = 0;
  const { structs, hf } = view;
  const units = Math.round((TURN * 65536) / 360);
  const ground = Math.max(...[-4, 0, 8].flatMap((x) => [-4, 0, 8].map((z) => hf.heightAt(BASE[0] + x, BASE[1] + z))));
  const floor = Math.ceil((ground + 0.375) * STRUCT_UNITS) / STRUCT_UNITS;
  const frame = structs.frames.make(Math.round(BASE[0] * STRUCT_UNITS), Math.round(floor * STRUCT_UNITS), Math.round(BASE[1] * STRUCT_UNITS), (65536 - units) & 65535, TEAM);
  const refs: { name: string; ref: number }[] = [];
  for (const { name, k0, k1 } of keys) {
    const kind = reg.index.get(`core:${name}_${tier}`)!;
    const ref = structs.place(kind, frame.gid, k0, k1, TEAM, reg.maxHp[kind]!);
    if (ref < 0) console.warn(`${name} did not fit its slot`);
    else refs.push({ name, ref });
  }
  const world = { hf, structs };
  const falling = (view.scene.falling = new Falling(reg.halfY, (x, z) => hf.heightAt(x, z), { reg, structs, floorUnder: (x, y, z) => (castWorld(world, x, y, z, 0, -1, 0, 512, true) === HIT_NONE ? hf.heightAt(x, z) : y - rayHit.t) }));
  const a = (TURN * Math.PI) / 180;
  return { view, falling, at: [BASE[0], floor, BASE[1]], turn: [Math.cos(a), Math.sin(a)], refs };
}

/** A point of the base's own, in metres over its level 0, in the world. */
function world(s: Scene, x: number, y: number, z: number): [number, number, number] {
  const [c, n] = s.turn;
  return [s.at[0] + c * x - n * z, s.at[1] + y, s.at[2] + n * x + c * z];
}

/** The eye `metres` from a point of the base's own, `around` degrees round (0 from +X, 90 from +Z) and `above` up. */
function look(s: Scene, x: number, y: number, z: number, metres: number, around: number, above: number): void {
  const { cam } = s.view;
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  const [c, n] = s.turn;
  const [ox, oy, oz] = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
  const [wx, wz] = [c * ox - n * oz, n * ox + c * oz];
  const [px, py, pz] = world(s, x, y, z);
  [cam.x, cam.y, cam.z] = [px + wx * metres, py + oy * metres, pz + wz * metres];
  [cam.yaw, cam.pitch] = [Math.atan2(-wx, -wz), -e];
}

/** The rubble a removal of `ref` tells, read before its row is emptied, and the row emptied. */
function gone(s: Scene, ref: number, cause: number, tick: number, from: readonly [number, number, number], radius: number): Rubble {
  const t = s.view.structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
  const r: Rubble = { kind: t.kind[slot]!, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, tw: t.twAt(slot), cause, ox: from[0], oy: from[1], oz: from[2], tick, radius, into: 0, map: 0 };
  s.view.structs.remove(ref, cause);
  return r;
}

const TICK0 = 3000;
const msOf = (tick: number): number => (tick / TICK_RATE) * 1000;

/** The scene `seconds` after TICK0, drawn once the card holds what it asks for: the falling pieces' clock stands still meanwhile. */
function at(s: Scene, seconds: number): Uint8ClampedArray {
  s.falling.step(msOf(TICK0) + seconds * 1000, TICK0 + seconds * TICK_RATE);
  settle(s.view);
  return s.view.raster.color.slice();
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const tier = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "wood";
  const [W, H] = (value("size") ?? "640x400").split("x").map(Number) as [number, number];
  const hour = Number(value("hour") ?? 10.5), only = value("only");
  const out = resolve(value("out") ?? "var/pieces/breaks");
  mkdirSync(out, { recursive: true });
  const files = await tierFiles(tier);
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
  if (!only || only === "wall") {
    // Three foundations in a row and a wall on each one's south side; the middle wall is struck from behind.
    const s = sceneOf(files, tier, wallRowKeys(tier, 3), W, H, hour);
    const wall = s.refs.filter((r) => r.name === "wall")[1]!.ref;
    look(s, 4.5, 1.5, -0.2, 7.5, 262, 8);
    const shots = [{ label: "standing", px: at(s, 0) }];
    s.falling.absorb([gone(s, wall, GONE_DESTROYED, TICK0, world(s, 4.5, 1.6, 0.6), 0)], msOf(TICK0), s.view.cam.x, s.view.cam.y, s.view.cam.z, TICK0);
    for (const t of [0, 0.15, 0.4, 0.8]) shots.push({ label: `${t} s`, px: at(s, t) });
    sheet(`wall-${tier}.png`, `${tier}: a wall destroyed, struck from behind, its base turned ${TURN} degrees`, shots, 4);
  }
  if (!only || only === "cottage") {
    const s = sceneOf(files, tier, cottageKeys(tier), W, H, hour);
    look(s, 3, 2.4, 3, 15, 240, 18);
    const shots = [{ label: "standing", px: at(s, 0) }];
    // The blast at the door, a metre out and a metre up; what it reaches breaks, and what stood on that falls whole after it.
    const centre = world(s, 1.5, 1, -1), reach = 4.2;
    const blasted = s.refs.filter(({ ref }) => {
      const t = s.view.structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      return Math.hypot(t.x[slot]! - centre[0], t.y[slot]! - centre[1], t.z[slot]! - centre[2]) < reach;
    });
    const fell = s.refs.filter((r) => !blasted.includes(r) && r.name !== "foundation");
    s.falling.absorb(blasted.map(({ ref }) => gone(s, ref, GONE_BLAST, TICK0, centre, reach)), msOf(TICK0), s.view.cam.x, s.view.cam.y, s.view.cam.z, TICK0);
    s.falling.absorb(fell.map(({ ref }) => gone(s, ref, GONE_FELL, TICK0 + 2, centre, 0)), msOf(TICK0 + 2), s.view.cam.x, s.view.cam.y, s.view.cam.z, TICK0 + 2);
    for (const t of [0.1, 0.3, 0.6, 1.2, 2.5]) shots.push({ label: `${t} s`, px: at(s, t) });
    sheet(`cottage-${tier}.png`, `${tier}: a cottage blasted at its door, ${blasted.length} pieces broken and ${fell.length} falling whole`, shots, 3);
  }
}

if (import.meta.main) await main(process.argv.slice(2));
