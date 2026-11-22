// Renames: an id that is no longer defined, and what it is called now. A rename is not content: compileContent checks it
// apart and keeps it as a redirect (Registry.redirects).

import { f, row, type Fields, type Kind } from "../kind.ts";

/**
 * An id that used to name something, and what it is called now. A save, a ledger or a settings file that still uses the old
 * id is read as if it used the new ones. It is not content: it has no index, and the registry keeps it apart as a redirect.
 */
export interface RenameDef {
  readonly type: "rename";
  /** The id that is no longer defined. */
  readonly id: string;
  /** What it is now. More than one where a thing was split, as an engram for a whole set into one for each piece. */
  readonly to: readonly string[];
}

const FIELDS = {
  to: f("list", "a reference redirect"),
} satisfies Fields<RenameDef>;

export const renames: Kind<RenameDef> = {
  type: "rename",
  fields: FIELDS,
  rows: [
    row("rename", "rename", FIELDS, { ark: "a redirect for a class that was renamed", shelf: "renames", must: ["to"], doc: "An id that is no longer defined, and what it is called now. Saves and settings that use it still read." }),
  ],
};
