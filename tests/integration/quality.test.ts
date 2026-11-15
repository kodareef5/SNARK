// Quality and blueprints through the server and the wire: what the console gives, what a blueprint makes in the hands and
// at a station, what crafting skill adds, what survives a restart, and a loot roll minted. The ledger balances throughout.

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { InventoryScreen, KEY_INV_CRAFT, KEY_INV_INFO, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { NO_TARGET } from "../../server/build.ts";
import type { Def, LootDef, SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT, CMD_CRAFT_BLUEPRINT, CMD_DROP, CMD_MOVE, CMD_PLACE, CMD_REPAIR, CMD_SELECT, CMD_STRUCT, CMD_USE, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, QUALITY_CRAFT_XP, type Inventory } from "../../shared/sim/items.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** Sends a command and returns its result code. */
function send(h: Harness, s: ClientSession, cmd: number, write: (w: BitWriter) => void, ms = 150): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(cmd, write);
  h.run(ms);
  return code;
}
const fromBlueprint = (h: Harness, s: ClientSession, box: number, slot: number, n: number): number => send(h, s, CMD_CRAFT_BLUEPRINT, (w) => (w.bits(box, 1), w.varint(slot), w.u8(n)));
const move = (h: Harness, s: ClientSession, fromBox: number, from: number, toBox: number, to: number, item: number): number => send(h, s, CMD_MOVE, (w) => (w.bits(fromBox, 1), w.varint(from), w.bits(toBox, 1), w.varint(to), w.u16(0), w.u16(item)));

/** Every slot as [item, count, quality, flags, durability], for comparing the client's mirror with the server's. */
const slots = (inv: Inventory): number[][] => Array.from({ length: inv.cap }, (_, s) => [inv.item[s]!, inv.count[s]!, inv.quality[s]!, inv.flags[s]!, inv.dur[s]!]);
/** The first slot holding `item` with these flags, or -1. */
const slotOf = (inv: Inventory, item: number, flags = 0): number => {
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] === item && inv.flags[s] === flags) return s;
  return -1;
};

function setup(reg?: Registry, dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, ...(dbPath ? { dbPath } : {}) }, ...(reg ? [reg] : []));
  const s = h.join("ada");
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  h.say(s, "setstat weight 255");
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  return { h, s, rec, items: h.host.items };
}

