// Each player's survivor has an ID shaped like a SteamID64 (shared/ids.ts), minted by the world that made it and saved on its
// record, so it stays the same through restarts and travel. Admins type it, and what later keys on a survivor keys on it.

import { ID_COUNT_RANGE, idOf, idParts } from "../shared/ids.ts";
import type { EntityRecord, Records } from "./records.ts";
import { saved } from "./saved.ts";

/** A survivor ID's number (EntityRecord.sid). Only a survivor that has one has it. */
saved({
  name: "survivor-id",
  has: (rec) => rec.sid !== 0,
  write: (rec, w) => w.varint(rec.sid),
  read(rec, r, from) {
    rec.sid = r.varint();
    if (rec.sid === 0) from.refused = true;
  },
});

/** A record's ID, or "" for one that has none. */
export function idText(rec: EntityRecord): string {
  return rec.sid === 0 ? "" : idOf(Math.floor(rec.sid / ID_COUNT_RANGE), rec.sid % ID_COUNT_RANGE);
}

/** The world's survivors by ID. */
export class SurvivorIds {
  /** Survivor pids by ID number. A record that left or lost its number may linger here, and is checked on lookup. */
  private readonly pids = new Map<number, number>();
  private readonly records: Records;

  constructor(records: Records) {
    this.records = records;
  }

  /** Gives a survivor an ID if it has none, and knows it by its ID. */
  take(rec: EntityRecord): void {
    if (rec.sid === 0) {
      rec.sid = this.records.newSurvivor();
      this.records.dirty.add(rec.pid);
    }
    this.pids.set(rec.sid, rec.pid);
  }

  /** Forgets a survivor that left. */
  drop(rec: EntityRecord): void {
    if (rec.sid !== 0 && this.pids.get(rec.sid) === rec.pid) this.pids.delete(rec.sid);
  }

  /** The survivor here with this ID, or null. */
  find(id: string): EntityRecord | null {
    const parts = idParts(id);
    if (!parts) return null;
    const sid = parts.world * ID_COUNT_RANGE + parts.n;
    const pid = this.pids.get(sid);
    const rec = pid === undefined ? undefined : this.records.byPid.get(pid);
    return rec && rec.sid === sid ? rec : null;
  }
}
