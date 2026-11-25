import { expect, test } from "bun:test";
import { idOf } from "../../shared/ids.ts";
import {
  arkCommand,
  commandPermission,
  editRule,
  holds,
  mayRunCommand,
  type PermissionActor,
  type PermissionOp,
  type RuleLook,
} from "../../shared/permissions/model.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { CLAIM_WAIT_MS, Permissions, POLL_MS, type PermissionSubject } from "../../server/permissions/permissions.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { issue } from "../fixtures/permissions.ts";

const HOUR = 3600 * 1000;
const A = idOf(3, 1);
const B = idOf(3, 2);
/** Never issued. */
const C = idOf(3, 3);
const cluster: PermissionActor = { rank: RANK_CLUSTER, world: 3, name: "cluster" };
const mapAdmin: PermissionActor = { rank: RANK_MAP, world: 3, name: "map" };
const admin: PermissionActor = { rank: RANK_ADMIN, world: 3, name: "admin" };
/** The same actor on a world that is in no cluster. */
const outside = (actor: PermissionActor): PermissionActor => ({ ...actor, world: 0 });

function world(world = 3, start = 1_000_000) {
  const clock = { t: start };
  const perms = new Permissions({ store: new PermissionStore(":memory:"), world, now: () => clock.t });
  issue(perms, A, B, "7", "42");
  const ok = (op: PermissionOp, actor: PermissionActor = cluster): void => expect(perms.apply(actor, op)).toBe("");
  return { perms, clock, ok };
}

const who = (id: string, over: Partial<PermissionSubject> = {}): PermissionSubject => ({ id, team: 0, signed: false, world: 3, ...over });
const names = (perms: Permissions, s: PermissionSubject): string[] => perms.groupsOf(s).map((g) => g.name);

test("a star, the same string in any case and a prefix entry all hold", () => {
  expect(holds(["*"], "ArkShop.Kits.vip")).toBe(true);
  expect(holds(["arkshop.kits.VIP"], "ArkShop.Kits.vip")).toBe(true);
  expect(holds(["Cheat.*"], "cheat.give")).toBe(true);
  expect(holds(["ArkShop.*"], "ArkShop.Kits.vip")).toBe(true);
  expect(holds(["Cheat.*"], "Cheat")).toBe(false);
  expect(holds(["Cheat.give"], "Cheat.giveall")).toBe(false);
  expect(holds([], "Cheat.give")).toBe(false);
});

test("ARK's cheat names stand for this game's commands", () => {
  expect(arkCommand("KickPlayer")).toBe("kick");
  expect(arkCommand("SetTimeOfDay")).toBe("settime");
  expect(arkCommand("GiveItemNum")).toBe("give");
  expect(arkCommand("Ghost")).toBe("ghost");
  expect(commandPermission("kick")).toBe("Cheat.kick");
  expect(mayRunCommand(["Cheat.KickPlayer"], "kick")).toBe(true);
  expect(mayRunCommand(["Cheat.SaveWorld", "Cheat.TeleportToPos"], "tp")).toBe(true);
  expect(mayRunCommand(["Cheat.SpawnDino"], "spawn")).toBe(true);
  expect(mayRunCommand(["Cheat.kick"], "KickPlayer")).toBe(true);
  expect(mayRunCommand(["Cheat.kick"], "give")).toBe(false);
  expect(mayRunCommand(["Cheat.*"], "addxp")).toBe(true);
});

test("a survivor's groups are its own, its tribe's and Default", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addGroup", group: "Builders" });
  ok({ op: "grant", group: "Builders", permission: "Build.fast" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "addMember", kind: "tribe", key: "42", group: "builders" });
  expect(names(perms, who(A, { team: 42 }))).toEqual(["Vip", "Builders", "Default"]);
  expect(names(perms, who(B))).toEqual(["Default"]);
  expect(perms.has(who(B, { team: 42 }), "build.FAST")).toBe(true);
  expect(perms.has(who(B), "Build.fast")).toBe(false);
  expect(perms.inGroup(who(A), "VIP")).toBe(true);
});

test("Default's permissions reach everyone", () => {
  const { perms, ok } = world();
  ok({ op: "grant", group: "Default", permission: "Chat.global" });
  expect(perms.has(who(B), "chat.global")).toBe(true);
  expect(perms.rankOf(who(B))).toBe(RANK_OPEN);
});

