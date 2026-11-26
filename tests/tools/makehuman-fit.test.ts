import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { artModule } from "../../tools/art/source.ts";
import { B_FINGERS_L, B_FINGERTIPS_L, B_HAND_L } from "../../shared/anim/human.ts";
import { quatAxis, quatMul } from "../../shared/math/quat.ts";
import { fitBody, fitStages, collapsedBone, macroTargets, thumbRing, PART_NAMES, type FittedBody } from "../../tools/makehuman/fit.ts";
import { readSkeleton } from "../../tools/makehuman/skeleton.ts";
import { DEFAULT_SKELETON } from "../../tools/makehuman/index.ts";
import { BASE_OBJ, MAKEHUMAN } from "../../tools/makehuman/index.ts";
import { readObj } from "../../tools/makehuman/obj.ts";

const MIRROR = existsSync(BASE_OBJ);
if (!MIRROR) console.warn(`makehuman-fit: no MakeHuman mirror at ${MAKEHUMAN}, so the fit tests are skipped. Install it: bun run media art raw-makehuman`);
const mirrorTest = MIRROR ? test : test.skip;

const RIGS = MIRROR ? ((await artModule("core/humans/human-bodies/rigs.ts")).RIGS as readonly (readonly number[])[]) : [];
const rigOf = (sex: "male" | "female"): readonly number[] => RIGS[sex === "male" ? 0 : 1]!;
const fitted = new Map<string, FittedBody>();
const body = (sex: "male" | "female"): FittedBody => {
  let f = fitted.get(sex);
  if (!f) fitted.set(sex, (f = fitBody(sex, rigOf(sex))));
  return f;
};
const named = (b: number): string => HUMAN.names[b]!;

test("macro targets interpolate as MakeHuman's sliders do", () => {
  const male = macroTargets({ gender: 1, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5 });
  const weight = (file: string): number => male.find((t) => t.file === `macrodetails/${file}.target`)?.weight ?? 0;
  expect(weight("universal-male-young-averagemuscle-averageweight")).toBeCloseTo(1, 12);
  expect(weight("caucasian-male-young")).toBeCloseTo(1 / 3, 12);
  expect(male.some((t) => t.file.includes("female") || t.file.includes("height/"))).toBe(false);
  const mixed = macroTargets({ gender: 0.25, age: 0.75, muscle: 1, weight: 0.25, height: 1, proportions: 0 });
  let sum = 0;
  for (const t of mixed) if (t.file.includes("universal-")) sum += t.weight;
  expect(sum).toBeCloseTo(1, 12);
  const w = (file: string): number => mixed.find((t) => t.file === `macrodetails/${file}.target`)?.weight ?? 0;
  expect(w("universal-female-old-maxmuscle-minweight")).toBeCloseTo(0.75 * 0.5 * 1 * 0.5, 12);
  expect(w("height/male-young-maxmuscle-averageweight-maxheight")).toBeCloseTo(0.25 * 0.5 * 1 * 0.5 * 1, 12);
  expect(w("proportions/female-old-maxmuscle-minweight-uncommonproportions")).toBeCloseTo(0.75 * 0.5 * 0.5 * 1, 12);
});

test("MakeHuman's bones collapse onto the thirty by part and side", () => {
  const cases: [string, string][] = [
    ["root", "hips"], ["spine05", "hips"], ["pelvis.R", "hips"], ["spine03", "spine"], ["breast.L", "chest"], ["spine01", "upperChest"],
    ["neck02", "neck"], ["neck03", "head"], ["jaw", "head"], ["eye.R", "head"], ["tongue05.L", "head"], ["clavicle.L", "shoulder.L"],
    ["shoulder01.R", "shoulder.R"], ["upperarm02.L", "upperArm.L"], ["lowerarm02.R", "lowerArm.R"], ["metacarpal3.L", "hand.L"],
    ["finger1-3.R", "thumb.R"], ["finger4-1.L", "fingers.L"], ["finger5-3.R", "fingertips.R"], ["upperleg02.R", "upperLeg.R"],
    ["lowerleg01.L", "lowerLeg.L"], ["foot.R", "foot.R"], ["toe1-2.L", "toe.L"],
  ];
  for (const [from, to] of cases) expect(`${from} ${named(collapsedBone(from))}`).toBe(`${from} ${to}`);
});

mirrorTest("both sexes land every joint within a millimetre of their rig", () => {
  for (const sex of ["male", "female"] as const) {
    const f = body(sex);
    expect([...f.rest]).toEqual(rigOf(sex).map((v) => Math.fround(v)));
    const off = [...f.report.landed].map((mm, b) => [named(b), mm] as const).filter(([, mm]) => !(mm < 1));
    expect(off).toEqual([]);
  }
});

