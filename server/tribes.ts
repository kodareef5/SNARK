// Everything ownable carries one team number. A survivor alone is a team of one, and a tribe takes its founder's
// team as its own. Every "may this one touch that" question goes through `may` and `relation`.

import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Rules } from "./settings/rules.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MAX_TRIBE_NAME, OWN_TRIBE } from "../shared/net/protocol.ts";
import { NAME_UNCLEAR, meant } from "./names.ts";
import type { GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The count is one byte on the wire. A larger tribe sends only its first members. */
const MAX_MEMBERS_SENT = 255;

/** 1 is reserved for an admin rank. */
export const RANK_MEMBER = 0;
export const RANK_OWNER = 2;

/** REL_NONE means one of the two teams is 0. */
export const REL_NONE = 0;
export const REL_SAME = 1;
export const REL_OTHER = 2;

export const INVITE_TICKS = 60 * TICK_RATE;
/** Metres. An invitation is made face to face. */
export const INVITE_RANGE = 8;

export interface Tribe {
  readonly id: number;
  name: string;
  /** Record ids in the order they joined. The owner is one of them. */
  readonly members: number[];
  owner: number;
}

interface Invite {
  tribe: number;
  by: number;
  until: number;
}

/** Returns "" if the name cannot be a tribe's name. */
export function cleanTribeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean.length <= MAX_TRIBE_NAME ? clean : "";
}

const TRIBE_CREATE = event("tribe.create");
const TRIBE_CREATED = event("tribe.created");
const TRIBE_INVITE = event("tribe.invite");
const TRIBE_JOIN = event("tribe.join");
const TRIBE_JOINED = event("tribe.joined");
const TRIBE_LEAVE = event("tribe.leave");
const TRIBE_RENAMED = event("tribe.renamed");
const STRUCTURE_OWNER = event("structure.owner");

export class Tribes {
  rules: Rules | null = null;
  bus: Bus = NO_BUS;
  readonly byId = new Map<number, Tribe>();
  /** Counts every change to any tribe or invitation, for sending. */
  version = 0;
  /** Called when something that is saved changed. */
  onSave: (() => void) | null = null;
  /** Called with a record whose team changed, so its body can show it. */
  onTeam: ((rec: EntityRecord) => void) | null = null;
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

  /**
   * Registers what a session is told of its tribe and of an invitation to one (OWN_TRIBE). It is sent whenever any tribe
   * changes, a session comes or goes, or the invitation it was shown expires. `online` says whether a member is connected.
   */
  tell(game: GameServer, online: (pid: number) => boolean): void {
    game.own.group(OWN_TRIBE, (c, rec) => {
      // The version it was sent, and the tick the invitation it was shown expires, or 0.
      const sent = (c.sent[OWN_TRIBE] ??= { version: -1, until: 0 }) as { version: number; until: number };
      if (this.version === sent.version && (sent.until === 0 || this.world.tick < sent.until)) return;
      const invite = this.inviteOf(rec);
      const tribe = this.of(rec);
      const w = game.beginOwn(OWN_TRIBE);
      w.varint(rec.team);
      w.string(tribe ? tribe.name : "");
      if (tribe) {
        w.u8(rec.rank);
        const n = Math.min(tribe.members.length, MAX_MEMBERS_SENT);
        w.u8(n);
        for (let i = 0; i < n; i++) {
          const pid = tribe.members[i]!;
          w.string(this.records.byPid.get(pid)?.name ?? "");
          w.bool(online(pid));
          w.bool(pid === tribe.owner);
        }
      }
      w.string(invite ? invite.tribe.name : "");
      if (invite) w.string(invite.by);
      game.endOwn(c);
      sent.version = this.version;
      sent.until = invite ? invite.until : 0;
    });
  }

  /** Returns a REL_ value. */
  relation(a: number, b: number): number {
    return a === 0 || b === 0 ? REL_NONE : a === b ? REL_SAME : REL_OTHER;
  }

  /** Whether `rec` may act as an owner of what belongs to `team`. Nobody may for team 0. */
  may(rec: EntityRecord | null | undefined, team: number): boolean {
    return !!rec && this.relation(rec.team, team) === REL_SAME;
  }

