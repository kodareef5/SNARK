import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STREET_PIECES, streetKind } from "../../content/street.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S } from "../../tools/mapworld/ground.ts";
import { meets, type Box } from "../../tools/mapworld/ruin-obstacles.ts";
import type { Site, StaticPiece } from "../../tools/mapworld/statics.ts";
import { placeFurniture, type Furniture } from "../../tools/mapworld/street-furniture.ts";
import { junctionAt } from "../../tools/mapworld/street-graph.ts";
import { cornersOf } from "../../tools/mapworld/corners.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const RULES = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { furniture: Furniture }).furniture;
const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

// A flat square of 1,024 m on 2 m samples, the ground 1 m up, one district of shops and flats. Roads in engine metres: a
// grid of streets 100 m apart, two of them avenues, which cross at (500, 500).
const N = 513, SIZE = (N - 1) * 2, GROUND = 1;
interface Road { mtfcc: string; width: number; from: [number, number]; to: [number, number]; name?: string; props?: Record<string, unknown> }
/**
 * What the street data holds beside the roads, in the fixture's metres: walk features, stalls, marked points, and road
 * pieces drawn through the points given, each a piece of its own (`line:<n>`), not cut where others cross it.
 */
interface Line { points: [number, number][]; mtfcc: string; width: number; props?: Record<string, unknown> }
interface Beside { walks?: unknown[]; stalls?: unknown[]; controls?: unknown[]; lines?: Line[] }
const GRID: Road[] = [];
for (let at = 100; at <= 900; at += 100) {
  const avenue = at === 500;
  GRID.push({ mtfcc: avenue ? "S1200" : "S1400", width: avenue ? 14 : 8, from: [60, at], to: [964, at] });
  GRID.push({ mtfcc: avenue ? "S1200" : "S1400", width: avenue ? 14 : 8, from: [at, 60], to: [at, 964] });
}
function fixture(roads: readonly Road[], routes: Site["growthRoutes"] = [], beside: Beside = {}): Site {
  const source = mkdtempSync(join(tmpdir(), "snark-street-furniture-")); folders.push(source); mkdirSync(join(source, "base"));
  // Each road split at every crossing, as the street data splits its lines.
  const cuts = (r: Road): number[] => [...new Set([0, ...roads.filter((o) => o !== r && (o.from[0] === o.to[0]) !== (r.from[0] === r.to[0])).map((o) => (r.from[0] === r.to[0] ? o.from[1] - r.from[1] : o.from[0] - r.from[0]) / (r.from[0] === r.to[0] ? r.to[1] - r.from[1] : r.to[0] - r.from[0])).filter((t) => t > 0 && t < 1), 1])].sort((a, b) => a - b);
  // Each piece's id is its road's place in the list and its own along the road.
  const features = roads.flatMap((r, n) => cuts(r).slice(1).map((t, i, all) => {
    const t0 = i === 0 ? 0 : all[i - 1]!; const at = (u: number): [number, number] => [r.from[0] + (r.to[0] - r.from[0]) * u, r.from[1] + (r.to[1] - r.from[1]) * u];
    return { type: "Feature", geometry: { type: "LineString", coordinates: [at(t0), at(t)] }, properties: { id: `${n}:${i}`, mtfcc: r.mtfcc, width_m: r.width, name: r.name ?? null, ...r.props } };
  }));
  for (const [n, l] of (beside.lines ?? []).entries()) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: l.points }, properties: { id: `line:${n}`, mtfcc: l.mtfcc, width_m: l.width, name: null, ...l.props } });
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
  if (beside.walks) writeFileSync(join(source, "base/walks.geojson"), JSON.stringify({ type: "FeatureCollection", features: beside.walks }));
  if (beside.stalls) writeFileSync(join(source, "base/stalls.json"), JSON.stringify(beside.stalls));
  if (beside.controls) writeFileSync(join(source, "base/controls.json"), JSON.stringify(beside.controls));
  const surface = new Uint8Array(N * N).fill(S.OPEN), district = new Uint8Array(N * N).fill(1);
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const x = SIZE - col * 2, z = SIZE - row * 2, i = row * N + col;
    for (const r of roads) {
      const [ax, az] = r.from, [bx, bz] = r.to, ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) <= r.width / 2 + 1.5) surface[i] = S.STREET;
    }
  }
  return { source, world: { heaps: false, districts: [{ name: "Middle", style: "residential", tall: 1, ring: [] }] },
    ground: { grid: gridAt([-SIZE / 2, -SIZE / 2, SIZE / 2, SIZE / 2]), surface, district }, growthRoutes: routes, vehicles: [],
    toLattice: (e: number, n: number) => [e, n], groundAt: () => GROUND } as unknown as Site;
}
const place = (site: Site, placed: StaticPiece[] = [], rules: Furniture = RULES, budget = 2000): ReturnType<typeof placeFurniture> => placeFurniture(site, placed, rules, budget);
const SHAPES = new Map(STREET_PIECES.map((p) => [streetKind(p.name), p]));
/** A piece's boxes in the world. */
const boxes = (p: StaticPiece): Box[] => SHAPES.get(p.kind)!.boxes.map((b) => {
  const a = p.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: p.x + b.at[0] * c + b.at[2] * s, y: p.y + b.at[1], z: p.z - b.at[0] * s + b.at[2] * c, yaw: p.yaw, size: [b.half[0] * 2, b.half[1] * 2, b.half[2] * 2] };
});
/** The distance from (x, z) to the nearest road's kerb, less inside one. */
const kerb = (roads: readonly Road[], x: number, z: number): number => Math.min(...roads.map((r) => {
  const [ax, az] = r.from, [bx, bz] = r.to, ex = bx - ax, ez = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(x - ax - ex * t, z - az - ez * t) - r.width / 2;
}));

