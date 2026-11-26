// What drawn faces add to a crowd's frame, from the packet alone (no GPU): draws, triangles, bones, heads made and the
// time a head takes to make. The people bench's 40-body crowd (client/core/people-crowd.ts, 8 to 25 m) and a close one
// of 40 at 2.5 to 10 m, each in one shared look and in looks of their own, on each tier asked.
//   bun tools/bench/faces.ts [--tiers medium,high]

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_SKINNED, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { CROWD_VIEWER, crowdLooks, crowdSpots, type CrowdScene } from "../../client/core/people-crowd.ts";
import { FACE_COUNT, LOOK_BYTES, setFace } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { provingView, settle } from "../snap.ts";
import { gameFiles } from "../snap/files.ts";

const args = process.argv.slice(2);
const tiers = (args[args.indexOf("--tiers") + 1] && args.includes("--tiers") ? args[args.indexOf("--tiers") + 1]! : "medium,high").split(",");
const files = await gameFiles();

/** A crowd's frame, measured: one look for all, or one each with faces at the survivors' spread. */
function measure(tier: string, scene: CrowdScene, close: boolean, unique: boolean): string {
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
    if (unique) for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, ((rng.float() + rng.float()) - 1) * 0.6);
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
  return `${tier.padEnd(7)} ${(close ? "close" : scene).padEnd(6)} ${(unique ? "own faces" : "shared").padEnd(10)} draws ${String(p.drawCount).padStart(5)} body draws ${String(bodyDraws).padStart(4)} body k tris ${(bodyTris / 1000).toFixed(0).padStart(4)} bones ${String(p.boneCount).padStart(5)} faced ${String(view.scene.characters.faced).padStart(2)} heads ${String(faces.count).padStart(2)} made ${String(faces.makes).padStart(2)} 41 frames ${ms.toFixed(0)} ms`;
}

for (const tier of tiers) for (const close of [false, true]) for (const unique of [false, true]) console.log(measure(tier, "near", close, unique));

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