test("a staff group counts only after sign-in and only on its world", () => {
  const { perms, ok } = world();
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins", world: 3 });
  expect(perms.has(who(A), "Cheat.give")).toBe(false);
  expect(perms.rankOf(who(A))).toBe(RANK_OPEN);
  expect(perms.has(who(A, { signed: true }), "Cheat.give")).toBe(true);
  expect(perms.mayRun(who(A, { signed: true }), "GiveItem")).toBe(true);
  expect(perms.rankOf(who(A, { signed: true }))).toBe(RANK_ADMIN);
  expect(perms.has(who(A, { signed: true, world: 4 }), "Cheat.give")).toBe(false);
  expect(perms.staffRank(A)).toBe(RANK_ADMIN);
  expect(perms.staffRank(B)).toBe(RANK_OPEN);
});

test("an open group's membership counts on every world, whatever was said", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: B, group: "Vip", world: 5 });
  expect(perms.inGroup(who(A, { world: 9 }), "Vip")).toBe(true);
  expect(perms.inGroup(who(B, { world: 5 }), "Vip")).toBe(true);
  expect(perms.inGroup(who(B, { world: 3 }), "Vip")).toBe(true);
});

test("a timed membership waits out its delay, runs, then ends", () => {
  const { perms, clock, ok } = world();
  ok({ op: "addGroup", group: "Muted" });
  const start = clock.t;
  ok({ op: "addMember", kind: "survivor", key: A, group: "Muted", hours: 2, delayHours: 1 });
  expect(perms.inGroup(who(A), "Muted")).toBe(false);
  clock.t = start + HOUR;
  expect(perms.inGroup(who(A), "Muted")).toBe(true);
  clock.t = start + 3 * HOUR - 1;
  expect(perms.inGroup(who(A), "Muted")).toBe(true);
  clock.t = start + 3 * HOUR;
  expect(perms.inGroup(who(A), "Muted")).toBe(false);
});

test("a timed membership starting or ending makes poll report a change", () => {
  const { perms, clock, ok } = world();
  ok({ op: "addGroup", group: "Muted" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Muted", hours: 1, delayHours: 1 });
  clock.t += POLL_MS;
  perms.poll();
  expect(perms.poll()).toBe(false);
  const v = perms.version;
  clock.t += HOUR;
  expect(perms.poll()).toBe(true);
  expect(perms.version).toBeGreaterThan(v);
  clock.t += HOUR;
  expect(perms.poll()).toBe(true);
  expect(perms.poll()).toBe(false);
});

test("adding hours to a running membership adds them to what is left", () => {
  const { perms, clock, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  const start = clock.t;
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 2 });
  clock.t = start + HOUR;
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 3, delayHours: 5 });
  clock.t = start + 5 * HOUR - 1;
  expect(perms.inGroup(who(A), "Vip")).toBe(true);
  clock.t = start + 5 * HOUR;
  expect(perms.inGroup(who(A), "Vip")).toBe(false);
});

test("a membership that ran out is cleared at the next write", () => {
  const { perms, clock, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 1 });
  clock.t += 2 * HOUR;
  expect(perms.membersOf("survivor", A).length).toBe(1);
  ok({ op: "addGroup", group: "Other" });
  expect(perms.membersOf("survivor", A)).toEqual([]);
});

test("removing only the timed part keeps a membership for good", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 1 });
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Vip", timedOnly: true });
  expect(perms.inGroup(who(A), "Vip")).toBe(true);
  expect(perms.apply(cluster, { op: "removeMember", kind: "survivor", key: A, group: "Vip", timedOnly: true })).not.toBe("");
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Vip" });
  expect(perms.inGroup(who(A), "Vip")).toBe(false);
  expect(perms.apply(cluster, { op: "removeMember", kind: "survivor", key: A, group: "Vip" })).not.toBe("");
});

test("an actor below admin manages nothing, but a tag choice needs no rank", () => {
  const { perms } = world();
  const staff: PermissionActor = { rank: RANK_STAFF, world: 3, name: "staff" };
  expect(perms.apply(staff, { op: "addGroup", group: "Vip" })).not.toBe("");
  expect(perms.apply({ rank: RANK_OPEN, world: 3, name: A }, { op: "tag", id: A, tag: "Admin", show: false })).toBe("");
  expect(perms.tagChoice(A, "admin")).toBe(false);
  expect(perms.tagChoice(B, "admin")).toBeUndefined();
});