test("a city's streets get their furniture by its rules, the same each time it is built", () => {
  const site = fixture(GRID), { pieces, summary } = place(site);
  expect(place(site).pieces).toEqual(pieces);
  // Every rule that has somewhere to stand stands something (meters stand only before shops, and there are none), and
  // nothing is left out for want of room.
  for (const rule of ["signals", "stops", "names", "lamps", "poles", "hydrants", "shelters", "signs", "fences", "corners"]) expect(summary.byRule[rule] ?? 0).toBeGreaterThan(0);
  expect(summary.refused.lamps?.budget ?? 0).toBe(0);
  // Signals stand at the corners of crossings on the avenues, each arm across an avenue's way in: the avenues' own crossing
  // has one at each of its four corners, and some of their crossings with streets have two.
  const signals = pieces.filter((p) => p.kind.startsWith(streetKind("signal")));
  expect(signals.filter((p) => Math.hypot(p.x - 500, p.z - 500) < 16).length).toBeGreaterThanOrEqual(3);
  for (const p of signals) {
    const jx = Math.round(p.x / 100) * 100, jz = Math.round(p.z / 100) * 100;
    expect(Math.hypot(p.x - jx, p.z - jz)).toBeLessThan(16);
    expect(jx === 500 || jz === 500).toBe(true);
    // The arm's tip is over the avenue's lanes.
    const a = p.yaw * Math.PI / 180, tx = p.x + Math.sin(a) * 6, tz = p.z + Math.cos(a) * 6;
    expect(Math.min(Math.abs(tx - 500), Math.abs(tz - 500))).toBeLessThan(7);
    // Its heads look along its +x, at the traffic coming in: the pole stands across the junction from that traffic.
    const fx = Math.cos(a), fz = -Math.sin(a);
    expect((p.x - jx) * fx + (p.z - jz) * fz).toBeLessThan(0);
  }
  // Streets that cross stop one of the two ways, each sign on the right of the traffic it faces, before the crossing.
  const stops = pieces.filter((p) => p.kind.startsWith(streetKind("stop")));
  expect(stops.length).toBeGreaterThan(50);
  for (const p of stops) {
    const a = p.yaw * Math.PI / 180, fx = Math.sin(a), fz = Math.cos(a);
    // Its face looks out along the way it stands by, toward the traffic that comes in along it.
    const jx = Math.round((p.x - fx * 6) / 100) * 100, jz = Math.round((p.z - fz * 6) / 100) * 100;
    expect((p.x - jx) * fx + (p.z - jz) * fz).toBeGreaterThan(4);
    // On that traffic's right: its right while it travels against the face is (fz, -fx) turned as the engine turns it.
    expect((p.x - jx) * -fz + (p.z - jz) * fx).toBeLessThan(0);
  }
  // Lamps along the avenues on both sides, about their spacing apart; along the streets one side at a time.
  const lamps = pieces.filter((p) => p.kind.startsWith(streetKind("lamp")));
  const onAvenue = lamps.filter((p) => Math.abs(p.z - 500) < 9 && p.x > 520 && p.x < 580);
  expect(onAvenue.length).toBeGreaterThanOrEqual(2);
  expect(lamps.length).toBeGreaterThan(300);
});

test("none stands in a lane, in another piece, on a reserved route or over a chunk's budget", () => {
  // A row of crates along one street's kerb, a route across the walk to a door, and a chunk nearly full.
  const crates: StaticPiece[] = [];
  for (let x = 120; x < 200; x += 1) crates.push({ kind: "core:crate", x, y: GROUND + 0.5, z: 305.2, yaw: 0 });
  const route = { points: [{ x: 250, y: GROUND, z: 290 }, { x: 250, y: GROUND, z: 280 }, { x: 250, y: GROUND, z: 270 }], width: 2 };
  const full: StaticPiece[] = Array.from({ length: 1990 }, (_, i) => ({ kind: "core:crate", x: 640 + (i % 2) * 0.01, y: 200, z: 640, yaw: 0 }));
  const site = fixture(GRID, [route]), { pieces } = place(site, [...crates, ...full]);
  const placed = [...crates, ...full];
  for (const p of pieces) {
    const shape = SHAPES.get(p.kind)!;
    for (const b of boxes(p)) {
      // Its parts a body or a car meets are off every lane: past the kerb, or where nothing else fits no more than
      // 0.35 m inside a road's edge, outside its lanes.
      if (b.y - b.size[1] / 2 < p.y + 2.2) for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = b.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hx = b.size[0] / 2 * u!, hz = b.size[2] / 2 * v!;
        expect(kerb(GRID, b.x + hx * c + hz * s, b.z - hx * s + hz * c)).toBeGreaterThan(-0.36);
      }
      for (const q of crates) expect(meets(b, { x: q.x, y: q.y, z: q.z, yaw: 0, size: [1, 1, 1] })).toBe(false);
    }
    expect(shape).toBeDefined();
    // Nothing within the route's half width and its margin of the walk to the door.
    expect(Math.abs(p.x - 250) < 1.3 && p.z > 268 && p.z < 292).toBe(false);
  }
  // The full chunk (640 to 704 along both) took none past its budget.
  const inFull = pieces.filter((p) => Math.floor(p.x / 64) === 10 && Math.floor(p.z / 64) === 10).length;
  expect(placed.filter((p) => Math.floor(p.x / 64) === 10 && Math.floor(p.z / 64) === 10).length + inFull).toBeLessThanOrEqual(2000);
  // No two of them meet.
  const all = pieces.flatMap((p) => boxes(p).map((b) => ({ p, b })));
  for (const { p, b } of all) for (const o of all) if (o.p !== p && Math.hypot(o.b.x - b.x, o.b.z - b.z) < 12) expect(meets(b, o.b, -0.06)).toBe(false);
});

test("a street the data draws twice, under two names, is furnished once", () => {
  // The second drawing's id sorts after the first's, so the first keeps the street.
  const twice = [...GRID, { ...GRID.find((r) => r.mtfcc === "S1200" && r.from[1] === 500)!, props: { id: "z:twice" } }];
  expect(place(fixture(twice)).pieces).toEqual(place(fixture(GRID)).pieces);
});

test("a way onto a bridge is kept clear as a reserved route is: nothing stands within its width", () => {
  // A way 16 m wide down the avenue at x 500, from z 120 to 380, wider than the avenue's own 14.
  const way = { points: [{ x: 500, y: GROUND, z: 120 }, { x: 500, y: GROUND, z: 380 }], width: 16 };
  const open = placeFurniture(fixture(GRID), [], RULES, 2000).pieces, kept = placeFurniture(fixture(GRID), [], RULES, 2000, new Map(), [way]).pieces;
  const on = (p: StaticPiece): boolean => Math.abs(p.x - 500) < 8.4 && p.z > 120 && p.z < 380;
  expect(open.some(on)).toBe(true);
  expect(kept.some(on)).toBe(false);
});

