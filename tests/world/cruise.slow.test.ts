// The cruise ship walked and probed whole: every room's floor, every route's width and headroom, and every deck, room
// and stair visited by normal controls. It grows with the ship's layout, so it runs before a merge (planning/quality/testing.md).
import { expect, test } from "bun:test";
import { loadConfig } from "../../server/settings/config.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_COLLISION_PROTOTYPES, CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { capsuleBox, capsuleFree, SETTLE_MARGIN, SKIN, stepOnto } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_STRUCTURE, rayHit } from "../../shared/world/ray.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { CRUISE_COURSE, cruiseApproach, cruiseCourse, cruiseWorldPoint } from "../../tools/cruise/course.ts";
import { cruiseNavigator, cruiseRefs } from "../fixtures/cruise.ts";
import { cruiseRoomFloors } from "../fixtures/cruise-floors.ts";
import { Harness } from "../fixtures/net.ts";

const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const core = compiled.registry, course = cruiseCourse(), reg = withContent(core, course.content?.defs ?? []), map = writeMap(course);

test("every advertised occupied room footprint has native floor support beyond its entry and target", () => {
  const h = new Harness({}, 79, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, core);
  try {
    const kinds = new Set(CRUISE_COLLISION_PROTOTYPES.filter(p => p.category === "floor" || p.art?.kind === "floor").map(p => reg.index.get(p.id)!));
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
    const refs = cruiseRefs(course, h.world.structs, reg, CRUISE_COURSE.vessel);
    const byRef = new Map(Array.from(refs, ([id, ref]) => [ref, id]));
    // Geometric coverage includes every repeated path. Native E behavior is exercised separately below.
    for (const d of CRUISE_LAYOUT.doors) h.world.structs.swap(refs.get(d.instanceId)!, reg.index.get(d.openPrototype)!);
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
