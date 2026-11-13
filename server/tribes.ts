// Who is with whom.
//
// Everything that can be owned carries one number, its team: a survivor, a
// structure row (its `owner` column), a tame. A survivor alone is a team of
// one. A tribe is a team with a name and more than one way in: it takes its
// founder's team as its own, so what the founder had is the tribe's from the
// start, and what a survivor brings when it joins becomes the tribe's too.
// Leaving takes nothing along. Every question of "may this one touch that" is
// asked here (`may`, `relation`), so that ranks and alliances have one place
// to arrive.
//
// Tribes are managed from the console in this round; the screen comes later.

import type { Rules } from "./settings/rules.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MAX_TRIBE_NAME } from "../shared/net/protocol.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** A member, and the one the tribe belongs to. (1 is kept for an admin.) */
export const RANK_MEMBER = 0;
export const RANK_OWNER = 2;

/** How two teams stand: one of them is nobody's, they are the same, or they are not. */
export const REL_NONE = 0;
export const REL_SAME = 1;
export const REL_OTHER = 2;

/** An invitation waits this long for an answer. */
export const INVITE_TICKS = 60 * TICK_RATE;
/** How near the one invited must stand: an invitation is made face to face. */
export const INVITE_RANGE = 8;

export interface Tribe {
  /** Its team. */
  readonly id: number;
  name: string;
  /** Persistent ids, in the order they joined; the owner is one of them. */
  readonly members: number[];
  owner: number;
}

interface Invite {
  tribe: number;
  by: number;
  until: number;
}

/** A tribe's name as it will be kept, or "" if it cannot be one. */
export function cleanTribeName(name: string): string {
  // Printable, single-spaced, not too long.
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean.length <= MAX_TRIBE_NAME ? clean : "";
}

export class Tribes {
  /** The server's rules, given by whoever assembles the world: how many a tribe may hold. */
  rules: Rules | null = null;
  readonly byId = new Map<number, Tribe>();
  /** Counts every change to any tribe or invitation, for sending. */
  version = 0;
  /** Called when something that is saved changed. */
  onSave: (() => void) | null = null;
  /** Called with a record whose team changed, so that its body says so. */
  onTeam: ((rec: EntityRecord) => void) | null = null;
  /** Called with a line for one survivor (by persistent id) to read. */
  onNotice: ((pid: number, text: string) => void) | null = null;
  private readonly invites = new Map<number, Invite>();
  private readonly survivor: number;
  private readonly world: ServerWorld;
  private readonly records: Records;

  constructor(world: ServerWorld, records: Records) {
    this.world = world;
    this.records = records;
    this.survivor = world.reg.index.get("core:survivor") ?? 0;
  }

  /** How team `a` stands to team `b`. */
  relation(a: number, b: number): number {
    return a === 0 || b === 0 ? REL_NONE : a === b ? REL_SAME : REL_OTHER;
  }

  /** Whether `rec` may do as an owner does with what belongs to `team`. Nobody may with what is nobody's. */
  may(rec: EntityRecord | null | undefined, team: number): boolean {
    return !!rec && this.relation(rec.team, team) === REL_SAME;
  }

  /** The tribe a record is in, or null for one alone. */
  of(rec: EntityRecord): Tribe | null {
    return this.byId.get(rec.team) ?? null;
  }

  /** The invitation `rec` has yet to answer, or null. One that has run out is forgotten here. */
  inviteOf(rec: EntityRecord): { tribe: Tribe; by: string; until: number } | null {
    const inv = this.invites.get(rec.pid);
    if (!inv) return null;
    const tribe = this.byId.get(inv.tribe);
    if (!tribe || this.world.tick >= inv.until) {
      this.invites.delete(rec.pid);
      this.version++;
      return null;
    }
    return { tribe, by: this.records.byPid.get(inv.by)?.name ?? "", until: inv.until };
  }

  /** Found a tribe. It takes the founder's team, and with it everything the founder owns. Returns what went wrong, or "". */
  create(rec: EntityRecord, name: string): string {
    if (this.of(rec)) return "you are in a tribe already; leave it first";
    const clean = cleanTribeName(name);
    if (clean === "") return `a tribe's name is 1 to ${MAX_TRIBE_NAME} characters`;
    if (rec.team === 0) return "you have no survivor yet";
    this.byId.set(rec.team, { id: rec.team, name: clean, members: [rec.pid], owner: rec.pid });
    rec.rank = RANK_OWNER;
    this.invites.delete(rec.pid);
    this.changed(rec);
    return "";
  }

  /** Ask `target` to join the tribe `by` owns. `near` says whether they stand close enough. */
  invite(by: EntityRecord, target: EntityRecord, near: boolean): string {
    const tribe = this.of(by);
    if (!tribe) return "you are not in a tribe; found one first";
    if (tribe.owner !== by.pid) return "only the tribe's owner may invite";
    if (target.pid === by.pid || target.team === tribe.id) return `${target.name} is in the tribe already`;
    if (!near) return `${target.name} is too far away: an invitation is made face to face`;
    this.invites.set(target.pid, { tribe: tribe.id, by: by.pid, until: this.world.tick + INVITE_TICKS });
    this.version++;
    this.onNotice?.(target.pid, `${by.name} invites you to join ${tribe.name}. Type "tribe accept" or "tribe decline".`);
    return "";
  }

