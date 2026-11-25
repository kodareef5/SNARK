// The building pieces a tier's recipe makes (tools/pack/pieces): each level is built for its distance from the form's
// own numbers, so it must lie in the form's collider, carry the ring it yields at, and keep to the piece budget.

import { expect, test } from "bun:test";
import { ALL_FORMS, FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { Carved, Shape, clip, dot, planeAt, slice, type Vec } from "../../tools/pack/pieces/kit.ts";
import { TEXTURED, colliderBox, levelsOf, planOf, yieldPlanes, yieldSlants } from "../../tools/pack/pieces/lod.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { THATCH, THATCH_FORMS, THATCH_SOLIDS } from "../../tools/pack/pieces/thatch.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { tierShapes, trimShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD, WOOD_JOINTED } from "../../tools/pack/pieces/wood.ts";
import { METAL, bakeMetal, metalColours } from "../../tools/pack/pieces/metal.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { FACE_PLAIN, FACE_WEARS } from "../../client/core/render/piece-fit.ts";

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

test("a metal piece is two-toned: plate in its own colour, frame and trim a fixed dark slate", () => {
  const colour = metalColours();
  expect([colour("plate"), colour("frame"), colour("trim"), colour("bolt")]).toEqual([REGION_BASE, 4, 4, 96]);
  // The plate's own colour is the tier's, a lighter steel grey than the slate.
  const tier = CORE_CONTENT.find((d) => d.id === "core:wall_metal");
  expect(tier?.type === "structure" && tier.color).toBe(90);
  for (const mesh of bakeMetal(FORMS)) {
    // To the level its frame is drawn at; past it a slab or a pillar is a box of one of the two.
    mesh.lods.slice(0, 3).forEach((lod, level) => {
      const used = new Set(lod.colors);
      expect([mesh.id, level, used.has(REGION_BASE), used.has(4)]).toEqual([mesh.id, level, true, true]);
    });
    // Outer edges are said where a wall is seen close, in the byte a static's corner has, and nowhere past it.
    expect([mesh.id, mesh.lods[0]!.bones!.some((b) => ((b >> 2) & 15) !== 0), mesh.lods[mesh.lods.length - 1]!.bones!.some((b) => (b & 63) !== 0)]).toEqual([mesh.id, true, false]);
    // Every level says which faces wear the piece's material in the mesh's colour: all but the plate's, and all of those but a wall's frame clear of joints.
    for (const lod of mesh.lods) {
      for (let v = 0; v < lod.colors.length; v++) {
        const flags = lod.bones![v]! & (FACE_WEARS | FACE_PLAIN);
        expect(lod.colors[v] === REGION_BASE ? flags === 0 : flags === FACE_WEARS || flags === (FACE_WEARS | FACE_PLAIN)).toBe(true);
      }
    }
  }
  const wall = bakeMetal(FORMS).find((m) => m.id === "core:wall_metal")!.lods[0]!;
  expect(wall.bones!.some((b) => (b & (FACE_WEARS | FACE_PLAIN)) === FACE_WEARS)).toBe(true);
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

// The forms past the first nine, in wood, and wood's trims. Another tier holds its own to the same.

const PLANNED: Record<string, FormDef> = PLANNED_FORMS;
const planned = Object.entries(PLANNED).map(([name, form]) => ({ name, form, shapes: levelsOf(WOOD, name, form) }));
const isRoof = (form: FormDef): boolean => form.corner !== undefined && form.span === 0;
/** A roof's lowest course runs out 0.30 m past a low side, measured level. Its eave board stands 0.065 m over its plane, and a hip's roll climbs at its high corner to the height of a ridge's capping, 0.13 m over the faces that fall away beside it. */
const EAVE = 0.3;
const ROOF_PROUD = 0.13;
/** A low side's plate bears on the wall under it, 0.028 m under the roof's own level, as a wall's sill reaches under its foot. */
const ROOF_SEAT = 0.03;
/**
 * What each new wood form's levels cost on 2026-11-24. A change may lower a number and may not raise one. The roofs
 * were 812, 1378, 1074, 942 and 886 at the finest and 60 or 44 at the third, before their rims were boards on their
 * sides' own lines: the third level gained a plate and an eave of its own to each low side.
 */
const WOOD_NEW_MOST: Record<string, readonly number[]> = {
  half_wall: [948, 252, 120, 28, 12],
  quarter_wall: [596, 156, 96, 28, 12],
  railing: [508, 172, 92, 24, 12],
  corner_pillar: [320, 124, 60, 12],
  thin_pillar: [320, 124, 60, 12],
  beam: [212, 28, 28, 12],
  ramp: [1080, 148, 76, 8],
  triangle_foundation: [770, 156, 20, 8],
  triangle_ceiling: [952, 254, 48, 8],
  quarter_foundation: [772, 204, 72, 12],
  roof: [638, 200, 84, 12],
  roof_hip: [1162, 447, 108, 12],
  roof_valley: [910, 366, 60, 12],
  triangle_roof: [718, 196, 84, 8],
  triangle_roof_low: [620, 128, 44, 8],
  sloped_wall_left: [728, 224, 122, 8],
  sloped_wall_right: [728, 224, 122, 8],
  fence_foundation: [256, 56, 28, 12],
  trapdoor_frame: [1208, 384, 112, 32, 12],
  trapdoor: [420, 204, 36, 12],
  ladder: [208, 144, 84, 24, 12],
  double_doorway: [1564, 468, 148, 28, 12],
  large_wall: [1576, 280, 144, 28, 12],
  gateway: [720, 104, 68, 28, 12],
  gate: [1212, 300, 96, 12],
};

/** A roof's own surface over a point of its plan, in the engine's frame about its collider's origin: the plane of the face the point lies over. */
function roofHeight(form: FormDef, x: number, z: number): number {
  const plan = form.outline.map(([u, v]) => [u - form.at[0], v - form.at[2]] as const);
  const tops = form.corner!.map((h) => h - form.at[1]);
  const n = plan.length;
  const odd = n === 4 ? tops.findIndex((h, k) => tops.filter((t) => Math.abs(t - h) < 1e-9).length === 1 && tops.filter((t) => Math.abs(t - tops[(k + 1) % n]!) < 1e-9).length === 3) : -1;
  const plane = (list: number[]): number => {
    const [a, b, c] = list.map((k) => [plan[k]![0], tops[k]!, plan[k]![1]] as const);
    const nrm = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    return a[1] - (nrm[0]! * (x - a[0]) + nrm[2]! * (z - a[2])) / nrm[1]!;
  };
  if (odd < 0) return plane([0, 1, 2]);
  const [h1, h2] = [plane([odd, (odd + 1) % 4, (odd + 2) % 4]), plane([odd, (odd + 2) % 4, (odd + 3) % 4])];
  // A hip is the lower of its two faces everywhere, and a valley the higher.
  return tops[odd]! === Math.max(...tops) ? Math.min(h1, h2) : Math.max(h1, h2);
}

test("every level of every new wood form lies in its form's box and the margin its kind is given", () => {
  for (const { name, form, shapes } of planned) {
    const box = colliderBox(form);
    const along = form.plane === "upright" ? 0 : 2;
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0, 0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) {
          over[a] = Math.max(over[a]!, box[a]! - at[a]!);
          over[a + 3] = Math.max(over[a + 3]!, at[a]! - box[a + 3]!);
        }
        // A roof stands no further over its own plane than its courses are thick, whatever its box holds.
        if (isRoof(form)) expect(at[1]! - roofHeight(form, at[0]!, at[2]!), `${name} level ${level} over its plane`).toBeLessThanOrEqual(ROOF_PROUD);
      }
      over.forEach((most, k) => {
        const a = k % 3;
        // An eave's boards run out past a low side, and where that side meets a sloped one, as far along it.
        const margin = isRoof(form) ? (a === 1 ? (k === 1 ? ROOF_SEAT : ROOF_PROUD) : EAVE + 0.001) : form.layer === "leaf" ? PROUD_LEAF : form.layer === "wall" && a === along ? PROUD_ENDS : PROUD;
        expect(most, `${name} level ${level} past its ${k < 3 ? "least" : "most"} ${"xyz"[a]}`).toBeLessThanOrEqual(margin);
      });
    });
  }
});

