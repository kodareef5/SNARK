// Bodies on ground too steep to stand on, as on a sloped piece's face (tests/unit/slopes.test.ts): a wall to walk into from any
// side, a slide to stand on, held only where it has no way down, and a body in a crease of two banks or of a bank and a slab
// banks no speed to land with. On ground it can stand on, nothing moves.

import { expect, test } from "bun:test";
import { slopeKind } from "../../content/slopes.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { BTN_JUMP, BTN_SPRINT, Body, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const kind = (id: string): number => reg.index.get(id)!;
const WALKERS = reg.defs.flatMap((d) => (d?.type === "species" && !d.still ? [d.id] : []));
const wild = (id: string): MoveParams => reg.move[kind(id)]!;
const tamed = (id: string): MoveParams => reg.tamedMove[kind(id)]!;
const G = wild("core:survivor").gravity;
const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/** Ground 256 m square shaped by `height`, sampled every 2 m as a map is. */
function terrain(height: (x: number, z: number) => number): TestWorld {
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, height(i * hf.cell, j * hf.cell));
  return { dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), reg, kind };
}

/** Eight ways a bank may face, in degrees from +Z toward +X, and the unit vector up it. */
const ASPECTS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({ deg, ux: Math.sin((deg * Math.PI) / 180), uz: Math.cos((deg * Math.PI) / 180) }));

/** Level ground, and from a line through (128, 128) a bank rising `deg` degrees up `aspect` to a flat top 12 m up. */
const bank = (deg: number, aspect: (typeof ASPECTS)[number]): TestWorld => terrain((x, z) => Math.max(0, Math.min(12, ((x - 128) * aspect.ux + (z - 128) * aspect.uz) * tan(deg))));

/**
 * The highest a body of `p` may stand short of the top: the highest corner of a face it can stand on that is not the top. Where
 * the bank's foot crosses a face, the face is as steep as the share of it on the bank makes it.
 */
function footOf(w: TestWorld, p: MoveParams): number {
  const hf = w.hf;
  let most = 0;
  for (let j = 0; j < hf.nz - 1; j++) {
    for (let i = 0; i < hf.nx - 1; i++) {
      const [h00, h10, h01, h11] = [hf.sample(i, j), hf.sample(i + 1, j), hf.sample(i, j + 1), hf.sample(i + 1, j + 1)];
      for (const [gx, gz, top] of [[h10 - h00, h11 - h10, Math.max(h00, h10, h11)], [h11 - h01, h01 - h00, Math.max(h00, h01, h11)]] as const) {
        if (top < 11.5 && 1 / Math.hypot(1, gx / hf.cell, gz / hf.cell) >= p.slopeCos) most = Math.max(most, top);
      }
    }
  }
  return most;
}

/** A body of `p` resting on the ground at (x, z), facing `deg` degrees from +Z toward +X. */
function bodyAt(w: TestWorld, p: MoveParams, x: number, z: number, deg = 0): Body {
  const b = new Body();
  [b.x, b.z] = [x, z];
  b.y = groundUnder(w.hf, x, z, p.radius);
  b.grounded = true;
  b.yaw = yawOf(deg);
  return b;
}

const yawOf = (deg: number): number => Math.round((deg / 360) * 65536) & 0xffff;

