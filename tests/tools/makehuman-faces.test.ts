import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { B_HEAD, B_NECK } from "../../shared/anim/human.ts";
import { FACE_COUNT } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { artModule } from "../../tools/art/source.ts";
import {
  allowed, axisDistance, cookFaces, drawnAt, faceOn, FACE_MODIFIERS, forgetCookedFaces, GROWTHS, headWeightOf, mouthOut, onSlotBorder, seating, sideFiles, type FaceCook,
} from "../../tools/makehuman/faces.ts";
import { clampFace, FACE_EYE_L, FACE_EYE_R, FACE_JAW, FACE_LID_L, FACE_LID_R, FACE_ROWS } from "../../shared/people/faces.ts";
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

/** The fitted vertices the bound holds: every bound part's, and the skin's on the head bone. */
const heldOf = (c: FaceCook): Uint32Array => Uint32Array.from({ length: c.body.positions.length / 3 }, (_, i) => i).filter((i) => c.sources.part[i] !== 0 || c.body.bone[i] === B_HEAD);

/** Each held vertex of `at` farther than it may be at stretch `grow`, by name; none where the bound holds. */
function overBound(c: FaceCook, at: Float32Array, grow: readonly number[], held: Uint32Array): string[] {
  const q = [0, 0, 0], q0 = [0, 0, 0], out: string[] = [];
  const p = c.body.positions;
  for (const i of held) {
    drawnAt(c.bound, grow, p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, q0);
    drawnAt(c.bound, grow, at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!, q);
    const over = axisDistance(c.bound, q) - allowed(c.bound, axisDistance(c.bound, q0));
    if (over > 1e-6) out.push(`vertex ${i} ${(over * 1000).toFixed(2)} mm`);
  }
  return out;
}

mirrorTest("each modifier alone, at either end, stays inside the head and its slack", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    expect(c.aloneOver).toBeLessThanOrEqual(0);
    const held = heldOf(c);
    for (let j = 0; j < FACE_COUNT * 2; j++) {
      const at = faceOn(c, valuesWith(j >> 1, j & 1 ? 1 : -1));
      for (const grow of GROWTHS) expect(overBound(c, at, grow, held).slice(0, 2)).toEqual([]);
    }
  }
});

mirrorTest("the clamp holds every summed face inside the head and its slack", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    const held = heldOf(c);
    const rng = new Rng(sex === "male" ? 11 : 12);
    const faces: Float32Array[] = [new Float32Array(FACE_COUNT).fill(-1), new Float32Array(FACE_COUNT).fill(1)];
    for (let i = 0; i < 12; i++) faces.push(Float32Array.from({ length: FACE_COUNT }, () => [-1, 0, 1][rng.int(3)]!));
    let unheld = 0;
    for (const f of faces) {
      for (const grow of [GROWTHS[0]!, GROWTHS[GROWTHS.length - 1]!, GROWTHS[3]!]) {
        const at = faceOn(c, f);
        if (overBound(c, at, grow, held).length > 0) unheld++;
        clampFace(c.bound, grow, c.body.positions, at, held);
        expect(overBound(c, at, grow, held).slice(0, 2)).toEqual([]);
      }
    }
    // The cut is per modifier, so some sums do leave the bound and are held.
    expect(unheld).toBeGreaterThan(0);
  }
});

mirrorTest("face rows follow MakeHuman's jaw, upper lids and eyes", () => {
  for (const sex of SEXES) {
    const c = cook(sex);
    const rows = c.table.rows!;
    const by = new Array<number>(FACE_ROWS).fill(0);
    rows.row.forEach((r) => by[r]!++);
    for (const r of [FACE_JAW, FACE_LID_L, FACE_LID_R, FACE_EYE_L, FACE_EYE_R]) expect(by[r]).toBeGreaterThan(50);
    const border = onSlotBorder(c.body);
    rows.vertices.forEach((v, i) => {
      const x = c.body.positions[v * 3]!;
      // Eyes and lids go by side, the body's left at +X; every eyeball vertex turns with its eye.
      if (rows.row[i] === FACE_EYE_L || rows.row[i] === FACE_LID_L) expect(x).toBeGreaterThan(0);
      if (rows.row[i] === FACE_EYE_R || rows.row[i] === FACE_LID_R) expect(x).toBeLessThan(0);
      if (c.sources.part[v] === 1) expect(rows.share[i]).toBeGreaterThan(0.99);
      // Nothing on the head slot's border moves with a row, so the head meets the neck.
      if (border[v]) expect(rows.share[i]).toBe(0);
    });
    // The tongue goes with the jaw; the pivots sit at the jaw's joint and each eye's middle.
    const tongue = rows.vertices.filter((v, i) => c.sources.part[v] === 5 && rows.row[i] === FACE_JAW).length;
    expect(tongue).toBeGreaterThan(0);
    const p = c.table.pivots!;
    expect(p[3]).toBeCloseTo(c.eyeJoints[0]!, 2);
    expect(p[6]).toBeCloseTo(c.eyeJoints[3]!, 2);
    expect(p[1]).toBeLessThan(p[4]!);
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
