// The limits of a view and of a frame: how many entities a view holds, how each client gets its own part of a shared list,
// what a full snapshot leaves for the next, which bodies a frame short of bones poses, and what a full frame counts as left out.

import { expect, test } from "bun:test";
import { DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, MAX_DRAWS } from "../../client/core/render/packet.ts";
import { HUMAN_BONES } from "../../shared/anim/human.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, MAX_VIEW, SentView, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { provingView } from "../../tools/snap.ts";
import { PICK_ENTITY } from "../../tools/snap/raster.ts";

function looksFor(n: number): Looks {
  return { level: new Uint16Array(n), colors: new Uint8Array(n * 6), name: new Array<string>(n).fill(""), look: new Array<Uint8Array | null>(n).fill(null), gear: new Array<Uint16Array | null>(n).fill(null), team: new Uint32Array(n), seat: new Uint32Array(n), span: new Uint32Array(n), grown: new Uint32Array(n) };
}

test("a view starts small, doubles as it fills, keeps what it held, and stops at 2,048 entities", () => {
  const v = new EntityView();
  const colors = new Uint8Array(6).fill(9);
  expect([v.id.length, v.name.length]).toEqual([256, 256]);
  for (let i = 0; i < MAX_VIEW; i++) {
    expect(v.push(i * 3, 1, 7, i, 200, 300, 5, 1, 0)).toBe(true);
    v.appear(2, i & 0xffff, colors, 0, `n${i}`, null, null);
    v.belong(i + 1, 0, 0, 0);
  }
  expect(v.push(9999, 1, 7, 0, 0, 0, 0, 0, 0)).toBe(false);
  expect([v.count, v.id.length, v.colors.length, v.name.length, v.urgent.length]).toEqual([MAX_VIEW, MAX_VIEW, MAX_VIEW * 6, MAX_VIEW, MAX_VIEW]);
  for (const i of [0, 255, 256, 1023, 2047]) expect([v.id[i], v.qx[i], v.level[i], v.colors[i * 6 + 5], v.name[i], v.team[i]]).toEqual([i * 3, i, i, 9, `n${i}`, i + 1]);
  // A copy grows the same way.
  const copy = new EntityView();
  for (let i = 0; i < 300; i++) copy.copyFrom(v, i);
  expect([copy.count, copy.id.length, copy.name[299], copy.team[299]]).toEqual([300, 512, "n299", 300]);
});

test("clients around one place share one list, and each is sent the part its cap allows: the first by rank", () => {
  const N = 600;
  const w = new BitWriter(1 << 16);
  const r = new BitReader();
  const looks = looksFor(N + 10);
  const cur = new SentView();
  for (let k = 0; k < N; k++) cur.push(10 + k, 1, 7, 1000 + k, 200, 300, 5, 1, 0);
  // Rank is the order the server chose them in, which is not the order of their ids.
  const rank = new Uint16Array(MAX_VIEW);
  const shuffle = (by: number): void => {
    for (let k = 0; k < N; k++) rank[k] = (k * 7919 + by) % N;
  };
  shuffle(0);
  const part = (limit: number, skip = -1): number[] => {
    const ids: number[] = [];
    for (let k = 0; k < N; k++) if (rank[k]! < limit && cur.id[k] !== skip) ids.push(cur.id[k]!);
    return ids;
  };
  /** Sends `cur` to a client with this cap, on top of what it holds. Returns what it then holds, on both sides. */
  const send = (limit: number, sent: SentView | null, held: EntityView | null, skip = -1): [SentView, EntityView, number] => {
    const next = new SentView();
    const got = new EntityView();
    w.reset();
    writeViewDelta(w, sent, cur, next, 1 << 24, 0, looks, skip, rank, limit);
    r.reset(w.bytes());
    expect(readViewDelta(r, held, got)).toBe(true);
    expect(Array.from(next.id.subarray(0, next.count))).toEqual(Array.from(got.id.subarray(0, got.count)));
    return [next, got, w.byteLength];
  };
  let [smallSent, small] = send(64, null, null);
  let [, wide] = send(512, null, null);
  expect([small.count, wide.count, cur.count]).toEqual([64, 512, N]);
  expect(Array.from(small.id.subarray(0, 64))).toEqual(part(64));
  expect(Array.from(wide.id.subarray(0, 512))).toEqual(part(512));
  // Nothing changed, so nothing is sent: one byte says no ops.
  let bytes = 0;
  [smallSent, small, bytes] = send(64, smallSent, small);
  expect([small.count, bytes]).toEqual([64, 1]);
  // The ranks move by one. One entity leaves the small part and one enters it.
  shuffle(1);
  const before = new Set(small.id.subarray(0, 64));
  [smallSent, small] = send(64, smallSent, small);
  expect(Array.from(small.id.subarray(0, small.count))).toEqual(part(64));
  expect(part(64).filter((id) => !before.has(id)).length).toBe(1);
  // Its own body is left out too, and a cap of 2,048 or none at all sends everything.
  const own = part(64)[3]!;
  expect(send(64, null, null, own)[1].count).toBe(63);
  expect(send(MAX_VIEW, null, null)[1].count).toBe(N);
  w.reset();
  const all = new SentView();
  writeViewDelta(w, null, cur, all, 1 << 24, 0, looks);
  expect(all.count).toBe(N);
});

