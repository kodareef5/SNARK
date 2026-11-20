// Rows for sun shadows. First the pure part: fitting each tier's cascades, and testing every mesh near the camera against
// them for its cascades and levels, under a sun 10 degrees up, which stretches the cascades furthest. The meshes are
// made up: 50 kinds in each of 30 chunks round the camera, the worst the lighting design costs, and then all 81 chunks
// of the near store built up to 30 m. Then the casters a scene lists, in the bench base and in the siege scene, turning
// under that sun: entries, draws and triangles per cascade, which L5 budgets by, and what collecting them costs a frame.
// `bun tools/bench/shadow.ts` runs these alone.

import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_TEXTURED, TILE_CASTS, TILE_QUADS, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { Cascades, MAX_CASCADES, reach, type ShadowSetup } from "../../client/core/render/shadow.ts";
import { hourOfSun } from "../../client/core/render/sky.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { randomLook, LOOK_BYTES } from "../../shared/anim/look.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { asTextured, boxBase, type Piece } from "./base.ts";
import { bases, held, terrain } from "./depth.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const SETUPS: readonly (readonly [string, ShadowSetup])[] = [
  ["medium", tierOf("medium").shadows],
  ["high", tierOf("high").shadows],
  ["ultra", tierOf("ultra").shadows],
  ["medium on a phone", { ...tierOf("medium").shadows, size: 1024, distance: 48, everyOther: true }],
];
const CHUNK = 64;
const KINDS = 50;
const ERRORS = [0, 0.004, 0.012, 0.05, 0.2];
const SUN = (10 * Math.PI) / 180;

function median(xs: number[]): number {
  xs.sort((a, b) => a - b);
  return xs[xs.length >> 1]!;
}

/** Each mesh of the chunks from (x0, z0) to (x1, z1) round the camera: its chunk's camera-relative box and its own radius. */
function store(x0: number, z0: number, x1: number, z1: number): { boxes: Float64Array; radius: Float64Array } {
  const rng = new Rng(1);
  const n = (x1 - x0 + 1) * (z1 - z0 + 1) * KINDS;
  const boxes = new Float64Array(n * 6);
  const radius = new Float64Array(n);
  let r = 0;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const top = rng.range(4, 30);
      for (let m = 0; m < KINDS; m++, r++) {
        boxes.set([cx * CHUNK - 32, -2, cz * CHUNK - 32, cx * CHUNK + 32, top, cz * CHUNK + 32], r * 6);
        radius[r] = rng.range(0.2, 4);
      }
    }
  }
  return { boxes, radius };
}

/** Tests every mesh of a store: the entries it makes, the draws each cascade then takes, and the median time. */
function casters(c: Cascades, s: { boxes: Float64Array; radius: Float64Array }, stretch: number): { entries: number; draws: number[]; ms: number } {
  const out = new Uint8Array(8);
  const draws = new Array<number>(c.count).fill(0);
  let entries = 0;
  const times: number[] = [];
  for (let k = 0; k < 30; k++) {
    const t = performance.now();
    entries = 0;
    for (let r = 0; r < s.radius.length; r++) {
      const b = r * 6;
      const mask = c.mask(s.boxes[b]!, s.boxes[b + 1]!, s.boxes[b + 2]!, s.boxes[b + 3]!, s.boxes[b + 4]!, s.boxes[b + 5]!, s.radius[r]!, stretch);
      if (mask === 0) continue;
      const n = c.entries(mask, ERRORS, 0b11111, out);
      entries += n;
      if (k === 0) for (let e = 0; e < n; e++) for (let i = 0; i < c.count; i++) if ((out[e * 2 + 1]! & (1 << i)) !== 0) draws[i]!++;
    }
    times.push(performance.now() - t);
  }
  return { entries, draws, ms: median(times) };
}

/** The sun 10 degrees up in the morning, in the east (-x). */
const MORNING = hourOfSun(10, false);
const SIEGE = { chunksX: 16, chunksZ: 16 };

