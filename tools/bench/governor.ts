// What each of the governor's steps leaves of a frame (client/core/governor.ts), counted at the iPhone's view with the
// touch rule in the scenes of its kept soaks as the device page lays them out (devicescene.ts) and in the budget's woods
// with forty bodies fighting (budget.ts), and what that frame would take the iPhone's GPU by the costs its reports
// measured. Then the soaks are replayed through the governor, each level leaving the share of the GPU's time it leaves in
// its soak's scene. `bun tools/bench/governor.ts [headings] [file.snmap]` runs these alone, and given a built city, the
// census's downtown views of it (tools/bench/census.ts) too, turning where they stand.

import { readFileSync } from "node:fs";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import type { SoakReport } from "../../client/core/device.ts";
import { BodyCopies, basePieces, crowdScene } from "../../client/core/devicescene.ts";
import { TARGET_MS, ladder, workMs, type GovernorStep } from "../../client/core/governor.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene, type Thing } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CHUNK_SIZE, chunkCount } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { curve, phoneSoaks, run, type Minute } from "../../tests/fixtures/frames.ts";
import { corePack, corePackBytes } from "../../tests/fixtures/pack.ts";
import { coreRegistry, provingWorld } from "../../tests/fixtures/world.ts";
import { asTextured } from "./base.ts";
import { SPOTS, VIEW, fight, wood } from "./budget.ts";
import { CENSUS_VIEWS, centreOf, placeOf } from "./census.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** The iPhone of D349: three device pixels to a CSS pixel. */
export const PHONE_DPR = 3;
const EYE = 1.62;
/** The soak turns once a minute; the frames counted at each heading turn as it does. */
const TURN = (2 * Math.PI) / 3600;
/** Frames a heading is built before it is counted: enough for levels to settle, and in a wood for the squeeze to rise to its most. */
const SETTLE = 8;
const SQUEEZED = 110;

/** A scene to count, and what it does as the camera comes to a heading. */
export interface Counting {
  scene: Scene;
  cam: Camera;
  remote: RemoteSample | null;
  settle: number;
  face?: () => void;
}

/**
 * A soak's scene as the device page stands it on the proving ground: the crowd and its thatch behind the spawn point,
 * `bodies` copies of the crowd dressed and riding toward +X, the houses' first `pieces` toward -X, and rocks ahead, the
 * core's in the places the stress pack's take, which a player never sees. The camera stands at the spawn point.
 */
export function soakScene(load: SoakReport["load"]): Counting {
  const w = provingWorld();
  const reg = w.reg;
  const crowd = crowdScene();
  const floor = w.hf.heightAt(crowd.floor.x, crowd.floor.z);
  const add = (id: string, x: number, y: number, z: number, yaw: number): void => {
    const kind = reg.index.get(id) ?? 0;
    const def = reg.defs[kind];
    if (def?.type === "structure") w.structs.add(kind, x, y, z, yaw, 0, def.hp);
  };
  for (const p of crowd.pieces) add(p.id, p.x, floor + p.y, p.z, p.yaw);
  for (const p of basePieces(load.pieces)) add(p.id, p.x, w.hf.heightAt(p.house.x, p.house.z) + p.y, p.z, p.yaw);
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, corePack());
  asTextured(scene);
  scene.viewHeight = VIEW[1];
  const rocks = [1, 2, 3, 4, 5, 6].map((k) => scene.assets.table.find(`core:rock_${k}`));
  const eye = w.hf.heightAt(PROVING_SPAWN.x, PROVING_SPAWN.z) + EYE;
  const half = Math.atan(Math.tan((VIEW[2] * Math.PI) / 360) * (VIEW[0] / VIEW[1]));
  const things: Thing[] = [];
  // As devicescene.ts `rocks` spreads them, by the golden angle.
  const place = (i: number, d: number, rise: number): void => {
    const across = (((i * 0.618034) % 1) * 2 - 1) * half * 0.9;
    const up = (((i * 0.754878) % 1) * 2 - 1) * 0.18 + rise;
    things.push({ mesh: rocks[i % rocks.length]!, x: PROVING_SPAWN.x + Math.sin(across) * d, y: eye + Math.sin(up) * d - 1, z: PROVING_SPAWN.z + Math.cos(across) * d, level: -1 });
  };
  for (let i = 0; i < load.near; i++) place(i, 6 + 0.05 * i, 0.12);
  for (let i = 0; i < load.far; i++) place(i, 140 + 0.02 * i, 0.3);
  scene.things = things;
  // The crowd as the server stands it, sampled as the session samples it, and the page's copies of it.
  const remote = new RemoteSample();
  const session = {
    sampleRemote(out: RemoteSample): void {
      out.count = 0;
      for (const b of crowd.bodies) {
        const i = out.count++;
        [out.id[i], out.kind[i], out.flags[i], out.level[i]] = [i + 1, reg.index.get(b.species) ?? 0, 1, 1];
        [out.x[i], out.y[i], out.z[i], out.yaw[i]] = [b.x, w.hf.heightAt(b.x, b.z), b.z, Math.PI];
      }
    },
  };
  new BodyCopies(session, w.hf, reg).n = load.bodies;
  session.sampleRemote(remote);
  remote.tick = 3000;
  const cam = new Camera();
  [cam.aspect, cam.fovY, cam.x, cam.y, cam.z] = [VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180, PROVING_SPAWN.x, eye, PROVING_SPAWN.z];
  return { scene, cam, remote, settle: SETTLE };
}

