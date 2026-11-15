// A body that dies goes limp (shared/anim/ragdoll.ts, client/core/ragdoll.ts): from its death clip with no jump, to rest
// on a slope within three seconds with no joint past its limit and nothing under the ground or inside a structure,
// falling again when the floor it lies on is taken away, the same every time. A client draws the bodies the server sends,
// and each lies alike for every client and for the server.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRig, buildRigs, type Rig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { AnimState, CUE_DEAD, CUE_OUT } from "../../shared/anim/pose.ts";
import { FALLING, Fall, layCorpse, wireX, wireY, wireYaw } from "../../shared/anim/corpse.ts";
import { creatureAnims } from "../../shared/anim/creature.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { slopeKind } from "../../content/slopes.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Corpses, type Corpse } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { convertCreature } from "../../tools/pack/creature.ts";
import { readGltf } from "../../tools/pack/gltf.ts";
import { provingView } from "../../tools/snap.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { corePack } from "../fixtures/pack.ts";
import { strider } from "../fixtures/strider.ts";
import { TUBE, tubeGlb } from "../fixtures/textured.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const rigs = buildRigs(corePack().header.rigs, corePack().clips);
const STEP = 1 / 60;
const DEG = Math.PI / 180;

/** Every rig with a ragdoll: the creatures in the repository and the one made in a test. */
function dolls(): [string, Rig][] {
  const found: [string, Rig][] = CREATURE_ASSETS.flatMap(({ id }) => (rigs.get(id)?.ragdoll ? [[id, rigs.get(id)!] as [string, Rig]] : []));
  return [...found, ["strider", strider()]];
}

/** Ground rising `slope` metres a metre toward +X, and a structure store for what is built on it. */
function world(slope: number) {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, i * TERRAIN_CELL * slope);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  return { hf, structs };
}

/** The pose of the death clip at `frame`, solved. */
function dying(rig: Rig, frame: number): Solved {
  const pose = new Pose(rig.bones);
  const out = new Solved(rig.bones);
  sampleClip(rig.clips.get("death")!, frame, pose);
  solve(rig, pose, out);
  return out;
}

/** The body goes limp where it stood at (x, y, z) facing `yaw`. */
function drop(rig: Rig, x: number, y: number, z: number, yaw: number, size = 1): Ragdoll {
  const d = new Ragdoll(rig, rig.ragdoll!);
  d.start(dying(rig, rig.ragdoll!.limp), dying(rig, rig.ragdoll!.limp - 1), x, y, z, yaw, size);
  return d;
}

/** Steps a sixtieth of a second at a time for up to `seconds` and returns when it fell asleep, or -1. */
function rest(d: Ragdoll, w: ReturnType<typeof world>, seconds: number): number {
  for (let f = 1; f <= seconds / STEP; f++) if (!d.step(w, STEP)) return f * STEP;
  return -1;
}

/** The most any joint is past its limit, in radians. */
function past(d: Ragdoll): number {
  let most = 0;
  for (let i = 1; i < d.n; i++) {
    const [swing, twist] = d.bend(i);
    most = Math.max(most, swing - d.def.swing[i]!, twist - d.def.twist[i]!);
  }
  return most;
}

test("going limp is not a jump: the first pose of the ragdoll is the death clip's at the frame it goes limp", () => {
  for (const [id, rig] of dolls()) {
    const d = drop(rig, 40, 3, 40, 1.1, 0.7);
    const drawn = new Solved(rig.bones);
    d.pose(drawn);
    const clip = dying(rig, rig.ragdoll!.limp);
    let off = 0;
    for (let k = 0; k < clip.pos.length; k++) off = Math.max(off, Math.abs(clip.pos[k]! - drawn.pos[k]!));
    for (let k = 0; k < clip.rot.length; k++) off = Math.max(off, Math.abs(clip.rot[k]! - drawn.rot[k]!));
    expect([id, off < 1e-5]).toEqual([id, true]);
  }
});

test("a creature dropped on a slope rests within 3 s, with no joint past its limit and no body under the ground", () => {
  const w = world(0.35);
  for (const [id, rig] of dolls()) {
    for (let k = 0; k < 6; k++) {
      const yaw = k * 1.05;
      const d = drop(rig, 60, w.hf.heightAt(60, 64), 64, yaw);
      const at = rest(d, w, 3);
      expect([id, yaw, at > 0, past(d) < 1 * DEG, d.deepest(w) < 0.01]).toEqual([id, yaw, true, true, true]);
      // Asleep, it stays where it lies: nothing drags it.
      const x = Float64Array.from(d.x);
      for (let f = 0; f < 120; f++) expect(d.step(w, STEP)).toBe(false);
      expect(Array.from(d.x)).toEqual(Array.from(x));
    }
  }
});