test("a textured level of a new wood form that yields has a ring on each plane it yields at, a triangle's three among them", () => {
  for (const { name, form, shapes } of planned) {
    const planes = [...yieldPlanes(form).map(([axis, at]) => ({ n: [0, 1, 2].map((a) => (a === axis ? 1 : 0)) as unknown as Vec, at, axis })), ...yieldSlants(form).map(([n, at]) => ({ n, at, axis: -1 }))];
    if (form.yieldBand > 0 && form.plane !== "across") expect(planes.length, name).toBeGreaterThanOrEqual(form.plane === "upright" ? 2 : form.outline.length);
    for (const { n, at, axis } of planes) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => dot(n, p) - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          // Past a ring that runs along no axis, a point may have been made one with its neighbour a fifth of a millimetre off.
          const slack = axis < 0 ? 3e-4 : 1e-6;
          if (side.some((d) => d > slack) && side.some((d) => d < -slack)) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses the ring at ${at}`).toBe(axis < 0 ? -2 : axis);
        }
        expect(on, `${name} level ${level}: vertices on the ring at ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every new wood level is closed, looks outward and costs no more than a made piece may or than it did", () => {
  const meshes = tierShapes(WOOD, PLANNED);
  expect(tierShapes(WOOD, { ...FORMS, ...PLANNED }).length).toBe(34);
  for (const mesh of meshes) {
    const most = WOOD_NEW_MOST[mesh.id.slice(5, -5)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, MADE_PIECE_TRIANGLES[level]![1]));
    });
  }
  const again = tierShapes(WOOD, PLANNED);
  expect(meshes.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(again.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

/** The rows past the 25: the leaves stood open, and the double door. What each costs in wood, as the planned forms' table has theirs. */
const WOOD_LEAVES_MOST: Record<string, readonly number[]> = {
  trapdoor_open: [420, 204, 36, 12],
  double_door: [1512, 440, 96, 24, 12],
  double_door_open: [1512, 440, 96, 24, 8],
  gate_open: [1184, 288, 96, 24, 8],
};

test("wood's open leaves and its double door are closed, within their rows' boxes and a leaf's margin, and under budget", () => {
  const rows: Record<string, FormDef> = Object.fromEntries(Object.keys(WOOD_LEAVES_MOST).map((name) => [name, (ALL_FORMS as Record<string, FormDef>)[name]!]));
  for (const mesh of tierShapes(WOOD, rows)) {
    const name = mesh.id.slice(5, -5);
    const most = WOOD_LEAVES_MOST[name]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, MADE_PIECE_TRIANGLES[level]![1]));
    });
    // Each leaf of a pair in its own box: the row's box holds both and the air between them.
    const box = colliderBox(rows[name]!);
    for (const shape of levelsOf(WOOD, name, rows[name]!)) for (const p of shape.corners()) {
      const at = [p[0], p[2], -p[1]];
      for (let a = 0; a < 3; a++) expect(Math.max(box[a]! - at[a]!, at[a]! - box[a + 3]!), `${name} along ${"xyz"[a]}`).toBeLessThanOrEqual(PROUD_LEAF);
      const pair = rows[name]!.pair;
      if (pair !== undefined) expect(Math.abs(at[0]!), `${name}: between its leaves`).toBeGreaterThanOrEqual(box[3]! - rows[name]!.thick - PROUD_LEAF);
    }
  }
  // An open hatch is the shut one and a gate's open leaves are its shut ones, less the bar that is lifted out.
  const count = (name: string): number => levelsOf(WOOD, name, (ALL_FORMS as Record<string, FormDef>)[name]!)[0]!.triangles;
  expect([count("trapdoor_open"), count("double_door_open")]).toEqual([count("trapdoor"), count("double_door")]);
  expect(count("gate") - count("gate_open")).toBe(28);
});

test("a sloped wall's two hands are each other in a mirror, point for point", () => {
  const [left, right] = ["sloped_wall_left", "sloped_wall_right"].map((name) => planned.find((p) => p.name === name)!.shapes);
  left!.forEach((shape, level) => {
    const name = (p: Vec, flip: number): string => [flip * p[0], p[1], p[2]].map((c) => (Math.round(c * 1e6) / 1e6 || 0).toFixed(6)).join();
    expect([...new Set(shape.corners().map((p) => name(p, -1)))].sort()).toEqual([...new Set(right![level]!.corners().map((p) => name(p, 1)))].sort());
    expect(shape.triangles).toBe(right![level]!.triangles);
  });
});

test("with no strips, every wood wall ends flat on its collider's ends at every level", () => {
  // What WOOD becomes when its one switch is turned (tools/pack/pieces/wood.ts): the joints stand where the strips did.
  for (const [name, form] of Object.entries({ ...FORMS, ...PLANNED } as Record<string, FormDef>)) {
    if (form.layer !== "wall") continue;
    const box = colliderBox(form);
    levelsOf(WOOD_JOINTED, name, form).forEach((shape, level) => {
      const xs = shape.corners().map((p) => p[0]);
      // To the 2 mm a hewn corner post strays on the finest level, and to the last bit past it.
      const slack = level === 0 ? 0.002 : 1e-9;
      expect(Math.abs(Math.min(...xs) - box[0]), `${name} level ${level}, its -x end`).toBeLessThanOrEqual(slack);
      expect(Math.abs(Math.max(...xs) - box[3]), `${name} level ${level}, its +x end`).toBeLessThanOrEqual(slack);
    });
    // And with them it stands past its ends, which is all the switch changes.
    const xs = levelsOf(WOOD, name, form)[0]!.corners().map((p) => Math.abs(p[0]));
    if (form.outline.length === 4 && form.thick === 0.2 && (form.cells?.length ?? 1) < 3) expect(Math.max(...xs), name).toBeGreaterThan(box[3] + 0.05);
  }
});

test("wood's trims are the five the client looks for, within their budgets, and closed but where two triangles are a sheet", () => {
  const trims = trimShapes(WOOD);
  expect(trims.map((m) => m.id)).toEqual(["core:joint_sq_wood", "core:joint_r15_wood", "core:joint_r21_wood", "core:skirt_wood", "core:ridge_wood"]);
  for (const mesh of trims) {
    const most = TRIM_TRIANGLES[mesh.id.slice(5, -5)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(most[level]!);
      expect([mesh.id, level, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0]);
      if (lod.indices.length / 3 > 2) expect([mesh.id, level, s.holes]).toEqual([mesh.id, level, 0]);
    });
  }
});

test("a joint is cut to a lower wall by its rings: its shaft is one section, and its head and pegs lie inside it", () => {
  const reach: Record<string, number> = { joint_sq: 0.15 * Math.SQRT2, joint_r15: 0.15, joint_r21: 0.21 };
  for (const [name, shapes] of Object.entries(WOOD.trims!())) {
    if (!(name in reach)) continue;
    const finest = shapes[0]!.corners();
    // It stands on its corner from the level to a centimetre over a storey.
    expect([name, Math.min(...finest.map((p) => p[2])), Math.max(...finest.map((p) => p[2]))]).toEqual([name, 0, 3.01]);
    for (const cut of [0.76, 1.51, 2.26]) {
      // A ring at each height the client clamps it to (client/core/render/piece-fit.ts): n quarter storeys and a centimetre.
      expect(finest.filter((p) => Math.abs(p[2] - cut) < 1e-9).length, `${name} at ${cut}`).toBeGreaterThanOrEqual(12);
      // Clamped there, what was over the ring lies inside the ring's own outline, so the post ends in a level top and no more.
      const ring = finest.filter((p) => Math.abs(p[2] - cut) < 1e-9);
      const far = Math.max(...ring.map((p) => Math.hypot(p[0], p[1])));
      for (const p of finest) if (p[2] > cut && p[2] < 2.7) expect(Math.hypot(p[0], p[1]), `${name} over ${cut}`).toBeLessThanOrEqual(far + 0.004);
    }
    for (const p of finest) expect(Math.hypot(p[0], p[1]), name).toBeLessThanOrEqual(reach[name]! + 0.011);
    // Its head is drawn in, so the head folds flat onto the shaft.
    for (const p of finest) if (p[2] > 3) expect(Math.hypot(p[0], p[1]), name).toBeLessThan(reach[name]! * 0.81);
  }
});

test("a skirt hangs 2.4 m from the middle of a side, 0.12 m out, and a ridge lies along its line", () => {
  const box = (name: string, level = 0): number[] => {
    const p = trimShapes(WOOD).find((m) => m.id === `core:${name}_wood`)!.lods[level]!.positions;
    return [0, 1, 2].flatMap((a) => [Math.min(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!)), Math.max(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!))]).map((v) => Math.round(v * 1e4) / 1e4);
  };
  // In the engine's frame: +X along the side, +Y up from the foundation's top, +Z outward. Its pegs stand a centimetre proud.
  expect(box("skirt").map((v) => v || 0)).toEqual([-1.5, 1.5, -2.4, 0, 0, 0.13]);
  expect(box("skirt", 1).map((v) => v || 0)).toEqual([-1.5, 1.5, -2.4, 0, 0, 0.12]);
  const ridge = box("ridge");
  expect([ridge[0], ridge[1]]).toEqual([-1.5, 1.5]);
  expect(ridge[3]!).toBeLessThanOrEqual(0.13);
  expect(Math.max(-ridge[4]!, ridge[5]!)).toBeLessThanOrEqual(0.22);
});

