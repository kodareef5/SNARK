// A marina laid out as a place (tools/boat/marinas.ts): its walkway from the quay, fingers off it, boats in the slips
// between them a size that fits, bow-in mostly, a share held for found vessels, each clear of the rest.

import { expect, test } from "bun:test";
import { DOCK, DOCK_KINDS, isMoored, mooredVessel } from "../../content/docks.ts";
import { BOARD_REACH } from "../../shared/sim/boat-boarding.ts";
import { marinaPaths } from "../../tools/boat/marinas.ts";
import { HARBOURS, type Harbours } from "../../tools/boat/sites.ts";
import { meets, type Box } from "../../tools/mapworld/ruin-obstacles.ts";
import { harbourGround, marinaHarbour, MARINA, pierPath, EDGE, QUAY } from "../fixtures/marina.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const specOf = (id: string) => reg.vehicle[reg.index.get(id)!]!.spec;
const hullOf = (vessel: string, x: number, z: number, yaw: number): Box => {
  const s = specOf(vessel);
  return { x, y: 0, z, yaw, size: [s.halfWidth * 2, 2, s.halfLength * 2] };
};

test("a walkway reaches out from the quay on its modules, its deck the dock's height over the water and never under the quay", () => {
  const { layout } = marinaHarbour(reg);
  const walk = layout.pieces.filter((p) => p.kind === DOCK_KINDS.walk || p.kind === DOCK_KINDS.ramp);
  const along = walk.filter((p) => Math.abs(p.z - 256) < .01);
  expect(along.length).toBeGreaterThan(25);
  expect(Math.min(...along.map((p) => p.x))).toBeLessThan(EDGE);
  for (const p of walk) expect(p.y).toBeGreaterThanOrEqual(Math.max(DOCK.height, harbourGround(p.x) + .1) - 1 / 16);
  // Over the open water it is level at the dock's height, to its rounding and a sixty-fourth between neighbours.
  for (const p of walk.filter((p) => p.x > EDGE + 10)) expect(Math.abs(p.y - DOCK.height)).toBeLessThanOrEqual(1 / 32);
  const run = layout.runs.find((r) => !r.finger && r.id === "1")!;
  expect(run.landed).toBe(true);
  expect(run.points[0]!.x).toBeLessThan(EDGE);
  // A T-head across its outer end, square to it.
  const tee = walk.filter((p) => Math.abs(p.z - 256) > 1);
  expect(tee.length).toBeGreaterThan(2);
  for (const p of tee) { expect(Math.abs(Math.sin(p.yaw * Math.PI / 180))).toBeLessThan(1e-3); expect(p.x).toBeGreaterThan(Math.max(...along.map((q) => q.x))); }
});

test("fingers stand off both sides at the slips' pitch, each with its pile at the tip", () => {
  const { layout } = marinaHarbour(reg);
  const fingers = layout.pieces.filter((p) => p.kind === DOCK_KINDS.finger), piles = layout.pieces.filter((p) => p.kind === DOCK_KINDS.pile);
  expect(fingers.length).toBeGreaterThan(20);
  for (const f of fingers) {
    // Square to the walkway, which runs along x.
    expect(Math.abs(Math.cos(f.yaw * Math.PI / 180))).toBeGreaterThan(.999);
    expect(Math.abs(f.z - 256)).toBeGreaterThan(DOCK.walk / 2);
    expect(Math.abs(f.y - DOCK.height)).toBeLessThanOrEqual(1 / 64);
  }
  expect(piles.length).toBeGreaterThan(8);
  for (const p of piles) expect(fingers.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < DOCK.length / 2 + .01)).toBe(true);
});