test("where the ruins laid a walk, a piece stands on the walk's top, not in it or refused by it", () => {
  // A walk 2.4 m deep along each side of the avenue at x 500 (14 m wide), its slabs 8 m long, their tops 0.15 m up.
  const walks: StaticPiece[] = [];
  for (let z = 124; z <= 876; z += 8) for (const side of [1, -1]) {
    if (Math.abs(z - 500) < 16 || [100, 200, 300, 400, 600, 700, 800, 900].some((c) => Math.abs(z - c) < 12)) continue;
    walks.push({ kind: "core:zruin_zwalk8_concrete", x: 500 + side * (7 + 1.2), y: GROUND + 0.075, z, yaw: side > 0 ? 90 : 270 });
  }
  const bare = place(fixture(GRID)).pieces, walked = place(fixture(GRID), walks).pieces;
  const onWalk = (p: StaticPiece): boolean => Math.abs(Math.abs(p.x - 500) - 8.2) < 1.1 && walks.some((w) => Math.abs(w.z - p.z) <= 4 && Math.sign(w.x - 500) === Math.sign(p.x - 500));
  const lamps = (ps: StaticPiece[]): StaticPiece[] => ps.filter((p) => p.kind.startsWith(streetKind("lamp")) && onWalk(p));
  expect(lamps(walked).length).toBeGreaterThan(0);
  expect(lamps(walked).length).toBeGreaterThanOrEqual(lamps(bare).length * 0.9);
  // A post standing on the walk stands on its top; a piece that lies over its edge, as a fallen lamp, does too.
  const posts = walked.filter((p) => onWalk(p) && /zzstreet_(lamp|lamp_leaning|lamp_fallen|pole|pole_leaning|hydrant|meter|stop|speed|street_name|signal|evacuation)$/.test(p.kind));
  expect(posts.length).toBeGreaterThan(10);
  for (const p of posts) expect([p.kind, p.y]).toEqual([p.kind, GROUND + 0.15]);
});

test("on bent kerbs a piece stands on their collision as on a walk: its boxes, its flush kerb's ramps and the slopes at a walk's end", () => {
  // The avenue at x 500 given bent kerbs' collision along each side: a walk's box 2.5 m deep in 8 m lengths, every
  // third a flush kerb's ramp and every fifth a walk's end let down.
  const hits: StaticPiece[] = [];
  let k = 0;
  for (let z = 124; z <= 876; z += 8) for (const side of [1, -1]) {
    if (Math.abs(z - 500) < 16 || [100, 200, 300, 400, 600, 700, 800, 900].some((c) => Math.abs(z - c) < 12)) continue;
    const kind = k % 5 === 4 ? "core:zzzzzbendhit_slope_250_150" : k % 3 === 2 ? "core:zzzzzbendhit_ramp_250_800" : "core:zzzzzbendhit_box_250_800";
    k++;
    hits.push({ kind, x: 500 + side * (7 + 1.25), y: GROUND + 0.075, z, yaw: side > 0 ? 90 : 270 });
  }
  const onHits = (p: StaticPiece): boolean => Math.abs(Math.abs(p.x - 500) - 8.25) < 1.25 && Math.abs(p.z - 500) > 20;
  const lamps = (ps: StaticPiece[]): number => ps.filter((p) => p.kind.startsWith(streetKind("lamp")) && onHits(p)).length;
  const bare = place(fixture(GRID)).pieces, laid = place(fixture(GRID), hits).pieces;
  expect(lamps(laid)).toBeGreaterThan(0);
  expect(lamps(laid)).toBeGreaterThanOrEqual(lamps(bare) * 0.9);
  // A post on a box or a ramp stands at the walk's height.
  const boxed = laid.filter((p) => onHits(p) && /zzstreet_(lamp|pole|hydrant)$/.test(p.kind) && hits.some((h) => !h.kind.includes("slope") && Math.abs(h.z - p.z) <= 3.9 && Math.sign(h.x - 500) === Math.sign(p.x - 500)));
  expect(boxed.length).toBeGreaterThan(5);
  for (const p of boxed) expect(p.y).toBeCloseTo(GROUND + 0.15, 6);
});

test("where bent kerbs round a corner, a stop sign keeps off where its planned curb return's ramp would fall, as off a return set down", () => {
  const returns = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { street: { walks: { returns: Parameters<typeof cornersOf>[1] } } }).street.walks.returns;
  const site = fixture(GRID);
  const rounded = cornersOf(site, returns);
  const set: StaticPiece[] = rounded.flatMap((c) => (c.piece ? [{ ...c.piece, y: GROUND + 0.075 }] : []));
  expect(set.length).toBeGreaterThan(20);
  const stops = (ps: StaticPiece[]): string[] => ps.filter((p) => p.kind.startsWith(streetKind("stop"))).map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).sort();
  const planned = stops(placeFurniture(site, [], RULES, 2000, new Map(), [], rounded).pieces);
  expect(planned).toEqual(stops(placeFurniture(site, set, RULES, 2000, new Map(), [], rounded).pieces));
  expect(planned).not.toEqual(stops(place(site).pieces));
});

test("a stop sign whose place a walk's curb ramp takes stands further back along its street, not out in the road", () => {
  const open = place(fixture(GRID)).pieces.filter((p) => p.kind.startsWith(streetKind("stop")));
  // A curb ramp where each of the first ten stands.
  const ramps: StaticPiece[] = open.slice(0, 10).map((p) => ({ kind: "core:zruin_zcurbramp_concrete", x: p.x, y: GROUND + 0.075, z: p.z, yaw: p.yaw }));
  const moved = place(fixture(GRID), ramps).pieces.filter((p) => p.kind.startsWith(streetKind("stop")));
  for (const [i, r] of ramps.entries()) {
    const was = open[i]!; const now = moved.find((p) => Math.hypot(p.x - was.x, p.z - was.z) < 4 && p.yaw === was.yaw);
    expect(now).toBeDefined();
    // As far from its kerb as before, just behind the ramp along the street, away from the junction.
    expect(Math.abs(kerb(GRID, now!.x, now!.z) - kerb(GRID, was.x, was.z))).toBeLessThan(0.05);
    expect(Math.hypot(now!.x - r.x, now!.z - r.z)).toBeGreaterThan(1);
    expect(Math.hypot(now!.x - r.x, now!.z - r.z)).toBeLessThanOrEqual(RULES.junctions.past);
    const junction = (p: StaticPiece): number => Math.max(Math.abs(p.x - Math.round(p.x / 100) * 100), Math.abs(p.z - Math.round(p.z / 100) * 100));
    expect(junction(now!)).toBeGreaterThan(junction(was));
  }
});

