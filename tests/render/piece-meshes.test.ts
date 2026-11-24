// The building pieces a tier's recipe makes (tools/pack/pieces): each level is built for its distance from the form's
// own numbers, so it must lie in the form's collider, carry the ring it yields at, and keep to the piece budget.

import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { TEXTURED, colliderBox, levelsOf, yieldPlanes } from "../../tools/pack/pieces/lod.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
import { THATCH, THATCH_FORMS, THATCH_SOLIDS } from "../../tools/pack/pieces/thatch.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";

/** Metres a mesh may stand out of its collider: a sill under its foot, a peg, a hewn timber's bow. */
const PROUD = 0.04;
/** A door's pull and hinges stand further off its face. */
const PROUD_LEAF = 0.05;
/** Wood's strips past a wall's ends fill the outside corner until joints are drawn there. */
const PROUD_ENDS = 0.1;

const levels = Object.entries(FORMS).map(([name, form]) => ({ name, form, shapes: levelsOf(WOOD, name, form) }));

test("every level of every wood piece lies within its collider and the margin its kind is given", () => {
  for (const { name, form, shapes } of levels) {
    const box = colliderBox(form);
    const along = form.plane === "upright" ? 0 : 2;
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) over[a] = Math.max(over[a]!, box[a]! - at[a]!, at[a]! - box[a + 3]!);
      }
      over.forEach((most, a) => {
        const margin = form.layer === "leaf" ? PROUD_LEAF : form.layer === "wall" && a === along ? PROUD_ENDS : PROUD;
        expect(most, `${name} level ${level} along ${"xyz"[a]}`).toBeLessThanOrEqual(margin);
      });
    });
  }
});

test("a textured level of a piece that yields has a ring of vertices on each yield plane, and only prisms along it cross it", () => {
  for (const { name, form, shapes } of levels) {
    for (const [axis, at] of yieldPlanes(form)) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => p[axis]! - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          const crosses = side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6);
          if (crosses) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses ${"xyz"[axis]} = ${at}`).toBe(axis);
        }
        expect(on, `${name} level ${level}: vertices on ${"xyz"[axis]} = ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every wood level is closed, looks outward and costs no more than a made piece may from its distance", () => {
  for (const mesh of tierShapes(WOOD, FORMS)) {
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
    });
  }
});

test("a recipe makes the same mesh each time it is asked", () => {
  const [a, b] = [tierShapes(WOOD, FORMS), tierShapes(WOOD, FORMS)];
  expect(a.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(b.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

// Thatch. Its poles and tips stand out of its colliders as the scripts' did: these are the most each kind may.
const THATCHED: Record<string, FormDef> = Object.fromEntries(THATCH_FORMS.map((name) => [name, FORMS[name]]));
const thatch = Object.entries(THATCHED).map(([name, form]) => ({ name, form, shapes: levelsOf(THATCH, name, form) }));
/** Metres past the collider's least x, y and z and its most, in the engine's frame, by the kind of form. */
const THATCH_PROUD: Record<string, readonly number[]> = {
  // The post past the left end and proud of the front, the inner post behind, the lower tips under the foot.
  wall: [0.14, 0.11, 0.06, 0.02, 0, 0.1],
  // The eaves and their tips past every edge, hanging under the floor's thickness.
  slab: [0.3, 0.21, 0.3, 0.3, 0, 0.3],
  // A foundation's logs and stakes round it, driven a little into the ground.
  root: [0.17, 0.03, 0.17, 0.17, 0, 0.17],
  // The door's frame of sticks on its face, shut or open.
  leaf: [0.07, 0, 0.07, 0.07, 0, 0.07],
};

test("every level of every thatch piece lies within its collider and what its poles and tips stand out by", () => {
  for (const { name, form, shapes } of thatch) {
    const box = colliderBox(form);
    const proud = THATCH_PROUD[form.root === "always" ? "root" : form.layer]!;
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0, 0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) {
          over[a] = Math.max(over[a]!, box[a]! - at[a]!);
          over[a + 3] = Math.max(over[a + 3]!, at[a]! - box[a + 3]!);
        }
      }
      over.forEach((most, k) => expect(most, `${name} level ${level} past its ${k < 3 ? "least" : "most"} ${"xyz"[k % 3]}`).toBeLessThanOrEqual(proud[k]! + 1e-9));
    });
  }
});

test("a textured level of a thatch piece that yields has a ring of vertices on each yield plane, and only what runs along it crosses it", () => {
  for (const { name, form, shapes } of thatch) {
    for (const [axis, at] of yieldPlanes(form)) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => p[axis]! - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          const crosses = side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6);
          if (crosses) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses ${"xyz"[axis]} = ${at}`).toBe(axis);
        }
        expect(on, `${name} level ${level}: vertices on ${"xyz"[axis]} = ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every thatch level is closed, looks outward and costs no more than a made piece may from its distance", () => {
  for (const mesh of tierShapes(THATCH, THATCHED)) {
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
    });
  }
});

test("thatch is cut out only in its tips: under 15 triangles in 100 of a finest level, and none from across a yard", () => {
  const cut = (shape: (typeof thatch)[number]["shapes"][number]): number => shape.faces.reduce((n, f) => n + (f.mat in THATCH_SOLIDS || !Object.values(THATCH_SOLIDS).includes(f.mat) ? 0 : f.points.length - 2), 0);
  for (const { name, shapes } of thatch) {
    expect(cut(shapes[0]!) / shapes[0]!.triangles, name).toBeLessThanOrEqual(0.15);
    for (const shape of shapes.slice(2)) expect(cut(shape), name).toBe(0);
    // A body wears its picture whole: every piece that is cut out anywhere has its solid twin too.
    if (cut(shapes[0]!) > 0 && name !== "ceiling") expect(shapes[0]!.faces.some((f) => f.mat in THATCH_SOLIDS), name).toBe(true);
  }
});

test("the thatch recipe makes the same mesh each time it is asked", () => {
  const [a, b] = [tierShapes(THATCH, THATCHED), tierShapes(THATCH, THATCHED)];
  expect(a.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(b.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});
