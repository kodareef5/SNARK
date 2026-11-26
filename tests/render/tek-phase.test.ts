import { expect, test } from "bun:test";
import { TEK_PHASE_MS, TEK_WALL_INSTANCE, TekWallView } from "../../client/core/render/tek-wall-view.ts";
import { tekPhaseColour, tekPhaseFront, tekPhaseRim, tekSpanLight } from "../../client/core/render/tek-phase.ts";
import { FORMS } from "../../content/building/forms.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { bakeTek } from "../../tools/pack/pieces/tek.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { set, start } from "../fixtures/slots.ts";
import { flatWorld } from "../fixtures/world.ts";

function bay() {
  const w = flatWorld(3), table = (ref: number) => w.structs.chunks[ref >>> 16]!;
  const base = start(w, w.kind("core:foundation_metal"), 61, 0, 20, 0, 7);
  const makeView = () => new TekWallView(w.structs, w.reg.index, name => Number(name.split("_")[2]));
  const view = makeView(), { solid, open, door } = view.kinds;
  const put = (i: number, kind = door, level = 0) => set(w, w.structs.frameAt(base), kind, i, 0, level);
  const swap = (ref: number, kind: number, tick?: number) => {
    expect(w.structs.swap(ref, kind)).toBe(true);
    if (tick !== undefined) (table(ref).phaseTick ??= new Map()).set(ref & 65535, tick);
  };
  const cell = (ref: number, which = view) => which.cells.get(ref >>> 16)!.get(ref & 65535)!;
  const mesh = (ref: number, which = view) => which.mesh(ref >>> 16, ref & 65535, 90);
  return { w, view, makeView, solid, open, door, put, swap, cell, mesh, table };
}

test("a joined field reaches every shared edge and keeps the outer armour", () => {
  const meshes = bakeTek({ wall: FORMS.wall });
  for (let mask = 1; mask < 16; mask++) {
    const mesh = meshes.find(m => m.id === `core:wall_join_${mask}_tek`)!;
    expect(mesh.lods.length).toBe(5);
    for (const [level, lod] of mesh.lods.entries()) {
      expect(lod.indices.length / 3).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
      expect(measureSurface(lod)).toMatchObject({ holes: 0, flipped: 0, insideOut: 0 });
    }
    const lod = mesh.lods[0]!;
    for (const face of [-1, 1]) {
      const faces = Array.from(lod.colors.keys()).filter(i => lod.colors[i] === REGION_BASE && lod.positions[3*i+2]! * face > 0);
      for (let edge = 0; edge < 4; edge++) {
        const extent = Math.max(...faces.map(i => lod.positions[3*i+(edge >>> 1)]! * (edge % 2 ? 1 : -1)));
        expect(extent).toBeCloseTo((mask & (1 << edge)) ? 1.5 : edge < 2 ? 1.235 : 1.29, 4);
      }
    }
  }
});

test("surface, hardware and adjoining chunks share the authoritative phase", () => {
  const y = bay(), { view, put, swap, mesh, cell } = y;
  const floor = put(1), right = put(3), above = put(3, y.door, 4), fixed = put(-1, y.solid);
  expect(right >>> 16).not.toBe(floor >>> 16);
  view.update(0, 100);
  expect([mesh(fixed), mesh(floor), mesh(right), mesh(above)]).toEqual([2, 3, 9, 4]);
  swap(floor, y.open, 100);
  view.update(100, 103);
  const opening = Math.round(255 * 100 / TEK_PHASE_MS);
  for (const ref of [floor, right, above]) expect(cell(ref).amount).toBe(opening);
  expect(cell(fixed).amount).toBe(0);
  expect([...view.exposing].sort()).toEqual([floor >>> 16, right >>> 16].sort());
  const data = new Uint8Array(2*INSTANCE_BYTES);
  data[17] = data[17+INSTANCE_BYTES] = 7;
  data[19] = 67;
  view.write(data, 0, floor >>> 16, floor & 65535);
  view.write(data, 1, floor >>> 16, floor & 65535, true);
  expect([...data.slice(15, 18)]).toEqual([3, opening, TEK_WALL_INSTANCE | 7]);
  expect([...data.slice(INSTANCE_BYTES + 15, INSTANCE_BYTES + 18)]).toEqual([0, opening, TEK_WALL_INSTANCE | 7]);
  expect(data[19]).toBe(64);
  swap(right, y.open, 100);
  swap(above, y.open, 100);
  view.update(400, 112);
  const later = Math.round(255 * 400 / TEK_PHASE_MS);
  expect([floor, right, above].map(r => cell(r).amount)).toEqual([later, later, later]);
  view.update(800, 124);
  expect([floor, right, above, fixed].map(r => mesh(r))).toEqual([65535, 65535, 65535, 90]);
  expect(view.exposing.size).toBe(0);
  swap(right, y.door, 124);
  view.update(900, 127);
  expect([floor, right, above].map(r => cell(r).amount)).toEqual([255-opening, 255-opening, 255-opening]);
  expect(mesh(fixed)).toBe(2);
});