test("each class posts its own speed limit", () => {
  const { pieces } = place(fixture(GRID));
  const near = (p: StaticPiece, at: number): boolean => Math.min(Math.abs(p.x - at), Math.abs(p.z - at)) < 12;
  const limits = pieces.filter((p) => /zzstreet_speed/.test(p.kind));
  expect(limits.some((p) => p.kind === streetKind("speed40"))).toBe(true);
  expect(limits.some((p) => p.kind === streetKind("speed30"))).toBe(true);
  // The avenues are at 500; no highway here posts 55.
  for (const p of limits) expect([p.kind, near(p, 500)]).toEqual([p.kind, p.kind === streetKind("speed40")]);
});

test("a street drawn as two one-way carriageways gets ONE WAY beside the way out and DO NOT ENTER on the way in", () => {
  // An avenue of a name drawn twice, 30 m apart, crossed by two streets; its traffic keeps the other way on its left.
  const roads: Road[] = [
    { mtfcc: "S1200", width: 12, from: [485, 60], to: [485, 964], name: "Bay Blvd" },
    { mtfcc: "S1200", width: 12, from: [515, 60], to: [515, 964], name: "Bay Blvd" },
    { mtfcc: "S1400", width: 8, from: [60, 300], to: [964, 300] },
    { mtfcc: "S1400", width: 8, from: [60, 700], to: [964, 700] },
  ];
  // Every sign whole, none a bare post.
  const { pieces } = place(fixture(roads), [], { ...RULES, forms: { ...RULES.forms, oneway: [["oneway", 1]], noentry: [["noentry", 1]] } });
  const at = (kind: string, x: number): StaticPiece[] => pieces.filter((p) => p.kind === streetKind(kind) && Math.abs(p.x - x) < 15);
  // The west way runs north (+z): its arrows point +z, its DO NOT ENTER stands south of each crossing, facing north.
  const west = at("oneway", 485), east = at("oneway", 515);
  expect(west.length).toBeGreaterThan(0); expect(east.length).toBeGreaterThan(0);
  const arrow = (p: StaticPiece): number => Math.round(-Math.sin(p.yaw * Math.PI / 180)); // local +x is (cos yaw, -sin yaw)
  for (const p of west) expect(arrow(p)).toBe(1);
  for (const p of east) expect(arrow(p)).toBe(-1);
  // Each way's DO NOT ENTER stands on the side of a crossing its traffic comes from, facing the crossing.
  const side = (p: StaticPiece): number => Math.sign(p.z - (Math.abs(p.z - 300) < Math.abs(p.z - 700) ? 300 : 700));
  const facing = (p: StaticPiece): number => Math.round(Math.cos(p.yaw * Math.PI / 180));
  expect(at("noentry", 485).length).toBeGreaterThan(0); expect(at("noentry", 515).length).toBeGreaterThan(0);
  for (const p of at("noentry", 485)) expect([side(p), facing(p)]).toEqual([-1, 1]);
  for (const p of at("noentry", 515)) expect([side(p), facing(p)]).toEqual([1, -1]);
});

test("a street that ends without meeting another gets a DEAD END sign at its mouth, facing traffic turning in", () => {
  const roads: Road[] = [...GRID, { mtfcc: "S1400", width: 8, from: [250, 300], to: [250, 370] }];
  // No hydrant, which a street's seed may set where the sign goes.
  const { pieces } = place(fixture(roads), [], { ...RULES, hydrants: { ...RULES.hydrants, classes: [] }, forms: { ...RULES.forms, deadend: [["deadend", 1]] } });
  const dead = pieces.filter((p) => p.kind === streetKind("deadend") && Math.hypot(p.x - 250, p.z - 300) < 30);
  expect(dead.length).toBe(1);
  const p = dead[0]!;
  expect(Math.abs(p.x - 250)).toBeLessThan(6); expect(p.z).toBeGreaterThan(300); expect(p.z).toBeLessThan(320);
  // Its face looks back down the street, -z.
  expect(Math.round(Math.cos(p.yaw * Math.PI / 180))).toBe(-1);
});

test("a share of the standing lamps still works, more on an avenue than a street, none in a district left dark", () => {
  const { pieces } = place(fixture(GRID));
  const lamps = pieces.filter((p) => p.kind === streetKind("lamp") || p.kind === streetKind("lamp_lit"));
  const share = (avenue: boolean): number => {
    const ps = lamps.filter((p) => (Math.min(Math.abs(p.x - 500), Math.abs(p.z - 500)) < 12) === avenue);
    return ps.filter((p) => p.kind === streetKind("lamp_lit")).length / ps.length;
  };
  expect(share(true)).toBeGreaterThan(0.15); expect(share(false)).toBeGreaterThan(0.02);
  expect(share(true)).toBeGreaterThan(share(false));
  const dark = fixture(GRID); (dark.world as unknown as { districts: { style: string }[] }).districts[0]!.style = "industrial";
  expect(place(dark).pieces.some((p) => p.kind === streetKind("lamp_lit"))).toBe(false);
});

test("a rule that names a piece the set lacks stops the build", () => {
  const rules = { ...RULES, forms: { ...RULES.forms, lamp: [["lamp_post", 1]] as [string, number][] } };
  expect(() => place(fixture(GRID.slice(0, 2)), [], rules)).toThrow("furniture.forms names lamp_post, which is no street piece");
});

artTest("each piece is met where it is drawn: its mesh within its shape, and its shape within its mesh, a hand's breadth either way; paint as the ground", () => {
  const pack = parsePack(readFileSync(join(import.meta.dir, "../../assets/source/core/props/street/street.snpk")));
  const meshes = unpackMeshes(pack);
  for (const piece of STREET_PIECES) {
    const mesh = meshes.find((m) => m.id === streetKind(piece.name));
    expect(mesh?.lods.length).toBeGreaterThan(0);
    const p = mesh!.lods[0]!.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    // What stands above the ground: a footing or a post carried into it is met as the ground.
    for (let v = 0; v < p.length; v += 3) if (p[v + 1]! > 0.01) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[v + k]!); hi[k] = Math.max(hi[k]!, p[v + k]!); }
    // Paint lies a hair over the ground, and its box wholly under the ground, so that the ground is what anything meets.
    if (piece.paint) {
      expect([piece.name, lo[1]! > 0, hi[1]! < 0.03]).toEqual([piece.name, true, true]);
      for (const b of piece.boxes) expect([piece.name, b.at[1]! + b.half[1]! < -0.1]).toEqual([piece.name, true]);
      continue;
    }
    const slo = [Infinity, Infinity, Infinity], shi = [-Infinity, -Infinity, -Infinity];
    for (const b of piece.boxes) for (let k = 0; k < 3; k++) { slo[k] = Math.min(slo[k]!, b.at[k]! - b.half[k]!); shi[k] = Math.max(shi[k]!, b.at[k]! + b.half[k]!); }
    for (const h of piece.hulls ?? []) for (const c of h.corners) for (let k = 0; k < 3; k++) { slo[k] = Math.min(slo[k]!, c[k]!); shi[k] = Math.max(shi[k]!, c[k]!); }
    // Across, up (its top: a post's vertices are at its ends, one below the ground) and toward the road.
    for (const k of [0, 2]) expect([piece.name, k, Math.abs(lo[k]! - slo[k]!) <= 0.25]).toEqual([piece.name, k, true]);
    for (const k of [0, 1, 2]) expect([piece.name, k, Math.abs(hi[k]! - shi[k]!) <= 0.25]).toEqual([piece.name, k, true]);
  }
});