test("an actor edits groups of its own rank and below", () => {
  const { perms, ok } = world(0);
  const [admin0, map0] = [outside(admin), outside(mapAdmin)];
  expect(perms.apply(admin0, { op: "addGroup", group: "Mods", rank: RANK_MAP })).not.toBe("");
  ok({ op: "addGroup", group: "Mods", rank: RANK_MAP });
  expect(perms.apply(admin0, { op: "grant", group: "Mods", permission: "Cheat.kick" })).not.toBe("");
  expect(perms.apply(admin0, { op: "removeGroup", group: "Mods" })).not.toBe("");
  expect(perms.apply(admin0, { op: "setChat", group: "Mods", chat: "{}" })).not.toBe("");
  expect(perms.apply(map0, { op: "grant", group: "Mods", permission: "Cheat.kick" })).toBe("");
  expect(perms.group("mods")?.permissions).toEqual(["Cheat.kick"]);
  ok({ op: "addGroup", group: "Helpers" }, admin0);
  expect(perms.apply(admin0, { op: "setRank", group: "Helpers", rank: RANK_MAP })).not.toBe("");
  expect(perms.apply(map0, { op: "setRank", group: "Mods", rank: RANK_OPEN })).toBe("");
  expect(perms.apply(admin0, { op: "setRank", group: "Mods", rank: RANK_STAFF })).toBe("");
});

test("a cluster group is for every world and only the cluster edits it", () => {
  const { perms, ok } = world();
  expect(perms.apply(outside(mapAdmin), { op: "addGroup", group: "Owners", rank: RANK_CLUSTER })).toBe("That needs the cluster rank.");
  ok({ op: "addGroup", group: "Owners", rank: RANK_CLUSTER });
  expect(perms.apply(mapAdmin, { op: "addMember", kind: "survivor", key: A, group: "Owners" })).not.toBe("");
  ok({ op: "addMember", kind: "survivor", key: A, group: "Owners" });
  expect(perms.membersOf("survivor", A)[0]?.world).toBe(0);
});

test("a cluster group's membership is kept for every world, whatever world was said", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Owners", rank: RANK_CLUSTER });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Owners", world: 3 });
  expect(perms.membersOf("survivor", A).map((m) => m.world)).toEqual([0]);
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Owners", world: 3 });
  expect(perms.membersOf("survivor", A)).toEqual([]);
});

test("below cluster rank a password is cleared for staff of the admin's own map", () => {
  const { perms, ok } = world();
  const far: PermissionActor = { rank: RANK_MAP, world: 4, name: "map of 4" };
  const farAdmin: PermissionActor = { rank: RANK_ADMIN, world: 4, name: "admin of 4" };
  const hash = (x: string): string => x.repeat(32);
  const claimed = (id: string, x: string): void => expect(perms.claim(id, hash(x), "").why).toBe("");
  // A is staff on world 3 alone: nobody of world 4 below the cluster's rank clears her password.
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins", world: 3 });
  claimed(A, "a1");
  expect(perms.apply(far, { op: "clearSecret", id: A })).toBe("That survivor's staff groups are on other maps. An admin there or the cluster's clears their password.");
  expect(perms.apply(admin, { op: "clearSecret", id: A })).toBe("");
  // B is staff on every world: world 4's regular admin, her equal, does not, and its map admin, who outranks her, does.
  ok({ op: "addMember", kind: "survivor", key: B, group: "Admins", world: 0 });
  claimed(B, "b2");
  expect(perms.apply(farAdmin, { op: "clearSecret", id: B })).toBe("That survivor's staff groups reach beyond this map. A higher rank or the cluster's admin clears their password.");
  expect(perms.secretOf(B)).toBe(hash("b2"));
  expect(perms.apply(far, { op: "clearSecret", id: B })).toBe("");
  // One left with a password and no staff group is anyone's to clear, and the cluster's admin is held to no map.
  claimed(A, "c3");
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Admins" });
  expect(perms.apply(farAdmin, { op: "clearSecret", id: A })).toBe("");
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins", world: 3 });
  claimed(A, "d4");
  expect(perms.apply({ ...cluster, world: 4 }, { op: "clearSecret", id: A })).toBe("");
  // A world in no cluster has one map, so rank alone decides.
  claimed(A, "e5");
  expect(perms.apply(outside(admin), { op: "clearSecret", id: A })).toBe("");
});

