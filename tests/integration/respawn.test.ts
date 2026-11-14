// Where a body is put when it comes into the world: on a bed, around a spawn point, or nowhere.

import { expect, test } from "bun:test";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_RESPAWN, REJECT_FULL, RESULT_INVALID, RESULT_OK, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

test("a bed is risen from on the bed, whoever stands under it, and not at all once it is built over", () => {
  const h = new Harness({}, 1, 30);
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(400);
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const structs = h.world.structs;
  const team = h.host.records.byPid.get(h.client(ada)!.pid)!.team;
  // A floor three metres up with ada's bed on it, and bob on the ground under the bed.
  const g = flatGround(h, 8, 8);
  const [x, z] = [g.x + 4, g.z + 4];
  structs.add(id("ceiling"), x, g.y + 3, z, 0, team, 1000);
  const bed = structs.add(id("bed"), x, g.y + 3.35, z, 0, team, 1000);
  const top = g.y + 3.6;
  const state = h.host.fixtures.ensure(bed);
  h.world.ents.setPosition(h.ent(bob), x, g.y, z);
  /** Asks for the bed, which is made ready first so the test need not wait five minutes. */
  const rise = (): [number, number] => {
    state.readyAt = 0;
    let code = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
    ada.command(CMD_RESPAWN, (w: BitWriter) => w.u8(h.world.spawns.length));
    h.run(300);
    return [code, ada.sessionState];
  };
  h.say(ada, "suicide");
  expect(rise()).toEqual([RESULT_OK, SESSION_ALIVE]);
  expect([Math.hypot(ada.own.x - x, ada.own.z - z) < 0.01, Math.abs(ada.own.y - top) < 0.05]).toEqual([true, true]);

  // A slab over the bed leaves no room to stand on it. The bed is refused, and she is not put somewhere near it.
  const slab = structs.add(id("ceiling"), x, top + 1, z, 0, team, 1000);
  h.say(ada, "suicide");
  expect(rise()).toEqual([RESULT_INVALID, SESSION_DEAD]);
  structs.remove(slab);
  expect(rise()).toEqual([RESULT_OK, SESSION_ALIVE]);
  expect(Math.abs(ada.own.y - top)).toBeLessThan(0.05);
});

test("a body is never put inside what was built over the spawn point", () => {
  // Slabs at chest height over everything within reach of the spawn point leave nowhere to stand.
  const h = new Harness();
  const ceiling = h.reg.index.get("core:ceiling")!;
  const spawn = h.world.spawn;
  for (let dx = -21; dx <= 21; dx += 3) for (let dz = -21; dz <= 21; dz += 3) h.world.structs.add(ceiling, spawn.x + dx, h.world.hf.heightAt(spawn.x + dx, spawn.z + dz) + 1, spawn.z + dz, 0, 0, 1000);
  const late = h.join("late");
  h.run(300);
  expect([late.state, late.closeReason, h.world.ents.count]).toEqual(["closed", REJECT_FULL, 0]);
});
