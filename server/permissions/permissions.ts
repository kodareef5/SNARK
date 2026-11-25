// A world's view of the cluster's permissions: the whole store held in maps, so every check is lookups. `poll` reads the
// file again when another world changed it, and `apply` is the one door for every change.
import { RANK_CLUSTER, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import {
  DEFAULT_GROUP,
  HOUR_MS,
  commandPermission,
  editRule,
  memberHolds,
  memberWorld,
  permissionKey,
  type Document,
  type Group,
  type Member,
  type MemberKind,
  type PermissionActor,
  type PermissionOp,
  type PermissionSnapshot,
  type RuleLook,
  type TagChoice,
} from "../../shared/permissions/model.ts";
import type { PermissionStore } from "./store.ts";

/** How often `poll` looks at the file. */
export const POLL_MS = 5000;

/** Who is asking: a survivor's ID, its tribe's team number (0 for none), whether it signed in, and the world it is on. */
export interface PermissionSubject {
  readonly id: string;
  readonly team: number;
  readonly signed: boolean;
  readonly world: number;
}

export interface PermissionsOptions {
  readonly store: PermissionStore;
  /** The world this view is for. */
  readonly world: number;
  readonly now?: () => number;
}

interface Held {
  readonly group: Group;
  readonly all: boolean;
  readonly keys: ReadonlySet<string>;
  /** The prefix entries without their `*`, such as `cheat.`. */
  readonly prefixes: ReadonlySet<string>;
}

/** A wanted permission made ready to look up: its key and each prefix it could be held by. */
interface Wanted {
  readonly key: string;
  readonly prefixes: readonly string[];
}

const subjectKey = (kind: MemberKind, key: string): string => (kind === "survivor" ? "s" : "t") + key;
const MAX_WANTED = 4096;

function heldOf(group: Group): Held {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  for (const p of group.permissions) {
    const k = permissionKey(p);
    if (k.endsWith(".*")) prefixes.add(k.slice(0, -1));
    else keys.add(k);
  }
  return { group, all: group.permissions.includes("*"), keys, prefixes };
}

/** Drops a member's timed part that ran out by `now`, or the member when nothing is left. */
function current(m: Member, now: number): Member | null {
  if (m.until === 0 || m.until > now) return m;
  return m.forever ? { ...m, from: 0, until: 0 } : null;
}

export class Permissions {
  /** Rises with every change of what the store holds or of which timed memberships run. */
  version = 0;
  /** Called after each change `apply` made. */
  onApplied: ((actor: PermissionActor, op: PermissionOp) => void) | null = null;

  private readonly store: PermissionStore;
  /** The world this view is for. */
  readonly world: number;
  private readonly now: () => number;
  private revision = -1;
  private stampSeen = "";
  private lookedAt = -Infinity;
  /** When a timed membership next starts or ends. */
  private nextEdge = Infinity;
  private readonly groupsByName = new Map<string, Held>();
  private readonly members = new Map<string, Member[]>();
  private readonly secrets = new Map<string, string>();
  private readonly documents = new Map<string, Document>();
  private readonly tags = new Map<string, Map<string, TagChoice>>();
  private readonly wanted = new Map<string, Wanted>();
  private defaultGroup!: Held;

  constructor(opts: PermissionsOptions) {
    this.store = opts.store;
    this.world = opts.world;
    this.now = opts.now ?? Date.now;
    this.stampSeen = this.store.stamp();
    this.load(this.store.read());
  }

  /** Reads the file again when its stamp changed, looking at most once every 5 seconds. Says whether anything changed. */
  poll(): boolean {
    const now = this.now();
    let changed = false;
    if (now - this.lookedAt >= POLL_MS) {
      this.lookedAt = now;
      changed = this.reloadIfChanged();
    }
    if (!changed && now >= this.nextEdge) {
      this.nextEdge = this.edgeAfter(now);
      this.version++;
      changed = true;
    }
    return changed;
  }

  /** The groups that count for `subject` now: its own, its tribe's open ones, and Default. */
  groupsOf(subject: PermissionSubject): Group[] {
    const out: Group[] = [];
    const now = this.now();
    this.collect(this.members.get(subjectKey("survivor", subject.id)), subject, false, now, out);
    if (subject.team > 0) this.collect(this.members.get(subjectKey("tribe", String(subject.team))), subject, true, now, out);
    if (!out.includes(this.defaultGroup.group)) out.push(this.defaultGroup.group);
    return out;
  }

  /** Whether any group that counts for `subject` holds `permission`. */
  has(subject: PermissionSubject, permission: string): boolean {
    const wanted = this.wantedOf(permission);
    if (this.holdsWanted(this.defaultGroup, wanted)) return true;
    const now = this.now();
    if (this.anyHolds(this.members.get(subjectKey("survivor", subject.id)), subject, false, now, wanted)) return true;
    return subject.team > 0 && this.anyHolds(this.members.get(subjectKey("tribe", String(subject.team))), subject, true, now, wanted);
  }

  /** Whether `subject` may run console command `command`. */
  mayRun(subject: PermissionSubject, command: string): boolean {
    return this.has(subject, commandPermission(command));
  }

  /** Whether a group of that name counts for `subject`. */
  inGroup(subject: PermissionSubject, group: string): boolean {
    const lower = group.toLowerCase();
    return this.groupsOf(subject).some((g) => g.name.toLowerCase() === lower);
  }

  /** The highest rank among the groups that count for `subject`. */
  rankOf(subject: PermissionSubject): number {
    let rank = RANK_OPEN;
    for (const g of this.groupsOf(subject)) if (g.rank > rank) rank = g.rank;
    return rank;
  }

  /** The highest staff group (rank 1 and up) survivor `id` is in on any world, signed in or not, or 0. */
  staffRank(id: string): number {
    let rank = RANK_OPEN;
    const now = this.now();
    for (const m of this.members.get(subjectKey("survivor", id)) ?? []) {
      if (!m.forever && m.until <= now) continue;
      const g = this.groupsByName.get(m.group.toLowerCase());
      if (g && g.group.rank >= RANK_STAFF && g.group.rank > rank) rank = g.group.rank;
    }
    return rank;
  }

  /** The hash of survivor `id`'s own password, or "". */
  secretOf(id: string): string {
    return this.secrets.get(id) ?? "";
  }

  group(name: string): Group | undefined {
    return this.groupsByName.get(name.toLowerCase())?.group;
  }

  groups(): Group[] {
    return [...this.groupsByName.values()].map((h) => h.group);
  }

  /** The rows that put a survivor or a tribe in groups, run out or not yet started included. */
  membersOf(kind: MemberKind, key: string): readonly Member[] {
    return this.members.get(subjectKey(kind, key)) ?? [];
  }

  /** Every member row of a group. */
  membersIn(group: string): Member[] {
    const lower = group.toLowerCase();
    const out: Member[] = [];
    for (const rows of this.members.values()) for (const m of rows) if (m.group.toLowerCase() === lower) out.push(m);
    return out;
  }

  document(name: string): string {
    return this.documents.get(name.toLowerCase())?.text ?? "";
  }

  /** Survivor `id`'s own choice for a tag: true to show, false to hide, undefined when it made none. */
  tagChoice(id: string, tag: string): boolean | undefined {
    return this.tags.get(id)?.get(tag.toLowerCase())?.show;
  }

  /** Everything this view holds, as the store would read it. */
  snapshot(): PermissionSnapshot {
    const members: Member[] = [];
    for (const rows of this.members.values()) members.push(...rows);
    const tags = [...this.tags.values()].flatMap((m) => [...m.values()]);
    return {
      revision: this.revision,
      groups: this.groups(),
      members,
      secrets: [...this.secrets].map(([id, hash]) => ({ id, hash })),
      documents: [...this.documents.values()],
      tags,
    };
  }

  /** Makes one change if the edit rule lets `actor` make it. Answers "" or the reason it was not made. */
  apply(actor: PermissionActor, op: PermissionOp): string {
    let reason = "";
    try {
      this.store.transaction(() => {
        if (this.store.revision() !== this.revision) this.load(this.store.read());
        reason = editRule(actor, op, this.look) || this.change(actor, op);
        if (reason) return;
        const now = this.now();
        this.store.dropExpired(now);
        this.dropExpired(now);
        this.revision = this.store.raise();
      });
    } catch {
      this.load(this.store.read());
      return "The permissions could not be written.";
    }
    if (reason) return reason;
    this.stampSeen = this.store.stamp();
    this.nextEdge = this.edgeAfter(this.now());
    this.version++;
    this.onApplied?.(actor, op);
    return "";
  }

  private readonly look: RuleLook = {
    groupRank: (name) => this.groupsByName.get(name.toLowerCase())?.group.rank,
    staffRank: (id) => this.staffRank(id),
  };

  /** Writes `op` to the store and to memory, or answers why there is nothing to do. */
  private change(actor: PermissionActor, op: PermissionOp): string {
    const now = this.now();
    switch (op.op) {
      case "addGroup": {
        const g: Group = { name: op.group, rank: op.rank ?? RANK_OPEN, permissions: [], chat: "" };
        this.store.putGroup(g);
        this.groupsByName.set(g.name.toLowerCase(), heldOf(g));
        return "";
      }
      case "removeGroup": {
        const name = this.groupsByName.get(op.group.toLowerCase())!.group.name;
        this.store.dropGroup(name);
        this.groupsByName.delete(name.toLowerCase());
        for (const [k, rows] of this.members) {
          const left = rows.filter((m) => m.group.toLowerCase() !== name.toLowerCase());
          if (left.length === 0) this.members.delete(k);
          else if (left.length !== rows.length) this.members.set(k, left);
        }
        return "";
      }
      case "setRank":
        return this.putGroup(op.group, (g) => (g.rank === op.rank ? `${g.name} is already ${op.rank}.` : { ...g, rank: op.rank }));
      case "grant":
        return this.putGroup(op.group, (g) => {
          const lower = op.permission.toLowerCase();
          if (g.permissions.some((p) => p.toLowerCase() === lower)) return `${g.name} already holds ${op.permission}.`;
          return { ...g, permissions: [...g.permissions, op.permission] };
        });
      case "revoke":
        return this.putGroup(op.group, (g) => {
          const lower = op.permission.toLowerCase();
          const left = g.permissions.filter((p) => p.toLowerCase() !== lower);
          return left.length === g.permissions.length ? `${g.name} does not hold ${op.permission}.` : { ...g, permissions: left };
        });
      case "setChat":
        return this.putGroup(op.group, (g) => ({ ...g, chat: op.chat }));
      case "addMember": {
        const g = this.groupsByName.get(op.group.toLowerCase())!.group;
        const world = memberWorld(actor, g.rank, op.world);
        const rows = this.members.get(subjectKey(op.kind, op.key)) ?? [];
        const old = rows.find((m) => m.world === world && m.group.toLowerCase() === g.name.toLowerCase());
        let next: Member;
        if (op.hours === undefined) {
          if (old?.forever) return `${op.key} is already in ${g.name}.`;
          next = old ? { ...old, forever: true } : { kind: op.kind, key: op.key, group: g.name, world, forever: true, from: 0, until: 0 };
        } else {
          const span = Math.round(op.hours * HOUR_MS);
          const timed = old && old.until > now;
          const from = timed ? old.from : now + Math.round((op.delayHours ?? 0) * HOUR_MS);
          const until = timed ? old.until + span : from + span;
          next = { kind: op.kind, key: op.key, group: g.name, world, forever: old?.forever ?? false, from, until };
        }
        this.store.putMember(next);
        this.setMembers(op.kind, op.key, [...rows.filter((m) => m !== old), next]);
        return "";
      }
      case "removeMember": {
        const g = this.groupsByName.get(op.group.toLowerCase())!.group;
        const reach = op.world !== undefined ? memberWorld(actor, g.rank, op.world) : g.rank >= RANK_STAFF && actor.rank < RANK_CLUSTER ? actor.world : -1;
        const rows = this.members.get(subjectKey(op.kind, op.key)) ?? [];
        const kept: Member[] = [];
        let touched = 0;
        for (const m of rows) {
          const hit = m.group.toLowerCase() === g.name.toLowerCase() && (reach < 0 || m.world === reach) && (!op.timedOnly || m.until > 0);
          if (!hit) {
            kept.push(m);
            continue;
          }
          touched++;
          if (op.timedOnly && m.forever) {
            const left = { ...m, from: 0, until: 0 };
            this.store.putMember(left);
            kept.push(left);
          } else this.store.dropMember(m.kind, m.key, m.group, m.world);
        }
        if (touched === 0) return op.timedOnly ? `${op.key} has no time in ${g.name}.` : `${op.key} is not in ${g.name}.`;
        this.setMembers(op.kind, op.key, kept);
        return "";
      }
      case "setSecret":
        this.store.putSecret(op.id, op.hash);
        this.secrets.set(op.id, op.hash);
        return "";
      case "clearSecret":
        if (!this.secrets.has(op.id)) return `${op.id} has no password.`;
        this.store.dropSecret(op.id);
        this.secrets.delete(op.id);
        return "";
      case "setDocument":
        this.store.putDocument(op.name, op.text);
        this.documents.set(op.name.toLowerCase(), { name: op.name, text: op.text });
        return "";
      case "tag": {
        this.store.putTag(op.id, op.tag, op.show);
        let mine = this.tags.get(op.id);
        if (!mine) this.tags.set(op.id, (mine = new Map()));
        mine.set(op.tag.toLowerCase(), { id: op.id, tag: op.tag, show: op.show });
        return "";
      }
    }
  }

  private putGroup(name: string, edit: (g: Group) => Group | string): string {
    const next = edit(this.groupsByName.get(name.toLowerCase())!.group);
    if (typeof next === "string") return next;
    this.store.putGroup(next);
    const held = heldOf(next);
    this.groupsByName.set(next.name.toLowerCase(), held);
    if (next.name.toLowerCase() === DEFAULT_GROUP.toLowerCase()) this.defaultGroup = held;
    return "";
  }

  private setMembers(kind: MemberKind, key: string, rows: Member[]): void {
    if (rows.length === 0) this.members.delete(subjectKey(kind, key));
    else this.members.set(subjectKey(kind, key), rows);
  }

  private reloadIfChanged(): boolean {
    const stamp = this.store.stamp();
    if (stamp === this.stampSeen) return false;
    this.stampSeen = stamp;
    if (this.store.revision() === this.revision) return false;
    this.load(this.store.read());
    return true;
  }

  private load(snap: PermissionSnapshot): void {
    const now = this.now();
    this.revision = snap.revision;
    this.groupsByName.clear();
    for (const g of snap.groups) this.groupsByName.set(g.name.toLowerCase(), heldOf(g));
    this.defaultGroup = this.groupsByName.get(DEFAULT_GROUP.toLowerCase())!;
    this.members.clear();
    for (const raw of snap.members) {
      const m = current(raw, now);
      if (!m) continue;
      const k = subjectKey(m.kind, m.key);
      const rows = this.members.get(k);
      if (rows) rows.push(m);
      else this.members.set(k, [m]);
    }
    this.secrets.clear();
    for (const s of snap.secrets) this.secrets.set(s.id, s.hash);
    this.documents.clear();
    for (const d of snap.documents) this.documents.set(d.name.toLowerCase(), d);
    this.tags.clear();
    for (const t of snap.tags) {
      let mine = this.tags.get(t.id);
      if (!mine) this.tags.set(t.id, (mine = new Map()));
      mine.set(t.tag.toLowerCase(), t);
    }
    this.nextEdge = this.edgeAfter(now);
    this.version++;
  }

  private dropExpired(now: number): void {
    for (const [k, rows] of this.members) {
      if (!rows.some((m) => m.until > 0 && m.until <= now)) continue;
      const left = rows.map((m) => current(m, now)).filter((m): m is Member => m !== null);
      if (left.length === 0) this.members.delete(k);
      else this.members.set(k, left);
    }
  }

  /** The first time after `now` a timed membership starts or ends. */
  private edgeAfter(now: number): number {
    let edge = Infinity;
    for (const rows of this.members.values()) {
      for (const m of rows) {
        if (m.until === 0) continue;
        const t = m.from > now ? m.from : m.until > now ? m.until : Infinity;
        if (t < edge) edge = t;
      }
    }
    return edge;
  }

  /** Whether a membership counts for `subject` at `now`; a tribe's counts only in an open group. */
  private counts(m: Member, subject: PermissionSubject, tribe: boolean, now: number): Held | undefined {
    if (!memberHolds(m, now)) return undefined;
    const held = this.groupsByName.get(m.group.toLowerCase());
    if (!held) return undefined;
    if (m.world !== 0 && m.world !== subject.world) return undefined;
    if (held.group.rank >= RANK_STAFF && (tribe || !subject.signed)) return undefined;
    return held;
  }

  private collect(rows: readonly Member[] | undefined, subject: PermissionSubject, tribe: boolean, now: number, out: Group[]): void {
    if (!rows) return;
    for (const m of rows) {
      const held = this.counts(m, subject, tribe, now);
      if (held && !out.includes(held.group)) out.push(held.group);
    }
  }

  private anyHolds(rows: readonly Member[] | undefined, subject: PermissionSubject, tribe: boolean, now: number, wanted: Wanted): boolean {
    if (!rows) return false;
    for (const m of rows) {
      const held = this.counts(m, subject, tribe, now);
      if (held && this.holdsWanted(held, wanted)) return true;
    }
    return false;
  }

  private holdsWanted(held: Held, wanted: Wanted): boolean {
    if (held.all || held.keys.has(wanted.key)) return true;
    if (held.prefixes.size === 0) return false;
    for (const p of wanted.prefixes) if (held.prefixes.has(p)) return true;
    return false;
  }

  private wantedOf(permission: string): Wanted {
    const kept = this.wanted.get(permission);
    if (kept) return kept;
    const key = permissionKey(permission);
    const prefixes: string[] = [];
    for (let i = key.indexOf("."); i >= 0; i = key.indexOf(".", i + 1)) prefixes.push(key.slice(0, i + 1));
    const w = { key, prefixes };
    if (this.wanted.size >= MAX_WANTED) this.wanted.clear();
    this.wanted.set(permission, w);
    return w;
  }
}