test("a regular admin can neither add to nor remove from a map admin's groups, nor clear its password", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Mods", rank: RANK_MAP });
  ok({ op: "addGroup", group: "Vip" });
  // Both are staff of this world alone, so its admins clear their passwords by rank.
  ok({ op: "addMember", kind: "survivor", key: A, group: "Mods", world: 3 });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: B, group: "Admins", world: 3 });
  expect([perms.claim(A, "ab".repeat(16), ""), perms.claim(B, "ef".repeat(16), "")]).toEqual([{ why: "", wrong: false }, { why: "", wrong: false }]);
  expect(perms.apply(admin, { op: "addMember", kind: "survivor", key: A, group: "Admins" })).not.toBe("");
  expect(perms.apply(admin, { op: "removeMember", kind: "survivor", key: A, group: "Vip" })).not.toBe("");
  expect(perms.apply(admin, { op: "clearSecret", id: A })).not.toBe("");
  expect(perms.secretOf(A)).toBe("ab".repeat(16));
  expect(perms.apply(mapAdmin, { op: "clearSecret", id: A })).toBe("");
  expect(perms.apply(admin, { op: "clearSecret", id: B })).toBe("");
  expect([perms.secretOf(A), perms.secretOf(B)]).toEqual(["", ""]);
});

test("a claim needs a staff group, and the password it replaces", () => {
  const { perms, ok, clock } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  expect(perms.claim(A, "ab".repeat(16), "")).toEqual({ why: "You are in no staff group, so there is no password to claim. An admin puts you in one first.", wrong: false });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins", world: 5 });
  expect(perms.claim(A, "ab".repeat(16), "")).toEqual({ why: "", wrong: false });
  expect(perms.claim(A, "cd".repeat(16), "")).toEqual({ why: "You have a password already. To replace it, give it: claimpassword <your password>", wrong: false });
  expect(perms.claim(A, "cd".repeat(16), "ef".repeat(16))).toEqual({ why: "wrong password", wrong: true });
  clock.t += CLAIM_WAIT_MS;
  expect(perms.claim(A, "cd".repeat(16), "AB".repeat(16))).toEqual({ why: "", wrong: false });
  expect(perms.claim(A, "ef".repeat(16), "ab".repeat(16))).toEqual({ why: "that password was replaced or cleared", wrong: false });
  expect([perms.secretOf(A), perms.retired("ab".repeat(16)), perms.takeGone()]).toEqual(["cd".repeat(16), true, [A]]);
  expect(perms.claim("123", "ab".repeat(16), "").why).toBe("That is no password to claim.");
  expect(perms.claim(A, "not hex", "").why).toBe("That is no password to claim.");
});

test("a map admin's staff membership holds on its own world only", () => {
  const { perms, ok } = world();
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins" }, mapAdmin);
  expect(perms.membersOf("survivor", A)[0]?.world).toBe(3);
  expect(perms.apply(mapAdmin, { op: "addMember", kind: "survivor", key: B, group: "Admins", world: 4 })).not.toBe("");
  expect(perms.apply(mapAdmin, { op: "addMember", kind: "survivor", key: B, group: "Admins", world: 0 })).not.toBe("");
  ok({ op: "addMember", kind: "survivor", key: B, group: "Admins" });
  expect(perms.membersOf("survivor", B)[0]?.world).toBe(0);
  expect(perms.apply(mapAdmin, { op: "removeMember", kind: "survivor", key: B, group: "Admins" })).not.toBe("");
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Admins" }, mapAdmin);
});

test("a tribe goes only in an open group", () => {
  const { perms } = world();
  expect(perms.apply(cluster, { op: "addMember", kind: "tribe", key: "7", group: "Admins" })).not.toBe("");
  // A store written before a rank waited for an empty group may hold a tribe in a staff group. It gives nothing.
  const store = new PermissionStore(":memory:");
  store.putGroup({ name: "Raiders", rank: RANK_STAFF, permissions: ["*"], chat: "" });
  store.putMember({ kind: "tribe", key: "7", group: "Raiders", world: 0, forever: true, from: 0, until: 0 });
  const old = new Permissions({ store, world: 3 });
  expect([old.membersIn("Raiders").length, old.inGroup(who(A, { team: 7, signed: true }), "Raiders")]).toEqual([1, false]);
});

test("the starting groups cannot be removed and Default stays open", () => {
  const { perms } = world();
  expect(perms.apply(cluster, { op: "removeGroup", group: "Default" })).not.toBe("");
  expect(perms.apply(cluster, { op: "removeGroup", group: "admins" })).not.toBe("");
  expect(perms.apply(cluster, { op: "setRank", group: "Default", rank: RANK_STAFF })).not.toBe("");
  expect(perms.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Default" })).not.toBe("");
  expect(perms.group("Admins")?.permissions).toEqual(["*"]);
});

test("removing a group takes its members with it", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "removeGroup", group: "VIP" });
  expect(perms.group("Vip")).toBeUndefined();
  expect(perms.membersOf("survivor", A)).toEqual([]);
});

