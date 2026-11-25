// Survivor IDs and team numbers a test's permissions take as issued, as a world's register would have them.

import type { Permissions } from "../../server/permissions/permissions.ts";
import { TEAM_RANGE } from "../../server/records.ts";
import { idParts } from "../../shared/ids.ts";

/** Registers each 17-digit key as a survivor ID that was issued and each shorter one as a team number that was made. */
export function issue(perms: Permissions, ...keys: string[]): void {
  const known = keys.filter((k) => idParts(k) !== null).map((id) => ({ id, name: "" }));
  if (known.length > 0 && perms.register({ origin: 0, minted: [], known }) === null) throw new Error("the register could not be written");
  for (const k of keys) {
    if (idParts(k) !== null) continue;
    const team = Number(k);
    if (!Number.isSafeInteger(team) || team < 1) throw new Error(`${k} is neither a survivor ID nor a team number`);
    const origin = Math.floor(team / TEAM_RANGE);
    if (perms.register({ origin, teams: (team % TEAM_RANGE) + 1, minted: [], known: [] }) === null) throw new Error("the register could not be written");
  }
}