test("the kit cuts a solid on a slant and closes it, and a ring on a slant loses nothing", () => {
  const map = () => ["m", (p: Vec) => [p[0], p[1]] as const] as const;
  const shape = new Shape().box([0, 0, 0], [1, 1, 1], map).box([2, 0, 0], [3, 1, 1], map);
  const volume = (s: Shape): number => {
    const c = s.corners();
    let sum = 0;
    for (let t = 0; t < c.length; t += 3) sum += dot(c[t]!, [c[t + 1]![1] * c[t + 2]![2] - c[t + 1]![2] * c[t + 2]![1], c[t + 1]![2] * c[t + 2]![0] - c[t + 1]![0] * c[t + 2]![2], c[t + 1]![0] * c[t + 2]![1] - c[t + 1]![1] * c[t + 2]![0]]) / 6;
    return sum;
  };
  expect(volume(shape)).toBeCloseTo(2, 9);
  slice(shape, planeAt([0.5, 0.5, 0.5], [1, 2, 3]));
  expect([volume(shape).toFixed(9), measureSurface(shape.lod(null, () => 0)).holes]).toEqual(["2.000000000", 0]);
  // Half of the first box is cut off through its middle, and none of the second, which lies under the plane.
  clip(shape, planeAt([0.5, 0.5, 0.5], [-1, 0, 1]));
  const s = measureSurface(shape.lod(null, () => 0));
  expect([volume(shape).toFixed(9), s.holes, s.flipped, s.insideOut]).toEqual(["1.500000000", 0, 0, 0]);
});

void planOf;

// Thatch's share of the forms past the first nine, its trims, and the switch that takes a wall's own post away.

import { THATCH_JOINTED, THATCH_PLANNED } from "../../tools/pack/pieces/thatch.ts";

const THATCH_NEW: Record<string, FormDef> = Object.fromEntries(THATCH_PLANNED.map((name) => [name, PLANNED[name]!]));
const thatchNew = Object.entries(THATCH_NEW).map(([name, form]) => ({ name, form, shapes: levelsOf(THATCH, name, form) }));
/** What each new thatch form's levels cost on 2026-11-24. A change may lower a number and may not raise one. */
const THATCH_NEW_MOST: Record<string, readonly number[]> = {
  roof: [694, 104, 60, 12],
  roof_hip: [1020, 148, 60, 12],
  roof_valley: [592, 108, 60, 12],
  sloped_wall_left: [636, 162, 72, 8],
  sloped_wall_right: [636, 162, 72, 8],
  half_wall: [820, 112, 72, 12],
  railing: [380, 108, 68, 24],
};
/** A thatch roof's tips reach 0.30 m past a low side and hang 0.10 m under its slab; its top course swells 0.045 m over its plane at its highest contour, and its eave course stands 0.08 m over it. */
const THATCH_EAVE = 0.3;
const THATCH_ROOF_OVER = 0.08;
const THATCH_ROOF_UNDER = 0.1;
/** A fence's rails lie on the front of its posts, and their lashings 0.045 m past its collider's face. */
const THATCH_FENCE = 0.05;

/** A roof's top over a point of its plan, about its collider's origin: the top of its box at each corner, whether its slab hangs under its corner heights or stands on them. */
function thatchRoofTop(form: FormDef, x: number, z: number): number {
  const lift = colliderBox(form)[4] - (Math.max(...form.corner!) - form.at[1]);
  return roofHeight(form, x, z) + lift;
}

test("every level of every new thatch form lies in its form's box and the margin its kind is given", () => {
  for (const { name, form, shapes } of thatchNew) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0, 0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) {
          over[a] = Math.max(over[a]!, box[a]! - at[a]!);
          over[a + 3] = Math.max(over[a + 3]!, at[a]! - box[a + 3]!);
        }
        // Over the plan itself a roof stands no further over its top than its eave course is thick.
        if (isRoof(form) && Math.abs(at[0]!) <= 1.5 && Math.abs(at[2]!) <= 1.5) expect(at[1]! - thatchRoofTop(form, at[0]!, at[2]!), `${name} level ${level} over its plane`).toBeLessThanOrEqual(THATCH_ROOF_OVER);
      }
      // A roof by its eaves; a fence by its lashings; a low wall as a wall, by its post, its tips and its rails.
      const proud = isRoof(form) ? [THATCH_EAVE, THATCH_ROOF_UNDER, THATCH_EAVE, THATCH_EAVE, 0.05, THATCH_EAVE] : name === "railing" ? [0, 0, THATCH_FENCE, 0, 0, THATCH_FENCE] : THATCH_PROUD.wall!;
      over.forEach((most, k) => expect(most, `${name} level ${level} past its ${k < 3 ? "least" : "most"} ${"xyz"[k % 3]}`).toBeLessThanOrEqual(proud[k]! + 1e-9));
    });
  }
});

