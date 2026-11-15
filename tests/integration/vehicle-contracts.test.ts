import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { REJECT_VERSION, RESULT_DENIED, RESULT_OK, writeHello } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { Harness, testKey } from "../fixtures/net.ts";

test("the combined vehicle/weapon layout refuses both previously deployed protocol versions", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const reasons: number[] = [];
    for (const version of [13, 15]) {
      const end = h.net.connect();
      end.onMessage = (_ch, data) => reasons.push(data[1]!);
      const w = new BitWriter(128);
      writeHello(w, version, h.reg.hash, h.world.anim.set.hash, "old-layout", 0, testKey("old-layout"));
      end.send(CH_RELIABLE, w.bytes()); h.run(100);
      expect(end.open).toBe(false);
    }
    expect(reasons).toEqual([REJECT_VERSION, REJECT_VERSION]);
    expect(h.server.playerCount).toBe(0);
  } finally { h.host.shutdown(); }
});

test("the engine's bola restriction gates vehicle entry both before and during its door action", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("rooted-driver"); h.run(500);
    const c = h.client(s)!, rec = h.host.records.byPid.get(c.pid)!;
    const spawn = h.world.spawn, car = h.host.spawnVehicle("urban:compact", spawn.x - 1.6, spawn.z - .12, rec.team);
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
