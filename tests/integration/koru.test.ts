import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { KORU_CONTENT, KORU_LAYOUT, koruPoint, koruStatics } from "../../content/landmarks/koru.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { KORU_COURSE, marinaCourse } from "../../tools/koru/course.ts";
import { Harness } from "../fixtures/net.ts";

const ownIds = new Set(KORU_CONTENT.map(d => d.id));
const compiled = compileContent([...CORE_CONTENT.filter(d => !ownIds.has(d.id)), ...KORU_CONTENT]);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry, vessel = KORU_COURSE.vessel;
const worldPoint = (p: readonly number[]) => koruPoint(vessel.x, vessel.y, vessel.z, vessel.yaw, p);
const map = writeMap(marinaCourse({ statics: koruStatics(vessel.x, vessel.y, vessel.z, vessel.yaw), landing: worldPoint(KORU_LAYOUT.docking.shoreLanding) }));
const route = (id: string) => {
  const found = KORU_LAYOUT.routes.find(r => r.id === id);
  if (!found) throw new Error(`missing authored route ${id}`);
  return found.anchors;
};

/** Feedback drives normal input only: every metre of the arrival and every stair is walked by the native client/server. */
function walker(h: Harness, index = 0) {
  const s = h.sessions[index]!, pilot = h.pilots[index]!;
  const world = (p: readonly number[], label: string, height = true) => {
    const [x, y, z] = p as readonly [number, number, number];
    const distance = Math.hypot(x - s.own.x, z - s.own.z);
    const frames = Math.ceil(distance / 4.5 * 60 * 2) + 150;
    pilot.pitch = 0; pilot.buttons = 0; pilot.moveX = 0;
    for (let i = 0; i < frames; i++) {
      const left = Math.hypot(x - s.own.x, z - s.own.z);
      if (left < .08) break;
      pilot.yaw = Math.atan2(x - s.own.x, z - s.own.z); pilot.moveZ = Math.min(1, left * 2); h.run(1000 / 60);
      if (!capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, 1.8)) throw new Error(`${label}: body entered solid space at ${[s.own.x, s.own.y, s.own.z]}`);
    }
    pilot.moveZ = 0; h.run(100);
    if (Math.hypot(x - s.own.x, z - s.own.z) > .15 || (height && Math.abs(y - s.own.y) > .2)) {
      throw new Error(`${label}: cannot walk to ${p}; stopped at ${[s.own.x, s.own.y, s.own.z]}`);
    }
    expect(s.own.mode).toBe(MODE_WALK);
  };
  const local = (points: readonly (readonly number[])[], label: string) => points.forEach((p, i) => world(worldPoint(p), `${label}[${i}]`));
  return { world, local, route: (id: string, reverse = false) => local(reverse ? [...route(id)].reverse() : route(id), id) };
}

test("Koru uses bounded native static modules at full scale with public paired cabin doors", () => {
  expect(KORU_LAYOUT.dimensions.bowspritTip[2]! - KORU_LAYOUT.dimensions.hullMinZ).toBe(125);
  expect(KORU_LAYOUT.dimensions.beam).toBe(17.2);
  expect(KORU_LAYOUT.decks.map(d => d.floorY)).toEqual([.75, 3.75, 6.75, 9.75]);
  const statics = koruStatics(vessel.x, vessel.y, vessel.z);
  expect(statics.length).toBe(KORU_LAYOUT.modules.length - KORU_LAYOUT.doors.length);
  for (const module of KORU_LAYOUT.modules) {
    expect(module.boxes.length + module.hulls.length).toBeLessThanOrEqual(16);
    const kind = reg.index.get(module.id)!;
    expect(reg.role[kind]).toBe(-1);
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(module.visualBounds.min[axis]!)).toBeLessThanOrEqual(16);
      expect(Math.abs(module.visualBounds.max[axis]!)).toBeLessThanOrEqual(16);
    }
  }
});

test("a survivor walks from the marina through the gangway and all four interior decks without teleporting", () => {
  const h = new Harness({}, 31, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, reg);
  try {
    const s = h.join("visitor"); h.run(700); const walk = walker(h), before = s.stats.corrections;
    walk.world([1086, 3.75, 1000], "promenade", false);
    walk.world(worldPoint(KORU_LAYOUT.docking.shoreApproach), "pier");
    walk.route("shore_to_arrival");
    walk.local(route("main_spine").slice(2, 7), "main spine to grand stairs");
    walk.local(route("connector_grand_1").slice(0, 3), "main grand approach");
    walk.route("stair_grand_1");
    walk.local([route("stair_grand_2")[0]!], "upper grand approach"); walk.route("stair_grand_2");
    expect(s.own.y).toBeCloseTo(9.75, 1);
    walk.route("stair_grand_2", true);
    walk.local([route("stair_grand_1").at(-1)!], "upper descent approach"); walk.route("stair_grand_1", true);
    walk.local([route("stair_grand_0").at(-1)!], "main descent approach"); walk.route("stair_grand_0", true);
    expect(s.own.y).toBeCloseTo(.75, 1);
    walk.route("stair_grand_0");
    walk.local([...route("connector_grand_1")].reverse(), "main return connector");
    walk.local([...route("main_spine").slice(2, 7)].reverse(), "main return spine");
    walk.route("shore_to_arrival", true);
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
}, 15000);
