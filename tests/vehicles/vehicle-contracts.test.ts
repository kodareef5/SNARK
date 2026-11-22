import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_DENIED, RESULT_OK } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

test("the engine's bola restriction gates vehicle entry both before and during its door action", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("rooted-driver"); h.run(500);
    const c = h.client(s)!, rec = h.host.records.byPid.get(c.pid)!;
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:compact", spawn.x - 1.6, spawn.z - .12, rec.team);
    const bola = h.reg.index.get("core:entangled")!;
    expect(h.host.entangle.give(rec, bola, 0)).toBe(true);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_DENIED);
    expect(h.host.urban.occupancy.pending(c.pid)).toBeNull();
    h.host.buffs.take(rec, bola);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK);
    expect(h.host.entangle.give(rec, bola, 0)).toBe(true);
    h.run(800);
    expect(c.drive).toBe(-1);
    expect(h.host.urban.occupancy.seatOf(c.pid)).toBeNull();
    h.host.buffs.take(rec, bola);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK);
    h.run(800);
    expect(c.drive).toBe(car);
  } finally { h.host.shutdown(); }
});
