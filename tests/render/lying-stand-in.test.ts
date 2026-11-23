// A survivor drawn on one bone, as a frame short of bones draws the farthest, lies down when it is down: toppled by the
// server past the fall budget, or knocked down as a ragdoll whose checkpoint has not come. Every body toppled one way
// shares one lying pose, so the one bone still saves what it saves for standing bodies.
import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { B_HEAD, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, CUE_DOWN } from "../../shared/anim/pose.ts";
import { packReact, REACT_FALL, REACT_HIPS } from "../../shared/anim/reactions.ts";
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

/** Draws survivor `id` on one bone at the origin into `p`. */
function oneBone(characters: Characters, p: FramePacket, st: AnimState, tick: number, id: number): void {
  expect(characters.add(p, survivor, 0, 0, 0, 0, st, tick, null, 0, colors, 0, null, 0, id, false, false, 1, true)).toBe(true);
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
