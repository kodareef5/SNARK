import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { auditCruiseFit, cruiseFitSpots } from "../../tools/art/cruise-fit.ts";

test("the Pearl room alias inherits its actual walking approach direction", () => {
  const pearl = CRUISE_LAYOUT.routes.find(r => r.id === "pearl_access")!;
  expect(pearl.anchors[0]).toEqual(pearl.anchors[1]);
  const spots = cruiseFitSpots(), entry = spots.find(s => s.id === "pearl jamb")!, exit = spots.find(s => s.id === "pearl exit")!;
  expect(entry.feet).toEqual(CRUISE_LAYOUT.rooms.find(r => r.id === "pearl")!.entry);
  expect(entry.yaw).toBe(0); // The real arrival and Pearl stair both run forward along +Z.
  expect(exit.yaw).toBe(Math.PI);
});

artTest("actual dressed survivor vertices clear cruise cabin jambs, stair turns and the room below the basin", () => {
  const ids = new Set(["cabin_9_0 jamb", "stair_fore_9[3]", "stair_fore_9[4]", "stair_fore_9[8]", "pool_under jamb"]);
  const all = cruiseFitSpots(), spots = all.filter(s => ids.has(s.id));
  for (const stair of CRUISE_LAYOUT.stairs) {
    const route = CRUISE_LAYOUT.routes.find(r => r.id === stair.route)!;
    expect(all.some(s => s.id === `${stair.id}[${route.anchors.length - 1}]`)).toBe(true);
  }
  for (const room of CRUISE_LAYOUT.rooms) expect(all.some(s => s.id === `${room.id} jamb`)).toBe(true);
  expect(spots.length).toBe(ids.size);
  const report = auditCruiseFit(spots);
  expect(report.points).toBeGreaterThan(200000);
  expect(new Set(report.cases.map(c => c.pose.sex))).toEqual(new Set(["m", "f"]));
  expect(report.collisions).toEqual([]);
});