test("a textured level of a new thatch form that yields has a ring on each plane it yields at, crossed only by what runs along it", () => {
  for (const { name, form, shapes } of thatchNew) {
    const planes = yieldPlanes(form);
    expect(planes.length, name).toBe(form.plane === "upright" ? 2 : 4);
    for (const [axis, at] of planes) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => p[axis]! - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          if (side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6)) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses ${"xyz"[axis]} = ${at}`).toBe(axis);
        }
        // A gable has nothing at its low end's ring but its foot: its top comes down to its foot there.
        expect(on, `${name} level ${level}: vertices on ${"xyz"[axis]} = ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every new thatch level is closed, looks outward and costs no more than it did, a roof no more than a flat ceiling and a tenth", () => {
  const meshes = tierShapes(THATCH, THATCH_NEW);
  const flat = thatch.find((p) => p.name === "ceiling")!.shapes.map((shape) => shape.triangles);
  expect(flat).toEqual([1032, 204, 68, 12]);
  for (const mesh of meshes) {
    const name = mesh.id.slice(5, -7);
    const most = THATCH_NEW_MOST[name]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, MADE_PIECE_TRIANGLES[level]![1]));
      if (isRoof(THATCH_NEW[name]!)) expect(lod.indices.length / 3, `${mesh.id} level ${level} beside a ceiling`).toBeLessThanOrEqual(flat[level]! * 1.1);
    });
  }
  const again = tierShapes(THATCH, THATCH_NEW);
  expect(meshes.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(again.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

test("a new thatch form is cut out only in its tips: under 15 triangles in 100 at the finest, none from across a yard, and a level wears three materials at most", () => {
  const cut = (shape: Shape): number => shape.faces.reduce((n, f) => n + (f.mat === "thatch" || f.mat === "door" ? f.points.length - 2 : 0), 0);
  for (const { name, shapes } of thatchNew) {
    expect(cut(shapes[0]!) / shapes[0]!.triangles, name).toBeLessThanOrEqual(0.15);
    for (const shape of shapes.slice(2)) expect(cut(shape), name).toBe(0);
    expect(new Set(shapes.slice(0, TEXTURED).flatMap((shape) => shape.faces.map((f) => f.mat))).size, name).toBeLessThanOrEqual(3);
  }
  // Only an eave has tips: a valley, which has no low side, has none.
  expect(cut(thatchNew.find((p) => p.name === "roof")!.shapes[0]!)).toBeGreaterThan(0);
  expect(cut(thatchNew.find((p) => p.name === "roof_valley")!.shapes[0]!)).toBe(0);
});

test("a thatch gable's two hands are each other in a mirror, point for point", () => {
  for (const recipe of [THATCH, THATCH_JOINTED]) {
    const [left, right] = ["sloped_wall_left", "sloped_wall_right"].map((name) => levelsOf(recipe, name, THATCH_NEW[name]!));
    left!.forEach((shape, level) => {
      const name = (p: Vec, flip: number): string => [flip * p[0], p[1], p[2]].map((c) => (Math.round(c * 1e6) / 1e6 || 0).toFixed(6)).join();
      expect([...new Set(shape.corners().map((p) => name(p, -1)))].sort()).toEqual([...new Set(right![level]!.corners().map((p) => name(p, 1)))].sort());
      expect(shape.triangles).toBe(right![level]!.triangles);
    });
  }
});

test("a thatch roof reads its row: let down by its slab's thickness, as the row was, it is the same roof that much lower", () => {
  // The row stands a roof on its level since 2026-11-24: its top and its origin are a slab's thickness over where they hung, and nothing is under the level.
  const row = THATCH_NEW.roof_hip!;
  const hung: FormDef = { ...row, corner: row.corner!.map((h) => h - row.thick), at: [row.at[0], row.at[1] - row.thick, row.at[2]] };
  expect(colliderBox(hung)).toEqual(colliderBox(row));
  const [as, lower] = [levelsOf(THATCH, "roof_hip", row), levelsOf(THATCH, "roof_hip", hung)];
  as.forEach((shape, level) => expect(Bun.hash(Float64Array.from(lower[level]!.corners().flat())), `level ${level}`).toBe(Bun.hash(Float64Array.from(shape.corners().flat()))));
});

test("with no post of its own, every thatch wall ends on its collider's ends, and with one it stands past its left", () => {
  // What THATCH becomes when its one switch is turned (tools/pack/pieces/thatch.ts): the corner's pole stands where the post did.
  const walls: Record<string, FormDef> = { wall: FORMS.wall, doorframe: FORMS.doorframe, half_wall: THATCH_NEW.half_wall!, sloped_wall_left: THATCH_NEW.sloped_wall_left!, sloped_wall_right: THATCH_NEW.sloped_wall_right! };
  for (const [name, form] of Object.entries(walls)) {
    const box = colliderBox(form);
    levelsOf(THATCH_JOINTED, name, form).forEach((shape, level) => {
      const xs = shape.corners().map((p) => p[0]);
      // To the 2 cm a rod's axe-cut end runs past its length on the finest level, a millimetre on the next, and to the last bit past it.
      const slack = level === 0 ? 0.02 : level === 1 ? 1e-3 : 1e-9;
      expect(Math.abs(Math.min(...xs) - box[0]), `${name} level ${level}, its -x end`).toBeLessThanOrEqual(slack);
      expect(Math.abs(Math.max(...xs) - box[3]), `${name} level ${level}, its +x end`).toBeLessThanOrEqual(slack);
    });
    // With its post a wall stands 0.11 m and more past its left end on every level drawn with materials, and a gable has half a post on its high end.
    if (!name.startsWith("sloped")) levelsOf(THATCH, name, form).slice(0, TEXTURED).forEach((shape, level) => expect(box[0] - Math.min(...shape.corners().map((p) => p[0])), `${name} level ${level}`).toBeGreaterThan(0.11));
    else expect(levelsOf(THATCH, name, form)[0]!.triangles, name).toBeGreaterThan(levelsOf(THATCH_JOINTED, name, form)[0]!.triangles);
  }
  // Nothing else of the tier changes with the switch.
  for (const name of ["foundation", "ceiling", "door", "door_open", "roof", "roof_hip", "roof_valley", "railing"]) {
    const form = (name in FORMS ? (FORMS as Record<string, FormDef>)[name] : THATCH_NEW[name])!;
    expect(levelsOf(THATCH_JOINTED, name, form).map((shape) => Bun.hash(Float64Array.from(shape.corners().flat()))), name).toEqual(levelsOf(THATCH, name, form).map((shape) => Bun.hash(Float64Array.from(shape.corners().flat()))));
  }
});

test("thatch's trims are the five the client looks for, within their budgets, and closed but where two triangles are a sheet", () => {
  const trims = trimShapes(THATCH);
  expect(trims.map((m) => m.id)).toEqual(["core:joint_sq_thatch", "core:joint_r15_thatch", "core:joint_r21_thatch", "core:skirt_thatch", "core:ridge_thatch"]);
  for (const mesh of trims) {
    const most = TRIM_TRIANGLES[mesh.id.slice(5, -7)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(most[level]!);
      expect([mesh.id, level, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0]);
      if (lod.indices.length / 3 > 2) expect([mesh.id, level, s.holes]).toEqual([mesh.id, level, 0]);
    });
  }
  // The pole of a square corner is the pole of a wide one: one mesh under two names.
  const [sq, r15] = [trims[0]!, trims[1]!];
  expect(sq.lods.map((l) => Bun.hash(l.positions))).toEqual(r15.lods.map((l) => Bun.hash(l.positions)));
  expect(trimShapes(THATCH_JOINTED).map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(trims.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

test("a thatch joint is a pole that thins upward, with a ring at each height it may be cut to and its lashing in its own skin", () => {
  const reach: Record<string, number> = { joint_sq: 0.112, joint_r15: 0.112, joint_r21: 0.18 };
  for (const [name, shapes] of Object.entries(THATCH.trims!())) {
    if (!(name in reach)) continue;
    const finest = shapes[0]!.corners();
    expect([name, Math.min(...finest.map((p) => p[2])), Math.max(...finest.map((p) => p[2]))]).toEqual([name, 0, 3.01]);
    const far = (z: number): number => Math.max(...finest.filter((p) => Math.abs(p[2] - z) < 1e-9).map((p) => Math.hypot(p[0], p[1])));
    for (const cut of [0.76, 1.51, 2.26]) {
      // A ring of its eight sides at each height the client clamps it to (client/core/render/piece-fit.ts): n quarter storeys and a centimetre.
      expect(new Set(finest.filter((p) => Math.abs(p[2] - cut) < 1e-9).map((p) => p.join())).size, `${name} at ${cut}`).toBe(8);
      // Clamped there, what was over the ring lies inside the ring's own outline but for its cord, which is left a band round its top.
      for (const p of finest) if (p[2] > cut) expect(Math.hypot(p[0], p[1]), `${name} over ${cut}`).toBeLessThanOrEqual(far(cut) + (cut < 1 ? 0.0135 : 1e-9));
    }
    // It covers the 0.1 m square two walls leave at a corner out to its diagonal, on every level, whichever way it is turned by quarters.
    for (const shape of shapes.slice(0, 3)) {
      const ring = shape.corners().filter((p) => p[2] === 0).map((p) => [p[0], p[1]] as const);
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = [Math.cos(Math.PI / 4 + (d * Math.PI) / 2), Math.sin(Math.PI / 4 + (d * Math.PI) / 2)];
        expect(Math.max(...ring.map((q) => q[0] * dx + q[1] * dy)), `${name}: its reach along a diagonal`).toBeGreaterThanOrEqual(name === "joint_r21" ? 0.14 : 0.099);
      }
    }
    for (const p of finest) expect(Math.hypot(p[0], p[1]), name).toBeLessThanOrEqual(reach[name]! + 0.014);
    // Its head is drawn in, so the head folds flat onto the shaft.
    for (const p of finest) if (p[2] > 3) expect(Math.hypot(p[0], p[1]), name).toBeLessThan(reach[name]! * 0.76);
  }
});

test("a thatch skirt is a bank under the crib, 2.4 m down from the foundation's top and 0.12 m out, and a ridge lies along its line", () => {
  const box = (name: string, level = 0): number[] => {
    const p = trimShapes(THATCH).find((m) => m.id === `core:${name}_thatch`)!.lods[level]!.positions;
    return [0, 1, 2].flatMap((a) => [Math.min(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!)), Math.max(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!))]);
  };
  for (let level = 0; level < 4; level++) {
    const skirt = box("skirt", level);
    // In the engine's frame: +X along the side, +Y up from the foundation's top, +Z outward. Its top is the foundation's foot, a hand over it.
    expect([skirt[0], skirt[1], skirt[2]]).toEqual([-1.5, 1.5, -2.4000000953674316]);
    expect(skirt[3]!, `level ${level}`).toBeLessThanOrEqual(-0.375 + 0.035);
    expect(skirt[3]!, `level ${level}`).toBeGreaterThanOrEqual(-0.375);
    expect(skirt[4]!, `level ${level}`).toBeGreaterThanOrEqual(level < 3 ? 0 : 0.049);
    expect(skirt[5]!, `level ${level}`).toBeLessThanOrEqual(0.12);
    const ridge = box("ridge", level);
    expect([ridge[0], ridge[1]]).toEqual([-1.5, 1.5]);
    // It stands no higher than 0.11 m over the ridge's line and lies 0.27 m down each roof.
    expect(ridge[3]!, `level ${level}`).toBeLessThanOrEqual(0.111);
    expect(Math.max(-ridge[4]!, ridge[5]!), `level ${level}`).toBeLessThanOrEqual(0.2701);
  }
});

// Stone: the forms past the first nine, and stone's trims.

/** A stone roof's lowest course runs out as far as wood's, and stands as high over its plane: the two are built to one rule. */
const STONE_EAVE = 0.3;
const STONE_ROOF_PROUD = 0.09;
/** What each new stone form's levels cost on 2026-11-24. A change may lower a number and may not raise one. */
const STONE_NEW_MOST: Record<string, readonly number[]> = {
  half_wall: [768, 224, 40, 12],
  quarter_wall: [464, 144, 40, 12],
  railing: [284, 236, 140, 36],
  corner_pillar: [408, 52, 52, 12],
  thin_pillar: [360, 52, 52, 12],
  beam: [224, 76, 28, 12],
  ramp: [1580, 520, 8, 8],
  triangle_foundation: [620, 56, 8, 8],
  triangle_ceiling: [636, 238, 62, 8],
  quarter_foundation: [408, 44, 12, 12],
  roof: [702, 284, 60, 12],
  roof_hip: [1380, 524, 60, 12],
  roof_valley: [1062, 394, 60, 12],
  triangle_roof: [962, 354, 44, 8],
  triangle_roof_low: [866, 252, 44, 8],
  sloped_wall_left: [462, 150, 48, 8],
  sloped_wall_right: [462, 150, 48, 8],
  fence_foundation: [252, 52, 28, 12],
  trapdoor_frame: [556, 176, 104, 32],
  trapdoor: [276, 136, 60, 12],
  ladder: [208, 144, 84, 24],
  double_doorway: [1572, 488, 116, 36, 12],
  large_wall: [1412, 536, 88, 12],
  gateway: [1120, 300, 52, 36, 12],
  gate: [864, 276, 96, 12],
};
/** Stone's trims at each level on the same day, under what a trim may cost. */
const STONE_TRIM_MOST: Record<string, readonly number[]> = { joint_sq: [132, 36, 12, 8], joint_r15: [116, 44, 12, 8], joint_r21: [116, 44, 12, 8], skirt: [104, 28, 8, 2], ridge: [50, 20, 8, 2] };

const stonePlanned = Object.entries(PLANNED).map(([name, form]) => ({ name, form, shapes: levelsOf(STONE, name, form) }));

test("every level of every new stone form lies in its form's box and the margin its kind is given", () => {
  for (const { name, form, shapes } of stonePlanned) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0, 0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) {
          over[a] = Math.max(over[a]!, box[a]! - at[a]!);
          over[a + 3] = Math.max(over[a + 3]!, at[a]! - box[a + 3]!);
        }
        if (isRoof(form)) expect(at[1]! - roofHeight(form, at[0]!, at[2]!), `${name} level ${level} over its plane`).toBeLessThanOrEqual(STONE_ROOF_PROUD);
      }
      over.forEach((most, k) => {
        const a = k % 3;
        // A roof's eave course runs out past a low side. A wall, a beam, a railing and a footing end flat on their boxes, for a quoin to butt against. A leaf's fittings stand off it.
        const margin = isRoof(form) ? (a === 1 ? (k === 1 ? 0.002 : STONE_ROOF_PROUD) : STONE_EAVE + 0.001) : form.layer === "leaf" ? PROUD_LEAF : form.plane === "upright" && a === 0 ? 0 : STONE_PROUD;
        expect(most, `${name} level ${level} past its ${k < 3 ? "least" : "most"} ${"xyz"[a]}`).toBeLessThanOrEqual(margin + 1e-9);
      });
    });
  }
});

