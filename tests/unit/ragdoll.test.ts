// A body that dies goes limp (shared/anim/ragdoll.ts, client/core/ragdoll.ts): from its death clip with no jump, to rest
// on a slope within three seconds with no joint past its limit and nothing under the ground or inside a structure,
// falling again when the floor it lies on is taken away, the same every time. A client finds a death as a creature
// leaving its view while near, and a creature leaving from far off, or a whole view emptying, is no death.
import { expect, test } from "bun:test";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRigs, type Rig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { provingView } from "../../tools/snap.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { corePack } from "../fixtures/pack.ts";
import { strider } from "../fixtures/strider.ts";

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
  sampleClip(rig.death!, frame, pose);
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

test("a client sees a creature that dies near it fall and lie, and nothing of one that leaves from far off or of a view that empties", () => {
  const view = provingView(64, 36);
  const { scene, remote, hf } = view;
  const ch = scene.characters as unknown as { dead: { list: { solved: Solved; ragdoll: Ragdoll | null }[] } };
  const kind = reg.index.get("core:raptor")!;
  const cam = new Camera();
  [cam.x, cam.z] = [240, 236];
  cam.y = hf.heightAt(cam.x, cam.z) + 2;
  const put = (n: number, id: number, x: number, z: number): void => {
    [remote.id[n], remote.kind[n], remote.x[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [id, kind, x, z, 0.5, 1];
    remote.y[n] = hf.heightAt(x, z);
    const st = new AnimState();
    remote.anim[n] = st.pack();
  };
  let tick = 500;
  const frame = (): void => {
    remote.tick = tick;
    scene.build(cam, remote);
    tick += 0.5;
  };
  // Two near and one 200 m off, sorted by id as a view is.
  put(0, 10, 245, 250);
  put(1, 11, 250, 250);
  put(2, 12, 440, 250);
  remote.count = 3;
  frame();
  frame();
  // The far one leaves: no corpse.
  remote.count = 2;
  frame();
  expect(ch.dead.list.length).toBe(0);
  // One near one dies: it plays its death clip and goes limp at the frame its asset gives.
  remote.count = 1;
  frame();
  expect(ch.dead.list.length).toBe(1);
  const rig = rigs.get("core:raptor")!;
  const corpse = ch.dead.list[0]!;
  while (!corpse.ragdoll) frame();
  // Drawn on the frame it goes limp, it is the death clip's pose at that frame.
  const clip = dying(rig, rig.ragdoll!.limp);
  let off = 0;
  for (let k = 0; k < clip.pos.length; k++) off = Math.max(off, Math.abs(clip.pos[k]! - corpse.solved.pos[k]!));
  expect(off).toBeLessThan(1e-5);
  for (let f = 0; f < 3 * 60 && corpse.ragdoll.awake; f++) frame();
  expect(corpse.ragdoll.awake).toBe(false);
  // A viewer moved 40 m in a frame, as on a respawn, its view emptying, makes no corpse of the creature it left.
  cam.x += 40;
  remote.count = 0;
  frame();
  expect(ch.dead.list.length).toBe(1);
});