test("the dodo comes to rest on the slope and on a floor from every one of 32 yaws, well inside the 3 s", () => {
  // Its round trunk once crawled over onto its side for seconds, a few tenths inside the limit at the six yaws above and
  // past it at others. Every yaw rests within 2 s, and nine in ten within 1 s.
  const rig = rigs.get("core:dodo")!;
  const slope = world(0.35);
  const flat = world(0);
  const ceiling = reg.index.get("core:ceiling_wood")!;
  for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) flat.structs.add(ceiling, 60 + dx, 2.5, 64 + dz, 0, 0, 1);
  for (const [w, y, size] of [[slope, slope.hf.heightAt(60, 64), 1], [flat, 2.5 + reg.halfY[ceiling]!, 0.8]] as const) {
    const times: number[] = [];
    for (let k = 0; k < 32; k++) {
      const yaw = (k * Math.PI) / 16;
      const d = drop(rig, 60, y, 64, yaw, size);
      const at = rest(d, w, 2);
      expect([yaw, at > 0, past(d) < 1 * DEG, d.deepest(w) < 0.01]).toEqual([yaw, true, true, true]);
      const x = Float64Array.from(d.x);
      for (let f = 0; f < 60; f++) d.step(w, STEP);
      expect(Array.from(d.x)).toEqual(Array.from(x));
      times.push(at);
    }
    expect(times.filter((t) => t > 1).length).toBeLessThanOrEqual(3);
  }
});

test("a ragdoll on a floor rests on it, falls again when the floor is taken away, and rests on the ground", () => {
  const w = world(0);
  const ceiling = reg.index.get("core:ceiling_wood")!;
  const floor = 2.5;
  // Four pieces, six metres square, two and a half metres up.
  const refs = [-1.5, 1.5].flatMap((dx) => [-1.5, 1.5].map((dz) => w.structs.add(ceiling, 60 + dx, floor, 64 + dz, 0, 0, 1)));
  for (const [id, rig] of dolls()) {
    const d = drop(rig, 60, floor + reg.halfY[ceiling]!, 64, 0.4, id === "strider" ? 1 : 0.8);
    expect([id, rest(d, w, 3) > 0, d.deepest(w) < 0.01]).toEqual([id, true, true]);
    const high = d.x[1]!;
    expect(high).toBeGreaterThan(floor);
    for (const ref of refs) w.structs.remove(ref);
    expect(d.step(w, STEP)).toBe(true);
    expect([id, rest(d, w, 4) > 0, d.deepest(w) < 0.01, d.x[1]! < 1]).toEqual([id, true, true, true]);
    refs.splice(0, 4, ...[-1.5, 1.5].flatMap((dx) => [-1.5, 1.5].map((dz) => w.structs.add(ceiling, 60 + dx, floor, 64 + dz, 0, 0, 1))));
  }
});

test("a ragdoll lies on a ramp, on the slope of a pitched roof and across its ridge, not through them to the ground", () => {
  const w = world(0);
  // A ramp rising a third toward +Z (18 degrees), its top 0.2 m over its middle line; a roof of 32 degrees, 2.75 m high at its
  // ridge along X.
  w.structs.add(reg.index.get(slopeKind("ramp"))!, 60, 1.5, 64, 0, 0, 1);
  w.structs.add(reg.index.get(slopeKind("roof"))!, 90, 1.375, 64, 0, 0, 1);
  const ramp = (x: number, z: number): number => (Math.abs(x - 60) < 2 && Math.abs(z - 64) < 3 ? 1.7 + (z - 64) / 3 : -Infinity);
  const roof = (x: number, z: number): number => (Math.abs(x - 90) < 4 && Math.abs(z - 64) < 4 ? 2.75 - (Math.abs(z - 64) * 2.5) / 4 : -Infinity);
  const above = (d: Ragdoll, on: (x: number, z: number) => number): boolean => Array.from({ length: d.n }, (_, i) => d.x[i * 3 + 1]! > on(d.x[i * 3]!, d.x[i * 3 + 2]!)).every((b) => b);
  for (const [id, rig] of dolls()) {
    const size = id === "strider" ? 1 : 0.8;
    for (const yaw of [0.4, 1.4, 2.4]) {
      // On the ramp it rests within the 3 s a slope of terrain gives it.
      const d = drop(rig, 60, ramp(60, 64.5), 64.5, yaw, size);
      expect([id, yaw, rest(d, w, 3) > 0, d.deepest(w) < 0.01, above(d, ramp)]).toEqual([id, yaw, true, true, true]);
      // Dropped onto the roof from over its ridge, so that no limb starts under it. A round body may still be creeping, as on
      // terrain as steep, but it is on the roof.
      for (const z of [65.5, 64]) {
        const r = drop(rig, 90, roof(90, 64) + 0.2, z, yaw, size);
        rest(r, w, 3);
        expect([id, yaw, z, r.deepest(w) < 0.01, above(r, roof)]).toEqual([id, yaw, z, true, true]);
      }
    }
  }
});

