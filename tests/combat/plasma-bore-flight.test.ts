import { expect, test } from "bun:test";
import { Shots } from "../../client/core/shots.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import type { Characters } from "../../client/core/render/characters.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import type { ClientSession, CombatEvent } from "../../client/core/session.ts";
import { EVENT_SHOT } from "../../shared/net/protocol.ts";
import { corePack } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

function range(mine: boolean, ended = 0, pistol = false, model = true) {
  const h = new Harness({}, 11), shots = new Shots(h.reg, corePack());
  const ammo = h.reg.index.get(pistol ? "core:plasma_charge" : "core:plasma_cell")!;
  const gun = h.reg.index.get(pistol ? "core:pistol_plasma" : "core:rifle_plasma")!;
  const shooter = mine ? undefined : 0;
  const speed = h.reg.ammoSpeed[ammo]!;
  const x = 200, y = h.world.hf.heightAt(x, 200) + 20, z = 200;
  const muzzle = [x + 0.24, y - 0.35, z + 0.65], axis = [0.06, 0.08, Math.sqrt(0.99)];
  const pack = corePack(), bolt = pack.meshIndex.get("core:plasma_bolt")!;
  const draws: { head: number[]; tail: number[]; direction: number[] }[] = [];
  const actors = {
    plasmaBore: (ex: number, ey: number, ez: number, a: number, own: boolean, at: number[], way: number[], seen?: number) => {
      expect([ex, ey, ez, a, own]).toEqual([x, y, z, ammo, mine]);
      expect(seen).toBe(shooter);
      if (!model) return false;
      at.splice(0, 3, ...muzzle);
      way.splice(0, 3, ...axis);
      return true;
    },
    loose: (_p: FramePacket, mesh: number, xx: number, yy: number, zz: number, dx: number, dy: number, dz: number, length: number) => {
      if (mesh === bolt) draws.push({ head: [xx, yy, zz], tail: [xx - dx * length, yy - dy * length, zz - dz * length], direction: [dx, dy, dz] });
      return true;
    },
  } as unknown as Characters;
  const cam = { x: 0, y: 0, z: 0, boxVisible: () => true } as unknown as Camera;
  const fired = mine ? [{ x, y, z, yaw: 0, pitch: 0, cone: 0, seed: 1, ammo, weapon: gun, draw: 1 }] : [];
  const events = mine ? [] : [{ kind: EVENT_SHOT, flies: true, item: ammo, shooter, x, y, z, vx: 0, vy: 0, vz: speed, back: 1, far: ended } as CombatEvent];
  const session = { own: { x, y: y - 1.62, z, kind: h.reg.index.get("core:survivor")! }, events, fired } as unknown as ClientSession;
  const draw = (ms: number) => {
    const tick = 100 + ms * 0.03;
    shots.step(h.world, null, tick, ms);
    draws.length = 0;
    shots.draw(actors, {} as FramePacket, cam, tick);
    return draws.at(-1);
  };
  draw(0);
  shots.absorb(session, h.world, 0);
  return { draw, shots, muzzle, axis, x, y, z };
}

for (const mine of [true, false]) for (const pistol of [false, true]) {
  const gun = pistol ? "pistol" : "rifle", view = mine ? "shooter" : "observer";
  test(`the ${view} sees the ${gun} bolt and its tail leave along the posed bore`, () => {
    const { draw, shots, muzzle, axis } = range(mine, 0, pistol);
    const flash = shots.flashes[0]!;
    expect([flash.x, flash.y, flash.z]).toEqual(muzzle);
    expect([flash.dx, flash.dy, flash.dz]).toEqual(axis);
    const first = draw(0)!;
    for (let k = 0; k < 3; k++) expect(first.tail[k]!).toBeCloseTo(muzzle[k]!, 7);
    const bolt = draw(4)!;
    for (let k = 0; k < 3; k++) {
      expect(bolt.direction[k]!).toBeCloseTo(axis[k]!, 8);
      expect(bolt.tail[k]!).toBeCloseTo(muzzle[k]!, 7);
    }
    const far = draw(70)!;
    expect(far.head[0]!).toBeCloseTo(200, 7);
    expect(far.direction[2]!).toBeCloseTo(1, 7);
  });
}

test("a close observed hit crosses from the bore to the reported contact", () => {
  const { draw, shots, muzzle, x, y, z } = range(false, 4);
  expect(shots.flying).toHaveLength(0);
  expect(shots.bursts).toHaveLength(1);
  expect([shots.bursts[0]!.x, shots.bursts[0]!.y, shots.bursts[0]!.z]).toEqual([x, y, z + 4]);
  const leaving = draw(3)!;
  for (let k = 0; k < 3; k++) expect(leaving.tail[k]!).toBeCloseTo(muzzle[k]!, 7);
  const arriving = draw(16.5)!;
  expect(arriving.head[2]!).toBeLessThanOrEqual(z + 4);
  expect(arriving.head[2]!).toBeGreaterThan(z + 3.9);
  expect(draw(17)).toBeUndefined();
});

test("a moving gun carries its flash after the bolt leaves", () => {
  const { draw, shots, muzzle } = range(true);
  muzzle[0]! += 0.05;
  const launchX = muzzle[0]!;
  expect(draw(0)!.tail[0]!).toBeCloseTo(launchX, 7);
  muzzle[0]! += 0.1;
  expect(draw(4)!.tail[0]!).toBeCloseTo(launchX, 7);
  expect(shots.flashes[0]!.x).toBe(muzzle[0]!);
});

test("an observer without the gun mesh sees the transmitted flight", () => {
  const { draw, shots, x, y, z } = range(false, 0, false, false);
  const flash = shots.flashes[0]!;
  expect([flash.x, flash.y, flash.z]).toEqual([x, y - 0.1, z + 0.7]);
  const bolt = draw(3)!;
  expect(bolt.head[0]!).toBe(x);
  expect(bolt.head[1]!).toBe(y);
  expect(bolt.head[2]!).toBeGreaterThan(z + 2);
});

test("a bolt against a close wall stays on the near side of its contact", () => {
  const { draw, z } = range(false, 1);
  for (const ms of [1, 2, 3, 4]) expect(draw(ms)!.head[2]!).toBeLessThanOrEqual(z + 1);
});
