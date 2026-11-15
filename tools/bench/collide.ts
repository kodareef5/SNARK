// Rows for the collision queries every tick leans on: a body's step, on open ground and among pieces, and rays of the
// lengths the game casts. `bun tools/bench/collide.ts` runs these alone.

import { ruinKind } from "../../content/miami-ruins.ts";
import { slopeKind } from "../../content/slopes.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_ROLL, BTN_SPRINT, Body, MODE_FLYER, STAMINA_UNITS, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { castWorld, lookDirection } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 16, chunksZ: 16 };

/** Rolling ground a kilometre square, shaped as the sizing target's map is. */
function rolling(): Heightfield {
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell;
      const z = j * hf.cell;
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    }
  }
  return hf;
}

/** Microseconds per call of `fn` over `n` calls, the best of `rounds` runs. */
function best(rounds: number, n: number, fn: (i: number) => void): number {
  let least = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t = performance.now();
    for (let i = 0; i < n; i++) fn(i);
    least = Math.min(least, ((performance.now() - t) * 1000) / n);
  }
  return least;
}

/** Bodies of every species, each walking, turning and now and then jumping or sprinting. Microseconds per body per tick. */
function stepping(w: CollisionWorld, moves: MoveParams[], spots: [number, number][], ticks: number): number {
  const rng = new Rng(11);
  const bodies = spots.map(([x, z]) => {
    const b = new Body();
    b.x = x;
    b.z = z;
    b.y = w.hf.heightAt(x, z) + 1;
    return b;
  });
  const input = bodies.map(() => [0, 127, 0, 0]);
  const tick = (): void => {
    for (let i = 0; i < bodies.length; i++) {
      const inp = input[i]!;
      if (rng.int(20) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[1] = rng.int(3) === 0 ? 0 : 127;
        inp[2] = rng.int(65536);
        inp[3] = rng.int(8) === 0 ? 1 : rng.int(3) === 0 ? 2 : 0;
      }
      stepBody(w, bodies[i]!, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, moves[i % moves.length]!, TICK_DT);
    }
  };
  for (let t = 0; t < 30; t++) tick();
  return best(5, ticks, tick) / bodies.length;
}

/**
 * Pteranodons in their own flight from `up` metres over the ground, each flying, turning, climbing and diving by its look,
 * now and then sprinting, braking or rolling, and their jump held so they stay up. Microseconds per body per tick.
 */
function flying(w: CollisionWorld, move: MoveParams, kind: number, spots: [number, number][], up: number, ticks: number): number {
  const rng = new Rng(13);
  const bodies = spots.map(([x, z]) => {
    const b = new Body();
    b.x = x;
    b.z = z;
    b.y = w.hf.heightAt(x, z) + up;
    b.mode = MODE_FLYER;
    b.kind = kind;
    b.staminaMax = 150;
    b.stamina = 150 * STAMINA_UNITS;
    return b;
  });
  const input = bodies.map(() => [127, 0, 0, BTN_JUMP]);
  const tick = (): void => {
    for (let i = 0; i < bodies.length; i++) {
      const inp = input[i]!;
      const b = bodies[i]!;
      if (rng.int(20) === 0) {
        inp[0] = rng.int(4) === 0 ? 0 : 127;
        inp[1] = rng.int(65536);
        inp[2] = rng.int(6000) - 3000;
        inp[3] = BTN_JUMP | (rng.int(3) === 0 ? BTN_SPRINT : 0) | (rng.int(12) === 0 ? BTN_BRAKE : 0) | (rng.int(12) === 0 ? BTN_ROLL : 0);
        // They never tire, so that every tick is flight.
        b.stamina = 150 * STAMINA_UNITS;
      }
      stepBody(w, b, 0, inp[0]!, inp[1]!, inp[2]!, inp[3]!, move, TICK_DT);
    }
  };
  for (let t = 0; t < 30; t++) tick();
  return best(5, ticks, tick) / bodies.length;
}

