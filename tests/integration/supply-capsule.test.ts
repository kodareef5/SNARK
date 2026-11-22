// A supply drop's capsule as a container (planning/workstreams/supply.md): opened by looking at it and using it, only
// ever taken from, gated by a rule of the game's own, gone when it is emptied or its time is up, and what a modified
// client cannot do with one. The drops that land them are in tests/integration/supply.test.ts.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { TAKE_ONLY } from "../../server/own.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT_AT, CMD_DROP, CMD_MOVE, RESULT_DENIED, RESULT_OK, RESULT_STALE, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const CAPSULE = id("supply_capsule");
type Pilot = Harness["pilots"][number];

/** Ada on level ground with cheats, and a capsule two metres up the ground from her holding stone, a bow and arrows. */
function field(expiresIn = 0) {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 8, y: g.y };
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const pilot = h.pilots[0]!;
  const box = h.host.records.create(CAPSULE, "Blue Arms drop");
  box.x = at.x;
  box.y = at.y;
  box.z = at.z + 2;
  if (expiresIn > 0) box.expiresAt = h.world.tick + expiresIn;
  h.host.items.mint(box, id("stone"), 30);
  h.host.items.mint(box, id("bow"), 1, 2);
  h.host.items.mint(box, id("arrow_stone"), 20);
  h.host.death.place(box);
  pilot.yaw = 0;
  pilot.pitch = -0.35;
  h.run(300);
  return { h, ada, me, pilot, box, at };
}

function tapUse(h: Harness, pilot: Pilot): void {
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
}

function move(h: Harness, s: ClientSession, fromBox: number, from: number, toBox: number, to: number, item: number, count = 0): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_MOVE, (w: BitWriter) => {
    w.bits(fromBox, 1);
    w.varint(from);
    w.bits(toBox, 1);
    w.varint(to);
    w.u16(count);
    w.u16(item);
  });
  h.run(200);
  return code;
}

const notices = (s: ClientSession, from: number): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
const holds = (h: Harness, rec: EntityRecord): string[] => {
  const inv = h.host.items.inv(rec);
  const out: string[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push(`${reg.ids[inv.item[s]!]!.slice(5)} x${inv.count[s]}`);
  return out.sort();
};

test("the capsule is a prop of its own class, with 60 slots, that is only ever taken from", () => {
  const def = reg.defs[CAPSULE] as { type: string; class: string; slots: number };
  expect([def.type, def.class, def.slots, reg.takeOnly[CAPSULE], reg.takeOnly[id("cache")], reg.takeOnly[id("bag")]]).toEqual(["prop", "crate", 60, 1, 0, 0]);
});

test("used, it opens and says it is take-only; a stack comes out onto an empty slot or its like, and it goes when it is emptied", () => {
  const { h, ada, me, pilot, box } = field();
  const seen: string[] = [];
  h.host.death.onOpened.on((c, b) => void seen.push(`opened ${b.pid === box.pid} by ${c.pid === me.pid}`));
  h.host.death.onRemoved.on((b) => void seen.push(`removed ${b.pid === box.pid} holding ${h.host.items.inv(b).used()}`));
  tapUse(h, pilot);
  expect([h.client(ada)!.open, ada.open?.name, ada.open?.takeOnly, ada.open?.inventory.cap]).toEqual([box.pid, "Blue Arms drop", true, 60]);
  expect(holds(h, box)).toEqual(["arrow_stone x20", "bow x1", "stone x30"]);
  const mine = h.host.items.inv(me);
  const inside = h.host.items.inv(box);
  // Stone onto an empty slot of hers, then the rest of it onto that stack; the bow keeps its quality.
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("stone")), BOX_SELF, 0, id("stone"), 10)).toBe(RESULT_OK);
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("stone")), BOX_SELF, 0, id("stone"))).toBe(RESULT_OK);
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("bow")), BOX_SELF, 1, id("bow"))).toBe(RESULT_OK);
  expect([mine.count[0], mine.item[1], mine.quality[1], holds(h, box)]).toEqual([30, id("bow"), 2, ["arrow_stone x20"]]);
  expect(seen).toEqual(["opened true by true"]);
  // The last thing out, and it is gone: its record, its body and the box she had open.
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("arrow_stone")), BOX_SELF, 2, id("arrow_stone"))).toBe(RESULT_OK);
  h.run(200);
  expect([h.host.records.byPid.has(box.pid), h.client(ada)!.open, ada.open, seen[1]]).toEqual([false, 0, null, "removed true holding 0"]);
  let bodies = 0;
  for (let i = 0; i < h.world.ents.cap; i++) if ((h.world.ents.flags[i]! & F_ALIVE) !== 0 && h.world.ents.kind[i] === CAPSULE) bodies++;
  expect([bodies, h.host.items.audit()]).toEqual([0, []]);
  h.host.shutdown();
});