test("a textured level of a new stone form that yields has a ring on each plane it yields at, a triangle's three among them", () => {
  for (const { name, form, shapes } of stonePlanned) {
    const planes = [...yieldPlanes(form).map(([axis, at]) => ({ n: [0, 1, 2].map((a) => (a === axis ? 1 : 0)) as unknown as Vec, at, axis })), ...yieldSlants(form).map(([n, at]) => ({ n, at, axis: -1 }))];
    if (form.yieldBand > 0 && form.plane !== "across") expect(planes.length, name).toBeGreaterThanOrEqual(form.plane === "upright" ? 2 : form.outline.length);
    for (const { n, at, axis } of planes) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let on = 0;
        for (const f of shape.faces) {
          const side = f.points.map((p) => dot(n, p) - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          const slack = axis < 0 ? 3e-4 : 1e-6;
          // Only what is pulled back whole crosses a ring: a stone, a block, a beam along it.
          if (side.some((d) => d > slack) && side.some((d) => d < -slack)) expect(f.along, `${name} level ${level}: a ${f.mat} face crosses the ring at ${at}`).toBe(axis < 0 ? -2 : axis);
        }
        expect(on, `${name} level ${level}: corners on the ring at ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every new stone level is closed, looks outward and costs no more than a made piece may or than it did", () => {
  const meshes = tierShapes(STONE, PLANNED);
  expect(tierShapes(STONE, { ...FORMS, ...PLANNED }).length).toBe(Object.keys(FORMS).length + Object.keys(PLANNED).length);
  for (const mesh of meshes) {
    const most = STONE_NEW_MOST[mesh.id.slice(5, -6)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, MADE_PIECE_TRIANGLES[level]![1]));
    });
  }
  const again = tierShapes(STONE, PLANNED);
  expect(meshes.map((m) => m.lods.map((l) => Bun.hash(l.positions)))).toEqual(again.map((m) => m.lods.map((l) => Bun.hash(l.positions))));
});

test("a stone gable's two hands are each other in a mirror, point for point", () => {
  const [left, right] = ["sloped_wall_left", "sloped_wall_right"].map((name) => stonePlanned.find((p) => p.name === name)!.shapes);
  left!.forEach((shape, level) => {
    const name = (p: Vec, flip: number): string => [flip * p[0], p[1], p[2]].map((c) => (Math.round(c * 1e6) / 1e6 || 0).toFixed(6)).join();
    expect([...new Set(shape.corners().map((p) => name(p, -1)))].sort()).toEqual([...new Set(right![level]!.corners().map((p) => name(p, 1)))].sort());
    expect(shape.triangles).toBe(right![level]!.triangles);
  });
});

test("every stone wall, old and new, ends flat on its collider's ends at every level", () => {
  for (const [name, form] of Object.entries({ ...FORMS, ...PLANNED } as Record<string, FormDef>)) {
    if (form.layer !== "wall") continue;
    const box = colliderBox(form);
    levelsOf(STONE, name, form).forEach((shape, level) => {
      const xs = shape.corners().map((p) => p[0]);
      expect(Math.abs(Math.min(...xs) - box[0]), `${name} level ${level}, its -x end`).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(Math.max(...xs) - box[3]), `${name} level ${level}, its +x end`).toBeLessThanOrEqual(1e-9);
    });
  }
});

test("stone's trims are the five the client looks for, within their budgets, and closed but where two triangles are a sheet", () => {
  const trims = trimShapes(STONE);
  expect(trims.map((m) => m.id)).toEqual(["core:joint_sq_stone", "core:joint_r15_stone", "core:joint_r21_stone", "core:skirt_stone", "core:ridge_stone"]);
  for (const mesh of trims) {
    const most = STONE_TRIM_MOST[mesh.id.slice(5, -6)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, TRIM_TRIANGLES[mesh.id.slice(5, -6)]![level]!));
      expect([mesh.id, level, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0]);
      if (lod.indices.length / 3 > 2) expect([mesh.id, level, s.holes]).toEqual([mesh.id, level, 0]);
    });
  }
});

test("a stone joint has a bed at each height it may be cut to, and what is over a bed lies inside the stone under it", () => {
  // The most a joint's section reaches from its corner: a quoin's long stones to their arrises, and each pier's arrises.
  const reach: Record<string, number> = { joint_sq: 0.165 * Math.SQRT2, joint_r15: 0.17, joint_r21: 0.22 };
  for (const [name, shapes] of Object.entries(STONE.trims!())) {
    if (!(name in reach)) continue;
    shapes.slice(0, 2).forEach((shape, level) => {
      const points = shape.corners();
      // It stands on its corner from the level to a centimetre over a storey.
      expect([name, level, Math.min(...points.map((p) => p[2])), Math.max(...points.map((p) => p[2]))]).toEqual([name, level, 0, 3.01]);
      for (const p of points) expect(Math.hypot(p[0], p[1]), `${name} level ${level}`).toBeLessThanOrEqual(reach[name]! + 1e-9);
      // A round pier past the finest level is one length, as wood's is: its picture is plain stone, which a squeeze does not show.
      if (level === 1 && name !== "joint_sq") return;
      for (const cut of [0.76, 1.51, 2.26]) {
        // A ring at each height the client clamps it to (client/core/render/piece-fit.ts): n quarter storeys and a centimetre.
        const ring = points.filter((p) => Math.abs(p[2] - cut) < 1e-9);
        expect(ring.length, `${name} level ${level} at ${cut}`).toBeGreaterThanOrEqual(8);
        // The stone that ends on the bed is as wide there as anything over it: clamped, the rest lies flat on its top.
        const under = Math.max(...ring.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
        const round = Math.max(...ring.map((p) => Math.hypot(p[0], p[1])));
        for (const p of points) if (p[2] > cut) expect(name === "joint_sq" ? Math.max(Math.abs(p[0]), Math.abs(p[1])) : Math.hypot(p[0], p[1]), `${name} level ${level} over ${cut}`).toBeLessThanOrEqual((name === "joint_sq" ? under : round) + 1e-9);
      }
    });
  }
});

test("a quoin holds a yielded stone wall's end inside it, and none of its faces lies in a wall's", () => {
  // A wall's end pulled back by the yield band stands this far from the corner.
  const wall = levelsOf(STONE, "wall", FORMS.wall);
  const end = FORMS.wall.yieldBand;
  for (const [level, shape] of STONE.trims!().joint_sq!.slice(0, 3).entries()) {
    // All of the wall, its stones' faces and the crowns of its top course, lies this far from its middle at most.
    const faces = Math.max(...wall[Math.min(level, wall.length - 1)]!.corners().map((p) => Math.abs(p[1])));
    let upright = 0;
    for (const f of shape.faces) {
      const flat = [0, 1].find((a) => f.points.every((p) => Math.abs(p[a]! - f.points[0]![a]!) < 1e-9));
      if (flat === undefined || new Set(f.points.map((p) => p[2])).size < 2) continue;
      upright++;
      const out = Math.abs(f.points[0]![flat]!);
      // Each of its upright faces stands 3 cm or more past the wall's end, so the end is inside every stone of it, and a centimetre or more outside the wall's faces.
      expect(out - end, `level ${level}`).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(out - faces, `level ${level}`).toBeGreaterThanOrEqual(0.01 - 1e-9);
    }
    expect(upright, `level ${level}`).toBeGreaterThanOrEqual(4);
  }
});

test("a stone skirt hangs 2.4 m from just under a foundation's top, 0.12 m out, and turns each corner; a ridge lies along its line", () => {
  const box = (name: string, level = 0): number[] => {
    const p = trimShapes(STONE).find((m) => m.id === `core:${name}_stone`)!.lods[level]!.positions;
    return [0, 1, 2].flatMap((a) => [Math.min(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!)), Math.max(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!))]).map((v) => Math.round(v * 1e4) / 1e4 || 0);
  };
  // In the engine's frame: +X along the side, +Y up from the foundation's top, +Z outward. Its top is 2 cm under the
  // flags, and at each end it turns a quarter round the corner, 0.12 m past the side's own end at its foot.
  expect(box("skirt")).toEqual([-1.62, 1.62, -2.4, -0.02, 0, 0.12]);
  expect(box("skirt", 1)).toEqual([-1.62, 1.62, -2.4, -0.02, 0, 0.12]);
  expect(box("skirt", 2)).toEqual([-1.5, 1.5, -2.4, -0.02, 0, 0.12]);
  const ridge = box("ridge");
  expect([ridge[0], ridge[1]]).toEqual([-1.5, 1.5]);
  expect(ridge[3]!).toBeLessThanOrEqual(0.13);
  expect(Math.max(-ridge[4]!, ridge[5]!)).toBeLessThanOrEqual(0.22);
});

// Stone's seams: no line of sight between a wall and the wall or the foundation under it, at any two levels.

import { Rng } from "../../shared/rng.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

/** A level set down with its origin at a place, in the engine's frame. */
type Stood = readonly [lod: SourceLod, at: readonly number[]];

/** How far along the ray from `o` along `d` it first meets a triangle of `set` that faces its start, or Infinity. */
function firstFacing(set: readonly Stood[], o: readonly number[], d: readonly number[]): number {
  let best = Infinity;
  for (const [lod, at] of set) {
    const p = lod.positions, ix = lod.indices;
    const [ox, oy, oz] = [o[0]! - at[0]!, o[1]! - at[1]!, o[2]! - at[2]!];
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, c] = [ix[t]! * 3, ix[t + 1]! * 3, ix[t + 2]! * 3];
      const [ux, uy, uz, vx, vy, vz] = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!, p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const den = nx * d[0]! + ny * d[1]! + nz * d[2]!;
      if (den >= -1e-12) continue;
      const k = (nx * (p[a]! - ox) + ny * (p[a + 1]! - oy) + nz * (p[a + 2]! - oz)) / den;
      if (k < 0 || k >= best) continue;
      const [x, y, z] = [ox + d[0]! * k, oy + d[1]! * k, oz + d[2]! * k];
      let inside = true;
      for (let e = 0; e < 3 && inside; e++) {
        const [i, j] = [ix[t + e]! * 3, ix[t + ((e + 1) % 3)]! * 3];
        const [ex, ey, ez] = [p[j]! - p[i]!, p[j + 1]! - p[i + 1]!, p[j + 2]! - p[i + 2]!];
        inside = (ey * (z - p[i + 2]!) - ez * (y - p[i + 1]!)) * nx + (ez * (x - p[i]!) - ex * (z - p[i + 2]!)) * ny + (ex * (y - p[i + 1]!) - ey * (x - p[i]!)) * nz >= -1e-9;
      }
      if (inside) best = k;
    }
  }
  return best;
}

/**
 * Of `rays` lines of sight through the upright sheet z = `z`, at points from -1.4 to 1.4 m along it and between two
 * heights, from both sides and up to 80 degrees off square: how many reach the sheet with no face turned to them met
 * first. A face a millimetre behind the sheet is the sheet's.
 */
function seenBetween(set: readonly Stood[], rng: Rng, rays: number, z: number, low: number, high: number): number {
  let through = 0;
  for (let n = 0; n < rays; n++) {
    const [x, y, side] = [rng.range(-1.4, 1.4), rng.range(low, high), n & 1 ? 1 : -1];
    // Half of them nearly level, where a seam between two courses is looked along.
    const tilt = n % 4 < 2 ? rng.range(0, 0.05) : rng.range(0, 1.4), round = rng.range(0, Math.PI * 2);
    const dir = [Math.sin(tilt) * Math.cos(round), Math.sin(tilt) * Math.sin(round), -side * Math.cos(tilt)];
    if (firstFacing(set, [x - dir[0]! * 10, y - dir[1]! * 10, z - dir[2]! * 10], dir) > 10 + 0.001) through++;
  }
  return through;
}

test("no line of sight passes between a stone wall and the wall over it, at any two of their levels", () => {
  const wall = tierShapes(STONE, { wall: FORMS.wall })[0]!.lods;
  const rng = new Rng(7);
  wall.forEach((lower, a) => wall.forEach((upper, b) => {
    // The upper wall stands a storey up; the seam is looked at 3 cm either side of the height they meet at.
    const high = FORMS.wall.outline[2]![1] - FORMS.wall.at[1];
    expect(seenBetween([[lower, [0, 0, 0]], [upper, [0, 2 * high, 0]]], rng, 3000, 0, high - 0.03, high + 0.03), `level ${a} under level ${b}`).toBe(0);
  }));
});

test("no line of sight passes between a stone wall and the foundation it stands on, 5 cm in from the foundation's side", () => {
  const [wall, floors] = [tierShapes(STONE, { wall: FORMS.wall })[0]!.lods, tierShapes(STONE, { foundation: FORMS.foundation, triangle_foundation: PLANNED.triangle_foundation!, quarter_foundation: PLANNED.quarter_foundation! })];
  const rng = new Rng(8);
  for (const floor of floors) {
    const form = floor.id.includes("triangle") ? PLANNED.triangle_foundation! : floor.id.includes("quarter") ? PLANNED.quarter_foundation! : FORMS.foundation;
    // The side whose way out is -z: a square's south, and a triangle's first. The wall stands on it, its middle over the side.
    const box = colliderBox(form);
    const [mid, edge, top] = [(box[0] + box[3]) / 2, box[2], box[4]];
    floor.lods.forEach((under, a) => wall.forEach((over, b) => {
      const set: Stood[] = [[under, [-mid, 0, 0]], [over, [0, top + 1.5, edge]]];
      // Along the middle of the side, clear of the corners, where a quarter is 1.5 m wide.
      const reach = Math.min(1.4, (box[3] - box[0]) / 2 - 0.2);
      let through = 0;
      for (let n = 0; n < 3000; n++) {
        const [x, y, side] = [rng.range(-reach, reach), rng.range(box[1] + 0.02, top + 0.03), n & 1 ? 1 : -1];
        const tilt = n % 4 < 2 ? rng.range(0, 0.05) : rng.range(0, 1.4), round = rng.range(0, Math.PI * 2);
        const dir = [Math.sin(tilt) * Math.cos(round), Math.sin(tilt) * Math.sin(round), -side * Math.cos(tilt)];
        if (firstFacing(set, [x - dir[0]! * 10, y - dir[1]! * 10, edge + 0.05 - dir[2]! * 10], dir) > 10 + 0.001) through++;
      }
      expect(through, `${floor.id} level ${a} under a wall's level ${b}`).toBe(0);
    }));
  }
});

