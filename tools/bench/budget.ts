// Rows for the frame's budget (client/core/render/budget.ts): a fight in the wood. Forty bodies, survivors and their
// tames, fight in front of the camera in the device page's young wood and in its elder stand (devicescene.ts), on medium
// at the iPhone's view, the camera turning through eight headings; each with the budget off and on. Levels are taken as
// drawn with their materials, as a phone holding the wood's textures draws them, so a crown's trunk and leaves are drawn
// as the GPU gets them. `bun tools/bench/budget.ts` runs these alone.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { STAND, terrainWood } from "../../client/core/devicescene.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { FAR_BUFFER } from "../../client/core/render/far.ts";
import { DRAW_DETAILS, DRAW_SCREENS, DRAW_PULLED, DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { mapHeightfield, mapNodes, parseMap, resolveNodes, writeMap } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { asTextured } from "./base.ts";
import { perCascade } from "./shadow.ts";
import { benchHills } from "./terrain.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** The device page's tree order's view on the iPhone, in CSS pixels, and its height in degrees; its spots, young and elder. */
export const VIEW = [390, 669, 70] as const;
export const SPOTS = { young: [4096, 4096], elder: [STAND.x, STAND.z] } as const;
const BODIES = 40;
const HEADINGS = 8;
/** Frames a heading is built before it is counted, for the squeeze to settle. */
const SETTLE = 150;
const EYE = 1.7;

/** The parts of the frame's order a frame's triangles are told in; what is left is the ground and what is far. */
const PARTS = ["bodies", "fight", "built", "trunks", "rocks", "bushes", "crowns", "ground and far"] as const;
type Part = (typeof PARTS)[number];

/** What a frame drew: all of it, by part, its draws, the squeeze, each body draw's mesh and level, what it cast into every cascade, and the bytes it put on the card. */
export interface Counted {
  triangles: number;
  parts: Record<Part, number>;
  draws: number;
  squeeze: number;
  levels: string;
  cast: number;
  casterDraws: number;
  uploads: number;
}

export function count(scene: Scene, p: FramePacket): Counted {
  const { tris, materials } = scene.assets.table;
  const ids = corePack().header.meshes.map((m) => m.id);
  const parts = Object.fromEntries(PARTS.map((k) => [k, 0])) as Record<Part, number>;
  const levels: string[] = [];
  for (let d = 0; d < p.drawCount; d++) {
    const [flags, buffer, mesh] = [p.drawFlags[d]!, p.drawBuffer[d]!, p.drawMesh[d]!];
    if ((flags & DRAW_PULLED) !== 0 || buffer === FAR_BUFFER) continue;
    if ((flags & DRAW_SCREENS) !== 0) continue;
    if ((flags & DRAW_DETAILS) !== 0) {
      parts.fight += p.drawInstances[d]! * 2;
      continue;
    }
    const n = ((flags & DRAW_TEXTURED) !== 0 ? p.drawIndexCount[d]! / 3 : tris[mesh]![p.drawLod[d]!]!) * p.drawInstances[d]!;
    const id = ids[mesh]!;
    let part: Part = "built";
    if (buffer === TRANSIENT_BUFFER) part = (flags & DRAW_SKINNED) !== 0 ? "bodies" : "fight";
    else if (buffer >= NODE_BUFFERS) part = /rock/.test(id) ? "rocks" : /bush/.test(id) ? "bushes" : (flags & DRAW_TEXTURED) !== 0 && materials[p.drawMaterial[d]!]!.id.endsWith("bark") ? "trunks" : "crowns";
    parts[part] += n;
    if (part === "bodies") levels.push(`${mesh}:${p.drawLod[d]}`);
  }
  parts["ground and far"] = p.triangles - PARTS.reduce((s, k) => s + parts[k], 0);
  const cast = perCascade(scene, p);
  const uploads = [...p.uploads, ...p.assetUploads, ...p.texUploads].reduce((s, u) => s + u.data.length, 0);
  return { triangles: p.triangles, parts, draws: p.drawCount, squeeze: scene.budget.squeeze, levels: levels.join(" "), cast: cast.triangles.reduce((s, v) => s + v, 0), casterDraws: cast.draws.reduce((s, v) => s + v, 0), uploads };
}

/** The wood at `spot` on the device page's map, a scene on medium over it, and the camera at eye height there. */
export function wood(spot: readonly number[]): { scene: Scene; cam: Camera; ground: (x: number, z: number) => number } {
  const reg = coreRegistry();
  const hills = benchHills();
  const map = parseMap(writeMap(resolveNodes({ id: "bench:budget", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [terrainWood(hills.dims)], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }, reg)));
  const hf = mapHeightfield(map);
  const source = mapNodes(map, hf, reg)!;
  const tier = tierOf("medium");
  const field = new NodeField(map.dims, reg, source);
  field.retain(chunkAt(map.dims, spot[0]!, spot[1]!), tier.nodes.chunks, 1, () => false);
  const farNodes = { nodes: source, held: (c: number) => field.isLoaded(c), gone: () => undefined, changes: new NodeChanges(map.dims) };
  const scene = new Scene({ dims: map.dims, hf, structs: new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: field.store, farNodes }, reg, corePack());
  scene.assets.tier = tier;
  scene.viewHeight = VIEW[1];
  if (scene.nodesFar) scene.nodesFar.makes = Infinity;
  asTextured(scene);
  const cam = new Camera();
  cam.aspect = VIEW[0] / VIEW[1];
  cam.fovY = (VIEW[2] * Math.PI) / 180;
  [cam.x, cam.y, cam.z] = [spot[0]!, hf.heightAt(spot[0]!, spot[1]!) + EYE, spot[1]!];
  return { scene, cam, ground: (x, z) => hf.heightAt(x, z) };
}

/** Forty bodies fighting in front of the camera at `yaw`: half survivors swinging, half their tames running at them, 4 to 34 m off. */
export function fight(remote: RemoteSample, scene: Scene, cam: Camera, ground: (x: number, z: number) => number, n: number): void {
  const reg = coreRegistry();
  const kinds = [reg.index.get("core:survivor")!, reg.index.get("core:raptor")!, reg.index.get("core:parasaur")!];
  const rng = new Rng(41);
  const st = new AnimState();
  const half = Math.tan(cam.fovY / 2) * cam.aspect * 0.8;
  for (let i = 0; i < n; i++) {
    const ahead = 4 + rng.float() * 30;
    const aside = (rng.float() * 2 - 1) * half * ahead;
    // Ahead and to the right, as Camera looks.
    const [fx, fz] = [Math.sin(cam.yaw), Math.cos(cam.yaw)];
    const [x, z] = [cam.x + fx * ahead - fz * aside, cam.z + fz * ahead + fx * aside];
    remote.id[i] = i + 1;
    remote.kind[i] = i % 2 === 0 ? kinds[0]! : kinds[1 + ((i >> 1) % 2)]!;
    [remote.x[i], remote.y[i], remote.z[i], remote.yaw[i], remote.flags[i]] = [x, ground(x, z), z, rng.float() * Math.PI * 2, 1];
    st.setMotion(i % 2 === 0 ? 0 : 4 + rng.float() * 4, 0, 0, 0);
    st.setAction(i % 2 === 0 ? ACT_SWING : ACT_NONE, 0, 0);
    remote.anim[i] = st.pack();
  }
  remote.count = n;
  scene.skip = -1;
}

/** Each heading's frame once the squeeze has settled. */
export function turn(scene: Scene, cam: Camera, ground: (x: number, z: number) => number, bodies: number, on: boolean, headings = HEADINGS): { frames: Counted[]; ms: number[] } {
  const remote = new RemoteSample();
  remote.tick = 3000;
  scene.budget.on = on;
  scene.budget.reset();
  const frames: Counted[] = [];
  const ms: number[] = [];
  for (let k = 0; k < headings; k++) {
    cam.yaw = (k / headings) * Math.PI * 2;
    fight(remote, scene, cam, ground, bodies);
    let p: FramePacket | null = null;
    for (let f = 0; f < SETTLE; f++) {
      scene.now += 1000 / 60;
      remote.tick += 0.5;
      const t = performance.now();
      p = scene.build(cam, remote);
      if (f >= SETTLE - 30) ms.push(performance.now() - t);
    }
    frames.push(count(scene, p!));
  }
  return { frames, ms };
}

export function benchFrameBudget(section: Section, record: Row): void {
  section(`The frame's budget: ${BODIES} bodies fighting in the device page's woods, on medium at the iPhone's view, the camera turning`);
  const most = tierOf("medium").budget.triangles;
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  for (const [name, spot] of Object.entries(SPOTS)) {
    const { scene, cam, ground } = wood(spot);
    for (const bodies of [0, BODIES]) {
      const off = turn(scene, cam, ground, bodies, false);
      const on = turn(scene, cam, ground, bodies, true);
      const what = `${name} wood, ${bodies} bodies`;
      record(`${what}: triangles a heading, the budget off, mean and most`, mean(off.frames.map((f) => f.triangles)) / 1e6, `M (${(Math.max(...off.frames.map((f) => f.triangles)) / 1e6).toFixed(2)} M)`);
      record(`${what}: triangles a heading, the budget on, mean and most`, mean(on.frames.map((f) => f.triangles)) / 1e6, `M (${(Math.max(...on.frames.map((f) => f.triangles)) / 1e6).toFixed(2)} M)`, most / 1e6);
      const part = (r: { frames: Counted[] }, k: Part): string => (mean(r.frames.map((f) => f.parts[k])) / 1e6).toFixed(2);
      record(`${what}: crowns near, off and on`, mean(off.frames.map((f) => f.parts.crowns)) / 1e6, `M, ${part(on, "crowns")} M`);
      record(`${what}: the rest, by part, on`, (on.frames[0]!.triangles - on.frames[0]!.parts.crowns) / 1e6, `M: ${PARTS.filter((k) => k !== "crowns").map((k) => `${k} ${part(on, k)}`).join(", ")}`);
      record(`${what}: the squeeze, mean and most`, mean(on.frames.map((f) => f.squeeze)), `(${Math.max(...on.frames.map((f) => f.squeeze)).toFixed(2)})`);
      if (bodies > 0) {
        record(`${what}: bodies' triangles, off and on`, mean(off.frames.map((f) => f.parts.bodies)) / 1e3, `k, ${(mean(on.frames.map((f) => f.parts.bodies)) / 1e3).toFixed(0)} k`);
        record(`${what}: headings whose bodies' levels the budget changed`, on.frames.filter((f, k) => f.levels !== off.frames[k]!.levels).length, "", 0);
      }
      record(`${what}: draws a heading, off and on`, mean(off.frames.map((f) => f.draws)), `, ${mean(on.frames.map((f) => f.draws)).toFixed(0)}`, tierOf("medium").budget.draws);
      record(`${what}: triangles cast into the sun's maps, and their draws, on`, mean(on.frames.map((f) => f.cast)) / 1e6, `M (${mean(on.frames.map((f) => f.casterDraws)).toFixed(0)} draws)`);
      record(`${what}: frame build, median, off and on`, median(off.ms), `ms, ${median(on.ms).toFixed(2)} ms`);
    }
  }
}

if (import.meta.main) {
  const section = (title: string): void => console.log(`\n${title}`);
  const record: Row = (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);
  benchFrameBudget(section, record);
}
