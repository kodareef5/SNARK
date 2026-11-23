// A survivor drawn on one bone, as a frame short of bones draws the farthest, lies down when it is down: toppled by the
// server past the fall budget, or knocked down as a ragdoll whose checkpoint has not come. Every body toppled one way
// shares one lying pose, so the one bone still saves what it saves for standing bodies.
import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { layHuman } from "../../shared/anim/human-fall.ts";
import type { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { wireX, wireY } from "../../shared/anim/corpse.ts";
import { makeHandle } from "../../shared/ids.ts";
import { encodeCorpseCheckpoint, type CorpseMotion } from "../../shared/net/corpse.ts";
import { B_HEAD, B_HIPS, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, CUE_DOWN } from "../../shared/anim/pose.ts";
import { packLie, packReact, REACT_FALL, REACT_HIPS, REACT_RISE } from "../../shared/anim/reactions.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = frozenPack(), reg = coreRegistry(), survivor = reg.index.get("core:survivor")!;
const rest = Float32Array.from(pack.header.rigs.find((r) => r.id === "human_m")!.rest);
const colors = new Uint8Array(64);

function flat() {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}

/** Draws survivor `id` on one bone into `p`, where its body is, at the origin unless said. */
function oneBone(characters: Characters, p: FramePacket, st: AnimState, tick: number, id: number, x = 0, y = 0, z = 0): void {
  expect(characters.add(p, survivor, x, y, z, 0, st, tick, null, 0, colors, 0, null, 0, id, false, false, 1, true)).toBe(true);
}

/** The height of the head's joint in the pose at bone `first` of `p`: where the head's bone carries its rest point. */
function head(p: FramePacket, first: number): number {
  const o = (first + B_HEAD) * BONE_FLOATS, b = p.bones, at = B_HEAD * 3;
  return b[o + 4]! * rest[at]! + b[o + 5]! * rest[at + 1]! + b[o + 6]! * rest[at + 2]! + b[o + 7]!;
}

test("on one bone a toppled survivor, or one whose fall has not come, is drawn lying", () => {
  const characters = new Characters(reg, pack, new Assets(reg, pack));
  const toppled = new AnimState();
  toppled.react = packReact(REACT_FALL, 70, 5, REACT_HIPS, 2);
  characters.begin();
  let p = new FramePacket();
  oneBone(characters, p, new AnimState(), 100, 7);
  // A fresh packet holds the shared pose first, then each body's one bone.
  expect(head(p, 0)).toBeGreaterThan(1.3);
  characters.begin();
  p = new FramePacket();
  oneBone(characters, p, toppled, 100, 7);
  expect(head(p, 0)).toBeLessThan(0.5);
  // A ragdoll fall the client has seen go down, but whose checkpoint has not come.
  const remote = new RemoteSample();
  remote.count = 1; remote.tick = 100; remote.id[0] = 8; remote.gen[0] = 1; remote.kind[0] = survivor; remote.cue[0] = CUE_DOWN;
  characters.begin();
  characters.corpses(new FramePacket(), new Camera(), remote, flat());
  p = new FramePacket();
  oneBone(characters, p, new AnimState(), 115, 8);
  expect(head(p, 0)).toBeLessThan(0.5);
  // Still on one bone: the shared pose and its own.
  expect(p.boneCount).toBe(HUMAN_BONES + 1);
});

test("bodies toppled the same way share one lying pose on one bone each", () => {
  const characters = new Characters(reg, pack, new Assets(reg, pack));
  const toppled = new AnimState();
  toppled.react = packReact(REACT_FALL, 70, 5, REACT_HIPS, 2);
  characters.begin();
  const p = new FramePacket();
  for (const id of [11, 12, 13]) oneBone(characters, p, toppled, 100, id);
  oneBone(characters, p, new AnimState(), 100, 14);
  // One lying pose and one standing pose, and a bone for each body.
  expect(p.boneCount).toBe(2 * HUMAN_BONES + 4);
});

test("laid falls short of bones share one lying pose, each where its ragdoll lies", () => {
  const characters = new Characters(reg, pack, new Assets(reg, pack)), world = flat(), root = new Float64Array(3);
  const motions = new Map<number, CorpseMotion>(), remote = new RemoteSample(), falls: Ragdoll[] = [];
  remote.count = 5; remote.tick = 105;
  for (let k = 0; k < 5; k++) {
    // A ragdoll fall as the server lays and sends it: knocked down, stepped, its place carried to its hips.
    const r = layHuman(40 + k * 3, 0, 40, k * 1.3);
    r.launch(Math.sin(k) * 4, 1.5, Math.cos(k) * 4, 0, 0, 0);
    for (let f = 0; f < 45; f++) r.step(world, 1 / 30);
    r.rootPosition(root);
    const x = wireX(root[0]!), y = wireY(root[1]!), z = wireX(root[2]!);
    r.rebase(x, y, z);
    motions.set(makeHandle(20 + k, 1), { revision: 1, tick: 100, data: encodeCorpseCheckpoint({ x, y, z, yaw: k * 1.3, size: 1, out: false, air: false, awake: r.awake, standing: true, ticks: 45, state: r.checkpoint() }) });
    remote.id[k] = 20 + k; remote.gen[k] = 1; remote.kind[k] = survivor; remote.cue[k] = CUE_DOWN;
    remote.x[k] = x; remote.y[k] = y; remote.z[k] = z;
    falls.push(r);
  }
  characters.corpseMotions = motions;
  characters.begin();
  characters.corpses(new FramePacket(), new Camera(), remote, world);
  for (let k = 0; k < 5; k++) expect(characters.humanFall(20 + k)?.down).toBe(true);
  // The scene's plan for a frame short of bones: each on one bone, beside the poses they stand in.
  characters.begin();
  const st = new AnimState();
  st.cue = CUE_DOWN;
  let planned = 0;
  for (let k = 0; k < 5; k++) planned += 1 + characters.standInBones(survivor, null, 0, st, false, false, 0, null, 0, 20 + k, 105);
  const p = new FramePacket();
  p.tier = { ...p.tier, bones: planned };
  // A shared pose is written where the first body that lies in it is, before that body's own bone.
  const own: number[] = [], blocks: number[] = [];
  for (let k = 0; k < 5; k++) {
    const before = p.boneCount;
    oneBone(characters, p, st, 105, 20 + k, remote.x[k]!, remote.y[k]!, remote.z[k]!);
    if (p.boneCount - before > 1) blocks.push(before);
    own.push(p.boneCount - 1);
  }
  expect([p.boneCount, p.dropped]).toEqual([planned, 0]);
  expect(planned).toBeLessThanOrEqual(2 * HUMAN_BONES + 5);
  // Each lies with its hips on its ragdoll's and its head the way its ragdoll's lies: a shared pose's joints, carried by
  // the body's own bone.
  const b = p.bones;
  /** Where joint `bone` of the shared pose at bone `block`, carried by the body bone at `own`, is in the world. */
  const joint = (block: number, bone: number, own: number): number[] => {
    const o = (block + bone) * BONE_FLOATS, r = bone * 3, m = own * BONE_FLOATS;
    const q = [0, 1, 2].map((row) => b[o + row * 4]! * rest[r]! + b[o + row * 4 + 1]! * rest[r + 1]! + b[o + row * 4 + 2]! * rest[r + 2]! + b[o + row * 4 + 3]!);
    return [0, 1, 2].map((row) => b[m + row * 4]! * q[0]! + b[m + row * 4 + 1]! * q[1]! + b[m + row * 4 + 2]! * q[2]! + b[m + row * 4 + 3]!);
  };
  for (let k = 0; k < 5; k++) {
    const h = characters.humanFall(20 + k)!, s = h.solved, c = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const at = (bone: number): number[] => [h.x + c * s.pos[bone * 3]! + sn * s.pos[bone * 3 + 2]!, h.y + s.pos[bone * 3 + 1]!, h.z - sn * s.pos[bone * 3]! + c * s.pos[bone * 3 + 2]!];
    const hips = at(B_HIPS), head = at(B_HEAD), way = [head[0]! - hips[0]!, head[2]! - hips[2]!];
    let best = Infinity, along = -1;
    for (const block of blocks) {
      const dh = joint(block, B_HIPS, own[k]!), dd = joint(block, B_HEAD, own[k]!);
      const off = Math.hypot(dh[0]! - hips[0]!, dh[1]! - hips[1]!, dh[2]! - hips[2]!);
      if (off >= best) continue;
      best = off;
      const w = [dd[0]! - dh[0]!, dd[2]! - dh[2]!];
      along = (w[0]! * way[0]! + w[1]! * way[1]!) / (Math.hypot(w[0]!, w[1]!) * Math.hypot(way[0]!, way[1]!));
    }
    expect(best, `${k}`).toBeLessThan(0.02);
    expect(along, `${k}`).toBeGreaterThan(0.95);
  }
});

test("poses kept for bodies going down or getting up stay few however they lie and go", () => {
  const characters = new Characters(reg, pack, new Assets(reg, pack)), st = new AnimState();
  // Every way a body can lie and every step, going at every speed and turn, standing, crouched and prone: a frame of
  // forty bodies at a time, as a crowd short of bones would be drawn.
  let drawn = 0, frames = 0;
  const words: number[] = [];
  for (let dir = 0; dir < 16; dir++) for (const up of [false, true]) for (let age = 0; age < 30; age += 2) words.push(packLie(REACT_RISE, 100 - age, up, dir * 8 + 3, 0));
  for (let k = 0; k < words.length; k += 40) {
    characters.begin();
    const p = new FramePacket();
    p.tier = { ...p.tier, bones: 1 << 20 };
    frames++;
    for (let j = k; j < Math.min(words.length, k + 40); j++) {
      st.unpack(0);
      st.react = words[j]!;
      st.speed = (j * 7) % 16;
      st.dir = (j * 5) % 16;
      st.stance = j % 3;
      oneBone(characters, p, st, 100, 1000 + j);
      drawn++;
      expect(characters.lyingKept).toBeLessThanOrEqual(256 + 40);
    }
  }
  expect(drawn).toBe(words.length);
  expect(frames).toBeGreaterThan(10);
  expect(characters.lyingKept).toBeLessThanOrEqual(256 + 40);
});
