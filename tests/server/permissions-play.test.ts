// Permission groups on whole servers: the Permissions commands, cheats by permission, standing that follows the groups at
// once, a change seen on another world of the cluster, and each change in the admin log.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR, sessionActor } from "../../server/acts.ts";
import { idText } from "../../server/survivor-ids.ts";
import { RESULT_OK, SESSION_SPECTATING, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { MODE_FLY, MODE_WALK } from "../../shared/sim/character.ts";
import { TestCluster, rec } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";
import type { Harness } from "../fixtures/net.ts";
import { camp, record, restart, survivor } from "../kit/kit.ts";

const quiet = { log: () => {} };
const idOf = (h: Harness, s: ClientSession): string => idText(record(h, s));
const lines = (said: string[]): string[] => said.join("\n").split("\n");

/** The operator's changes, each of which must be made: it is an act of the kind "change". */
function op(h: Harness, ...said: string[]): void {
  for (const line of said) {
    const before = h.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
    const out = h.host.exec(line);
    const after = h.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
    if (after.length !== before.length + 1 || after.at(-1)!.kind !== "change") throw new Error(`${line}: ${out}`);
  }
}

/** Makes `s` a member of Admins signed in with the password it claims, so it stands at the admin rank with every cheat. */
function admin(h: Harness, s: ClientSession): void {
  op(h, `Permissions.Add ${idOf(h, s)} Admins`);
  h.say(s, "claimpassword");
  if (h.say(s, `enablecheats ${s.secret}`)[0] !== "cheats enabled") throw new Error(`${s.name} did not sign in`);
}

test("an admin adds a survivor to a group by its ID and by its name, and groups shows it", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  const carl = survivor(h, "carl", { cheats: false });
  admin(h, ada);
  expect(h.client(ada)!.rank).toBe(RANK_ADMIN);
  expect(h.say(ada, "Permissions.AddGroup Vip")).toEqual(["made the group Vip"]);
  expect(h.say(ada, `Permissions.Add ${idOf(h, bob)} Vip`)).toEqual([`bob (${idOf(h, bob)}) is in Vip`]);
  expect(h.say(ada, "permissions.add carl vip")).toEqual([`carl (${idOf(h, carl)}) is in Vip`]);
  expect(h.host.acts.recent().at(-1)!.what).toBe(`Permissions.Add ${idOf(h, carl)} Vip`);
  expect(h.say(ada, "Permissions.Add dora Vip")).toEqual(['There is no survivor called "dora" on this map: give their ID.']);
  expect([h.say(bob, "groups"), h.say(carl, "groups")]).toEqual([["your groups: Vip, Default"], ["your groups: Vip, Default"]]);
  expect(lines(h.say(ada, "Permissions.PlayerGroups bob"))).toEqual([`bob (${idOf(h, bob)}):`, "Vip: for good"]);
  expect(lines(h.say(ada, "help Permissions.Add"))[0]).toBe("Permissions.Add <ID or name> <Group> [all]");
});

test("a group that holds Cheat.kick lets its member kick and run no other cheat", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  survivor(h, "carl", { cheats: false });
  op(h, "Permissions.AddGroup Bouncers", "Permissions.Grant Bouncers Cheat.kick", "Permissions.Add bob Bouncers");
  const help = lines(h.say(bob, "help"));
  expect([help.includes("kick <name>"), help.some((l) => l === "god" || l.startsWith("god "))]).toEqual([true, false]);
  expect([h.say(bob, "god"), h.say(bob, "fly")]).toEqual([["denied: cheats are not enabled for you"], ["denied: cheats are not enabled for you"]]);
  expect(h.say(bob, "kick carl")).toEqual(["kicked carl"]);
  expect(h.client(bob)!.admin).toBe(false);
});

test("ARK's own name for a command, as in Cheat.KickPlayer, gives the same", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  survivor(h, "carl", { cheats: false });
  op(h, "Permissions.AddGroup Bouncers", "Permissions.Grant Bouncers Cheat.KickPlayer", "Permissions.Add bob Bouncers");
  expect([h.say(bob, "kick carl"), h.say(bob, "god")]).toEqual([["kicked carl"], ["denied: cheats are not enabled for you"]]);
});

