// Searching a street thing from the keyboard (client/core/prompts.ts, planning/workstreams/loot.md): the prompt, the
// hold of the use key, the box it opens and the word a searched one wears.

import { expect, test } from "bun:test";
import { KEY_PROMPT } from "../../client/core/hud/prompt.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { camp, look, put, screen, shown, tap, until } from "../kit/kit.ts";

const reg = coreRegistry();
const wreck = reg.ids.find((id, i) => reg.holds[i] === "wreck" && reg.salvageYield[i] != null)!;
const hull = reg.ids.find((id, i) => reg.holds[i] === "hull")!;
const file = writeMap(flatMap(4, { statics: [{ kind: "core:zzstreet_bin", x: 120, y: 0, z: 120, yaw: 0 }, { kind: "core:zzstreet_hydrant", x: 130, y: 0, z: 120, yaw: 0 }, { kind: wreck, x: 150, y: 0, z: 120, yaw: 0 }, { kind: hull, x: 180, y: 0, z: 120, yaw: 0 }] }));

test("the use key held on a bin searches it and opens it; a tap does nothing, and an emptied bin says searched", () => {
  const { h, ada } = camp({ place: { map: file, at: () => ({ x: 120, z: 118.6 }) }, screen: true, god: true, rules: { WorldLootChanceMultiplier: 4 } });
  const view = screen(h, ada);
  look(h, ada, { x: 120, y: 0.6, z: 120 });
  expect(until(h, () => shown(view, KEY_PROMPT) !== null, 5)).toBe(true);
  expect(shown(view, KEY_PROMPT)).toBe("hold E  search the bin");
  // A tap is not a search, and is no press of the use key either.
  view.app.key("KeyE", true);
  h.run(200);
  view.app.key("KeyE", false);
  h.run(500);
  expect([ada.open, h.host.holders.count]).toEqual([null, 0]);
  // Held, the prompt counts the search, and at the bin's second and a half it opens.
  view.app.key("KeyE", true);
  h.run(700);
  expect(shown(view, KEY_PROMPT)).toMatch(/^searching the bin  \d+%$/);
  expect(until(h, () => ada.open !== null, 3)).toBe(true);
  view.app.key("KeyE", false);
  expect([ada.open!.takeOnly, ada.open!.inventory.item.some((i) => i !== 0), h.host.holders.count]).toEqual([true, true, 1]);
  // Somebody else empties it and she shuts it: the next hold is told at once, and the prompt remembers.
  const bin = [...h.world.structs.held].flatMap((chunk) => Array.from({ length: h.world.structs.chunks[chunk]!.mapped }, (_, slot) => chunk * 65536 + slot)).find((ref) => h.host.holders.tag(ref) === "bin")!;
  h.host.items.burnAll(h.host.fixtures.find(bin)!);
  h.host.containers.close(h.client(ada)!);
  h.run(300);
  expect(ada.open).toBe(null);
  // The bag's screen is shut as she would shut it.
  tap(h, view, "Escape");
  view.app.key("KeyE", true);
  h.run(400);
  view.app.key("KeyE", false);
  h.run(200);
  expect(shown(view, KEY_PROMPT)).toBe("Already searched");
  expect(until(h, () => shown(view, KEY_PROMPT) === "bin  searched", 6)).toBe(true);
  // A hydrant holds nothing and says nothing.
  put(h, ada, { x: 130, z: 118.6 });
  look(h, ada, { x: 130, y: 0.4, z: 120 });
  h.run(300);
  expect(shown(view, KEY_PROMPT)).toBeNull();
});

test("a street wreck and a dead boat are searched by the same hold, each by its own word", () => {
  const { h, ada } = camp({ place: { map: file, at: () => ({ x: 150, z: 117 }) }, screen: true, god: true });
  const view = screen(h, ada);
  const prompt = (x: number, back: number): string | null => {
    put(h, ada, { x, z: 120 - back });
    look(h, ada, { x, y: 0.8, z: 120 });
    h.run(400);
    return shown(view, KEY_PROMPT);
  };
  expect(prompt(150, 3)).toBe("hold E  search the wreck");
  // A dead boat keeps the word that tells it from one that sails.
  const half = reg.halfZ[reg.index.get(hull)!]!;
  expect(prompt(180, half + 1.5)).toBe("hold E  search the derelict");
});

test("where the server searches no street things a bin says nothing, and a wreck still does", () => {
  const { h, ada } = camp({ place: { map: file, at: () => ({ x: 120, z: 118.6 }) }, screen: true, god: true, rules: { StreetLootEnabled: false } });
  const view = screen(h, ada);
  look(h, ada, { x: 120, y: 0.6, z: 120 });
  h.run(600);
  expect(shown(view, KEY_PROMPT)).toBeNull();
  put(h, ada, { x: 150, z: 117 });
  look(h, ada, { x: 150, y: 0.8, z: 120 });
  h.run(400);
  expect(shown(view, KEY_PROMPT)).toBe("hold E  search the wreck");
});
