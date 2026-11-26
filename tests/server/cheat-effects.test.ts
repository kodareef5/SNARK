// What a cheat leaves running, flight, ghost, god mode and a creature possessed, lasts only while the survivor may still
// run the cheat that gave it: by every cheat, or by its groups' permission for that one command.
import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { Rules } from "../../server/settings/rules.ts";
import { MODE_FLY, MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { camp, creature, look, pos, record, survivor } from "../kit/kit.ts";

const quiet = { log: () => {} };

/** The operator's lines, each of which must be done. */
function op(h: Harness, ...lines: string[]): void {
  for (const line of lines) {
    const out = h.host.exec(line);
    if (/^(There|That|denied)/.test(out)) throw new Error(`${line}: ${out}`);
  }
}

const mode = (h: Harness, s: ClientSession): number => h.world.ents.mode[h.client(s)!.ent]!;
const god = (h: Harness, s: ClientSession): boolean => h.host.buffs.has(record(h, s), h.world.reg.index.get("core:god")!);

test("a member whose group holds only Cheat.fly walks once it is revoked", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Fliers", "Permissions.Grant Fliers Cheat.fly", "Permissions.Add bob Fliers");
  expect(h.say(bob, "fly")).toEqual(["flying"]);
  op(h, "Permissions.AddGroup Others", "Permissions.Grant Others Cheat.kick");
  expect(mode(h, bob)).toBe(MODE_FLY);
  op(h, "Permissions.Revoke Fliers Cheat.fly");
  expect(mode(h, bob)).toBe(MODE_WALK);
});

test("a member walks when the timed membership that let them fly ends", () => {
  const clock = { ms: 1_000_000_000 };
  const { h } = camp({ host: { survivorLog: { wall: () => clock.ms }, ...quiet } });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Fliers", "Permissions.Grant Fliers Cheat.fly", "Permissions.AddTimed bob Fliers 1 0");
  expect(h.say(bob, "fly")).toEqual(["flying"]);
  clock.ms += 61 * 60_000;
  h.run(200);
  expect(mode(h, bob)).toBe(MODE_WALK);
});

test("a member whose group holds only Cheat.god loses god mode once it is revoked", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Gods", "Permissions.Grant Gods Cheat.god", "Permissions.Add bob Gods");
  expect(h.say(bob, "god")).toEqual(["god on"]);
  op(h, "Permissions.Revoke Gods Cheat.god");
  expect(god(h, bob)).toBe(false);
});

test("a member out of a group with Cheat.ghost and Cheat.possess has neither", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Spirits", "Permissions.Grant Spirits Cheat.ghost", "Permissions.Grant Spirits Cheat.possess", "Permissions.Add bob Spirits");
  const at = pos(h, bob);
  const { e } = creature(h, "raptor", { x: at.x + 4, z: at.z });
  look(h, bob, e);
  expect(h.say(bob, "possess")[0]).toStartWith("driving");
  op(h, "Permissions.Revoke Spirits Cheat.possess");
  expect(h.client(bob)!.drive).toBe(-1);
  expect(h.say(bob, "ghost")).toEqual(["ghost on"]);
  op(h, "Permissions.Remove bob Spirits");
  expect(mode(h, bob)).toBe(MODE_WALK);
});

test("cheats by the map's password end with the connection, flight and god mode too", () => {
  const h = new Harness({}, 1, 60, { adminPassword: "hunter2", ...quiet });
  const ada = h.join("ada");
  h.run(500);
  expect([h.say(ada, "enablecheats hunter2"), h.say(ada, "fly"), h.say(ada, "god")]).toEqual([["cheats enabled"], ["flying"], ["god on"]]);
  ada.close();
  h.run(1000);
  const back = h.join("ada");
  h.run(500);
  expect([back.state, back.admin, mode(h, back), god(h, back)]).toEqual(["active", false, MODE_WALK, false]);
});

test("a reconnect on a server with creative mode for all takes nothing away", () => {
  const h = new Harness({}, 1, 60, { config: asShipped(new Rules()), ...quiet });
  const ada = h.join("ada");
  h.run(500);
  expect([h.say(ada, "ghost"), h.say(ada, "god")]).toEqual([["ghost on"], ["god on"]]);
  ada.close();
  h.run(1000);
  const back = h.join("ada");
  h.run(500);
  expect([back.state, back.admin, mode(h, back), god(h, back)]).toEqual(["active", true, MODE_GHOST, true]);
});

test("a session with every cheat keeps its flight when an unrelated group changes", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Gods", "Permissions.Grant Gods *", "Permissions.Add bob Gods");
  expect(h.say(bob, "fly")).toEqual(["flying"]);
  op(h, "Permissions.AddGroup Vip", "Permissions.Grant Vip Cheat.kick", "Permissions.Revoke Vip Cheat.kick");
  expect(mode(h, bob)).toBe(MODE_FLY);
});