test("fresh snapshots resume recent walls and settle old walls immediately", () => {
  const y = bay(), open = y.put(-1), solid = y.put(5), old = y.put(9);
  y.swap(open, y.open, 120); y.swap(solid, y.solid, 120); y.swap(old, y.open, 25);
  const view = y.makeView();
  view.update(500, 126);
  const gone = Math.round(255 * (6/TICK_RATE*1000) / TEK_PHASE_MS);
  expect(y.cell(open, view).amount).toBe(gone);
  expect(y.cell(solid, view).amount).toBe(255-gone);
  expect(y.mesh(old, view)).toBe(65535);
  const data = new Uint8Array(INSTANCE_BYTES);
  view.write(data, 0, solid >>> 16, solid & 65535, true);
  expect(data[16]).toBe(255-gone);
  view.update(1100, 144);
  view.write(data, 0, solid >>> 16, solid & 65535, true);
  expect([data[16], data[17]]).toEqual([0, 0]);
  expect(y.mesh(solid, view)).toBe(90);
});

test("a brief command reversal cancels the older sweep at its server time", () => {
  const y = bay(), r = y.put(1);
  y.view.update(0, 30);
  y.swap(r, y.open, 30);
  y.view.update(0, 30);
  y.swap(r, y.door, 31);
  y.view.update(130, 34);
  y.view.update(500, 45);
  expect(y.cell(r).amount).toBe(0);
  expect(y.mesh(r)).toBe(90);
  y.swap(r, y.open, 45);
  y.view.update(600, 48);
  expect(y.cell(r).amount).toBeGreaterThan(0);
  y.swap(r, y.solid, 48);
  y.view.update(620, 48.6);
  expect(y.cell(r).amount).toBeGreaterThan(0);
  const data = new Uint8Array(INSTANCE_BYTES);
  y.view.write(data, 0, r >>> 16, r & 65535);
  expect(data[16]).toBe(y.cell(r).amount);
  y.view.update(850, 55);
  y.view.write(data, 0, r >>> 16, r & 65535);
  expect(data[16]).toBe(0);
});

test("ownership changes restore both edges even when the shape stays put", () => {
  const y = bay(), left = y.put(1, y.solid), right = y.put(3, y.solid), t = y.table(right), i = right & 65535;
  y.view.update(0);
  expect([y.mesh(left), y.mesh(right)]).toEqual([2, 1]);
  const shape = t.shape;
  y.w.structs.put(right >>> 16, i, t.kind[i]!, t.x[i]!, t.y[i]!, t.z[i]!, t.yaw[i]!, 55, t.hp[i]!, 0);
  expect(t.shape).toBe(shape);
  y.view.update(10);
  expect([y.mesh(left), y.mesh(right)]).toEqual([90, 90]);
});

test("the carrier and its opening contour cross either chunk border", () => {
  for (const [dx, dz] of [[64, 0], [0, -64]]) {
    const x = 2.7, y = 7.9, z = 11.7, xx = x + dx!, zz = z + dz!;
    const a = new Float64Array(3), b = new Float64Array(3);
    tekSpanLight(a, x, y, z, 1.5, 2, .6, .012, 1.8, 1);
    tekSpanLight(b, xx, y, zz, -1.5, 1, .6, .012, 1.8, 1);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 7);
    const front = tekPhaseFront(x, y, z);
    expect(tekPhaseFront(xx, y, zz)).toBeCloseTo(front, 9);
    expect(tekPhaseRim(xx, y, zz, front-.01)).toBeCloseTo(tekPhaseRim(x, y, z, front-.01), 7);
    expect(tekPhaseRim(x, y, z, front+.01)).toBe(-1);
  }
});

test("a bright background leaves the opening crest cyan with a dark blue lip", () => {
  const colour = (rim: number) => [0, 1, 2].map(c => tekPhaseColour(rim, 1, c));
  const edge = colour(1), lip = colour(.55);
  expect(edge[0]).toBeLessThan(edge[1]! * .3);
  expect(edge[2]).toBeLessThan(.85);
  expect(lip[1]).toBeLessThan(edge[1]! * .5);
  expect(colour(0)).toEqual([1, 1, 1]);
});
