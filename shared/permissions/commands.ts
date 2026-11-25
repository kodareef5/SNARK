// ArkApi's `Permissions.*` console commands, read from a command's name and its words. ARK took a Steam id where this game
// takes a survivor's ID or name, and a tribe id where it takes a tribe's number or name. The reader does not know who
// exists: it hands back the word as typed, and the caller finds the survivor or tribe and makes the op with `memberOp`.
import { rankNamed, RANK_NAMES } from "../ranks.ts";
import type { MemberKind, PermissionOp } from "./model.ts";
import { CHAT_DOCUMENT } from "./page.ts";

/** A survivor or a tribe as typed: an ID, a number or a name, for the caller to find. */
export interface Who {
  readonly kind: MemberKind;
  readonly word: string;
}

/** A membership change without its member's key. */
export type MemberChange =
  | Omit<Extract<PermissionOp, { op: "addMember" }>, "key">
  | Omit<Extract<PermissionOp, { op: "removeMember" }>, "key">;

/** A change of a group alone. */
export type GroupChange = Extract<PermissionOp, { op: "addGroup" | "removeGroup" | "setRank" | "grant" | "revoke" }>;

export type PermissionsListing =
  | { readonly of: "groups" }
  | { readonly of: "permissions"; readonly group: string }
  | { readonly of: "memberGroups"; readonly who: Who };

export type PermissionsRequest =
  | { readonly type: "change"; readonly op: GroupChange }
  /** An addMember with `all` holds on every world; without it, the caller puts its own world in. */
  | { readonly type: "member"; readonly who: Who; readonly change: MemberChange; readonly everyWorld: boolean }
  | { readonly type: "list"; readonly listing: PermissionsListing }
  /** Says whether a survivor has claimed their own password, or with `clear` takes it away. */
  | { readonly type: "password"; readonly who: Who; readonly clear: boolean };

export type PermissionsRead =
  | { readonly ok: true; readonly command: PermissionsCommand; readonly request: PermissionsRequest }
  | { readonly ok: false; readonly reason: string };

export interface PermissionsCommand {
  readonly name: string;
  readonly usage: string;
  readonly help: string;
}

const command = (name: string, args: string, help: string): PermissionsCommand => ({
  name: "Permissions." + name,
  usage: `Permissions.${name}${args ? " " + args : ""}`,
  help,
});

const RANK_WORDS = RANK_NAMES.join("|");

/** Every `Permissions.*` command, with its usage and help, for `help` and the wiki. */
export const PERMISSIONS_COMMANDS: readonly PermissionsCommand[] = [
  command("Add", "<ID or name> <Group> [all]", "Puts a survivor in a group for good; all makes it hold on every map."),
  command("Remove", "<ID or name> <Group>", "Takes a survivor out of a group."),
  command("AddTimed", "<ID or name> <Group> <Hours> <DelayHours> [all]", "Puts a survivor in a group for some hours, starting after a delay."),
  command("RemoveTimed", "<ID or name> <Group>", "Takes away a survivor's time in a group, leaving a membership for good."),
  command("PlayerGroups", "<ID or name>", "Lists a survivor's groups."),
  command("AddTribe", "<TribeID or name> <Group>", "Puts a tribe in an open group for good."),
  command("RemoveTribe", "<TribeID or name> <Group>", "Takes a tribe out of a group."),
  command("AddTribeTimed", "<TribeID or name> <Group> <Hours> <DelayHours>", "Puts a tribe in an open group for some hours, starting after a delay."),
  command("RemoveTribeTimed", "<TribeID or name> <Group>", "Takes away a tribe's time in a group."),
  command("TribeGroups", "<TribeID or name>", "Lists a tribe's groups."),
  command("AddGroup", "<Group>", "Makes an open group that holds nothing."),
  command("RemoveGroup", "<Group>", "Removes a group and its memberships."),
  command("Grant", "<Group> <Permission>", "Gives a group a permission."),
  command("Revoke", "<Group> <Permission>", "Takes a permission from a group."),
  command("GroupPermissions", "<Group>", "Lists a group's permissions."),
  command("ListGroups", "", "Lists every group."),
  command("Rank", `<Group> <${RANK_WORDS}>`, "Sets a group's rank: who its members are and who may change it."),
  command("Password", "<ID or name> [clear]", "Says whether a survivor has claimed their own password, and when; clear takes it away."),
];

const BY_NAME: ReadonlyMap<string, PermissionsCommand> = new Map(PERMISSIONS_COMMANDS.map((c) => [c.name.toLowerCase(), c]));

/** The `Permissions.*` command of that name in any case, or undefined. */
export function permissionsCommand(name: string): PermissionsCommand | undefined {
  return BY_NAME.get(name.toLowerCase());
}

const HOURS = /^[0-9]+(?:\.[0-9]+)?$/;

