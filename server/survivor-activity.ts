import type { EntityRecord, Records } from "./records.ts";

// Save components travel with the survivor. Only completed intervals are persisted. Three f64s: the last login and the last
// time seen online (wall ms), and the play time (ms).
const ACTIVITY = 83;
const BYTES = 24;
function values(rec: EntityRecord) {
  const bytes = rec.extra.get(ACTIVITY);
  return bytes?.byteLength === BYTES ? new DataView(bytes.buffer, bytes.byteOffset, BYTES) : null;
}
export class SurvivorActivity {
  private readonly since = new Map<number, number>();
  private readonly records: Records;
  private readonly wall: () => number;
  private readonly elapsed: () => number;

  constructor(records: Records, wall = Date.now, elapsed = () => performance.now()) {
    this.records = records;
    this.wall = wall;
    this.elapsed = elapsed;
  }
  summary(rec: EntityRecord) {
    const data = values(rec),
      from = this.since.get(rec.pid);
    return {
      lastLogin: data?.getFloat64(0) ?? null,
      playMs: data ? data.getFloat64(8) + (from === undefined ? 0 : Math.max(0, this.elapsed() - from)) : null,
    };
  }
  /** When the survivor was last seen online, to its last checkpoint: now while it is online, null if it never was. */
  lastSeen(rec: EntityRecord): number | null {
    if (this.since.has(rec.pid)) return this.wall();
    return values(rec)?.getFloat64(16) ?? null;
  }
  login(pid: number) {
    const rec = this.records.byPid.get(pid);
    if (!rec || this.since.has(pid)) return;
    const total = values(rec)?.getFloat64(8) ?? 0;
    const bytes = new Uint8Array(BYTES),
      data = new DataView(bytes.buffer);
    data.setFloat64(0, this.wall());
    data.setFloat64(8, total);
    data.setFloat64(16, this.wall());
    rec.extra.set(ACTIVITY, bytes);
    this.since.set(pid, this.elapsed());
    this.records.dirty.add(pid);
  }
  checkpoint(pid: number) {
    const rec = this.records.byPid.get(pid),
      from = this.since.get(pid);
    if (!rec || from === undefined) return;
    const data = values(rec)!;
    const now = this.elapsed();
    data.setFloat64(8, data.getFloat64(8) + Math.max(0, now - from));
    data.setFloat64(16, this.wall());
    this.since.set(pid, now);
    this.records.dirty.add(pid);
  }
  checkpointAll() {
    for (const pid of this.since.keys()) this.checkpoint(pid);
  }
  leave(pid: number) {
    this.checkpoint(pid);
    this.since.delete(pid);
  }
}
