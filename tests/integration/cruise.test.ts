import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_COLLISION_INSTANCES, CRUISE_LAYOUT, cruisePoint } from "../../content/landmarks/cruise.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseApproach, cruiseCourse, cruisePort, cruisePortApproach, cruiseWorldPoint } from "../../tools/cruise/course.ts";
import { assertCruiseMap, assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { cruiseNavigator, cruiseRefs, cruiseWalker } from "../fixtures/cruise.ts";
import { Harness } from "../fixtures/net.ts";

const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const core = compiled.registry, course = cruiseCourse(), reg = withContent(core, course.content?.defs ?? []), map = writeMap(course);

test("a cruise visitor walks the real shore, quay and gangway in both directions", () => {
  const h = new Harness({}, 73, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const report = assertCruiseMap(course, reg), refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel);
    expect(assertCruisePlaced(course, h.world.structs, reg).length).toBe(report.statics);
    expect(refs.size).toBe(CRUISE_COLLISION_INSTANCES.filter(i => i.placed).length);
    const s = h.join("cruise visitor"); h.run(900);
    const before = s.stats.corrections, walk = cruiseWalker(h, reg, CRUISE_COURSE.vessel), approach = cruiseApproach(course);
    for (let i = 1; i < approach.length; i++) walk.world(approach[i]!, `shore to ship[${i}]`, i > 1);
    const arrival = cruiseWorldPoint(CRUISE_LAYOUT.docking.arrival);
    expect(Math.hypot(s.own.x - arrival[0], s.own.z - arrival[2])).toBeLessThan(.15);
    expect(s.own.y).toBeCloseTo(arrival[1], 2);
    expect(s.own.mode).toBe(MODE_WALK);
    for (let i = approach.length - 2; i >= 0; i--) walk.world(approach[i]!, `ship to shore[${i}]`, i > 0);
    expect(s.stats.corrections - before).toBe(0);
    expect(Math.hypot(s.own.x - CRUISE_COURSE.spawn.x, s.own.z - CRUISE_COURSE.spawn.z)).toBeLessThan(.15);
  } finally { h.host.shutdown(); }
});

