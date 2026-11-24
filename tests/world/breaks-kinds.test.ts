// The broken forms as content (content/breaks/kinds.ts): a kind for each form of each breaking shape in each variant, and
// the registry's tables that find one from another.

import { expect, test } from "bun:test";
import { BREAK_BLOCKS, breakBlocks, breakKind } from "../../content/breaks/kinds.ts";
import { KIT } from "../../content/breaks/kit.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_FINISHES, RUIN_SHAPES, finished, ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { BREAK_FAMILIES, BREAK_FORMS, BREAK_VARIANTS, FORM_HEAP, FORM_OPEN, FORM_WHOLE, formKind, heapKind } from "../../shared/content/breaks.ts";
import type { ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";

const compiled = compileContent(CORE_CONTENT);
const reg = compiled.registry!;
/** An id this work added: a form's kind or shape, or one of the city's materials. */
const added = (id: string): boolean => id.startsWith("core:zzzzzzbreak") || id.startsWith("core:zzzzzzmat_");
/** The skate park's pieces (content/skate-park.ts), new beside the forms: built by players, and in no map, by id or index. */
const wreckForm = (id: string): boolean => id.startsWith("core:zzzzzzzwreck_");
const skatePark = (id: string): boolean => id.startsWith("core:zzzzzzskate_");
const variants = Array.from({ length: BREAK_VARIANTS }, (_, v) => v);
const shapeOf = (id: string): ShapeDef => reg.defs[reg.index.get(id)!] as ShapeDef;
const kindOf = (id: string): StructureDef => reg.defs[reg.index.get(id)!] as StructureDef;
/** A kind a map places of `shape`, in the first finish it comes in. */
const wholeOf = (shape: string): string => ruinKind(shape as RuinShape, (Object.keys(RUIN_FINISHES) as RuinFinish[]).find((f) => finished(shape as RuinShape, f))!);

/** The least and most of what is solid of a kind along each axis, in its own frame. */
function solidBounds(d: StructureDef): number[] {
  const shape = d.shape === undefined ? null : shapeOf(d.shape);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const hold = (p: readonly number[]): void => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[a]!); hi[a] = Math.max(hi[a]!, p[a]!); } };
  for (const b of shape ? shape.boxes : [{ at: [0, 0, 0], half: d.half }]) { hold(b.at.map((v, a) => v - b.half[a]!)); hold(b.at.map((v, a) => v + b.half[a]!)); }
  for (const h of shape?.hulls ?? []) for (const c of h.corners) hold(c);
  return [...lo, ...hi];
}

test("the content compiles with every form in it, within a 16-bit index", () => {
  expect(compiled.errors).toEqual([]);
  expect(reg.defs.length).toBeLessThan(65535);
});

test("no id there was before the forms has its index moved by them", () => {
  // The registry numbers definitions from 1 in the order of their ids.
  const ids = CORE_CONTENT.map((d) => d.id);
  const before = ids.filter((id) => !added(id) && !skatePark(id) && !wreckForm(id)).sort();
  expect(before.length).toBeLessThan(CORE_CONTENT.length);
  const moved = before.filter((id, at) => reg.index.get(id) !== at + 1);
  expect(moved).toEqual([]);
  // Which holds because every new id sorts after the last old one.
  const first = ids.filter(added).sort()[0]!;
  expect(first > before[before.length - 1]!).toBe(true);
  // The skate park's pieces, as new as the forms, take the indices after them.
  const most = Math.max(...ids.filter(added).map((id) => reg.index.get(id)!));
  const park = ids.filter(skatePark);
  expect(park.length).toBeGreaterThan(0);
  expect(park.filter((id) => reg.index.get(id)! < most)).toEqual([]);
  // A wreck's lesser looks are newer still, and take the last indices of all.
  const last = Math.max(...park.map((id) => reg.index.get(id)!));
  const wrecks = ids.filter(wreckForm);
  expect(wrecks.length).toBeGreaterThan(0);
  expect(wrecks.filter((id) => reg.index.get(id)! < last)).toEqual([]);
});

