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
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";

const RULES = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { furniture: Furniture }).furniture;
const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

// A flat square of 1,024 m on 2 m samples, the ground 1 m up, one district of shops and flats. Roads in engine metres: a
// grid of streets 100 m apart, two of them avenues, which cross at (500, 500).
const N = 513, SIZE = (N - 1) * 2, GROUND = 1;
interface Road { mtfcc: string; width: number; from: [number, number]; to: [number, number]; name?: string }
const GRID: Road[] = [];
for (let at = 100; at <= 900; at += 100) {
  const avenue = at === 500;
  GRID.push({ mtfcc: avenue ? "S1200" : "S1400", width: avenue ? 14 : 8, from: [60, at], to: [964, at] });
  GRID.push({ mtfcc: avenue ? "S1200" : "S1400", width: avenue ? 14 : 8, from: [at, 60], to: [at, 964] });
}
function fixture(roads: readonly Road[], routes: Site["growthRoutes"] = []): Site {
  const source = mkdtempSync(join(tmpdir(), "snark-street-furniture-")); folders.push(source); mkdirSync(join(source, "base"));
  // Each road split at every crossing, as the street data splits its lines.
  const cuts = (r: Road): number[] => [...new Set([0, ...roads.filter((o) => o !== r && (o.from[0] === o.to[0]) !== (r.from[0] === r.to[0])).map((o) => (r.from[0] === r.to[0] ? o.from[1] - r.from[1] : o.from[0] - r.from[0]) / (r.from[0] === r.to[0] ? r.to[1] - r.from[1] : r.to[0] - r.from[0])).filter((t) => t > 0 && t < 1), 1])].sort((a, b) => a - b);
  const features = roads.flatMap((r) => cuts(r).slice(1).map((t, i, all) => {
    const t0 = i === 0 ? 0 : all[i - 1]!; const at = (u: number): [number, number] => [r.from[0] + (r.to[0] - r.from[0]) * u, r.from[1] + (r.to[1] - r.from[1]) * u];
    return { type: "Feature", geometry: { type: "LineString", coordinates: [at(t0), at(t)] }, properties: { mtfcc: r.mtfcc, width_m: r.width, name: r.name ?? null } };
  }));
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
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
  const twice = [...GRID, { ...GRID.find((r) => r.mtfcc === "S1200" && r.from[1] === 500)! }];
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

test("a stop sign whose place a walk's curb ramp takes stands further back along its street, not out in the road", () => {
  const open = place(fixture(GRID)).pieces.filter((p) => p.kind.startsWith(streetKind("stop")));
  // A curb ramp where each of the first ten stands.
  const ramps: StaticPiece[] = open.slice(0, 10).map((p) => ({ kind: "core:zruin_zcurbramp_concrete", x: p.x, y: GROUND + 0.075, z: p.z, yaw: p.yaw }));
  const moved = place(fixture(GRID), ramps).pieces.filter((p) => p.kind.startsWith(streetKind("stop")));
  for (const [i, r] of ramps.entries()) {
    const was = open[i]!; const now = moved.find((p) => Math.hypot(p.x - was.x, p.z - was.z) < 4 && p.yaw === was.yaw);
    expect(now).toBeDefined();
    // As far from its kerb as before, 2.6 m further along the street, away from the junction.
    expect(Math.abs(kerb(GRID, now!.x, now!.z) - kerb(GRID, was.x, was.z))).toBeLessThan(0.05);
    expect(Math.hypot(now!.x - r.x, now!.z - r.z)).toBeCloseTo(RULES.junctions.past, 1);
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
  const { pieces } = place(fixture(roads), [], { ...RULES, forms: { ...RULES.forms, deadend: [["deadend", 1]] } });
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

artTest("each piece is met where it is drawn: its mesh within its shape, and its shape within its mesh, a hand's breadth either way", () => {
  const pack = parsePack(readFileSync(join(import.meta.dir, "../../assets/source/core/props/street/street.snpk")));
  const meshes = unpackMeshes(pack);
  for (const piece of STREET_PIECES) {
    const mesh = meshes.find((m) => m.id === streetKind(piece.name));
    expect(mesh?.lods.length).toBeGreaterThan(0);
    const p = mesh!.lods[0]!.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    // What stands above the ground: a footing or a post carried into it is met as the ground.
    for (let v = 0; v < p.length; v += 3) if (p[v + 1]! > 0.01) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[v + k]!); hi[k] = Math.max(hi[k]!, p[v + k]!); }
    const slo = [Infinity, Infinity, Infinity], shi = [-Infinity, -Infinity, -Infinity];
    for (const b of piece.boxes) for (let k = 0; k < 3; k++) { slo[k] = Math.min(slo[k]!, b.at[k]! - b.half[k]!); shi[k] = Math.max(shi[k]!, b.at[k]! + b.half[k]!); }
    for (const h of piece.hulls ?? []) for (const c of h.corners) for (let k = 0; k < 3; k++) { slo[k] = Math.min(slo[k]!, c[k]!); shi[k] = Math.max(shi[k]!, c[k]!); }
    // Across, up (its top: a post's vertices are at its ends, one below the ground) and toward the road.
    for (const k of [0, 2]) expect([piece.name, k, Math.abs(lo[k]! - slo[k]!) <= 0.25]).toEqual([piece.name, k, true]);
    for (const k of [0, 1, 2]) expect([piece.name, k, Math.abs(hi[k]! - shi[k]!) <= 0.25]).toEqual([piece.name, k, true]);
  }
});
