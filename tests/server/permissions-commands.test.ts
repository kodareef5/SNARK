import { expect, test } from "bun:test";
import { memberOp, PERMISSIONS_COMMANDS, permissionsCommand, readPermissions, type PermissionsRead, type PermissionsRequest } from "../../shared/permissions/commands.ts";
import { idOf } from "../../shared/ids.ts";
import { RANK_CLUSTER, RANK_STAFF } from "../../shared/ranks.ts";

const ID = idOf(3, 1);

function request(name: string, ...words: string[]): PermissionsRequest {
  const read = readPermissions(name, words);
  if (!read.ok) throw new Error(read.reason);
  return read.request;
}

const reason = (read: PermissionsRead): string => (read.ok ? "" : read.reason);

test("every command reads", () => {
  expect(request("Permissions.Add", ID, "Vip")).toEqual({
    type: "member",
    who: { kind: "survivor", word: ID },
    change: { op: "addMember", kind: "survivor", group: "Vip" },
    everyWorld: false,
  });
  expect(request("Permissions.Remove", "Bob", "Vip")).toMatchObject({ who: { kind: "survivor", word: "Bob" }, change: { op: "removeMember", group: "Vip" } });
  expect(request("Permissions.AddTimed", ID, "Muted", "1", "0.5")).toMatchObject({ change: { op: "addMember", group: "Muted", hours: 1, delayHours: 0.5 } });
  expect(request("Permissions.RemoveTimed", ID, "Muted")).toMatchObject({ change: { op: "removeMember", timedOnly: true } });
  expect(request("Permissions.PlayerGroups", "Bob")).toEqual({ type: "list", listing: { of: "memberGroups", who: { kind: "survivor", word: "Bob" } } });
  expect(request("Permissions.AddTribe", "12", "Vip")).toMatchObject({ who: { kind: "tribe", word: "12" }, change: { op: "addMember", kind: "tribe" } });
  expect(request("Permissions.RemoveTribe", "Raiders", "Vip")).toMatchObject({ who: { kind: "tribe", word: "Raiders" }, change: { op: "removeMember", kind: "tribe" } });
  expect(request("Permissions.AddTribeTimed", "12", "Vip", "24", "0")).toMatchObject({ change: { op: "addMember", kind: "tribe", hours: 24, delayHours: 0 } });
  expect(request("Permissions.RemoveTribeTimed", "12", "Vip")).toMatchObject({ change: { op: "removeMember", kind: "tribe", timedOnly: true } });
  expect(request("Permissions.TribeGroups", "12")).toEqual({ type: "list", listing: { of: "memberGroups", who: { kind: "tribe", word: "12" } } });
  expect(request("Permissions.AddGroup", "Vip")).toEqual({ type: "change", op: { op: "addGroup", group: "Vip" } });
  expect(request("Permissions.RemoveGroup", "Vip")).toEqual({ type: "change", op: { op: "removeGroup", group: "Vip" } });
  expect(request("Permissions.Grant", "Vip", "ArkShop.Kits.vip")).toEqual({ type: "change", op: { op: "grant", group: "Vip", permission: "ArkShop.Kits.vip" } });
  expect(request("Permissions.Revoke", "Vip", "Cheat.give")).toEqual({ type: "change", op: { op: "revoke", group: "Vip", permission: "Cheat.give" } });
  expect(request("Permissions.GroupPermissions", "Vip")).toEqual({ type: "list", listing: { of: "permissions", group: "Vip" } });
  expect(request("Permissions.ListGroups")).toEqual({ type: "list", listing: { of: "groups" } });
});

test("names match in any case", () => {
  expect(request("permissions.add", ID, "Vip")).toEqual(request("Permissions.Add", ID, "Vip"));
  expect(request("PERMISSIONS.LISTGROUPS")).toEqual({ type: "list", listing: { of: "groups" } });
  expect(permissionsCommand("permissions.grant")?.name).toBe("Permissions.Grant");
  expect(readPermissions("Permissions.Nope", []).ok).toBe(false);
});

test("a wrong count of words gives the usage", () => {
  const few = reason(readPermissions("Permissions.Add", [ID]));
  expect(few).toContain("Too few words");
  expect(few).toContain(permissionsCommand("Permissions.Add")!.usage);
  expect(reason(readPermissions("Permissions.Grant", ["Vip", "a", "b"]))).toContain("Too many words");
  expect(reason(readPermissions("Permissions.ListGroups", ["Vip"]))).toContain("Usage: Permissions.ListGroups");
  expect(reason(readPermissions("Permissions.AddTribe", ["12", "Vip", "all"]))).toContain("Too many words");
});

test("hours and the delay must be numbers", () => {
  expect(reason(readPermissions("Permissions.AddTimed", [ID, "Vip", "x", "0"]))).toContain("Hours are a number");
  expect(reason(readPermissions("Permissions.AddTimed", [ID, "Vip", "1", "soon"]))).toContain("The delay is a number");
  expect(reason(readPermissions("Permissions.AddTribeTimed", ["12", "Vip", "-1", "0"]))).toContain("Hours are a number");
  expect(reason(readPermissions("Permissions.AddTimed", [ID, "Vip", "Infinity", "0"]))).toContain("Hours are a number");
});

test("all holds on every world and the rank of a group reads", () => {
  const all = request("Permissions.Add", ID, "Vip", "ALL");
  expect(all).toMatchObject({ type: "member", everyWorld: true });
  expect(request("Permissions.AddTimed", ID, "Vip", "2", "0", "all")).toMatchObject({ everyWorld: true, change: { hours: 2 } });
  if (all.type !== "member") throw new Error("not a member request");
  expect(memberOp(all, ID, 3)).toEqual({ op: "addMember", kind: "survivor", key: ID, group: "Vip", world: 0 });
  const here = request("Permissions.Add", ID, "Vip");
  if (here.type !== "member") throw new Error("not a member request");
  expect(memberOp(here, ID, 3)).toEqual({ op: "addMember", kind: "survivor", key: ID, group: "Vip", world: 3 });
  const out = request("Permissions.Remove", ID, "Vip");
  if (out.type !== "member") throw new Error("not a member request");
  expect(memberOp(out, ID, 3)).toEqual({ op: "removeMember", kind: "survivor", key: ID, group: "Vip" });

  expect(request("Permissions.Rank", "Mods", "Staff")).toEqual({ type: "change", op: { op: "setRank", group: "Mods", rank: RANK_STAFF } });
  expect(request("permissions.rank", "Owners", "cluster")).toEqual({ type: "change", op: { op: "setRank", group: "Owners", rank: RANK_CLUSTER } });
  expect(reason(readPermissions("Permissions.Rank", ["Mods", "boss"]))).toContain("A rank is open, staff, admin, map, cluster");
});

test("a listing is told from a change", () => {
  for (const name of ["Permissions.PlayerGroups", "Permissions.TribeGroups", "Permissions.GroupPermissions"]) expect(request(name, "x").type).toBe("list");
  expect(request("Permissions.ListGroups").type).toBe("list");
  expect(request("Permissions.AddGroup", "Vip").type).toBe("change");
  expect(request("Permissions.Add", ID, "Vip").type).toBe("member");
});

test("each command has a usage that starts with its name and a help line", () => {
  for (const c of PERMISSIONS_COMMANDS) {
    expect(c.usage.startsWith(c.name)).toBe(true);
    expect(c.help.length).toBeGreaterThan(0);
    expect(c.help).not.toContain("\n");
  }
});