test("each form of each breaking shape in each variant is a static kind of its own shape, with no finish", () => {
  let kinds = 0;
  for (const kit of KIT) for (const form of kit.forms(0).map((f) => f.name).filter((n) => n !== "whole")) for (const v of variants) {
    const d = kindOf(breakKind(kit.name, form, v));
    expect([d.id, d.class, d.mesh, d.material, d.made, d.color]).toEqual([d.id, "static", "shape", undefined, undefined, RUIN_FINISHES.fracture.color]);
    expect(d.breaks).toEqual({ set: kit.name, form, variant: v, family: kit.family, halves: d.breaks!.halves, bears: d.breaks!.bears });
    kinds++;
  }
  expect(BREAK_BLOCKS.filter((d) => d.type === "structure").length).toBe(kinds);
  expect(BREAK_BLOCKS.filter((d) => d.type === "shape").length).toBe(kinds);
});

test("the four variants of a form are solid alike and drawn apart", () => {
  for (const kit of KIT) for (const form of kit.forms(0).map((f) => f.name).filter((n) => n !== "whole")) {
    const shapes = variants.map((v) => shapeOf(kindOf(breakKind(kit.name, form, v)).shape!));
    for (const s of shapes) expect([s.id, s.boxes, s.hulls]).toEqual([s.id, shapes[0]!.boxes, shapes[0]!.hulls]);
    // A form with a cut of its own is not drawn the same way twice. One that only loses whole parts may be.
    if (form === "heap") expect(new Set(shapes.map((s) => JSON.stringify(s.look))).size).toBe(BREAK_VARIANTS);
  }
});

test("a form is written in its whole piece's frame, so a swap in place moves nothing", () => {
  const near = 0.05;
  for (const kit of KIT) {
    const whole = solidBounds(kindOf(wholeOf(kit.name)));
    for (const form of kit.forms(0).map((f) => f.name)) {
      if (form === "whole" || form === "hung" || form === "heap") continue;
      const b = solidBounds(kindOf(breakKind(kit.name, form, 0)));
      // What is solid of a broken piece is within what was solid of it whole.
      for (let a = 0; a < 3; a++) expect([kit.name, form, a, b[a]! >= whole[a]! - 0.001 && b[a + 3]! <= whole[a + 3]! + 0.001]).toEqual([kit.name, form, a, true]);
      // A breach takes a mouth or a half's fittings out of it, and leaves it reaching as far every way.
      if (form.startsWith("breach")) for (let k = 0; k < 6; k++) expect([kit.name, form, k, Math.abs(b[k]! - whole[k]!) < near]).toEqual([kit.name, form, k, true]);
    }
    // A heap lies about where the piece stood: under its top, and on its foot or its storey's floor.
    const heap = solidBounds(kindOf(breakKind(kit.name, "heap", 0)));
    expect([kit.name, heap[4]! <= whole[4]! + 1.5, heap[1]! >= Math.min(whole[1]!, -kit.origin[1]) - 0.001]).toEqual([kit.name, true, true]);
    for (const a of [0, 2]) expect([kit.name, a, (heap[a]! + heap[a + 3]!) / 2 > whole[a]! - 1.3 && (heap[a]! + heap[a + 3]!) / 2 < whole[a + 3]! + 1.3]).toEqual([kit.name, a, true]);
  }
});

test("the registry finds a piece's form kind from the kind a map placed, in any finish, and from any of its forms", () => {
  const stucco = reg.index.get(ruinKind("wall8", "limestucco"))!, block = reg.index.get(ruinKind("wall8", "greyblock"))!;
  const open2 = reg.index.get(breakKind("wall8", "open", 2))!;
  expect(open2).toBeGreaterThan(0);
  expect(formKind(reg, stucco, FORM_OPEN, 2)).toBe(open2);
  expect(formKind(reg, block, FORM_OPEN, 2)).toBe(open2);
  // From a form of it, to another form and variant.
  expect(formKind(reg, open2, FORM_HEAP, 1)).toBe(reg.index.get(breakKind("wall8", "heap", 1))!);
  expect(heapKind(reg, stucco, 3)).toBe(reg.index.get(breakKind("wall8", "heap", 3))!);
  // The whole of a whole kind is itself. A form has no whole of its own: the slot's map kind is.
  expect(formKind(reg, stucco, FORM_WHOLE, 0)).toBe(stucco);
  expect(formKind(reg, open2, FORM_WHOLE, 0)).toBe(0);
  // A wall has no hung form, and a stair no forms at all.
  expect(formKind(reg, stucco, BREAK_FORMS.indexOf("hung"), 0)).toBe(0);
  expect(formKind(reg, reg.index.get(ruinKind("flight"))!, FORM_OPEN, 0)).toBe(0);
  expect(heapKind(reg, reg.index.get(ruinKind("zcore"))!, 0)).toBe(0);
});

