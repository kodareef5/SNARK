// Seats are live and not saved, so whoever sat in a car when the server stopped, or when a dropped connection took
// their body out of the world, must come back standing beside the car and never inside its hull.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";
import { flatGround } from "../fixtures/arena.ts";

function setup(dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath });
  const ada = h.join("ada");
  h.run(400);
  const ground = flatGround(h, 24, 28), x = ground.x + 10, z = ground.z + 8;
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${x + 1.6} ${z + 0.12}`);
  h.run(500);
  const me = h.client(ada)!;
  const car = h.host.spawnVehicle("core:compact", x, z, h.host.records.byPid.get(me.pid)!.team, 0);
  return { h, ada, me, car, x, z };
}

/** Whether a point at height y lies within a car's hull, grown by a body's radius. */
function within(h: Harness, car: number, px: number, py: number, pz: number, radius: number): boolean {
  const ents = h.world.ents, spec = h.reg.vehicle[ents.kind[car]!]!.spec;
  const a = ents.vehicleYaw[car]!, dx = px - ents.x[car]!, dz = pz - ents.z[car]!;
  const x = Math.abs(Math.cos(a) * dx - Math.sin(a) * dz), z = Math.abs(Math.sin(a) * dx + Math.cos(a) * dz);
  return py < ents.y[car]! + spec.height && x < spec.halfWidth + radius && z < spec.halfLength + radius;
}

test("a survivor seated when the server stops comes back standing beside the car, not inside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-vehicle-seated-")), dbPath = join(dir, "world.db");
  let active: Harness | null = null;
  try {
    const { h, me, car } = setup(dbPath);
    active = h;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(car);
    const carPid = h.world.ents.pid[car]!, pid = me.pid;
    h.host.shutdown();
    active = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath });
    active = restored;
    restored.join("ada");
    restored.run(800);
    const c = restored.client(restored.sessions[0]!)!, e = restored.host.records.entOf.get(carPid)!, ents = restored.world.ents;
    expect(c.pid).toBe(pid);
    expect(c.ent).toBeGreaterThanOrEqual(0);
    expect(restored.host.urban.occupancy.seatOf(pid)).toBeNull();
    expect(within(restored, e, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, restored.reg.move[ents.kind[c.ent]!]!.radius)).toBe(false);
  } finally {
    active?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a survivor saved inside a car's hull, as a server that stopped without standing it down saves one, comes back beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-vehicle-inside-")), dbPath = join(dir, "world.db");
  let active: Harness | null = null;
  try {
    const { h, me, car } = setup(dbPath);
    active = h;
    const ents = h.world.ents, carPid = ents.pid[car]!;
    ents.setPosition(me.ent, ents.x[car]! + 0.4, ents.y[car]!, ents.z[car]! + 0.2);
    h.host.shutdown();
    active = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath });
    active = restored;
    restored.join("ada");
    restored.run(800);
    const c = restored.client(restored.sessions[0]!)!, e = restored.host.records.entOf.get(carPid)!, now = restored.world.ents;
    expect(c.ent).toBeGreaterThanOrEqual(0);
    expect(within(restored, e, now.x[c.ent]!, now.y[c.ent]!, now.z[c.ent]!, restored.reg.move[now.kind[c.ent]!]!.radius)).toBe(false);
  } finally {
    active?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a survivor whose connection drops in a seat is set down beside the car when its body leaves the world", () => {
  const { h, me, car } = setup();
  try {
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(car);
    const pid = me.pid, rec = h.host.records.byPid.get(pid)!, move = h.reg.move[rec.kind]!, ents = h.world.ents;
    // Walls along both sides leave room to open the doors and none to stand outside them, so the lingering body
    // cannot get out before it goes.
    const wall = h.reg.index.get("core:wall_stone")!;
    for (const side of [-1.85, 1.85]) for (const along of [-1.5, 1.5]) {
      expect(h.world.structs.add(wall, ents.x[car]! + side, ents.y[car]! + h.world.structs.halfYOf(wall), ents.z[car]! + along, 16384, 0, 10000)).toBeGreaterThanOrEqual(0);
    }
    h.ends[0]!.close();
    h.run(8000);
    expect(h.host.records.entOf.get(pid)).toBeUndefined();
    expect(h.host.urban.occupancy.seatOf(pid)).toBeNull();
    expect(within(h, car, rec.x, rec.y, rec.z, move.radius)).toBe(false);
  } finally {
    h.host.shutdown();
  }
});

test("a driver knocked out falls from the seat beside the car, and a tangled one can be pulled out", () => {
  const { h, ada, me, car, x, z } = setup();
  try {
    const bob = h.join("bob");
    h.run(800);
    h.say(bob, "enablecheats");
    h.say(bob, `tp ${x + 2.2} ${z - 1.2}`);
    h.run(500);
    const thief = h.client(bob)!, rec = h.host.records.byPid.get(me.pid)!, ents = h.world.ents, move = h.reg.move[rec.kind]!;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(car);
    // Tangled, the driver cannot drive, and is no shield for the car.
    const bola = h.reg.index.get("core:entangled")!;
    expect(h.host.entangle.give(rec, bola, thief.pid)).toBe(true);
    h.run(100);
    expect(h.host.urban.mount(thief, car)).toBe(RESULT_OK);
    h.run(1000);
    expect(thief.drive).toBe(car);
    expect(h.host.urban.occupancy.seatOf(me.pid)).toBeNull();
    // The thief, knocked out at the wheel, falls out beside the car as a rider falls from a mount.
    const thiefRec = h.host.records.byPid.get(thief.pid)!;
    thiefRec.out = true;
    h.run(300);
    expect(h.host.urban.occupancy.seatOf(thief.pid)).toBeNull();
    expect(thief.drive).toBe(-1);
    expect(within(h, car, ents.x[thief.ent]!, ents.y[thief.ent]!, ents.z[thief.ent]!, move.radius)).toBe(false);
    void ada;
  } finally {
    h.host.shutdown();
  }
});