/** A wood of the budget's bench, with `bodies` fighting in front of the camera at each heading. */
export function woodScene(spot: readonly number[], bodies: number): Counting {
  const { scene, cam, ground } = wood(spot);
  const remote = new RemoteSample();
  remote.tick = 3000;
  return { scene, cam, remote, settle: SQUEEZED, face: () => fight(remote, scene, cam, ground, bodies) };
}

/**
 * A census view of the built city in `path` at the iPhone's view, as tools/bench/census.ts stands it: the near store
 * holding the 7 by 7 chunks round the camera whole, the far city the rest, nothing left to make in a frame.
 */
export function cityScenes(path: string): [string, () => Counting][] {
  const map = parseMap(new Uint8Array(readFileSync(path)), false);
  const reg = coreRegistry();
  const hf = mapHeightfield(map);
  const statics = new CityStatics(map.dims, map.statics, reg);
  const pack = parsePack(corePackBytes());
  return CENSUS_VIEWS.filter((v) => v.name === "street-300" || v.name === "air-wide").map((view) => [`${map.id} at ${view.name}`, () => {
    const cam = new Camera();
    [cam.x, cam.y, cam.z] = placeOf(centreOf(map), hf, view);
    [cam.pitch, cam.aspect, cam.fovY] = [view.pitch, VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180];
    const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    const held = new Uint8Array(chunkCount(map.dims));
    const [cx, cz] = [Math.floor(cam.x / CHUNK_SIZE), Math.floor(cam.z / CHUNK_SIZE)];
    for (let j = cz - 3; j <= cz + 3; j++) {
      for (let i = cx - 3; i <= cx + 3; i++) {
        const c = j * map.dims.chunksX + i;
        for (let s = statics.first[c]!; s < statics.first[c + 1]!; s++) structs.put(c, s - statics.first[c]!, statics.kind[s]!, statics.x[s]!, statics.y[s]!, statics.z[s]!, statics.yaw[s]!, 0, reg.maxHp[statics.kind[s]!]!, 1);
        structs.setVersion(c, 1);
        held[c] = 1;
      }
    }
    const complete = (c: number): boolean => held[c] === 1;
    const scene = new Scene({ mapId: map.id, dims: map.dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics, complete } }, reg, pack);
    asTextured(scene);
    scene.viewHeight = VIEW[1];
    scene.build(cam, null);
    scene.city!.makeMs = Infinity;
    return { scene, cam, remote: null, settle: SETTLE };
  }]);
}

/** A frame's counts: what it draws and what it casts into the sun's maps, and the device pixels it shades. */
export interface Counts {
  triangles: number;
  draws: number;
  cast: number;
  castDraws: number;
  pixels: number;
}

/** Device pixels the shell draws at a tier on the iPhone's view (client/shell/main.ts). */
export function pixelsOf(tier: Tier): number {
  const ratio = tier.pixelRatio > 0 ? Math.min(PHONE_DPR, tier.pixelRatio) : PHONE_DPR;
  return Math.floor(VIEW[0] * ratio) * Math.floor(VIEW[1] * ratio);
}

/** The mean over `headings` headings of what a frame of `tier` draws, each settled first. */
export function counted(s: Counting, tier: Tier, headings: number): Counts {
  const { scene, cam, remote } = s;
  scene.assets.tier = tier;
  const sum: Counts = { triangles: 0, draws: 0, cast: 0, castDraws: 0, pixels: pixelsOf(tier) };
  for (let k = 0; k < headings; k++) {
    cam.yaw = (k / headings) * Math.PI * 2;
    s.face?.();
    // The squeeze rises to what the heading needs, as it does when the camera comes to it.
    scene.budget.reset();
    // The last two frames, of which the farther cascade drawn every other frame takes one.
    for (let f = 0; f < s.settle + 2; f++) {
      cam.yaw += TURN;
      scene.now += 1000 / 60;
      if (remote) remote.tick += 0.5;
      const p = scene.build(cam, remote);
      if (f < s.settle) continue;
      sum.triangles += p.triangles / 2;
      sum.draws += p.drawCount / 2;
      sum.cast += p.castTriangles / 2;
      sum.castDraws += p.castDraws / 2;
    }
  }
  return { triangles: sum.triangles / headings, draws: sum.draws / headings, cast: sum.cast / headings, castDraws: sum.castDraws / headings, pixels: sum.pixels };
}

/**
 * What a frame takes the iPhone's GPU at full clock, in ms: its work as the governor counts it (governor.ts workMs), and
 * each device pixel lit at the cost of the dome with two cloud layers, the costliest whole-screen program, 1.3 ms a
 * million, with the shadow lookup's taps beside it (D349).
 */
