// The building pieces a tier's recipe makes (tools/pack/pieces): each level is built for its distance from the form's
// own numbers, so it must lie in the form's collider, carry the ring it yields at, and keep to the piece budget.

import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { Carved, type Vec } from "../../tools/pack/pieces/kit.ts";
import { TEXTURED, colliderBox, levelsOf, yieldPlanes } from "../../tools/pack/pieces/lod.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { THATCH, THATCH_FORMS, THATCH_SOLIDS } from "../../tools/pack/pieces/thatch.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";
import { METAL, bakeMetal, metalColours } from "../../tools/pack/pieces/metal.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";

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

// Metal (tools/pack/pieces/metal.ts): flat levels in two steel greys, the plate's faces the piece's own colour.

/** Metres a metal piece may stand out of its collider: a nut on a member that is flush with it. */
const METAL_PROUD = 0.015;
/** A metal door's pull and hinges stand off its face, as wood's do. */
const METAL_PROUD_LEAF = 0.045;
/** What metal aims at under the made piece's budget, by form and level: flat plate is cheap. */
const METAL_MOST: Record<string, readonly number[]> = { wall: [1300, 420, 96, 12], doorframe: [1500, 520, 140, 40, 12], windowframe: [1500, 520, 140, 40, 12], foundation: [900, 300, 48, 12], ceiling: [900, 260, 64, 12], pillar: [600, 200, 48, 12], door: [900, 300, 64, 12], door_open: [900, 300, 64, 12], stairs: [1400, 480, 124, 30, 12] };

const metalLevels = Object.entries(FORMS).map(([name, form]) => ({ name, form, shapes: levelsOf(METAL, name, form) }));

test("every metal level lies in its collider but for its nuts and a door's fittings", () => {
  for (const { name, form, shapes } of metalLevels) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      let most = 0;
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) most = Math.max(most, box[a]! - at[a]!, at[a]! - box[a + 3]!);
      }
      expect(most, `${name} level ${level}`).toBeLessThanOrEqual(form.layer === "leaf" ? METAL_PROUD_LEAF : METAL_PROUD);
      // Only the finest level has nuts: the rest stand in their colliders to the 2 mm a nosing overhangs.
      if (level > 0 && form.layer !== "leaf") expect(most, `${name} level ${level}`).toBeLessThanOrEqual(0.0021);
    });
  }
});

test("a near metal level has a ring on each yield plane, crossed only by prisms", () => {
  for (const { name, form, shapes } of metalLevels) {
    for (const [axis, at] of yieldPlanes(form)) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => p[axis]! - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          if (side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6)) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses ${"xyz"[axis]} = ${at}`).toBe(axis);
        }
        expect(on, `${name} level ${level}: vertices on ${"xyz"[axis]} = ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("a metal wall ends flat on its collider's ends at every level", () => {
  for (const { name, form, shapes } of metalLevels.filter((l) => l.form.layer === "wall")) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const xs = shape.corners().map((p) => p[0]);
      expect([name, level, Math.min(...xs), Math.max(...xs)]).toEqual([name, level, box[0], box[3]]);
    });
  }
});

test("every metal level is closed, flat and within what metal aims at", () => {
  for (const mesh of bakeMetal(FORMS)) {
    const aim = METAL_MOST[mesh.id.slice(5, -6)]!;
    expect(mesh.lods.length, mesh.id).toBe(aim.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(aim[level]!, MADE_PIECE_TRIANGLES[level]![1]));
      expect(lod.uvs, `${mesh.id} level ${level} is flat`).toBeUndefined();
    });
  }
});

test("a metal piece is two-toned: plate in its own colour, frame a fixed grey", () => {
  const colour = metalColours();
  expect([colour("plate"), colour("frame")]).toEqual([REGION_BASE, 91]);
  for (const mesh of bakeMetal(FORMS)) {
    // To the level its frame is drawn at; past it a slab or a pillar is a box of one of the two.
    mesh.lods.slice(0, 3).forEach((lod, level) => {
      const used = new Set(lod.colors);
      expect([mesh.id, level, used.has(REGION_BASE), used.has(91)]).toEqual([mesh.id, level, true, true]);
    });
    // Outer edges are said where a wall is seen close, in the byte a static's corner has, and nowhere past it.
    expect([mesh.id, mesh.lods[0]!.bones!.some((b) => b >> 2 !== 0), mesh.lods[mesh.lods.length - 1]!.bones]).toEqual([mesh.id, true, undefined]);
  }
});

test("the metal recipe makes the same mesh each time it is asked", () => {
  const [a, b] = [bakeMetal(FORMS), bakeMetal(FORMS)];
  expect(a.map((m) => m.lods.map((l) => [Bun.hash(l.positions), Bun.hash(l.bones ?? new Uint8Array(0))]))).toEqual(b.map((m) => m.lods.map((l) => [Bun.hash(l.positions), Bun.hash(l.bones ?? new Uint8Array(0))])));
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