test("bad input is a plain reason and never a throw", () => {
  const { perms, ok } = world();
  const bad: unknown[] = [
    { op: "addGroup", group: "has space" },
    { op: "addGroup", group: "a,b" },
    { op: "addGroup", group: "Vip", rank: 9 },
    { op: "addGroup", group: 5 },
    { op: "addGroup", group: "Admins" },
    { op: "grant", group: "Nobody", permission: "x" },
    { op: "grant", group: "Admins", permission: "two words" },
    { op: "revoke", group: "Admins", permission: "Cheat.give" },
    { op: "grant", group: "Admins", permission: "*" },
    { op: "setRank", group: "Admins", rank: 2.5 },
    { op: "addMember", kind: "survivor", key: "123", group: "Admins" },
    { op: "addMember", kind: "pet", key: A, group: "Admins" },
    { op: "addMember", kind: "tribe", key: "-1", group: "Admins" },
    { op: "addMember", kind: "survivor", key: A, group: "Admins", hours: -1 },
    { op: "addMember", kind: "survivor", key: A, group: "Admins", hours: Number.NaN },
    { op: "addMember", kind: "survivor", key: A, group: "Admins", delayHours: 1 },
    { op: "clearSecret", id: A },
    { op: "setSecret", id: A, hash: "not hex" },
    { op: "setChat", group: "Admins", chat: 7 },
    { op: "tag", id: A, tag: "Admin", show: "yes" },
    { op: "nothing" },
    null,
  ];
  for (const op of bad) expect(perms.apply(cluster, op as PermissionOp)).not.toBe("");
  ok({ op: "addGroup", group: "Vip" });
  expect(perms.apply(cluster, { op: "addGroup", group: "VIP" })).not.toBe("");
});

test("a document is an admin's to set and comes back untouched", () => {
  const { perms, ok } = world(0);
  const text = '{ "MapColors": { "Island": [1, 0, 0, 1] } }';
  expect(perms.apply(outside({ ...admin, rank: RANK_STAFF }), { op: "setDocument", name: "CrossChat", text })).not.toBe("");
  ok({ op: "setDocument", name: "CrossChat", text }, outside(admin));
  expect(perms.document("crosschat")).toBe(text);
  ok({ op: "setChat", group: "Admins", chat: '{"Tag":"[Admin]"}' });
  expect(perms.group("Admins")?.chat).toBe('{"Tag":"[Admin]"}');
});

test("each change is passed to the callback and raises the version", () => {
  const { perms, ok } = world(0);
  const seen: string[] = [];
  perms.onApplied = (actor, op) => seen.push(`${actor.name} ${op.op}`);
  const v = perms.version;
  ok({ op: "addGroup", group: "Vip" }, outside(admin));
  expect(perms.apply(outside(admin), { op: "removeGroup", group: "Default" })).not.toBe("");
  expect(seen).toEqual(["admin addGroup"]);
  expect(perms.version).toBeGreaterThan(v);
});

test("the edit rule reads the survivor's highest staff group", () => {
  const look = (staff: number): RuleLook => ({
    groupRank: (n) => (n.toLowerCase() === "vip" ? RANK_OPEN : undefined),
    staffRank: () => staff,
    staffReach: () => "here",
    allCheats: () => false,
    hasMembers: () => false,
    issued: () => true,
    teamMade: () => true,
    tribeRank: () => 0,
  });
  const op: PermissionOp = { op: "addMember", kind: "survivor", key: A, group: "Vip" };
  expect(editRule(admin, op, look(RANK_ADMIN))).toBe("");
  expect(editRule(admin, op, look(RANK_MAP))).not.toBe("");
  expect(editRule(mapAdmin, op, look(RANK_MAP))).toBe("");
});

const CLUSTER_ONLY = "In a cluster, only the cluster's admins change groups and chat settings.";
const EMPTY_FIRST = "A group's rank changes only while it has no members. Take them out first.";
/** Each change to what a group is, in an order the cluster's admin can make them all. */
const definitions: PermissionOp[] = [
  { op: "addGroup", group: "Mods" },
  { op: "setRank", group: "Vip", rank: RANK_STAFF },
  { op: "grant", group: "Vip", permission: "Cheat.fly" },
  { op: "grant", group: "Default", permission: "*" },
  { op: "revoke", group: "Admins", permission: "*" },
  { op: "removeGroup", group: "Vip" },
];
const chats: PermissionOp[] = [
  { op: "setChat", group: "Admins", chat: '{"Tag":"[Admin]"}' },
  { op: "setDocument", name: "chat", text: "{}" },
];

test("in a cluster an admin or map admin cannot grant, revoke, rank, make or remove", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  const before = perms.snapshot();
  for (const actor of [admin, mapAdmin]) expect(definitions.map((op) => perms.apply(actor, op))).toEqual(definitions.map(() => CLUSTER_ONLY));
  expect(perms.snapshot()).toEqual(before);
});