test("a form kind says back its shape, form and variant, and every kind of a set its family and halves", () => {
  for (const kit of KIT) {
    const whole = reg.index.get(wholeOf(kit.name))!, set = reg.breakSet[whole]!;
    expect(reg.breakShape[whole]).toBe(kit.name);
    expect([reg.breakForm[whole], BREAK_FAMILIES[reg.breakFamily[whole]!]]).toEqual([FORM_WHOLE, kit.family]);
    kit.forms(0).forEach((f) => {
      const form = BREAK_FORMS.indexOf(f.name);
      for (const v of variants) {
        const k = formKind(reg, whole, form, v);
        if (form === FORM_WHOLE) { expect(reg.breakBears[k]).toBe(f.bears ? 1 : 0); continue; }
        expect(reg.ids[k]).toBe(breakKind(kit.name, f.name, v));
        expect([reg.breakSet[k], reg.breakShape[k], reg.breakForm[k], reg.breakVariant[k], reg.breakFamily[k], reg.breakHalves[k], reg.breakBears[k]]).toEqual([set, kit.name, form, v, reg.breakFamily[whole]!, reg.breakHalves[whole]!, f.bears ? 1 : 0]);
      }
    });
  }
});

test("every finish of a breaking shape is of its break set, and a shape that never breaks is of none", () => {
  for (const shape of Object.keys(RUIN_SHAPES) as RuinShape[]) for (const finish of (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((f) => finished(shape, f))) {
    const k = reg.index.get(ruinKind(shape, finish))!;
    expect([shape, finish, reg.breakShape[k], reg.breakSet[k]! > 0]).toEqual(KIT.some((kit) => kit.name === shape) ? [shape, finish, shape, true] : [shape, finish, null, false]);
  }
});

test("every breaking shape has a heap kind in each variant", () => {
  for (const kit of KIT) for (const v of variants) {
    const heap = heapKind(reg, reg.index.get(wholeOf(kit.name))!, v);
    expect([kit.name, v, reg.ids[heap]]).toEqual([kit.name, v, breakKind(kit.name, "heap", v)]);
    expect(reg.breakBears[heap]).toBe(0);
  }
});

test("the forms are made the same twice, and every number of them is on the 1/4096 m grid", () => {
  expect(breakBlocks()).toEqual([...BREAK_BLOCKS]);
  const off = (v: number): boolean => v * 4096 !== Math.round(v * 4096);
  for (const d of BREAK_BLOCKS) {
    const numbers = d.type === "structure" ? [...d.half] : d.type === "shape" ? [...d.boxes, ...(d.look?.boxes ?? [])].flatMap((b) => [...b.at, ...b.half]).concat([...(d.hulls ?? []), ...(d.look?.hulls ?? [])].flatMap((h) => h.corners.flat())) : [];
    expect([d.id, numbers.filter(off)]).toEqual([d.id, []]);
  }
});

// Node is a development tool here, used only as a second JavaScript engine.
const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test.skipIf(nodeMajor < 24)("V8 makes every form's numbers as JavaScriptCore does", () => {
  const script = 'const { BREAK_BLOCKS } = await import("./content/breaks/kinds.ts"); const { hashString } = await import("./shared/hash.ts"); console.log(hashString(JSON.stringify(BREAK_BLOCKS)));';
  const run = Bun.spawnSync([node!, "--no-warnings", "--input-type=module", "-e", script], { cwd: import.meta.dir + "/../.." });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe(String(hashString(JSON.stringify(BREAK_BLOCKS))));
});
