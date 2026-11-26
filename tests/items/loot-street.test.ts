// Street things that hold loot (planning/workstreams/loot.md): searched by a hold of the use key, opened as a box that
// only gives, refilled a time after, spilled when broken.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_STRUCT, RESULT_DENIED, RESULT_OK, RESULT_SEARCHED, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { NO_PIN, STRUCT_SEARCH, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { city } from "../fixtures/city.ts";
import type { Harness } from "../fixtures/net.ts";

const snark = (lines: string) => loadConfig({ gus: `[SnarkSettings]\n${lines}`, game: "" }).rules;
/** Every street thing holds something, so a test need not pick its seeds. */
const SURE = "WorldLootChanceMultiplier=4";

/** A bin, a mailbox and a hydrant on a flat map, and Ada beside the bin with cheats on. */
function street(lines = SURE) {
  const c = city([{ kind: "core:zzstreet_bin", x: 120, z: 120 }, { kind: "core:zzstreet_mailbox", x: 140, z: 120 }, { kind: "core:zzstreet_hydrant", x: 160, z: 120 }], 4, { config: snark(lines) });
  const h = c.h;
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  const [bin, mailbox, hydrant] = c.refs as [number, number, number];
  return { h, ada, me, bin, mailbox, hydrant };
}

/** Sends a structure action from where the survivor stands. Returns the code. */
function send(h: Harness, s: ClientSession, ref: number, action: number, ms = 150): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), action === STRUCT_USE && w.u16(NO_PIN)));
  h.run(ms);
  return code;
}

function beside(h: Harness, s: ClientSession, ref: number): void {
  const t = h.world.structs.chunks[Math.floor(ref / 65536)]!;
  h.say(s, `tp ${(t.x[ref & 0xffff]! + 1.5).toFixed(3)} ${t.z[ref & 0xffff]!.toFixed(3)}`, 300);
}

/** Searches the thing at `ref` for its seconds and opens it. Returns the code of the opening. */
function search(h: Harness, s: ClientSession, ref: number, seconds: number): number {
  beside(h, s, ref);
  expect(send(h, s, ref, STRUCT_SEARCH)).toBe(RESULT_OK);
  h.run(seconds * 1000);
  return send(h, s, ref, STRUCT_USE);
}

test("a bin is searched by a hold of its seconds, opens as a box that only gives, and says so once it is emptied", () => {
  const { h, ada, me, bin, hydrant } = street();
  beside(h, ada, bin);
  // Not before the search began, and not before its seconds are out.
  expect(send(h, ada, bin, STRUCT_USE)).toBe(RESULT_WAIT);
  expect(send(h, ada, bin, STRUCT_SEARCH)).toBe(RESULT_OK);
  expect(send(h, ada, bin, STRUCT_USE)).toBe(RESULT_WAIT);
  h.run(1500);
  expect(send(h, ada, bin, STRUCT_USE)).toBe(RESULT_OK);
  expect(ada.open?.inventory.item.some((i) => i !== 0)).toBe(true);
  expect(ada.open!.takeOnly).toBe(true);
  const box = h.host.fixtures.find(bin)!;
  const inv = h.host.items.inv(box);
  const before = inv.used();
  // Nothing goes in.
  h.say(ada, "give core:stone 5");
  const mine = h.host.items.inv(me).item.indexOf(h.reg.index.get("core:stone")!);
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(mine), w.bits(BOX_OPEN, 1), w.varint(5), w.u16(5), w.u16(h.reg.index.get("core:stone")!)));
  h.run(300);
  expect(inv.used()).toBe(before);
  // She takes everything, and shuts it.
  for (let s = 0; s < inv.cap; s++) {
    if (inv.item[s] === 0) continue;
    const item = inv.item[s]!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(s), w.bits(BOX_SELF, 1), w.varint(20 + s), w.u16(inv.count[s]!), w.u16(item)));
  }
  h.run(300);
  expect(send(h, ada, bin, STRUCT_USE)).toBe(RESULT_OK);
  expect(ada.open).toBe(null);
  // Emptied, it keeps no record, and a second search is told at once that it was searched.
  expect([h.host.fixtures.find(bin), h.host.holders.count]).toEqual([null, 1]);
  expect(send(h, ada, bin, STRUCT_SEARCH)).toBe(RESULT_SEARCHED);
  // A hydrant holds nothing.
  beside(h, ada, hydrant);
  expect(send(h, ada, hydrant, STRUCT_SEARCH)).toBe(RESULT_DENIED);
  expect(h.host.items.audit()).toEqual([]);
});