test("a staff group's cheats wait for the survivor's sign-in", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Mods", "Permissions.Rank Mods staff", "Permissions.Grant Mods *");
  expect(h.host.exec("Permissions.Add bob Mods")).toBe(
    `bob (${idOf(h, bob)}) is in Mods. It counts once they sign in with their own password, which they claim in game with claimpassword.`,
  );
  const c = h.client(bob)!;
  // Told how to come by the password, as the first line its session reads after.
  const told = "You are in a staff group. Claim your own password: open the console and type claimpassword.";
  expect([c.admin, c.rank, h.say(bob, "god"), h.say(bob, "groups")]).toEqual([false, RANK_OPEN, [told, "denied: cheats are not enabled for you"], ["your groups: Default"]]);
  // The next step's sign-in sets this and works the standing out.
  c.signed = true;
  h.host.creative.stand(c);
  expect([c.admin, c.rank, h.say(bob, "god"), h.say(bob, "groups")]).toEqual([true, RANK_STAFF, ["god on"], ["your groups: Mods, Default"]]);
});

test("a member taken out of a group loses its cheats, god mode and flight at once", () => {
  const ears = listener("ears", ["session.admin"]);
  const { h } = camp({ host: { modules: [ears.def], ...quiet } });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Gods", "Permissions.Grant Gods *", "Permissions.Add bob Gods");
  const c = h.client(bob)!;
  expect([c.admin, h.say(bob, "god"), h.say(bob, "fly")]).toEqual([true, ["god on"], ["flying"]]);
  op(h, "Permissions.Remove bob Gods");
  const god = h.world.reg.index.get("core:god")!;
  expect([c.admin, h.world.ents.mode[c.ent], h.host.buffs.has(record(h, bob), god)]).toEqual([false, MODE_WALK, false]);
  h.run(300);
  expect([bob.admin, h.say(bob, "god")]).toEqual([false, ["denied: cheats are not enabled for you"]]);
  // Spectating, which is for admins here, ends with them too.
  op(h, "Permissions.Add bob Gods");
  expect(h.say(bob, "spectate")[0]).toStartWith("spectating");
  op(h, "Permissions.Remove bob Gods");
  expect(c.state).not.toBe(SESSION_SPECTATING);
  // Modules heard of the cheats each time they were given, and only then.
  h.run(100);
  expect(ears.heard.lines.filter((l) => l.includes(`"pid":${c.pid}}`)).length).toBe(2);
});

test("a change made on one world reaches a session on another within the poll", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const host = { survivorLog: { wall: () => clock.ms }, ...quiet };
    const a = cluster.server("a", "f", clock, { host });
    const b = cluster.server("b", "f", clock, { host });
    const { session: bob } = cluster.survivor(b, "bob");
    const id = idText(rec(b, "bob")!);
    op(a.h, "Permissions.AddGroup Builders", "Permissions.Grant Builders *");
    expect(a.h.host.exec(`Permissions.Add ${id} Builders all`)).toBe(`bob (${id}) is in Builders on every map. bob is on another map, ${b.h.host.cluster!.serverName(b.world)}.`);
    b.h.run(500);
    expect([b.h.client(bob)!.admin, b.h.say(bob, "groups")]).toEqual([false, ["your groups: Default"]]);
    clock.ms += 5000;
    b.h.run(200);
    expect([b.h.client(bob)!.admin, b.h.say(bob, "groups"), b.h.say(bob, "god")]).toEqual([true, ["your groups: Builders, Default"], ["god on"]]);
    // An open group's membership holds on every map without all, as ArkApi's did.
    op(a.h, `Permissions.Remove ${id} Builders`, `Permissions.Add ${id} Builders`);
    clock.ms += 5000;
    b.h.run(200);
    expect(b.h.client(bob)!.admin).toBe(true);
    // A staff group's, made without all, holds on its own map only.
    op(a.h, `Permissions.Remove ${id} Builders`, "Permissions.Rank Builders staff", `Permissions.Add ${id} Builders`);
    b.h.client(bob)!.signed = true;
    clock.ms += 5000;
    b.h.run(200);
    expect(b.h.client(bob)!.admin).toBe(false);
    expect(lines(b.h.say(bob, "help")).includes("Permissions.ListGroups")).toBe(false);
    expect(a.h.host.exec(`Permissions.PlayerGroups ${id}`)).toBe(`bob (${id}):\nBuilders: for good, on this map (${a.world})`);
  } finally {
    cluster.cleanup();
  }
});