mirrorTest("every vertex weighs 1 over at most four bones, its heaviest first", () => {
  for (const sex of ["male", "female"] as const) {
    const f = body(sex);
    const bad: string[] = [];
    for (let v = 0; v < f.positions.length / 3; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = f.weights[v * 4 + k]!;
        sum += w;
        if (w < 0 || w > f.weights[v * 4]! || f.joints[v * 4 + k]! >= HUMAN_BONES) bad.push(`${sex} ${v}`);
      }
      if (Math.abs(sum - 1) > 1e-6 || f.bone[v] !== f.joints[v * 4]) bad.push(`${sex} ${v}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }
});

mirrorTest("hand and foot vertices are each wholly on one bone", () => {
  const ends = new Set(["hand", "fingers", "fingertips", "thumb", "foot", "toe"].flatMap((n) => [`${n}.L`, `${n}.R`]).map((n) => HUMAN.names.indexOf(n)));
  for (const sex of ["male", "female"] as const) {
    const f = body(sex);
    let blended = 0;
    let ends0 = 0;
    for (let v = 0; v < f.positions.length / 3; v++) {
      if (!ends.has(f.bone[v]!)) continue;
      ends0++;
      for (let k = 1; k < 4; k++) if (f.weights[v * 4 + k]! !== 0) blended++;
    }
    expect(ends0).toBeGreaterThan(0);
    expect(blended).toBe(0);
  }
});

mirrorTest("no helper or joint-cube face is kept, and the feet stand on the ground", () => {
  const base = readObj(BASE_OBJ);
  const quads = base.groups.get("body")!.length;
  for (const sex of ["male", "female"] as const) {
    const f = body(sex);
    const bodyTris = [...f.part].filter((p) => p === 0).length;
    expect(bodyTris).toBe(quads * 2);
    expect(f.report.triangles.total).toBe(f.indices.length / 3);
    expect(PART_NAMES.every((p) => f.report.triangles[p]! > 0)).toBe(true);
    let lowest = Infinity;
    for (let v = 0; v < f.positions.length / 3; v++) lowest = Math.min(lowest, f.positions[v * 3 + 1]!);
    expect(Math.abs(lowest)).toBeLessThan(1e-5);
  }
});

mirrorTest("the same inputs fit the same body twice", () => {
  const a = body("male");
  const b = fitBody("male", rigOf("male"));
  expect(Buffer.from(b.positions.buffer).equals(Buffer.from(a.positions.buffer))).toBe(true);
  expect(Buffer.from(b.indices.buffer).equals(Buffer.from(a.indices.buffer))).toBe(true);
  expect(Buffer.from(b.weights.buffer).equals(Buffer.from(a.weights.buffer))).toBe(true);
  expect(Buffer.from(b.joints.buffer).equals(Buffer.from(a.joints.buffer))).toBe(true);
  expect(Buffer.from(b.normals.buffer).equals(Buffer.from(a.normals.buffer))).toBe(true);
});

mirrorTest("every finger's knuckle and middle joint sit on the rig's finger hinges", () => {
  const skel = readSkeleton(DEFAULT_SKELETON);
  const base = readObj(BASE_OBJ);
  for (const sex of ["male", "female"] as const) {
    const rig = rigOf(sex);
    const s = fitStages(sex, rig);
    const off: string[] = [];
    for (const side of ["L", "R"]) {
      const bone = (n: string): number => HUMAN.names.indexOf(`${n}.${side}`);
      for (const k of [2, 3, 4, 5]) {
        for (const [j, hinge] of [[1, bone("fingers")], [2, bone("fingertips")]] as const) {
          const verts = skel.joints.get(`finger${k}-${j}.${side}____head`)!;
          let x = 0, y = 0;
          for (const v of verts) (x += s.landed[v * 3]! / verts.length), (y += s.landed[v * 3 + 1]! / verts.length);
          const miss = Math.hypot(x - rig[hinge * 3]!, y - rig[hinge * 3 + 1]!);
          if (miss > 1e-5) off.push(`${sex} finger${k}-${j}.${side} ${(miss * 1000).toFixed(2)} mm`);
        }
      }
      // Where the thumb meets the palm is near the joint it turns about, so a grip does not tear it from the palm.
      const ring = thumbRing({ base, bodyFaces: base.groups.get("body")! }, s.landed, s.skin, bone("thumb"), bone("hand"));
      const t = bone("thumb");
      const gap = Math.hypot(ring[0]! - rig[t * 3]!, ring[1]! - rig[t * 3 + 1]!, ring[2]! - rig[t * 3 + 2]!);
      if (gap > 0.012) off.push(`${sex} thumb.${side} meets the palm ${(gap * 100).toFixed(1)} cm from its joint`);
    }
    expect(off).toEqual([]);
  }
});

mirrorTest("a closed fist folds every fingertip back under the palm", () => {
  for (const sex of ["male", "female"] as const) {
    const f = body(sex);
    const rig = f.rest;
    // The strike tables' fist, left hand: the fingers 75 degrees at the knuckles, the fingertips 95 more.
    const q = new Float64Array(8);
    quatAxis(q, 0, 0, 0, 1, (-75 * Math.PI) / 180);
    quatAxis(q, 4, 0, 0, 1, (-95 * Math.PI) / 180);
    quatMul(q, 4, q, 0, q, 4);
    const F = [0, 1, 2].map((k) => rig[B_FINGERS_L * 3 + k]!), T = [0, 1, 2].map((k) => rig[B_FINGERTIPS_L * 3 + k]!);
    const turn = (o: number, x: number, y: number): [number, number] => {
      const c = 1 - 2 * q[o + 2]! ** 2, s = 2 * q[o + 2]! * q[o + 3]!;
      return [c * x - s * y, s * x + c * y];
    };
    // The middle joint, turned with the fingers about the knuckle.
    const [mx] = turn(0, T[0]! - F[0]!, T[1]! - F[1]!);
    let reach = -Infinity;
    for (let v = 0; v < f.positions.length / 3; v++) {
      if (f.bone[v] !== B_FINGERTIPS_L) continue;
      const [x] = turn(4, f.positions[v * 3]! - T[0]!, f.positions[v * 3 + 1]! - T[1]!);
      reach = Math.max(reach, F[0]! + mx + x - rig[B_HAND_L * 3]!);
    }
    // No fingertip reaches past the knuckles' hinge by more than a finger's thickness.
    expect(reach).toBeLessThan(F[0]! - rig[B_HAND_L * 3]! + 0.025);
  }
});
