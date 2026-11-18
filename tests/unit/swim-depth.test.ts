import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { BTN_JUMP, Body, MF_OUT, MODE_FLYER, MODE_SWIM, MODE_WALK, stepBody, stepOut, swimDepth, type MoveParams } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { GROUND_FREE, GROUND_WATER, groundAt } from "../../shared/world/path.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { flatWorld, provingWorld } from "../fixtures/world.ts";

const authored = { height: 3.96, radius: .6, eyeHeight: 1.32, swimDepth: 1.12, jumpSpeed: 0 };
function compile(more: Partial<SpeciesDef> = {}) {
  return compileContent(CORE_CONTENT.map(d => d.id === "core:parasaur" && d.type === "species" ? { ...d, ...authored, ...more } as SpeciesDef : d));
}
function params(): MoveParams {
  const result = compile();
  if (!result.registry) throw new Error(result.errors.join("\n"));
  return result.registry.move[result.registry.index.get("core:parasaur")!]!;
}

test("authored float depth is validated, retained by tamed movement, and does not change the collision or eye height", () => {
  const { registry, errors } = compile();
  expect(errors).toEqual([]);
  const k = registry!.index.get("core:parasaur")!;
  for (const p of [registry!.move[k]!, registry!.tamedMove[k]!]) {
    expect([p.height, p.eyeHeight, p.radius, p.swimDepth, p.jumpSpeed]).toEqual([3.96, 1.32, .6, 1.12, 0]);
  }
  for (const value of [0, -.1, 4, Infinity, NaN]) expect(compile({ swimDepth: value }).errors.some(e => e.includes("swimDepth"))).toBe(true);
  for (const value of [0, -.1, 4, Infinity, NaN]) expect(compile({ swimEyeHeight: value }).errors.some(e => e.includes("swimEyeHeight"))).toBe(true);
  const raised = compile({ swimDepth: 1.75, swimEyeHeight: 1.97 }).registry!, at = raised.index.get("core:parasaur")!;
  for (const p of [raised.move[at]!, raised.tamedMove[at]!]) expect([p.swimDepth, p.swimEyeHeight, p.eyeHeight, p.height]).toEqual([1.75, 1.97, 1.32, 3.96]);
  for (const value of [-.1, 30.1, Infinity, NaN]) expect(compile({ jumpSpeed: value }).errors.some(e => e.includes("jumpSpeed"))).toBe(true);
  const legacy = { height: 2.06 };
  for (const share of [.7, .75, .55]) expect(swimDepth(legacy, share)).toBe(legacy.height * share);
  expect(swimDepth({ height: 3.96, swimDepth: 1.12 })).toBe(1.12);
});

test("a low-headed tall body enters, floats, dives and walks ashore using its depth without waterline oscillation", () => {
  const w = provingWorld(), p = params(), b = new Body();
  b.x = PROVING_POOL.x + 34; b.z = PROVING_POOL.z; b.y = w.hf.heightAt(b.x, b.z); b.grounded = true;
  let switches = 0;
  const step = (move: number, yaw: number, pitch = 0, buttons = 0) => {
    const mode = b.mode;
    stepBody(w, b, 0, move, yaw, pitch, buttons, p, TICK_DT);
    if (mode !== b.mode) switches++;
    expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
  };
  for (let i = 0; i < 900 && b.mode === MODE_WALK; i++) step(127, 49152);
  expect(b.mode).toBe(MODE_SWIM);
  expect(PROVING_SEA_LEVEL - b.y).toBeGreaterThan(swimDepth(p, .7));
  expect(PROVING_SEA_LEVEL - b.y).toBeLessThan(swimDepth(p, .7) + .2);
  for (let i = 0; i < 150; i++) step(127, 49152, 0, BTN_JUMP);
  expect(b.y).toBeCloseTo(PROVING_SEA_LEVEL - 1.12, 4);
  expect(b.y + p.eyeHeight).toBeGreaterThan(PROVING_SEA_LEVEL + .19);
  for (let i = 0; i < 90; i++) step(127, 49152, -12000);
  expect(b.y + p.eyeHeight).toBeLessThan(PROVING_SEA_LEVEL);
  for (let i = 0; i < 150; i++) step(0, 16384, 0, BTN_JUMP);
  expect(b.y).toBeCloseTo(PROVING_SEA_LEVEL - 1.12, 4);
  for (let i = 0; i < 1200 && b.mode === MODE_SWIM; i++) step(127, 16384);
  expect([b.mode, b.grounded, switches]).toEqual([MODE_WALK, true, 2]);
});

test("AI water classification agrees with authored entry and a zero-jump body never spends jump stamina", () => {
  const w = flatWorld(), p = params(), b = new Body();
  b.x = b.z = 40; b.grounded = true;
  b.stamina = 50000;
  const plain = new Body(); plain.copy(b);
  for (let i = 0; i < 30; i++) {
    stepBody(w, b, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
    stepBody(w, plain, 0, 0, 0, 0, 0, p, TICK_DT);
    expect([b.y, b.vy, b.grounded, b.stamina]).toEqual([plain.y, plain.vy, plain.grounded, plain.stamina]);
    expect(b.grounded).toBe(true);
    expect(stepOut.landSpeed).toBe(0);
  }
  w.hf.seaLevel = swimDepth(p, .7) - .01;
  expect(groundAt(w, p, 40, 40)).toBe(GROUND_FREE);
  w.hf.seaLevel += .02;
  expect(groundAt(w, p, 40, 40)).toBe(GROUND_WATER);
  stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
  expect(b.mode).toBe(MODE_SWIM);
});

test("an unconscious low-headed swimmer preserves its submerged state despite held rise input", () => {
  const w = flatWorld(), p = params(), b = new Body();
  w.hf.seaLevel = 6; b.x = b.z = 40; b.y = 2; b.mode = MODE_SWIM; b.mflags = MF_OUT;
  b.vy = -2;
  for (let i = 0; i < 180; i++) stepBody(w, b, 0, 127, 0, 12000, BTN_JUMP, p, TICK_DT);
  expect(b.y).toBeLessThan(2);
  expect(b.y + p.eyeHeight).toBeLessThan(6);
  expect([b.vy, b.mode]).toEqual([0, MODE_SWIM]);
  b.mflags = 0;
  for (let i = 0; i < 180; i++) stepBody(w, b, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
  expect(b.y).toBeCloseTo(6 - 1.12, 4);
  expect(b.y + p.eyeHeight).toBeGreaterThan(6);
});

test("a tall flyer settles at authored depth once and remains afloat after landing", () => {
  const w = flatWorld(), base = w.reg.move[w.kind("core:pteranodon")]!;
  const p = { ...base, ...authored }, b = new Body();
  w.hf.seaLevel = 6; b.x = b.z = 40; b.y = 9; b.mode = MODE_FLYER;
  let landed = 0;
  for (let i = 0; i < 600; i++) {
    stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
    if (stepOut.setDown) landed++;
    expect(stepOut.landSpeed).toBe(0);
  }
  expect([b.mode, landed]).toEqual([MODE_SWIM, 1]);
  expect(b.y).toBeCloseTo(6 - 1.12, 4);
});