test("nothing goes in: not a stack put in, not one swapped in, not one given, whoever asks and however", () => {
  const { h, ada, me, pilot, box } = field();
  h.host.items.mint(me, id("wood"), 40);
  h.host.items.mint(me, id("flint"), 5);
  h.host.items.mint(me, id("stone"), 3);
  h.run(200);
  tapUse(h, pilot);
  expect(h.client(ada)!.open).toBe(box.pid);
  const mine = h.host.items.inv(me);
  const inside = h.host.items.inv(box);
  const [wood, flint, stone] = [mine.item.indexOf(id("wood")), mine.item.indexOf(id("flint")), mine.item.indexOf(id("stone"))];
  const before = [holds(h, box), holds(h, me)];
  let from = ada.logVersion;
  // Onto an empty slot of the capsule, onto its stone (which the stone would join), and onto its bow.
  for (const to of [10, inside.item.indexOf(id("stone")), inside.item.indexOf(id("bow"))]) {
    for (const [slot, item] of [[wood, id("wood")], [stone, id("stone")], [flint, id("flint")]] as const) expect(move(h, ada, BOX_SELF, slot, BOX_OPEN, to, item)).toBe(RESULT_DENIED);
  }
  expect(notices(ada, from).every((t) => t === TAKE_ONLY) && notices(ada, from).length === 9).toBe(true);
  // A swap: the capsule's bow onto her wood would leave her wood in the capsule.
  from = ada.logVersion;
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("bow")), BOX_SELF, wood, id("bow"))).toBe(RESULT_DENIED);
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("arrow_stone")), BOX_SELF, flint, id("arrow_stone"))).toBe(RESULT_DENIED);
  expect(notices(ada, from)).toEqual([TAKE_ONLY, TAKE_ONLY]);
  expect([holds(h, box), holds(h, me)]).toEqual(before);
  // The server's own ways of moving things hold the rule too.
  expect([h.host.items.give(me, box, id("wood"), 5), h.host.items.move(me, wood, box, 10, 0), h.host.items.move(box, inside.item.indexOf(id("bow")), me, wood, 0)]).toEqual([false, 0, 0]);
  // Stone onto her stone joins it, and a thing dropped from her own bag is no way in either: it makes a bag.
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("stone")), BOX_SELF, stone, id("stone"))).toBe(RESULT_OK);
  expect(mine.count[stone]).toBe(33);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_DROP, (w: BitWriter) => (w.varint(wood), w.u16(0), w.u16(id("wood"))));
  h.run(200);
  expect([code, holds(h, box)]).toEqual([RESULT_OK, ["arrow_stone x20", "bow x1"]]);
  // Nothing is crafted at it.
  code = -1;
  ada.command(CMD_CRAFT_AT, (w: BitWriter) => (w.u16(id("arrow_stone")), w.u8(1)));
  h.run(200);
  expect([code !== RESULT_OK, holds(h, box)]).toEqual([true, ["arrow_stone x20", "bow x1"]]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("the gate is asked at every use: one it refuses does not open, is told why, and is shut out of a box it had open", () => {
  const { h, ada, me, pilot, box } = field();
  let level = 25;
  h.host.death.gate.on((c, b) => (b.kind === CAPSULE && h.host.progression.level(h.host.records.byPid.get(c.pid)!) < level ? `You must be level ${level} to open this.` : ""));
  expect(h.host.progression.level(me)).toBeLessThan(25);
  let from = ada.logVersion;
  tapUse(h, pilot);
  expect([h.client(ada)!.open, notices(ada, from)]).toEqual([0, ["You must be level 25 to open this."]]);
  // At her level it opens.
  level = 1;
  tapUse(h, pilot);
  expect(h.client(ada)!.open).toBe(box.pid);
  // The rule turns against her while it is open: the next thing she asks of it is refused and it is shut.
  level = 25;
  const inside = h.host.items.inv(box);
  expect(move(h, ada, BOX_OPEN, inside.item.indexOf(id("bow")), BOX_SELF, 0, id("bow"))).toBe(RESULT_DENIED);
  expect([h.client(ada)!.open, holds(h, box)]).toEqual([0, ["arrow_stone x20", "bow x1", "stone x30"]]);
  // A bag or a cache is nobody's to gate here.
  from = ada.logVersion;
  h.host.death.gate.on((_c, b) => (b.kind === CAPSULE ? "no" : ""));
  h.host.items.mint(me, id("wood"), 4);
  h.run(100);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_DROP, (w: BitWriter) => (w.varint(h.host.items.inv(me).item.indexOf(id("wood"))), w.u16(0), w.u16(id("wood"))));
  h.run(200);
  expect(code).toBe(RESULT_OK);
  h.host.shutdown();
});

test("two survivors at one capsule: the first to take a stack has it, and the other is told it is gone", () => {
  const { h, ada, pilot, box, at } = field();
  const bob = h.join("bob");
  h.run(400);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x + 0.9).toFixed(3)} ${at.z.toFixed(3)}`);
  const bobs = h.pilots[1]!;
  bobs.yaw = -0.4;
  bobs.pitch = -0.35;
  h.run(300);
  tapUse(h, pilot);
  tapUse(h, bobs);
  expect([h.client(ada)!.open, h.client(bob)!.open]).toEqual([box.pid, box.pid]);
  const slot = h.host.items.inv(box).item.indexOf(id("bow"));
  // Both ask for the bow in the same moment.
  const codes = [-1, -1];
  [ada, bob].forEach((s, k) => {
    s.onResult = (seq, c) => void (seq !== 0 && (codes[k] = c));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(slot), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(id("bow"))));
  });
  h.run(300);
  expect([...codes].sort()).toEqual([RESULT_OK, RESULT_STALE].sort());
  const bows = [h.client(ada)!, h.client(bob)!].map((c) => h.host.items.inv(h.host.records.byPid.get(c.pid)!).total(id("bow")));
  expect([bows[0]! + bows[1]!, h.host.items.inv(box).total(id("bow")), h.host.items.audit()]).toEqual([1, 0, []]);
  h.host.shutdown();
});

test("left alone past its time it is removed, what it held burned through the ledger, and the hook hears of it", () => {
  const { h, box } = field(300);
  let heard = 0;
  h.host.death.onRemoved.on((b) => void (b.pid === box.pid && heard++));
  h.run(9000);
  expect(h.host.records.byPid.has(box.pid)).toBe(true);
  h.run(2000);
  expect([h.host.records.byPid.has(box.pid), heard, h.host.items.audit()]).toEqual([false, 1, []]);
  h.host.shutdown();
});
