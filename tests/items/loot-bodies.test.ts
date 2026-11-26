// What a wild creature's body holds (planning/workstreams/loot.md): rolled when it is first opened, from the drop
// book's sources for a body of its size and level.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { Body } from "../../server/corpses.ts";
import type { HostOptions } from "../../server/host.ts";
import { BODY_SLOTS } from "../../server/loot.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { flatGround } from "../fixtures/arena.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const snark = (lines: string) => loadConfig({ gus: `[SnarkSettings]\n${lines}`, game: "" }).rules;

/** Ada stands on level ground with cheats on, and nothing harms her. */
function camp(host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  return { h, ada, at, me, id: (name: string): number => h.reg.index.get(name)! };
}

/** Spawns `kind` at `level` and kills it, then waits for its body to lie. `tame` makes it Ada's first. */
function killed(h: Harness, kind: string, x: number, z: number, level = 1, tame: EntityRecord | null = null): Body {
  const e = h.host.spawnCreature(kind, x, z, level);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  if (tame) rec.team = tame.team || tame.pid;
  h.run(100);
  const before = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, 0);
  const body = [...h.host.corpses.bodies.values()].find((b) => !before.has(b.rec.pid))!;
  expect(body).toBeDefined();
  h.run(3000);
  return body;
}

/** Ada walks up to a body, looks at it and presses use. */
function open(h: Harness, s: ClientSession, b: Body): void {
  const m = h.host.corpses.middle(b);
  h.say(s, `tp ${m.x.toFixed(3)} ${(m.z - 1.4).toFixed(3)}`, 300);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const ents = h.world.ents;
  const e = h.ent(s);
  pilot.yaw = Math.atan2(m.x - ents.x[e]!, m.z - ents.z[e]!);
  pilot.pitch = Math.atan2(m.y - (ents.y[e]! + 1.62), Math.hypot(m.x - ents.x[e]!, m.z - ents.z[e]!));
  h.run(200);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
}

const held = (h: Harness, b: Body): [string, number][] => {
  const inv = h.host.items.inv(b.rec);
  const out: [string, number][] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push([h.reg.ids[inv.item[s]!]!, inv.count[s]!]);
  return out;
};

test("a wild creature's body is sealed where it falls, and holds something from the moment it is first opened", () => {
  const { h, ada, at } = camp();
  const body = killed(h, "core:dodo", at.x, at.z + 3);
  expect([h.host.loot.sealed(body.rec), body.rec.inv === null || h.host.items.inv(body.rec).used() === 0]).toEqual([true, true]);
  open(h, ada, body);
  expect(ada.open?.name).toBe("dodo");
  expect(h.host.loot.sealed(body.rec)).toBe(false);
  const first = held(h, body);
  expect(first.length).toBeGreaterThan(0);
  expect(ada.open!.inventory.item.filter((i) => i !== 0).length).toBe(first.length);
  // Shut and opened again, it holds what it held: it is rolled once.
  open(h, ada, body);
  open(h, ada, body);
  expect(held(h, body)).toEqual(first);
  expect(h.host.items.audit()).toEqual([]);
});

test("the same world rolls a body the same loot, and a tame's body holds only what it carried", () => {
  const once = (): [string, number][][] => {
    const { h, ada, at } = camp();
    return [0, 1, 2].map((k) => {
      const body = killed(h, "core:rex", at.x + k * 8, at.z + 6, 120);
      open(h, ada, body);
      return held(h, body);
    });
  };
  expect(once()).toEqual(once());
  const { h, at, me } = camp();
  const pet = killed(h, "core:dodo", at.x, at.z + 3, 1, me);
  expect(h.host.loot.sealed(pet.rec)).toBe(false);
});

test("an apex body of a high level holds a prize of its level's tier more often than not at twice the chance", () => {
  const { h } = camp({ config: snark("WorldLootChanceMultiplier=2") });
  const reg = h.reg;
  const compiled = h.host.supply.compiled();
  const prizes = new Set(["arms", "armour", "stable", "works"].flatMap((cls) => compiled.book.sets[`prize.${cls}.yellow`]!.entries.flatMap((e) => e.items)));
  let withPrize = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rec = h.host.records.create(reg.index.get("core:corpse")!, "rex");
    rec.inv = new Inventory(BODY_SLOTS);
    h.host.loot.fill(rec, { kind: "body", species: "core:rex", size: "apex", level: 125 }, seed);
    const inv = h.host.items.inv(rec);
    if (inv.item.some((i) => i !== 0 && prizes.has(reg.ids[i]!))) withPrize++;
    h.host.items.burnAll(rec);
    h.host.records.delete(rec.pid);
  }
  // The apex source's chance is a half, so doubled it is sure.
  expect(withPrize).toBe(20);
  expect(h.host.items.audit()).toEqual([]);
});

test("with body loot off a body holds nothing, and with every source off it holds a little of what its kind gives", () => {
  const off = camp({ config: snark("BodyLootEnabled=False") });
  const empty = killed(off.h, "core:dodo", off.at.x, off.at.z + 3);
  open(off.h, off.ada, empty);
  expect(held(off.h, empty)).toEqual([]);

  const lines = ["body/any", "body/medium", "body/large", "body/apex"].map((key) => `ConfigOverrideLootSource=(Source="${key}",Enabled=False)`).join("\n");
  const bare = camp({ config: snark(lines) });
  const body = killed(bare.h, "core:rex", bare.at.x, bare.at.z + 6, 150);
  open(bare.h, bare.ada, body);
  const got = held(bare.h, body);
  expect(got.length).toBe(1);
  expect(["core:meat", "core:hide", "core:meat_prime"]).toContain(got[0]![0]);
});

test("a body used up before anyone opened it leaves its loot in a cache", () => {
  const { h, at, me, id } = camp();
  const body = killed(h, "core:dodo", at.x, at.z + 3);
  for (; h.host.corpses.bodies.has(body.rec.pid); ) h.host.corpses.take(me, body, 20, id("core:hatchet"));
  const caches = [...h.host.records.byPid.values()].filter((r) => r.kind === id("core:cache"));
  expect(caches.map((r) => [r.name, h.host.items.inv(r).used() > 0])).toEqual([["dodo's cache", true]]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a module hears each roll and may refuse it or change its tier", () => {
  const heard: string[] = [];
  const mod = listener("lootwatch", [], (m) => {
    m.on("loot.roll", (e) => {
      heard.push(`${e.data.source} ${e.data.kind} ${e.data.level} ${e.data.tier}`);
      if (e.data.source === "body/any") e.refuse("no scraps");
      if (e.data.source === "body/apex") (e.data.tier = "white"), (e.data.chance = 2);
    });
    m.on("loot.found", (e) => void heard.push(`found ${e.data.source} ${e.data.tier}`));
  });
  const { h } = camp({ modules: [mod.def] });
  const rec = h.host.records.create(h.reg.index.get("core:corpse")!, "rex");
  rec.inv = new Inventory(BODY_SLOTS);
  h.host.loot.fill(rec, { kind: "body", species: "core:rex", size: "apex", level: 150 }, 5);
  // What happened is told when the tick is done.
  h.run(100);
  expect(heard).toEqual(["body/any body 150 ", "body/apex body 150 red", "found body/apex white"]);
});