test("a searched thing holds loot again when its time is out, but not while a survivor stands by it", () => {
  const { h, ada, bin } = street(`${SURE}\nWorldLootRefillPeriodMultiplier=0.001`);
  expect(search(h, ada, bin, 1.5)).toBe(RESULT_OK);
  expect(send(h, ada, bin, STRUCT_USE)).toBe(RESULT_OK);
  expect(h.host.holders.count).toBe(1);
  // A bin's 20 to 30 hours at a thousandth are 84 to 126 ticks: out long since, and held back while she is there.
  h.run(8000);
  expect([h.host.holders.count, h.host.holders.refilled]).toEqual([1, 0]);
  h.say(ada, "tp 30 30", 300);
  h.run(700 * 1000);
  expect([h.host.holders.count, h.host.holders.refilled, h.host.fixtures.find(bin)]).toEqual([0, 1, null]);
  expect(search(h, ada, bin, 1.5)).toBe(RESULT_OK);
  expect(ada.open?.inventory.item.some((i) => i !== 0)).toBe(true);
  expect(h.host.items.audit()).toEqual([]);
});

test("a mailbox takes longer to search than a bin, and what a broken one still held lies where it stood", () => {
  const { h, ada, me, mailbox } = street();
  beside(h, ada, mailbox);
  expect(send(h, ada, mailbox, STRUCT_SEARCH)).toBe(RESULT_OK);
  h.run(1500);
  expect(send(h, ada, mailbox, STRUCT_USE)).toBe(RESULT_WAIT);
  h.run(1000);
  expect(send(h, ada, mailbox, STRUCT_USE)).toBe(RESULT_OK);
  const held = h.host.items.inv(h.host.fixtures.find(mailbox)!).used();
  expect(held).toBeGreaterThan(0);
  // It is broken with its post still in it.
  const t = h.world.structs.chunks[Math.floor(mailbox / 65536)]!;
  const slot = mailbox & 0xffff;
  h.host.combat.city.hit(me, mailbox, h.world.structs.mapKind(Math.floor(mailbox / 65536), slot), 1e6, DMG_EXPLOSIVE, 0, t.x[slot]!, t.y[slot]! + 0.5, t.z[slot]!, false, 1);
  h.run(300);
  expect([t.kind[slot], h.host.fixtures.find(mailbox), ada.open]).toEqual([0, null, null]);
  const bags = [...h.host.records.byPid.values()].filter((r) => r.name === "Spilled");
  expect(bags.map((r) => h.host.items.inv(r).used())).toEqual([held]);
  // A broken holder is the regrow clock's to bring back.
  expect(h.host.cityRegrow.kept).toBe(1);
  expect(h.host.items.audit()).toEqual([]);
});

test("with street loot off nothing on the street is searched, and what was searched is kept through a save", () => {
  const off = street("StreetLootEnabled=False");
  beside(off.h, off.ada, off.bin);
  expect(send(off.h, off.ada, off.bin, STRUCT_SEARCH)).toBe(RESULT_DENIED);

  const { h, ada, bin } = street();
  expect(search(h, ada, bin, 1.5)).toBe(RESULT_OK);
  const saved = JSON.parse(h.host.holders.saved.serialize()) as [number, number][];
  expect(saved.map(([ref]) => ref)).toEqual([bin]);
  // A bin's time is 20 to 30 game hours from its first search.
  const left = saved[0]![1] - h.world.tick;
  expect([left > 19 * GAME_HOUR_TICKS, left <= 30 * GAME_HOUR_TICKS]).toEqual([true, true]);
});
