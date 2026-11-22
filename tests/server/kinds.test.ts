// The list of kinds of content (shared/content/kinds.ts) and what compileContent makes of it.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CLASSES, FIELDS } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { KINDS } from "../../shared/content/kinds.ts";
import { compileContent } from "../../shared/content/registry.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const errorsOf = (...more: object[]): string[] => compileContent([...CORE_CONTENT, ...(more as Def[])]).errors;

test("no two kinds declare a column of one name", () => {
  const owner = new Map<string, string[]>();
  KINDS.forEach((k, at) => {
    for (const name of Object.keys(k.columns?.(2) ?? {})) owner.set(name, [...(owner.get(name) ?? []), `${k.type} (${at})`]);
  });
  expect([...owner].filter(([, by]) => by.length > 1)).toEqual([]);
  // Nor one the registry has before any kind adds its own: a definition's identity and the columns kinds share.
  const core = Object.keys(reg).filter((name) => !owner.has(name));
  expect(core.sort()).toEqual(["aliases", "baseHash", "bodyHeight", "bodyRadius", "coreHash", "damage", "defs", "halfX", "halfY", "halfZ", "hash", "ids", "index", "keeps", "meleeTorpor", "own", "parts", "reach", "redirects", "renames", "source", "tuning", "weapon"]);
});

test("every column is a field of the registry itself, as long as the index", () => {
  const n = reg.defs.length;
  for (const k of KINDS) {
    for (const name of Object.keys(k.columns?.(2) ?? {})) {
      const column = (reg as unknown as Record<string, unknown>)[name];
      expect(Object.hasOwn(reg, name)).toBe(true);
      if (ArrayBuffer.isView(column) || Array.isArray(column)) expect([name, (column as unknown as { length: number }).length]).toEqual([name, n]);
    }
  }
});

test("the class table is the kinds' rows in the list's order, and each family's fields are its kind's", () => {
  expect(CLASSES).toEqual(KINDS.flatMap((k) => k.rows ?? []));
  const families = KINDS.filter((k) => k.fields !== undefined);
  expect(Object.keys(FIELDS).sort()).toEqual(families.map((k) => k.type as string).sort());
  for (const k of families) expect((FIELDS as Record<string, unknown>)[k.type]).toBe(k.fields);
  // A type is one family's, though a second kind may be over it.
  expect(new Set(families.map((k) => k.type)).size).toBe(families.length);
  for (const k of KINDS) expect(families.some((f) => f.type === k.type)).toBe(true);
});

test("errors follow the order the definitions are given in, whatever their kinds", () => {
  const buff = { type: "buff", id: "t:slow", label: "Slow", color: 3, seconds: 0 };
  const node = { type: "node", id: "t:rock", mesh: "box", color: 3, half: [1, 1, 1], hits: 0, respawnHours: 1, yields: [], xp: 1 };
  const buffSays = "t:slow: seconds must be in (0, 86400], got 0";
  const nodeSays = "t:rock: hits must be in (0, 10000], got 0";
  expect(errorsOf(buff, node)).toEqual([buffSays, nodeSays]);
  expect(errorsOf(node, buff)).toEqual([nodeSays, buffSays]);
});

test("a weapon's faults come where an item's always did, between its own", () => {
  const club = { type: "item", class: "weapon", id: "t:club", stack: 1, weight: -1, weapon: { kind: "melee", hold: "tool", mesh: "t:club", uses: 0, damage: 5, type: "melee" }, spoilsInto: "t:club" };
  expect(errorsOf(club)).toEqual([
    'class item/weapon may not declare "spoilsInto"',
    "weight must not be negative",
    "weapon.uses must be in (0, 60000], got 0",
    "spoilsInto names another item, and only something that spoils has it",
  ].map((said) => `t:club: ${said}`));
});

test("a check among definitions comes after every check of one, and a station's between", () => {
  const fire = { type: "structure", class: "station", id: "t:fire", mesh: "box", color: 3, half: [1, 1, 1], hp: 0, slots: 0 };
  const pot = { type: "item", class: "resource", id: "t:pot", stack: 1, craft: { needs: [{ item: "core:wood", count: 1 }], seconds: 1, xp: 1, at: "t:fire" }, weight: -1 };
  const engram = { type: "engram", id: "t:engram-wood", label: "Wood", level: 0, cost: 1, item: "core:wood" };
  expect(errorsOf(engram, pot, fire)).toEqual([
    "t:engram-wood: level must be in (0, 1000], got 0",
    "t:pot: weight must not be negative",
    "t:fire: hp must be in (0, 1000000000], got 0",
    't:pot: it is made at "t:fire", which has no slots to make it from',
    't:engram-wood: "core:wood" cannot be made, so there is nothing to learn',
  ]);
});