test("2,048 bodies that all change their looks in one tick are sent again within the budget, players first, until the client has them all", () => {
  const N = MAX_VIEW;
  const BUDGET = 1100 * 8;
  const w = new BitWriter(16384);
  const r = new BitReader();
  const looks = looksFor(N);
  // Every sixteenth is a player, with a look, gear and a name.
  const player = (id: number): boolean => id % 16 === 0;
  for (let id = 0; id < N; id++) {
    if (!player(id)) continue;
    looks.look[id] = new Uint8Array(LOOK_BYTES);
    looks.gear[id] = new Uint16Array(GEAR_COUNT);
    looks.name[id] = `survivor ${id}`;
  }
  const scene = (rev: number): SentView => {
    const v = new SentView();
    for (let id = 0; id < N; id++) {
      // Half of them are new bodies in old slots, and the rest have changed how they look.
      v.push(id, rev === 0 || id % 2 === 0 ? 1 : 2, 7, 1000 + id, 200, 300, 5, 1, 0, rev === 0 || id % 2 !== 0 ? 0 : 1);
      v.urgent[id] = player(id) ? 1 : 0;
    }
    return v;
  };
  let sent: SentView = scene(0);
  let held = new EntityView();
  for (let id = 0; id < N; id++) {
    held.push(id, 1, 7, 1000 + id, 200, 300, 5, 1, 0);
    held.appear(0, 0, looks.colors, 0, looks.name[id]!, looks.look[id]!, looks.gear[id]!);
  }
  const cur = scene(1);
  // Sent all at once they are 47 KB, more than the server's 16 KB writer holds.
  const whole = new BitWriter(1 << 17);
  writeViewDelta(whole, sent, cur, new SentView(), 1 << 24, 0, looks);
  expect(whole.byteLength).toBeGreaterThan(16384);
  let rotate = 0;
  let steps = 0;
  let playersDone = 0;
  let largest = 0;
  for (let left = N; left > 0; steps++) {
    expect(steps).toBeLessThan(120);
    const next = new SentView();
    w.reset();
    rotate = writeViewDelta(w, sent, cur, next, BUDGET, rotate, looks);
    expect(w.overflow).toBe(false);
    if (w.pos > largest) largest = w.pos;
    r.reset(w.bytes());
    const got = new EntityView();
    expect(readViewDelta(r, held, got)).toBe(true);
    // A body that waits stays as the client had it, and the server knows which those are.
    expect([got.count, next.count]).toEqual([N, N]);
    left = 0;
    let players = 0;
    let unknown = 0;
    for (let id = 0; id < N; id++) {
      if (next.gen[id] !== got.gen[id] || next.rev[id] !== got.rev[id]) unknown++;
      if (got.gen[id] === cur.gen[id] && got.rev[id] === cur.rev[id]) continue;
      left++;
      if (player(id)) players++;
    }
    expect(unknown).toBe(0);
    if (players > 0) playersDone = steps + 1;
    sent = next;
    held = got;
  }
  // A create is budgeted at the most it could take, so a snapshot of them comes in under the budget.
  expect(largest).toBeLessThanOrEqual(BUDGET);
  expect(largest).toBeGreaterThan(BUDGET / 2);
  // 66 snapshots, a little over two seconds, with the 128 players whole after 14.
  expect(playersDone).toBeLessThan(steps / 2);
  expect(steps).toBeGreaterThan(40);
});