test("in a cluster a map's admin manages members but cannot change a group", () => {
  const cluster = new TestCluster();
  try {
    const a = cluster.server("a", "f", { ms: 1_000_000 }, { host: quiet });
    const { session: ada } = cluster.survivor(a, "ada");
    const { session: bob } = cluster.survivor(a, "bob");
    admin(a.h, ada);
    op(a.h, "Permissions.AddGroup Vip");
    const refused = "In a cluster, only the cluster's admins change groups and chat settings.";
    for (const line of ["Permissions.Revoke Admins *", "Permissions.Grant Default *", "Permissions.Rank Admins open", "Permissions.AddGroup Mods", "Permissions.RemoveGroup Vip"]) {
      expect([line, a.h.say(ada, line)]).toEqual([line, [refused]]);
    }
    a.h.say(ada, "Permissions.Add bob Vip");
    expect(a.h.host.permissions.membersIn("Vip").map((m) => m.key)).toEqual([idOf(a.h, bob)]);
    // The cluster's own rank cannot open Admins either while ada is in it.
    expect(a.h.host.exec("Permissions.Rank Admins open")).toBe("A group's rank changes only while it has no members. Take them out first.");
    expect([a.h.host.permissions.group("Admins"), a.h.host.permissions.group("Default")?.permissions, a.h.client(ada)!.rank]).toEqual([
      { name: "Admins", rank: RANK_ADMIN, permissions: ["*"], chat: "" },
      [],
      RANK_ADMIN,
    ]);
    a.h.say(ada, "Permissions.Remove bob Vip");
    expect(a.h.host.permissions.membersIn("Vip")).toEqual([]);
  } finally {
    cluster.cleanup();
  }
});

test("every change is an act that names who made it and reads as the command", () => {
  const ears = listener("ears", ["perm.changed"]);
  const { h, ada } = camp({ host: { modules: [ears.def], ...quiet } });
  const bob = survivor(h, "bob", { cheats: false });
  admin(h, ada);
  const [me, him] = [idOf(h, ada), idOf(h, bob)];
  for (const line of ["Permissions.AddGroup Vip", "Permissions.Grant Vip Cheat.kick", "Permissions.Add bob Vip", "Permissions.AddTimed bob Vip 2 0.5", "Permissions.RemoveTimed bob Vip", "Permissions.Revoke Vip Cheat.kick"]) h.say(ada, line);
  // A refused change is no change: it is logged as refused.
  expect(h.say(ada, "Permissions.Grant Nobody Cheat.kick")).toEqual(["There is no group Nobody."]);
  const changes = h.host.acts.recent().filter((a) => a.kind === "change").map((a) => [a.name, a.id, a.rank, a.what]);
  expect(changes).toEqual([
    ["(operator)", "", RANK_CLUSTER, `Permissions.Add ${me} Admins`],
    ["ada", me, RANK_STAFF, "claimed their own password"],
    ["ada", me, RANK_ADMIN, "Permissions.AddGroup Vip"],
    ["ada", me, RANK_ADMIN, "Permissions.Grant Vip Cheat.kick"],
    ["ada", me, RANK_ADMIN, `Permissions.Add ${him} Vip`],
    ["ada", me, RANK_ADMIN, `Permissions.AddTimed ${him} Vip 2 0.5`],
    ["ada", me, RANK_ADMIN, `Permissions.RemoveTimed ${him} Vip`],
    ["ada", me, RANK_ADMIN, "Permissions.Revoke Vip Cheat.kick"],
  ]);
  const told = lines(h.say(ada, "acts 2"));
  expect(told.map((l) => l.replace(/^\S+ \S+ UTC {2}/, ""))).toEqual([`ada ${me}  admin  change: Permissions.Revoke Vip Cheat.kick`, `ada ${me}  admin  refused: Permissions.Grant Nobody Cheat.kick: There is no group Nobody.`]);
  expect(h.say(bob, "acts")).toEqual(["denied: this needs the admin rank or above"]);
  h.run(100);
  expect(ears.heard.lines.slice(0, 5)).toEqual([
    `perm.changed: {"account":"${me}","group":"Admins"}`,
    `perm.changed: {"account":"${me}","group":""}`,
    'perm.changed: {"account":"","group":"Vip"}',
    'perm.changed: {"account":"","group":"Vip"}',
    `perm.changed: {"account":"${him}","group":"Vip"}`,
  ]);
});