test("give makes stacks at a quality and blueprints, which stack only with their like, reach the client as they are, and are never used, held or mended", () => {
  const { h, s, rec, items } = setup();
  expect(h.say(s, "give hatchet 1 journeyman bp")).toEqual(["gave 1 core:hatchet blueprint (journeyman)"]);
  expect(h.say(s, "give hatchet 2 bp")).toEqual(["gave 2 core:hatchet blueprint (primitive)"]);
  expect(h.say(s, "give stone 5 2")).toEqual(["gave 5 core:stone (apprentice)"]);
  expect(h.say(s, "give stone 5")).toEqual(["gave 5 core:stone"]);
  expect(h.say(s, "give stone 5 apprentice")).toEqual(["gave 5 core:stone (apprentice)"]);
  expect(h.say(s, "give hatchet 1 3")).toEqual(["gave 1 core:hatchet (journeyman)"]);
  expect(h.say(s, "give stone 1 bp")).toEqual(["core:stone cannot be a blueprint: only an item that is crafted can"]);
  expect(h.say(s, "give hatchet 1 shiny")[0]).toStartWith('"shiny" is no quality (0 primitive, 1 ramshackle');
  expect(h.say(s, "give hatchet 1 9")[0]).toStartWith('"9" is no quality');
  h.run(300);
  const inv = items.inv(rec);
  // The client's mirror is the server's, flags and all.
  expect(slots(s.inventory!)).toEqual(slots(inv));
  const hatchet = id("hatchet");
  const bp = slotOf(inv, hatchet, FLAG_BLUEPRINT);
  expect([inv.count[bp], inv.quality[bp], inv.dur[bp], s.inventory!.flags[bp]]).toEqual([1, 3, 0, FLAG_BLUEPRINT]);
  // Three blueprints, three slots; the stone of each quality in its own stack; one journeyman hatchet with its uses.
  expect([inv.used(), inv.total(hatchet), inv.total(id("stone"))]).toEqual([6, 1, 15]);
  const made = slotOf(inv, hatchet);
  expect([inv.quality[made], inv.dur[made]]).toEqual([3, 105]);
  // A blueprint is not eaten or used, not mended, never held in the hotbar, and a carried hatchet is never swapped onto it.
  expect(send(h, s, CMD_USE, (w) => (w.varint(bp), w.u16(hatchet)))).toBe(RESULT_INVALID);
  expect(send(h, s, CMD_REPAIR, (w) => w.varint(bp))).toBe(RESULT_INVALID);
  expect(move(h, s, BOX_SELF, bp, BOX_SELF, inv.hotbar, hatchet)).toBe(RESULT_INVALID);
  expect(move(h, s, BOX_SELF, made, BOX_SELF, inv.hotbar + 1, hatchet)).toBe(RESULT_OK);
  expect(move(h, s, BOX_SELF, inv.hotbar + 1, BOX_SELF, bp, hatchet)).toBe(RESULT_INVALID);
  // Within the bag it moves as any slot, flags and quality with it.
  const free = inv.free();
  expect(move(h, s, BOX_SELF, bp, BOX_SELF, free, hatchet)).toBe(RESULT_OK);
  expect([inv.flags[free], inv.quality[free], inv.item[bp]]).toEqual([FLAG_BLUEPRINT, 3, 0]);
  h.run(200);
  expect(slots(s.inventory!)).toEqual(slots(inv));

  // The inventory marks it and names it, and a picked-up blueprint has a Craft button.
  const screen = new InventoryScreen();
  screen.open = true;
  const f = new UiFrame();
  f.begin(16 / 9);
  screen.pointer(2, KEY_INV_SLOT + free * 3, 0, s);
  screen.build(f, s, reg, null);
  expect(f.find(KEY_INV_SLOT + free * 3 + 2)?.text).toBe("BP");
  expect(f.find(KEY_INV_INFO)?.text).toBe("journeyman hatchet blueprint: 4 flint, 4 wood, 37 thatch");
  expect(f.find(KEY_INV_SLOT + free * 3)?.tint).not.toBe(-1);
  expect(f.find(KEY_INV_CRAFT)).toBeNull();
  screen.pointer(0, KEY_INV_SLOT + free * 3, 0, s);
  f.begin(16 / 9);
  screen.build(f, s, reg, null);
  expect(f.find(KEY_INV_CRAFT)?.text).toBe("Craft");
  // Without the ingredients the server refuses it.
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  screen.pointer(0, KEY_INV_CRAFT, 0, s);
  h.run(150);
  expect(code).toBe(RESULT_SHORT);
  expect(items.audit()).toEqual([]);
});

