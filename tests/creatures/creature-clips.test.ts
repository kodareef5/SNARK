// A creature's clips come with its species and not in the boot pack. One met before they have come is drawn at once,
// standing at rest, and from the frame they come is posed as a client that had every clip from the first poses it.

import { expect } from "bun:test";
import { BONE_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const FLYER = "core:pteranodon";
const WALKER = "core:dodo";
/** Frames a tenth of a second apart, and the link's latency. */
const FRAME_MS = 100;
const LATENCY_MS = 250;

/** The pteranodon hovering ahead of the camera, and from frame `walkFrom` on a dodo walking past it, on frame `k`. */
function bodies(v: ProvingView, k: number, walkFrom: number): void {
  const { remote, cam, hf, reg } = v;
  remote.count = 2;
  remote.tick = (k * FRAME_MS * 30) / 1000;
  const st = new AnimState();
  const put = (id: number, kind: string, x: number, y: number, z: number, flags: number): void => {
    const n = remote.count++;
    [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n], remote.anim[n]] = [id, reg.index.get(kind)!, x, y, z, 0.3, flags, st.pack()];
  };
  st.mode = MODE_FLYER;
  st.speed = 3;
  put(103, FLYER, cam.x - 1.5, hf.heightAt(cam.x, cam.z) + 4, cam.z + 7, 0);
  if (k < walkFrom) return;
  st.mode = new AnimState().mode;
  st.speed = 2;
  const z = cam.z + 4 + k * 0.12;
  put(104, WALKER, cam.x + 1.5, hf.heightAt(cam.x + 1.5, z), z, 1);
}

function frame(v: ProvingView, k: number, walkFrom: number): FramePacket {
  v.scene.now = k * FRAME_MS;
  v.port?.advance(v.scene.now);
  bodies(v, k, walkFrom);
  return v.scene.build(v.cam, v.remote);
}

const rows = (p: FramePacket): Float32Array => p.bones.slice(0, p.boneCount * BONE_FLOATS);

/** Whether the bones of `p` hold the rows of `kind`'s rig standing at rest where body `n` of `v` is. */
function atRest(v: ProvingView, p: FramePacket, n: number): boolean {
  const rig = v.scene.characters.creature(v.remote.kind[n]!)!.rig;
  const solved = new Solved(rig.bones);
  solve(rig, new Pose(rig.bones), solved);
  const want = new Float32Array(rig.bones * BONE_FLOATS);
  writeBones(want, 0, solved, rig.rest, null, v.remote.x[n]! - p.camX, v.remote.y[n]! - p.camY, v.remote.z[n]! - p.camZ, v.remote.yaw[n]!);
  const got = rows(p);
  for (let at = 0; at + want.length <= got.length; at += BONE_FLOATS) if (want.every((x, i) => x === got[at + i])) return true;
  return false;
}

test("a creature met before its clips have come is drawn at rest, and once they come is posed as a client that had them all along", () => {
  const stream = provingView(64, 36, { latencyMs: LATENCY_MS });
  const assets = stream.scene.assets;
  // Neither creature's clips are in the boot pack: each is a part of its own.
  const parts = [FLYER, WALKER].map((id) => assets.table.skeletons.get(id)!);
  expect(parts.every((c) => c >= 0 && assets.clips(c) === null)).toBe(true);
  const drawnOn = (p: FramePacket): string[] => [...new Set(Array.from({ length: p.drawCount }, (_, d) => assets.table.skeleton[p.drawMesh[d]!]!))].filter((s) => s === "pteranodon" || s === "dodo").sort();
  const seen: Float32Array[] = [];
  let came = -1;
  for (let k = 0; k <= 30; k++) {
    const p = frame(stream, k, 0);
    seen.push(rows(p));
    if (came < 0 && parts.every((c) => assets.clips(c) !== null)) came = k;
    // Both are drawn from the first frame, as the boot pack has their coarsest levels, and stand at rest until their clips come.
    expect(drawnOn(p)).toEqual(["dodo", "pteranodon"]);
    if (came < 0) expect([atRest(stream, p, 2), atRest(stream, p, 3)]).toEqual([true, true]);
  }
  // They were asked for in the frame the two were first drawn, and came the first frame the link's latency allowed.
  expect(came).toBe(Math.ceil(LATENCY_MS / FRAME_MS));

  // From then on every bone is where a client with every clip in its pack puts it. The pteranodon it has drawn from the
  // first frame; the dodo, which walked through the gap, takes up its gait where the server has it, as one first met
  // then does.
  const today = provingView(64, 36);
  for (let k = 0; k <= 30; k++) {
    const p = frame(today, k, came);
    if (k >= came) expect(rows(p)).toEqual(seen[k]!);
    else expect(atRest(today, p, 2)).toBe(false);
  }
});
