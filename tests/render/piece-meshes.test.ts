// The building pieces a tier's recipe makes (tools/pack/pieces): each level is built for its distance from the form's
// own numbers, so it must lie in the form's collider, carry the ring it yields at, and keep to the piece budget.

import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { Carved, type Vec } from "../../tools/pack/pieces/kit.ts";
import { TEXTURED, colliderBox, levelsOf, yieldPlanes } from "../../tools/pack/pieces/lod.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
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

// Stone. Its walls end flat at their box for a quoin joint to butt against, so its ends have no margin.

/** Metres a stone mesh may stand out of its collider: a jamb or a lintel proud of the wall, a plinth stone's foot, a pillar block's crown. */
const STONE_PROUD = 0.04;
/** A window's oak sill stands further out of the wall's face. */
const STONE_SILL = 0.05;

const stone = Object.entries(FORMS).map(([name, form]) => ({ name, form, shapes: levelsOf(STONE, name, form) }));

test("every level of every stone piece lies within its collider and its margin, and a wall ends at its box", () => {
  for (const { name, form, shapes } of stone) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) over[a] = Math.max(over[a]!, box[a]! - at[a]!, at[a]! - box[a + 3]!);
      }
      over.forEach((most, a) => {
        const margin = form.layer === "wall" ? [0, STONE_PROUD, STONE_SILL][a]! : STONE_PROUD;
        expect(most, `${name} level ${level} along ${"xyz"[a]}`).toBeLessThanOrEqual(margin + 1e-9);
      });
    });
  }
});

test("a textured stone level that yields has corners on each yield ring, and only what is pulled back whole crosses it", () => {
  for (const { name, form, shapes } of stone) {
    for (const [axis, at] of yieldPlanes(form)) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => p[axis]! - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          if (side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6)) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses ${"xyz"[axis]} = ${at}`).toBe(axis);
        }
        expect(on, `${name} level ${level}: corners on ${"xyz"[axis]} = ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every stone level is closed, looks outward and costs no more than a made piece may from its distance", () => {
  for (const mesh of tierShapes(STONE, FORMS)) {
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
    });
  }
});

test("the stone recipe makes the same mesh each time it is asked", () => {
  const [a, b] = [tierShapes(STONE, FORMS), tierShapes(STONE, FORMS)];
  expect(a.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(b.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

test("a stone wall's flat sheet shades each stone round, and its plain box does not", () => {
  const [, sheet, plain] = stone.find((s) => s.name === "wall")!.shapes.map((shape) => shape.lod(["masonry"], () => 0));
  // Degrees the normals of a level's front face stand off it, at most.
  const bent = (lod: typeof sheet): number => {
    let most = 0;
    for (let v = 0; v < lod!.positions.length / 3; v++) {
      const n = lod!.normals!.subarray(v * 3, v * 3 + 3);
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
      if (lod!.positions[v * 3 + 2]! > 0.09 && n[2]! > 0.5) most = Math.max(most, (Math.acos(Math.min(1, n[2]!)) * 180) / Math.PI);
    }
    return most;
  };
  expect(bent(sheet)).toBeGreaterThan(10);
  expect(bent(plain)).toBeLessThan(0.01);
});

test("welding gives a face the corners of the others along its sides, and the faces close", () => {
  // A box whose top is two faces side by side: the sides under their seam have no corner there until they are welded.
  const quad = (points: Vec[]) => ({ points, uvs: points.map(() => [0, 0] as const), mat: "masonry" });
  const shape = new Carved();
  shape.face(quad([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]])).face(quad([[1, 0, 1], [2, 0, 1], [2, 1, 1], [1, 1, 1]]));
  shape.face(quad([[0, 1, 0], [2, 1, 0], [2, 0, 0], [0, 0, 0]]));
  shape.face(quad([[0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1]])).face(quad([[2, 1, 0], [0, 1, 0], [0, 1, 1], [2, 1, 1]]));
  shape.face(quad([[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]])).face(quad([[2, 0, 0], [2, 1, 0], [2, 1, 1], [2, 0, 1]]));
  expect(measureSurface(shape.lod(null, () => 0)).holes).toBeGreaterThan(0);
  shape.weld(0);
  const s = measureSurface(shape.lod(null, () => 0));
  expect([s.holes, s.flipped, s.insideOut, shape.triangles]).toEqual([0, 0, 0, 16]);
});