test("in a cluster an admin or map admin cannot set a chat block or the chat settings", () => {
  const { perms } = world();
  for (const actor of [admin, mapAdmin]) expect(chats.map((op) => perms.apply(actor, op))).toEqual(chats.map(() => CLUSTER_ONLY));
  expect([perms.group("Admins")?.chat, perms.document("chat")]).toEqual(["", ""]);
});

test("in a cluster the cluster's admin makes each of those changes", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  for (const op of [...definitions, ...chats]) ok(op);
  expect([perms.group("Mods")?.name, perms.group("Vip"), perms.group("Default")?.permissions, perms.group("Admins")?.permissions]).toEqual(["Mods", undefined, ["*"], []]);
  expect(perms.document("chat")).toBe("{}");
});

test("in a cluster a regular admin manages members and passwords, not the groups", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" }, admin);
  ok({ op: "addMember", kind: "tribe", key: "7", group: "Vip", hours: 2 }, admin);
  ok({ op: "addMember", kind: "survivor", key: B, group: "Admins" }, admin);
  expect(perms.membersOf("survivor", B)[0]?.world).toBe(3);
  expect(perms.claim(B, "ab".repeat(16), "")).toEqual({ why: "", wrong: false });
  ok({ op: "clearSecret", id: B }, admin);
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Vip" }, admin);
  ok({ op: "removeMember", kind: "survivor", key: B, group: "Admins" }, admin);
  expect(perms.apply(admin, { op: "grant", group: "Vip", permission: "Cheat.fly" })).toBe(CLUSTER_ONLY);
  expect([perms.membersIn("Vip").map((m) => m.key), perms.secretOf(B), perms.group("Vip")?.permissions]).toEqual([["7"], "", []]);
});

test("outside a cluster an admin still edits the groups of its rank", () => {
  const here = world(0);
  const there = world(3);
  here.ok({ op: "addGroup", group: "Vip" }, outside(admin));
  there.ok({ op: "addGroup", group: "Vip" });
  for (const op of [...definitions, ...chats]) {
    expect(there.perms.apply(admin, op)).toBe(CLUSTER_ONLY);
    // Every cheat for everyone in Default is the map's admins' to give, not a regular admin's.
    if (op.op === "grant" && op.permission === "*") expect(here.perms.apply(outside(admin), op)).toBe("An open group that holds every cheat counts with no password, so only the map's admins hand it out.");
    else here.ok(op, outside(admin));
  }
  expect(here.perms.apply(outside(admin), { op: "addGroup", group: "Owners", rank: RANK_MAP })).toBe("That needs the map rank.");
});

test("a group's rank changes only while it has no members", () => {
  const { perms, clock, ok } = world();
  const rank: PermissionOp = { op: "setRank", group: "Vip", rank: RANK_STAFF };
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "tribe", key: "7", group: "Vip" });
  expect([perms.apply(cluster, rank), perms.apply(outside(mapAdmin), rank)]).toEqual([EMPTY_FIRST, EMPTY_FIRST]);
  ok({ op: "removeMember", kind: "tribe", key: "7", group: "Vip" });
  // One whose time has not yet begun is a member already.
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 1, delayHours: 1 });
  expect(perms.apply(cluster, rank)).toBe(EMPTY_FIRST);
  clock.t += 3 * HOUR;
  ok(rank);
  expect(perms.group("Vip")?.rank).toBe(RANK_STAFF);
});

test("Admins cannot be made open while anyone is in it", () => {
  const { perms, ok } = world();
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins" }, mapAdmin);
  const open: PermissionOp = { op: "setRank", group: "Admins", rank: RANK_OPEN };
  expect([perms.apply(cluster, open), perms.apply(outside(mapAdmin), open)]).toEqual([EMPTY_FIRST, EMPTY_FIRST]);
  expect([perms.group("Admins")?.rank, perms.has(who(A), "Cheat.give")]).toEqual([RANK_ADMIN, false]);
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Admins" });
  ok(open);
});

