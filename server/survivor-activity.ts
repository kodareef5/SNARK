import type { EntityRecord, Records } from "./records.ts";

// Save components travel with the survivor. Only completed intervals are persisted.
const ACTIVITY = 83;
function values(rec: EntityRecord) {
  const bytes = rec.extra.get(ACTIVITY);
  return bytes?.byteLength === 16 ? new DataView(bytes.buffer, bytes.byteOffset, 16) : null;
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
  login(pid: number) {
    const rec = this.records.byPid.get(pid);
    if (!rec || this.since.has(pid)) return;
    const total = values(rec)?.getFloat64(8) ?? 0;
    const bytes = new Uint8Array(16),
      data = new DataView(bytes.buffer);
    data.setFloat64(0, this.wall());
    data.setFloat64(8, total);
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