  /** The tribe a record is in, or null. */
  of(rec: EntityRecord): Tribe | null {
    return this.byId.get(rec.team) ?? null;
  }

  /** The invitation `rec` has not answered, or null. An expired one is deleted here. */
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

  /** The tribe takes the founder's team, and with it everything the founder owns. Returns what went wrong, or "". */
  create(rec: EntityRecord, name: string): string {
    if (this.of(rec)) return "you are in a tribe already; leave it first";
    const clean = cleanTribeName(name);
    if (clean === "") return `a tribe's name is 1 to ${MAX_TRIBE_NAME} characters`;
    if (rec.team === 0) return "you have no survivor yet";
    // A module may refuse the tribe, or give it another name.
    const asked = { pid: rec.pid, name: clean };
    const refused = this.bus.before(TRIBE_CREATE, asked);
    const named = cleanTribeName(String(asked.name));
    if (refused !== "" || named === "") return refused === "" ? `a tribe's name is 1 to ${MAX_TRIBE_NAME} characters` : refused;
    this.byId.set(rec.team, { id: rec.team, name: named, members: [rec.pid], owner: rec.pid });
    rec.rank = RANK_OWNER;
    this.invites.delete(rec.pid);
    this.changed(rec);
    this.bus.after(TRIBE_CREATED, { pid: rec.pid, team: rec.team, name: named });
    return "";
  }

  /** `near` says whether the two stand within INVITE_RANGE. */
  invite(by: EntityRecord, target: EntityRecord, near: boolean): string {
    const tribe = this.of(by);
    if (!tribe) return "you are not in a tribe; found one first";
    if (tribe.owner !== by.pid) return "only the tribe's owner may invite";
    if (target.pid === by.pid || target.team === tribe.id) return `${target.name} is in the tribe already`;
    if (!near) return `${target.name} is too far away: an invitation is made face to face`;
    const refused = this.bus.before(TRIBE_INVITE, { byPid: by.pid, pid: target.pid });
    if (refused !== "") return refused;
    this.invites.set(target.pid, { tribe: tribe.id, by: by.pid, until: this.world.tick + INVITE_TICKS });
    this.version++;
    this.onNotice?.(target.pid, `${by.name} invites you to join ${tribe.name}. Type "tribe accept" or "tribe decline".`);
    return "";
  }

  accept(rec: EntityRecord): string {
    const inv = this.inviteOf(rec);
    if (!inv) return "nobody has invited you";
    if (this.of(rec)) return "you are in a tribe already; leave it first";
    const tribe = inv.tribe;
    const most = this.rules ? this.rules.num("MaxNumberOfPlayersInTribe") : 0;
    if (most > 0 && tribe.members.length >= most) return `${tribe.name} has as many members as a tribe may here (${most})`;
    const refused = this.bus.before(TRIBE_JOIN, { pid: rec.pid, team: tribe.id });
    if (refused !== "") return refused;
    this.invites.delete(rec.pid);
    const was = rec.team;
    // What it built and tamed joins the tribe, and stays if it later leaves.
    const moved = this.world.structs.reown(was, tribe.id);
    if (moved > 0) this.bus.after(STRUCTURE_OWNER, { from: was, to: tribe.id, n: moved });
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
    this.bus.after(TRIBE_JOINED, { pid: rec.pid, team: tribe.id });
    return "";
  }

  decline(rec: EntityRecord): string {
    const inv = this.inviteOf(rec);
    if (!inv) return "nobody has invited you";
    this.invites.delete(rec.pid);
    this.version++;
    return "";
  }

  /** The survivor leaves with nothing and gets a new team of one. */
  leave(rec: EntityRecord): string {
    const tribe = this.of(rec);
    if (!tribe) return "you are not in a tribe";
    this.remove(tribe, rec, "left");
    for (const pid of tribe.members) this.onNotice?.(pid, `${rec.name} left ${tribe.name}.`);
    return "";
  }