test("a blueprint makes its item in the hands with no engram, at its quality's cost and quality, as long as it lies there", () => {
  const { h, s, rec, items } = setup();
  const hatchet = id("hatchet");
  const inv = items.inv(rec);
  h.say(s, "give hatchet 1 journeyman bp");
  h.say(s, "give stone 10");
  // ada does not know the hatchet's engram (level 2, 3 points), so it cannot be made from that.
  expect(send(h, s, CMD_CRAFT, (w) => (w.u16(hatchet), w.u8(1)))).toBe(RESULT_DENIED);
  const bp = slotOf(inv, hatchet, FLAG_BLUEPRINT);
  // Not a blueprint, an empty slot, a slot past the end, or nothing made, are refused.
  expect(fromBlueprint(h, s, BOX_SELF, slotOf(inv, id("stone")), 1)).toBe(RESULT_INVALID);
  expect(fromBlueprint(h, s, BOX_SELF, inv.free(), 1)).toBe(RESULT_INVALID);
  expect(fromBlueprint(h, s, BOX_SELF, 9999, 1)).toBe(RESULT_INVALID);
  expect(fromBlueprint(h, s, BOX_SELF, bp, 0)).toBe(RESULT_INVALID);
  // With no box open there is nothing to make it in.
  expect(fromBlueprint(h, s, BOX_OPEN, bp, 1)).toBe(RESULT_DENIED);
  // A journeyman blueprint asks 3.7 times the engram's 1 flint, 1 wood and 10 thatch, rounded up: 4, 4 and 37.
  h.say(s, "give flint 11");
  h.say(s, "give wood 12");
  h.say(s, "give thatch 111");
  expect(send(h, s, CMD_CRAFT_BLUEPRINT, (w) => (w.bits(BOX_SELF, 1), w.varint(bp), w.u8(3)))).toBe(RESULT_OK);
  expect([inv.total(id("flint")), inv.total(id("wood")), inv.total(id("thatch"))]).toEqual([7, 8, 74]);
  expect(rec.jobs).toEqual([{ item: hatchet, left: 3, doneAt: rec.jobs[0]!.doneAt, bp: 3 }]);
  const xp = rec.xp;
  h.run(2000);
  // Journeyman, 105 uses of 60 at 1.75, and four times the 2 experience, as ARK gives for the quality made.
  const made = slotOf(inv, hatchet);
  expect([inv.total(hatchet), inv.quality[made], inv.dur[made], inv.flags[bp], inv.quality[bp]]).toEqual([1, 3, 105, FLAG_BLUEPRINT, 3]);
  expect(rec.xp - xp).toBeCloseTo(2 * QUALITY_CRAFT_XP[3]! * h.host.rules.num("XPMultiplier") * h.host.rules.num("CraftXPMultiplier"), 6);
  // The second unit started at once and took its share. Dropped, the blueprint is gone from the bag, so the third never starts.
  expect(inv.total(id("flint"))).toBe(3);
  expect(send(h, s, CMD_DROP, (w) => (w.varint(bp), w.u16(0), w.u16(hatchet)))).toBe(RESULT_OK);
  expect(slotOf(inv, hatchet, FLAG_BLUEPRINT)).toBe(-1);
  h.run(4000);
  expect([inv.total(hatchet), rec.jobs.length, inv.total(id("flint")), inv.total(id("thatch"))]).toEqual([2, 0, 3, 37]);
  h.run(200);
  expect(slots(s.inventory!)).toEqual(slots(inv));
  expect(items.audit()).toEqual([]);
});

const U = STRUCT_UNITS;

