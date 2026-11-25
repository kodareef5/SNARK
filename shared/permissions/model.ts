// Permission groups as the ArkApi Permissions plugin keeps them, with a rank on each group (shared/ranks.ts). A group holds
// permission strings; survivors by their ID and tribes by their team number are its members, for good or for a time, on
// one world or on every world of the cluster. Every change is one `PermissionOp`, and `editRule` decides whether its
// actor may make it.
import { idParts } from "../ids.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_NAMES, RANK_OPEN, RANK_STAFF } from "../ranks.ts";

/** Everyone is in it without a row. It is open and holds nothing at the start. */
export const DEFAULT_GROUP = "Default";
/** Holds `*` at the start. */
export const ADMINS_GROUP = "Admins";

export interface Group {
  readonly name: string;
  readonly rank: number;
  readonly permissions: readonly string[];
  /** A chat block as JSON text, kept untouched; "" for none. */
  readonly chat: string;
}

export type MemberKind = "survivor" | "tribe";

/** A survivor (key: its ID) or a tribe (key: its team number in decimal) in a group. */
export interface Member {
  readonly kind: MemberKind;
  readonly key: string;
  readonly group: string;
  /** The world it holds on, or 0 for every world. */
  readonly world: number;
  /** In the group for good, whatever the timed part says. */
  readonly forever: boolean;
  /** The timed part, by the wall clock in milliseconds: it holds from `from` until `until`. Both 0 for none. */
  readonly from: number;
  readonly until: number;
}

export interface Secret {
  readonly id: string;
  /** The hash of the survivor's own staff password, as hex text. */
  readonly hash: string;
  /** When the survivor claimed it, by the wall clock in milliseconds; 0 where not known. */
  readonly at: number;
}

/** A named JSON text, such as the cluster's chat settings. */
export interface Document {
  readonly name: string;
  readonly text: string;
}

/** A survivor's own choice to show or hide one of its tags. */
export interface TagChoice {
  readonly id: string;
  readonly tag: string;
  readonly show: boolean;
}

/** Everything the store holds. */
export interface PermissionSnapshot {
  readonly revision: number;
  readonly groups: readonly Group[];
  readonly members: readonly Member[];
  readonly secrets: readonly Secret[];
  readonly documents: readonly Document[];
  readonly tags: readonly TagChoice[];
}

/** Who makes a change: its rank, the world it is on, and a name for the log. */
export interface PermissionActor {
  readonly rank: number;
  readonly world: number;
  readonly name: string;
}

export type PermissionOp =
  | { readonly op: "addGroup"; readonly group: string; readonly rank?: number }
  | { readonly op: "removeGroup"; readonly group: string }
  | { readonly op: "setRank"; readonly group: string; readonly rank: number }
  | { readonly op: "grant"; readonly group: string; readonly permission: string }
  | { readonly op: "revoke"; readonly group: string; readonly permission: string }
  | { readonly op: "setChat"; readonly group: string; readonly chat: string }
  | {
      readonly op: "addMember";
      readonly kind: MemberKind;
      readonly key: string;
      readonly group: string;
      readonly world?: number;
      /** Without hours the membership is for good. */
      readonly hours?: number;
      readonly delayHours?: number;
    }
  | {
      readonly op: "removeMember";
      readonly kind: MemberKind;
      readonly key: string;
      readonly group: string;
      /** Without one, every world the actor reaches. */
      readonly world?: number;
      /** Only the timed membership goes. */
      readonly timedOnly?: boolean;
    }
  | { readonly op: "clearSecret"; readonly id: string }
  | { readonly op: "setDocument"; readonly name: string; readonly text: string }
  | { readonly op: "tag"; readonly id: string; readonly tag: string; readonly show: boolean };

export const MAX_CHAT_LENGTH = 16384;
export const MAX_DOCUMENT_LENGTH = 65536;
export const HOUR_MS = 3600 * 1000;
/** The longest timed membership or delay: a hundred years. */
export const MAX_HOURS = 100 * 365 * 24;