  kick(by: EntityRecord, name: string): string {
    const tribe = this.of(by);
    if (!tribe) return "you are not in a tribe";
    if (tribe.owner !== by.pid) return "only the tribe's owner may put a member out";
    const members = tribe.members.map((pid) => this.records.byPid.get(pid));
    const which = meant(members.map((m) => m?.name ?? ""), name);
    if (which === NAME_UNCLEAR) return `more than one member of ${tribe.name} could be ${name}; give the name exactly`;
    const target = members[which];
    if (!target) return `nobody called ${name} is in ${tribe.name}`;
    if (target.pid === by.pid) return "leave the tribe instead";
    this.remove(tribe, target, "put out");
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
    this.bus.after(TRIBE_RENAMED, { team: tribe.id, name: clean });
    return "";
  }

  /**
   * The survivor left for another server of the cluster, in its tribe still. Its team goes with it and what the tribe owns here
   * keeps it, so it is the tribe's again when the survivor comes back. A tribe is listed where its members are: this one
   * passes to its longest-standing member here, if its owner left, and with nobody left here it is forgotten here. Nobody is
   * told: ARK's tribe log has no line for a survivor's transfer.
   */
  departed(rec: EntityRecord): void {
    this.invites.delete(rec.pid);
    const tribe = this.of(rec);
    if (!tribe) return;
    const at = tribe.members.indexOf(rec.pid);
    if (at >= 0) tribe.members.splice(at, 1);
    if (tribe.members.length === 0) this.byId.delete(tribe.id);
    else if (tribe.owner === rec.pid) {
      tribe.owner = tribe.members[0]!;
      const heir = this.records.byPid.get(tribe.owner);
      if (heir) {
        heir.rank = RANK_OWNER;
        this.records.dirty.add(heir.pid);
      }
    }
    this.version++;
    this.onSave?.();
  }

  /**
   * The survivor came from another server of the cluster, with the team it had there. A tribe of that team here takes it in,
   * and where there is none it is made under the name it had there (`name`, "" for a survivor in no tribe). One that `owned` it
   * there owns it here, and one that finds the tribe's owner away holds it until the owner comes.
   */
  arrived(rec: EntityRecord, name: string, owned: boolean): void {
    if (rec.team === 0) return;
    let tribe = this.byId.get(rec.team);
    if (!tribe) {
      const clean = cleanTribeName(name);
      if (clean === "") return;
      tribe = { id: rec.team, name: clean, members: [], owner: rec.pid };
      this.byId.set(tribe.id, tribe);
    }
    if (!tribe.members.includes(rec.pid)) tribe.members.push(rec.pid);
    if (owned || !tribe.members.includes(tribe.owner)) {
      const was = tribe.owner !== rec.pid ? this.records.byPid.get(tribe.owner) : undefined;
      if (was) {
        was.rank = RANK_MEMBER;
        this.records.dirty.add(was.pid);
      }
      tribe.owner = rec.pid;
    }
    rec.rank = tribe.owner === rec.pid ? RANK_OWNER : RANK_MEMBER;
    this.records.dirty.add(rec.pid);
    this.version++;
    this.onSave?.();
  }

  private remove(tribe: Tribe, rec: EntityRecord, why: string): void {
    tribe.members.splice(tribe.members.indexOf(rec.pid), 1);
    rec.team = this.records.newTeam();
    rec.rank = RANK_MEMBER;
    const wasOwner = tribe.owner === rec.pid;
    if (tribe.members.length === 0) {
      // The last member left, so the tribe is gone. What it owned keeps the team id, which no one can act for now.
      this.byId.delete(tribe.id);
    } else if (tribe.owner === rec.pid) {
      // Ownership passes to the longest-standing member.
      tribe.owner = tribe.members[0]!;
      const heir = this.records.byPid.get(tribe.owner);
      if (heir) {
        heir.rank = RANK_OWNER;
        this.records.dirty.add(heir.pid);
        this.onNotice?.(heir.pid, `${tribe.name} is yours now.`);
      }
    }
    this.changed(rec);
    this.bus.after(TRIBE_LEAVE, { team: tribe.id, pid: rec.pid, why, heir: wasOwner && tribe.members.length > 0 ? tribe.owner : 0, disbanded: tribe.members.length === 0 });
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
   * Records decide who is on which team. The saved list gives a tribe its name, owner and member order.
   * A listed member the records put elsewhere is dropped, an unlisted one is added, and an empty tribe is forgotten.
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