test("a regular admin cannot add to, or remove from, a group of the map's rank", () => {
  const { h, ada } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  survivor(h, "carl", { cheats: false });
  admin(h, ada);
  op(h, "Permissions.AddGroup Owners", "Permissions.Rank Owners map", "Permissions.Add carl Owners", "Permissions.AddGroup Vip", "Permissions.Add carl Vip");
  expect(h.say(ada, "Permissions.Add bob Owners")).toEqual(["That needs the map rank."]);
  expect(h.say(ada, "Permissions.Remove carl Owners")).toEqual(["That needs the map rank."]);
  expect(h.say(ada, "Permissions.Grant Owners Cheat.kick")).toEqual(["That needs the map rank."]);
  // Nor touch a map admin through an open group.
  expect(h.say(ada, "Permissions.Remove carl Vip")).toEqual(["That survivor holds a higher rank than yours."]);
  expect(h.say(ada, "Permissions.Add bob Vip")).toEqual([`bob (${idOf(h, bob)}) is in Vip`]);
});

test("a session with cheats only cannot run a Permissions command", () => {
  const { h, ada } = camp({ host: quiet });
  expect([h.client(ada)!.admin, h.client(ada)!.rank]).toEqual([true, RANK_STAFF]);
  expect(h.say(ada, "Permissions.AddGroup Vip")).toEqual(["denied: this needs the admin rank or above"]);
  expect(h.say(ada, "permissions.listgroups")).toEqual(["denied: this needs the admin rank or above"]);
  expect(lines(h.say(ada, "help")).some((l) => l.startsWith("Permissions."))).toBe(false);
  expect(h.host.permissions.group("Vip")).toBeUndefined();
});

test("cheat and admincheat run the line that follows them, with the same checks", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  expect(h.say(bob, "cheat fly")).toEqual(["denied: cheats are not enabled for you"]);
  op(h, "Permissions.AddGroup Fliers", "Permissions.Grant Fliers Cheat.fly", "Permissions.Add bob Fliers");
  expect(h.say(bob, "cheat fly")).toEqual(["flying"]);
  expect(h.say(bob, "admincheat god")).toEqual(["denied: cheats are not enabled for you"]);
  expect(h.say(bob, "cheat cheat fly")).toEqual(["cheat runs a command, not another cheat"]);
  expect(h.say(bob, "admincheat Permissions.ListGroups")).toEqual(["denied: this needs the admin rank or above"]);
  expect(h.say(bob, 'cheat id "bob"')).toEqual(["denied: only admins see another survivor's ID"]);
});

test("a timed membership shows its time left and ends", () => {
  const clock = { ms: 1_000_000_000 };
  const { h } = camp({ host: { survivorLog: { wall: () => clock.ms }, ...quiet } });
  const bob = survivor(h, "bob", { cheats: false });
  const label = `bob (${idOf(h, bob)})`;
  op(h, "Permissions.AddGroup Vip", "Permissions.Grant Vip *");
  expect(h.host.exec("Permissions.AddTimed bob Vip 2 0")).toBe(`${label} is in Vip for 2 h`);
  expect([h.client(bob)!.admin, h.host.exec("Permissions.PlayerGroups bob")]).toEqual([true, `${label}:\nVip: 2 h 0 min left`]);
  clock.ms += 90 * 60_000;
  expect(h.host.exec("Permissions.PlayerGroups bob")).toBe(`${label}:\nVip: 30 min left`);
  clock.ms += 31 * 60_000;
  h.run(200);
  expect([h.client(bob)!.admin, h.say(bob, "groups"), h.host.exec("Permissions.PlayerGroups bob")]).toEqual([false, ["your groups: Default"], `${label} is in no group but Default.`]);
});

