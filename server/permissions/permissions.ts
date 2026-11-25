// A world's view of the cluster's permissions: the whole store held in maps, so every check is lookups. `poll` reads the
// file again when another world changed it. `apply` is the one door for every change but a survivor's claim of its own
// password, which is `claim`'s. Each change writes its row of history in its own transaction.
import { actText, type ActVia } from "../../shared/acts.ts";
import { changeWords } from "../../shared/permissions/commands.ts";
import { RANK_CLUSTER, RANK_NAMES, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import {
  CHANGED_MEANWHILE,
  DEFAULT_GROUP,
  HOUR_MS,
  commandPermission,
  editRule,
  holds,
  memberHolds,
  memberWorld,
  permissionKey,
  type Document,
  type Group,
  type HistoryRow,
  type HistoryVia,
  type Member,
  type MemberKind,
  type PermissionActor,
  type PermissionOp,
  type PermissionSnapshot,
  type RuleLook,
  type Secret,
  type StaffReach,
  type TagChoice,
  isHash,
  isSurvivorId,
} from "../../shared/permissions/model.ts";
import { WRONG_PASSWORD } from "../../shared/console.ts";
import { idParts } from "../../shared/ids.ts";
import { TEAM_RANGE } from "../records.ts";
import { DUMMY_HASH, RETIRED_MS, Retired, sameHash } from "./secrets.ts";
import type { Issued, PermissionStore } from "./store.ts";

/** How often `poll` looks at the file. */
export const POLL_MS = 5000;
/** The longest a running world waits for another process's lock on the file: every wait is inside its tick. */
export const BUSY_MS = 250;
/** How long a survivor waits to replace a password they claimed: each claim is a write every map reads and a row of history. */
export const CLAIM_WAIT_MS = 3600 * 1000;

/** Who is asking: a survivor's ID, its tribe's team number (0 for none), whether it signed in, and the world it is on. */
export interface PermissionSubject {
  readonly id: string;
  readonly team: number;
  readonly signed: boolean;
  readonly world: number;
}

/**
 * Who makes a change, as `apply` judges them by the store as it stands inside the write. The host gives every actor a
 * `baseRank`; only a plain actor with neither it nor `signedIn`, as the store's own tests give, acts at its `rank`.
 */
export interface Acting extends PermissionActor {
  /** The rank held apart from any group: a host password the connection gave, the terminal, a module, a development page, or none. */
  readonly baseRank?: number;
  /** A survivor signed in with their own password: their ID and the password's hash. Their groups count while it is still theirs. */
  readonly signedIn?: { readonly id: string; readonly hash: string };
  /** The least rank the whole act needs, as an import needs the top one. */
  readonly needs?: number;
  /** The actor's survivor ID, or "", and how the change came in, for the history. A plain actor's row says "" for both. */
  readonly id?: string;
  readonly via?: ActVia;
}

/** Who claims a password, for the history: the survivor's name, the rank its session held, and how it asked. */
export interface Claimant {
  readonly name: string;
  readonly rank: number;
  readonly via: ActVia;
}

/** What became of a change: "" or why not, the words its row of history says it in ("" when refused), and the rank it was judged at. */
export interface Made {
  readonly why: string;
  readonly words: string;
  readonly rank: number;
}

/** A group as a plan saw it: its rank, or null where there was none of that name. */
export interface GroupSeen {
  readonly group: string;
  readonly rank: number | null;
}

/** The most rows of history one read answers. */
export const HISTORY_PAGE_MOST = 500;
/** The most letters of an actor's name in the history. */
const NAME_MOST = 64;

/** An account and a group whose standing changed: a survivor's ID or a tribe's number, "" for a group alone, and "" for none. */
export interface Changed {
  readonly account: string;
  readonly group: string;
}

/** What became of a claim: "" or why not, and whether the password given was a wrong guess, to be counted as one. */
export interface Claim {
  readonly why: string;
  readonly wrong: boolean;
}

/** A survivor ID with its survivor's name and team, for the register. A team left out is not known. */
export interface Issue {
  readonly id: string;
  readonly name: string;
  readonly team?: number;
}

/** One write to the register (`Permissions.register`). */
export interface Registering {
  /** The world whose counters these are: the world part of the IDs and team numbers it makes. */
  readonly origin: number;
  /** Its next survivor and team counts (Records.nextSurvivor, Records.nextTeam); left out, its marks of that kind stay. */
  readonly survivors?: number;
  readonly teams?: number;
  /** IDs this world just made. */
  readonly minted: readonly Issue[];
  /** IDs known here that were not made here now: arrivals, and the survivors of a save at its start. */
  readonly known: readonly Issue[];
}

const NO_STAFF = "You are in no staff group, so there is no password to claim. An admin puts you in one first.";
/** What a claim is refused with when the survivor gave a password replaced or cleared within the last day, as enablecheats is. */
const RETIRED_PASSWORD = "that password was replaced or cleared";

export interface PermissionsOptions {
  readonly store: PermissionStore;
  /** The world this view is for. */
  readonly world: number;
  readonly now?: () => number;
  /** The server's own output, told when the file cannot be read and when it can again. */
  readonly say?: (line: string) => void;
  /** How long a survivor waits to replace a password they claimed; CLAIM_WAIT_MS unless said. */
  readonly claimWaitMs?: number;
  /** The survivor IDs of a tribe's members, as far as this world knows them: the edit rule asks their ranks. */
  readonly tribeMembers?: (team: number) => readonly string[];
}

/** What `change` answers when the store already is as asked: nothing is written and no revision is raised. */
const AS_IT_IS = "\u0000as it is";

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

const sameMember = (a: Member, b: Member | null): boolean =>
  b !== null && a.kind === b.kind && a.key === b.key && a.group === b.group && a.world === b.world && a.forever === b.forever && a.from === b.from && a.until === b.until;

const sameGroup = (a: Group, b: Group | undefined): boolean =>
  b !== undefined && a.name === b.name && a.rank === b.rank && a.chat === b.chat && a.permissions.length === b.permissions.length && a.permissions.every((p, i) => p === b.permissions[i]);

export class Permissions {
  /** Rises with every change of what this view holds or of which timed memberships run. */
  version = 0;
  /** Called after each change `apply` made, with the actor as it was judged. */
  onApplied: ((actor: PermissionActor, op: PermissionOp) => void) | null = null;

  private readonly store: PermissionStore;
  /** The world this view is for. */
  readonly world: number;
  /** The wall clock it reads, in milliseconds. */
  readonly now: () => number;
  private revision = -1;
  private lookedAt = -Infinity;
  private readonly say: (line: string) => void;
  private readonly tribeMembers: (team: number) => readonly string[];
  private readonly claimWaitMs: number;
  /** The file could not be read at the last look. */
  private unread = false;
  /** When a timed membership next starts or ends. */
  private nextEdge = Infinity;
  /** The time the starts and ends of timed memberships were last looked at. */
  private edgeSeen = -Infinity;
  /** The accounts and groups whose standing changed since `takeChanged` was last called, by account and group. */
  private readonly changed = new Map<string, Changed>();
  private readonly groupsByName = new Map<string, Held>();
  private members = new Map<string, Member[]>();
  private readonly secrets = new Map<string, Secret>();
  private readonly retiredHashes = new Retired();
  /** Survivors whose password was replaced or cleared since `takeGone` was last called. */
  private readonly gone = new Set<string>();
  private readonly documents = new Map<string, Document>();
  private readonly tags = new Map<string, Map<string, TagChoice>>();
  private readonly wanted = new Map<string, Wanted>();
  private defaultGroup!: Held;

  constructor(opts: PermissionsOptions) {
    this.store = opts.store;
    this.world = opts.world;
    this.now = opts.now ?? Date.now;
    this.say = opts.say ?? (() => {});
    this.tribeMembers = opts.tribeMembers ?? (() => []);
    this.claimWaitMs = opts.claimWaitMs ?? CLAIM_WAIT_MS;
    this.load(this.store.read(), false);
    this.store.patience(BUSY_MS);
    const cleared = this.store.cleared;
    if (cleared > 0) this.say(`permissions: ${cleared} ${cleared === 1 ? "password an admin issued before survivors claimed their own was" : "passwords an admin issued before survivors claimed their own were"} cleared; ${cleared === 1 ? "its survivor claims a new one" : "their survivors claim new ones"} in game`);
  }

  /** Takes in the passwords other worlds retired within the day, which this view may never have held: it started since, or they came and went between its polls. */
  private learnRetired(): void {
    try {
      this.retiredHashes.merge(this.store.retired(this.now() - RETIRED_MS));
    } catch {
      // What this view saw retire is remembered without the file.
    }
  }

  /** Reads the file again when its stamp changed, looking at most once every 5 seconds. Says whether anything changed. */
  poll(): boolean {
    const was = this.version;
    const now = this.now();
    // A clock put back would otherwise stop the looks until it had caught up.
    if (now - this.lookedAt >= POLL_MS || now < this.lookedAt) {
      this.lookedAt = now;
      this.reloadIfChanged();
    }
    if (now >= this.nextEdge) {
      this.passEdges(now);
      this.nextEdge = this.edgeAfter(now);
      this.version++;
    }
    return this.version !== was;
  }

  /** Looks at the file now, as each poll does, for what must be judged against the newest: an import's plan. Says whether it read it again. */
  lookNow(): boolean {
    this.lookedAt = this.now();
    return this.reloadIfChanged();
  }

  /** Whether the file could be read at the last look. */
  get readable(): boolean {
    return !this.unread;
  }

  /** The accounts and groups whose standing changed since the last call: here, on another world, or by the clock. */
  takeChanged(): Changed[] {
    const out = [...this.changed.values()];
    this.changed.clear();
    return out;
  }

  /** The rank `actor` acts at by what this view holds: what it holds apart from any group, and its groups while its sign-in holds. */
  actingRank(actor: Acting): number {
    if (actor.baseRank === undefined && actor.signedIn === undefined) return actor.rank;
    const own = actor.signedIn;
    const groups = own !== undefined && own.hash !== "" && this.secretOf(own.id) === own.hash ? this.rankOf({ id: own.id, team: 0, signed: true, world: this.world }) : RANK_OPEN;
    return Math.max(actor.baseRank ?? RANK_OPEN, groups);
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

  /** Where survivor `id`'s staff groups count, as seen from `world`: a membership for every world counts there and beyond. */
  staffReach(id: string, world: number): StaffReach {
    let here = false;
    let beyond = false;
    const now = this.now();
    for (const m of this.members.get(subjectKey("survivor", id)) ?? []) {
      if (!m.forever && m.until <= now) continue;
      const g = this.groupsByName.get(m.group.toLowerCase());
      if (!g || g.group.rank < RANK_STAFF) continue;
      // One whose time has not begun gives nothing on this world yet, so it is no reach to its survivor either.
      if ((m.world === 0 || m.world === world) && memberHolds(m, now)) here = true;
      if (m.world !== world) beyond = true;
    }
    return here ? (beyond ? "wider" : "here") : beyond ? "elsewhere" : "none";
  }

  /** The hash of survivor `id`'s own password, or "". */
  secretOf(id: string): string {
    return this.secrets.get(id)?.hash ?? "";
  }

  /** When survivor `id` claimed its password, by the wall clock; 0 where it has none or the time is not known. */
  claimedAt(id: string): number {
    return this.secrets.get(id)?.at ?? 0;
  }

  /** Whether any survivor has a password. */
  anySecret(): boolean {
    return this.secrets.size > 0;
  }

  /** Whether a hash is of a password replaced or cleared within the last day, here or on another world. */
  retired(hash: string): boolean {
    return this.retiredHashes.has(hash, this.now());
  }

  /** The survivors whose password was replaced or cleared since the last call, whose sign-ins no longer hold. */
  takeGone(): string[] {
    const ids = [...this.gone];
    this.gone.clear();
    return ids;
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
      secrets: [...this.secrets.values()],
      documents: [...this.documents.values()],
      tags,
    };
  }

  /**
   * Makes one change if the edit rule lets `actor` make it, judged by the store as it stands inside the write. Answers ""
   * or the reason it was not made.
   */
  apply(actor: Acting, op: PermissionOp): string {
    return this.make(actor, op).why;
  }

  /** As `apply`, and answers the words the change was written into the history in, for the world's act to use. */
  make(actor: Acting, op: PermissionOp): Made {
    return this.makeAll(actor, [op])[0]!;
  }

  /**
   * Makes each change of a list in one write, as an import's are: each is judged and worded as `make` would, by the store
   * as the changes before it left it, and a refusal stops nothing. A write that fails makes none of them.
   */
  makeAll(actor: Acting, ops: readonly PermissionOp[]): Made[] {
    return this.makeIf(actor, ops, [])!;
  }

  /**
   * As `makeAll`, while each group of `seen` still has the rank it was seen with, judged inside the write. Where one does
   * not, nothing is made and the answer is null.
   */
  makeIf(actor: Acting, ops: readonly PermissionOp[], seen: readonly GroupSeen[]): Made[] | null {
    const out: Made[] = [];
    /** What follows each change made, once the write is in the file. */
    const after: (() => void)[] = [];
    let began = false;
    let moved = false;
    let held: PermissionSnapshot | null = null;
    try {
      this.store.transaction(() => {
        began = true;
        if (this.store.revision() !== this.revision) this.load(this.store.read());
        moved = seen.some((s) => (this.group(s.group)?.rank ?? null) !== s.rank);
        if (moved) return;
        held = this.snapshot();
        for (const op of ops) out.push(this.one(actor, op, after));
        if (after.length > 0) this.tidy();
      });
    } catch {
      // A write that never began, as one a lock kept out, changed nothing here.
      if (began) this.reread(held);
      const rank = out[0]?.rank ?? this.actingRank(actor);
      return ops.map(() => ({ why: "The permissions could not be written.", words: "", rank }));
    }
    if (moved) return null;
    if (after.length === 0) return out;
    for (const run of after) run();
    this.version++;
    return out;
  }

  /** Inside a write: judges one change, makes it and writes its row of history. */
  private one(actor: Acting, op: PermissionOp, after: (() => void)[]): Made {
    const as: PermissionActor = { rank: this.actingRank(actor), world: actor.world, name: actor.name };
    const needs = actor.needs ?? RANK_OPEN;
    const was = op?.op === "clearSecret" ? this.secretOf(op.id) : "";
    let reason = (as.rank < needs ? `That needs the ${RANK_NAMES[needs]} rank.` : "") || editRule(as, op, this.look) || (this.stale(op) ? CHANGED_MEANWHILE : "");
    // Worked out before the change, so a group removed is still named as it was kept.
    const words = reason ? "" : this.wordsOf(as, op);
    reason ||= this.change(as, op);
    // The store already was as asked: nothing was written, and that is no refusal.
    if (reason === AS_IT_IS) return { why: "", words: "", rank: as.rank };
    if (reason) return { why: reason, words: "", rank: as.rank };
    if (was !== "") this.store.putRetired(was, this.now());
    this.revision = this.store.raise();
    if (op.op !== "tag") this.wrote(actor.name, actor.id ?? "", as.rank, actor.via ?? "", words);
    after.push(() => {
      if (was !== "" && "id" in op) this.retire(op.id, was);
      if (op.op !== "tag") {
        const typed = "group" in op ? op.group : "";
        this.note("key" in op ? op.key : "id" in op ? op.id : "", this.group(typed)?.name ?? typed);
      }
      this.onApplied?.(as, op);
    });
    return { why: "", words, rank: as.rank };
  }

  /**
   * Survivor `id` claims its own password, kept as `hash`: the session that asks is the survivor, which is the proof. It
   * needs a staff group on some world. One that has a password already gives it, as the hash `given` ("" for none), to
   * replace it. Judged by the store as it stands inside the write.
   */
  claim(id: string, hash: string, given: string, by: Claimant = { name: "", rank: RANK_OPEN, via: "session" }): Claim {
    let why = "";
    let wrong = false;
    let was = "";
    if (!isSurvivorId(id) || !isHash(hash)) return { why: "That is no password to claim.", wrong };
    // Anyone may type it, so one in no staff group is answered from a look at the file, with no write lock taken.
    // The check inside the write still decides a claim that passes this one.
    if (this.staffRank(id) < RANK_STAFF) {
      try {
        this.lookNow();
      } catch {
        // A file that cannot be read leaves the view as it is.
      }
      if (this.staffRank(id) < RANK_STAFF) return { why: NO_STAFF, wrong };
    }
    let began = false;
    let held: PermissionSnapshot | null = null;
    try {
      this.store.transaction(() => {
        began = true;
        if (this.store.revision() !== this.revision) this.load(this.store.read());
        if (this.store.issued(id) === null) {
          why = `No survivor has the ID ${id}.`;
          return;
        }
        if (this.staffRank(id) < RANK_STAFF) {
          why = NO_STAFF;
          return;
        }
        was = this.secretOf(id);
        // Compared in full even where nothing was given or kept, as enablecheats compares.
        const right = sameHash(given || DUMMY_HASH, was || DUMMY_HASH) && given !== "";
        if (was !== "" && !right) {
          wrong = given !== "" && !this.retired(given);
          why = given === "" ? "You have a password already. To replace it, give it: claimpassword <your password>" : wrong ? WRONG_PASSWORD : RETIRED_PASSWORD;
          return;
        }
        // Each replacement is a write every map reads, a row of the cluster's history and an act, so they are spaced out.
        // One whose time is not known, as an older file's, does not wait.
        const since = this.claimedAt(id);
        const wait = was === "" || since <= 0 ? 0 : since + this.claimWaitMs - this.now();
        if (wait > 0 && wait <= this.claimWaitMs) {
          const minutes = Math.ceil(wait / 60_000);
          why = `You claimed a password a short while ago. A new one can be claimed in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
          return;
        }
        // Taken only now, when the view is about to change, so a refused claim copies nothing.
        held = this.snapshot();
        const secret: Secret = { id, hash, at: this.now() };
        this.store.putSecret(secret);
        this.secrets.set(id, secret);
        if (was !== "") this.store.putRetired(was, secret.at);
        this.written();
        this.wrote(by.name, id, by.rank, by.via, "claimed their own password");
      });
    } catch {
      if (began) this.reread(held);
      return { why: "The permissions could not be written.", wrong: false };
    }
    if (why) return { why, wrong };
    if (was !== "") this.retire(id, was);
    this.note(id, "");
    this.version++;
    return { why: "", wrong: false };
  }

  /**
   * Writes the register in one transaction: each ID just made, with nothing that named it before; each ID known here; and
   * marks that only rise. Tribe memberships of the team numbers this world's mark rises over go too. Answers how many
   * membership, password and tag rows went, or null when the file could not be written.
   */
  register(r: Registering): number | null {
    let dropped = 0;
    const now = this.now();
    try {
      this.store.transaction(() => {
        const marks = new Map<number, number>();
        const counted = (id: string): void => {
          const p = idParts(id)!;
          marks.set(p.world, Math.max(marks.get(p.world) ?? 0, p.n + 1));
        };
        for (const m of r.minted) {
          if (!isSurvivorId(m.id)) continue;
          dropped += this.store.dropRowsOf(m.id);
          this.store.putMinted({ id: m.id, name: m.name, world: this.world, at: now, team: m.team ?? 0 });
          counted(m.id);
        }
        for (const k of r.known) {
          if (!isSurvivorId(k.id)) continue;
          this.store.putKnown({ id: k.id, name: k.name, world: this.world, at: now, team: k.team ?? 0 });
          counted(k.id);
        }
        if (r.survivors !== undefined) marks.set(r.origin, Math.max(marks.get(r.origin) ?? 0, r.survivors));
        for (const [world, next] of marks) this.store.raiseMark(world, "survivor", next);
        if (r.teams !== undefined) {
          // A store from before the register has no mark: what it holds is taken as it is.
          const had = this.store.mark(r.origin, "team");
          if (had !== undefined && r.teams > had) dropped += this.store.dropTribes(r.origin * TEAM_RANGE + had, r.origin * TEAM_RANGE + r.teams);
          this.store.raiseMark(r.origin, "team", r.teams);
        }
        if (dropped > 0) {
          const revision = this.store.raise();
          const what = `took out ${dropped} ${dropped === 1 ? "row" : "rows"} that named survivor IDs or team numbers before they were made`;
          this.store.putHistory({ at: now, world: this.world, name: "(server)", id: "", rank: -1, via: "server", what, revision });
        }
      });
    } catch {
      return null;
    }
    if (dropped > 0) {
      try {
        this.load(this.store.read());
      } catch {
        // The revision rose, so the next poll reads it.
      }
    }
    return dropped;
  }

  /** Changes with each commit to the store by any world, the register's included, which raise no revision. */
  commits(): string {
    return this.store.commits();
  }

  /** At most `most` rows of the cluster's history whose seq is below `before`, newest first, read from the store. */
  history(before = Number.MAX_SAFE_INTEGER, most = 50): HistoryRow[] {
    return this.store.history(before, Math.max(1, Math.min(HISTORY_PAGE_MOST, Math.floor(most) || 1)));
  }

  /** The register's row for survivor ID `id`, or null where no world issued it. */
  issued(id: string): Issued | null {
    return this.store.issued(id);
  }

  /** The register's survivors of a name, in any case. */
  issuedNamed(name: string): Issued[] {
    return this.store.issuedNamed(name);
  }

  /** Every survivor ID the register knows. */
  allIssued(): Issued[] {
    return this.store.allIssued();
  }

  /** Whether team number `key` was made: its world's team mark is above it. */
  teamMade(key: string): boolean {
    const team = Number(key);
    if (!Number.isSafeInteger(team) || team < 1 || team % TEAM_RANGE === 0) return false;
    return (this.store.mark(Math.floor(team / TEAM_RANGE), "team") ?? 0) > team % TEAM_RANGE;
  }

  /** The next survivor and team counts world `origin` may hand out, as the register has them; 0 for none. */
  marks(origin: number): { survivor: number; team: number } {
    return { survivor: this.store.mark(origin, "survivor") ?? 0, team: this.store.mark(origin, "team") ?? 0 };
  }

  /** Inside a write that changed the store: drops what ran out and raises the revision. */
  private written(): void {
    this.tidy();
    this.revision = this.store.raise();
  }

  /** Inside a write that changed the store: drops the memberships and the retired passwords whose time ran out. */
  private tidy(): void {
    const now = this.now();
    this.passEdges(now);
    this.store.dropExpired(now);
    this.store.dropRetired(now - RETIRED_MS);
    this.dropExpired(now);
    this.nextEdge = this.edgeAfter(now);
  }

  /** Whether a whole value's change began from another value than the store holds now. The edit rule passed it. */
  private stale(op: PermissionOp): boolean {
    if (op.op === "setChat") return op.was !== undefined && this.group(op.group)?.chat !== op.was;
    if (op.op === "setRank") return op.was !== undefined && this.group(op.group)?.rank !== op.was;
    if (op.op === "setDocument") return op.was !== undefined && this.document(op.name) !== op.was;
    return false;
  }

  /** Inside a write, after `written`: the row of history for the change it made. */
  private wrote(name: string, id: string, rank: number, via: HistoryVia | "", what: string): void {
    this.store.putHistory({ at: this.now(), world: this.world, name: actText(name, NAME_MOST), id, rank, via, what, revision: this.revision });
  }

  /**
   * A change as the history and the world's act say it: the group by its own name, and "all" for a membership that holds
   * on every map of a cluster.
   */
  private wordsOf(judged: PermissionActor, op: PermissionOp): string {
    const typed = "group" in op ? op.group : "";
    const group = this.group(typed)?.name ?? typed;
    const everyWorld = op.op === "addMember" && this.world !== 0 && memberWorld(judged, this.group(group)?.rank ?? 0, op.world) === 0;
    return changeWords("group" in op ? { ...op, group } : op, everyWorld);
  }

  private readonly look: RuleLook = {
    groupRank: (name) => this.groupsByName.get(name.toLowerCase())?.group.rank,
    staffRank: (id) => this.staffRank(id),
    staffReach: (id, world) => this.staffReach(id, world),
    allCheats: (name) => holds(this.groupsByName.get(name.toLowerCase())?.group.permissions ?? [], "Cheat.*"),
    hasMembers: (name) => this.membersIn(name).some((m) => m.forever || m.until > this.now()),
    issued: (id) => this.store.issued(id) !== null,
    teamMade: (key) => this.teamMade(key),
    // Its members as the register last knew them, on any map, and as this world holds them now.
    tribeRank: (key) => [...this.store.issuedInTeam(Number(key)), ...this.tribeMembers(Number(key))].reduce((rank, id) => Math.max(rank, this.staffRank(id)), RANK_OPEN),
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
        // A tag is shown unless it was hidden, so one never chosen is as one shown.
        if ((this.tags.get(op.id)?.get(op.tag.toLowerCase())?.show ?? true) === op.show) return AS_IT_IS;
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

  /**
   * Reads the file again if its revision is not the one this view holds. The revision is asked each time: the file's time
   * and size can stay the same over a change, and one taken after this world's own write can hide another's. A file that
   * cannot be read, as one another process holds locked, leaves the view as it is until the next look.
   */
  private reloadIfChanged(): boolean {
    try {
      const changed = this.store.revision() !== this.revision;
      if (changed) this.load(this.store.read());
      if (this.unread) this.say("permissions: the file is read again");
      this.unread = false;
      return changed;
    } catch {
      if (!this.unread) this.say(`permissions: the file could not be read, so this map keeps what it has and looks again every ${POLL_MS / 1000} s`);
      this.unread = true;
      return false;
    }
  }

  /**
   * After a write that failed part way, with `held` the view as it was before the write changed it: the file is read
   * again, or where it cannot be, the view goes back to what it held and is marked to be read at the next look. The
   * file rolled the write back, so nothing of it may count here.
   */
  private reread(held: PermissionSnapshot | null): void {
    try {
      this.load(this.store.read());
    } catch {
      if (held) this.load(held, false);
      this.revision = -1;
    }
  }

  private note(account: string, group: string): void {
    const k = `${account} ${group}`;
    if (!this.changed.has(k)) this.changed.set(k, { account, group });
  }

  private retire(id: string, hash: string): void {
    this.retiredHashes.add(hash, this.now());
    this.gone.add(id);
  }

  /** Takes in everything the store holds. With `note`, each group, membership and password it changed is noted. */
  private load(snap: PermissionSnapshot, note = true): void {
    const now = this.now();
    this.passEdges(now);
    const before = new Map(this.secrets);
    const was = note ? { groups: new Map(this.groupsByName), members: this.members, documents: new Map(this.documents) } : null;
    this.revision = snap.revision;
    this.groupsByName.clear();
    for (const g of snap.groups) this.groupsByName.set(g.name.toLowerCase(), heldOf(g));
    this.defaultGroup = this.groupsByName.get(DEFAULT_GROUP.toLowerCase())!;
    this.members = new Map();
    for (const raw of snap.members) {
      const m = current(raw, now);
      if (!m) continue;
      const k = subjectKey(m.kind, m.key);
      const rows = this.members.get(k);
      if (rows) rows.push(m);
      else this.members.set(k, [m]);
    }
    this.secrets.clear();
    for (const s of snap.secrets) this.secrets.set(s.id, s);
    // A view put back after a failed write (`note` false) retires nothing: what differs there was never in the file.
    if (note) for (const [id, s] of before) if (this.secretOf(id) !== s.hash) this.retire(id, s.hash);
    this.documents.clear();
    for (const d of snap.documents) this.documents.set(d.name.toLowerCase(), d);
    this.tags.clear();
    for (const t of snap.tags) {
      let mine = this.tags.get(t.id);
      if (!mine) this.tags.set(t.id, (mine = new Map()));
      mine.set(t.tag.toLowerCase(), t);
    }
    if (was) this.noteRead(was.groups, was.members, before, was.documents, now);
    this.learnRetired();
    this.nextEdge = this.edgeAfter(now);
    this.version++;
  }

  /** Notes what a read of the store changed from what this view held: groups, memberships as they count at `now`, passwords, documents. */
  private noteRead(groups: ReadonlyMap<string, Held>, members: ReadonlyMap<string, readonly Member[]>, secrets: ReadonlyMap<string, Secret>, documents: ReadonlyMap<string, Document>, now: number): void {
    for (const [k, held] of this.groupsByName) if (!sameGroup(held.group, groups.get(k)?.group)) this.note("", held.group.name);
    for (const [k, held] of groups) if (!this.groupsByName.has(k)) this.note("", held.group.name);
    for (const [k, rows] of this.members) {
      const old = members.get(k);
      if (old !== undefined && old.length === rows.length && rows.every((m, i) => sameMember(m, current(old[i]!, now)))) continue;
      this.noteRows(rows, old, now);
      if (old !== undefined) this.noteRows(old, rows, now);
    }
    for (const [k, rows] of members) if (!this.members.has(k)) this.noteRows(rows, undefined, now);
    for (const [id, s] of this.secrets) if (secrets.get(id)?.hash !== s.hash) this.note(id, "");
    for (const id of secrets.keys()) if (!this.secrets.has(id)) this.note(id, "");
    for (const [k, d] of this.documents) if (documents.get(k)?.text !== d.text) this.note("", "");
    for (const k of documents.keys()) if (!this.documents.has(k)) this.note("", "");
  }

  /** Notes the account and group of each row of `rows`, as it counts at `now`, that `others` does not hold. */
  private noteRows(rows: readonly Member[], others: readonly Member[] | undefined, now: number): void {
    for (const raw of rows) {
      const m = current(raw, now);
      if (m && !others?.some((o) => sameMember(m, current(o, now)))) this.note(m.key, m.group);
    }
  }

  /** Notes each timed membership that started or ended after the last look and by `now`. */
  private passEdges(now: number): void {
    if (now >= this.nextEdge) {
      for (const rows of this.members.values()) {
        for (const m of rows) {
          if (m.until !== 0 && ((m.from > this.edgeSeen && m.from <= now) || (m.until > this.edgeSeen && m.until <= now))) this.note(m.key, m.group);
        }
      }
    }
    this.edgeSeen = now;
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
