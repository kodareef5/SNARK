// A save's admin acts, read as tests compare them: decoded whole, or as `name`, a tab and what was done.

import { OP_ADMIN } from "../../server/acts.ts";
import type { WorldStore } from "../../server/persist/store.ts";
import { decodeAct, type Act } from "../../shared/acts.ts";

/** Every act in the save's journal, oldest first. */
export function savedActs(store: WorldStore): Act[] {
  return store
    .journal()
    .filter((j) => j.op === OP_ADMIN)
    .map((j) => decodeAct(j.data, j.seq, j.tick));
}

/** Every act in the save's journal as `name\twhat`, oldest first. */
export function adminLines(store: WorldStore): string[] {
  return savedActs(store).map((a) => `${a.name}\t${a.what}`);
}