export function phoneMs(c: Counts, tier: Tier): number {
  const s = tier.shadows;
  const taps = s.cascades > 0 ? (s.taps <= 1 ? 0.06 : s.taps <= 4 ? 0.19 : 0.49) : 0;
  return workMs(c.triangles, c.draws, s.cascades > 0 ? c.cast : 0, s.cascades > 0 ? c.castDraws : 0, s.size) + (c.pixels / 1e6) * (1.3 + taps);
}

/** Each level of `base`'s ladder on the phone in `s`: its name, counts and ms. */
export function levels(s: Counting, base: Tier, headings: number): { name: string; counts: Counts; ms: number }[] {
  // Once round first, so the tier's own count starts from levels settled as every other's does.
  counted(s, base, headings);
  return ladder(base, PHONE_DPR).map(({ name, tier }) => {
    const counts = counted(s, tier, headings);
    return { name, counts, ms: phoneMs(counts, tier) };
  });
}

/** The scene each kept soak turned through. */
export function sceneOf(soak: { load: SoakReport["load"]; wood: boolean }): Counting {
  return soak.wood ? woodScene(SPOTS.young, 0) : soakScene(soak.load);
}

/** A kept soak replayed through the governor on its tier, each level leaving `left` of the GPU's time of the tier's. */
export function replay(soak: { tier: string; points: number[] }, left: readonly number[]): { minutes: Minute[]; steps: readonly GovernorStep[] } {
  const warm = curve(soak.points);
  const { minutes, governor } = run(10, (t, level) => ({ gpu: warm(t) * left[level]! }), { tier: soak.tier, dpr: PHONE_DPR });
  return { minutes, steps: governor.steps };
}

export function benchGovernor(section: Section, record: Row, headings = 8, city?: string): void {
  const scenes: [string, () => Counting][] = [
    ["200 bodies and 1,024 pieces, the soak of 07-47", () => soakScene({ bodies: 200, pieces: 1024, near: 16, far: 512, stress: true })],
    ["800 bodies and 64 near rocks, the soak of 08-23", () => soakScene({ bodies: 800, pieces: 0, near: 64, far: 512, stress: true })],
    ["the young wood, 40 bodies", () => woodScene(SPOTS.young, 40)],
    ["the elder stand, 40 bodies", () => woodScene(SPOTS.elder, 40)],
    ...(city ? cityScenes(city) : []),
  ];
  for (const name of ["medium", "high"]) {
    const base = forTouch(tierOf(name), true);
    for (const [scene, make] of scenes) {
      section(`The governor's steps on ${name} with the touch rule at the iPhone's view, in ${scene}, ${headings} headings: what each level leaves, and the phone's GPU at full clock`);
      for (const [k, l] of levels(make(), base, headings).entries()) {
        const c = l.counts;
        record(`${k} ${l.name}`, l.ms, `ms: ${(c.triangles / 1e6).toFixed(3)} M triangles, ${(c.cast / 1e6).toFixed(3)} M cast, ${c.draws.toFixed(0)} and ${c.castDraws.toFixed(0)} draws, ${(c.pixels / 1e6).toFixed(2)} MP`);
      }
    }
  }
  for (const soak of phoneSoaks()) {
    const rows = levels(sceneOf(soak), forTouch(tierOf(soak.tier), true), headings);
    const { minutes, steps } = replay(soak, rows.map((r) => r.ms / rows[0]!.ms));
    section(`The iPhone's soak ${soak.name} on ${soak.tier}, replayed through the governor, each level leaving the share of the phone's GPU it leaves in the soak's scene`);
    record("minute 1, median frame", minutes[0]!.median, "ms");
    record("minute 10, median frame, at 60 a second", minutes[9]!.median, "ms", Math.round((TARGET_MS + 0.5) * 10) / 10);
    record("minute 10 without the governor", soak.points.at(-1)!, "ms");
    record("the level at minute 10", minutes[9]!.level, `(${rows[minutes[9]!.level]!.name}, ${(rows[minutes[9]!.level]!.ms / rows[0]!.ms).toFixed(2)} of the tier's GPU time)`);
    record("steps back up while it warmed", steps.filter((s) => s.name.startsWith("back from")).length, "", 0);
    for (const s of steps) record(`to ${s.level}, ${s.name} (${s.why}), at minute`, s.at / 60000, "");
  }
}

if (import.meta.main) {
  const section = (title: string): void => console.log(`\n${title}`);
  const record: Row = (name, value, unit, budget = null) => console.log(`  ${name.slice(0, 90).padEnd(90)} ${value.toFixed(2).padStart(8)} ${unit}${budget === null || budget === undefined ? "" : value <= budget ? `  ok (budget ${budget.toFixed(1)})` : `  MISS (budget ${budget.toFixed(1)})`}`);
  const [headings, city] = process.argv.slice(2);
  benchGovernor(section, record, Number(headings ?? 8), city);
}
