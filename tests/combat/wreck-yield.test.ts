import { expect, test } from "bun:test";
import type { Source } from "../../server/combat.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { city, rocket, type City } from "../fixtures/city.ts";
import { count, record, survivor } from "../kit/kit.ts";

function salvager(c: City, name: string) {
  const player = survivor(c.h, name);
  const src: Source = { ...rocket(c.h.reg), by: record(c.h, player), base: 32, type: DMG_MELEE, item: c.h.reg.index.get("core:pick_metal")! };
  return { src, has: (item: string) => count(c.h, player, item) };
}

function strike(c: City, ref: number, src: Source, times: number): number {
  const at = c.at(ref);
  let done = 0;
  for (let i = 0; i < times; i++) done += c.h.host.combat.hitStructure(src, ref, at.x, at.y + 0.5, at.z);
  return done;
}

test("heavy wrecks with one, two or three looks give the same fractional yield", () => {
  const kinds = ["core:tanker_impact", "core:tanker_abandoned", "core:zzzzroad_bus_abandoned"];
  const c = city(kinds.map((kind, i) => ({ kind, x: 100, z: 80 + 30 * i })));
  expect(c.h.host.rules.assign("WreckYieldMultiplier", "0.15", "console")).toBe("");
  const items = ["polymer", "crystal", "electronics", "gasoline", "ingot", "oil", "fiber", "ore"];
  for (const [i, ref] of c.refs.entries()) {
    const hand = salvager(c, ["ada", "bob", "cy"][i]!);
    strike(c, ref, hand.src, 72);
    expect([c.id(ref), items.map(hand.has)]).toEqual(["", [4, 1, 2, 1, 4, 1, 3, 15]]);
  }
});

test("a new rate pays only for the next survivor's work after a blast", () => {
  const c = city([{ kind: "core:tanker_abandoned", x: 100, z: 100 }]);
  const ref = c.refs[0]!, ada = salvager(c, "ada"), bob = salvager(c, "bob");
  expect(c.h.host.rules.assign("WreckYieldMultiplier", "0.5", "console")).toBe("");
  strike(c, ref, ada.src, 36);
  expect(ada.has("electronics")).toBe(3);
  strike(c, ref, { ...rocket(c.h.reg), by: ada.src.by }, 1);
  expect(Math.round(c.hp(ref))).toBe(1789);
  expect(c.h.host.rules.assign("WreckYieldMultiplier", "0.15", "console")).toBe("");
  // The blast passed the next electronic at the new rate. Bob earns only the last one.
  strike(c, ref, bob.src, 17);
  expect([c.id(ref), ada.has("electronics"), bob.has("electronics")]).toEqual(["", 3, 1]);
});

test("a blow that leaves the stored health unchanged gives no XP", () => {
  const c = city([{ kind: "core:tanker_impact", x: 100, z: 100 }]);
  const ref = c.refs[0]!, ada = salvager(c, "ada"), xp = ada.src.by!.xp;
  expect(c.h.host.rules.assign("CityResistanceMultiplier", "100000", "console")).toBe("");
  expect(strike(c, ref, { ...ada.src, item: 0 }, 20)).toBe(0);
  expect([c.hp(ref), ada.src.by!.xp, c.h.host.cityRegrow.kept]).toEqual([8000, xp, 0]);
  expect(strike(c, ref, ada.src, 1)).toBeGreaterThan(0);
  expect(ada.src.by!.xp).toBeGreaterThan(xp);
});