/** GRID with some of its roads given what the street data says of them. */
const tagged = (props: Record<number, Record<string, unknown>>): Road[] => GRID.map((r, i) => (props[i] ? { ...r, props: props[i] } : r));
/** GRID's road along x = `x` (they run from z = 60 to 964), by its place in the list. */
const northward = (x: number): number => GRID.findIndex((r) => r.from[0] === x && r.to[0] === x);
const near = (pieces: readonly StaticPiece[], kind: string, x: number, z: number, r: number): StaticPiece[] => pieces.filter((p) => p.kind === streetKind(kind) && Math.hypot(p.x - x, p.z - z) < r);

test("junctions are where three ways meet: where a street's data changes in the middle of a block nothing of a corner stands, and the walks end at none", () => {
  // The street along z = 300 drawn as two pieces that meet at x = 250, between two crossings, as a way ends where its
  // tags change.
  const roads: Road[] = [...GRID.filter((r) => !(r.from[1] === 300 && r.to[1] === 300)), { mtfcc: "S1400", width: 8, from: [60, 300], to: [250, 300], name: "Heron St" }, { mtfcc: "S1400", width: 8, from: [250, 300], to: [964, 300], name: "Heron Street" }];
  const site = fixture(roads);
  const { pieces } = place(site);
  expect(pieces.filter((p) => Math.hypot(p.x - 250, p.z - 300) < 14 && /zzstreet_(stop|street_name|signal|mailbox|newsbox|bollard|noentry|oneway|deadend)/.test(p.kind))).toEqual([]);
  expect(junctionAt(site, 250, 300, 10)).toBe(false);
  expect(junctionAt(site, 300, 300, 10)).toBe(true);
  expect(junctionAt(site, 60, 300, 10)).toBe(false);
});

test("a way the data says is one way gets DO NOT ENTER on its way in and ONE WAY beside its way out, without a pair to guess it from", () => {
  const forms = { ...RULES.forms, oneway: [["oneway", 1]], noentry: [["noentry", 1]] } as Furniture["forms"];
  // The street along x = 300 runs north only, as drawn.
  const { pieces } = place(fixture(tagged({ [northward(300)]: { highway: "residential", oneway: true } })), [], { ...RULES, forms });
  const noentry = pieces.filter((p) => p.kind === streetKind("noentry") && Math.abs(p.x - 300) < 15);
  expect(noentry.length).toBeGreaterThan(3);
  // Each stands on the side of a crossing its traffic comes from: south of it.
  for (const p of noentry) expect(p.z).toBeLessThan(Math.round(p.z / 100) * 100);
  expect(pieces.filter((p) => p.kind === streetKind("oneway") && Math.abs(p.x - 300) < 15).length).toBeGreaterThan(0);
  expect(pieces.filter((p) => /zzstreet_(noentry|oneway)$/.test(p.kind) && Math.abs(p.x - 200) < 15 && Math.abs(p.z - 500) > 20).length).toBe(0);
});

test("a side the data says has no sidewalk has nothing of a sidewalk on it; a street it says is unlit has no lamps", () => {
  const { pieces } = place(fixture(tagged({ [northward(700)]: { highway: "residential", sidewalk: "no" }, [northward(600)]: { highway: "residential", lit: false } })));
  const along = (x: number, kinds: RegExp): StaticPiece[] => pieces.filter((p) => kinds.test(p.kind) && Math.abs(p.x - x) < 12 && Math.abs(p.z - Math.round(p.z / 100) * 100) > 15);
  expect(along(700, /zzstreet_hydrant$/).length).toBe(0);
  expect(along(800, /zzstreet_hydrant$/).length).toBeGreaterThan(0);
  expect(along(600, /zzstreet_lamp/).length).toBe(0);
  expect(along(400, /zzstreet_lamp/).length).toBeGreaterThan(0);
});

test("speed limits, meters and no parking as the data says, where it says", () => {
  const forms = { ...RULES.forms, speed40: [["speed40", 1]], speed30: [["speed30", 1]], noparking: [["noparking", 1]] } as Furniture["forms"];
  const roads = tagged({ [northward(800)]: { highway: "residential", maxspeed_mph: 40 }, [northward(200)]: { highway: "residential", parking_left: "parallel", parking_right: "parallel" }, [northward(400)]: { highway: "residential", parking_left: "no" } });
  const { pieces } = place(fixture(roads), [], { ...RULES, forms });
  const along = (x: number, kind: string): StaticPiece[] => pieces.filter((p) => p.kind === streetKind(kind) && Math.abs(p.x - x) < 12);
  expect(along(800, "speed40").length).toBeGreaterThan(0);
  expect(along(800, "speed30").length).toBe(0);
  expect(along(700, "speed30").length).toBeGreaterThan(0);
  // No building in the fixture is a shop, so meters stand only where the data says cars stand at the kerb.
  expect(along(200, "meter").length + along(200, "meter_bent").length).toBeGreaterThan(0);
  expect(pieces.filter((p) => /zzstreet_meter/.test(p.kind) && Math.abs(p.x - 200) > 12).length).toBe(0);
  // No parking on the left of the way it is drawn (north): the west side, +x.
  const signs = along(400, "noparking").filter((p) => Math.abs(p.z - Math.round(p.z / 100) * 100) > 20);
  expect(signs.length).toBeGreaterThan(3);
  for (const p of signs) expect(p.x).toBeGreaterThan(400);
});