/**
 * The siege scene: a base under siege seen from inside the fight, the camera at eye height looking west at it with the
 * morning sun behind. A stone box base of 2,000 pieces 60 m ahead (base.ts); every kind of building piece the content has
 * (`structure/piece`: no station, container, bed or static, so a new station never moves it), 20 of each in each of the
 * nine chunks round the camera; in a chunk beside the base a wooden box base of 20,000 pieces, 15 storeys of a room a
 * cell; 300 survivors
 * in armour with rifles and 100 raptors, running and fighting within 80 m all round. A map 1 km square, the bench's hills.
 */
export function siegeScene(reg: Registry, pack: Pack, tier: Tier): { scene: Scene; cam: Camera; remote: RemoteSample } {
  const hf = new Heightfield(SIEGE, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell + 3000, j * hf.cell + 3000];
      hf.setSample(i, j, 40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61));
    }
  }
  const structs = new StructureStore(SIEGE, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const rng = new Rng(81);
  const [cx, cz] = [480, 480];
  const ground = (x: number, z: number): number => hf.heightAt(x, z);
  const put = (kind: number, x: number, z: number, storey: number): void => void structs.add(kind, x, ground(x, z) + storey * 3.3 + structs.halfYOf(kind), z, rng.int(4) * 16384, 1, 1000);
  const lay = (pieces: Piece[]): void => void pieces.forEach(([kind, x, y, z, yaw]) => structs.add(kind, x, y, z, yaw, 1, 1000));
  lay(boxBase(reg, "stone", cx + 39, ground(cx + 60, cz), cz - 21, 14, 3, 2000));
  const all = reg.defs.flatMap((d, k) => (d?.type === "structure" && d.class === "piece" ? [k] : []));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const kind of all) for (let n = 0; n < 20; n++) put(kind, cx + dx * 64 + rng.range(-31, 31), cz + dz * 64 + rng.range(-31, 31), rng.int(3));
  const [x0, z0] = [Math.floor((cx + 96) / 64) * 64, Math.floor((cz + 64) / 64) * 64];
  lay(boxBase(reg, "wood", x0 + 0.5, ground(x0 + 32, z0 + 32), z0 + 0.5, 21, 1, 20000));
  const remote = new RemoteSample();
  const st = new AnimState();
  const survivor = reg.index.get("core:survivor")!;
  const raptor = reg.index.get("core:raptor")!;
  const rifle = reg.index.get("core:rifle")!;
  // A set of armour each, worn whole: the item worn in each body slot.
  const armour = ["hide", "chitin", "flak"].map((set) => {
    const worn = new Array<number>(SLOT_NAMES.length).fill(0);
    reg.defs.forEach((d, k) => d?.type === "item" && d.wear && d.id.startsWith(`core:${set}_`) && (worn[SLOT_NAMES.indexOf(d.wear.slot)] = k));
    return worn;
  });
  for (let n = 0; n < 400; n++) {
    const human = n < 300;
    const [a, r] = [rng.range(0, 2 * Math.PI), rng.range(3, 80)];
    const [x, z] = [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [n + 1, human ? survivor : raptor, x, ground(x, z), z, rng.range(-Math.PI, Math.PI), 1];
    st.setMotion(rng.float() * 7, rng.float() * 2, 0, 0);
    remote.anim[n] = st.pack();
    if (!human) continue;
    remote.hasLook[n] = 1;
    randomLook(rng, remote.look.subarray(n * LOOK_BYTES, (n + 1) * LOOK_BYTES));
    remote.gear[n * GEAR_COUNT + GEAR_HELD] = rifle;
    armour[n % 3]!.forEach((item, slot) => (remote.gear[n * GEAR_COUNT + GEAR_WORN + slot] = item));
  }
  remote.count = 400;
  remote.tick = 100;
  const scene = new Scene({ dims: SIEGE, hf, structs }, reg, pack);
  asTextured(scene);
  scene.assets.tier = tier;
  scene.viewHeight = 1080;
  scene.hour = MORNING;
  const cam = new Camera();
  [cam.x, cam.z, cam.aspect] = [cx, cz, 16 / 9];
  cam.y = ground(cx, cz) + 1.7;
  cam.yaw = Math.PI / 2;
  cam.pitch = -0.05;
  return { scene, cam, remote };
}

