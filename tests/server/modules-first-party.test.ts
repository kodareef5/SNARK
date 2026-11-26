// The game's own modules (modules/*.ts), loaded by every server unless left out by name: each is named for its file, and
// a server starts with all of them together.

import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { loadModules, OWN_MODULES } from "../../server/main.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const own = readdirSync(OWN_MODULES).filter((n) => n.endsWith(".ts")).map((n) => n.slice(0, -3)).sort();

test("every one of the game's own modules loads, named for its file, and a server starts with them all", async () => {
  expect(own).toContain("ufo");
  const modules = await loadModules([], "");
  expect(modules.map((m) => m.name)).toEqual(own);
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(8)), log: () => {}, modules });
  expect([...h.host.mapEvents.kinds.keys()]).toContain("ufo");
  h.host.shutdown();
});

test("a module of the game's own is left out by ModulesOff or --no-module", async () => {
  expect((await loadModules([], "", "ufo, other")).map((m) => m.name)).toEqual(own.filter((n) => n !== "ufo"));
  expect((await loadModules(["--no-module", "ufo"], "")).map((m) => m.name)).toEqual(own.filter((n) => n !== "ufo"));
});
