// What a street being salvaged costs on the wire and in the tick, printed: twenty survivors on twenty wrecks.

import { expect, test } from "bun:test";
import type { Source } from "../../server/combat.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { city } from "../fixtures/city.ts";
import { record, survivor } from "../kit/kit.ts";

test("twenty survivors salvaging a wreck each send a watcher little and cost the tick little", () => {
  const cars = Array.from({ length: 20 }, (_, k) => ({ kind: "core:compact_abandoned_white", x: 100 + (k % 5) * 8, z: 100 + Math.floor(k / 5) * 8 }));
  const c = city(cars);
  const { h } = c;
  const ada = h.join("ada");
  const structs = h.world.structs;
  for (let n = 0; n < 100 && !structs.held.every((k) => h.client(ada)?.known[k] === structs.chunks[k]!.version); n++) h.run(100);
  h.run(300);
  const end = h.ends[0]!;
  const on = end.onMessage!;
  const sizes: number[] = [];
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) sizes.push(d.length);
    on(ch, d);
  };
  // Bare hands strike 1 of a rung's 40, so a wreck lasts 120 blows: one a tick here, far faster than an arm swings.
  const hands = cars.map((_, k): Source => ({ by: record(h, survivor(h, `s${k}`)), x: 0, z: 0, item: 0, base: 8, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 }));
  expect(h.host.rules.assign("CityBreaksPerMinute", "600", "console")).toBe("");
  const places = c.refs.map((ref) => c.at(ref));
  const TICKS = 120;
  const quiet = performance.now();
  for (let t = 0; t < TICKS; t++) h.run(1000 / TICK_RATE);
  const idle = (performance.now() - quiet) / TICKS;
  sizes.length = 0;
  const was = { silent: h.host.combat.city.silent, breaks: h.host.combat.city.breaks };
  let blows = 0, inBlows = 0;
  const began = performance.now();
  for (let t = 0; t < TICKS; t++) {
    const at = performance.now();
    for (let k = 0; k < c.refs.length; k++) if (h.host.combat.hitStructure(hands[k]!, c.refs[k]!, places[k]!.x, 0.5, places[k]!.z) > 0) blows++;
    inBlows += performance.now() - at;
    h.run(1000 / TICK_RATE);
  }
  const busy = (performance.now() - began) / TICKS;
  h.run(300);
  const bytes = sizes.reduce((a, b) => a + b, 0);
  const city_ = h.host.combat.city;
  const [silent, breaks] = [city_.silent - was.silent, city_.breaks - was.breaks];
  console.log(`wreck siege: ${blows} blows in ${TICKS} ticks (${(blows / TICKS).toFixed(1)} a tick), ${silent} told to nobody, ${breaks} rungs; ${sizes.length} messages, ${bytes} bytes, ${(bytes / (TICKS / TICK_RATE)).toFixed(0)} bytes a second to a watcher; the blows ${(inBlows / TICKS).toFixed(3)} ms a tick, a tick ${busy.toFixed(3)} ms against ${idle.toFixed(3)} ms idle`);
  // Each wreck is stripped at 40 blows, gutted at 80 and taken at 120: a swap for each look it has, a removal, and
  // every other blow silent.
  expect([blows, silent + breaks, breaks >= 40 && breaks <= 60, c.refs.every((ref) => c.id(ref) === "")]).toEqual([2400, 2400, true, true]);
  expect(bytes / (TICKS / TICK_RATE)).toBeLessThan(400);
  expect(inBlows / TICKS).toBeLessThan(1);
});
