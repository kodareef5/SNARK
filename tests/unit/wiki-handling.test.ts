// How each vehicle drives, as the wiki measures it from the vehicle's own step (tools/wiki/handling.ts) and says it.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, SpeciesDef } from "../../shared/content/defs.ts";
import type { VehicleDefinition, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { buildCatalogue, type Cell, type Entry } from "../../tools/wiki/catalogue.ts";
import { fleetTables } from "../../tools/wiki/driving.ts";
import { KMH, handlingOf, roadHandling, type Handling } from "../../tools/wiki/handling.ts";

const vehicles = CORE_CONTENT.filter((d): d is SpeciesDef & { vehicle: VehicleDefinition } => d.type === "species" && d.class === "vehicle" && d.vehicle !== undefined);
const entries = buildCatalogue();
const text = (c: Cell | Cell[]): string => (Array.isArray(c) ? c.map(text).join("") : typeof c === "string" ? c : "rate" in c ? c.text : c.id);

/** Each measured figure, by name, for the ones a definition of this movement is held to. */
function sensible(def: VehicleDefinition, h: Handling): void {
  for (const [k, v] of Object.entries(h)) if (typeof v === "number") expect([def.id, k, Number.isFinite(v) && v >= 0]).toEqual([def.id, k, true]);
  const s = def.spec, length = s.halfLength * 2, within = (n: number, lo: number, hi: number, what: string) => expect([def.id, what, n > lo && n < hi]).toEqual([def.id, what, true]);
  if (h.movement === "wheeled") {
    within(h.top, 5, s.maxForward + 0.01, "top speed under its limiter");
    within(h.reverse, 0.5, s.maxReverse + 0.01, "reverse under its limiter");
    within(h.to100, 0, 120, "to 100");
    within(h.braking, 1, 400, "braking");
    within(h.turning, length, 60, "turning circle");
    within(h.circle, 2, h.top, "round the circle");
    within(h.topGear, 0, h.gears + 1, "gear at the top");
    within(h.range60 ?? 0, 1000, 1e8, "range at 60");
    within(h.rangeTop, 1000, 1e8, "range flat out");
    within(h.power / h.mass, 10, 2000, "watts a kilogram");
  } else if (h.movement === "boat") {
    within(h.top, 1, 70, "top speed");
    within(h.toHalf, 0, h.toTop, "to half before to the top");
    within(h.turnFast, length, 5000, "turning circle");
    within(h.turnAbout, s.halfWidth * 2, 5000, "turning about");
    within(h.runOn, 0, 5000, "run on");
    within(h.draught, 0, s.height, "draught");
    within(h.draughtTop, -s.height, s.height, "draught at speed");
    within(h.cruise, 0, h.top + 1e-9, "cruise");
    expect(h.rangeCruise).toBeGreaterThanOrEqual(h.rangeTop);
  } else {
    within(h.top, 5, h.cruise, "level top under its fast flight");
    within(h.cruise, 5, 100, "fast flight");
    within(h.climb, 0.5, 30, "climb");
    within(h.stop, 0, 120, "stopping");
    for (const n of [h.hover, h.enduranceTop, h.enduranceCruise]) within(n, 60, 1e6, "endurance");
  }
}

test("every vehicle is measured by its own model, each figure finite and of its kind's sensible size", () => {
  expect(vehicles.length).toBeGreaterThan(10);
  for (const d of vehicles) sensible(d.vehicle, handlingOf(d.vehicle, 80));
});

test("every vehicle's page says how it drives and its top speed as measured, with no figure missing", () => {
  const listed = entries.filter((e) => e.kind === "vehicles");
  expect(listed.length).toBeGreaterThan(10);
  for (const e of listed) {
    const table = e.tables.find((t) => ["How it drives", "How it handles", "How it flies"].includes(t.title))!;
    expect([e.id, table.rows.length]).toEqual([e.id, e.handling!.movement === "wheeled" ? 11 : e.handling!.movement === "boat" ? 10 : 7]);
    for (const [what, value] of table.rows) {
      // Only what drives it is said in words.
      const words = ["Driven wheels", "Drive"].includes(text(what!));
      expect([e.id, text(what!), words ? text(value!).length > 2 : /\d/.test(text(value!))]).toEqual([e.id, text(what!), true]);
      expect(text(value!)).not.toMatch(/NaN|Infinity|undefined|null/);
    }
    expect(text(e.facts.find((f) => f.label === "Top speed")!.value)).toStartWith(`${Math.round(e.handling!.top / KMH)} km/h`);
  }
});

test("a figure follows the definition it is measured from, so a retuned vehicle's page changes with it", () => {
  const compact = vehicles.find((d) => d.id === "core:compact")!, spec = (compact.vehicle as WheelVehicleDefinition).spec;
  const tuned = (change: Partial<WheelVehicleDefinition["spec"]>): Def => ({ ...compact, vehicle: { ...compact.vehicle, spec: { ...spec, ...change } } as WheelVehicleDefinition });
  const with_ = (def: Def): Entry => buildCatalogue({ defs: CORE_CONTENT.map((d) => (d.id === compact.id ? def : d)) }).find((e) => e.id === compact.id)!;
  const base = entries.find((e) => e.id === compact.id)!.handling!;
  const slow = with_(tuned({ maxForward: 20 }));
  if (slow.handling?.movement !== "wheeled" || base.movement !== "wheeled") throw new Error("not measured as a road vehicle");
  // Its limiter holds it at 20 m/s, which no longer reaches 100 km/h.
  expect(slow.handling.top).toBeCloseTo(20, 2);
  expect(slow.handling.reaches100).toBe(false);
  expect(slow.facts.find((f) => f.label === "Top speed")!.value).toEqual(["72 km/h"]);
  const big = with_(tuned({ fuelCapacity: spec.fuelCapacity * 2 })).handling!;
  if (big.movement !== "wheeled") throw new Error("not measured as a road vehicle");
  expect(big.range60! / base.range60!).toBeCloseTo(2, 6);
  expect(big.rangeTop / base.rangeTop).toBeCloseTo(2, 6);
  const soft = with_(tuned({ brake: spec.brake / 2 })).handling!;
  if (soft.movement !== "wheeled") throw new Error("not measured as a road vehicle");
  expect(soft.braking).toBeGreaterThan(base.braking * 1.2);
});

test("the controls are a player's: reverse runs to its limiter, the helicopter climbs at its assisted rate, and a measure is the same twice", () => {
  for (const d of vehicles) {
    const h = handlingOf(d.vehicle, 80);
    if (h.movement === "wheeled") expect([d.id, Math.abs(h.reverse - d.vehicle.spec.maxReverse) < 0.01]).toEqual([d.id, true]);
    if (h.movement === "rotor" && d.vehicle.movement === "rotor") expect(h.climb).toBeCloseTo(d.vehicle.spec.climbSpeed, 1);
  }
  const compact = vehicles.find((d) => d.id === "core:compact")!.vehicle as WheelVehicleDefinition;
  expect(roadHandling(compact, 80)).toEqual(roadHandling(compact, 80));
});

test("the vehicles' page sets each kind side by side, fastest first, one row for vehicles that drive alike", () => {
  const tables = fleetTables(entries);
  expect(tables.map((t) => t.title)).toEqual(["On the road", "On the water", "In the air"]);
  const movement = { "On the road": "wheeled", "On the water": "boat", "In the air": "rotor" } as const;
  for (const t of tables) {
    const kind = entries.filter((e) => e.handling?.movement === movement[t.title as keyof typeof movement]);
    const named = t.rows.flatMap((r) => (r[0] as Cell[]).filter((c): c is { id: string } => typeof c === "object" && "id" in c).map((c) => c.id));
    expect(named.sort()).toEqual(kind.map((e) => e.id).sort());
    const tops = t.rows.map((r) => kind.find((e) => e.id === ((r[0] as Cell[])[0] as { id: string }).id)!.handling!.top);
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
    for (const r of t.rows) {
      expect(r.length).toBe(t.head.length);
      for (const c of r.slice(1)) expect(text(c)).not.toMatch(/NaN|Infinity|undefined|null/);
    }
  }
  // A livery is its aircraft: the three helicopters share one row.
  expect(tables[2]!.rows.length).toBe(1);
});