// Metal's new forms: half_wall, quarter_wall, railing, corner_pillar, thin_pillar, beam, ramp, triangle_foundation,
// triangle_ceiling, quarter_foundation, roof, roof_hip, roof_valley, triangle_roof, triangle_roof_low, sloped_wall_left,
// sloped_wall_right, fence_foundation, trapdoor_frame, trapdoor, ladder, double_doorway, large_wall, gateway, gate; and
// its trims: joint_sq, joint_r15, joint_r21, skirt, ridge. Flat levels in two steel greys, as its first nine are.

const metalNew = Object.entries(PLANNED).map(([name, form]) => ({ name, form, shapes: levelsOf(METAL, name, form) }));
/** What each new metal form's levels cost on 2026-11-24. A change may lower a number and may not raise one. */
const METAL_NEW_MOST: Record<string, readonly number[]> = {
  half_wall: [420, 180, 60, 12],
  quarter_wall: [440, 176, 60, 12],
  railing: [204, 96, 60, 12],
  corner_pillar: [320, 128, 36, 12],
  thin_pillar: [168, 72, 36, 12],
  beam: [192, 96, 60, 12],
  ramp: [508, 196, 40, 8],
  triangle_foundation: [424, 244, 16, 8],
  triangle_ceiling: [332, 200, 44, 8],
  quarter_foundation: [472, 280, 24, 12],
  roof: [344, 96, 60, 12],
  roof_hip: [428, 156, 60, 12],
  roof_valley: [404, 132, 60, 12],
  triangle_roof: [332, 98, 44, 8],
  triangle_roof_low: [304, 70, 44, 8],
  sloped_wall_left: [372, 180, 56, 8],
  sloped_wall_right: [372, 180, 56, 8],
  fence_foundation: [204, 108, 12],
  trapdoor_frame: [384, 216, 64, 32, 12],
  trapdoor: [296, 120, 48, 12],
  ladder: [216, 104, 48, 24, 12],
  double_doorway: [984, 320, 132, 28, 12],
  large_wall: [856, 168, 60, 12],
  gateway: [780, 300, 132, 28, 12],
  gate: [636, 192, 56, 12],
};
/** The first form each new one is nearest to, which it may cost no more than at any level. A ladder is like none of them. */
const METAL_LIKE: Record<string, string> = {
  half_wall: "wall", quarter_wall: "wall", railing: "wall", beam: "wall", large_wall: "wall", sloped_wall_left: "wall", sloped_wall_right: "wall", fence_foundation: "wall",
  corner_pillar: "pillar", thin_pillar: "pillar", ramp: "stairs", triangle_foundation: "foundation", quarter_foundation: "foundation",
  triangle_ceiling: "ceiling", roof: "ceiling", roof_hip: "ceiling", roof_valley: "ceiling", triangle_roof: "ceiling", triangle_roof_low: "ceiling", trapdoor_frame: "ceiling",
  trapdoor: "door", gate: "door", double_doorway: "doorframe", gateway: "doorframe",
};
/** Triangles a level is over its like's: a slab with a hole through it has two trimmers, is four slabs from 60 m and keeps its hole a level longer than a ceiling has levels. */
const METAL_OVER: Record<string, readonly number[]> = { trapdoor_frame: [0, 4, 4, 20, 0] };
/**
 * A metal roof's seams stand 45 mm over its plane and its gutter 55 mm, 0.30 m out past a low side, with a fascia 56 mm
 * under the slab's foot there, 65 mm on a triangle's steeper face. From 60 m it is one slab out to its eaves, as deep
 * there as anywhere.
 */