test("a bank too steep to stand on is a wall to every walker from every side at every speed: none walks up it, and a jump at it goes no higher than a jump", () => {
  const wrong: string[] = [];
  for (const deg of [45, 50, 60, 75]) {
    for (const aspect of ASPECTS) {
      const w = bank(deg, aspect);
      for (const id of WALKERS) {
        const p = wild(id);
        const apex = (p.jumpSpeed * p.jumpSpeed) / (2 * G);
        const foot = footOf(w, p);
        // A flyer's jump is its take-off, so it is not jumped.
        for (const buttons of p.flies ? [0, BTN_SPRINT] : [0, BTN_SPRINT, BTN_SPRINT | BTN_JUMP]) {
          // From 3 m short of the foot, straight up the bank and slantwise, for six seconds.
          for (const turn of [-60, -30, 0, 30, 60]) {
            const b = bodyAt(w, p, 128 - aspect.ux * 3, 128 - aspect.uz * 3, aspect.deg + turn);
            let high = 0;
            for (let t = 0; t < 180; t++) {
              stepBody(w, b, 0, 127, b.yaw, 0, t % 20 === 0 ? buttons : buttons & ~BTN_JUMP, p, TICK_DT);
              if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the ground at ${b.x}, ${b.y}, ${b.z}`);
              high = Math.max(high, b.y);
            }
            const most = foot + (buttons & BTN_JUMP ? apex : 0) + 0.02;
            if (high > most) wrong.push(`${id} at ${deg} degrees facing ${aspect.deg}, turned ${turn}, buttons ${buttons}: up ${high.toFixed(3)} m, where it may reach ${most.toFixed(3)}`);
          }
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("a body set on ground too steep to stand on slides down it as one that falls, pressing up it with jump held (but a flyer, whose jump is its take-off): coming to its feet only at its foot, never going up", () => {
  const wrong: string[] = [];
  for (const deg of [45, 50, 60, 75]) {
    for (const aspect of ASPECTS) {
      const w = bank(deg, aspect);
      for (const id of WALKERS) {
        const p = wild(id);
        // 6 m up, facing the top.
        const up = 6 / tan(deg);
        const b = bodyAt(w, p, 128 + aspect.ux * up, 128 + aspect.uz * up, aspect.deg);
        b.grounded = false;
        const from = b.y;
        const foot = footOf(w, p) + 0.02;
        let ticks = 0;
        for (; ticks < 900 && !b.grounded; ticks++) {
          const was = b.y;
          stepBody(w, b, 0, 127, b.yaw, 0, p.flies ? 0 : BTN_JUMP, p, TICK_DT);
          if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the ground at tick ${ticks}`);
          if (b.y > was) wrong.push(`${id} went up ${deg} degrees facing ${aspect.deg} at tick ${ticks}, ${was} to ${b.y}`);
        }
        // It comes to its feet only at the foot, and lands no faster than the drop would land it.
        if (!(b.y <= foot) || !b.grounded || !(from > 5.5)) wrong.push(`${id} on ${deg} degrees facing ${aspect.deg} did not slide down from ${from}: ${b.y} after ${ticks} ticks`);
        if (stepOut.landSpeed > Math.sqrt(2 * G * (from - b.y))) wrong.push(`${id} on ${deg} degrees facing ${aspect.deg} landed at ${stepOut.landSpeed.toFixed(2)} m/s from ${from.toFixed(2)} m`);
      }
    }
  }
  expect(wrong.slice(0, 20)).toEqual([]);
});

test("a tame walks up ground between ARK's two angles, 44.8 and 53.1 degrees, that stops the same species wild, from every side", () => {
  const wrong: string[] = [];
  for (const deg of [47, 52]) {
    for (const aspect of ASPECTS) {
      const w = bank(deg, aspect);
      for (const id of WALKERS) {
        for (const p of [wild(id), tamed(id)]) {
          if (p.walkSpeed < 0.5) continue;
          const climbs = p.slopeCos < Math.cos((deg * Math.PI) / 180);
          const b = bodyAt(w, p, 128 - aspect.ux * 2, 128 - aspect.uz * 2, aspect.deg);
          let high = 0;
          for (let t = 0; t < 600 && b.y < 11.9; t++) {
            stepBody(w, b, 0, 127, b.yaw, 0, BTN_SPRINT, p, TICK_DT);
            high = Math.max(high, b.y);
          }
          if (climbs ? !(high >= 11.9 && b.grounded) : high > footOf(w, p) + 0.02) wrong.push(`${climbs ? "tamed" : "wild"} ${id} at ${deg} degrees facing ${aspect.deg}: up ${high.toFixed(3)} m`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
  expect(WALKERS.filter((id) => tamed(id).slopeCos !== wild(id).slopeCos).length).toBeGreaterThan(2);
});

test("a body standing still on ground it can stand on, or turning on the spot there, does not creep, up to its steepest", () => {
  const wrong: string[] = [];
  for (const id of WALKERS) {
    for (const p of [wild(id), tamed(id)]) {
      const most = (Math.acos(p.slopeCos) * 180) / Math.PI;
      for (const deg of [5, 20, 35, most - 1]) {
        // A plane rising toward +Z, and the same turned toward +X and slantwise, so the faces are met three ways.
        for (const [ux, uz] of [[0, 1], [1, 0], [Math.SQRT1_2, Math.SQRT1_2]] as const) {
          const w = terrain((x, z) => 40 + ((x - 128) * ux + (z - 128) * uz) * tan(deg));
          for (const [x, z] of [[128.3, 128.7], [129.9, 127.1], [127, 127]] as const) {
            // Set down on it, it comes to rest in a tick or two and then stays.
            const b = bodyAt(w, p, x, z);
            for (let t = 0; t < 5; t++) stepBody(w, b, 0, 0, b.yaw, 0, 0, p, TICK_DT);
            const at = [b.x, b.y, b.z];
            for (let t = 0; t < 300; t++) stepBody(w, b, 0, 0, (t * 977) & 0xffff, 0, 0, p, TICK_DT);
            if (!b.grounded || b.x !== at[0] || b.y !== at[1] || b.z !== at[2]) wrong.push(`${id} (${p.slopeCos}) on ${deg.toFixed(1)} degrees along ${ux}, ${uz}: moved from ${at.join(", ")} to ${b.x}, ${b.y}, ${b.z}, grounded ${b.grounded}`);
          }
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

/**
 * Drops a body of every species into a crease at (x, z) from `from` m above it, holds it there twenty seconds, tries jump, and
 * walks it out along the crease the way `deg` faces to where `out` says it is out. Lists what it should not have done: be off its
 * feet in the crease or land there faster than a tick's fall once in, jump, or land out of it faster than the drop takes it.
 */
function creased(w: TestWorld, x: number, z: number, from: number, deg: number, out: (b: Body) => boolean, low = 0): string[] {
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = wild(id);
    const b = new Body();
    [b.x, b.z] = [x, z];
    b.y = groundUnder(w.hf, x, z, p.radius) + from;
    let land = 0;
    for (let t = 0; t < 600; t++) {
      stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
      if (t > 60) land = Math.max(land, stepOut.landSpeed);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the crease at tick ${t}`);
    }
    const held = b.y;
    if (!b.grounded || b.vy !== 0 || land > G * TICK_DT + 1e-6 || !(held > low)) wrong.push(`${id} in the crease: grounded ${b.grounded}, vy ${b.vy}, landed at ${land} once in, ${held} up`);
    const stamina = b.stamina;
    stepBody(w, b, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
    if (p.jumpSpeed > 0) {
      if (!(b.vy > 0)) wrong.push(`${id} could not jump from the crease`);
    } else if (!b.grounded || b.vy !== 0 || b.y !== held || b.stamina !== stamina) wrong.push(`${id} jumped or spent stamina despite having no ground jump`);
    land = 0;
    for (let t = 0; t < 90; t++) {
      stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
      land = Math.max(land, stepOut.landSpeed);
    }
    if (!b.grounded || Math.abs(b.y - held) > 0.02 || land > p.jumpSpeed) wrong.push(`${id} back in the crease: ${b.y} against ${held}, landed at ${land}`);
    // Out along it, it lands no faster than its drop from the crease takes it.
    let most = 0;
    let t = 0;
    for (; t < 900 && !(out(b) && b.grounded); t++) {
      stepBody(w, b, 0, 127, yawOf(deg), 0, 0, p, TICK_DT);
      most = Math.max(most, stepOut.landSpeed);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the ground walking out at tick ${t}`);
    }
    const drop = Math.max(0, held - b.y);
    if (!out(b) || most > Math.sqrt(2 * G * drop) + G * TICK_DT) wrong.push(`${id} out of the crease after ${t} ticks at ${b.x}, ${b.y}, ${b.z}, landing at ${most.toFixed(2)} m/s from ${drop.toFixed(2)} m`);
  }
  return wrong;
}

test("a body dropped into a gully of two banks too steep to stand on is held there: it banks no speed, keeps its authored jump ability, and walks out along it", () => {
  // Banks of 60 degrees each side of x = 128, 10 m high, along Z to z = 160, where the gully opens on level ground.
  const w = terrain((x, z) => (z < 160 ? Math.min(10, Math.abs(x - 128) * tan(60)) : 0));
  expect(creased(w, 128, 150, 6, 0, (b) => b.z > 163, 0.05)).toEqual([]);
  // Where the gully falls 1 in 10, more than the 1 in 50 that holds a body, it is never on its feet there and goes down it,
  // lifted no more than the 2 mm it may lie in what it touches as it lands in it.
  const falls = terrain((x, z) => (z - 64) * 0.1 + Math.min(10, Math.abs(x - 128) * tan(60)));
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = wild(id);
    const b = new Body();
    [b.x, b.z] = [128, 140];
    b.y = groundUnder(falls.hf, b.x, b.z, p.radius) + 0.5;
    for (let t = 0; t < 300; t++) {
      const [y, z] = [b.y, b.z];
      stepBody(falls, b, 0, 0, 0, 0, 0, p, TICK_DT);
      if (b.grounded || b.y > y + 0.002 || b.z > z) wrong.push(`${id} in the sloping gully at tick ${t}: grounded ${b.grounded}, from ${y}, ${z} to ${b.y}, ${b.z}`);
    }
    if (!(b.z < 139.5)) wrong.push(`${id} went only to ${b.z} down the sloping gully`);
  }
  expect(wrong.slice(0, 10)).toEqual([]);
});

test("a body dropped into a notch of a bank too steep to stand on and a slab leaning on it is held there, banks no speed, and walks out of it", () => {
  // A bank of 60 degrees rising toward +Z from z = 128, and a slab at 60 degrees leaning back from it, its low end in the bank
  // 3 m up, so the two make a notch along X 4 m long.
  const w = terrain((_, z) => Math.max(0, Math.min(12, (z - 128) * tan(60))));
  const k = kind(slopeKind("slab60"));
  const at = 128 + 3 / tan(60);
  w.structs.add(k, 128, 2.8 + reg.halfY[k]!, at - reg.halfZ[k]! + 0.15, 32768, 0, 1);
  // Off the slab's end it slides down the bank to the ground.
  expect(creased(w, 128, at - 0.1, 5, 90, (b) => b.x > 131 && b.y < 0.05, 2.5)).toEqual([]);
});
