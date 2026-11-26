import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { B_HEAD, B_NECK } from "../../shared/anim/human.ts";
import { FACE_COUNT } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { artModule } from "../../tools/art/source.ts";
import {
  allowed, axisDistance, cookFaces, drawnAt, faceOn, FACE_MODIFIERS, forgetCookedFaces, GROWTHS, headWeightOf, mouthOut, onSlotBorder, seating, sideFiles, worstOver, type FaceCook,
} from "../../tools/makehuman/faces.ts";
import { fitStages } from "../../tools/makehuman/fit.ts";
import { BASE_OBJ, MAKEHUMAN, TARGETS } from "../../tools/makehuman/index.ts";

const MIRROR = existsSync(BASE_OBJ);
if (!MIRROR) console.warn(`makehuman-faces: no MakeHuman mirror at ${MAKEHUMAN}, so the face tests are skipped. Install it: bun run media art raw-makehuman`);
const mirrorTest = MIRROR ? test : test.skip;

const RIGS = MIRROR ? ((await artModule("core/humans/human-bodies/rigs.ts")).RIGS as readonly (readonly number[])[]) : [];
const SEXES = ["male", "female"] as const;
const rigOf = (sex: "male" | "female"): readonly number[] => RIGS[sex === "male" ? 0 : 1]!;
const cook = (sex: "male" | "female"): FaceCook => cookFaces(sex, rigOf(sex));

const valuesWith = (m: number, v: number): Float32Array => {
  const out = new Float32Array(FACE_COUNT);
  out[m] = v;
  return out;
};

test("there is a modifier for each face byte, each side naming targets", () => {
  expect(FACE_MODIFIERS.length).toBe(FACE_COUNT);
  expect(new Set(FACE_MODIFIERS.map((m) => m.name)).size).toBe(FACE_COUNT);
  expect(sideFiles(["eyes/{s}-eye-scale-incr"])).toEqual(["eyes/l-eye-scale-incr.target", "eyes/r-eye-scale-incr.target"]);
});

mirrorTest("every target a modifier names is in the mirror", () => {
  const missing = FACE_MODIFIERS.flatMap((m) => sideFiles([...m.minus, ...m.plus])).filter((f) => !existsSync(join(TARGETS, f)));
  expect(missing).toEqual([]);
});

mirrorTest("the fit moves every head vertex by one translation", () => {
  for (const sex of SEXES) {
    const s = fitStages(sex, rigOf(sex));
    let first: number[] | null = null;
    let worst = 0;
    for (let v = 0; v < s.landed.length / 3; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (s.skin.bones[v * 4 + k] === B_HEAD) w += s.skin.weights[v * 4 + k]!;
      if (w < 1 - 1e-9) continue;
      const d = [0, 1, 2].map((k) => s.landed[v * 3 + k]! - s.placed[v * 3 + k]!);
      first ??= d;
      worst = Math.max(worst, ...d.map((x, k) => Math.abs(x - first![k]!)));
    }
    expect(first).not.toBeNull();
    expect(worst).toBeLessThan(1e-9);
  }
});

