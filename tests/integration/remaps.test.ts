// A pack that remaps an item: the world gives the new one, and what a save holds of the old one is still there.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_PACK } from "../../content/core.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-remaps-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const made = compilePacks([
  CORE_PACK,
  { name: "t", requires: ["core"], defs: [{ id: "t:berry_blue", extends: "core:berry", color: 12 }], remaps: [{ from: "core:berry", to: "t:berry_blue" }] },
]);
if (!made.registry) throw new Error(made.errors.join("\n"));
const REG = made.registry;

test("a remapped item comes off a bush, and what a save holds of the old one still loads", () => {
  const db = join(dir, "remap.db");
  const before = new Harness({}, 1, 30, { dev: true, dbPath: db });
  const first = before.join("ada");
  before.run(500);
  expect(before.say(first, "enablecheats")).toEqual(["cheats enabled"]);
  expect(before.say(first, "give berry 7")).toEqual(["gave 7 core:berry"]);
  const pid = before.client(first)!.pid;
  before.host.shutdown();

  const h = new Harness({}, 1, 30, { dev: true, dbPath: db }, REG);
  const s = h.join("bob", { latencyMs: 30 });
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const pilot = h.pilots[0]!;
  expect(nodesOf(h, "core:bush", 256, 256).some((b) => standFacing(h, s, pilot, b, 1.4))).toBe(true);
  for (let i = 0; i < 4; i++) {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(200);
  }
  const has = (who: number, id: string): number => h.host.records.byPid.get(who)!.inv!.total(REG.index.get(id)!);
  expect(has(rec.pid, "t:berry_blue")).toBeGreaterThanOrEqual(12);
  expect(has(rec.pid, "core:berry")).toBe(0);
  expect(has(pid, "core:berry")).toBe(7);
  expect(h.host.persistence!.store.missingContent).toEqual([]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});