test("a budget smaller than one create still carries one of each kind a snapshot, so nothing waits for ever", () => {
  const N = 6;
  const BUDGET = 300;
  const w = new BitWriter(4096);
  const r = new BitReader();
  const looks = looksFor(N);
  for (let id = 0; id < N; id++) looks.name[id] = `a name of some length ${id}`;
  // Two players and four creatures, each named, and each sent again for a new look.
  const scene = (rev: number): SentView => {
    const v = new SentView();
    for (let id = 0; id < N; id++) {
      v.push(id, 1, 7, 1000 + id, 200, 300, 5, 1, 0, rev);
      v.urgent[id] = id < 2 ? 1 : 0;
    }
    return v;
  };
  let sent: SentView = scene(0);
  let held = new EntityView();
  for (let id = 0; id < N; id++) {
    held.push(id, 1, 7, 1000 + id, 200, 300, 5, 1, 0);
    held.appear(0, 0, looks.colors, 0, looks.name[id]!, null, null);
  }
  const cur = scene(1);
  let rotate = 0;
  const fresh: number[] = [];
  for (let step = 0; step < 4; step++) {
    const next = new SentView();
    w.reset();
    rotate = writeViewDelta(w, sent, cur, next, BUDGET, rotate, looks);
    // One alone is more than the whole budget.
    expect(w.pos).toBeGreaterThan(BUDGET);
    r.reset(w.bytes());
    const got = new EntityView();
    expect(readViewDelta(r, held, got)).toBe(true);
    fresh.push(Array.from(got.rev.subarray(0, N)).filter((v) => v === 1).length);
    sent = next;
    held = got;
  }
  // A player and a creature in each of the first two, then the two creatures left.
  expect(fresh).toEqual([2, 4, 5, 6]);
});

