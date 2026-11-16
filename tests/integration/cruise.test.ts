import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { capsuleBox, capsuleFree, SETTLE_MARGIN, SKIN, stepOnto } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_STRUCTURE, rayHit } from "../../shared/world/ray.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { CRUISE_COURSE, cruiseApproach, cruiseCourse, cruisePort, cruisePortApproach, cruiseWorldPoint } from "../../tools/cruise/course.ts";
import { assertCruiseMap, assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { cruiseNavigator, cruiseRefs, cruiseWalker } from "../fixtures/cruise.ts";
import { cruiseRoomFloors } from "../fixtures/cruise-floors.ts";
import { Harness } from "../fixtures/net.ts";

const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const core = compiled.registry, course = cruiseCourse(), reg = withContent(core, course.content?.defs ?? []), map = writeMap(course);

test("every advertised occupied room footprint has native floor support beyond its entry and target", () => {
  const h = new Harness({}, 79, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const kinds = new Set(CRUISE_LAYOUT.prototypes.filter(p => p.category === "floor" || p.art.kind === "floor").map(p => reg.index.get(p.id)!));
    const floors = new StructureStore(course.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    for (const t of h.world.structs.chunks) if (t) for (let slot = 0; slot < t.high; slot++) {
      if (kinds.has(t.kind[slot]!)) floors.add(t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 0, 10000);
    }
    const report = cruiseRoomFloors({ hf: h.world.hf, structs: floors }, CRUISE_LAYOUT.rooms, CRUISE_LAYOUT.decks, cruiseWorldPoint);
    expect(report.filter(r => r.missing || !r.samples)).toEqual([]);
    expect(report.length).toBe(CRUISE_LAYOUT.rooms.length);
    // Exact witnesses from the full-deck audit: independently rounded module centres formerly opened 0.4–1 mm seams.
    // These plain native rays retain the same tolerance as gameplay; floor world points must survive placement intact.
    for (const local of [[0, 3, 161.352205882], [-27.35, 56.8, 60.4002118644], [27.25, 14, 116.3943965517]]) {
      const p = cruiseWorldPoint(local);
      expect(castWorld({ hf: h.world.hf, structs: floors }, p[0], p[1] + .04, p[2], 0, -1, 0, .08, true)).toBe(HIT_STRUCTURE);
      expect(rayHit.ny).toBeGreaterThanOrEqual(.99);
    }
  } finally { h.host.shutdown(); }
});

test("every authored cruise route retains its declared width, physical support and headroom with public door leaves open", () => {
  const h = new Harness({}, 72, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel), instances = CRUISE_LAYOUT.instances.filter(i => i.placed);
    const byRef = new Map(Array.from(refs, (ref, row) => [ref, instances[row]?.id ?? `port static ${row}`]));
    // Geometric coverage includes every repeated path. Native E behavior is exercised separately below.
    for (const d of CRUISE_LAYOUT.doors) h.world.structs.swap(refs[instances.findIndex(i => i.id === d.instanceId)]!, reg.index.get(d.openPrototype)!);
    const faults: string[] = []; let samples = 0;
    for (const route of CRUISE_LAYOUT.routes) for (let segment = 1; segment < route.anchors.length; segment++) {
      const a = route.anchors[segment - 1]!, b = route.anchors[segment]!;
      const dx = b[0]! - a[0]!, dz = b[2]! - a[2]!, length = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(length / .25)), edge = route.clearWidth / 2 - .4;
      // Endpoint samples cover both perpendicular bands at authored turns; a public leaf is open in its actual collider state.
      // Keep the full declared corridor width: no special tolerance or reduced body radius at jambs, guards or stair landings.
      for (const offset of length > .000001 ? [0, -edge, edge] : [0]) for (let n = 0; n <= steps; n++) {
        const local = a.map((v, axis) => v + (b[axis]! - v) * n / steps);
        if (length) { local[0]! += dz / length * offset; local[2]! -= dx / length * offset; }
        const p = cruiseWorldPoint(local);
        const supported = stepOnto(h.world, p[0], p[2], p[1] - .15, p[1] + .15, .4, 1.8, .71); samples++;
        // Native stepping deliberately rounds upward in seven halvings. Refine that same supported surface so an exact
        // 2.6 m lintel is not failed by the query's ~2 mm search rounding rather than actual geometry.
        let low = p[1] - .15, y = supported;
        if (Number.isFinite(y)) for (let k = 0; k < 14; k++) {
          const middle = (low + y) * .5;
          if (capsuleFree(h.world, p[0], middle - SETTLE_MARGIN, p[2], .4, 1.8)) y = middle; else low = middle;
        }
        if (!Number.isFinite(y) || !capsuleFree(h.world, p[0], y, p[2], .4, 2.6)) {
          const found = new Found(), feet = Number.isFinite(y) ? y : p[1] + .005, blockers: string[] = [];
          const count = h.world.structs.query(p[0] - .4, p[2] - .4, p[0] + .4, p[2] + .4, found, feet, feet + 2.6);
          for (let i = 0; i < count; i++) {
            const ref = found.refs[i]!;
            if (capsuleBox(h.world.structs, ref, p[0], feet, p[2], .4, 2.6, SKIN)) blockers.push(`${byRef.get(ref)} (${capsuleBox(h.world.structs, ref, p[0], feet, p[2], .4, 1.8, SKIN) ? "body" : "headroom"})`);
          }
          faults.push(`${route.id}[${segment}, lateral ${offset.toFixed(3)}] at ${local}: ${blockers.join(", ") || "unsupported floor"}`); break;
        }
      }
    }
    expect(faults).toEqual([]);
    expect(samples).toBeGreaterThan(CRUISE_LAYOUT.routes.length);
  } finally { h.host.shutdown(); }
});

