// Forms: the rows a piece's collider is made from, the registry's table of them, and the poses they imply.

import { expect, test } from "bun:test";
import { BUILDING_CONTENT, FOUNDATION_THICK } from "../../content/building.ts";
import { FORMS, PLANNED_FORMS, formBoxes } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { FORM_LAYERS, HALF_SIDE_M, LEVEL_M, SLOT_CLASSES, colliderFaults, formFaults, formHalf, formPose, type FormDef } from "../../shared/world/lattice/forms.ts";
import { HALF_SIDE, frameAxes, makeSockets, socketPose, socketsFor, units, type Pose } from "../../shared/world/snap.ts";
import { coreRegistry } from "../fixtures/world.ts";

const TIERS = ["thatch", "wood", "stone", "metal"];
const Q = 16384;

// Each box as its middle and its half extents, as content/building.ts wrote them before it read the rows.
const BEFORE: Record<keyof typeof FORMS, number[][]> = {
  foundation: [[0, 0, 0, 1.5, 0.1875, 1.5]],
  wall: [[0, 0, 0, 1.5, 1.5, 0.1]],
  doorframe: [
    [-1.1, 0, 0, 0.4, 1.5, 0.1],
    [1.1, 0, 0, 0.4, 1.5, 0.1],
    [0, 1.15625, 0, 0.7, 0.34375, 0.1],
  ],
  windowframe: [
    [-1.05, 0, 0, 0.45, 1.5, 0.1],
    [1.05, 0, 0, 0.45, 1.5, 0.1],
    [0, -0.9, 0, 0.6, 0.6, 0.1],
    [0, 0.95, 0, 0.6, 0.55, 0.1],
  ],
  ceiling: [[0, 0, 0, 1.5, 0.125, 1.5]],
  pillar: [[0, 0, 0, 0.25, 1.5, 0.25]],
  door: [[0, 0, 0, 0.7, 1.15625, 0.04]],
  door_open: [[-0.6599999999999999, 0, 0.7, 0.04, 1.15625, 0.7]],
  stairs: [
    [0, -1.35, -1.35, 1.5, 0.15, 0.15],
    [0, -1.2, -1.05, 1.5, 0.3, 0.15],
    [0, -1.05, -0.75, 1.5, 0.45, 0.15],
    [0, -0.9, -0.44999999999999996, 1.5, 0.6, 0.15],
    [0, -0.75, -0.1499999999999999, 1.5, 0.75, 0.15],
    [0, -0.6, 0.1499999999999999, 1.5, 0.9, 0.15],
    [0, -0.44999999999999996, 0.44999999999999996, 1.5, 1.05, 0.15],
    [0, -0.30000000000000004, 0.75, 1.5, 1.2, 0.15],
    [0, -0.1499999999999999, 1.0499999999999998, 1.5, 1.35, 0.15],
    [0, 0, 1.35, 1.5, 1.5, 0.15],
  ],
};
const HALF_BEFORE: Record<keyof typeof FORMS, number[]> = {
  foundation: [1.5, 0.1875, 1.5], wall: [1.5, 1.5, 0.1], doorframe: [1.5, 1.5, 0.1], windowframe: [1.5, 1.5, 0.1], ceiling: [1.5, 0.125, 1.5],
  pillar: [0.25, 1.5, 0.25], door: [0.7, 1.15625, 0.04], door_open: [0.7, 1.15625, 1.4], stairs: [1.5, 1.5, 1.5],
};
const NAMES = Object.keys(FORMS) as (keyof typeof FORMS)[];

const bits = (values: Iterable<number>): number[] => [...new Uint32Array(Float32Array.from(values).buffer)];
/** Every number of `got` is the very number of `want`, a negative zero told from zero. */
const same = (got: readonly number[], want: readonly number[]): boolean => got.length === want.length && got.every((v, k) => Object.is(v, want[k]));

