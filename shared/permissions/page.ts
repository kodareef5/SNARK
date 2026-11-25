// What the admin console's Permissions page (client/admin/permissions.ts) reads and sends, and the routes that answer it.
import type { Group, Member, PermissionOp } from "./model.ts";

export const PERMISSIONS_STATE = "/admin/permissions/state";
export const PERMISSIONS_API = "/admin/permissions/api";
export const PERMISSIONS_PATHS: readonly string[] = [PERMISSIONS_STATE, PERMISSIONS_API];

/** The name of the document that holds the cluster's chat settings. */
export const CHAT_DOCUMENT = "chat";

/** GET /admin/permissions/state */
export interface PermissionsState {
  /** The viewer: name, survivor ID ("" when signed in with a host password), rank, and this world's id (0 outside a cluster). */
  me: { name: string; id: string; rank: number; world: number };
  /** False where the server keeps permissions in memory only (a world with no save). */
  saved: boolean;
  revision: number;
  groups: Group[];
  /** Every membership; `name` is the survivor's or tribe's name where this world knows it, else "". */
  members: (Member & { name: string })[];
  /** The survivors who have claimed a staff password, and when by the wall clock (0 where not known). Never a hash. */
  passwords: { id: string; at: number }[];
  /** The chat settings document: JSON text in CrossChat's keys, "" for none. */
  document: string;
  /** This world's survivors and tribes, for choosing one by name. */
  survivors: { id: string; name: string; online: boolean }[];
  tribes: { team: number; name: string }[];
  /** The console commands that ask for cheats, for offering Cheat.<command>. */
  commands: string[];
  worlds: { id: number; name: string }[];
}

export type ImportKind = "arkapi" | "commands" | "crosschat";

/** POST /admin/permissions/api. An ArkApi file's `text` is the file as base64; the other kinds' is the pasted text. */
export type PermissionsPost =
  | { do: "op"; op: PermissionOp }
  /** `plan` is the dry run and `import` applies it. */
  | { do: "plan" | "import"; kind: ImportKind; text: string };

export interface PermissionsAnswer {
  ok: boolean;
  why: string;
  /** An import's notes, the changes it would make or made, and what was refused. */
  notes?: string[];
  ops?: number;
  refused?: { what: string; why: string }[];
}