test("at a station a blueprint lies in the station, makes its item there with no engram, is refused in the wrong place, and blueprints and blueprint jobs survive a restart", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-quality-"));
  const dbPath = joinPath(dir, "world.db");
  const made = builder(["ada"], 40, 40, { dbPath });
  let { h } = made;
  const ada = made.sessions[0]!;
  const spark = id("sparkpowder");
  // The mortar and pestle, set down from the hotbar as stations.test.ts does.
  h.say(ada, "give piece_mortar 1");
  const own = ada.inventory!;
  expect(move(h, ada, BOX_SELF, own.item.indexOf(id("piece_mortar")), BOX_SELF, own.hotbar + 7, id("piece_mortar"))).toBe(RESULT_OK);
  send(h, ada, CMD_SELECT, (w) => w.u8(7), 100);
  const before = h.host.build.placed;
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((made.at.x + 1) * U), 32), w.sbits(Math.round((made.at.z + 1.5) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(150);
  expect(h.host.build.placed).toBe(before + 1);
  const mortar = h.host.build.last;
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const inv = h.host.items.inv(me);

  h.say(ada, "give sparkpowder 2 bp");
  h.say(ada, "give hatchet 1 mastercraft bp");
  h.say(ada, "give flint 20");
  h.say(ada, "give stone 10");
  const sparkBp = slotOf(inv, spark, FLAG_BLUEPRINT);
  // In the bag, a blueprint of what is made at a station is in the wrong place.
  expect(fromBlueprint(h, ada, BOX_SELF, sparkBp, 1)).toBe(RESULT_INVALID);
  expect(send(h, ada, CMD_STRUCT, (w) => (w.u32(mortar), w.u8(STRUCT_USE), w.u16(NO_PIN)))).toBe(RESULT_OK);
  const state = h.host.fixtures.find(mortar)!;
  const box = h.host.items.inv(state);
  expect(move(h, ada, BOX_SELF, sparkBp, BOX_OPEN, 0, spark)).toBe(RESULT_OK);
  expect(move(h, ada, BOX_SELF, slotOf(inv, id("hatchet"), FLAG_BLUEPRINT), BOX_OPEN, 1, id("hatchet"))).toBe(RESULT_OK);
  expect(move(h, ada, BOX_SELF, slotOf(inv, id("flint")), BOX_OPEN, 2, id("flint"))).toBe(RESULT_OK);
  expect(move(h, ada, BOX_SELF, slotOf(inv, id("stone")), BOX_OPEN, 3, id("stone"))).toBe(RESULT_OK);
  h.run(200);
  // The open box reaches the client with its flags.
  expect(slots(ada.open!.inventory)).toEqual(slots(box));
  // A hatchet is made in the hands, never at the mortar.
  expect(fromBlueprint(h, ada, BOX_OPEN, 1, 1)).toBe(RESULT_INVALID);
  // ada knows no sparkpowder engram (level 6), and the blueprint makes it all the same, from the mortar's flint and stone.
  expect(fromBlueprint(h, ada, BOX_OPEN, 0, 3)).toBe(RESULT_OK);
  expect(state.jobs).toEqual([{ item: spark, left: 3, doneAt: state.jobs[0]!.doneAt, by: me.pid, bp: 0 }]);
  h.run(1100);
  // A primitive blueprint asks what the engram does: 2 flint and 1 stone a grind, making 2.
  expect([box.total(spark), box.total(id("flint")), box.flags[0]]).toEqual([2, 16, FLAG_BLUEPRINT]);

  // A restart keeps the blueprints, their quality and the job's.
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  const again = h.join("ada");
  h.run(600);
  const back = h.host.fixtures.find(mortar)!;
  const backBox = h.host.items.inv(back);
  expect([backBox.item[0], backBox.flags[0], backBox.item[1], backBox.flags[1], backBox.quality[1]]).toEqual([spark, FLAG_BLUEPRINT, id("hatchet"), FLAG_BLUEPRINT, 4]);
  expect(back.jobs[0]).toMatchObject({ item: spark, by: me.pid, bp: 0 });
  h.run(3000);
  expect([backBox.total(spark), back.jobs.length, backBox.flags[0]]).toEqual([6, 0, FLAG_BLUEPRINT]);
  expect(h.host.items.audit()).toEqual([]);
  void again;
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("a save from before flags, its slots in COMP_SLOTS2 under record format 4, loads with nothing lost and nothing a blueprint", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-slots2-"));
  const dbPath = joinPath(dir, "world.db");
  let { h, s, rec, items } = setup(undefined, dbPath);
  h.say(s, "give stone 70 2");
  h.say(s, "give hatchet 1 4");
  h.say(s, "give berry 12");
  h.run(300);
  const was = slots(items.inv(rec));
  const pid = rec.pid;
  h.host.shutdown();
  // Rewrite every record as the build before wrote it: format 4, and each slot without its flags byte, as part 11.
  const db = new Database(dbPath);
  let rewrote = 0;
  for (const row of db.query("SELECT pid, data FROM entities").all() as { pid: number; data: Uint8Array }[]) {
    const r = new BitReader(row.data);
    const w = new BitWriter(row.data.length + 16);
    // This build writes revision 6, whose one more bit, a creature's flying, is 0 here and reads as the padding of 4 does.
    expect(r.u8()).toBe(6);
    w.u8(4);
    w.string(r.string(256));
    const n = r.varint();
    w.varint(n);
    for (let k = 0; k < n; k++) {
      const part = r.varint();
      const blob = r.blob(1 << 20);
      if (part !== 22) {
        w.varint(part);
        w.blob(blob);
        continue;
      }
      const c = new BitReader(blob);
      const o = new BitWriter(blob.length + 16);
      o.varint(c.varint());
      o.varint(c.varint());
      const used = c.varint();
      o.varint(used);
      for (let i = 0; i < used; i++) {
        for (let f = 0; f < 3; f++) o.varint(c.varint());
        o.u8(c.u8());
        o.varint(c.varint());
        o.varint(c.varint());
        const holds = c.bool();
        o.bool(holds);
        if (holds) (o.varint(c.varint()), o.u8(c.u8()), o.varint(c.varint()));
        expect(c.u8()).toBe(0);
      }
      w.varint(11);
      w.blob(o.bytes());
      rewrote++;
    }
    db.query("UPDATE entities SET data = ? WHERE pid = ?").run(w.bytes().slice(), row.pid);
  }
  db.close();
  expect(rewrote).toBeGreaterThan(0);
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  s = h.join("ada");
  h.run(600);
  rec = h.host.records.byPid.get(pid)!;
  items = h.host.items;
  // Spoilage aside, it is what it was. The berries kept their clock, so nothing spoiled in a second.
  expect(slots(items.inv(rec))).toEqual(was);
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

/** The core content with a crafting stat on the survivor, as ARK's 100% and 10% a point, and a crate to roll. */
function craftingContent(): Registry {
  const crate: LootDef = {
    type: "loot",
    id: "core:test_crate",
    sets: { min: 1, max: 2 },
    from: [
      { weight: 2, min: 1, max: 2, entries: [{ items: ["core:stone", "core:flint"], min: 5, max: 20 }, { items: ["core:fiber"], min: 10, max: 30 }] },
      { min: 1, max: 1, entries: [{ items: ["core:hatchet", "core:pick"], weights: [1, 1], min: 1, max: 1, quality: [1, 12], blueprint: 0.5 }] },
    ],
  };
  const defs = CORE_CONTENT.map((d) => (d.type === "species" && d.id === "core:survivor" ? ({ ...d, stats: { ...(d as SpeciesDef).stats, crafting: [1, 0, 0.1] } } as Def) : d));
  const { registry, errors } = compileContent([...defs, crate] as Def[]);
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

test("crafting skill raises what a blueprint makes, never what an engram makes, and a seeded loot roll mints the same each time", () => {
  const { h, s, rec, items } = setup(craftingContent());
  const hatchet = id("hatchet");
  const inv = items.inv(rec);
  // At 100% a mastercraft blueprint makes mastercraft. 255 points in crafting make 2650%, whose bonus reaches 132.5%.
  expect(h.host.progression.craftingSkill(rec)).toBe(1);
  h.say(s, "give hatchet 1 mastercraft bp");
  h.say(s, "give flint 200");
  h.say(s, "give wood 200");
  h.say(s, "give thatch 1000");
  const bp = slotOf(inv, hatchet, FLAG_BLUEPRINT);
  expect(fromBlueprint(h, s, BOX_SELF, bp, 2)).toBe(RESULT_OK);
  h.run(4200);
  const qualities = (): number[] => {
    const out: number[] = [];
    for (let k = 0; k < inv.cap; k++) if (inv.item[k] === hatchet && inv.flags[k] === 0) out.push(inv.quality[k]!);
    return out.sort();
  };
  expect(qualities()).toEqual([4, 4]);
  expect(h.say(s, "setstat crafting 255")).toEqual(["crafting: 255 points, value 26.5"]);
  expect(h.host.progression.craftingSkill(rec)).toBeCloseTo(26.5, 9);
  expect(fromBlueprint(h, s, BOX_SELF, bp, 8)).toBe(RESULT_OK);
  h.run(17000);
  // Ascendant once the bonus is past 45% of what mastercraft adds, which about two draws in three are.
  const q = qualities();
  expect([q.length, q.every((v) => v >= 4), q.filter((v) => v === 5).length > 0, q.filter((v) => v === 4).length > 2]).toEqual([10, true, true, true]);
  // From the engram it is primitive, whatever the skill.
  rec.engrams.push(h.reg.index.get("core:engram-hatchet")!);
  expect(send(h, s, CMD_CRAFT, (w) => (w.u16(hatchet), w.u8(1)))).toBe(RESULT_OK);
  h.run(2200);
  expect(qualities().filter((v) => v === 0)).toHaveLength(1);

  // A loot roll: the same seed gives the same, minted into the bag, and the ledger holds.
  expect(h.say(s, "loot nothing")).toEqual(['no loot "nothing"']);
  const first = h.say(s, "loot test_crate 7")[0]!;
  expect(first).toStartWith("core:test_crate seed 7: ");
  expect(h.say(s, "loot test_crate 7")).toEqual([first]);
  expect(h.say(s, "loot test_crate 8")[0]).not.toBe(first);
  expect(h.say(s, "loot test_crate -1")).toEqual(["seed must be a whole number from 0 to 4294967295"]);
  h.run(200);
  expect(slots(s.inventory!)).toEqual(slots(inv));
  expect(items.audit()).toEqual([]);
});