test("every core piece's collider is bit for bit what it was before the rows", () => {
  const reg = coreRegistry();
  let kinds = 0;
  for (const name of NAMES) {
    const shape = BUILDING_CONTENT.find((d) => d.id === `core:shape_${name}`) as ShapeDef;
    expect(same(shape.boxes.flatMap((b) => [...b.at, ...b.half]), BEFORE[name].flat())).toBe(true);
    for (const tier of TIERS) {
      const k = reg.index.get(`core:${name}_${tier}`);
      if (k === undefined) continue;
      kinds++;
      expect(bits(reg.parts.box.subarray(reg.parts.start[k]! * 6, reg.parts.start[k + 1]! * 6))).toEqual(bits(BEFORE[name].flat()));
      expect(same([...(reg.defs[k] as StructureDef).half], HALF_BEFORE[name])).toBe(true);
      expect(bits([reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!])).toEqual(bits(HALF_BEFORE[name]));
    }
  }
  // Thatch has no windowframe, pillar or stairs.
  expect(kinds).toBe(4 * 9 - 3);
});

test("the registry gives each built piece's form by its kind, and none to anything else", () => {
  const reg = coreRegistry();
  for (const name of NAMES) {
    const k = reg.index.get(`core:${name}_wood`)!;
    const form: FormDef = FORMS[name];
    expect(reg.forms.def[k]).toEqual(form);
    expect([SLOT_CLASSES[reg.forms.cls[k]!], FORM_LAYERS[reg.forms.layer[k]!], reg.forms.span[k], reg.forms.size[k], reg.forms.turns[k]]).toEqual([form.cls, form.layer, form.span, 2, form.turns]);
    expect([reg.forms.atI[k]! * HALF_SIDE_M, reg.forms.atY[k]! / 512, reg.forms.atJ[k]! * HALF_SIDE_M]).toEqual([...form.at]);
    expect(formHalf(form).map((v) => Math.round(v * 1e9) / 1e9)).toEqual(HALF_BEFORE[name]);
  }
  expect([reg.forms.span[reg.index.get("core:foundation_stone")!], reg.forms.span[reg.index.get("core:wall_metal")!], reg.forms.atY[reg.index.get("core:door_thatch")!]]).toEqual([0, 4, 592]);
  for (const id of ["core:storage_box", "core:bed", "core:stone", "core:survivor"]) {
    expect(reg.forms.def[reg.index.get(id)!]).toBe(null);
    expect(reg.forms.cls[reg.index.get(id)!]).toBe(-1);
  }
});

// Where the slot a socket means is, from the piece that offers it: half-sides along its X and Z, quarter storeys from its
// level to the slot's, and quarter turns to the slot's facing. Sockets are today's, in the order socketsFor gives them.
type Slot = readonly [i: number, j: number, lvl: number, quarters: number];
const BESIDE: Slot[] = [[0, 2, 0, 0], [2, 0, 0, 0], [0, -2, 0, 0], [-2, 0, 0, 0]];
const EDGES: Slot[] = [[0, 1, 0, 0], [1, 0, 0, 1], [0, -1, 0, 2], [-1, 0, 0, 3]];
const HERE: Slot[] = [[0, 0, 0, 0]];
const ABOVE: Slot[] = [[0, 0, 4, 0]];
const SOCKET_SLOTS: readonly (readonly [target: string, piece: string, slots: Slot[]])[] = [
  ["foundation", "foundation", BESIDE],
  ["foundation", "ceiling", BESIDE],
  ["ceiling", "ceiling", BESIDE],
  ...["wall", "doorframe", "windowframe"].flatMap((w) => [["foundation", w, EDGES], ["ceiling", w, EDGES]] as [string, string, Slot[]][]),
  // A pillar on a floor's middle, and one under it. A design change is waiting: see the test.
  ["foundation", "pillar", [[0, 0, 0, 0], [0, 0, -4, 0]]],
  ["ceiling", "pillar", [[0, 0, 0, 0], [0, 0, -4, 0]]],
  ["pillar", "pillar", [[0, 0, 4, 0], [0, 0, -4, 0]]],
  ["foundation", "stairs", HERE],
  ["ceiling", "stairs", HERE],
  ...["wall", "doorframe", "windowframe"].flatMap((under) => ["wall", "doorframe", "windowframe"].map((on) => [under, on, ABOVE] as [string, string, Slot[]])),
  // The face either side of the edge above a wall.
  ...["wall", "doorframe", "windowframe"].map((w) => [w, "ceiling", [[0, 1, 4, 0], [0, -1, 4, 0]]] as [string, string, Slot[]]),
  ["doorframe", "door", HERE],
  ["doorframe", "door_open", HERE],
  ["pillar", "ceiling", ABOVE],
];
/** The one socket whose pose the forms change: a pillar under a foundation ends at its top plane, not its underside. */
const CHANGED = "foundation pillar 1";