const GROUP_NAME = /^[A-Za-z0-9_.:-]{1,32}$/;
const PERMISSION = /^[A-Za-z0-9_.:*-]{1,64}$/;
const HASH = /^[0-9a-fA-F]{16,1024}$/;

export function isGroupName(name: unknown): name is string {
  return typeof name === "string" && GROUP_NAME.test(name);
}

export function isPermission(p: unknown): p is string {
  return typeof p === "string" && PERMISSION.test(p);
}

export function isRank(rank: unknown): rank is number {
  return typeof rank === "number" && Number.isInteger(rank) && rank >= RANK_OPEN && rank <= RANK_CLUSTER;
}

export function isSurvivorId(id: unknown): id is string {
  return typeof id === "string" && idParts(id) !== null;
}

export function isTeamKey(key: unknown): key is string {
  return typeof key === "string" && /^[1-9][0-9]{0,15}$/.test(key);
}

export function isMemberKey(kind: unknown, key: unknown): boolean {
  return kind === "survivor" ? isSurvivorId(key) : kind === "tribe" ? isTeamKey(key) : false;
}

export function isWorld(world: unknown): world is number {
  return typeof world === "number" && Number.isInteger(world) && world >= 0 && world <= 65535;
}

export function isHash(hash: unknown): hash is string {
  return typeof hash === "string" && HASH.test(hash);
}

/** Whether a membership holds at `now`: for good, or inside its timed span. */
export function memberHolds(m: Member, now: number): boolean {
  return m.forever || (m.from <= now && now < m.until);
}

/** ARK's cheat names, in lower case, that are another name here. */
const ARK_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["kickplayer", "kick"],
  ["settimeofday", "settime"],
  ["saveworld", "save"],
  ["addexperience", "addxp"],
  ["giveexptoplayer", "addxp"],
  ["enablespectator", "spectate"],
  ["giveitem", "give"],
  ["giveitemnum", "give"],
  ["giveitemtoplayer", "give"],
  ["giveitemnumtoplayer", "give"],
  ["summon", "spawn"],
  ["summontamed", "spawn"],
  ["spawndino", "spawn"],
  ["spawnexactdino", "spawn"],
  ["teleport", "tp"],
  ["teleporttopos", "tp"],
  ["tpcoords", "tp"],
  ["setplayerpos", "tp"],
  ["teleporttoplayer", "tp"],
  ["teleporttoplayername", "tp"],
  ["teleportplayeridtome", "tp"],
  ["teleportplayernametome", "tp"],
  ["killplayer", "kill"],
  ["listplayers", "who"],
  ["dotame", "forcetame"],
]);

/** This game's name for a console command named as ARK names it, in lower case. */
export function arkCommand(name: string): string {
  const lower = name.toLowerCase();
  return ARK_COMMANDS.get(lower) ?? lower;
}

const CHEAT = "cheat.";

/** The form two permissions are compared in: lower case, with ARK's cheat names made this game's. */
export function permissionKey(p: string): string {
  const lower = p.toLowerCase();
  if (!lower.startsWith(CHEAT) || lower.length === CHEAT.length) return lower;
  return CHEAT + arkCommand(lower.slice(CHEAT.length));
}

/** Whether a list of permissions holds `wanted`: by `*`, by the same string, or by a prefix entry such as `Cheat.*`. */
export function holds(permissions: readonly string[], wanted: string): boolean {
  const key = permissionKey(wanted);
  for (const p of permissions) {
    if (p === "*") return true;
    const k = permissionKey(p);
    if (k === key) return true;
    if (k.endsWith(".*") && key.startsWith(k.slice(0, -1))) return true;
  }
  return false;
}

/** The permission a console command needs. */
export function commandPermission(command: string): string {
  return "Cheat." + arkCommand(command);
}

/** Whether a list of permissions lets its holder run console command `command`. */
export function mayRunCommand(permissions: readonly string[], command: string): boolean {
  return holds(permissions, commandPermission(command));
}

