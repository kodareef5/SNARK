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
import { Permissions, POLL_MS, type PermissionSubject } from "../../server/permissions/permissions.ts";
import { PermissionStore } from "../../server/permissions/store.ts";

const HOUR = 3600 * 1000;
const A = idOf(3, 1);
const B = idOf(3, 2);
const cluster: PermissionActor = { rank: RANK_CLUSTER, world: 3, name: "cluster" };
const mapAdmin: PermissionActor = { rank: RANK_MAP, world: 3, name: "map" };
const admin: PermissionActor = { rank: RANK_ADMIN, world: 3, name: "admin" };

function world(world = 3, start = 1_000_000) {
  const clock = { t: start };
  const perms = new Permissions({ store: new PermissionStore(":memory:"), world, now: () => clock.t });
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

test("a membership for every world counts on each", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: B, group: "Vip", world: 5 });
  expect(perms.inGroup(who(A, { world: 9 }), "Vip")).toBe(true);
  expect(perms.inGroup(who(B, { world: 5 }), "Vip")).toBe(true);
  expect(perms.inGroup(who(B, { world: 3 }), "Vip")).toBe(false);
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
  const { perms, ok } = world();
  expect(perms.apply(admin, { op: "addGroup", group: "Mods", rank: RANK_MAP })).not.toBe("");
  ok({ op: "addGroup", group: "Mods", rank: RANK_MAP });
  expect(perms.apply(admin, { op: "grant", group: "Mods", permission: "Cheat.kick" })).not.toBe("");
  expect(perms.apply(admin, { op: "removeGroup", group: "Mods" })).not.toBe("");
  expect(perms.apply(admin, { op: "setChat", group: "Mods", chat: "{}" })).not.toBe("");
  expect(perms.apply(mapAdmin, { op: "grant", group: "Mods", permission: "Cheat.kick" })).toBe("");
  expect(perms.group("mods")?.permissions).toEqual(["Cheat.kick"]);
  ok({ op: "addGroup", group: "Helpers" }, admin);
  expect(perms.apply(admin, { op: "setRank", group: "Helpers", rank: RANK_MAP })).not.toBe("");
  expect(perms.apply(mapAdmin, { op: "setRank", group: "Mods", rank: RANK_OPEN })).toBe("");
  expect(perms.apply(admin, { op: "setRank", group: "Mods", rank: RANK_STAFF })).toBe("");
});

test("a cluster group is for every world and only the cluster edits it", () => {
  const { perms, ok } = world();
  expect(perms.apply(mapAdmin, { op: "addGroup", group: "Owners", rank: RANK_CLUSTER })).not.toBe("");
  ok({ op: "addGroup", group: "Owners", rank: RANK_CLUSTER });
  expect(perms.apply(mapAdmin, { op: "addMember", kind: "survivor", key: A, group: "Owners" })).not.toBe("");
  expect(perms.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Owners", world: 3 })).not.toBe("");
  ok({ op: "addMember", kind: "survivor", key: A, group: "Owners" });
  expect(perms.membersOf("survivor", A)[0]?.world).toBe(0);
});

test("a regular admin can neither add to nor remove from a map admin's groups, nor change its secret", () => {
  const { perms, ok } = world();
  ok({ op: "addGroup", group: "Mods", rank: RANK_MAP });
  ok({ op: "addGroup", group: "Vip" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Mods" });
  ok({ op: "addMember", kind: "survivor", key: A, group: "Vip" });
  ok({ op: "setSecret", id: A, hash: "ab".repeat(16) });
  expect(perms.apply(admin, { op: "addMember", kind: "survivor", key: A, group: "Admins" })).not.toBe("");
  expect(perms.apply(admin, { op: "removeMember", kind: "survivor", key: A, group: "Vip" })).not.toBe("");
  expect(perms.apply(admin, { op: "setSecret", id: A, hash: "cd".repeat(16) })).not.toBe("");
  expect(perms.apply(admin, { op: "clearSecret", id: A })).not.toBe("");
  expect(perms.secretOf(A)).toBe("ab".repeat(16));
  expect(perms.apply(mapAdmin, { op: "setSecret", id: A, hash: "cd".repeat(16) })).toBe("");
  expect(perms.apply(admin, { op: "setSecret", id: B, hash: "ef".repeat(16) })).toBe("");
  expect(perms.secretOf(B)).toBe("ef".repeat(16));
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
  const { perms, ok } = world();
  expect(perms.apply(cluster, { op: "addMember", kind: "tribe", key: "7", group: "Admins" })).not.toBe("");
  ok({ op: "addGroup", group: "Raiders" });
  ok({ op: "addMember", kind: "tribe", key: "7", group: "Raiders" });
  ok({ op: "setRank", group: "Raiders", rank: RANK_STAFF });
  expect(perms.inGroup(who(A, { team: 7, signed: true }), "Raiders")).toBe(false);
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

test("a document needs the map rank and comes back untouched", () => {
  const { perms, ok } = world();
  const text = '{ "MapColors": { "Island": [1, 0, 0, 1] } }';
  expect(perms.apply(admin, { op: "setDocument", name: "CrossChat", text })).not.toBe("");
  ok({ op: "setDocument", name: "CrossChat", text }, mapAdmin);
  expect(perms.document("crosschat")).toBe(text);
  ok({ op: "setChat", group: "Admins", chat: '{"Tag":"[Admin]"}' });
  expect(perms.group("Admins")?.chat).toBe('{"Tag":"[Admin]"}');
});

test("each change is passed to the callback and raises the version", () => {
  const { perms, ok } = world();
  const seen: string[] = [];
  perms.onApplied = (actor, op) => seen.push(`${actor.name} ${op.op}`);
  const v = perms.version;
  ok({ op: "addGroup", group: "Vip" }, admin);
  expect(perms.apply(admin, { op: "removeGroup", group: "Default" })).not.toBe("");
  expect(seen).toEqual(["admin addGroup"]);
  expect(perms.version).toBeGreaterThan(v);
});

test("the edit rule reads the survivor's highest staff group", () => {
  const look = (staff: number): RuleLook => ({ groupRank: (n) => (n.toLowerCase() === "vip" ? RANK_OPEN : undefined), staffRank: () => staff });
  const op: PermissionOp = { op: "addMember", kind: "survivor", key: A, group: "Vip" };
  expect(editRule(admin, op, look(RANK_ADMIN))).toBe("");
  expect(editRule(admin, op, look(RANK_MAP))).not.toBe("");
  expect(editRule(mapAdmin, op, look(RANK_MAP))).toBe("");
});