test("a cruise visitor walks the real shore, quay and gangway in both directions", () => {
  const h = new Harness({}, 73, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const report = assertCruiseMap(course, reg), refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel);
    expect(assertCruisePlaced(course, h.world.structs, reg).length).toBe(report.statics);
    expect(refs.length).toBe(CRUISE_LAYOUT.instances.filter(i => i.placed).length);
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
  const rotated = cruisePort({ statics: cruiseStatics(placement.x, placement.y, placement.z, placement.yaw), landing });
  const h = new Harness({}, 77, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(rotated) }, core);
  try {
    const refs = cruiseRefs(rotated, h.world.structs, reg, placement), s = h.join("rotated cruise guest"); h.run(900);
    const before = s.stats.corrections, nav = cruiseNavigator(h, reg, placement, refs), approach = cruisePortApproach(rotated, landing);
    for (let i = 1; i < approach.length; i++) nav.world(approach[i]!, `rotated approach[${i}]`, i > 1);
    const door = CRUISE_LAYOUT.doors[0]!, route = CRUISE_LAYOUT.routes.find(r => "requiresOpen" in r && r.requiresOpen === door.instanceId)!;
    nav.visit(route.id);
    const target = point(route.anchors.at(-1)!);
    expect(Math.hypot(s.own.x - target[0], s.own.y - target[1], s.own.z - target[2])).toBeLessThan(.15);
    const row = CRUISE_LAYOUT.instances.filter(i => i.placed).findIndex(i => i.id === door.instanceId), ref = refs[row]!;
    expect(h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 65535]).toBe(reg.index.get(door.openPrototype)!);
    nav.reach(CRUISE_LAYOUT.routes.find(r => r.kind === "docking")!.from);
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("the connected cruise walks every authored public deck, room and stair through normal controls", () => {
  // Visiting every route in both directions takes longer than one water ration. Isolate this exhaustive geometry test
  // with ordinary configured hunger/thirst rates only; collision, fall harm and the other user flows stay unmodified.
  const made = loadConfig({ gus: "[ServerSettings]\nPlayerCharacterFoodDrainMultiplier=0\nPlayerCharacterWaterDrainMultiplier=0" });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 74, 60, { dev: true, clips: NO_CLIPS, rigs: [], map, config: made.rules }, core);
  try {
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel);
    const s = h.join("cruise explorer"); h.run(900); const before = s.stats.corrections;
    const nav = cruiseNavigator(h, reg, CRUISE_COURSE.vessel, refs);
    const approach = cruiseApproach(course);
    for (let i = 1; i < approach.length - 2; i++) nav.world(approach[i]!, `public approach[${i}]`, i > 1);
    const visited = nav.tour();
    expect(visited.size).toBe(CRUISE_LAYOUT.routes.length);
    expect(new Set(CRUISE_LAYOUT.graph.nodes.map(n => n.deck)).size).toBe(18);
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
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel), instances = CRUISE_LAYOUT.instances.filter(i => i.placed);
    const first = CRUISE_LAYOUT.doors[0]!, second = CRUISE_LAYOUT.doors[1]!;
    expect(first.closedPrototype).toBe(second.closedPrototype);
    const firstRef = refs[instances.findIndex(i => i.id === first.instanceId)]!, secondRef = refs[instances.findIndex(i => i.id === second.instanceId)]!;
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
    const firstInstance = instances.find(i => i.id === first.instanceId)!;
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