export function benchCollide(section: Section, record: Row): void {
  section("Collision: a body's step and rays, on rolling ground a kilometre square and in a base of 2,000 pieces");
  const reg = coreRegistry();
  const hf = rolling();
  const open: CollisionWorld = { hf, structs: new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const moves = ["core:survivor", "core:raptor", "core:grazer", "core:parasaur"].map((id) => reg.move[reg.index.get(id)!]!);
  const rng = new Rng(5);
  const spots: [number, number][] = Array.from({ length: 2000 }, () => [rng.range(40, 980), rng.range(40, 980)]);
  record("a body's step on rolling ground, 2,000 bodies of four kinds", stepping(open, moves, spots, 100), "us");

  // A base on a 3 m lattice, four floors high and 42 m square, as the sizing target's are.
  const base: CollisionWorld = { hf, structs: new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const kinds = ["core:foundation", "core:wall", "core:wall", "core:ceiling", "core:ceiling", "core:pillar", "core:crate", "core:block"].map((id) => reg.index.get(id)!);
  const cx = 501;
  const cz = 501;
  const y0 = hf.heightAt(cx, cz);
  for (let n = 0; n < 2000; n++) {
    const kind = kinds[rng.int(kinds.length)]!;
    base.structs.add(kind, cx + (rng.int(15) - 7) * 3, y0 + rng.int(4) * 3.3 + base.structs.halfYOf(kind), cz + (rng.int(15) - 7) * 3, rng.int(4) * 16384, 1, 1000);
  }
  const inBase: [number, number][] = Array.from({ length: 500 }, () => [cx + rng.range(-24, 24), cz + rng.range(-24, 24)]);
  record("a body's step in that base, 500 bodies", stepping(base, moves, inBase, 100), "us");
  const ptera = reg.index.get("core:pteranodon")!;
  record("a flyer's step 20 m over rolling ground, 2,000 pteranodons", flying(open, reg.tamedMove[ptera]!, ptera, spots, 20, 100), "us");
  record("a flyer's step in and over that base, 500 pteranodons", flying(base, reg.tamedMove[ptera]!, ptera, inBase, 6, 100), "us");

  // Shots of 600 m, a little above and below level, from an eye 1.6 m up.
  const d = [0, 0, 0];
  const shots = Array.from({ length: 2000 }, () => {
    const x = rng.range(200, 824);
    const z = rng.range(200, 824);
    lookDirection(rng.int(65536), rng.int(900) - 450, d);
    return [x, hf.heightAt(x, z) + 1.6, z, d[0]!, d[1]!, d[2]!];
  });
  const shoot = (w: CollisionWorld, s: number[], far: number): number => castWorld(w, s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, far);
  // The same shots from 150 m up, over everything, so each goes its whole length.
  const high = shots.map((s) => {
    const l = Math.hypot(s[3]!, s[5]!);
    return [s[0]!, 150, s[2]!, s[3]! / l, 0, s[5]! / l];
  });
  // Cells of 2 m that such a shot crosses, while it is over the map.
  const crossed = (s: number[]): number => {
    const cellOf = (v: number): number => Math.floor(Math.min(1023.99, Math.max(0, v)) / 2);
    return Math.abs(cellOf(s[0]! + s[3]! * 600) - cellOf(s[0]!)) + Math.abs(cellOf(s[2]! + s[5]! * 600) - cellOf(s[2]!)) + 1;
  };
  const sampled = (list: number[][]): number => {
    let samples = 0;
    const heightAt = hf.heightAt;
    hf.heightAt = (x: number, z: number): number => (samples++, heightAt.call(hf, x, z));
    for (const s of list) shoot(open, s, 600);
    hf.heightAt = heightAt;
    return samples / list.length;
  };
  record("a 600 m shot over open ground", best(5, shots.length, (i) => shoot(open, shots[i]!, 600)), "us");
  record("ground heights sampled by such a shot", sampled(shots), "");
  record("a 600 m shot that meets nothing", best(5, high.length, (i) => shoot(open, high[i]!, 600)), "us");
  record("ground heights sampled by that shot", sampled(high), "");
  record("cells of the ground that shot crosses", high.reduce((n, s) => n + crossed(s), 0) / high.length, "");
  record("a 40 m line of sight over open ground", best(5, shots.length, (i) => shoot(open, shots[i]!, 40)), "us");

  // From inside and around the base, toward and through it.
  const inside = Array.from({ length: 2000 }, () => {
    const x = cx + rng.range(-30, 30);
    const z = cz + rng.range(-30, 30);
    lookDirection(rng.int(65536), rng.int(4000) - 2000, d);
    return [x, y0 + 1.6 + rng.int(4) * 3.3, z, d[0]!, d[1]!, d[2]!];
  });
  record("a 6 m look in the base", best(5, inside.length, (i) => shoot(base, inside[i]!, 6)), "us");
  record("a 120 m shot in the base", best(5, inside.length, (i) => shoot(base, inside[i]!, 120)), "us");

  // A city's flight of stairs, 4 m up over 5.5 m to its landing: eleven step boxes as tools/mapworld/ruin-geometry.ts lays
  // them, or one sloped piece (content/slopes.ts). 400 flights, a body walking up and down each.
  const flat = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  flat.heights.fill(32 * 64);
  const flights = (sloped: boolean): CollisionWorld => {
    const w: CollisionWorld = { hf: flat, structs: new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
    const id = (name: string): number => reg.index.get(name)!;
    for (let i = 0; i < 400; i++) {
      const u = 100 + (i % 20) * 40;
      const v = 100 + Math.floor(i / 20) * 40;
      if (sloped) w.structs.add(id(slopeKind("stairs")), u, 2, v, 0, 1, 1000);
      else for (let n = 0; n < 11; n++) w.structs.add(id(ruinKind("step")), u, (n + 1) * (4 / 11) - 0.2, v - 2.5 + n * 0.5, 0, 1, 1000);
      w.structs.add(id(ruinKind("landing")), u + 1.5, 3.8, v + 3.25, 0, 1, 1000);
    }
    return w;
  };
  const climbing = (w: CollisionWorld): number => {
    const bodies = Array.from({ length: 400 }, (_, i) => {
      const b = new Body();
      b.x = 100 + (i % 20) * 40;
      b.z = 100 + Math.floor(i / 20) * 40 - 4;
      b.grounded = true;
      return b;
    });
    // Survivors and raptors, up onto the landing and back down to the ground before the flight's foot, again and again.
    const up = bodies.map(() => true);
    const tick = (): void => {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        const v = 100 + Math.floor(i / 20) * 40;
        if (up[i] ? b.z > v + 3 : b.z < v - 4) up[i] = !up[i];
        stepBody(w, b, 0, 127, up[i] ? 0 : 32768, 0, 0, moves[i % 2]!, TICK_DT);
      }
    };
    return best(5, 240, tick) / bodies.length;
  };
  record("a body's step up and down a city flight of eleven step boxes", climbing(flights(false)), "us");
  record("a body's step up and down the same flight as one sloped piece", climbing(flights(true)), "us");
}

if (import.meta.main) {
  benchCollide(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