/** Reads one `Permissions.*` command from its name, in any case, and its words. */
export function readPermissions(name: string, words: readonly string[]): PermissionsRead {
  const cmd = permissionsCommand(name);
  if (!cmd) return { ok: false, reason: "That is not a Permissions command." };
  const no = (why: string): PermissionsRead => ({ ok: false, reason: `${why}. Usage: ${cmd.usage}` });
  const yes = (request: PermissionsRequest): PermissionsRead => ({ ok: true, command: cmd, request });
  const short = cmd.name.slice("Permissions.".length).toLowerCase();
  const timed = short === "addtimed" || short === "addtribetimed";
  // The usage says how many words: one for each <...>, and one more where it ends in [all].
  const base = cmd.usage.split("<").length - 1;
  let args = words;
  let everyWorld = false;
  if (cmd.usage.endsWith("[all]") && args.length === base + 1 && args[base]!.toLowerCase() === "all") {
    everyWorld = true;
    args = args.slice(0, base);
  }
  let clear = false;
  if (cmd.usage.endsWith("[clear]") && args.length === base + 1 && args[base]!.toLowerCase() === "clear") {
    clear = true;
    args = args.slice(0, base);
  }
  if (args.length < base) return no("Too few words");
  if (args.length > base) return no("Too many words");
  const [a = "", b = ""] = args;
  const survivor: Who = { kind: "survivor", word: a };
  const tribe: Who = { kind: "tribe", word: a };
  let hours = 0;
  let delayHours = 0;
  if (timed) {
    if (!HOURS.test(args[2]!)) return no("Hours are a number");
    if (!HOURS.test(args[3]!)) return no("The delay is a number of hours");
    hours = Number(args[2]);
    delayHours = Number(args[3]);
  }
  const member = (who: Who, change: MemberChange): PermissionsRead => yes({ type: "member", who, change, everyWorld });
  switch (short) {
    case "add":
      return member(survivor, { op: "addMember", kind: "survivor", group: b });
    case "remove":
      return member(survivor, { op: "removeMember", kind: "survivor", group: b });
    case "addtimed":
      return member(survivor, { op: "addMember", kind: "survivor", group: b, hours, delayHours });
    case "removetimed":
      return member(survivor, { op: "removeMember", kind: "survivor", group: b, timedOnly: true });
    case "playergroups":
      return yes({ type: "list", listing: { of: "memberGroups", who: survivor } });
    case "addtribe":
      return member(tribe, { op: "addMember", kind: "tribe", group: b });
    case "removetribe":
      return member(tribe, { op: "removeMember", kind: "tribe", group: b });
    case "addtribetimed":
      return member(tribe, { op: "addMember", kind: "tribe", group: b, hours, delayHours });
    case "removetribetimed":
      return member(tribe, { op: "removeMember", kind: "tribe", group: b, timedOnly: true });
    case "tribegroups":
      return yes({ type: "list", listing: { of: "memberGroups", who: tribe } });
    case "addgroup":
      return yes({ type: "change", op: { op: "addGroup", group: a } });
    case "removegroup":
      return yes({ type: "change", op: { op: "removeGroup", group: a } });
    case "grant":
      return yes({ type: "change", op: { op: "grant", group: a, permission: b } });
    case "revoke":
      return yes({ type: "change", op: { op: "revoke", group: a, permission: b } });
    case "grouppermissions":
      return yes({ type: "list", listing: { of: "permissions", group: a } });
    case "listgroups":
      return yes({ type: "list", listing: { of: "groups" } });
    case "password":
      return yes({ type: "password", who: survivor, clear });
    default: {
      const rank = rankNamed(b);
      if (rank < 0) return no(`A rank is ${RANK_NAMES.join(", ")}`);
      return yes({ type: "change", op: { op: "setRank", group: a, rank } });
    }
  }
}

/**
 * The op of a member request once its survivor's ID or tribe's number is found. An addMember holds on `world`, or on every
 * world with `all`; a removeMember reaches every world the actor reaches.
 */
export function memberOp(request: Extract<PermissionsRequest, { type: "member" }>, key: string, world: number): PermissionOp {
  const c = request.change;
  if (c.op === "removeMember") return { ...c, key };
  return { ...c, key, world: request.everyWorld ? 0 : world };
}

/**
 * The `Permissions.*` command a change amounts to, as an ARK admin would type it, for the log; `everyWorld` says a
 * membership holds on every map. A chat block or a document is said only to be set, never what it is.
 */
export function changeWords(op: PermissionOp, everyWorld: boolean): string {
  const all = everyWorld ? " all" : "";
  switch (op.op) {
    case "addGroup":
      return `Permissions.AddGroup ${op.group}${op.rank ? `; Permissions.Rank ${op.group} ${RANK_NAMES[op.rank]}` : ""}`;
    case "removeGroup":
      return `Permissions.RemoveGroup ${op.group}`;
    case "setRank":
      return `Permissions.Rank ${op.group} ${RANK_NAMES[op.rank]}`;
    case "grant":
      return `Permissions.Grant ${op.group} ${op.permission}`;
    case "revoke":
      return `Permissions.Revoke ${op.group} ${op.permission}`;
    case "setChat":
      return `set the chat format of ${op.group}`;
    case "addMember": {
      const tribe = op.kind === "tribe";
      const name = `Permissions.Add${tribe ? "Tribe" : ""}${op.hours !== undefined ? "Timed" : ""}`;
      const hours = op.hours !== undefined ? ` ${op.hours} ${op.delayHours ?? 0}` : "";
      return `${name} ${op.key} ${op.group}${hours}${tribe ? "" : all}`;
    }
    case "removeMember":
      return `Permissions.Remove${op.kind === "tribe" ? "Tribe" : ""}${op.timedOnly ? "Timed" : ""} ${op.key} ${op.group}`;
    case "clearSecret":
      return `cleared the password of ${op.id}`;
    case "setDocument":
      return op.name === CHAT_DOCUMENT ? "set the chat settings" : `set the document ${op.name}`;
    case "tag":
      return `${op.show ? "showed" : "hid"} the tag ${op.tag} of ${op.id}`;
  }
}
