// A body is clear of the ground under the whole of it, not only under its feet. On a slope its lower sphere rests on the hill.

import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { BTN_SPRINT, Body, stepBody } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree } from "../../shared/world/collide.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0 } from "../../shared/world/proving.ts";
import { flatWorld, provingWorld } from "../fixtures/world.ts";

/**
 * How far a capsule of radius `r` with its feet at (x, y, z) must rise to be clear of the ground: over a fine grid of the disk
 * under it, the most the ground there and the sphere's lower surface overlap. Negative when it is clear.
 */
function sunk(hf: Heightfield, x: number, y: number, z: number, r: number, steps = 40): number {
  let worst = -Infinity;
  for (let a = -steps; a <= steps; a++) {
    for (let b = -steps; b <= steps; b++) {
      const u = (a * r) / steps;
      const v = (b * r) / steps;
      const d2 = u * u + v * v;
      if (d2 > r * r) continue;
      const need = hf.heightAt(x + u, z + v) + Math.sqrt(r * r - d2) - (y + r);
      if (need > worst) worst = need;
    }
  }
  return worst;
}

test("a body walking up, down and across a slope of 10 to 50 degrees is never in the hill, whatever its size", () => {
  const p = provingWorld();
  // The slopes alone, with nothing built on them.
  const w = { ...p, structs: flatWorld(8).structs };
  const deepest: string[] = [];
  for (const kind of ["core:survivor", "core:parasaur"]) {
    const m = w.reg.move[w.kind(kind)]!;
    for (let strip = 0; strip < 5; strip++) {
      const b = new Body();
      b.x = SLOPE_X0 + SLOPE_WIDTH * strip + SLOPE_WIDTH / 2;
      b.z = SLOPE_Z0 + 4;
      b.y = w.hf.heightAt(b.x, b.z) + 1;
      let most = -Infinity;
      for (let tick = 0; tick < 150; tick++) {
        // Up the slope, back down it, and across it.
        const yaw = tick < 60 ? 0 : tick < 110 ? 32768 : 16384;
        stepBody(w, b, 0, 127, yaw, 0, tick % 3 === 0 ? BTN_SPRINT : 0, m, TICK_DT);
        if (tick % 3 === 1) most = Math.max(most, sunk(w.hf, b.x, b.y, b.z, m.radius));
      }
      if (most > SKIN + 2e-4) deepest.push(`${kind} on strip ${strip}: ${most.toFixed(3)} m into the hill`);
    }
  }
  expect(deepest).toEqual([]);
});

test("capsuleFree finds a body in the ground anywhere under it, and none just above where it rests", () => {
  const p = provingWorld();
  const w = { ...p, structs: flatWorld(8).structs };
  const wrong: string[] = [];
  for (const r of [0.4, 1.1]) {
    for (let strip = 0; strip < 6; strip++) {
      for (const dz of [3, 7.3, 11.9]) {
        const x = SLOPE_X0 + SLOPE_WIDTH * strip + SLOPE_WIDTH / 2 + 0.37;
        const z = SLOPE_Z0 + dz;
        // Where the lower sphere rests on the ground under it.
        const rest = w.hf.heightAt(x, z) + sunk(w.hf, x, w.hf.heightAt(x, z), z, r, 120);
        if (capsuleFree(w, x, rest - 0.01, z, r, 2.6)) wrong.push(`r ${r} strip ${strip} at ${dz}: free 1 cm under its rest`);
        if (!capsuleFree(w, x, rest + 0.002, z, r, 2.6)) wrong.push(`r ${r} strip ${strip} at ${dz}: not free 2 mm over its rest`);
      }
    }
  }
  expect(wrong).toEqual([]);
});
