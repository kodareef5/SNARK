// The resource monitor's record of requests (client/core/assets/requests.ts): each request the residency makes, what
// it was for and why, where its bytes came from and when it arrived and was on the card; the last 512 of them.
import { expect, test } from "bun:test";
import type { AssetArrival } from "../../client/core/assets/port.ts";
import { FOR_LEVEL, FOR_PAGE, FOR_SURFACE, FOR_TEXTURE, FROM_DISK, FROM_MEMORY, FROM_NETWORK, IS_ARRIVED, IS_ASKED, IS_DONE, IS_FAILED, LOG_ROWS, RequestLog, WHY_CLIMB, WHY_FIRST, WHY_LEVEL, WHY_PAIR, requestFrom, requestTime } from "../../client/core/assets/requests.ts";
import type { Residency } from "../../client/core/assets/residency.ts";
import { stressSet } from "../../tools/pack/stress.ts";
import { assetWorld } from "../fixtures/assetworld.ts";

const SET = stressSet({ rocks: 8, detail: 4, plate: 64 });
const ROCKS = Array.from({ length: 8 }, (_, i) => ({ mesh: SET.manifest.meshes.findIndex((m) => m.id === `stress:rock_${String(i).padStart(2, "0")}`), z: 10 + 12 * i }));

/** A residency as the record reads it: 10 levels, their surfaces, 4 textures, 2 skeletons' clips and 3 pages. */
function fakeResidency(): Residency {
  const slots = 10 * 2 + 4 + 2 + 3;
  return {
    levels: 10, texBase: 20, clipBase: 24, pageBase: 26,
    generation: new Uint32Array(slots).fill(1), has: Int8Array.from([-1, 2, 3, -1]), meshOf: Uint32Array.from([0, 0, 0, 1, 1, 2, 2, 2, 3, 3]), levelOf: Uint8Array.from([0, 1, 2, 0, 1, 0, 1, 2, 0, 1]),
    tries: new Uint8Array(slots), rehashed: new Uint8Array(slots), state: new Uint8Array(slots), asked: () => 1000,
  } as unknown as Residency;
}

const arrival = (slot: number, more: Partial<AssetArrival> = {}): AssetArrival => ({ slot, generation: 1, data: new Uint8Array(4), fail: 0, fetched: 1000, cached: 0, memory: 0, disk: 0, took: 12.5, ...more });

test("a request is kept from asked to arrived to on the card: what it was for, why, its bytes' source and its times", () => {
  const r = fakeResidency(), log = new RequestLog(29);
  log.asked(r, 3, 13, 0, 100);
  log.asked(r, 21, -1, 3, 110);
  log.asked(r, 23, -1, 0, 120);
  log.asked(r, 27, -1, 0, 130);
  const [pair, climb, first, page] = [log.row(3), log.row(2), log.row(1), log.row(0)];
  expect([log.what[pair], log.why[pair], log.index[pair], log.step[pair]]).toEqual([FOR_LEVEL, WHY_PAIR, 1, 0]);
  expect([log.what[climb], log.why[climb], log.index[climb], log.step[climb]]).toEqual([FOR_TEXTURE, WHY_CLIMB, 1, 3]);
  expect([log.what[first], log.why[first], log.what[page]]).toEqual([FOR_TEXTURE, WHY_FIRST, FOR_PAGE]);
  // The level and its surface came over the network in 12.5 ms of the worker's; the texture from the disk; the page from memory.
  log.came(3, arrival(3), 300, false);
  log.came(21, arrival(21, { fetched: 0, cached: 800, disk: 800 }), 310, false);
  log.came(27, arrival(27, { fetched: 0, cached: 64, memory: 64 }), 320, true);
  log.came(23, arrival(23, { data: null, fail: 1 }), 330, false);
  expect([log.state[pair], log.from[pair], log.workerMs[pair], log.arrivedAt[pair]]).toEqual([IS_ARRIVED, FROM_NETWORK, 12.5, 300]);
  expect([log.from[climb], log.from[page], log.state[page], log.doneAt[page], log.state[first]]).toEqual([FROM_DISK, FROM_MEMORY, IS_DONE, 320, IS_FAILED]);
  expect([requestFrom(log, pair), requestFrom(log, climb), requestFrom(log, page), requestFrom(log, first)]).toEqual(["network, waiting", "disk, waiting", "memory", "failed"]);
  // The level goes up in two pieces, then its surface: it is done when both are on the card.
  log.sent(3, 400, false);
  log.sent(3, 416, true);
  expect([log.state[pair], log.sendingAt[pair]]).toEqual([IS_ARRIVED, 400]);
  log.sent(13, 432, true);
  expect([log.state[pair], log.doneAt[pair], requestFrom(log, pair), requestTime(log, pair, 1000)]).toEqual([IS_DONE, 432, "network → card", "332 ms"]);
  log.sent(21, 450, true);
  expect([log.state[climb], requestTime(log, climb, 1000)]).toEqual([IS_DONE, "340 ms"]);
  // An answer for another generation of the slot, or for a slot never asked, is not this request's.
  log.asked(r, 5, -1, 0, 500);
  log.came(5, arrival(5, { generation: 2 }), 600, false);
  expect([log.state[log.row(0)], requestFrom(log, log.row(0)), requestTime(log, log.row(0), 2500)]).toEqual([IS_ASKED, "downloading", "2.0 s"]);
  log.came(9, arrival(9), 600, false);
  log.sent(15, 600, true);
  expect(log.rows).toBe(5);
});

test("the record keeps the last 512 requests, and a slot's request that has gone is not found", () => {
  const r = fakeResidency(), log = new RequestLog(29);
  for (let i = 0; i < LOG_ROWS + 88; i++) log.asked(r, i === 0 ? 4 : 10 + (i % 10), -1, 0, i);
  expect([log.rows, log.row(0), log.row(LOG_ROWS - 1), log.row(LOG_ROWS)]).toEqual([LOG_ROWS + 88, 87, 88, -1]);
  expect(log.askedAt[log.row(LOG_ROWS - 1)]).toBe(88);
  expect(log.rowFor(4)).toBe(-1);
  expect(log.what[log.rowFor(12)]).toBe(FOR_SURFACE);
  expect(log.why[log.rowFor(12)]).not.toBe(WHY_LEVEL);
});

test("over a network made of numbers the record holds every request the residency made, and its bytes are the residency's", () => {
  const w = assetWorld(SET, ROCKS, { latencyMs: 100, bytesPerSecond: 2e6, keep: true });
  const log = new RequestLog(w.r["state"].length);
  w.r.log = log;
  for (let f = 0; f < 600; f++) w.frame(f < 300 ? 140 - f / 3 : 40);
  expect(log.rows).toBe(w.r.stats.requests);
  expect(log.rows).toBeLessThan(LOG_ROWS);
  let fetched = 0, done = 0;
  for (let back = 0; back < log.rows; back++) {
    const k = log.row(back);
    fetched += log.fetched[k]!;
    if (log.state[k] === IS_DONE) {
      done++;
      expect(log.askedAt[k]! <= log.arrivedAt[k]! && log.arrivedAt[k]! <= log.doneAt[k]!, `request ${back}`).toBe(true);
    }
  }
  expect(fetched).toBe(w.r.stats.fetched);
  expect(done).toBeGreaterThan(log.rows / 2);
});