/**
 * Where a survivor's staff groups count, as seen from one world: in none at all, on that world alone, there and on others
 * too, or only on others.
 */
export type StaffReach = "none" | "here" | "wider" | "elsewhere";

/** What the edit rule needs to know of the store. */
export interface RuleLook {
  /** A group's rank, or undefined when there is none of that name. */
  groupRank(name: string): number | undefined;
  /** The highest rank of a staff group (rank 1 and up) the survivor is in, on any world, or 0. */
  staffRank(id: string): number;
  /** Where survivor `id`'s staff groups count, as seen from `world`. */
  staffReach(id: string, world: number): StaffReach;
  /** Whether a group has a member on any world, whose time has not run out. */
  hasMembers(name: string): boolean;
  /** Whether a world ever issued survivor ID `id`. */
  issued(id: string): boolean;
  /** Whether a world ever made team number `key`. */
  teamMade(key: string): boolean;
}

/**
 * The world a membership is kept for. An open group's is every world, as ArkApi's one database gave, and so is a cluster
 * group's. A staff group's made below cluster rank is the actor's own, and a cluster-rank actor says which.
 */
export function memberWorld(actor: PermissionActor, groupRank: number, world: number | undefined): number {
  if (groupRank < RANK_STAFF || groupRank >= RANK_CLUSTER) return 0;
  if (actor.rank < RANK_CLUSTER) return actor.world;
  return world ?? 0;
}

const isReserved = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower === DEFAULT_GROUP.toLowerCase() || lower === ADMINS_GROUP.toLowerCase();
};