test("signals and stops where the data marks them, the class rule only at a junction it marks nothing at, and none where it marks points elsewhere", () => {
  const forms = { ...RULES.forms, signal: [["signal", 1]], stop: [["stop", 1]] } as Furniture["forms"];
  // A signal at two streets' crossing (300, 300), governing all four ways in, and a stop for traffic going north on
  // x = 400 into (400, 400), along the piece from z = 300 to 400 as it is drawn.
  // As tools/mapdata/streets.py writes them: a place in the data's metres, and each approach's piece and travel, east
  // and north (the fixture's metres are the engine's).
  const controls = [
    { kind: "signal", e: 300, n: 300, direction: null, all_way: false, junction: true, crossing: null, markings: null, approaches: [{ road: `${northward(300)}:2`, travel: [0, 1] }, { road: `${northward(300)}:3`, travel: [0, -1] }] },
    { kind: "stop", e: 400, n: 394, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: `${northward(400)}:3`, travel: [0, 1] }] },
  ];
  const { pieces } = place(fixture(GRID, [], { controls }), [], { ...RULES, forms });
  expect(near(pieces, "signal", 300, 300, 25).length).toBeGreaterThan(0);
  expect(near(pieces, "stop", 300, 300, 25).length).toBe(0);
  const stops = near(pieces, "stop", 400, 400, 25);
  expect(stops.length).toBe(1);
  expect(stops[0]!.z).toBeLessThan(400);
  // The avenues' crossing, which the classes' rule signals, has none: the data marks signals, none there.
  expect(near(pieces, "signal", 500, 500, 30).length).toBe(0);
});

test("nothing stands on a crossing, and the crossing sign stands before one no signal holds, of a marked type where the data says", () => {
  // The walk network's crossings, with their type where the data keeps it.
  const forms = { ...RULES.forms, crossing: [["crossing", 1]] } as Furniture["forms"];
  const rules = { ...RULES, forms, regulations: { ...RULES.regulations, crossing: { ...RULES.regulations.crossing, chance: 1 } } };
  const crossing = (z: number, props: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[194, z], [206, z]] }, properties: { kind: "crossing", width_m: 3, ...props } });
  // Across the street along x = 200, mid-block: one marked, one unmarked, one at a signal.
  const walks = [crossing(250, { drawn: true, crossing: "marked" }), crossing(650, { drawn: true, crossing: "unmarked" }), crossing(450, { drawn: false, signal: true })];
  const { pieces } = place(fixture(GRID, [], { walks }), [], rules);
  // Nothing but its stripes.
  for (const p of pieces.filter((q) => !/crosswalk/.test(q.kind))) for (const b of boxes(p)) for (const z of [250, 450, 650]) expect(Math.abs(b.x - 200) < 7 && Math.abs(b.z - z) < 1.5 + RULES.clear.crossing).toBe(false);
  expect(near(pieces, "crossing", 200, 250, 15).length).toBe(2);
  expect(near(pieces, "crossing", 200, 650, 15).length).toBe(0);
  expect(near(pieces, "crossing", 200, 450, 15).length).toBe(0);
  // The unmarked one has no stripes; the others have theirs.
  const striped = (z: number): number => pieces.filter((p) => /crosswalk/.test(p.kind) && Math.abs(p.z - z) < 2).length;
  expect([striped(250), striped(450), striped(650)].map((n) => n > 0)).toEqual([true, true, false]);
});

test("a crossing is striped between the kerbs, the longest pieces first, and a lot with stalls has its pay station", () => {
  // Across the avenue along x = 500 (14 m wide), between z = 600 and 700, a crossing drawn in three pieces: walk, road, walk.
  const walks = [{ type: "Feature", geometry: { type: "LineString", coordinates: [[490, 650], [493, 650], [507, 650], [510, 650]] }, properties: { kind: "crossing", drawn: true, width_m: 3 } }];
  // A lot of twelve stalls in a row facing north onto an aisle, west of x = 260 at z = 640.
  const stalls = Array.from({ length: 12 }, (_, i) => ({ lot: "osm:way/1", e: 220 + i * 2.7, n: 635, fe: 220 + i * 2.7, fn: 637.5 }));
  const { pieces } = place(fixture(GRID, [], { walks, stalls }));
  const bars = pieces.filter((p) => /zzstreet_crosswalk/.test(p.kind)).sort((a, b) => a.x - b.x);
  // 14 m less 0.3 m at each kerb: 8 bars, 2 and 1, 13.2 m of them, about the road's middle.
  expect(bars.map((p) => Number(p.kind.replace(/^.*crosswalk(\d+).*$/, "$1"))).sort((a, b) => b - a)).toEqual([8, 2, 1]);
  for (const p of bars) { expect(Math.abs(p.z - 650)).toBeLessThan(0.01); expect(Math.abs(p.x - 500)).toBeLessThan(7); expect(p.y).toBe(GROUND); }
  const station = pieces.filter((p) => /zzstreet_paystation/.test(p.kind));
  expect(station.length).toBe(1);
  // At the head of a stall, south of the row, its panel (-z) to the aisle in the north.
  expect(station[0]!.z).toBeLessThan(635);
  expect(Math.round(Math.cos(station[0]!.yaw * Math.PI / 180))).toBe(-1);
});

test("a stop or a signal the data maps away from any junction stands at its own point, on the right of the traffic it governs", () => {
  const forms = { ...RULES.forms, signal: [["signal", 1]], stop: [["stop", 1]] } as Furniture["forms"];
  const controls = [
    { kind: "stop", e: 400, n: 350, direction: null, all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: `${northward(400)}:3`, travel: [0, 1] }] },
    { kind: "signal", e: 200, n: 450, direction: null, all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: `${northward(200)}:4`, travel: [0, -1] }] },
  ];
  const { pieces, summary } = place(fixture(GRID, [], { controls }), [], { ...RULES, forms });
  // Northbound traffic's right is -x; the sign stands before the point, facing the traffic (south).
  const stop = near(pieces, "stop", 400, 350, 8);
  expect(stop.length).toBe(1);
  expect(stop[0]!.x).toBeLessThan(400); expect(stop[0]!.z).toBeLessThan(350);
  expect(Math.round(Math.cos(stop[0]!.yaw * Math.PI / 180))).toBe(-1);
  // Southbound traffic's right is +x; the signal stands past the point.
  const signal = near(pieces, "signal", 200, 450, 10);
  expect(signal.length).toBe(1);
  expect(signal[0]!.x).toBeGreaterThan(200); expect(signal[0]!.z).toBeLessThan(450);
  expect(summary.mapped?.stop).toEqual({ mapped: 1, used: 1, rest: {} });
  expect(summary.mapped?.signal).toEqual({ mapped: 1, used: 1, rest: {} });
});