test("a body whose weight lies outside where it touches tips over at once, and one balanced within it stays", () => {
  // A capsule laid on flat ground tilted onto one end, its middle 0.29 m or 0.06 m beside where that end touches.
  const tip = (half: number, radius: number): [number, number] => {
    const rig = buildRig({ id: "t:rod", skeleton: "t:rod", rest: [0, 0, 0], names: ["rod"], parent: [-1], caps: [0, 1, -half, 0, 0, half, 0, 0, radius], ragdoll: { limp: 0, bodies: [{ bone: 0, mass: 1, swing: 0, twist: 0 }] } }, { clips: [], index: new Map(), hash: 0 })!;
    const w = world(0);
    const pose = new Solved(1);
    pose.rot.set([0, 0, Math.sin(0.15), Math.cos(0.15)]);
    const d = new Ragdoll(rig, rig.ragdoll!);
    d.start(pose, pose, 60, w.hf.heightAt(60, 64) + radius + half * Math.sin(0.3), 64, 0, 1);
    const at = rest(d, w, 3);
    return [at, (2 * Math.asin(Math.abs(d.q[2]!))) / DEG];
  };
  const [fell, flat] = tip(0.3, 0.1);
  expect(fell).toBeLessThan(1);
  expect(flat).toBeLessThan(1);
  const [held, tilted] = tip(0.06, 0.15);
  expect(held).toBeLessThan(0.6);
  expect(tilted).toBeGreaterThan(15);
});