test("each form's pose in the slot a socket means is the socket's pose", () => {
  const reg = coreRegistry();
  const sockets = makeSockets();
  const axes = new Int32Array(4);
  const old: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const now: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const differ: string[] = [];
  let pairs = 0;
  for (const yaw of [0, 8048]) {
    for (const [targetName, pieceName, slots] of SOCKET_SLOTS) {
      const tk = reg.index.get(`core:${targetName}_wood`)!;
      const pk = reg.index.get(`core:${pieceName}_wood`)!;
      const target = reg.forms.def[tk]!;
      const piece = reg.forms.def[pk]!;
      socketsFor(reg.role[tk]!, reg.role[pk]!, units(reg.halfY[tk]!), units(reg.halfY[pk]!), reg.doorway[tk] === 1, sockets);
      expect([targetName, pieceName, sockets.n]).toEqual([targetName, pieceName, slots.length]);
      // The target stands in a slot of its own, its reference point here.
      const [rx, ry, rz] = [40000, 9000, 50000];
      formPose(target, rx, ry, rz, yaw, 0, now);
      const [tx, ty, tz] = [now.x, now.y, now.z];
      frameAxes(yaw, axes);
      for (const [k, [i, j, lvl, quarters]] of slots.entries()) {
        for (let turn = 0; turn < piece.turns; turn++) {
          socketPose(sockets, k, tx, ty, tz, yaw, reg.role[pk]!, turn, old);
          formPose(piece, rx + i * axes[0]! + j * axes[2]!, ry + lvl * units(LEVEL_M), rz + i * axes[1]! + j * axes[3]!, (yaw + quarters * Q) & 0xffff, turn, now);
          pairs++;
          if (`${targetName} ${pieceName} ${k}` === CHANGED) {
            expect([now.x - old.x, now.y - old.y, now.z - old.z, now.yaw - old.yaw]).toEqual([0, units(FOUNDATION_THICK), 0, 0]);
            if (!differ.includes(CHANGED)) differ.push(CHANGED);
          } else if (now.x !== old.x || now.y !== old.y || now.z !== old.z || now.yaw !== old.yaw) differ.push(`${targetName} ${pieceName} ${k} turn ${turn} yaw ${yaw}`);
        }
      }
    }
  }
  expect(differ).toEqual([CHANGED]);
  expect(pairs).toBeGreaterThan(150);
  expect(units(HALF_SIDE_M)).toBe(HALF_SIDE);
});

// Sockets no pair of roles is missing from the table above: every pair socketsFor answers is in it.
test("the socket table covers every pair of core pieces that join today", () => {
  const reg = coreRegistry();
  const sockets = makeSockets();
  const listed = new Set(SOCKET_SLOTS.map(([t, p]) => `${t} ${p}`));
  for (const t of NAMES) {
    for (const p of NAMES) {
      const tk = reg.index.get(`core:${t}_wood`)!;
      const pk = reg.index.get(`core:${p}_wood`)!;
      socketsFor(reg.role[tk]!, reg.role[pk]!, units(reg.halfY[tk]!), units(reg.halfY[pk]!), reg.doorway[tk] === 1, sockets);
      expect([t, p, sockets.n > 0]).toEqual([t, p, listed.has(`${t} ${p}`)]);
    }
  }
});

const errorsWith = (change: (d: Def) => Def, more: readonly Def[] = []): string[] => compileContent([...CORE_CONTENT.map(change), ...more]).errors;
const reshaped = (name: string, change: (f: FormDef) => FormDef) => (d: Def): Def => (d.id === `core:shape_${name}` && d.type === "shape" ? { ...d, form: change(d.form!) } : d);