  /** Take up an invitation: the survivor, and everything it owns, joins the tribe. */
  accept(rec: EntityRecord): string {
    const inv = this.inviteOf(rec);
    if (!inv) return "nobody has invited you";
    if (this.of(rec)) return "you are in a tribe already; leave it first";
    const tribe = inv.tribe;
    // No more members than the server allows.
    const most = this.rules ? this.rules.num("MaxNumberOfPlayersInTribe") : 0;
    if (most > 0 && tribe.members.length >= most) return `${tribe.name} has as many members as a tribe may here (${most})`;
    this.invites.delete(rec.pid);
    const was = rec.team;
    // What it built and tamed goes with it, and stays if it later leaves.
    this.world.structs.reown(was, tribe.id);
    for (const other of this.records.byPid.values()) {
      if (other.team !== was || other === rec) continue;
      other.team = tribe.id;
      this.records.dirty.add(other.pid);
      this.onTeam?.(other);
    }
    rec.team = tribe.id;
    rec.rank = RANK_MEMBER;
    for (const pid of tribe.members) this.onNotice?.(pid, `${rec.name} joined ${tribe.name}.`);
    tribe.members.push(rec.pid);
    this.changed(rec);
    return "";
  }

  decline(rec: EntityRecord): string {
    const inv = this.inviteOf(rec);
    if (!inv) return "nobody has invited you";
    this.invites.delete(rec.pid);
    this.version++;
    return "";
  }

  /** Leave a tribe, taking nothing: the survivor is a team of one again, with a team that owns nothing. */
  leave(rec: EntityRecord): string {
    const tribe = this.of(rec);
    if (!tribe) return "you are not in a tribe";
    this.remove(tribe, rec);
    for (const pid of tribe.members) this.onNotice?.(pid, `${rec.name} left ${tribe.name}.`);
    return "";
  }

  /** Put a member out. Only the owner may, and not itself. */
  kick(by: EntityRecord, name: string): string {
    const tribe = this.of(by);
    if (!tribe) return "you are not in a tribe";
    if (tribe.owner !== by.pid) return "only the tribe's owner may put a member out";
    const wanted = name.toLowerCase();
    const target = tribe.members.map((pid) => this.records.byPid.get(pid)).find((m) => m && m.name.toLowerCase() === wanted);
    if (!target) return `nobody called ${name} is in ${tribe.name}`;
    if (target.pid === by.pid) return "leave the tribe instead";
    this.remove(tribe, target);
    this.onNotice?.(target.pid, `You were put out of ${tribe.name}.`);
    for (const pid of tribe.members) if (pid !== by.pid) this.onNotice?.(pid, `${target.name} was put out of ${tribe.name}.`);
    return "";
  }

  rename(by: EntityRecord, name: string): string {
    const tribe = this.of(by);
    if (!tribe) return "you are not in a tribe";
    if (tribe.owner !== by.pid) return "only the tribe's owner may rename it";
    const clean = cleanTribeName(name);
    if (clean === "") return `a tribe's name is 1 to ${MAX_TRIBE_NAME} characters`;
    tribe.name = clean;
    this.version++;
    this.onSave?.();
    return "";
  }

  private remove(tribe: Tribe, rec: EntityRecord): void {
    tribe.members.splice(tribe.members.indexOf(rec.pid), 1);
    rec.team = this.records.newTeam();
    rec.rank = RANK_MEMBER;
    if (tribe.members.length === 0) {
      // Nobody is left: the tribe is gone. What it owned keeps its team, which is now nobody's to act for.
      this.byId.delete(tribe.id);
    } else if (tribe.owner === rec.pid) {
      // It passes to whoever has been in it longest.
      tribe.owner = tribe.members[0]!;
      const heir = this.records.byPid.get(tribe.owner);
      if (heir) {
        heir.rank = RANK_OWNER;
        this.records.dirty.add(heir.pid);
        this.onNotice?.(heir.pid, `${tribe.name} is yours now.`);
      }
    }
    this.changed(rec);
  }

  private changed(rec: EntityRecord): void {
    this.records.dirty.add(rec.pid);
    this.onTeam?.(rec);
    this.version++;
    this.onSave?.();
  }

  serialize(): string {
    return JSON.stringify([...this.byId.values()].map((t) => ({ id: t.id, name: t.name, owner: t.owner, members: t.members })));
  }

  /**
   * Take in saved tribes. Records say who is on which team; the saved list
   * gives a tribe its name, its owner and the order its members joined. A
   * member the records do not put there is dropped, one they do put there
   * and the list lacks is added, and a tribe nobody is in is forgotten.
   */
  restore(saved: string | number | null): void {
    if (typeof saved !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const raw of parsed as { id?: unknown; name?: unknown; owner?: unknown; members?: unknown }[]) {
      if (typeof raw !== "object" || raw === null || typeof raw.id !== "number" || typeof raw.name !== "string" || !Array.isArray(raw.members)) continue;
      const name = cleanTribeName(raw.name);
      if (name === "" || raw.id <= 0 || this.byId.has(raw.id)) continue;
      const members = (raw.members as unknown[]).filter((pid): pid is number => {
        const rec = typeof pid === "number" ? this.records.byPid.get(pid) : undefined;
        return !!rec && rec.team === raw.id && rec.kind === this.survivor;
      });
      this.byId.set(raw.id, { id: raw.id, name, members: [...new Set(members)], owner: typeof raw.owner === "number" ? raw.owner : 0 });
    }
    for (const rec of this.records.byPid.values()) {
      const tribe = this.byId.get(rec.team);
      if (tribe && rec.kind === this.survivor && !tribe.members.includes(rec.pid)) tribe.members.push(rec.pid);
    }
    for (const tribe of [...this.byId.values()]) {
      if (tribe.members.length === 0) this.byId.delete(tribe.id);
      else if (!tribe.members.includes(tribe.owner)) tribe.owner = tribe.members[0]!;
    }
  }
}