test("the edit rule adds only an ID that was issued and a team number that was made", () => {
  const look = (issued: boolean, made: boolean): RuleLook => ({ groupRank: () => RANK_OPEN, staffRank: () => 0, staffReach: () => "none", allCheats: () => false, hasMembers: () => false, issued: () => issued, teamMade: () => made, tribeRank: () => 0 });
  const add: PermissionOp = { op: "addMember", kind: "survivor", key: C, group: "Vip" };
  const tribe: PermissionOp = { op: "addMember", kind: "tribe", key: "9", group: "Vip" };
  expect([editRule(cluster, add, look(false, true)), editRule(cluster, tribe, look(true, false))]).toEqual([`No survivor has the ID ${C}.`, "No tribe has the number 9."]);
  expect([editRule(cluster, add, look(true, false)), editRule(cluster, tribe, look(false, true))]).toEqual(["", ""]);
  const out: PermissionOp[] = [{ op: "removeMember", kind: "survivor", key: C, group: "Vip" }, { op: "removeMember", kind: "tribe", key: "9", group: "Vip" }, { op: "clearSecret", id: C }];
  expect(out.map((op) => editRule(cluster, op, look(false, false)))).toEqual(["", "", ""]);
});

test("rows naming an ID never issued are taken out, and it claims nothing", () => {
  const store = new PermissionStore(":memory:");
  store.putGroup({ name: "Vip", rank: RANK_OPEN, permissions: [], chat: "" });
  store.putMember({ kind: "survivor", key: C, group: "Vip", world: 0, forever: true, from: 0, until: 0 });
  store.putMember({ kind: "survivor", key: C, group: "Admins", world: 0, forever: true, from: 0, until: 0 });
  store.putMember({ kind: "tribe", key: "99", group: "Vip", world: 0, forever: true, from: 0, until: 0 });
  store.putSecret({ id: C, hash: "ab".repeat(16), at: 0 });
  const perms = new Permissions({ store, world: 3 });
  expect(perms.apply(cluster, { op: "addMember", kind: "survivor", key: C, group: "Vip", hours: 1 })).toBe(`No survivor has the ID ${C}.`);
  expect(perms.apply(cluster, { op: "addMember", kind: "tribe", key: "99", group: "Vip", hours: 1 })).toBe("No tribe has the number 99.");
  expect(perms.claim(C, "cd".repeat(16), "ab".repeat(16))).toEqual({ why: `No survivor has the ID ${C}.`, wrong: false });
  expect(perms.apply(cluster, { op: "removeMember", kind: "survivor", key: C, group: "Vip" })).toBe("");
  expect(perms.apply(cluster, { op: "removeMember", kind: "tribe", key: "99", group: "Vip" })).toBe("");
  expect(perms.apply(cluster, { op: "clearSecret", id: C })).toBe("");
  expect([perms.membersOf("survivor", C).map((m) => m.group), perms.secretOf(C)]).toEqual([["Admins"], ""]);
});

test("a tag choice that is already so raises no revision", () => {
  const { perms } = world();
  const player: PermissionActor = { rank: RANK_OPEN, world: 3, name: "bob" };
  const at = (): number => perms.snapshot().revision;
  const start = at();
  // A tag is shown unless it was hidden, so showing one never hidden is nothing new.
  expect(perms.apply(player, { op: "tag", id: A, tag: "Vip", show: true })).toBe("");
  expect([at(), perms.version, perms.tagChoice(A, "Vip")]).toEqual([start, perms.version, undefined]);
  expect(perms.apply(player, { op: "tag", id: A, tag: "Vip", show: false })).toBe("");
  expect(perms.apply(player, { op: "tag", id: A, tag: "vip", show: false })).toBe("");
  expect([at(), perms.tagChoice(A, "Vip")]).toEqual([start + 1, false]);
  expect(perms.apply(player, { op: "tag", id: A, tag: "Vip", show: true })).toBe("");
  expect([at(), perms.tagChoice(A, "Vip")]).toEqual([start + 2, true]);
});

test("the edit rule keeps a tribe from an actor one of its members outranks", () => {
  const look = (tribe: number): RuleLook => ({ groupRank: () => RANK_OPEN, staffRank: () => 0, staffReach: () => "none", allCheats: () => false, hasMembers: () => false, issued: () => true, teamMade: () => true, tribeRank: () => tribe });
  const add: PermissionOp = { op: "addMember", kind: "tribe", key: "9", group: "Vip" };
  const remove: PermissionOp = { op: "removeMember", kind: "tribe", key: "9", group: "Vip" };
  const HIGHER = "A member of that tribe holds a higher rank than yours.";
  expect([editRule(admin, add, look(RANK_MAP)), editRule(admin, remove, look(RANK_MAP))]).toEqual([HIGHER, HIGHER]);
  expect([editRule(admin, add, look(RANK_ADMIN)), editRule(mapAdmin, remove, look(RANK_MAP)), editRule(cluster, add, look(RANK_CLUSTER))]).toEqual(["", "", ""]);
});

