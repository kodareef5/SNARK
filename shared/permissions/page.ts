// What a world's Permissions page (client/admin/permissions.ts) reads and sends, and the routes that answer it. Each path
// is under the world's own admin address, as every world page's API is.
import type { Group, HistoryRow, Member, PermissionOp } from "./model.ts";

/** GET: the state, or with key=<key> the answer that it is the same. */
export const PERMISSIONS_STATE = "/admin/permissions.json";
/** GET: the cluster's history, before=<seq> and most=<n>. */
export const PERMISSIONS_HISTORY = "/admin/permissions-history.json";
/** POST: a change, an import's check, or an import. */
export const PERMISSIONS_API = "/admin/permissions-change";
export const PERMISSIONS_PATHS: readonly string[] = [PERMISSIONS_STATE, PERMISSIONS_HISTORY, PERMISSIONS_API];
/** The API's paths when the page was the cluster's, which answer 404 now. */
export const OLD_PERMISSIONS_PATHS: readonly string[] = ["/admin/permissions/state", "/admin/permissions/api"];

/** How often a page open and visible asks whether the state changed, in milliseconds. */
export const PERMISSIONS_REFRESH_MS = 10_000;

/** What the importer says of a database in write-ahead-log mode given without its -wal file; the page says it too. */
export const WAL_MISSING =
  "This database keeps its newest changes in the file beside it whose name ends in -wal until the ARK server is stopped. Stop the server first, or give that file too, or those changes are left out.";

/** The name of the document that holds the cluster's chat settings. */
export const CHAT_DOCUMENT = "chat";

/** GET /admin/permissions/state */
export interface PermissionsState {
  /** Changes whenever anything the state is made from changes; sent back as key=, it is answered with PermissionsSame. */
  key: string;
  /** The viewer: name, survivor ID ("" when signed in with a host password), rank, and this world's id (0 outside a cluster). */
  me: { name: string; id: string; rank: number; world: number };
  /** False where the server keeps permissions in memory only (a world with no save). */
  saved: boolean;
  revision: number;
  groups: Group[];
  /** Every membership; `name` is the survivor's or tribe's name where this world or the register knows it, else "". */
  members: (Member & { name: string })[];
  /** The survivors who have claimed a staff password, and when by the wall clock (0 where not known). Never a hash. */
  passwords: { id: string; at: number }[];
  /** The chat settings document: JSON text in CrossChat's keys, "" for none. */
  document: string;
  /** This world's survivors and tribes, for choosing one by name. */
  survivors: { id: string; name: string; online: boolean }[];
  tribes: { team: number; name: string }[];
  /** Every survivor ID a world of the cluster issued: its survivor's name and the world it was on, as last known. */
  register: { id: string; name: string; world: number }[];
  /** The console commands that ask for cheats, for offering Cheat.<command>. */
  commands: string[];
  worlds: { id: number; name: string }[];
}

/** The state's answer when the key sent still holds. */
export interface PermissionsSame {
  same: true;
  key: string;
}

/** GET PERMISSIONS_HISTORY: rows newest first, and whether older ones are left. */
export interface PermissionsHistory {
  rows: HistoryRow[];
  more: boolean;
}

export type ImportKind = "arkapi" | "commands" | "crosschat";

/**
 * POST PERMISSIONS_API. An ArkApi file's `text` is the file as base64, and `wal` its -wal file as base64 where given; the
 * other kinds' is the pasted text. `plan` is the dry run, and `import` applies it only while its `digest` is the plan's.
 */
export type PermissionsPost =
  | { do: "op"; op: PermissionOp }
  | { do: "plan"; kind: ImportKind; text: string; wal?: string }
  | { do: "import"; kind: ImportKind; text: string; wal?: string; digest: string };

export interface PermissionsAnswer {
  ok: boolean;
  why: string;
  /** An import's notes, the changes it would make or made, and what was refused. */
  notes?: string[];
  ops?: number;
  refused?: { what: string; why: string }[];
  /** A plan's digest of its changes, which its import sends back. */
  digest?: string;
  /** A whole value someone changed meanwhile: what it is now (a chat block, the settings' text, or a rank). */
  current?: string | number;
}