test("a world with no save keeps its groups in memory", () => {
  const { h } = camp({ host: quiet });
  expect(h.host.persistence).toBeNull();
  op(h, "Permissions.AddGroup Vip", "Permissions.Grant Vip ArkShop.Kits.vip");
  expect(h.host.exec("Permissions.ListGroups")).toBe("Default (open): nothing\nAdmins (admin): *\nVip (open): ArkShop.Kits.vip");
  expect(h.host.exec("Permissions.GroupPermissions vip")).toBe("Vip (open) holds ArkShop.Kits.vip");
});

test("a saved world keeps its groups beside its save through a restart", () => {
  const { h, ada } = camp({ save: true, host: quiet });
  const id = idOf(h, ada);
  op(h, "Permissions.AddGroup Vip", `Permissions.Add ${id} Vip`);
  expect(existsSync(`${h.host.persistence!.store.path}.permissions.sqlite`)).toBe(true);
  ada.close();
  h.run(200);
  const next = restart(h);
  expect(next.host.exec(`Permissions.PlayerGroups ${id}`)).toBe(`ada (${id}):\nVip: for good`);
  const back = survivor(next, "ada", { cheats: false });
  expect(next.say(back, "groups")).toEqual(["your groups: Vip, Default"]);
});

test("a moderator's kick is kept, printed and listed by acts", () => {
  const said: string[] = [];
  const { h } = camp({ host: { log: (line) => said.push(line) } });
  const bob = survivor(h, "bob", { cheats: false });
  survivor(h, "carl", { cheats: false });
  op(h, "Permissions.AddGroup Mods", "Permissions.Rank Mods staff", "Permissions.Grant Mods Cheat.kick", "Permissions.Add bob Mods");
  h.say(bob, "claimpassword");
  expect(h.say(bob, `enablecheats ${bob.secret}`)).toEqual(["cheats enabled"]);
  expect(h.say(bob, "kick carl")).toEqual(["kicked carl"]);
  const act = h.host.acts.recent().at(-1)!;
  expect([act.name, act.id, act.rank, act.open, act.what]).toEqual(["bob", idOf(h, bob), RANK_STAFF, false, "kick carl"]);
  expect(said).toContain("admin: bob (staff rank) kick carl");
  expect(h.host.exec("acts 1")).toEndWith(`bob ${idOf(h, bob)}  staff  kick carl`);
});

test("an open group's perk is open, and left out of the latest acts", () => {
  const { h } = camp({ host: quiet });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Flyers", "Permissions.Grant Flyers Cheat.fly", "Permissions.Add bob Flyers");
  expect(h.say(bob, "fly")[0]).toStartWith("fly");
  expect(h.host.acts.recent().some((a) => a.name === "bob")).toBe(false);
  const act = h.host.acts.recentWithOpen().at(-1)!;
  expect([act.name, act.rank, act.open, act.what]).toEqual(["bob", RANK_OPEN, true, "fly"]);
});

test("a signed-in admin is not open, also under creative mode for all", () => {
  const { h } = camp({ host: quiet });
  expect([h.host.setSetting("bShowCreativeMode", "True"), h.host.setSetting("CreativeForAll", "True")]).toEqual(["", ""]);
  const bob = survivor(h, "bob", { cheats: false });
  h.run(100);
  expect(h.client(bob)!.admin).toBe(true);
  h.say(bob, "settime 6");
  admin(h, bob);
  h.say(bob, "settime 7");
  const his = h.host.acts.recentWithOpen().filter((a) => a.name === "bob" && a.kind === "command").map((a) => [a.rank, a.open, a.what]);
  expect(his).toEqual([[RANK_STAFF, true, "settime 6"], [RANK_ADMIN, false, "settime 7"]]);
  expect(h.host.acts.recent().filter((a) => a.name === "bob").map((a) => a.what)).toEqual(["claimed their own password", "enablecheats with their own password", "settime 7"]);
});

