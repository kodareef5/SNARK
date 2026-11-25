// A world's part in the permissions register (server/permissions/store.ts): its counters never go back past what the
// register holds, and each survivor ID it makes or comes to know is written there, a write only on a tick that has one.
import { idParts } from "../../shared/ids.ts";
import { RANK_STAFF } from "../../shared/ranks.ts";
import type { EntityRecord, Records } from "../records.ts";
import { idText } from "../survivor-ids.ts";
import { POLL_MS, type Issue, type Permissions } from "./permissions.ts";

/** The most lost survivors the operator is told of one by one. */
const LOST_MOST = 20;

/** What the operator is told when a write fails. */
const FAILED = `the permissions register could not be written: it is tried again in ${POLL_MS / 1000} s`;

/**
 * Raises the world's counters to the register's marks where the save is behind them, as after a restore or a wipe.
 * Answers the survivor count the save had if it was behind, else -1.
 */
export function catchUp(permissions: Pick<Permissions, "marks">, records: Records, say: (line: string) => void): number {
  const marks = permissions.marks(records.worldId);
  const had = marks.survivor > records.nextSurvivor ? records.nextSurvivor : -1;
  if (marks.survivor > records.nextSurvivor) {
    say(`the save is behind the permissions register: survivor numbers go on from ${marks.survivor}, not ${records.nextSurvivor}`);
    records.nextSurvivor = marks.survivor;
  }
  if (marks.team > records.nextTeam) {
    say(`the save is behind the permissions register: team numbers go on from ${marks.team}, not ${records.nextTeam}`);
    records.nextTeam = marks.team;
  }
  return had;
}

/**
 * After a save was behind: tells the operator of each survivor this world made from count `from` on that is in no save
 * here now and still holds a staff group or a password. Their password still opens the admin pages, and only the
 * operator knows whether it should.
 */
export function tellLost(permissions: Permissions, origin: number, from: number, here: (id: string) => boolean, say: (line: string) => void): void {
  let more = 0;
  let told = 0;
  for (const row of permissions.allIssued()) {
    const parts = idParts(row.id);
    // One last known on another map travelled there, and is that map's.
    if (!parts || parts.world !== origin || parts.n < from || row.world !== permissions.world || here(row.id)) continue;
    const groups = [...new Set(permissions.membersOf("survivor", row.id).filter((m) => (permissions.group(m.group)?.rank ?? 0) >= RANK_STAFF).map((m) => m.group))];
    const password = permissions.secretOf(row.id) !== "";
    if (groups.length === 0 && !password) continue;
    if (told >= LOST_MOST) {
      more++;
      continue;
    }
    told++;
    const holds = [groups.length > 0 ? `is still in ${groups.join(", ")}` : "", password ? "has a password" : ""].filter((part) => part !== "").join(" and ");
    const undo = [groups.length > 0 ? "Permissions.Remove" : "", password ? `Permissions.Password ${row.id} clear` : ""].filter((part) => part !== "").join(" and ");
    say(`the save no longer has ${row.name || "a survivor"} (${row.id}), who ${holds}: ${undo} ${groups.length > 0 && password ? "take those" : "takes that"} away`);
  }
  if (more > 0) say(`the save no longer has ${more} more who hold a staff group or a password: the Permissions page lists them`);
}

export class IdRegister {
  private readonly permissions: Pick<Permissions, "register" | "now">;
  private readonly records: Records;
  private readonly say: (line: string) => void;
  private readonly minted = new Map<string, Issue>();
  private readonly known = new Map<string, Issue>();
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
    this.minted.set(id, { id, name: rec.name, team: rec.team });
  }

  /** A survivor whose ID was made before or elsewhere, or whose team changed: the rule asks who is in a tribe. */
  knows(rec: EntityRecord): void {
    const id = idText(rec);
    if (id === "") return;
    (this.minted.has(id) ? this.minted : this.known).set(id, { id, name: rec.name, team: rec.team });
  }

  /** Whether there is anything to write. Two compares when there is not. */
  due(): boolean {
    return this.records.nextSurvivor !== this.survivors || this.records.nextTeam !== this.teams || this.minted.size > 0 || this.known.size > 0;
  }

  /** Writes what is due in one transaction, unless a write failed less than the poll interval ago. */
  write(): void {
    if (!this.due()) return;
    // A clock put back does not make the wait longer than it was.
    const wait = this.retryAt - this.permissions.now();
    if (wait > 0 && wait <= POLL_MS) return;
    const survivors = this.records.nextSurvivor;
    const teams = this.records.nextTeam;
    const minted: Issue[] = [...this.minted.values()];
    const known: Issue[] = [...this.known.values()];
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