test("a cruise at an arbitrary native yaw retains walkable stairs and independent usable door instances", () => {
  const placement = { ...CRUISE_COURSE.vessel, yaw: 9123 };
  const point = (p: readonly number[]) => cruisePoint(placement.x, placement.y, placement.z, placement.yaw, p);
  const landing = point(CRUISE_LAYOUT.docking.shoreLanding);
  const rotated = cruisePort({ vessel: placement, landing });
  const h = new Harness({}, 77, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(rotated) }, core);
  try {
    const refs = cruiseRefs(rotated, h.world.structs, reg, placement), s = h.join("rotated cruise guest"); h.run(900);
    const before = s.stats.corrections, nav = cruiseNavigator(h, reg, placement, refs), approach = cruisePortApproach(rotated, landing);
    for (let i = 1; i < approach.length; i++) nav.world(approach[i]!, `rotated approach[${i}]`, i > 1);
    const door = CRUISE_LAYOUT.doors[0]!, route = CRUISE_LAYOUT.routes.find(r => "requiresOpen" in r && r.requiresOpen === door.instanceId)!;
    nav.visit(route.id);
    const target = point(route.anchors.at(-1)!);
    expect(Math.hypot(s.own.x - target[0], s.own.y - target[1], s.own.z - target[2])).toBeLessThan(.15);
    const ref = refs.get(door.instanceId)!;
    expect(h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 65535]).toBe(reg.index.get(door.openPrototype)!);
    nav.reach(CRUISE_LAYOUT.routes.find(r => r.kind === "docking")!.from);
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("the Pearl connects promenade and cafe through its actual open shell and sloping stair", () => {
  const h = new Harness({}, 78, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel), s = h.join("Pearl visitor"); h.run(900);
    const before = s.stats.corrections, nav = cruiseNavigator(h, reg, CRUISE_COURSE.vessel, refs), approach = cruiseApproach(course);
    for (let i = 1; i < approach.length - 2; i++) nav.world(approach[i]!, `Pearl shore approach[${i}]`, i > 1);
    nav.visit("pearl_through");
    expect(s.own.y).toBeCloseTo(CRUISE_LAYOUT.decks.find(d => d.id === "6")!.floorY, 2);
    nav.visit("pearl_cafe_access"); nav.visit("pearl_through", true);
    nav.reach(CRUISE_LAYOUT.routes.find(r => r.kind === "docking")!.from);
    expect(s.own.y).toBeCloseTo(CRUISE_LAYOUT.decks.find(d => d.id === "5")!.floorY, 2);
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("cruise peers walk to upper decks and independently saved cabin doors survive rejoin and restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-cruise-")), opts = { dev: true, clips: NO_CLIPS, rigs: [], map, dbPath: join(dir, "world.db") };
  const link = { latencyMs: 70, jitterMs: 12, loss: .02 }, names = ["cabin guest", "upper deck guest"];
  let h = new Harness({}, 76, 60, opts, core);
  try {
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel);
    const first = CRUISE_LAYOUT.doors[0]!, second = CRUISE_LAYOUT.doors[1]!;
    expect(first.closedPrototype).toBe(second.closedPrototype);
    const firstRef = refs.get(first.instanceId)!, secondRef = refs.get(second.instanceId)!;
    expect(firstRef).not.toBe(secondRef);
    const kindAt = (ref: number) => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 65535]!;
    const peers = names.map(name => h.join(name, link)); h.run(1300);
    const before = peers.map(s => s.stats.corrections), approach = cruiseApproach(course);
    const navs = peers.map((_, i) => cruiseNavigator(h, reg, CRUISE_COURSE.vessel, refs, i));
    for (const nav of navs) for (let i = 1; i < approach.length - 2; i++) nav.world(approach[i]!, `guest approach[${i}]`, i > 1);
    const firstRoute = CRUISE_LAYOUT.routes.find(r => "requiresOpen" in r && r.requiresOpen === first.instanceId)!;
    navs[0]!.visit(firstRoute.id);
    expect(kindAt(firstRef)).toBe(reg.index.get(first.openPrototype)!);
    expect(kindAt(secondRef)).toBe(reg.index.get(second.closedPrototype)!);
    // Standing in the closed leaf's sweep refuses E close, without affecting the identical neighboring door.
    const firstInstance = CRUISE_LAYOUT.instances.find(i => i.id === first.instanceId)!;
    const closed = CRUISE_LAYOUT.prototypes.find(p => p.id === first.closedPrototype)!, open = CRUISE_LAYOUT.prototypes.find(p => p.id === first.openPrototype)!;
    const closedCenter = closed.boxes[0]!.at.map((v, axis) => v + firstInstance.at[axis]!);
    navs[0]!.local([[closedCenter[0]!, first.hinge[1]!, closedCenter[2]!]], "cabin doorway");
    expect(navs[0]!.use(cruiseWorldPoint(open.boxes[0]!.at.map((v, axis) => v + firstInstance.at[axis]!)))).toBe(RESULT_OBSTRUCTED);
    navs[0]!.local([firstRoute.anchors.at(-1)!], "cabin interior return");
    navs[1]!.reach("pool_under"); h.run(500);
    for (let i = 0; i < peers.length; i++) {
      const s = peers[i]!, seen = new RemoteSample(); s.sampleRemote(seen);
      expect(s.own.mode).toBe(MODE_WALK); expect(s.own.y).toBe(h.world.ents.y[h.ent(s)]!);
      expect(s.stats.corrections - before[i]!).toBe(0);
      const other = 1 - i, remote = seen.id.indexOf(h.ent(peers[other]!)); expect(remote).toBeGreaterThanOrEqual(0);
      expect(seen.y[remote]!).toBeCloseTo(peers[other]!.own.y, 2);
    }
    const saved = peers.map(s => [s.own.x, s.own.y, s.own.z]), count = h.world.structs.count;
    // Rejoin streams the stacked chunk from cold at the saved elevated position.
    h.ends[0]!.close(); h.run(800); const rejoined = h.join(names[0]!, link); h.run(1300);
    expect(Math.hypot(rejoined.own.x - saved[0]![0]!, rejoined.own.y - saved[0]![1]!, rejoined.own.z - saved[0]![2]!)).toBeLessThan(.01);
    expect(rejoined.world!.structs.chunks[Math.floor(firstRef / 65536)]!.kind[firstRef & 65535]).toBe(reg.index.get(first.openPrototype)!);
    h.host.shutdown(); h = new Harness({}, 76, 60, opts, core);
    expect(h.world.structs.count).toBe(count);
    expect(kindAt(firstRef)).toBe(reg.index.get(first.openPrototype)!);
    expect(kindAt(secondRef)).toBe(reg.index.get(second.closedPrototype)!);
    const back = names.map(name => h.join(name, link)); h.run(1300);
    for (let i = 0; i < back.length; i++) {
      const s = back[i]!;
      expect(Math.hypot(s.own.x - saved[i]![0]!, s.own.y - saved[i]![1]!, s.own.z - saved[i]![2]!)).toBeLessThan(.01);
      expect(s.own.mode).toBe(MODE_WALK);
    }
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
