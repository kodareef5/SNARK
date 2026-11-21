// A marina laid out as a city's build lays one (tools/boat/marinas.ts): a survivor walks from the quay along its walkway
// and out a finger to a found vessel held in its slip, gets aboard it from the dock with the use button through the real
// server, sim and client session, and gets off again onto the dock.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_USE, MODE_SWIM, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { walker } from "../../tools/mapworld/dock-walk.ts";
import { DECK, marinaHarbour } from "../fixtures/marina.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();

test("from the quay along the walkway and out a finger, aboard a found vessel in its slip from the dock, and off it again", () => {
  const { map, layout, found } = marinaHarbour(reg);
  const slip = layout.slips.find((s) => s.found && s.how === "slip" && found.some((v) => v.x === s.x && v.z === s.z))!;
  expect(slip).toBeDefined();
  // On foot from the quay: the walkway's modules from its root, then square out to the slip's place on its finger.
  const run = layout.runs.find((r) => r.id === "1")!, { walk } = walker(map, reg);
  const root = run.points.findIndex((p) => Math.abs(p.x - slip.dock!.x) < 1.6);
  const route = [...run.points.slice(0, root + 1).map((p) => [p.x, p.z, p.y] as const), [slip.dock!.x, run.points[root]!.z, DECK] as const, [slip.dock!.x, slip.dock!.z, DECK] as const];
  const { message, body } = walk(route);
  expect(message).toBe("");
  expect(body.y).toBeCloseTo(DECK, 1);

  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  try {
    const s = h.join("sailor"); h.run(600);
    const c = h.client(s)!, ents = h.world.ents, pilot = h.pilots[0]!;
    const boat = [...h.host.records.byPid.values()].find((r) => r.kind === reg.index.get(slip.vessel)), e = h.host.records.entOf.get(boat!.pid)!;
    h.run(2000);
    // Stood on the finger where the walk ended, looking at the hull beside it.
    ents.setPosition(c.ent, body.x, body.y, body.z); ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0; c.ownDirty = true; h.run(400);
    const eye = ents.y[c.ent]! + stanceEye(h.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
    pilot.yaw = Math.atan2(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
    pilot.pitch = Math.atan2(ents.y[e]! + .4 - eye, Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!));
    h.run(200);
    pilot.buttons |= BTN_USE; h.run(100); pilot.buttons &= ~BTN_USE;
    for (let t = 0; t < 30 && !h.host.urban.occupancy.seatOf(c.pid); t++) h.run(100);
    expect(h.host.urban.occupancy.seatOf(c.pid)?.seat).toBe("pilot");
    h.run(500);
    pilot.buttons |= BTN_USE; h.run(100); pilot.buttons &= ~BTN_USE;
    h.run(2500);
    expect(h.host.urban.occupancy.seatOf(c.pid)).toBeNull();
    // Set down on the dock beside the hull, not in the water.
    expect(ents.mode[c.ent]).not.toBe(MODE_SWIM);
    expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0);
    expect(ents.y[c.ent]!).toBeGreaterThan(DECK - .3);
  } finally { h.host.shutdown(); }
});
