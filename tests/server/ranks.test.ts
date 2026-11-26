// Ranks on the connection: what a session's rank lets it run, what each way in gives, and what a demotion takes away.
import { expect, test } from "bun:test";
import { demote } from "../../server/creative.ts";
import { Rules } from "../../server/settings/rules.ts";
import { idText } from "../../server/survivor-ids.ts";
import { WRONG_PASSWORD } from "../../shared/console.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF, mayEdit } from "../../shared/ranks.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { listener } from "../fixtures/module.ts";
import { Harness, asShipped } from "../fixtures/net.ts";

/** Adds a command that only `rank` and above may run, which answers "ran". */
function ranked(h: Harness, name: string, rank: number): void {
  h.host.console.add({ name, usage: "", help: "A test command.", admin: false, rank, run: () => "ran" });
}

const listed = (lines: string[] | string, name: string): boolean => (typeof lines === "string" ? lines : lines.join("\n")).split("\n").includes(name);

test("a session with cheats only is refused a command that needs an admin", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  ranked(h, "manage", RANK_ADMIN);
  const ada = h.join("ada");
  h.run(500);
  expect(h.say(ada, "enablecheats")).toEqual(["cheats enabled"]);
  expect(h.say(ada, "manage")).toEqual(["denied: this needs the admin rank or above"]);
  // Cheats at rank 0, as a test sets them by hand, still run what needs only cheats.
  const c = h.client(ada)!;
  c.rank = RANK_OPEN;
  expect(h.say(ada, "settime 6")).toEqual(["time is 06:00"]);
  c.rank = RANK_ADMIN;
  expect(h.say(ada, "manage")).toEqual(["ran"]);
});

test("help lists a command only to those who may run it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  ranked(h, "manage", RANK_ADMIN);
  const ada = h.join("ada");
  h.run(500);
  const plain = h.say(ada, "help");
  expect([listed(plain, "pos"), listed(plain, "god"), listed(plain, "manage")]).toEqual([true, false, false]);
  h.say(ada, "enablecheats");
  const cheats = h.say(ada, "help");
  expect([listed(cheats, "god"), listed(cheats, "manage")]).toEqual([true, false]);
  h.client(ada)!.rank = RANK_ADMIN;
  expect(listed(h.say(ada, "help"), "manage")).toBe(true);
  expect([listed(h.host.exec("help"), "manage"), h.host.exec("help manage")]).toEqual([true, "manage \nA test command. (admin rank)"]);
});

test("a creative-for-all session has its cheats again after it reconnects", () => {
  const h = new Harness({}, 1, 60, { config: asShipped(new Rules()) });
  const ada = h.join("ada");
  h.run(500);
  expect(ada.admin).toBe(true);
  ada.close();
  h.run(1000);
  // Back into the lingering body, and again over a session still open, as a device that lost its connection does.
  const back = h.join("ada");
  h.run(500);
  expect([back.state, back.admin, h.client(back)!.rank]).toEqual(["active", true, RANK_STAFF]);
  expect(h.say(back, "settime 6")).toEqual(["time is 06:00"]);
  const again = h.join("ada");
  h.run(500);
  expect([again.state, again.admin, h.client(again)!.rank]).toEqual(["active", true, RANK_STAFF]);
});

test("the map password raises a creative-for-all session to the map's rank", () => {
  const ears = listener("ears", ["session.admin"]);
  const h = new Harness({}, 1, 60, { adminPassword: "hunter2", config: asShipped(new Rules()), modules: [ears.def], log: () => {} });
  ranked(h, "manage", RANK_ADMIN);
  const ada = h.join("ada");
  h.run(500);
  const c = h.client(ada)!;
  expect([ada.admin, c.rank]).toEqual([true, RANK_STAFF]);
  expect(h.say(ada, "enablecheats nope")).toEqual([WRONG_PASSWORD]);
  expect(h.say(ada, "enablecheats hunter2")).toEqual(["cheats enabled"]);
  expect([c.rank, h.say(ada, "manage"), h.say(ada, "enablecheats hunter2")]).toEqual([RANK_MAP, ["ran"], ["cheats are already enabled"]]);
  // Modules heard of the cheats once, as it entered, and not of the raise.
  h.run(100);
  expect(ears.heard.lines).toEqual([`session.admin: {"pid":${c.pid}}`]);
  // Demoted, it is back where creative-for-all puts it, cheats and all.
  demote(h.host, c);
  expect([c.admin, c.rank, h.say(ada, "manage"), h.say(ada, "settime 6")]).toEqual([true, RANK_STAFF, ["denied: this needs the admin rank or above"], ["time is 06:00"]]);
});

