// What drawn faces add to a crowd's frame, from the packet alone (no GPU): draws, triangles, bones, heads made and the
// time a head takes to make. The people bench's 40-body crowd (client/core/people-crowd.ts, 8 to 25 m) and a close one
// of 40 at 2.5 to 10 m, each in one shared look and in looks of their own, and the close one all in long hair, on each
// tier asked; then the time sixteen long-haired bodies' guides take a frame (hair-motion.ts).
//   bun tools/bench/faces.ts [--tiers medium,high]

import { tierOf } from "../../client/core/assets/tiers.ts";
import { BONE_FLOATS, DRAW_SKINNED, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { HAIR_ROW, HAIR_ROWS, HairMotion } from "../../client/core/render/hair-motion.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_NECK, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatAxis, quatNormalize } from "../../shared/math/quat.ts";
import { CROWD_VIEWER, crowdLooks, crowdSpots, type CrowdScene } from "../../client/core/people-crowd.ts";
import { FACE_COUNT, HAIR_STYLES, LOOK_BYTES, LOOK_HAIR, setFace } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { provingView, settle } from "../snap.ts";
import { gameFiles } from "../snap/files.ts";

const args = process.argv.slice(2);
const tiers = (args[args.indexOf("--tiers") + 1] && args.includes("--tiers") ? args[args.indexOf("--tiers") + 1]! : "medium,high").split(",");
const files = await gameFiles();

/** A crowd's frame, measured: one look for all, or one each, with neutral faces or faces at the survivors' spread. */
function measure(tier: string, scene: CrowdScene, close: boolean, unique: boolean, faced: boolean, long = false): string {
  const view = provingView(1920, 1080, {}, files);
  view.scene.assets.tier = tierOf(tier);
  view.scene.viewHeight = 1080;
  const { cam, remote, reg, hf } = view;
  cam.x = CROWD_VIEWER.x;
  cam.z = CROWD_VIEWER.z;
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  cam.yaw = CROWD_VIEWER.yaw;
  cam.pitch = -0.04;
  const spots = crowdSpots(scene);
  const looks = crowdLooks(spots.length, unique ? "unique" : "shared");
  const rng = new Rng(5);
  const kind = reg.index.get("core:survivor")!;
  remote.count = spots.length;
  spots.forEach((s, n) => {
    // The close crowd stands at a third of the distance, 2.5 to 10 m.
    const k = close ? 0.36 : 1;
    remote.id[n] = 0x40000000 + n;
    remote.kind[n] = kind;
    remote.x[n] = cam.x + (s.x - cam.x) * k;
    remote.z[n] = cam.z + (s.z - cam.z) * k;
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.yaw[n] = s.yaw;
    remote.flags[n] = 1;
    remote.anim[n] = 0;
    remote.hasLook[n] = 1;
    const look = looks[n]!.slice(0, LOOK_BYTES);
    for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, faced ? ((rng.float() + rng.float()) - 1) * 0.6 : 0);
    if (long) look[LOOK_HAIR] = HAIR_STYLES.findIndex((h) => h.id === "long");
    remote.look.set(look, n * LOOK_BYTES);
  });
  view.scene.own = null;
  settle(view);
  const faces = view.scene.characters.faces;
  // Long enough for every wanted head to be made, one a frame.
  const t0 = performance.now();
  for (let k = 0; k < 40; k++) view.scene.build(cam, remote);
  const p = view.scene.build(cam, remote);
  const ms = performance.now() - t0;
  let bodyDraws = 0, bodyTris = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    bodyDraws++;
    bodyTris += (p.drawIndexCount[d]! > 0 ? p.drawIndexCount[d]! / 3 : view.scene.assets.table.tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]!;
  }
  return `${tier.padEnd(7)} ${(close ? "close" : scene).padEnd(6)} ${(unique ? "own looks" : "one look").padEnd(9)} ${(faced ? "own faces" : "neutral").padEnd(9)} ${long ? "long" : "    "} draws ${String(p.drawCount).padStart(5)} body draws ${String(bodyDraws).padStart(4)} body k tris ${(bodyTris / 1000).toFixed(0).padStart(4)} bones ${String(p.boneCount).padStart(5)} faced ${String(view.scene.characters.faced).padStart(2)} groomed ${String(view.scene.characters.groomed).padStart(2)} heads ${String(faces.count).padStart(2)} made ${String(faces.makes).padStart(2)} 41 frames ${ms.toFixed(0)} ms`;
}

