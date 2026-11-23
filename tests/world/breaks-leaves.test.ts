// What leaves a broken piece, and how a form's convex parts are coloured (content/breaks/leaves.ts): tables a client
// reads without the server.

import { expect, test } from "bun:test";
import { chunkTriangles, MOST_FRAGMENTS, MOST_TRIANGLES } from "../../content/breaks/check.ts";
import { BREAK_BLOCKS, breakKind } from "../../content/breaks/kinds.ts";
import { KIT } from "../../content/breaks/kit.ts";
import { breakLeaves, breakLook, leavesOf, lookOf } from "../../content/breaks/leaves.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { ruinKind } from "../../content/ruins.ts";
import { BREAK_VARIANTS } from "../../shared/content/breaks.ts";
import type { ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";
import { hullFault } from "../../shared/world/convex.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const variants = Array.from({ length: BREAK_VARIANTS }, (_, v) => v);
const forms = (shape: string) => KIT.find((k) => k.name === shape)!.forms(0).map((f) => f.name).filter((n) => n !== "whole");

test("every form of every breaking shape says what leaves, within the break set's limits", () => {
  for (const kit of KIT) for (const form of forms(kit.name)) for (const v of variants) {
    const leaves = breakLeaves(kit.name, form, v)!;
    expect(leaves.things.length).toBeLessThanOrEqual(MOST_FRAGMENTS);
    expect(leaves.things.flat().reduce((s, c) => s + chunkTriangles(c), 0)).toBeLessThanOrEqual(MOST_TRIANGLES);
    for (const thing of leaves.things) {
      expect(thing.length).toBeGreaterThan(0);
      for (const c of thing) expect([kit.name, form, v, hullFault({ corners: c.corners })]).toEqual([kit.name, form, v, ""]);
    }
  }
});

test("a breach throws shards cut from the core, a window bay its panes too, and a heap or a hung panel nothing", () => {
  const wall = breakLeaves("wall8", "breach A", 1)!;
  expect(wall.things.length).toBeGreaterThanOrEqual(4);
  expect(wall.things.flat().every((c) => c.bare)).toBe(true);
  expect(wall.panes).toEqual([]);
  expect(breakLeaves("zwin", "breach A", 0)!.panes.length).toBe(1);
  expect(breakLeaves("zwin", "open", 0)!.panes.length).toBe(2);
  // Four storeys of panes in a shell's opened half.
  expect(breakLeaves("zwin4", "breach B", 2)!.panes.length).toBe(4);
  expect(breakLeaves("wall8", "heap", 0)).toEqual({ things: [], panes: [] });
  expect(breakLeaves("zpanel8", "hung", 3)).toEqual({ things: [], panes: [] });
  // A fitting leaves whole, in its own colour: a shop's sign.
  expect(breakLeaves("zstore", "open", 0)!.things.some((t) => t.some((c) => c.color === 135 && !c.bare))).toBe(true);
});

test("a shape that does not break, or a form it has not, leaves nothing to ask for", () => {
  expect(breakLeaves("flight", "open", 0)).toBeNull();
  expect(breakLeaves("wall8", "hung", 0)).toBeNull();
  expect(breakLook("zcore", "open", 0)).toBeNull();
});

test("a form's parts are coloured in the order its shape draws them", () => {
  for (const kit of KIT) for (const form of forms(kit.name)) for (const v of variants) {
    const kind = reg.defs[reg.index.get(breakKind(kit.name, form, v))!] as StructureDef;
    const shape = reg.defs[reg.index.get(kind.shape!)!] as ShapeDef;
    expect([kind.id, breakLook(kit.name, form, v)!.length]).toEqual([kind.id, shape.look?.hulls?.length ?? 0]);
  }
  // A wall's teeth are bared. A pier's bowed bar is rust, and its sound lengths are neither.
  const teeth = breakLook("wall8", "breach A", 0)!;
  expect(teeth.length).toBeGreaterThan(0);
  expect(teeth.every((p) => p.bare && p.color === undefined)).toBe(true);
  const neck = breakLook("pier8", "breach A", 0)!;
  expect(neck.filter((p) => p.color === 179).length).toBe(2);
  expect(neck.filter((p) => p.bare).length).toBe(3);
  expect(neck.filter((p) => !p.bare && p.color === undefined).length).toBe(2);
});

test("a client finds them from the kind a piece was swapped to", () => {
  const open = reg.index.get(breakKind("zcurt", "open", 2))!;
  expect(leavesOf(reg, open)).toEqual(breakLeaves("zcurt", "open", 2));
  expect(lookOf(reg, open)).toEqual(breakLook("zcurt", "open", 2));
  expect(leavesOf(reg, open)!.panes.length).toBe(2);
  // A whole kind and a kind that never breaks have none.
  expect(leavesOf(reg, reg.index.get(ruinKind("zcurt", "limestone"))!)).toBeNull();
  expect(lookOf(reg, reg.index.get(ruinKind("flight"))!)).toBeNull();
});

test("no definition holds them, so the content hash does not", () => {
  const text = JSON.stringify(BREAK_BLOCKS);
  expect(text.includes('"bare":') || text.includes('"things":') || text.includes('"panes":')).toBe(false);
});

/** Every shape's every form's leaving things and part colours, as text. */
const everything = (): string => JSON.stringify(KIT.map((kit) => forms(kit.name).map((form) => variants.map((v) => [breakLeaves(kit.name, form, v), breakLook(kit.name, form, v)]))));

test("every number of what leaves is on the 1/4096 m grid", () => {
  const off = (v: number): boolean => v * 4096 !== Math.round(v * 4096);
  for (const kit of KIT) for (const form of forms(kit.name)) for (const v of variants) {
    const leaves = breakLeaves(kit.name, form, v)!;
    const numbers = [...leaves.things.flat().flatMap((c) => c.corners.flat()), ...leaves.panes.flatMap((b) => [...b.at, ...b.half])];
    expect([kit.name, form, v, numbers.filter(off)]).toEqual([kit.name, form, v, []]);
  }
});

// Node is a development tool here, used only as a second JavaScript engine.
const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test.skipIf(nodeMajor < 24)("V8 cuts what leaves as JavaScriptCore does", () => {
  const script = `const { KIT } = await import("./content/breaks/kit.ts"); const { breakLeaves, breakLook } = await import("./content/breaks/leaves.ts"); const { hashString } = await import("./shared/hash.ts");
    const forms = (kit) => kit.forms(0).map((f) => f.name).filter((n) => n !== "whole");
    console.log(hashString(JSON.stringify(KIT.map((kit) => forms(kit).map((form) => [0, 1, 2, 3].map((v) => [breakLeaves(kit.name, form, v), breakLook(kit.name, form, v)]))))));`;
  const run = Bun.spawnSync([node!, "--no-warnings", "--input-type=module", "-e", script], { cwd: import.meta.dir + "/../.." });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe(String(hashString(everything())));
});
