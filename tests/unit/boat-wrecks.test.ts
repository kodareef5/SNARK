import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { MARINE_FLEET, MARINE_MODELS } from "../../content/vehicles/marine-fleet.ts";
import { formMesh, HARBOUR_WRECK_FORMS, hulkOf } from "../../content/vehicles/harbour-wrecks.ts";
import { fillSlot, slotsOf } from "../../shared/content/slots.ts";
import { isBoatVehicle, type BoatSpec } from "../../shared/sim/vehicle.ts";
import { HARBOURS, mappedBoatSites, type Harbours } from "../../tools/boat/sites.ts";
import { harbourWrecks, type WreckGround } from "../../tools/boat/wrecks.ts";
import { extentOf, meets } from "../../tools/mapworld/ruin-obstacles.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";
import type { PublicPlace } from "../../tools/mapworld/labels.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
// A beach along x: dry above z 50, the bed falling to 0 at z 58 under water standing at 3, and a breakwater in it.
const ground: WreckGround = {
  waterAt: () => 3, groundAt: (_x, z) => Math.max(0, Math.min(4, (58 - z) * .5)),
  inside: (x, z, reach) => Math.min(x, z, 768 - x, 768 - z) > reach, room: () => true,
};
const wall: StaticPiece[] = Array.from({ length: 12 }, (_, i) => ({ kind: "core:wall", x: 300, y: 1.5, z: 70 + i * 3, yaw: 90 }));
const places: PublicPlace[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ name: `Marina ${i}`, kind: "marina", e: 60 + i * 120, n: 80, in_footprint: null })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `Pier ${i}`, kind: "pier", e: 20 + i * 24, n: 62, in_footprint: null })),
];
const sites = mappedBoatSites(places, {}, (e, n) => [e, n]);
const rules: Harbours = { ...HARBOURS, wrecks: { ...HARBOURS.wrecks, marina: [1, 1], pier: [.3, .3] } };
const specOf = (vessel: string): BoatSpec => (reg.vehicle[reg.index.get(vessel)!]!.spec as BoatSpec);

test("a harbour's wrecks lie in its water, afloat and riding low or sunk with their upperworks showing, clear of every piece and of each other", () => {
  const wrecks = harbourWrecks(sites, rules, reg, wall, ground, () => null, () => false);
  expect(wrecks.filter((w) => w.offshore).length).toBeGreaterThan(3);
  expect(wrecks.filter((w) => !w.offshore).length).toBeGreaterThan(3);
  expect(new Set(wrecks.map((w) => w.form))).toEqual(new Set(HARBOUR_WRECK_FORMS));
  for (const w of wrecks) {
    const spec = specOf(w.vessel), depth = ground.waterAt(w.x, w.z) - ground.groundAt(w.x, w.z);
    if (w.form === "damaged") { expect(depth).toBeGreaterThanOrEqual(spec.draft + .2); expect(w.y).toBeCloseTo(3 - spec.draft * 1.25, 6); }
    else { expect(depth).toBeLessThanOrEqual(spec.height * .7); expect(w.y).toBeCloseTo(ground.groundAt(w.x, w.z), 6); }
    // With no form's art, each stands as its vessel's intact hull.
    expect(w.kind).toBe(hulkOf(w.vessel));
    const site = sites.find((s) => s.id === w.site)!, from = Math.hypot(w.x - site.x, w.z - site.z);
    if (w.offshore) { expect(from).toBeGreaterThanOrEqual(HARBOURS.wrecks.out[0] - 1e-6); expect(from).toBeLessThanOrEqual(HARBOURS.wrecks.out[1] + 1e-6); }
    else expect(from).toBeLessThanOrEqual(site.radius + 1e-6);
    const box = (p: StaticPiece) => { const e = extentOf(p.kind); return { x: p.x, y: p.y + e.at[1], z: p.z, yaw: p.yaw, size: e.size }; };
    for (const p of wall) expect(meets(box(w), box(p))).toBe(false);
    for (const o of wrecks) if (o !== w) { expect(meets(box(w), box(o))).toBe(false); expect(Math.hypot(o.x - w.x, o.z - w.z)).toBeGreaterThanOrEqual(HARBOURS.wrecks.apart); }
  }
  // The same map gives the same wrecks, whatever order its places come in; a form whose art is made stands as itself.
  expect(harbourWrecks([...sites].reverse(), rules, reg, wall, ground, () => null, () => false)).toEqual(wrecks);
  const made = harbourWrecks(sites, rules, reg, wall, ground, () => null, (mesh) => mesh.endsWith("_sunk"));
  expect(made.map((w) => w.kind)).toEqual(wrecks.map((w) => w.form === "sunk" ? hulkOf(w.vessel, "sunk") : hulkOf(w.vessel)));
  expect(harbourWrecks(sites, { ...rules, wrecks: { ...rules.wrecks, marina: [0, 0], pier: [0, 0] } }, reg, wall, ground, () => null, () => false)).toEqual([]);
});

test("every vessel has a hulk of its intact hull and its two forms as statics, and a destroyed one becomes its sunk form", () => {
  const defs = new Map(CORE_CONTENT.map((d) => [d.id, d]));
  for (const [i, m] of MARINE_MODELS.entries()) {
    const vehicle = MARINE_FLEET[i]!.vehicle!;
    if (!isBoatVehicle(vehicle)) throw new Error(m.id);
    expect(vehicle.wreck).toBe(formMesh(m.id, "sunk"));
    expect(defs.get(hulkOf(m.id))).toMatchObject({ type: "structure", class: "static", mesh: m.id });
    for (const form of HARBOUR_WRECK_FORMS) {
      expect(defs.get(hulkOf(m.id, form))).toMatchObject({ type: "structure", class: "static", mesh: formMesh(m.id, form) });
      // No definition is named for a form's mesh, so nothing makes a stand-in for it under that name.
      expect(defs.has(formMesh(m.id, form))).toBe(false);
    }
  }
});

artTest("until the pack has a vessel's sunk form, its wreck draws its intact hull", () => {
  const pack = corePack(), has = (asset: string, id: string): boolean => asset === "mesh" && pack.meshIndex.has(id);
  for (const u of slotsOf(MARINE_FLEET).filter((u) => u.slot === "wreck")) {
    expect(u.id).toBe(formMesh(u.owner, "sunk"));
    if (!pack.meshIndex.has(u.id)) expect(fillSlot(u, has)).toEqual({ id: "", word: "none" });
  }
  // And every hulk's own mesh is the intact vessel's.
  for (const m of MARINE_MODELS) expect(pack.meshIndex.has(m.id)).toBe(true);
});