const METAL_ROOF_OVER = 0.056;
const METAL_ROOF_UNDER = [0.066, 0.066, 0.174, 0.002] as const;

test("every level of every new metal form lies in its box and the margin its kind is given", () => {
  for (const { name, form, shapes } of metalNew) {
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const over = [0, 0, 0, 0, 0, 0];
      for (const p of shape.corners()) {
        const at = [p[0], p[2], -p[1]];
        for (let a = 0; a < 3; a++) {
          over[a] = Math.max(over[a]!, box[a]! - at[a]!);
          over[a + 3] = Math.max(over[a + 3]!, at[a]! - box[a + 3]!);
        }
        if (isRoof(form)) expect(at[1]! - roofHeight(form, at[0]!, at[2]!), `${name} level ${level} over its plane`).toBeLessThanOrEqual(METAL_ROOF_OVER);
      }
      over.forEach((most, k) => {
        const a = k % 3;
        // A leaf's hinges, wheel and brackets; a roof's gutter; and for the rest a nut on the finest level and 2 mm of marker stripe past it.
        const margin = isRoof(form) ? (a === 1 ? (k === 1 ? METAL_ROOF_UNDER[level]! : METAL_ROOF_OVER) : EAVE + 0.001) : form.layer === "leaf" ? METAL_PROUD_LEAF : level === 0 ? METAL_PROUD : 0.0021;
        expect(most, `${name} level ${level} past its ${k < 3 ? "least" : "most"} ${"xyz"[a]}`).toBeLessThanOrEqual(margin);
      });
    });
  }
});