test("a development server with no password gives cheats and no managing rank", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  ranked(h, "manage", RANK_ADMIN);
  const ada = h.join("ada");
  h.run(500);
  expect(h.client(ada)!.rank).toBe(RANK_OPEN);
  expect(h.say(ada, "enablecheats")).toEqual(["cheats enabled"]);
  expect([ada.admin, h.client(ada)!.rank, h.say(ada, "manage"), h.say(ada, "enablecheats")]).toEqual([
    true,
    RANK_STAFF,
    ["denied: this needs the admin rank or above"],
    ["cheats are already enabled"],
  ]);
});

test("a demoted session loses god mode, flight and what it possessed", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  const c = h.client(ada)!;
  expect([h.say(ada, "enablecheats"), h.say(ada, "god"), h.say(ada, "fly")]).toEqual([["cheats enabled"], ["god on"], ["flying"]]);
  c.rank = RANK_MAP;
  const ents = h.world.ents;
  const me = c.ent;
  const e = h.host.spawnCreature("core:raptor", ents.x[me]! + 4, ents.z[me]!, 1);
  expect(h.host.game.take(c, e)).toBe(true);
  const rec = h.host.records.byPid.get(c.pid)!;
  const god = h.world.reg.index.get("core:god")!;
  demote(h.host, c);
  expect([c.admin, c.rank, c.drive, ents.driven[e], ents.mode[me], h.host.buffs.has(rec, god)]).toEqual([false, RANK_OPEN, -1, 0, MODE_WALK, false]);
  h.run(300);
  expect([ada.admin, h.say(ada, "god")]).toEqual([false, ["denied: cheats are not enabled for you"]]);
});

test("a password's rank and a group's rank both count, and losing one keeps the other", () => {
  const h = new Harness({}, 1, 60, { adminPassword: "hunter2", log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  const c = h.client(ada)!;
  const id = idText(h.host.records.byPid.get(c.pid)!);
  c.signed = true;
  h.host.exec(`Permissions.Add ${id} Admins`);
  expect([c.admin, c.rank]).toEqual([true, RANK_ADMIN]);
  // The notice to claim a password arrives now, not among the next answer's lines.
  h.run(100);
  expect(h.say(ada, "enablecheats hunter2")).toEqual(["cheats enabled"]);
  expect(c.rank).toBe(RANK_MAP);
  // The password taken back, the group's rank and cheats stay.
  demote(h.host, c);
  expect([c.admin, c.rank]).toEqual([true, RANK_ADMIN]);
  // The group left, the password's stay.
  h.say(ada, "enablecheats hunter2");
  h.host.exec(`Permissions.Remove ${id} Admins`);
  expect([c.admin, c.rank]).toEqual([true, RANK_MAP]);
  demote(h.host, c);
  expect([c.admin, c.rank]).toEqual([false, RANK_OPEN]);
});

test("the operator runs a command of any rank", () => {
  const h = new Harness({}, 1, 60, {});
  ranked(h, "everything", RANK_CLUSTER);
  const ada = h.join("ada");
  h.run(500);
  expect([h.host.exec("everything"), h.host.console.rankOf({ host: h.host, client: null })]).toEqual(["ran", RANK_CLUSTER]);
  expect(h.say(ada, "everything")).toEqual(["denied: this needs the cluster rank or above"]);
});

test("an admin edits an admin, and nothing above itself", () => {
  expect([mayEdit(RANK_ADMIN, RANK_ADMIN), mayEdit(RANK_ADMIN, RANK_STAFF), mayEdit(RANK_ADMIN, RANK_MAP)]).toEqual([true, true, false]);
  expect([mayEdit(RANK_STAFF, RANK_OPEN), mayEdit(RANK_MAP, RANK_CLUSTER), mayEdit(RANK_CLUSTER, RANK_CLUSTER)]).toEqual([false, false, true]);
});