test("an admin refused above their rank is logged, one below admin is not", () => {
  const said: string[] = [];
  const { h, ada } = camp({ host: { log: (line) => said.push(line) } });
  const bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Owners", "Permissions.Rank Owners map", "Permissions.AddGroup Mods", "Permissions.Rank Mods staff", `Permissions.Add ${idOf(h, bob)} Mods`);
  admin(h, ada);
  expect(h.say(ada, "Permissions.Grant Owners Cheat.fly")).toEqual(["That needs the map rank."]);
  const act = h.host.acts.recent().at(-1)!;
  expect([act.name, act.rank, act.kind, act.open, act.what]).toEqual(["ada", RANK_ADMIN, "refused", false, "Permissions.Grant Owners Cheat.fly: That needs the map rank."]);
  expect(said).toContain("admin: ada (admin rank) refused: Permissions.Grant Owners Cheat.fly: That needs the map rank.");
  h.say(bob, "claimpassword");
  h.say(bob, `enablecheats ${bob.secret}`);
  expect(h.client(bob)!.rank).toBe(RANK_STAFF);
  const before = h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER).length;
  expect(h.say(bob, "Permissions.AddGroup Vip")).toEqual(["denied: this needs the admin rank or above"]);
  expect(h.host.changePermissions(sessionActor(h.client(bob)!, h.host.records), { op: "addGroup", group: "Vip" })).toBe("Permissions are managed from an admin's rank.");
  expect(h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER).length).toBe(before);
});

test("a command typed with a line break cannot write a line that reads as another's act", () => {
  const out: string[] = [];
  const { h } = camp({ host: { log: (l: string) => out.push(l) } });
  const mod = survivor(h, "mod", { cheats: false });
  survivor(h, "carl", { cheats: false });
  op(h, "Permissions.AddGroup Mods", "Permissions.Rank Mods staff", "Permissions.Grant Mods Cheat.kick", `Permissions.Add ${idOf(h, mod)} Mods`);
  h.say(mod, "claimpassword");
  expect(h.say(mod, `enablecheats ${mod.secret}`)[0]).toBe("cheats enabled");
  const forged = "2026-11-25 09:00:00 UTC  (operator)  cluster  kick ada";
  h.say(mod, `kick x\n${forged}\u202e\u0007`);
  const act = h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).at(-1)!;
  // Spaces run together too, so nothing lines up as the listing's columns do.
  expect([act.name, act.what]).toEqual(["mod", `kick x ${forged.replace(/ +/g, " ")}`]);
  // One act is one line, in the listing and in the server's own output.
  expect(lines([h.host.exec("acts 3")]).filter((l) => l.includes("kick ada")).length).toBe(1);
  expect(lines(out).filter((l) => l.includes("kick ada"))).toEqual([`admin: mod (staff rank) kick x ${forged.replace(/ +/g, " ")}`]);
});

test("a regular admin cannot reach a map admin through the map admin's tribe", () => {
  const { h, ada } = camp({ host: quiet });
  const cara = survivor(h, "cara", { cheats: false });
  const dan = survivor(h, "dan", { cheats: false });
  op(h, "Permissions.AddGroup Top", "Permissions.Rank Top map", "Permissions.Grant Top *", `Permissions.Add ${idOf(h, cara)} Top`, "Permissions.AddGroup Muted", "Permissions.AddGroup Vip");
  admin(h, ada);
  h.say(cara, "claimpassword");
  expect(h.say(cara, `enablecheats ${cara.secret}`)[0]).toBe("cheats enabled");
  expect([h.client(ada)!.rank, h.client(cara)!.rank]).toEqual([RANK_ADMIN, RANK_MAP]);
  expect(h.say(cara, 'tribe create "Cara Co"')[0]).toStartWith("You founded");
  expect(h.say(dan, 'tribe create "Dan Co"')[0]).toStartWith("You founded");
  const [hers, his] = [String(record(h, cara).team), String(record(h, dan).team)];
  const HIGHER = "A member of that tribe holds a higher rank than yours.";
  expect(h.say(ada, `Permissions.AddTribe ${hers} Muted`)).toEqual([HIGHER]);
  expect(h.host.chat.say(h.client(cara)!, TEXT_GLOBAL, "hello")).toBe(RESULT_OK);
  // The operator may, and then the regular admin cannot take the tribe out either. A tribe of none above her is hers.
  op(h, `Permissions.AddTribe ${hers} Vip`);
  expect(h.say(ada, `Permissions.RemoveTribe ${hers} Vip`).at(-1)).toBe(HIGHER);
  expect(h.say(ada, `Permissions.AddTribe ${his} Vip`)).toEqual([`Dan Co (${his}) is in Vip`]);
});