test("a hit capsule, and so a ragdoll's body, fits the body and not its loose cards, unless cards are all its zone has", () => {
  // The tube's upper bone holds the quarter above its middle in one material and its top quarter in the other.
  const dir = mkdtempSync(join(tmpdir(), "snark-ragdoll-"));
  try {
    const glb = join(dir, "tube.glb");
    writeFileSync(glb, tubeGlb());
    const top = (cards: readonly string[]): number => {
      const spec: CreatureAsset = {
        kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "tube", root: "lower" }, sockets: [], clips: [], feet: [], gaits: {}, regions: [],
        zones: [{ zone: "torso", on: "upper", covers: ["upper"] }],
        materials: { hide: { base: "tex/base.png", cutout: cards.includes("hide") }, horn: { base: "tex/base.png", cutout: cards.includes("horn") } },
        budgets: { triangles: [512] },
      };
      const caps = convertCreature(readGltf(glb), TUBE, spec).rig.caps!;
      // Its highest point above the upper bone's joint, halfway up the tube.
      return Math.max(caps[3]!, caps[6]!) + caps[8]!;
    };
    expect(top([])).toBeGreaterThan(0.9);
    expect(top(["horn"])).toBeLessThan(0.65);
    expect(top(["hide", "horn"])).toBeCloseTo(top([]), 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same fall gives the same rest, to the bit", () => {
  const w = world(0.2);
  const [, rig] = dolls()[0]!;
  const a = drop(rig, 50, w.hf.heightAt(50, 50), 50, 2);
  const b = drop(rig, 50, w.hf.heightAt(50, 50), 50, 2);
  rest(a, w, 3);
  rest(b, w, 3);
  expect(Array.from(a.x)).toEqual(Array.from(b.x));
  expect(Array.from(a.q)).toEqual(Array.from(b.q));
});

test("a client draws a dead creature's body where it lies: one it saw die plays its clip and goes limp at its asset's frame, one come upon is laid to rest at once, and one that only left makes none", () => {
  const view = provingView(64, 36);
  const { scene, remote, hf } = view;
  const ch = scene.characters as unknown as { dead: { list: Corpse[] } };
  const kind = reg.index.get("core:raptor")!;
  const cam = new Camera();
  [cam.x, cam.z] = [240, 236];
  cam.y = hf.heightAt(cam.x, cam.z) + 2;
  const put = (n: number, id: number, x: number, z: number, cue = 0): void => {
    [remote.id[n], remote.kind[n], remote.x[n], remote.z[n], remote.yaw[n], remote.flags[n], remote.cue[n], remote.span[n], remote.grown[n]] = [id, kind, x, z, 0.5, 1, cue, 0, 0];
    remote.y[n] = hf.heightAt(x, z);
    remote.anim[n] = new AnimState().pack();
  };
  const died = new Map<number, number>();
  remote.died = died;
  let tick = 500;
  const frame = (): void => {
    remote.tick = tick;
    scene.build(cam, remote);
    tick += 0.5;
  };
  // Sorted by id, as a view is: one near that will leave the view, one 200 m off that will die, and a body that has lain
  // there since before this client came.
  put(0, 11, 250, 250);
  put(1, 12, 440, 250);
  put(2, 14, 246, 252, CUE_DEAD);
  remote.count = 3;
  frame();
  frame();
  const old = ch.dead.list.find((c) => c.id === 14)!;
  expect([old.watched, old.settling, old.fall!.still]).toEqual([false, false, true]);
  // The far one dies, as the snapshot drawn now says: its entity goes and its body's comes where it stood.
  died.set(12, tick);
  put(1, 13, 440, 250, CUE_DEAD);
  put(2, 14, 246, 252, CUE_DEAD);
  frame();
  // The near one only leaves: no body.
  put(0, 13, 440, 250, CUE_DEAD);
  put(1, 14, 246, 252, CUE_DEAD);
  remote.count = 2;
  frame();
  expect(ch.dead.list.map((c) => [c.id, c.watched])).toEqual([[14, false], [13, true]]);
  // It plays its death clip and goes limp at the frame its asset gives: drawn on that frame, it is the clip's pose.
  const rig = rigs.get("core:raptor")!;
  const corpse = ch.dead.list.find((c) => c.id === 13)!;
  while (!corpse.limp) frame();
  const clip = dying(rig, rig.ragdoll!.limp);
  let off = 0;
  for (let k = 0; k < clip.pos.length; k++) off = Math.max(off, Math.abs(clip.pos[k]! - corpse.solved.pos[k]!));
  expect(off).toBeLessThan(1e-5);
  for (let f = 0; f < 3 * 60 && !corpse.fall!.still; f++) frame();
  expect(corpse.fall!.ragdoll.awake).toBe(false);
  // A body no longer sent is forgotten.
  remote.count = 1;
  frame();
  expect(ch.dead.list.map((c) => c.id)).toEqual([13]);
});

test("a body lies the same, to the bit, for a client that saw it fall, one that came later, and the server that judges blows on it", () => {
  const view = provingView(64, 36);
  const { hf, structs, nodes } = view;
  const world = { hf, structs, nodes: nodes.store };
  const anims = creatureAnims(reg, (d) => rigs.get(d.mesh));
  for (const [id, x, z, yaw, out] of [["core:raptor", 252.3, 247.1, 2.2, false], ["core:dodo", 247.9, 251.4, 4.1, false], ["core:parasaur", 244.2, 255.8, 0.7, true]] as const) {
    const kind = reg.index.get(id)!;
    const sample = (alive: boolean, tick: number): RemoteSample => {
      const r = new RemoteSample();
      r.count = 1;
      [r.id[0], r.kind[0], r.x[0], r.y[0], r.z[0], r.yaw[0], r.flags[0]] = [alive ? 20 : 21, kind, x, hf.heightAt(x, z), z, yaw, 1];
      r.cue[0] = (alive ? 0 : CUE_DEAD) | (out ? CUE_OUT : 0);
      r.anim[0] = new AnimState().pack();
      r.tick = tick;
      if (!alive) r.died = new Map([[20, Math.floor(tick)]]);
      return r;
    };
    // One client watches it die and fall, a frame each sixtieth of a second; the other comes upon it ten seconds on.
    const saw = new Corpses(anims);
    let tick = 300;
    saw.update(sample(true, tick), world, x, z, new Map());
    for (let f = 0; f < 12 * 60; f++) saw.update(sample(false, (tick += 0.5)), world, x, z, new Map());
    const came = new Corpses(anims);
    came.update(sample(false, tick), world, x, z, new Map());
    const [a, b] = [saw.list[0]!, came.list[0]!];
    expect([id, a.watched, b.watched, a.fall!.still, b.fall!.still]).toEqual([id, true, false, true, true]);
    expect([id, Array.from(a.solved.pos), Array.from(a.solved.rot)]).toEqual([id, Array.from(b.solved.pos), Array.from(b.solved.rot)]);
    // The server lays it from what it sends and steps it a tick at a time, as the server's Corpses does.
    const pose = new Solved(rigs.get(id)!.bones);
    const fall = new Fall(layCorpse(anims[kind]!, out, wireX(x), wireY(hf.heightAt(x, z)), wireX(z), wireYaw(yaw), 1, pose)!);
    while (!fall.still) fall.tick(world);
    fall.ragdoll.pose(pose);
    expect([id, Array.from(pose.pos), Array.from(pose.rot)]).toEqual([id, Array.from(b.solved.pos), Array.from(b.solved.rot)]);
  }
});

test("a body sent falling is drawn where each sample has it, is not landed by a sample blended between two snapshots, and lies where it is sent lying still, as one come upon later lies", () => {
  const view = provingView(64, 36);
  const { hf, structs, nodes } = view;
  const world = { hf, structs, nodes: nodes.store };
  const anims = creatureAnims(reg, (d) => rigs.get(d.mesh));
  const kind = reg.index.get("core:raptor")!;
  // As the wire carries them, as the server sends a body that lies.
  const [x, z, yaw] = [wireX(251.7), wireX(248.3), 1.3];
  const ground = wireY(hf.heightAt(x, z));
  /** One entity: the creature alive at `y`, or its body at `y` with the pose word `anim`. */
  const sample = (alive: boolean, tick: number, y: number, anim: number): RemoteSample => {
    const r = new RemoteSample();
    r.count = 1;
    [r.id[0], r.kind[0], r.x[0], r.y[0], r.z[0], r.yaw[0], r.flags[0]] = [alive ? 20 : 21, kind, x, y, z, yaw, 1];
    r.cue[0] = alive ? 0 : CUE_DEAD;
    r.anim[0] = anim;
    r.tick = tick;
    if (!alive) r.died = new Map([[20, 300]]);
    return r;
  };
  const saw = new Corpses(anims);
  let tick = 300;
  const st = new AnimState();
  st.grounded = false;
  saw.update(sample(true, tick, ground + 40, st.pack()), world, x, z, new Map());
  // Sixty frames of falling, 20 m in all, then two frames blended between the last snapshot falling and the first lying,
  // drawn at one moment: still, but at no place the wire carries.
  let y = ground + 40;
  for (let f = 0; f < 60; f++) {
    y -= 1 / 3;
    saw.update(sample(false, (tick += 0.5), y, FALLING), world, x, z, new Map());
  }
  const c = saw.list[0]!;
  expect([c.watched, c.falling, c.limp, c.y]).toEqual([true, true, false, Math.fround(y)]);
  for (let f = 0; f < 2; f++) saw.update(sample(false, tick, ground + 1 / 3, 0), world, x, z, new Map());
  expect([c.falling, c.limp]).toEqual([true, false]);
  // Lying still at a place the wire carries: the first sample there could still be a blend, the second is not.
  saw.update(sample(false, (tick += 0.5), ground, 0), world, x, z, new Map());
  expect(c.falling).toBe(true);
  saw.update(sample(false, (tick += 0.5), ground, 0), world, x, z, new Map());
  expect([c.falling, c.landed, c.x, c.y, c.z]).toEqual([false, Math.floor(tick), wireX(x), ground, wireX(z)]);
  for (let f = 0; f < 12 * 60; f++) saw.update(sample(false, (tick += 0.5), ground, 0), world, x, z, new Map());
  // One that came upon it falling holds it limp where it is sent, and lays it to rest at once where it lands.
  const came = new Corpses(anims);
  came.update(sample(false, tick, ground + 7, FALLING), world, x, z, new Map());
  const d = came.list[0]!;
  expect([d.watched, d.falling, d.limp, d.y]).toEqual([false, true, false, Math.fround(ground + 7)]);
  came.update(sample(false, (tick += 0.5), ground, 0), world, x, z, new Map());
  came.update(sample(false, (tick += 0.5), ground, 0), world, x, z, new Map());
  expect([c.fall!.still, d.falling, d.fall!.still]).toEqual([true, false, true]);
  expect([Array.from(c.solved.pos), Array.from(c.solved.rot)]).toEqual([Array.from(d.solved.pos), Array.from(d.solved.rot)]);
  const pose = new Solved(rigs.get("core:raptor")!.bones);
  const fall = new Fall(layCorpse(anims[kind]!, false, wireX(x), ground, wireX(z), wireYaw(yaw), 1, pose)!);
  while (!fall.still) fall.tick(world);
  fall.ragdoll.pose(pose);
  expect([Array.from(pose.pos), Array.from(pose.rot)]).toEqual([Array.from(d.solved.pos), Array.from(d.solved.rot)]);
});
