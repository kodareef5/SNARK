// Who did what as an admin, and when. Every act goes to the save's journal; the latest worth an admin's reading are also
// kept here, read back from the journal at start, and printed one line each to the server's own output.

import { decodeAct, encodeAct, type Act, type ActKind, type ActVia } from "../shared/acts.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_NAMES, RANK_OPEN } from "../shared/ranks.ts";
import type { Client } from "./game.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { Records } from "./records.ts";
import { idText } from "./survivor-ids.ts";

/** Journal op for an act (shared/acts.ts). */
export const OP_ADMIN = 2;
/** The latest acts worth reading that are kept in memory. */
export const ACTS_KEPT = 2000;

/** Who does an act. */
export interface Actor {
  readonly name: string;
  readonly id: string;
  readonly pid: number;
  readonly rank: number;
  readonly via: ActVia;
  readonly from: string;
}

/** The operator at the server's terminal, who may do anything. */
export const OPERATOR: Actor = Object.freeze({ name: "(operator)", id: "", pid: 0, rank: RANK_CLUSTER, via: "operator", from: "" });
/** An admin page whose viewer is not known. */
export const PAGE_ACTOR: Actor = Object.freeze({ name: "(admin page)", id: "", pid: 0, rank: RANK_OPEN, via: "page", from: "" });

/** A session as the actor of what it does. */
export function sessionActor(c: Client, records: Records): Actor {
  const rec = records.byPid.get(c.pid);
  return { name: c.name, id: rec ? idText(rec) : "", pid: c.pid, rank: c.rank, via: "session", from: c.conn.address ?? "" };
}

/** Cheats alone are not worth it: where every session has them, they would push out the rest. */
export function worthReading(act: Pick<Act, "rank" | "kind">): boolean {
  return act.rank >= RANK_ADMIN || act.kind !== "command";
}

/** What the server's output says of an act. It leaves out the address, which every session with cheats could read there. */
export function actLine(act: Act): string {
  return `admin: ${act.name} (${RANK_NAMES[act.rank] ?? "unknown"} rank) ${act.kind === "command" ? "" : `${act.kind}: `}${act.what}`;
}

export interface ActsContext {
  readonly persistence: Persistence | null;
  tick(): number;
  /** Wall-clock milliseconds. */
  wall(): number;
  /** The server's own output. */
  say(line: string): void;
  /** Whether each command is also shown to everyone (AdminLogging). */
  shown(): boolean;
  tellAll(text: string): void;
}

export class Acts {
  private readonly ctx: ActsContext;
  private readonly ring: Act[] = [];
  /** Where the next kept act goes once the ring is full. */
  private head = 0;
  /** The count of a world with no save, which has no journal to number its acts. */
  private seq = 0;
  /** Each actor object an act was written for, so a page's request can tell whether its handler logged anything. */
  private readonly wrote = new WeakSet<Actor>();

  constructor(ctx: ActsContext) {
    this.ctx = ctx;
    this.refill();
  }

  /** Journals an act, keeps it if it is worth reading, and returns it. */
  write(actor: Actor, what: string, kind: ActKind = "command"): Act {
    const { persistence } = this.ctx;
    const at = this.ctx.wall();
    const { name, id, pid, rank, via, from } = actor;
    const bytes = encodeAct({ at, name, id, pid, rank, via, from, kind, what });
    const seq = persistence ? persistence.journal(OP_ADMIN, bytes) : ++this.seq;
    const act: Act = { seq, at, tick: this.ctx.tick(), name, id, pid, rank, via, from, kind, what };
    this.wrote.add(actor);
    if (worthReading(act)) {
      this.keep(act);
      this.ctx.say(actLine(act));
    }
    if (kind === "command" && this.ctx.shown()) this.ctx.tellAll(`${name}: ${what}`);
    return act;
  }

  /** Whether an act was written for this very actor object. */
  wroteFor(actor: Actor): boolean {
    return this.wrote.has(actor);
  }

  /** At most `most` of the kept acts whose seq is above `after`, oldest first. */
  recent(after = 0, most = 200): Act[] {
    const n = this.ring.length;
    const out: Act[] = [];
    for (let i = 0; i < n && out.length < most; i++) {
      const act = this.ring[(this.head + i) % n]!;
      if (act.seq > after) out.push(act);
    }
    return out;
  }

  private keep(act: Act): void {
    if (this.ring.length < ACTS_KEPT) this.ring.push(act);
    else {
      this.ring[this.head] = act;
      this.head = (this.head + 1) % ACTS_KEPT;
    }
  }

  /** Reads the latest acts worth reading back from the journal, newest first, until the ring would be full. */
  private refill(): void {
    const store = this.ctx.persistence?.store;
    if (!store) return;
    const found: Act[] = [];
    for (let before = Number.MAX_SAFE_INTEGER; found.length < ACTS_KEPT; ) {
      const rows = store.journalBack(OP_ADMIN, before, ACTS_KEPT);
      for (const r of rows) {
        const act = decodeAct(r.data, r.seq, r.tick);
        if (worthReading(act) && found.length < ACTS_KEPT) found.push(act);
      }
      if (rows.length < ACTS_KEPT) break;
      before = rows.at(-1)!.seq;
    }
    for (let i = found.length - 1; i >= 0; i--) this.ring.push(found[i]!);
  }
}
