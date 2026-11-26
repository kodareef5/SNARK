// Who did what as an admin, and when. Every act goes to the save's journal. The latest by an actor who proved a rank are
// kept here and printed one line each to the server's own output. The latest open commands, which creative mode for all
// and open groups' permissions let anyone run, are kept apart in a smaller list. Both are read back from the journal at start.

import { actText, decodeAct, encodeAct, openOnly, type Act, type ActKind, type ActVia } from "../shared/acts.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_NAMES, RANK_OPEN, RANK_STAFF } from "../shared/ranks.ts";
import type { Client } from "./game.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { Records } from "./records.ts";
import { idText } from "./survivor-ids.ts";

/** Journal op for an act (shared/acts.ts). The save counts these on their own, so no other entry pushes them out. */
export const OP_ADMIN = 2;
/** Journal op for an open command: anyone may make many, so they are counted with the rest. A save from before has them under OP_ADMIN. */
export const OP_OPEN = 4;
/** Journal op for an act by one who proved less than an admin's rank, counted on its own: a moderator's acts never push an admin's out. */
export const OP_STAFF = 5;
/** The latest acts by an actor who proved a rank that are kept in memory. */
export const ACTS_KEPT = 2000;
/** The latest acts by actors below an admin's rank kept in memory, apart from an admin's. */
export const ACTS_STAFF_KEPT = 1000;
/** The latest open commands kept in memory, apart from those. */
export const ACTS_OPEN_KEPT = 500;

/**
 * Whose list an act is kept in: an admin's, a staff member's, or the open commands'. Each is counted on its own, in memory
 * and in the save, so no number of acts by a lower one pushes a higher one's out. An older entry of no known rank is an admin's.
 */
type Tier = "admin" | "staff" | "open";
const tierOf = (act: Pick<Act, "open" | "kind" | "rank">): Tier => (openOnly(act) ? "open" : act.rank >= RANK_ADMIN || act.rank < 0 ? "admin" : "staff");
const TIER_OP: Record<Tier, number> = { admin: OP_ADMIN, staff: OP_STAFF, open: OP_OPEN };
/** The most letters of an act's words and of its actor's name: an act is one line, whatever was typed. */
const WHAT_MOST = 500;
const NAME_MOST = 64;
/** The most letters of what was tried, and of why it was refused, in a refused act. */
const TRIED_MOST = 300;
const WHY_MOST = 200;

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

/** What a refused act says: what was tried, then why, each short and on one line. */
function refusedWords(tried: string, why: string): string {
  return `${actText(tried, TRIED_MOST)}: ${actText(why, WHY_MOST)}`;
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
  private readonly rings: Record<Tier, Ring> = { admin: new Ring(ACTS_KEPT), staff: new Ring(ACTS_STAFF_KEPT), open: new Ring(ACTS_OPEN_KEPT) };
  /** The count of a world with no save, which has no journal to number its acts. It starts at the clock, so it never goes back over a restart. */
  private seq: number;
  /** Each actor object an act was written for, so a page's request can tell whether its handler logged anything. */
  private readonly wrote = new WeakSet<Actor>();

  constructor(ctx: ActsContext) {
    this.ctx = ctx;
    this.seq = Math.floor(ctx.wall());
    this.refill();
  }

  /**
   * Journals an act, keeps it in one list or the other, and returns it. Only a kept act is printed. `rank` is the rank it
   * was judged at, where that is not the actor's own, as a permission change is judged inside its write.
   */
  write(actor: Actor, what: string, kind: ActKind = "command", rank = actor.rank): Act {
    const { persistence } = this.ctx;
    const at = this.ctx.wall();
    const { id, pid, via, from } = actor;
    // A line typed with a break in it, or with marks that turn text around, would read as another actor's act.
    const name = actText(actor.name, NAME_MOST);
    what = actText(what, WHAT_MOST);
    const open = actor.open === true;
    const bytes = encodeAct({ at, name, id, pid, rank, via, from, kind, what, open });
    const tier = tierOf({ open, kind, rank });
    const seq = persistence ? persistence.journal(TIER_OP[tier], bytes) : ++this.seq;
    const act: Act = { seq, at, tick: this.ctx.tick(), name, id, pid, rank, via, from, kind, what, open };
    this.wrote.add(actor);
    this.rings[tier].push(act);
    if (tier !== "open") this.ctx.say(actLine(act));
    if (kind === "command" && this.ctx.shown()) this.ctx.tellAll(`${name}: ${what}`);
    return act;
  }

  /** Logs an attempt refused to an actor judged at `rank`, at that rank, if it is an admin's: below it, anyone could fill the journal. */
  refused(actor: Actor, rank: number, tried: string, why: string): void {
    if (rank >= RANK_ADMIN) this.write(actor, refusedWords(tried, why), "refused", rank);
  }

  /** Whether an act was written for this very actor object. */
  wroteFor(actor: Actor): boolean {
    return this.wrote.has(actor);
  }

  /** At most `most` of the acts by admins and staff whose seq is above `after`, oldest first. The open commands are left out. */
  recent(after = 0, most = 200): Act[] {
    return this.merged(["admin", "staff"], after, most);
  }

  /** At most `most` acts of every list whose seq is above `after`, oldest first. */
  recentWithOpen(after = 0, most = 200): Act[] {
    return this.merged(["admin", "staff", "open"], after, most);
  }

  /** The oldest `most` acts above `after` of several lists, in the order of their sequence numbers. */
  private merged(tiers: readonly Tier[], after: number, most: number): Act[] {
    const out: Act[] = [];
    for (const tier of tiers) out.push(...this.rings[tier].after(after, most));
    return out.sort((a, b) => a.seq - b.seq).slice(0, most);
  }

  /** Reads the latest of each list back from the journal, newest first, until each would be full or its entries end. */
  private refill(): void {
    const store = this.ctx.persistence?.store;
    if (!store) return;
    const found: Record<Tier, Act[]> = { admin: [], staff: [], open: [] };
    // Each op is read until its own list is full. A save from before the lists had ops of their own has every act under
    // OP_ADMIN, and those of another list met on the way are taken into it.
    for (const tier of ["admin", "staff", "open"] as const) {
      for (let before = Number.MAX_SAFE_INTEGER; found[tier].length < this.rings[tier].most; ) {
        const rows = store.journalBack(TIER_OP[tier], before, ACTS_KEPT);
        for (const r of rows) {
          const act = decodeAct(r.data, r.seq, r.tick);
          const into = tierOf(act);
          if (found[into].length < this.rings[into].most) found[into].push(act);
        }
        if (rows.length < ACTS_KEPT) break;
        before = rows.at(-1)!.seq;
      }
    }
    for (const tier of ["admin", "staff", "open"] as const) {
      const list = found[tier].sort((a, b) => a.seq - b.seq).slice(-this.rings[tier].most);
      for (const act of list) this.rings[tier].push(act);
    }
  }
}
