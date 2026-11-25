// A save's admin acts, read as tests compare them: decoded whole, or as `name`, a tab and what was done.

import { OP_ADMIN, OP_OPEN, OP_STAFF } from "../../server/acts.ts";
import type { WorldStore } from "../../server/persist/store.ts";
import { decodeAct, type Act } from "../../shared/acts.ts";

/** Every act in the save's journal, oldest first. */
export function savedActs(store: WorldStore): Act[] {
  return store
    .journal()
    .filter((j) => j.op === OP_ADMIN || j.op === OP_STAFF || j.op === OP_OPEN)
    .map((j) => decodeAct(j.data, j.seq, j.tick));
}

/** The commands in the save's journal as `name\twhat`, oldest first; with `every`, sign-ins and changes too. */
export function adminLines(store: WorldStore, every = false): string[] {
  return savedActs(store)
    .filter((a) => every || a.kind === "command")
    .map((a) => `${a.name}\t${a.what}`);
}