for (const tier of tiers) {
  for (const close of [false, true]) for (const [unique, faced] of [[false, false], [true, false], [true, true]] as const) console.log(measure(tier, "near", close, unique, faced));
  console.log(measure(tier, "near", true, true, true, true));
}

// Sixteen groomed bodies' guide rows, each its head turned and nodding its own way, stepped a frame at a time.
{
  const motion = new HairMotion(), pose = new Pose(HUMAN_BONES);
  const bodies = Array.from({ length: 16 }, (_, k) => {
    const solved = new Solved(HUMAN_BONES), bones = new Float32Array((HAIR_ROW + HAIR_ROWS) * BONE_FLOATS);
    quatAxis(pose.rot, B_NECK * 4, 0.6 * Math.sin(k), 0.8, 0.2 * Math.cos(k), 0.3 + 0.04 * k);
    quatNormalize(pose.rot, B_NECK * 4);
    solve(HUMAN, pose, solved);
    writeBones(bones, 0, solved, HUMAN.rest, null, k, 0, 0, 0.3 * k);
    return { solved, bones };
  });
  const frames: number[] = [];
  for (let f = 0; f < 3000; f++) {
    const t0 = performance.now();
    for (let k = 0; k < 16; k++) motion.rows(bodies[k]!.bones, 0, HUMAN.rest, bodies[k]!.solved, 900 + k, f * 0.5, 30, f * 0.01, 0, 0);
    if (f >= 1000) frames.push(performance.now() - t0);
  }
  frames.sort((a, b) => a - b);
  console.log(`sixteen groomed bodies' guides: median ${(frames[frames.length >> 1]! * 1000).toFixed(1)} µs a frame, 99th ${(frames[Math.floor(frames.length * 0.99)]! * 1000).toFixed(1)} µs`);
}

// The time one head takes to make: a new face asked for each frame, made at the next frame's start.
{
  const view = provingView(320, 180, {}, files);
  view.scene.assets.tier = tierOf("ultra");
  const { cam, remote, reg, hf } = view;
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.flags[0], remote.anim[0], remote.hasLook[0], remote.yaw[0]] = [0x40000000, reg.index.get("core:survivor")!, 1, 0, 1, Math.PI];
  [remote.x[0], remote.z[0]] = [cam.x, cam.z - 1.5];
  remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  cam.yaw = Math.PI;
  view.scene.own = null;
  settle(view);
  const faces = view.scene.characters.faces, rng = new Rng(2), times: number[] = [];
  for (let k = 0; k < 60; k++) {
    for (let f = 0; f < FACE_COUNT; f++) setFace(remote.look, f, rng.range(-0.6, 0.6));
    const was = faces.makes, t0 = performance.now();
    view.scene.build(cam, remote);
    const t = performance.now() - t0;
    if (faces.makes > was && k > 10) times.push(t);
  }
  const base: number[] = [];
  for (let k = 0; k < 40; k++) {
    const t0 = performance.now();
    view.scene.build(cam, remote);
    base.push(performance.now() - t0);
  }
  const mid = (a: number[]): number => a.sort((x, y) => x - y)[a.length >> 1] ?? NaN;
  console.log(`a frame that makes a head: median ${mid(times).toFixed(2)} ms over ${times.length}; a frame that makes none: ${mid(base).toFixed(2)} ms`);
}
process.exit(0);