/** Whether `actor` may make `op`: "" when it may, or the reason it may not. */
export function editRule(actor: PermissionActor, op: PermissionOp, look: RuleLook): string {
  if (typeof op !== "object" || op === null) return "That is not a permission change.";
  if (op.op === "tag") {
    if (!isSurvivorId(op.id)) return "That is not a survivor's ID.";
    if (!isGroupName(op.tag)) return "That is not a tag's name.";
    return typeof op.show === "boolean" ? "" : "A tag is shown or hidden.";
  }
  if (!actor || !isRank(actor.rank) || actor.rank < RANK_ADMIN) return "Permissions are managed from an admin's rank.";
  const above = (rank: number): string => (actor.rank >= rank ? "" : `That needs the ${RANK_NAMES[rank]} rank.`);
  // What a group is holds on every map, so in a cluster only the cluster's rank changes it.
  const define = (rank: number): string =>
    actor.world !== 0 && actor.rank < RANK_CLUSTER ? "In a cluster, only the cluster's admins change groups and chat settings." : above(rank);
  const survivor = (id: unknown): string => {
    if (!isSurvivorId(id)) return "That is not a survivor's ID.";
    return actor.rank >= look.staffRank(id) ? "" : "That survivor holds a higher rank than yours.";
  };
  const existing = (name: unknown): number | string => {
    if (!isGroupName(name)) return "That is not a group's name.";
    return look.groupRank(name) ?? `There is no group ${name}.`;
  };
  switch (op.op) {
    case "addGroup": {
      if (!isGroupName(op.group)) return "A group's name is up to 32 letters, digits and _ . : -";
      if (look.groupRank(op.group) !== undefined) return `There is already a group ${op.group}.`;
      const rank = op.rank ?? RANK_OPEN;
      return isRank(rank) ? define(rank) : "That is not a rank.";
    }
    case "removeGroup": {
      const rank = existing(op.group);
      if (typeof rank === "string") return rank;
      return isReserved(op.group) ? `${op.group} is always there.` : define(rank);
    }
    case "setRank": {
      const rank = existing(op.group);
      if (typeof rank === "string") return rank;
      if (!isRank(op.rank)) return "That is not a rank.";
      if (op.group.toLowerCase() === DEFAULT_GROUP.toLowerCase() && op.rank !== RANK_OPEN) return `${DEFAULT_GROUP} stays open.`;
      const why = define(rank) || above(op.rank);
      if (why || op.rank === rank || !look.hasMembers(op.group)) return why;
      return "A group's rank changes only while it has no members. Take them out first.";
    }
    case "grant":
    case "revoke": {
      const rank = existing(op.group);
      if (typeof rank === "string") return rank;
      return isPermission(op.permission) ? define(rank) : "A permission is up to 64 letters, digits and _ . : - *";
    }
    case "setChat": {
      const rank = existing(op.group);
      if (typeof rank === "string") return rank;
      if (typeof op.chat !== "string" || op.chat.length > MAX_CHAT_LENGTH) return "A chat block is text of at most 16384 letters.";
      return define(rank);
    }
    case "addMember":
    case "removeMember": {
      if (op.kind !== "survivor" && op.kind !== "tribe") return "A member is a survivor or a tribe.";
      if (!isMemberKey(op.kind, op.key)) return op.kind === "survivor" ? "That is not a survivor's ID." : "That is not a tribe's number.";
      // A number not made yet would be handed with its groups to whoever is given it. One taken out need not exist.
      if (op.op === "addMember" && op.kind === "survivor" && !look.issued(op.key)) return `No survivor has the ID ${op.key}.`;
      if (op.op === "addMember" && op.kind === "tribe" && !look.teamMade(op.key)) return `No tribe has the number ${op.key}.`;
      const rank = existing(op.group);
      if (typeof rank === "string") return rank;
      if (op.group.toLowerCase() === DEFAULT_GROUP.toLowerCase()) return `Everyone is in ${DEFAULT_GROUP}.`;
      const ranked = above(rank);
      if (ranked) return ranked;
      if (op.kind === "tribe" && rank > RANK_OPEN) return "A tribe is put only in an open group.";
      if (op.kind === "survivor") {
        const why = survivor(op.key);
        if (why) return why;
      }
      if (op.world !== undefined) {
        if (!isWorld(op.world)) return "That is not a world.";
        if (rank >= RANK_STAFF && actor.rank < RANK_CLUSTER && op.world !== actor.world) return "A staff membership is made on its own world, or by the cluster.";
      }
      if (op.op === "removeMember") return op.timedOnly === undefined || typeof op.timedOnly === "boolean" ? "" : "Say whether only the timed part goes.";
      if (op.hours === undefined) return op.delayHours === undefined ? "" : "A delay goes with hours.";
      if (typeof op.hours !== "number" || !(op.hours > 0) || op.hours > MAX_HOURS) return "Hours are more than none and at most a hundred years.";
      const delay = op.delayHours ?? 0;
      if (typeof delay !== "number" || !(delay >= 0) || delay > MAX_HOURS) return "A delay is no hours or more, and at most a hundred years.";
      return "";
    }
    case "clearSecret": {
      const why = survivor(op.id);
      if (why) return why;
      if (actor.world === 0 || actor.rank >= RANK_CLUSTER) return "";
      // A cleared password can be claimed again with the character's key alone, and it is the survivor's on every map. Below
      // the cluster's rank an admin clears it for staff of their own map, and for staff of other maps too only from a higher rank.
      const reach = look.staffReach(op.id, actor.world);
      if (reach === "elsewhere") return "That survivor's staff groups are on other maps. An admin there or the cluster's clears their password.";
      if (reach === "wider" && actor.rank <= look.staffRank(op.id)) return "That survivor's staff groups reach beyond this map. A higher rank or the cluster's admin clears their password.";
      return "";
    }
    case "setDocument":
      if (!isGroupName(op.name)) return "A document's name is up to 32 letters, digits and _ . : -";
      if (typeof op.text !== "string" || op.text.length > MAX_DOCUMENT_LENGTH) return "A document is text of at most 65536 letters.";
      return define(RANK_ADMIN);
    default:
      return "That is not a permission change.";
  }
}
