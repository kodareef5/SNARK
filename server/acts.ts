// Who did what as an admin, and when. Every act goes to the save's journal. The latest by an actor who proved a rank are
// kept here and printed one line each to the server's own output. The latest open commands, which creative mode for all
// and open groups' permissions let anyone run, are kept apart in a smaller list. Both are read back from the journal at start.

import { decodeAct, encodeAct, openOnly, type Act, type ActKind, type ActVia } from "../shared/acts.ts";
import { RANK_CLUSTER, RANK_NAMES, RANK_OPEN, RANK_STAFF } from "../shared/ranks.ts";
import type { Client } from "./game.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { Records } from "./records.ts";
import { idText } from "./survivor-ids.ts";

/** Journal op for an act (shared/acts.ts). */
export const OP_ADMIN = 2;
/** The latest acts by an actor who proved a rank that are kept in memory. */
export const ACTS_KEPT = 2000;
/** The latest open commands kept in memory, apart from those. */
export const ACTS_OPEN_KEPT = 500;

/** Who does an act. */
export interface Actor {
  readonly name: string;
  readonly id: string;
  readonly pid: number;
  readonly rank: number;
  readonly via: ActVia;
  readonly from: string;
  /** The rank held apart from any group. A permission change is judged from it and a sign-in's groups, never from `rank`. */
  readonly baseRank: number;
  /** The hash of the survivor's own password it signed in with. Only the permissions' own check reads it. */
  readonly signedHash?: string;
  /** It proved nothing: what it runs, it runs under creative mode for all or by an open group's permission. Only a session is. */
  readonly open: boolean;
}

/** The operator at the server's terminal, who may do anything. */
export const OPERATOR: Actor = Object.freeze({ name: "(operator)", id: "", pid: 0, rank: RANK_CLUSTER, via: "operator", from: "", baseRank: RANK_CLUSTER, open: false });
/** An admin page whose viewer is not known. */
export const PAGE_ACTOR: Actor = Object.freeze({ name: "(admin page)", id: "", pid: 0, rank: RANK_OPEN, via: "page", from: "", baseRank: RANK_OPEN, open: false });

/** A session as the actor of what it does. */
export function sessionActor(c: Client, records: Records): Actor {
  const rec = records.byPid.get(c.pid);
  return {
    name: c.name, id: rec ? idText(rec) : "", pid: c.pid, rank: c.rank, via: "session", from: c.conn.address ?? "", baseRank: c.passwordRank,
    signedHash: c.signedHash, open: c.proved < RANK_STAFF,
  };
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

/** The latest acts, oldest first, each list in the order of its sequence numbers. */
class Ring {
  private readonly acts: Act[] = [];
  /** Where the next act goes once the ring is full. */
  private head = 0;
  readonly most: number;

  constructor(most: number) {
    this.most = most;
  }

  push(act: Act): void {
    if (this.acts.length < this.most) this.acts.push(act);
    else {
      this.acts[this.head] = act;
      this.head = (this.head + 1) % this.most;
    }
  }

  /** At most `most` acts whose seq is above `after`, oldest first. */
  after(after: number, most: number): Act[] {
    const n = this.acts.length;
    const out: Act[] = [];
    for (let i = 0; i < n && out.length < most; i++) {
      const act = this.acts[(this.head + i) % n]!;
      if (act.seq > after) out.push(act);
    }
    return out;
  }
}

export class Acts {
  private readonly ctx: ActsContext;
  private readonly kept = new Ring(ACTS_KEPT);
  private readonly open = new Ring(ACTS_OPEN_KEPT);
  /** The count of a world with no save, which has no journal to number its acts. It starts at the clock, so it never goes back over a restart. */
  private seq: number;
  /** Each actor object an act was written for, so a page's request can tell whether its handler logged anything. */
  private readonly wrote = new WeakSet<Actor>();

  constructor(ctx: ActsContext) {
    this.ctx = ctx;
    this.seq = Math.floor(ctx.wall());
    this.refill();
  }

  /** Journals an act, keeps it in one list or the other, and returns it. Only a kept act is printed. */
  write(actor: Actor, what: string, kind: ActKind = "command"): Act {
    const { persistence } = this.ctx;
    const at = this.ctx.wall();
    const { name, id, pid, rank, via, from } = actor;
    const open = actor.open === true;
    const bytes = encodeAct({ at, name, id, pid, rank, via, from, kind, what, open });
    const seq = persistence ? persistence.journal(OP_ADMIN, bytes) : ++this.seq;
    const act: Act = { seq, at, tick: this.ctx.tick(), name, id, pid, rank, via, from, kind, what, open };
    this.wrote.add(actor);
    if (openOnly(act)) this.open.push(act);
    else {
      this.kept.push(act);
      this.ctx.say(actLine(act));
    }
    if (kind === "command" && this.ctx.shown()) this.ctx.tellAll(`${name}: ${what}`);
    return act;
  }

  /** Whether an act was written for this very actor object. */
  wroteFor(actor: Actor): boolean {
    return this.wrote.has(actor);
  }

  /** At most `most` of the kept acts whose seq is above `after`, oldest first. The open commands are left out. */
  recent(after = 0, most = 200): Act[] {
    return this.kept.after(after, most);
  }

  /** At most `most` acts of both lists whose seq is above `after`, oldest first. */
  recentWithOpen(after = 0, most = 200): Act[] {
    const a = this.kept.after(after, most);
    const b = this.open.after(after, most);
    const out: Act[] = [];
    for (let i = 0, j = 0; out.length < most && (i < a.length || j < b.length); ) {
      out.push(j >= b.length || (i < a.length && a[i]!.seq < b[j]!.seq) ? a[i++]! : b[j++]!);
    }
    return out;
  }

  /** Reads the latest of each list back from the journal, newest first, until both would be full or the journal ends. */
  private refill(): void {
    const store = this.ctx.persistence?.store;
    if (!store) return;
    const kept: Act[] = [];
    const open: Act[] = [];
    for (let before = Number.MAX_SAFE_INTEGER; kept.length < ACTS_KEPT || open.length < ACTS_OPEN_KEPT; ) {
      const rows = store.journalBack(OP_ADMIN, before, ACTS_KEPT);
      for (const r of rows) {
        const act = decodeAct(r.data, r.seq, r.tick);
        const into = openOnly(act) ? open : kept;
        if (into.length < (into === open ? ACTS_OPEN_KEPT : ACTS_KEPT)) into.push(act);
      }
      if (rows.length < ACTS_KEPT) break;
      before = rows.at(-1)!.seq;
    }
    for (let i = kept.length - 1; i >= 0; i--) this.kept.push(kept[i]!);
    for (let i = open.length - 1; i >= 0; i--) this.open.push(open[i]!);
  }
}
