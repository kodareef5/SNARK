// The hangar keeps one jet to a world (server/car-return.ts): one parked on a fresh world, none while one lives anywhere,
// another some real hours after the last is destroyed, none onto a body standing there, one owed to a save from before
// the hangar, and a jet an admin spawned counts for nothing.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { jetNozzleAt } from "../../shared/sim/jet.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { rules } from "../kit/kit.ts";

const SITE = { name: "Test Annex", x: 300, z: 300, yaw: Math.PI / 2 };
/** A tenth of an hour: six minutes. */
const HOURS = .1;
const map = writeMap(flatMap(8));

function world(o: { site?: typeof SITE | null; dbPath?: string; hours?: number } = {}): Harness {
  return new Harness({}, 3, 60, { dev: true, clips: NO_CLIPS, rigs: [], map, hangar: o.site === undefined ? SITE : o.site,
    ...(o.dbPath ? { dbPath: o.dbPath } : {}), config: rules({ JetReturnHours: o.hours ?? HOURS }) });
}

/** The live jets in the world, and which of them came from the hangar. */
function jets(h: Harness): { e: number; pid: number; hangar: boolean }[] {
  const kind = h.reg.index.get("core:jet")!, text = new TextDecoder(), out: { e: number; pid: number; hangar: boolean }[] = [];
  for (const rec of h.host.records.byPid.values()) {
    const e = h.host.records.entOf.get(rec.pid);
    if (rec.kind !== kind || rec.dead || e === undefined) continue;
    const origin = rec.extra.get(VEHICLE_ORIGIN);
    out.push({ e, pid: rec.pid, hangar: !!origin && text.decode(origin) === `${h.world.mapId}/hangar` });
  }
  return out;
}

/** Runs the world's own time: its checks come every ten minutes, so this is in minutes. */
const minutes = (h: Harness, n: number): void => { for (let k = 0; k < n; k++) h.run(60_000); };
const destroy = (h: Harness, pid: number): void => { h.host.survival.hurt(h.host.records.byPid.get(pid)!, 1e7, 0); h.run(500); };

test("a fresh world parks one jet at its hangar, on its wheels with its nozzle down", () => {
  const h = world();
  try {
    const found = jets(h);
    expect(found.length).toBe(1);
    const { e, hangar } = found[0]!, ents = h.world.ents, v = ents.vrow[e]!;
    expect(hangar).toBe(true);
    expect([ents.x[e], ents.z[e]]).toEqual([SITE.x, SITE.z]);
    expect(ents.vehicleYaw[v]).toBeCloseTo(SITE.yaw, 3);
    expect([(ents.flags[e]! & F_GROUNDED) !== 0, ents.vehicleGear[v], jetNozzleAt(ents, v)]).toEqual([true, 1, 1]);
    expect(h.host.records.byPid.get(found[0]!.pid)!.team).toBe(0);
  } finally { h.host.shutdown(); }
});

test("while the hangar's jet lives anywhere none comes; after the hours another does, and not onto a body", () => {
  const h = world();
  try {
    const s = h.join("ada"); h.run(1000);
    const first = jets(h)[0]!, ents = h.world.ents;
    // Flown far off and left there: it still counts.
    ents.setPosition(first.e, 100, ents.y[first.e]!, 100); h.world.history.discontinuity(first.e);
    minutes(h, 20);
    expect(jets(h).map((j) => j.pid)).toEqual([first.pid]);
    // An admin's jet counts for nothing; the hangar's destroyed, and someone stands on its pad.
    expect(h.host.spawnVehicle("core:jet", 150, 420, 0, 0)).toBeGreaterThanOrEqual(0);
    destroy(h, first.pid);
    expect(jets(h).filter((j) => j.hangar)).toEqual([]);
    ents.setPosition(h.client(s)!.ent, SITE.x, 0, SITE.z);
    minutes(h, HOURS * 60 + 15);
    expect(jets(h).filter((j) => j.hangar)).toEqual([]);
    // It comes once the pad is clear, watched or not: the survivor is a few metres off.
    ents.setPosition(h.client(s)!.ent, SITE.x + 20, 0, SITE.z);
    minutes(h, 11);
    const back = jets(h).filter((j) => j.hangar);
    expect(back.length).toBe(1);
    expect([ents.x[back[0]!.e], ents.z[back[0]!.e]]).toEqual([SITE.x, SITE.z]);
    expect(jets(h).length).toBe(2);
  } finally { h.host.shutdown(); }
});

test("a save made before the hangar was is owed its jet at the first check", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-hangar-")), dbPath = join(dir, "world.db");
  let h = world({ site: null, dbPath });
  try {
    h.run(1000);
    expect(jets(h)).toEqual([]);
    h.host.shutdown();
    h = world({ dbPath });
    expect(jets(h)).toEqual([]);
    minutes(h, 11);
    expect(jets(h).filter((j) => j.hangar).length).toBe(1);
    // And not a second after the next.
    minutes(h, 11);
    expect(jets(h).length).toBe(1);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("JetReturnHours of 0 brings none back", () => {
  const h = world({ hours: 0 });
  try {
    destroy(h, jets(h)[0]!.pid);
    h.run(TICK_RATE);
    minutes(h, 30);
    expect(jets(h)).toEqual([]);
  } finally { h.host.shutdown(); }
});