test("a crossing on an avenue keeps its stripes fresh", () => {
  const walks = [{ type: "Feature", geometry: { type: "LineString", coordinates: [[490, 650], [510, 650]] }, properties: { kind: "crossing", drawn: true, width_m: 3 } }];
  const { pieces } = place(fixture(GRID, [], { walks }));
  const bars = pieces.filter((p) => /zzstreet_crosswalk/.test(p.kind));
  expect(bars.length).toBeGreaterThan(0);
  expect(bars.filter((p) => p.kind.endsWith("_worn"))).toEqual([]);
});

test("a give-way the data maps has its YIELD sign before it, facing the traffic it governs", () => {
  const forms = { ...RULES.forms, yield: [["yield", 1]] } as Furniture["forms"];
  const controls = [{ kind: "give_way", e: 600, n: 350, direction: null, all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: `${northward(600)}:3`, travel: [0, 1] }] }];
  const { pieces, summary } = place(fixture(GRID, [], { controls }), [], { ...RULES, forms });
  const sign = near(pieces, "yield", 600, 350, 8);
  expect(sign.length).toBe(1);
  expect(sign[0]!.z).toBeLessThan(350);
  expect(summary.mapped?.give_way).toEqual({ mapped: 1, used: 1, rest: {} });
});

/** The distance from (x, z) to a drawn line's middle. */
const fromLine = (l: Line, x: number, z: number): number => Math.min(...l.points.slice(1).map((b, i) => {
  const a = l.points[i]!, ex = b[0] - a[0], ez = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
}));

test("a stop sign follows its way's line where it bends, and stands behind the crossing that takes its first place", () => {
  // A street that leaves an avenue northward and bends east within ten metres: set along the first stretch's straight line,
  // the sign would stand in the street's own lanes.
  const avenue: Line = { points: [[300, 800], [500, 800], [700, 800]], mtfcc: "S1200", width: 14 };
  const street: Line = { points: [[500, 800], [500, 805], [510, 820], [520, 860]], mtfcc: "S1400", width: 8 };
  // A crossing 6 m wide across the street at x = 200, south of the avenue, where its sign's first place is (9 m out).
  const walks = [{ type: "Feature", geometry: { type: "LineString", coordinates: [[194, 489], [206, 489]] }, properties: { kind: "crossing", width_m: 6 } }];
  const rules = { ...RULES, junctions: { ...RULES.junctions, signalCross: 0 } };
  const { pieces } = place(fixture(GRID.filter((r) => r.to[1] < 790 || r.from[1] > 810 || r.from[0] === r.to[0] && r.from[0] !== 500), [], { lines: [avenue, street], walks }), [], rules);
  const bent = pieces.filter((p) => p.kind.startsWith(streetKind("stop")) && Math.hypot(p.x - 500, p.z - 800) < 25 && p.z > 800);
  expect(bent.length).toBe(1);
  const sign = bent[0]!;
  // Off the street's kerb by its setback, clear of the avenue, on the right of the traffic coming south to the avenue (+x).
  expect(fromLine(street, sign.x, sign.z) - 4).toBeGreaterThan(RULES.junctions.stop - 0.2);
  expect(fromLine(street, sign.x, sign.z) - 4).toBeLessThan(2 * RULES.junctions.stop + 0.2);
  expect(sign.z - 800 - 7).toBeGreaterThan(RULES.clear.road);
  expect(sign.x).toBeGreaterThan(500);
  // At x = 200 the northbound traffic's sign stands south of the crossing, clear of it, no further than it may go.
  const south = pieces.filter((p) => p.kind.startsWith(streetKind("stop")) && Math.abs(p.x - 200) < 8 && p.z < 500 && p.z > 460);
  expect(south.length).toBe(1);
  expect(south[0]!.z).toBeLessThan(489 - 3 - RULES.clear.crossing);
  expect(500 - 7 - RULES.junctions.stopBack - south[0]!.z).toBeLessThanOrEqual(RULES.junctions.seek);
});

// A divided avenue, its carriageways one way at z = 500 (east, as drawn) and z = 512 (west), crossed at x = 200 by a
// two-way street; one-way streets leave the near carriageway at x = 300 and come to it at x = 400. Each piece ends at
// the junctions, as the street data cuts its ways.
const DIVIDED: Line[] = [
  ...[[60, 200], [200, 300], [300, 400], [400, 964]].map(([a, b]): Line => ({ points: [[a!, 500], [b!, 500]], mtfcc: "S1200", width: 8, props: { highway: "primary", oneway_dir: 1 } })),
  ...[[964, 200], [200, 60]].map(([a, b]): Line => ({ points: [[a!, 512], [b!, 512]], mtfcc: "S1200", width: 8, props: { highway: "primary", oneway_dir: 1 } })),
  ...[[300, 500], [500, 512], [512, 700]].map(([a, b]): Line => ({ points: [[200, a!], [200, b!]], mtfcc: "S1400", width: 8, props: { highway: "residential" } })),
  { points: [[300, 500], [300, 300]], mtfcc: "S1400", width: 8, props: { highway: "residential", oneway_dir: 1 } },
  { points: [[400, 300], [400, 500]], mtfcc: "S1400", width: 8, props: { highway: "residential", oneway_dir: 1 } },
];
const stopsNear = (pieces: readonly StaticPiece[], x: number, z0: number, z1: number): StaticPiece[] => pieces.filter((p) => p.kind.startsWith(streetKind("stop")) && Math.abs(p.x - x) < 8 && p.z > z0 && p.z < z1);

test("the classes' rule puts no stop in a divided road's median, nor on a one-way street that leaves the junction, and names the corner all the same", () => {
  const rules = { ...RULES, junctions: { ...RULES.junctions, signalCross: 0 } };
  const { pieces } = place(fixture([], [], { lines: DIVIDED }), [], rules);
  expect(stopsNear(pieces, 200, 480, 500).length).toBe(1);
  expect(stopsNear(pieces, 200, 500, 512).length).toBe(0);
  expect(stopsNear(pieces, 200, 512, 535).length).toBe(1);
  expect(stopsNear(pieces, 300, 470, 500).length).toBe(0);
  expect(stopsNear(pieces, 400, 470, 500).length).toBe(1);
  // Where it stops no way, the corner still has its street-name sign.
  expect(near(pieces, "street_name", 300, 500, 15).length).toBe(1);
});