test("boats lie in the slips square to the walkway, bow-in mostly, floating, a size that fits, clear of the docks and each other", () => {
  const { layout } = marinaHarbour(reg);
  const slips = layout.slips.filter((s) => s.how === "slip" || s.how === "stern-to");
  expect(slips.length).toBeGreaterThan(12);
  expect(slips.filter((s) => s.how === "slip").length).toBeGreaterThan(slips.filter((s) => s.how === "stern-to").length * 2);
  const docks: Box[] = layout.pieces.filter((p) => p.kind.startsWith("core:zzzzdock_") && p.kind !== DOCK_KINDS.pile).map((p) => ({ x: p.x, y: 0, z: p.z, yaw: p.yaw, size: [p.kind === DOCK_KINDS.finger ? DOCK.finger : DOCK.walk, 2, DOCK.length] }));
  for (const s of slips) {
    const spec = specOf(s.vessel), bow = [Math.sin(s.yaw * Math.PI / 180), Math.cos(s.yaw * Math.PI / 180)] as const;
    // Its keel's line points at the walkway (bow-in) or away (stern-to), tied up a degree or two off it.
    expect(Math.abs(bow[0])).toBeLessThan(Math.sin(1.6 * Math.PI / 180));
    expect(Math.sign(bow[1]) * Math.sign(256 - s.z)).toBe(s.how === "slip" ? 1 : -1);
    expect(-harbourGround(s.x)).toBeGreaterThanOrEqual(spec.draft);
    expect(spec.halfLength * 2).toBeLessThanOrEqual(17);
    for (const d of docks) expect(meets(hullOf(s.vessel, s.x, s.z, s.yaw), d)).toBe(false);
    for (const o of layout.slips) if (o !== s) expect(meets(hullOf(s.vessel, s.x, s.z, s.yaw), hullOf(o.vessel, o.x, o.z, o.yaw))).toBe(false);
    // Its place on the finger beside it, within a survivor's reach of its side (shared/sim/boat-boarding.ts BOARD_REACH).
    expect(s.dock).not.toBeNull();
    expect(Math.abs(s.dock!.x - s.x) - spec.halfWidth).toBeLessThan(BOARD_REACH);
  }
});

test("a share of the slips are held for found vessels, between the marina's bounds; the rest are moored statics of the vessels' hulls", () => {
  const { layout, found } = marinaHarbour(reg);
  const held = layout.slips.filter((s) => s.found), moored = layout.pieces.filter((p) => isMoored(p.kind));
  expect(held.length).toBeGreaterThanOrEqual(HARBOURS.marina.least);
  expect(held.length).toBeLessThanOrEqual(HARBOURS.marina.most);
  // A held slip holds no static; every other filled slip holds one of its own vessel.
  for (const s of held) expect(moored.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < .01)).toBe(false);
  for (const s of layout.slips.filter((s) => !s.found)) expect(moored.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < .01 && mooredVessel(p.kind) === s.vessel) || layout.wrecks.some((w) => Math.hypot(w.x - s.x, w.z - s.z) < .01)).toBe(true);
  // The found vessels lie where their slips are, of the slips' kinds.
  expect(found.length).toBe(held.length);
  for (const v of found) expect(held.some((s) => Math.hypot(s.x - v.x, s.z - v.z) < .01 && s.vessel === v.kind)).toBe(true);
});

test("the same harbour lays out the same, and no chunk holds more moored boats or meshes than the caps", () => {
  const a = marinaHarbour(reg).layout, b = marinaHarbour(reg).layout;
  expect(b.pieces).toEqual(a.pieces); expect(b.slips).toEqual(a.slips);
  const rules: Harbours = { ...HARBOURS, moored: { ...HARBOURS.moored, perChunk: { boats: 4, meshes: 2 } } };
  const { layout } = marinaHarbour(reg, rules);
  const by = new Map<number, string[]>();
  for (const p of layout.pieces) if (isMoored(p.kind) || p.kind.startsWith("core:hulk_")) {
    const c = Math.floor(p.z / 64) * 8 + Math.floor(p.x / 64);
    by.set(c, [...(by.get(c) ?? []), p.kind.startsWith("core:hulk_") ? p.kind : mooredVessel(p.kind)]);
  }
  for (const kinds of by.values()) { expect(kinds.length).toBeLessThanOrEqual(4); expect(new Set(kinds).size).toBeLessThanOrEqual(2); }
});

test("a pier is a marina's dock when it lies near the marina's point over the water, and not when it is far, dry or built on", () => {
  const wet = (x: number) => harbourGround(x) < -.3;
  const near = pierPath(1, [[EDGE - 6, 256], [EDGE + 96, 256]]), far = pierPath(2, [[EDGE + 300, 40], [EDGE + 300, 120]]), dry = pierPath(3, [[20, 200], [150, 200]]);
  const shed = { ...pierPath(4, [[EDGE, 300], [EDGE + 60, 300]]), width: 24, way: { ...pierPath(4, [[EDGE, 300], [EDGE + 60, 300]]).way, closed: true } };
  const taken = marinaPaths([MARINA], [near, far, dry, shed], (x) => wet(x), HARBOURS.docks, (ring) => ring.some(([x]) => x === EDGE));
  expect([...taken.values()].flat().map((p) => p.way.id)).toEqual([1]);
  expect(QUAY).toBeGreaterThan(0);
});