test("the registry refuses a form its collider or its structure's box does not agree with", () => {
  expect(errorsWith(reshaped("wall", (f) => ({ ...f, thick: 0.3 })))[0]).toContain("core:shape_wall: the collider's box is [-1.5, 0, -0.1, 1.5, 3, 0.1] in the slot, and the form's is [-1.5, 0, -0.15, 1.5, 3, 0.15]");
  expect(errorsWith(reshaped("doorframe", (f) => ({ ...f, openings: [{ x0: -0.9, x1: 0.7, y0: 0, y1: 2.3125 }] })))[0]).toContain("core:shape_doorframe: box 0 is in an opening");
  expect(errorsWith(reshaped("windowframe", (f) => ({ ...f, openings: [] }))).join("\n")).toContain("core:shape_windowframe: the boxes fill 1.632 cubic metres, and the form 1.8");
  expect(errorsWith(reshaped("foundation", (f) => ({ ...f, at: [0, 0, 0] })))[0]).toContain("core:shape_foundation: box 0 reaches out of the form");
  expect(errorsWith(reshaped("stairs", (f) => ({ ...f, steps: 5 }))).join("\n")).toContain("core:shape_stairs: box 0 reaches out of the form");
  expect(errorsWith(reshaped("wall", (f) => ({ ...f, span: 3 })))[0]).toContain("core:shape_wall: the span is not the outline's height in quarter storeys");
  expect(errorsWith(reshaped("pillar", (f) => ({ ...f, at: [0.5, 1.5, 0] })))[0]).toContain("core:shape_pillar: at is whole half-sides along and whole lattice units up");
  // A shape that agrees with its form, and a structure that says another box.
  const wrong = errorsWith((d) => (d.id === "core:wall_wood" ? { ...d, half: [1.5, 1.5, 0.3] } : d));
  expect(wrong.join("\n")).toContain("core:wall_wood: half must be [1.5, 1.5, 0.1], the box that holds the form of core:shape_wall");
});

const H = 1.5;
const T = 0.1875;
const R = 1.5;
const prism = (corners: [number, number][], z: number): HullDef => ({ corners: corners.flatMap(([x, y]) => [[x, y, -z], [x, y, z]] as [number, number, number][]) });
/** Convex colliders for four of the rows to come, each about its form's origin. */
const HULLS: readonly (readonly [name: keyof typeof PLANNED_FORMS, hull: HullDef])[] = [
  ["ramp", { corners: [[-H, -H, -H], [H, -H, -H], [-H, -H, H], [H, -H, H], [-H, H - 0.06, H], [H, H - 0.06, H]] }],
  ["triangle_foundation", { sixty: true, corners: [[0, -T, 0], [0, T, 0], [3, -T, 0], [3, T, 0], [0, -T, 3], [0, T, 3]] }],
  ["roof", { corners: [-H, H].flatMap((x) => [[x, -R / 2 - 0.125, -H], [x, -R / 2 + 0.125, -H], [x, R / 2 - 0.125, H], [x, R / 2 + 0.125, H]] as [number, number, number][]) }],
  ["sloped_wall_right", prism([[-H, -0.75], [H, -0.75], [H, 0.75]], 0.1)],
];
const hullPiece = (name: string, form: FormDef, hull: HullDef, half: readonly number[]): Def[] => [
  { type: "shape", id: `test:shape_${name}`, role: "thing", boxes: [], hulls: [hull], form },
  { type: "structure", class: "piece", id: `test:${name}`, mesh: "shape", shape: `test:shape_${name}`, half: half as [number, number, number], color: 5, hp: 100, material: "core:mat_stone" },
];