mirrorTest("every face the bytes make stays inside the head capsule and its slack", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    expect(worstOver(c)).toBeLessThanOrEqual(0);
    // Faces tried outright: each extreme, random ones, and each vertex's own worst choice of side by direction.
    const rng = new Rng(sex === "male" ? 11 : 12);
    const faces: Float32Array[] = [new Float32Array(FACE_COUNT).fill(-1), new Float32Array(FACE_COUNT).fill(1)];
    for (let i = 0; i < 24; i++) faces.push(Float32Array.from({ length: FACE_COUNT }, () => [-1, 0, 1][rng.int(3)]!));
    const at = faces.map((f) => faceOn(c, f));
    const singles = Array.from({ length: FACE_COUNT * 2 }, (_, j) => faceOn(c, valuesWith(j >> 1, j & 1 ? 1 : -1)));
    const body = c.body, n = body.positions.length / 3;
    const q = [0, 0, 0], q0 = [0, 0, 0];
    const over: string[] = [];
    for (let i = 0; i < n && over.length === 0; i++) {
      if (c.sources.part[i] === 0 && body.bone[i] !== B_HEAD) continue;
      const p = [body.positions[i * 3]!, body.positions[i * 3 + 1]!, body.positions[i * 3 + 2]!];
      for (const grow of GROWTHS) {
        drawnAt(c.bound, grow, p[0]!, p[1]!, p[2]!, q0);
        const limit = allowed(c.bound, axisDistance(c.bound, q0));
        // Each modifier's side that moves this vertex out from the head's middle the most, or neither.
        const out = [q0[0]! - c.bound.a[0]!, q0[1]! - (c.bound.a[1]! + c.bound.b[1]!) / 2, q0[2]! - c.bound.a[2]!];
        const pick = [...p];
        for (let m = 0; m < FACE_COUNT; m++) {
          let best = 0, side = -1;
          for (const j of [m * 2, m * 2 + 1]) {
            const d = [0, 1, 2].reduce((sum, k) => sum + (singles[j]![i * 3 + k]! - p[k]!) * grow[k]! * out[k]!, 0);
            if (d > best) {
              best = d;
              side = j;
            }
          }
          if (side >= 0) for (let k = 0; k < 3; k++) pick[k]! += singles[side]![i * 3 + k]! - p[k]!;
        }
        for (const t of [...at.map((a) => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!]), pick]) {
          drawnAt(c.bound, grow, t[0]!, t[1]!, t[2]!, q);
          if (axisDistance(c.bound, q) > limit + 1e-7) over.push(`${sex} vertex ${i}`);
        }
      }
    }
    expect(over.slice(0, 3)).toEqual([]);
  }
});

mirrorTest("a face moves nothing on the head slot's border or below it", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    const body = c.body;
    const border = onSlotBorder(body);
    const moved = new Set<number>();
    for (const m of c.table.modifiers) for (const side of [m.minus, m.plus]) for (const v of side.vertices) moved.add(v);
    const bad: number[] = [];
    let ring = 0;
    for (const v of moved) {
      if (c.sources.part[v] !== 0) continue;
      if (border[v] || headWeightOf(body, v) === 0) bad.push(v);
      if (headWeightOf(body, v) < 1) ring++;
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // The fade is taken across the neck, not at a cliff.
    expect(ring).toBeGreaterThan(0);
    expect(border.some((b, v) => b === 1 && body.bone[v] === B_NECK)).toBe(true);
  }
});

mirrorTest("eyes stay in their sockets and teeth behind the lips on every face", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    const rng = new Rng(5);
    const faces: Float32Array[] = [new Float32Array(FACE_COUNT).fill(-1), new Float32Array(FACE_COUNT).fill(1)];
    for (let m = 0; m < FACE_COUNT; m++) faces.push(valuesWith(m, -1), valuesWith(m, 1));
    for (let i = 0; i < 8; i++) faces.push(Float32Array.from({ length: FACE_COUNT }, () => rng.range(-1, 1)));
    for (const f of faces) {
      const s = seating(c, f);
      expect(s.eyeMm).toBeLessThan(1);
      expect(s.mouthOut).toBeLessThanOrEqual(s.mouthOutNeutral);
    }
    // The measure sees teeth pushed out through the lips.
    const pushed = c.body.positions.slice();
    for (let i = 0; i < pushed.length / 3; i++) if (c.sources.part[i] === 4) pushed[i * 3 + 2]! += 0.02;
    expect(mouthOut(c, pushed)).toBeGreaterThan(0);
  }
});

mirrorTest("the cook makes the same bytes twice", () => {
  const a = cook("male").bytes;
  forgetCookedFaces();
  const b = cook("male").bytes;
  expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
});