/** A frame's casters per cascade: entries, draws (an entry each, and one for the ground) and triangles; and tiles only shadows need. */
export function perCascade(scene: Scene, p: FramePacket): { draws: number[]; triangles: number[]; only: number } {
  const draws = new Array<number>(MAX_CASCADES).fill(0);
  const triangles = new Array<number>(MAX_CASCADES).fill(0);
  const tris = scene.assets.table.tris;
  for (let e = 0; e < p.casterCount; e++) {
    const n = ((p.casterFlags[e]! & DRAW_TEXTURED) !== 0 ? p.casterIndexCount[e]! / 3 : tris[p.casterMesh[e]!]![p.casterLod[e]!]!) * p.casterInstances[e]!;
    for (let k = 0; k < MAX_CASCADES; k++) {
      if ((p.casterCascades[e]! & (1 << k)) === 0) continue;
      draws[k]!++;
      triangles[k]! += n;
    }
  }
  let only = 0;
  const ground = new Array<boolean>(MAX_CASCADES).fill(false);
  for (let t = 0; t < p.tileCount; t++) {
    if ((p.tilePass[t]! & 3) === 0) only++;
    for (let k = 0; k < MAX_CASCADES; k++) {
      if ((p.tilePass[t]! & (TILE_CASTS << k)) === 0) continue;
      ground[k] = true;
      triangles[k]! += TILE_QUADS * TILE_QUADS * 2;
    }
  }
  ground.forEach((g, k) => (draws[k]! += g ? 1 : 0));
  return { draws, triangles, only };
}

interface Turned {
  entries: number[];
  draws: number[][];
  triangles: number[][];
  only: number[];
  /** Bodies posed with shadows, and without them. */
  posed: number[];
  offPosed: number[];
  dropped: number;
  /** The frame build with casters, and with the same tier's shadows off. */
  ms: number[];
  offMs: number[];
}