test("a ramp, a triangle, a roof and a sloped wall of convex parts agree with their rows", () => {
  const defs = HULLS.flatMap(([name, hull]) => hullPiece(name, PLANNED_FORMS[name], hull, formHalf(PLANNED_FORMS[name])));
  const { registry, errors } = compileContent([...CORE_CONTENT, ...defs]);
  expect(errors).toEqual([]);
  expect(HULLS.map(([name]) => registry!.forms.def[registry!.index.get(`test:${name}`)!]!.cls)).toEqual(["square", "triangle", "square", "edge"]);
  // A ramp a full storey high is not the row's, and neither is a roof that rises the other way.
  const tall: HullDef = { corners: HULLS[0]![1].corners.map(([x, y, z]) => [x, y > 0 ? H : y, z] as [number, number, number]) };
  expect(colliderFaults(PLANNED_FORMS.ramp, [], [tall])).toContain("convex part 0 reaches out of the form");
  const turned: HullDef = { corners: HULLS[2]![1].corners.map(([x, y, z]) => [x, y, -z] as [number, number, number]) };
  expect(colliderFaults(PLANNED_FORMS.roof, [], [turned])).toContain("a corner of the form is no corner of its convex parts");
  expect(colliderFaults(PLANNED_FORMS.roof, [{ at: [0, 0, 0], half: [1.5, 0.875, 1.5] }], [])).toContain("a sloped form's collider is convex parts, not boxes");
});

test("every row is sound: its outline, openings, span and cells agree", () => {
  const rows: [string, FormDef][] = [...Object.entries(FORMS), ...Object.entries(PLANNED_FORMS)];
  for (const [name, form] of rows) expect([name, formFaults(form)]).toEqual([name, []]);
  // A row that is a rectangle makes boxes its own check passes.
  let boxed = 0;
  for (const [name, form] of rows) {
    if (form.corner !== undefined || form.outline.length !== 4) continue;
    boxed++;
    expect([name, colliderFaults(form, formBoxes(form), [])]).toEqual([name, []]);
  }
  expect(boxed).toBeGreaterThan(NAMES.length);
  expect(formBoxes(PLANNED_FORMS.double_doorway).length).toBe(3);
  expect(formBoxes(PLANNED_FORMS.trapdoor_frame).length).toBe(4);
  expect(() => formBoxes(PLANNED_FORMS.roof)).toThrow();
});

test("an unsound row is told what is wrong with it", () => {
  const wall: FormDef = FORMS.wall;
  const large: FormDef = PLANNED_FORMS.large_wall;
  const roof: FormDef = PLANNED_FORMS.roof;
  const faults = (f: FormDef): string => formFaults(f).join("\n");
  expect(faults({ ...wall, outline: [[-1.5, 0], [1.5, 0], [0, 1], [1.5, 3], [-1.5, 3]] })).toContain("the outline is not convex at corner 2");
  expect(faults({ ...wall, outline: [...wall.outline].reverse() })).toContain("goes round the wrong way");
  expect(faults({ ...FORMS.doorframe, openings: [{ x0: -0.7, x1: 0.7, y0: 0, y1: 3.5 }] })).toContain("opening 0 is not inside the outline");
  expect(faults({ ...FORMS.doorframe, openings: [...FORMS.doorframe.openings, { x0: 0, x1: 1, y0: 1, y1: 2 }] })).toContain("opening 1 overlaps another");
  expect(faults({ ...wall, span: 5 })).toContain("the span is not the outline's height");
  expect(faults({ ...large, cells: [[0, 0], [0, 4]] })).toContain("cells are every edge from 0 and every storey of the span");
  expect(faults({ ...large, cells: undefined })).toContain("cells are every edge");
  expect(faults({ ...wall, outline: [[-1.5, 0], [1, 0], [1, 3], [-1.5, 3]] })).toContain("the outline is not as wide as its edges");
  expect(faults({ ...FORMS.ceiling, outline: [[-1, 1], [1, 1], [1, -1], [-1, -1]] })).toContain("the outline is not the square of 2 half-sides it fills");
  expect(faults({ ...roof, corner: [1.5, 1.5, 0, 0], edges: roof.edges!.map((e) => ({ ...e, profile: "flat" as const })) })).toContain("edges do not agree with the outline's heights");
  expect(faults({ ...roof, corner: [1, 1, 0, 0] })).toContain("a roof's are whole quarter storeys");
  expect(faults({ ...FORMS.pillar, cls: "edge" })).toContain("a post fills vertex, not edge");
  expect(faults({ ...wall, yieldBand: 2 })).toContain("the yield band is under half the shortest side");
  expect(faults({ ...FORMS.stairs, steps: 1 })).toContain("steps are two or more");
});