test("a tag choice that changes nothing writes nothing, and a run of changes is cut short", () => {
  const { h } = camp({ host: quiet });
  let bob = survivor(h, "bob", { cheats: false });
  op(h, "Permissions.AddGroup Vip", `Permissions.Add ${idOf(h, bob)} Vip`);
  expect(h.host.changePermissions(OPERATOR, { op: "setDocument", name: "chat", text: JSON.stringify({ ChatTags: { Vip: { Text: "[VIP]" } } }) })).toBe("");
  const p = h.host.permissions;
  const before = p.snapshot().revision;
  // Shown already: nothing is written, however often it is said.
  for (let i = 0; i < 8; i++) expect(h.say(bob, "enabletag Vip")).toEqual(["Your lines show the tag Vip."]);
  expect(p.snapshot().revision).toBe(before);
  // Off, on and off again are taken, and the fourth change in a row is turned away until a little time has passed.
  expect(h.say(bob, "disabletag Vip")).toEqual(["Your lines no longer show the tag Vip."]);
  expect(h.say(bob, "enabletag Vip")).toEqual(["Your lines show the tag Vip."]);
  expect(h.say(bob, "disabletag Vip")).toEqual(["Your lines no longer show the tag Vip."]);
  expect(h.say(bob, "enabletag Vip")).toEqual(["You changed your tags a moment ago. Try again shortly."]);
  expect(p.snapshot().revision).toBe(before + 3);
  // The wait is the survivor's, not the connection's: leaving and coming back does not shorten it.
  bob.close();
  h.run(200);
  const back = h.join("bob");
  h.run(500);
  expect(h.say(back, "enabletag Vip")).toEqual(["You changed your tags a moment ago. Try again shortly."]);
  expect(p.snapshot().revision).toBe(before + 3);
  bob = back;
  h.run(11_000);
  expect(h.say(bob, "enabletag Vip")).toEqual(["Your lines show the tag Vip."]);
  expect(p.snapshot().revision).toBe(before + 4);
});

test("creative mode for all switched off takes its cheats at once, with what they left running", () => {
  const { h } = camp({ host: quiet });
  h.host.exec("setting bShowCreativeMode True");
  h.host.exec("setting CreativeForAll True");
  h.run(100);
  const bob = survivor(h, "bob", { cheats: false });
  const c = h.client(bob)!;
  expect([c.admin, h.say(bob, "fly")]).toEqual([true, ["flying"]]);
  h.host.exec("setting CreativeForAll False");
  h.run(100);
  expect([c.admin, h.world.ents.mode[c.ent] === MODE_FLY]).toEqual([false, false]);
});

test("an import some of whose changes are refused says so in the log", () => {
  const { h } = camp({ host: quiet });
  op(h, "Permissions.AddGroup Council", "Permissions.Rank Council cluster");
  // Outside a cluster the map's rank imports, and it does not reach a group of the cluster's rank.
  const by = { ...OPERATOR, name: "(kody)", rank: RANK_MAP, baseRank: RANK_MAP, via: "page" as const };
  const plan = { ops: [{ op: "addGroup", group: "Vip" }, { op: "grant", group: "Council", permission: "Kit.gold" }, { op: "grant", group: "Council", permission: "Kit.red" }] as const, notes: [], seen: [] };
  const done = h.host.importPermissions(by, "a list of Permissions commands", plan);
  expect([done.why, done.done, done.refused.length]).toEqual(["", 1, 2]);
  const acts = h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).slice(-2);
  expect(acts.map((a) => [a.name, a.kind, a.rank, a.what])).toEqual([
    ["(kody)", "change", RANK_MAP, "imported a list of Permissions commands: 1 change"],
    ["(kody)", "refused", RANK_MAP, "2 of the import's 3 changes, the first Permissions.Grant Council Kit.gold: That needs the cluster rank."],
  ]);
});