test("a membership not yet begun does not make a survivor an admin's own to clear", () => {
  const { perms, ok } = world();
  const far: PermissionActor = { rank: RANK_ADMIN, world: 4, name: "admin of 4" };
  ok({ op: "addGroup", group: "Helpers", rank: RANK_STAFF });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Helpers", world: 3 });
  expect(perms.claim(A, "ab".repeat(32), "").why).toBe("");
  const ELSEWHERE = "That survivor's staff groups are on other maps. An admin there or the cluster's clears their password.";
  expect(perms.apply(far, { op: "clearSecret", id: A })).toBe(ELSEWHERE);
  // World 4's admin may give her time there that starts in a thousand hours. It gives her nothing there yet, and no reach to them.
  expect(perms.apply(far, { op: "addMember", kind: "survivor", key: A, group: "Helpers", hours: 1, delayHours: 1000 })).toBe("");
  expect(perms.rankOf({ id: A, team: 0, signed: true, world: 4 })).toBe(RANK_OPEN);
  expect(perms.apply(far, { op: "clearSecret", id: A })).toBe(ELSEWHERE);
  expect(perms.secretOf(A)).toBe("ab".repeat(32));
});

test("a password is replaced once an hour at most, and a wrong guess is still a guess", () => {
  const { perms, ok, clock } = world();
  const hash = (x: string): string => x.repeat(32);
  ok({ op: "addMember", kind: "survivor", key: A, group: "Admins" });
  expect(perms.claim(A, hash("a1"), "").why).toBe("");
  const at = [perms.snapshot().revision, perms.history().length];
  // Each replacement is a write every map reads, a row of the cluster's history and an act: one a second would bury both.
  clock.t += 60_000;
  expect(perms.claim(A, hash("b2"), hash("a1"))).toEqual({ why: "You claimed a password a short while ago. A new one can be claimed in 59 minutes.", wrong: false });
  expect(perms.claim(A, hash("b2"), hash("ff"))).toEqual({ why: "wrong password", wrong: true });
  expect([perms.secretOf(A), perms.snapshot().revision, perms.history().length]).toEqual([hash("a1"), ...at]);
  clock.t += CLAIM_WAIT_MS;
  expect(perms.claim(A, hash("b2"), hash("a1")).why).toBe("");
  // An admin's clear is an act of its own, so a claim after one does not wait.
  ok({ op: "clearSecret", id: A });
  expect(perms.claim(A, hash("c3"), "").why).toBe("");
});

test("only the top rank hands out an open group that holds every cheat", () => {
  const { perms, ok } = world();
  const TOP = "An open group that holds every cheat counts with no password, so only the cluster's admins hand it out.";
  ok({ op: "addGroup", group: "Gods" });
  ok({ op: "grant", group: "Gods", permission: "*" });
  ok({ op: "addGroup", group: "Cheaters" });
  ok({ op: "grant", group: "Cheaters", permission: "cheat.*" });
  ok({ op: "addGroup", group: "Fliers" });
  ok({ op: "grant", group: "Fliers", permission: "Cheat.fly" });
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "grant", group: "Vip", permission: "Kit.vip" });
  // In a cluster a map's admin or a regular admin still hands out a perk or a single cheat, never every cheat.
  for (const actor of [admin, mapAdmin]) {
    expect(perms.apply(actor, { op: "addMember", kind: "survivor", key: A, group: "Gods" })).toBe(TOP);
    expect(perms.apply(actor, { op: "addMember", kind: "survivor", key: A, group: "Cheaters", hours: 1 })).toBe(TOP);
    expect(perms.apply(actor, { op: "addMember", kind: "tribe", key: "7", group: "Gods" })).toBe(TOP);
  }
  ok({ op: "addMember", kind: "survivor", key: A, group: "Fliers" }, admin);
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" }, admin);
  ok({ op: "addMember", kind: "survivor", key: A, group: "Gods" });
  // Taking someone out is still theirs, and outside a cluster the map's rank is the top.
  ok({ op: "removeMember", kind: "survivor", key: A, group: "Gods" }, admin);
  expect(perms.apply(outside(admin), { op: "addMember", kind: "survivor", key: B, group: "Gods" })).toBe("An open group that holds every cheat counts with no password, so only the map's admins hand it out.");
  ok({ op: "addMember", kind: "survivor", key: B, group: "Gods" }, outside(mapAdmin));
  // Nor can a regular admin outside a cluster make one of an open group that has members.
  expect(perms.apply(outside(admin), { op: "grant", group: "Vip", permission: "*" })).toBe("An open group that holds every cheat counts with no password, so only the map's admins hand it out.");
});