/** Turns the camera through a circle, each step built on `tier` with its shadows and without them. */
function turn(scene: Scene, cam: Camera, remote: RemoteSample | null, tier: Tier, steps: number, out: Turned): void {
  const off = { ...tier, shadows: { ...tier.shadows, cascades: 0 } };
  scene.assets.tier = tier;
  for (let k = 0; k < 4; k++) scene.build(cam, remote);
  const yaw = cam.yaw;
  for (let k = 0; k < steps; k++) {
    cam.yaw = yaw + (k / steps) * 2 * Math.PI;
    scene.assets.tier = off;
    let at = performance.now();
    scene.build(cam, remote);
    out.offMs.push(performance.now() - at);
    out.offPosed.push(scene.characters.posed);
    scene.assets.tier = tier;
    at = performance.now();
    const p = scene.build(cam, remote);
    out.ms.push(performance.now() - at);
    const c = perCascade(scene, p);
    out.entries.push(p.casterCount);
    out.draws.push(c.draws);
    out.triangles.push(c.triangles);
    out.only.push(c.only);
    out.posed.push(scene.characters.posed);
    out.dropped += p.casterDropped;
  }
  cam.yaw = yaw;
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

function sceneRows(record: Row, name: string, cascades: number, t: Turned, withBodies: boolean): void {
  record(`${name}: caster entries a frame, mean`, mean(t.entries), "");
  record(`${name}: caster entries a frame, most`, Math.max(...t.entries), "", 4096);
  record(`${name}: entries left out for a full list`, t.dropped, "", 0);
  for (let k = 0; k < cascades; k++) {
    record(`${name}: draws in cascade ${k}, mean`, mean(t.draws.map((d) => d[k]!)), "");
    record(`${name}: triangles in cascade ${k}, mean, thousands`, mean(t.triangles.map((d) => d[k]!)) / 1000, "");
  }
  record(`${name}: tiles only shadows need, mean`, mean(t.only), "");
  if (withBodies) {
    record(`${name}: bodies posed in view, mean`, mean(t.offPosed), "");
    record(`${name}: bodies posed for their shadows alone, mean`, mean(t.posed.map((n, i) => n - t.offPosed[i]!)), "");
  }
  record(`${name}: frame build with casters, median`, median([...t.ms]), "ms");
  record(`${name}: frame build with that tier's shadows off, median`, median([...t.offMs]), "ms");
  record(`${name}: what casters add, median of each frame's`, median(t.ms.map((ms, i) => ms - t.offMs[i]!)), "ms");
}

const turned = (): Turned => ({ entries: [], draws: [], triangles: [], only: [], posed: [], offPosed: [], dropped: 0, ms: [], offMs: [] });

/** The scenes' rows: the bench base from 60 m off five of its bases, and the siege scene, turning, on each lit tier. */
export function benchCasters(section: Section, record: Row): void {
  const reg = compileContent(CORE_CONTENT).registry!;
  const pack = parsePack(buildCorePack());
  const tiers = (["medium", "high", "ultra"] as const).map((n) => tierOf(n));

  section("Shadow casters (headless): the chunks a client holds round five bench bases, from 60 m off each, turning, sun 10 degrees up");
  const hf = terrain();
  const { centers, byChunk } = bases(reg, hf);
  const views = centers.slice(0, 5).map(([bx, bz]) => {
    const cam = new Camera();
    [cam.x, cam.z, cam.aspect] = [bx + 60, bz, 16 / 9];
    cam.y = hf.heightAt(cam.x, cam.z) + 8;
    cam.yaw = Math.PI / 2 + Math.PI;
    const scene = held(reg, pack, hf, cam.x, cam.z, (c) => byChunk.get(c) ?? []);
    scene.hour = MORNING;
    return { scene, cam };
  });
  for (const tier of tiers) {
    const t = turned();
    for (const v of views) turn(v.scene, v.cam, null, tier, 12, t);
    sceneRows(record, `bench base, ${tier.name}`, tier.shadows.cascades, t, false);
  }

  section("Shadow casters (headless): the siege scene, turning at eye height inside the fight, sun 10 degrees up");
  const s = siegeScene(reg, pack, tiers[0]!);
  for (const tier of tiers) {
    const t = turned();
    turn(s.scene, s.cam, s.remote, tier, 24, t);
    sceneRows(record, `siege, ${tier.name}`, tier.shadows.cascades, t, true);
  }
}

export function benchShadow(section: Section, record: Row): void {
  section("Shadows (headless): cascades fitted, and 50 kinds in each of 30 chunks tested for their cascades and levels, sun 10 degrees up");
  const worst = store(-2, -2, 2, 3);
  const full = store(-4, -4, 4, 4);
  const cam = new Camera();
  const [sx, sy, sz] = [Math.cos(SUN) * 0.6, Math.sin(SUN), Math.cos(SUN) * 0.8];
  const stretch = reach(30, sy);
  for (const [name, setup] of SETUPS) {
    const c = new Cascades();
    cam.x = 8000.3;
    cam.y = 41.7;
    cam.z = 7900.6;
    const fits: number[] = [];
    for (let k = 0; k < 40; k++) {
      const t = performance.now();
      for (let f = 0; f < 1000; f++) {
        cam.x += 0.02;
        cam.yaw += 0.003;
        c.fit(cam, sx, sy, sz, setup, f);
      }
      fits.push(performance.now() - t);
    }
    record(`${name}: fit the cascades, a frame, median`, median(fits), "µs", 5);
    cam.yaw = 0.4;
    cam.pitch = -0.1;
    c.fit(cam, sx, sy, sz, setup, 0);
    const w = casters(c, worst, stretch);
    record(`${name}: caster entries`, w.entries, "", 4096);
    w.draws.forEach((d, i) => record(`${name}: draws in cascade ${i}`, d, ""));
    record(`${name}: test and level every mesh, median`, w.ms, "ms", 0.3);
    const f = casters(c, full, stretch);
    record(`${name}: caster entries with all 81 chunks of the near store built up`, f.entries, "");
  }
  benchCasters(section, record);
}

// `bun tools/bench/shadow.ts scenes` runs the scenes' rows alone.
if (import.meta.main) {
  (process.argv.includes("scenes") ? benchCasters : benchShadow)(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