test("a frame short of bones poses survivors first, then the nearest, and draws every other body rigid on one bone where it stands", () => {
  const view = provingView(320, 180);
  const { remote, cam, scene, reg, hf, raster, pack } = view;
  const raptor = reg.index.get("core:raptor")!;
  const survivor = reg.index.get("core:survivor")!;
  const each = scene.characters.bones(raptor);
  expect([scene.characters.bones(survivor), each > 1]).toEqual([HUMAN_BONES, true]);
  // Six raptors in a fan going away from the camera, and two survivors beyond them all.
  cam.yaw = 0;
  remote.count = 0;
  for (let k = 0; k < 8; k++) {
    remote.id[k] = 200 + k;
    remote.kind[k] = k < 6 ? raptor : survivor;
    remote.x[k] = cam.x + (k - 3.5) * 1.5;
    remote.z[k] = cam.z + 10 + k * 3;
    remote.y[k] = hf.heightAt(remote.x[k]!, remote.z[k]!);
    remote.yaw[k] = 0;
    remote.flags[k] = 1;
    remote.anim[k] = 0;
  }
  remote.count = 8;
  const tier = scene.assets.tier;
  /** The ids drawn on one bone, the bodies posed and the bones used, with this many bones to pose with. */
  const frame = (bones: number): { rigid: number[]; posed: number; used: number } => {
    scene.assets.tier = { ...tier, bones };
    const p = view.render();
    const rigid: number[] = [];
    for (let d = 0; d < p.drawCount; d++) {
      if ((p.drawFlags[d]! & DRAW_ONE_BONE) === 0) continue;
      expect(p.drawFlags[d]).toBe(DRAW_SKINNED | DRAW_PLAIN | DRAW_ONE_BONE);
      for (let k = 0; k < p.drawInstances[d]!; k++) rigid.push(p.transientIds[p.drawFirst[d]! + k]!);
    }
    expect(p.dropped).toBe(0);
    return { rigid: [...new Set(rigid)].sort((a, b) => a - b), posed: scene.characters.posed, used: p.boneCount };
  };
  /** How many pixels show body `k`, and how far their middle is from where the middle of its mesh stands, in pixels. */
  const shown = (k: number): [number, number] => {
    const m = pack.header.meshes[scene.meshOfKind[remote.kind[k]!]!]!;
    const out = [0, 0, 0];
    cam.project(remote.x[k]! + m.center[0]!, remote.y[k]! + m.center[1]!, remote.z[k]! + m.center[2]!, out);
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < raster.pickId.length; i++) {
      if (raster.pickKind[i] !== PICK_ENTITY || raster.pickId[i] !== remote.id[k]) continue;
      n++;
      sx += i % raster.width;
      sy += Math.floor(i / raster.width);
    }
    return [n, n === 0 ? Infinity : Math.hypot(sx / n - out[0]! * raster.width, sy / n - out[1]! * raster.height)];
  };
  // With the tier's own bones every body is posed.
  expect(frame(tier.bones)).toEqual({ rigid: [], posed: 8, used: 2 * HUMAN_BONES + 6 * each });
  // With enough for the survivors and two raptors, and one bone each for the rest, the four farther raptors are rigid.
  const short = 2 * HUMAN_BONES + 2 * each + 4;
  expect(frame(short)).toEqual({ rigid: [202, 203, 204, 205], posed: 4, used: short });
  for (let k = 2; k < 6; k++) {
    const [pixels, off] = shown(k);
    expect(pixels).toBeGreaterThan(8);
    expect(off).toBeLessThan(3);
  }
  // One bone less and a raptor more is rigid. With hardly any, all are, and none is left out.
  expect(frame(short - 1).rigid).toEqual([201, 202, 203, 204, 205]);
  expect(frame(3)).toEqual({ rigid: [200, 201, 202, 203, 204, 205, 206, 207], posed: 0, used: 8 });
  for (let k = 0; k < 8; k++) expect(shown(k)[0]).toBeGreaterThan(8);
  // The viewer's own body is posed whatever is left.
  scene.own = { kind: survivor, x: cam.x, y: hf.heightAt(cam.x, cam.z + 3), z: cam.z + 3, yaw: 0, state: new AnimState(), tick: 0, firstPerson: false, colors: new Uint8Array(6), look: null, gear: new Uint16Array(6), id: 7 };
  expect(frame(3)).toEqual({ rigid: [200, 201, 202, 203, 204, 205, 206, 207], posed: 1, used: 8 + HUMAN_BONES });
});

test("what a full frame leaves out is counted: draws past 4,096 and beams past sixteen", () => {
  const view = provingView(160, 90);
  const { scene, cam, hf } = view;
  cam.yaw = 0;
  const usual = scene.build(cam, null);
  const draws = usual.drawCount;
  expect(usual.dropped).toBe(0);
  // Twenty places to mark, and sixteen beams in their one draw.
  for (let k = 0; k < 20; k++) scene.beams.push(cam.x, hf.heightAt(cam.x, cam.z + 5 + k), cam.z + 5 + k);
  const beamed = scene.build(cam, null);
  expect([beamed.dropped, beamed.drawCount]).toEqual([4, draws + 1]);
  scene.beams.length = 0;
  // A loose thing is a draw of its own. With as many in view as a frame has draws, as many are left out as the frame drew before.
  const mesh = scene.meshOfKind[view.reg.index.get("core:crate")!]!;
  scene.things = Array.from({ length: MAX_DRAWS }, (_, k) => ({ mesh, x: cam.x + ((k % 16) - 7.5) / 2, y: cam.y, z: cam.z + 20 + (k >> 4) / 2, level: -1 }));
  const full = scene.build(cam, null);
  expect([full.drawCount, full.dropped]).toEqual([MAX_DRAWS, draws]);
});