test("a mapped control counts as standing only where a sign of its own stands, and the count says what each of the rest is", () => {
  const controls = [
    // Northbound on the street at x = 200, before the near carriageway.
    { kind: "stop", e: 200, n: 495, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:6", travel: [0, 1] }] },
    // Northbound at x = 400, where a signal holds the junction.
    { kind: "signal", e: 400, n: 500, direction: null, all_way: false, junction: true, crossing: null, markings: null, approaches: [{ road: "line:10", travel: [0, 1] }] },
    { kind: "stop", e: 400, n: 495, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:10", travel: [0, 1] }] },
    // One the data gives no way for, and one southbound at x = 300 whose every place a row of crates takes.
    { kind: "stop", e: 640, n: 640, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [] },
    { kind: "stop", e: 300, n: 380, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:9", travel: [0, -1] }] },
  ];
  const crates: StaticPiece[] = [];
  for (let z = 374; z <= 397; z += 0.5) for (const x of [304.75, 305.5, 306.25]) crates.push({ kind: "core:crate", x, y: GROUND + 0.5, z, yaw: 0 });
  const { pieces, summary } = place(fixture([], [], { lines: DIVIDED, controls }), crates);
  expect(stopsNear(pieces, 200, 480, 500).length).toBe(1);
  expect(stopsNear(pieces, 300, 370, 400).length).toBe(0);
  expect(summary.mapped?.stop).toEqual({ mapped: 4, used: 1, rest: { signal: 1, nothing: 1, piece: 1 } });
  expect(summary.mapped?.signal?.used).toBe(1);
});

test("a mapped signal has a head for each way in where two of its ways run on in line, a corner short", () => {
  const forms = { ...RULES.forms, signal: [["signal", 1]] } as Furniture["forms"];
  const rules = { ...RULES, forms, junctions: { ...RULES.junctions, standing: 1 } };
  const lines: Line[] = [{ points: [[100, 800], [500, 800], [900, 800]], mtfcc: "S1200", width: 14 }, { points: [[500, 800], [500, 600]], mtfcc: "S1400", width: 8 }];
  const controls = [{ kind: "signal", e: 500, n: 800, direction: null, all_way: false, junction: true, crossing: null, markings: null, approaches: [] }];
  const { pieces } = place(fixture([], [], { lines, controls }), [], rules);
  expect(near(pieces, "signal", 500, 800, 25).length).toBe(3);
});

test("no bars are laid on a crossing of a road the data says is a bridge, which they would lie under", () => {
  const walks = [{ type: "Feature", geometry: { type: "LineString", coordinates: [[190, 650], [210, 650]] }, properties: { kind: "crossing", drawn: true, width_m: 3 } }];
  const bars = (roads: Road[]): number => place(fixture(roads, [], { walks })).pieces.filter((p) => /zzstreet_crosswalk/.test(p.kind) && Math.abs(p.z - 650) < 2).length;
  expect(bars(GRID)).toBeGreaterThan(0);
  expect(bars(tagged({ [northward(200)]: { highway: "residential", bridge: true } }))).toBe(0);
});

test("a mapped give-way on a junction's way keeps the classes' stop off it, and no second sign faces traffic one already faces", () => {
  const forms = { ...RULES.forms, yield: [["yield", 1]], stop: [["stop", 1]] } as Furniture["forms"];
  const rules = { ...RULES, forms, junctions: { ...RULES.junctions, signalCross: 0 } };
  // A give-way 6 m before the near carriageway on the street at x = 200, northbound; and a stop and a give-way the data
  // maps on one point of the one-way street at x = 400, both for its northbound traffic.
  const controls = [
    { kind: "give_way", e: 200, n: 494, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:6", travel: [0, 1] }] },
    { kind: "stop", e: 400, n: 470, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:10", travel: [0, 1] }] },
    { kind: "give_way", e: 400, n: 470, direction: "forward", all_way: false, junction: false, crossing: null, markings: null, approaches: [{ road: "line:10", travel: [0, 1] }] },
  ];
  const { pieces, summary } = place(fixture([], [], { lines: DIVIDED, controls }), [], rules);
  const signs = (x: number, z0: number, z1: number, kind: RegExp) => pieces.filter((p) => kind.test(p.kind) && Math.abs(p.x - x) < 8 && p.z > z0 && p.z < z1);
  expect(signs(200, 470, 500, /zzstreet_stop/).length).toBe(0);
  expect(signs(200, 470, 500, /zzstreet_yield/).length).toBe(1);
  expect(signs(400, 440, 480, /zzstreet_(stop|yield)/).length).toBe(1);
  // The give-way the stop serves counts as standing: a sign faces its traffic.
  expect(summary.mapped?.give_way).toEqual({ mapped: 2, used: 2, rest: {} });
});

test("billboards stand about so many a square kilometre of land, in the sizes their road's class draws, most of them working", () => {
  const site = fixture(GRID), km2 = (N * N * 4) / 1e6;
  const boards = (perKm2: number): StaticPiece[] => place(site, [], { ...RULES, billboards: { ...RULES.billboards, perKm2 } }, 4000).pieces.filter((p) => p.kind.startsWith(streetKind("billboard")));
  // The number is the map's budget: four times it stands four times as many.
  const [few, many] = [boards(10), boards(40)];
  expect([few.length, many.length]).toEqual([Math.round(10 * km2), Math.round(40 * km2)]);
  expect(boards(0)).toEqual([]);
  // The few are among the many: a larger budget adds boards and moves none.
  for (const p of few) expect(many.some((q) => q.kind === p.kind && q.x === p.x && q.z === p.z)).toBe(true);
  // An avenue draws the standard and the mid board, a street the small and the mid: each from its class's row of forms.
  const all = boards(400), name = (p: StaticPiece): string => p.kind.slice(streetKind("billboard").length);
  const nearest = (p: StaticPiece): number => Math.min(Math.abs(p.x - Math.round(p.x / 100) * 100), Math.abs(p.z - Math.round(p.z / 100) * 100));
  const onAvenue = (p: StaticPiece): boolean => (Math.abs(p.x - 500) < 30 && Math.abs(p.x - 500) === nearest(p)) || (Math.abs(p.z - 500) < 30 && Math.abs(p.z - 500) === nearest(p));
  expect(new Set(all.filter(onAvenue).map(name))).toEqual(new Set(["", "_mid", "_bare", "_mid_bare"]));
  expect(new Set(all.filter((p) => !onAvenue(p)).map(name))).toEqual(new Set(["_small", "_mid", "_small_bare", "_mid_bare"]));
  // Five in six work.
  const bare = all.filter((p) => p.kind.endsWith("_bare")).length;
  expect(all.length).toBeGreaterThan(100);
  expect(bare / all.length).toBeGreaterThan(0.08);
  expect(bare / all.length).toBeLessThan(0.28);
});