test("no face of a near level of a new metal form crosses a ring it yields at but a prism along the way", () => {
  for (const { name, form, shapes } of metalNew) {
    const planes = [...yieldPlanes(form).map(([axis, at]) => ({ n: [0, 1, 2].map((a) => (a === axis ? 1 : 0)) as unknown as Vec, at, axis })), ...yieldSlants(form).map(([n, at]) => ({ n, at, axis: -1 }))];
    if (form.yieldBand > 0 && form.plane !== "across") expect(planes.length, name).toBeGreaterThanOrEqual(form.plane === "upright" ? 2 : form.outline.length);
    for (const { n, at, axis } of planes) {
      shapes.slice(0, TEXTURED).forEach((shape, level) => {
        let [on, crossed] = [0, 0];
        for (const f of shape.faces) {
          const side = f.points.map((p) => dot(n, p) - at);
          on += side.filter((d) => Math.abs(d) < 1e-7).length;
          const slack = axis < 0 ? 3e-4 : 1e-6;
          if (!(side.some((d) => d > slack) && side.some((d) => d < -slack))) continue;
          crossed++;
          expect(f.along, `${name} level ${level}: a ${f.mat} face crosses the ring at ${at}`).toBe(axis < 0 ? -2 : axis);
        }
        // Nothing here is textured, so a prism is shorter where it yields and needs no ring: a tall wall from 60 m is
        // prisms alone, and a railing's posts stand whole on one side of a ring or the other. A wall, a slab and a roof have theirs.
        if (crossed === 0 && !["railing", "fence_foundation"].includes(name)) expect(on, `${name} level ${level}: vertices on the ring at ${at}`).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

test("every new metal level is closed, flat, in the made piece's budget and no dearer than it was or than its like", () => {
  const first = new Map(bakeMetal(FORMS).map((m) => [m.id.slice(5, -6), m.lods.map((lod) => lod.indices.length / 3)] as const));
  const meshes = bakeMetal(PLANNED);
  expect(bakeMetal({ ...FORMS, ...PLANNED }, true).length).toBe(39);
  for (const mesh of meshes) {
    const name = mesh.id.slice(5, -6);
    const most = METAL_NEW_MOST[name]!, like = first.get(METAL_LIKE[name] ?? ""), spare = METAL_OVER[name];
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      const triangles = lod.indices.length / 3;
      expect([mesh.id, level, s.holes, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0, 0]);
      expect(triangles, `${mesh.id} level ${level}`).toBeLessThanOrEqual(Math.min(most[level]!, MADE_PIECE_TRIANGLES[level]![1]));
      // Past its like's last level it is held to that level's count.
      if (like) expect(triangles, `${mesh.id} level ${level} against ${METAL_LIKE[name]}`).toBeLessThanOrEqual(like[Math.min(level, like.length - 1)]! + (spare?.[level] ?? 0));
      expect(lod.uvs, `${mesh.id} level ${level} is flat`).toBeUndefined();
    });
  }
  const again = bakeMetal(PLANNED, true);
  expect(bakeMetal(PLANNED, true).map((m) => m.lods.map((l) => [Bun.hash(l.positions), Bun.hash(l.bones ?? new Uint8Array(0))]))).toEqual(again.map((m) => m.lods.map((l) => [Bun.hash(l.positions), Bun.hash(l.bones ?? new Uint8Array(0))])));
});

test("a new metal form is two-toned to the level its frame is drawn at, and says which faces wear its material", () => {
  for (const mesh of bakeMetal(PLANNED)) {
    mesh.lods.slice(0, 3).forEach((lod, level) => {
      const used = new Set(lod.colors);
      expect([mesh.id, level, used.has(REGION_BASE), used.has(4)]).toEqual([mesh.id, level, true, true]);
    });
    expect([mesh.id, mesh.lods[0]!.bones!.some((b) => ((b >> 2) & 15) !== 0)]).toEqual([mesh.id, true]);
    for (const lod of mesh.lods) {
      for (let v = 0; v < lod.colors.length; v++) {
        const flags = lod.bones![v]! & (FACE_WEARS | FACE_PLAIN);
        expect(lod.colors[v] === REGION_BASE ? flags === 0 : flags === FACE_WEARS || flags === (FACE_WEARS | FACE_PLAIN)).toBe(true);
      }
    }
  }
});

test("a new metal wall ends flat on its collider's ends, and a wall that others stand on has its top and foot on its collider's", () => {
  for (const { name, form, shapes } of metalNew) {
    if ((form.layer !== "wall" && form.layer !== "footing") || form.outline.length !== 4) continue;
    const box = colliderBox(form);
    shapes.forEach((shape, level) => {
      const c = shape.corners();
      expect([name, level, Math.min(...c.map((p) => p[0])), Math.max(...c.map((p) => p[0]))]).toEqual([name, level, box[0], box[3]]);
      // A low wall, the tall wall and the two portals close on what is over and under them, as a wall does.
      if (form.carries) expect([name, level, Math.min(...c.map((p) => p[2])), Math.max(...c.map((p) => p[2]))]).toEqual([name, level, box[1], box[4]]);
    });
  }
});

test("a metal sloped wall's two hands are each other in a mirror, point for point", () => {
  const [left, right] = ["sloped_wall_left", "sloped_wall_right"].map((name) => metalNew.find((p) => p.name === name)!.shapes);
  left!.forEach((shape, level) => {
    const name = (p: Vec, flip: number): string => [flip * p[0], p[1], p[2]].map((c) => (Math.round(c * 1e6) / 1e6 || 0).toFixed(6)).join();
    expect([...new Set(shape.corners().map((p) => name(p, -1)))].sort()).toEqual([...new Set(right![level]!.corners().map((p) => name(p, 1)))].sort());
    expect(shape.triangles).toBe(right![level]!.triangles);
  });
});

test("a metal roof reads its row: where the row stands its slab on its corner heights, the mesh goes up with it", () => {
  const row = PLANNED.roof!;
  const stood: FormDef = { ...row, at: [row.at[0], row.at[1] + row.thick, row.at[2]], corner: row.corner!.map((h) => h + row.thick) };
  for (let level = 0; level < 4; level++) {
    const [was, is] = [levelsOf(METAL, "roof", row)[level]!.corners(), levelsOf(METAL, "roof", stood)[level]!.corners()];
    expect(is.length).toBe(was.length);
    // About its own origin the mesh is the same, and the origin is a slab higher: so its underside is where its top was.
    for (let k = 0; k < was.length; k++) for (let a = 0; a < 3; a++) expect(is[k]![a]!, `level ${level}`).toBeCloseTo(was[k]![a]!, 9);
  }
});

test("metal's trims are the five the client looks for, within their budgets, slate and bolts, closed but where two triangles are a sheet", () => {
  const trims = bakeMetal({}, true);
  expect(trims.map((m) => m.id)).toEqual(["core:joint_sq_metal", "core:joint_r15_metal", "core:joint_r21_metal", "core:skirt_metal", "core:ridge_metal"]);
  for (const mesh of trims) {
    const most = TRIM_TRIANGLES[mesh.id.slice(5, -6)]!;
    expect(mesh.lods.length, mesh.id).toBe(most.length);
    mesh.lods.forEach((lod, level) => {
      const s = measureSurface(lod);
      expect(lod.indices.length / 3, `${mesh.id} level ${level}`).toBeLessThanOrEqual(most[level]!);
      expect([mesh.id, level, s.flipped, s.insideOut]).toEqual([mesh.id, level, 0, 0]);
      if (lod.indices.length / 3 > 2) expect([mesh.id, level, s.holes]).toEqual([mesh.id, level, 0]);
      // The frame's slate, a bolt's iron, and on a skirt its foundation's own colour.
      for (const c of lod.colors) expect([4, 96, ...(mesh.id.includes("skirt") ? [REGION_BASE] : [])]).toContain(c);
      // A face in a fixed colour wears the piece's material; a round post's and a flashing's keep clear of its joints.
      for (let v = 0; v < lod.colors.length; v++) expect((lod.bones![v]! & FACE_WEARS) !== 0).toBe(lod.colors[v] !== REGION_BASE);
    });
  }
});

test("a metal joint cut to a lower wall ends flat in its own collar: all that stands over a cut folds inside what is at it", () => {
  const half: Record<string, number> = { joint_sq: 0.11, joint_r15: 0.15, joint_r21: 0.21 };
  for (const [name, shapes] of Object.entries(METAL.trims!())) {
    if (!(name in half)) continue;
    const finest = shapes[0]!.corners();
    // Its base plate is sunk 6 mm into the floor it stands on, and its cap stands a centimetre over the storey.
    expect([name, Math.min(...finest.map((p) => p[2])), Math.max(...finest.map((p) => p[2]))]).toEqual([name, -0.006, 3.01]);
    // How far a point is out: along an axis for the square post, from the corner for a tube.
    const out = (p: Vec): number => (name === "joint_sq" ? Math.max(Math.abs(p[0]), Math.abs(p[1])) : Math.hypot(p[0], p[1]));
    for (const cut of [0.76, 1.51, 2.26]) {
      // A collar's top is at each height the client clamps it to (client/core/render/piece-fit.ts); a tube has none under its third, where nothing over it is wider than it.
      const ring = finest.filter((p) => Math.abs(p[2] - cut) < 1e-9);
      if (name === "joint_sq" || cut < 2) expect(ring.length, `${name} at ${cut}`).toBeGreaterThanOrEqual(12);
      const reach = Math.max(half[name]!, ...ring.map(out));
      for (const p of finest) if (p[2] > cut) expect(out(p), `${name} over ${cut}`).toBeLessThanOrEqual(reach + 1e-9);
    }
    // A square post stands a centimetre past a wall's faces, and its lowest collar and its bolts 3.2 cm more; a tube's base plate is square.
    for (const p of finest) expect(p[2] > 0.031 ? out(p) : Math.max(Math.abs(p[0]), Math.abs(p[1])), name).toBeLessThanOrEqual(half[name]! + 0.0321);
    // Past the finest a post keeps its collars and loses its bolts, and from 60 m it is a box no wider than its shaft.
    for (const p of shapes[1]!.corners()) expect(out(p), `${name} level 1`).toBeLessThanOrEqual(half[name]! + 0.0241);
    for (const p of shapes[2]!.corners()) expect(Math.max(Math.abs(p[0]), Math.abs(p[1])), `${name} level 2`).toBeLessThanOrEqual(half[name]! + 1e-9);
  }
});

test("a metal skirt hangs 2.4 m from a side's middle, 0.12 m out, and mitres 0.12 m round each end; a ridge lies along its line", () => {
  const box = (name: string, level: number): number[] => {
    const p = bakeMetal({}, true).find((m) => m.id === `core:${name}_metal`)!.lods[level]!.positions;
    return [0, 1, 2].flatMap((a) => [Math.min(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!)), Math.max(...Array.from({ length: p.length / 3 }, (_, v) => p[v * 3 + a]!))]).map((v) => Math.round(v * 1e4) / 1e4 || 0);
  };
  // In the engine's frame: +X along the side, +Y up from the foundation's top, +Z outward.
  // Its ledger's bolts stand 8 mm proud on the finest level.
  expect(box("skirt", 0)).toEqual([-1.613, 1.613, -2.4, 0, 0, 0.128]);
  expect(box("skirt", 1)).toEqual([-1.614, 1.614, -2.4, 0, 0, 0.12]);
  for (const level of [2, 3]) expect(box("skirt", level)).toEqual([-1.5, 1.5, -2.4, level === 2 ? 0 : -0.02, level === 2 ? 0 : 0.12, 0.12]);
  // A wedge past an end lies inside the next skirt's end post on a straight run: 5 mm under its face and its top.
  const finest = METAL.trims!().skirt![0]!.corners();
  for (const p of finest) if (Math.abs(p[0]) > 1.5 + 1e-9) expect(Math.abs(p[0]) - 1.5 <= -p[1] + 1e-9 && -p[1] <= 0.113 + 1e-9 && p[2] <= -0.026 + 1e-9).toBe(true);
  for (let level = 0; level < 4; level++) {
    const ridge = box("ridge", level);
    expect([ridge[0], ridge[1]]).toEqual([-1.5, 1.5]);
    expect(ridge[3]!, `level ${level}`).toBeLessThanOrEqual(0.12);
    expect(Math.max(-ridge[4]!, ridge[5]!), `level ${level}`).toBeLessThanOrEqual(0.24);
  }
});
