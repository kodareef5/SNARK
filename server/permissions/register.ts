// A world's part in the permissions register (server/permissions/store.ts): its counters never go back past what the
// register holds, and each survivor ID it makes or comes to know is written there, a write only on a tick that has one.
import type { EntityRecord, Records } from "../records.ts";
import { idText } from "../survivor-ids.ts";
import { POLL_MS, type Issue, type Permissions } from "./permissions.ts";

/** What the operator is told when a write fails. */
const FAILED = `the permissions register could not be written: it is tried again in ${POLL_MS / 1000} s`;

/** Raises the world's counters to the register's marks where the save is behind them, as after a restore or a wipe. */
export function catchUp(permissions: Pick<Permissions, "marks">, records: Records, say: (line: string) => void): void {
  const marks = permissions.marks(records.worldId);
  if (marks.survivor > records.nextSurvivor) {
    say(`the save is behind the permissions register: survivor numbers go on from ${marks.survivor}, not ${records.nextSurvivor}`);
    records.nextSurvivor = marks.survivor;
  }
  if (marks.team > records.nextTeam) {
    say(`the save is behind the permissions register: team numbers go on from ${marks.team}, not ${records.nextTeam}`);
    records.nextTeam = marks.team;
  }
}

export class IdRegister {
  private readonly permissions: Pick<Permissions, "register" | "now">;
  private readonly records: Records;
  private readonly say: (line: string) => void;
  private readonly minted = new Map<string, string>();
  private readonly known = new Map<string, string>();
  /** The counters as last written; -1 before the first write. */
  private survivors = -1;
  private teams = -1;
  /** No write is tried before this wall time, after one failed. */
  private retryAt = -Infinity;
  private failing = false;

  constructor(permissions: Pick<Permissions, "register" | "now">, records: Records, say: (line: string) => void) {
    this.permissions = permissions;
    this.records = records;
    this.say = say;
  }

  /** A survivor whose ID this world just made. */
  made(rec: EntityRecord): void {
    const id = idText(rec);
    if (id === "") return;
    this.known.delete(id);
    this.minted.set(id, rec.name);
  }

  /** A survivor whose ID was made before or elsewhere, or whose name changed. */
  knows(rec: EntityRecord): void {
    const id = idText(rec);
    if (id === "") return;
    if (this.minted.has(id)) this.minted.set(id, rec.name);
    else this.known.set(id, rec.name);
  }

  /** Whether there is anything to write. Two compares when there is not. */
  due(): boolean {
    return this.records.nextSurvivor !== this.survivors || this.records.nextTeam !== this.teams || this.minted.size > 0 || this.known.size > 0;
  }

  /** Writes what is due in one transaction, unless a write failed less than the poll interval ago. */
  write(): void {
    if (!this.due() || this.permissions.now() < this.retryAt) return;
    const survivors = this.records.nextSurvivor;
    const teams = this.records.nextTeam;
    const minted: Issue[] = [...this.minted].map(([id, name]) => ({ id, name }));
    const known: Issue[] = [...this.known].map(([id, name]) => ({ id, name }));
    const dropped = this.permissions.register({ origin: this.records.worldId, survivors, teams, minted, known });
    if (dropped === null) {
      this.retryAt = this.permissions.now() + POLL_MS;
      if (!this.failing) this.say(FAILED);
      this.failing = true;
      return;
    }
    this.failing = false;
    this.retryAt = -Infinity;
    this.survivors = survivors;
    this.teams = teams;
    this.minted.clear();
    this.known.clear();
    if (dropped > 0) this.say(`the permissions register took out ${dropped} ${dropped === 1 ? "row" : "rows"} that named survivor IDs or team numbers before they were made`);
  }
}
