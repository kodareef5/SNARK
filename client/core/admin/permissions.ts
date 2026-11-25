// The Permissions page's parts that need no browser (client/admin/permissions.ts): what the viewer may do and why not,
// the tables' rows, each change built from what was typed, the chat forms and their sample lines, and the sections as
// HTML. Every refusal is the shared edit rule's own words (shared/permissions/model.ts).

import type { TextRun } from "../../../shared/net/chat.ts";
import { DEFAULT_CHAT_FORMAT, PART_KEYS, START_CHAT_SETTINGS, chooseTags, formatLine, mapInk, readChatFormat, readChatSettings, readLooseJson, type ChatFormat, type PartKey } from "../../../shared/permissions/chat.ts";
import {
  CHANGED_MEANWHILE, DEFAULT_GROUP, MAX_CHAT_LENGTH, MAX_DOCUMENT_LENGTH, editRule, isGroupName, memberHolds, permissionKey, type Group, type HistoryRow, type Member, type MemberKind,
  type PermissionActor, type PermissionOp, type RuleLook,
} from "../../../shared/permissions/model.ts";
import { CHAT_DOCUMENT, type ImportKind, type PermissionsAnswer, type PermissionsPost, type PermissionsState } from "../../../shared/permissions/page.ts";
import { readRichColor, stripRichColor, writeRichColor } from "../../../shared/permissions/richcolor.ts";
import { RANK_CLUSTER, RANK_NAMES, RANK_OPEN, RANK_STAFF } from "../../../shared/ranks.ts";
import { TYPED, VIA_WORDS, typedName, whenText } from "./acts.ts";
import { counted, esc, spanText } from "./format.ts";

type State = PermissionsState;
export type StateMember = State["members"][number];

// ---- What the viewer may do ----

interface Lookup extends RuleLook {
  group(name: string): Group | undefined;
}

const looks = new WeakMap<State, Lookup>();

/** The store as the edit rule reads it, made once for each state. */
export function lookOf(state: State): Lookup {
  let look = looks.get(state);
  if (look) return look;
  const groups = new Map(state.groups.map((g) => [g.name.toLowerCase(), g]));
  const issued = new Set([...state.register.map((r) => r.id), ...state.survivors.map((s) => s.id)]);
  const staff = new Map<string, number>();
  /** The worlds each survivor's staff groups count on; 0 is every world. */
  const reach = new Map<string, Set<number>>();
  const peopled = new Set<string>();
  for (const m of state.members) {
    peopled.add(m.group.toLowerCase());
    const rank = groups.get(m.group.toLowerCase())?.rank ?? RANK_OPEN;
    if (m.kind !== "survivor" || rank < RANK_STAFF) continue;
    if (rank > (staff.get(m.key) ?? 0)) staff.set(m.key, rank);
    (reach.get(m.key) ?? reach.set(m.key, new Set()).get(m.key)!).add(m.world);
  }
  look = {
    group: (name) => groups.get(name.toLowerCase()),
    groupRank: (name) => groups.get(name.toLowerCase())?.rank,
    staffRank: (id) => staff.get(id) ?? 0,
    staffReach: (id, world) => {
      const worlds = reach.get(id);
      if (!worlds) return "none";
      const here = worlds.has(0) || worlds.has(world);
      const beyond = [...worlds].some((w) => w !== world);
      return here ? (beyond ? "wider" : "here") : "elsewhere";
    },
    // A row whose time ran out counts here until it is taken out; the server's rule skips it.
    hasMembers: (name) => peopled.has(name.toLowerCase()),
    issued: (id) => issued.has(id),
    // The page knows no other world's tribes: the server decides.
    teamMade: () => true,
    tribeRank: () => RANK_OPEN,
  };
  looks.set(state, look);
  return look;
}

export const actorOf = (state: State): PermissionActor => ({ rank: state.me.rank, world: state.me.world, name: state.me.name });

/** "" where the viewer may make `op`, else the reason it may not. */
export const whyNot = (state: State, op: PermissionOp): string => editRule(actorOf(state), op, lookOf(state));

const SETTINGS: PermissionOp = { op: "setDocument", name: CHAT_DOCUMENT, text: "" };

/** "" where the viewer manages permissions at all, else why not. Outside a cluster the rule asks only for the rank. */
export const manageWhy = (state: State): string => editRule({ ...actorOf(state), world: 0 }, SETTINGS, lookOf(state));

/** "" where the viewer may make groups, change what they hold, set the chat settings and apply an import, else why not. */
export const defineWhy = (state: State): string => whyNot(state, SETTINGS);

/** Why the viewer may not make a group of `rank`, or "". */
export function rankWhy(state: State, rank: number): string {
  return manageWhy(state) || (state.me.rank >= rank ? "" : `That needs the ${RANK_NAMES[rank]} rank.`);
}

const holdsCheat = (p: string): boolean => p === "*" || permissionKey(p).startsWith("cheat.");

/** Whether an open group gives cheats, which its members then have with no password. */
export const freeCheats = (g: Group): boolean => g.rank === RANK_OPEN && g.permissions.some(holdsCheat);
export const FREE_CHEATS = "Its members need no password: an open group counts from the moment they join, cheats and all.";

/** The permissions the add field offers: everything, every cheat, and each cheat command. */
export function permissionOptions(state: State): string[] {
  return [...new Set(["*", "Cheat.*", ...state.commands.map((c) => `Cheat.${c}`)])];
}

// ---- Names ----

export function worldName(state: State, world: number): string {
  if (world === 0) return "Every map";
  return state.worlds.find((w) => w.id === world)?.name ?? `World ${world}`;
}

/** A survivor's or tribe's name, as a row shows it, without its ID. */
export function whoName(kind: MemberKind, name: string): string {
  if (kind === "tribe") return name ? `Tribe ${name}` : "A tribe this world does not know";
  return name || "A survivor this world does not know";
}

/** A survivor's name as the state knows it, from the survivors, a membership or the register. */
export function survivorName(state: State, id: string): string {
  return (
    state.survivors.find((s) => s.id === id)?.name || state.members.find((m) => m.kind === "survivor" && m.key === id)?.name || state.register.find((r) => r.id === id)?.name || ""
  );
}

/** What the page says when the state was not read: a refused sign-in is only answered by the browser's own, on a reload. */
export function readFault(status: number, body: string): string {
  return status === 401 ? "You are signed out, or your password changed. Reload the page to sign in again." : `The permissions answered ${status}: ${body}`;
}

/** The map the page acts on: the world it is served by. */
export function mapName(state: State): string {
  return state.me.world === 0 ? (state.worlds[0]?.name || "this server") : worldName(state, state.me.world);
}

/** The page's heading, which names the map it acts on, and the sentence under it that says what is whose. */
export function headingOf(state: State): { title: string; scope: string } {
  const title = `Permissions on ${mapName(state)}`;
  if (state.me.world === 0) return { title, scope: "This server is in no cluster: its groups, memberships and sign-ins are its own." };
  return { title, scope: "Groups and memberships are the whole cluster's, while a staff membership made here and your sign-in to this page are this map's." };
}

export function meText(state: State): string {
  const { me } = state;
  const who = me.id ? `${me.name} (${me.id})` : `${me.name || "the host password"}, by the host password`;
  return `Signed in as ${who}, at the ${RANK_NAMES[me.rank] ?? "unknown"} rank, on ${me.world === 0 ? "a world outside a cluster" : worldName(state, me.world)}.`;
}

/** How long a membership holds, in words. */
export function spanWords(m: Member, now: number): string {
  if (m.forever) return "For good";
  if (now < m.from) return `Starts in ${spanText(m.from - now)}, then lasts ${spanText(m.until - m.from)}`;
  if (memberHolds(m, now)) return `${spanText(m.until - now)} left`;
  return "Ended";
}

export const memberCount = (state: State, group: string): number => state.members.filter((m) => m.group.toLowerCase() === group.toLowerCase()).length;

// ---- Rows ----

export interface MemberRow {
  readonly member: StateMember;
  readonly who: string;
  readonly group: string;
  readonly rank: number;
  readonly where: string;
  readonly span: string;
  readonly removeWhy: string;
}

/** Every membership, highest group rank first, then by group and name. */
export function memberRows(state: State, now: number): MemberRow[] {
  const look = lookOf(state);
  const rows = state.members.map((m): MemberRow => {
    const group = look.group(m.group);
    return {
      member: m,
      who: whoName(m.kind, m.name || (m.kind === "survivor" ? survivorName(state, m.key) : "")),
      group: group?.name ?? m.group,
      rank: group?.rank ?? RANK_OPEN,
      where: worldName(state, m.world),
      span: spanWords(m, now),
      removeWhy: whyNot(state, removeOp(m)),
    };
  });
  return rows.sort((a, b) => b.rank - a.rank || a.group.localeCompare(b.group) || a.who.localeCompare(b.who) || a.member.key.localeCompare(b.member.key));
}

export interface PasswordRow {
  readonly id: string;
  readonly name: string;
  /** Their groups of staff rank and up. */
  readonly groups: readonly string[];
  readonly has: boolean;
  /** When they claimed it, by the wall clock; 0 for none or not known. */
  readonly at: number;
  readonly clearWhy: string;
}

/** Each survivor in a group of staff rank and up, and each other survivor that still has a password. */
export function passwordRows(state: State): PasswordRow[] {
  const look = lookOf(state);
  const groups = new Map<string, Set<string>>();
  for (const m of state.members) {
    const g = look.group(m.group);
    if (m.kind === "survivor" && g && g.rank >= RANK_STAFF) (groups.get(m.key) ?? groups.set(m.key, new Set()).get(m.key)!).add(g.name);
  }
  const claimed = new Map(state.passwords.map((p) => [p.id, p.at]));
  for (const id of claimed.keys()) if (!groups.has(id)) groups.set(id, new Set());
  return [...groups].map(([id, held]) => {
    const has = claimed.has(id);
    return {
      id,
      name: survivorName(state, id),
      groups: [...held].sort(),
      has,
      at: claimed.get(id) ?? 0,
      clearWhy: whyNot(state, { op: "clearSecret", id }) || (has ? "" : "They have no password to clear."),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ---- Changes built from what was typed ----

/** A change ready to send, or why it is not sent. */
export type Built = { readonly post: PermissionsPost; readonly why: "" } | { readonly post: null; readonly why: string };

const refuse = (why: string): Built => ({ post: null, why });

function built(state: State, op: PermissionOp): Built {
  const why = whyNot(state, op);
  return why ? refuse(why) : { post: { do: "op", op }, why: "" };
}

export const addGroupPost = (state: State, name: string, rank: number): Built => built(state, { op: "addGroup", group: name.trim(), rank });
export const removeGroupPost = (state: State, group: string): Built => built(state, { op: "removeGroup", group });
/** A rank, a chat block and the chat settings are sent with `was`, the value the editor began from, which the server checks. */
export const rankPost = (state: State, group: string, rank: number, was: number): Built => built(state, { op: "setRank", group, rank, was });
export const revokePost = (state: State, group: string, permission: string): Built => built(state, { op: "revoke", group, permission });
export const chatPost = (state: State, group: string, chat: string, was: string): Built => built(state, { op: "setChat", group, chat, was });
export const settingsPost = (state: State, text: string, was: string): Built => built(state, { op: "setDocument", name: CHAT_DOCUMENT, text, was });
export const clearPasswordPost = (state: State, id: string): Built => built(state, { op: "clearSecret", id });

export function grantPost(state: State, group: string, typed: string): Built {
  const permission = typed.trim();
  if (permission === "") return refuse("Type a permission, such as Cheat.kick or *.");
  const g = lookOf(state).group(group);
  if (g?.permissions.some((p) => permissionKey(p) === permissionKey(permission))) return refuse(`${g.name} holds ${permission} already.`);
  return built(state, { op: "grant", group, permission });
}


const removeOp = (m: Member): PermissionOp => ({ op: "removeMember", kind: m.kind, key: m.key, group: m.group, world: m.world });
export const removeMemberPost = (state: State, m: Member): Built => built(state, removeOp(m));

/** The words a picker offers for a survivor or a tribe, which `findMember` reads back. */
export const pickWords = (name: string, key: string): string => `${name} (${key})`;

/** The key of the survivor or tribe typed: an ID or team number, a picker's words, or a name this world knows once. */
export function findMember(state: State, kind: MemberKind, typed: string): { key: string; why: string } {
  const t = typed.trim();
  const survivor = kind === "survivor";
  if (t === "") return { key: "", why: survivor ? "Choose a survivor by name, or type their 17-digit ID." : "Choose a tribe by name, or type its number." };
  const key = /\((\d+)\)\s*$/.exec(t)?.[1] ?? (/^\d+$/.test(t) ? t : null);
  if (key !== null) return { key, why: "" };
  const named = (rows: readonly { id: string; name: string }[]): string[] => rows.filter((s) => s.name.toLowerCase() === t.toLowerCase()).map((s) => s.id);
  const here = survivor ? named(state.survivors) : state.tribes.filter((s) => s.name.toLowerCase() === t.toLowerCase()).map((s) => String(s.team));
  // A survivor of another map is found by name in the register.
  const found = survivor && here.length === 0 ? named(state.register) : here;
  const one = survivor ? "survivor" : "tribe";
  if (found.length === 1) return { key: found[0]!, why: "" };
  if (found.length === 0) return { key: "", why: `No ${one} of this world is named ${t}. Type ${survivor ? "their ID" : "its number"} instead.` };
  return { key: "", why: `${counted(found.length, one)} are named ${t}. Type ${survivor ? "the ID" : "the number"} of the one you mean.` };
}

export interface MemberForm {
  kind: MemberKind;
  who: string;
  group: string;
  hours: string;
  delay: string;
  /** Read only for a viewer of cluster rank. */
  everyMap: boolean;
}

/** Hours as typed: undefined for none, or the reason they are not a number. */
function hoursOf(typed: string, what: string): number | undefined | string {
  const t = typed.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : `${what} are a number.`;
}

/** Whether the member form offers its Every map box for a group, which starts unticked, and what it says of the map instead. */
export function everyMapOf(state: State, group: string): { offer: boolean; note: string } {
  const g = lookOf(state).group(group);
  if (!g || state.me.world === 0) return { offer: false, note: "" };
  if (g.rank < RANK_STAFF) return { offer: false, note: "An open group's membership holds on every map." };
  if (g.rank >= RANK_CLUSTER) return { offer: false, note: "A cluster group's membership holds on every map." };
  if (state.me.rank >= RANK_CLUSTER) return { offer: true, note: "A staff membership holds on this map unless you tick Every map." };
  return { offer: false, note: "A staff membership made here holds on this map only." };
}

const NOT_EVERY_MAP = "Only a cluster admin makes a staff membership for every map.";

/** ArkApi's Add or AddTimed. Below cluster rank the server chooses the map: every map for an open group, its own for staff. */
export function addMemberPost(state: State, form: MemberForm): Built {
  const found = findMember(state, form.kind, form.who);
  if (found.why) return refuse(found.why);
  if (form.group === "") return refuse("Choose a group.");
  const rank = lookOf(state).group(form.group)?.rank ?? RANK_OPEN;
  if (form.everyMap && state.me.rank < RANK_CLUSTER && rank >= RANK_STAFF && rank < RANK_CLUSTER) return refuse(NOT_EVERY_MAP);
  const hours = hoursOf(form.hours, "Hours");
  const delay = hoursOf(form.delay, "The hours before it starts");
  if (typeof hours === "string") return refuse(hours);
  if (typeof delay === "string") return refuse(delay);
  const world = state.me.rank >= RANK_CLUSTER ? (form.everyMap ? 0 : state.me.world) : undefined;
  return built(state, {
    op: "addMember", kind: form.kind, key: found.key, group: form.group,
    ...(world === undefined ? {} : { world }), ...(hours === undefined ? {} : { hours }), ...(delay === undefined ? {} : { delayHours: delay }),
  });
}

/** An import's check, or with the check's `digest` its apply. An ArkApi database's `wal` is its -wal file as base64, or "". */
export function importPost(state: State, kind: ImportKind, text: string, apply: boolean, digest = "", wal = ""): Built {
  const why = apply ? defineWhy(state) : manageWhy(state);
  if (why) return refuse(why);
  if (text.trim() === "") return refuse(kind === "arkapi" ? "Choose the ArkApi Permissions file first." : "Paste the text first.");
  if (wal !== "" && kind !== "arkapi") return refuse("A -wal file goes only beside an ArkApi database.");
  const files = { kind, text, ...(wal === "" ? {} : { wal }) };
  if (!apply) return { post: { do: "plan", ...files }, why: "" };
  return digest === "" ? refuse("Check it first.") : { post: { do: "import", ...files, digest }, why: "" };
}

/** What an import is of: its kind, the pasted text or the file as base64, and an ArkApi database's -wal file as base64 or "". */
export interface ImportInput {
  readonly kind: ImportKind;
  readonly text: string;
  readonly wal: string;
}

/** The import tab's approval: counts of edits to its input and of requests sent, and the check Apply may send, with its input. */
export interface ImportTrack {
  readonly input: number;
  readonly asked: number;
  readonly checked: { readonly of: ImportInput; readonly digest: string } | null;
}

export const IMPORT_START: ImportTrack = { input: 0, asked: 0, checked: null };

/** The input changed: no check made before is of it. */
export const importEdited = (t: ImportTrack): ImportTrack => ({ ...t, input: t.input + 1, checked: null });

/** A check or an apply is sent: the track it is sent at is the one its answer is matched against. */
export const importAsked = (t: ImportTrack): ImportTrack => ({ ...t, asked: t.asked + 1 });

const sameInput = (a: ImportInput, b: ImportInput): boolean => a.kind === b.kind && a.text === b.text && a.wal === b.wal;

/**
 * The track after an answer to the request sent at `sent`, for input `of`, and whether to show the answer. An answer to
 * an older request, or of an input since edited, approves nothing: a check's is dropped, an apply's is shown.
 */
export function importAnswered(t: ImportTrack, sent: ImportTrack, of: ImportInput, answer: PermissionsAnswer, applied: boolean): { track: ImportTrack; shown: boolean } {
  if (sent.input !== t.input || sent.asked !== t.asked) return { track: applied ? { ...t, checked: null } : t, shown: applied };
  // An apply refused because the plan changed since its check carries the plan as it is now, to be applied in its turn.
  const approves = answer.digest !== undefined && answer.digest !== "" && (!applied || !answer.ok);
  return { track: { ...t, checked: approves ? { of, digest: answer.digest! } : null }, shown: true };
}

/** An import's apply of the input as it is now, only where the check Apply would send was of that exact input. */
export function importApplyPost(state: State, t: ImportTrack, now: ImportInput): Built {
  if (!t.checked) return importPost(state, now.kind, now.text, true, "", now.wal);
  if (!sameInput(t.checked.of, now)) return refuse("The import changed since its check. Check it again.");
  return importPost(state, now.kind, now.text, true, t.checked.digest, now.wal);
}

// ---- Edits of a whole value ----

/**
 * A rank, a chat block or the chat settings being edited: the value the edit began from, which its change is sent with as
 * `was`; the draft; and the value someone else saved meanwhile, once the server said so, else null.
 */
export interface Edit<T> {
  readonly from: string | number;
  readonly draft: T;
  readonly theirs: string | number | null;
}

export const editOf = <T>(from: string | number, draft: T): Edit<T> => ({ from, draft, theirs: null });

/**
 * What becomes of an edit once its change is answered: gone once saved; kept when someone changed the value meanwhile,
 * beginning from theirs so that the next send goes over it; as it was after any other answer.
 */
export function editAfter<T>(edit: Edit<T>, answer: PermissionsAnswer): Edit<T> | null {
  if (answer.ok) return null;
  if (answer.why === CHANGED_MEANWHILE && answer.current !== undefined) return { from: answer.current, draft: edit.draft, theirs: answer.current };
  return edit;
}

/** The box beside a draft someone else's change overtook: theirs, and a button to send the draft over it or keep theirs. */
export function conflictHtml(act: string, group: string, theirs: string, saveWords: string): string {
  const at = group === "" ? "" : ` data-group="${esc(group)}"`;
  return `<div class="conflict" role="alert"><p class="warn">Someone saved this meanwhile. Yours is kept here, not saved. Theirs:</p>
    <pre>${esc(theirs === "" ? "(nothing)" : theirs)}</pre>
    <div class="bar"><button class="primary" data-act="${act}-again"${at}>${esc(saveWords)}</button><button data-act="${act}-keep"${at}>Keep theirs</button></div></div>`;
}

// ---- History ----

const HOW: Record<HistoryRow["via"], string> = { ...VIA_WORDS, server: "By the server", "": "Not known" };

/** One row of the cluster's history in words: when, who, which map and what. */
export function historyRow(state: State, r: HistoryRow): { when: string; name: string; nameTitle: string; id: string; rank: string; how: string; map: string; what: string } {
  return {
    when: whenText(r.at, 0),
    name: r.name === "" ? "Not known" : r.name,
    nameTitle: typedName(r.name) ? TYPED : "",
    id: r.id,
    rank: r.rank < 0 ? "" : (RANK_NAMES[r.rank] ?? "not known"),
    how: HOW[r.via] ?? "Not known",
    map: r.world === 0 && state.me.world === 0 ? mapName(state) : worldName(state, r.world),
    what: r.what,
  };
}

export function historyHtml(state: State, rows: readonly HistoryRow[]): string {
  if (rows.length === 0) return '<tr><td colspan="5" class="dim">No changes yet.</td></tr>';
  return rows.map((row) => {
    const r = historyRow(state, row);
    const title = r.nameTitle === "" ? "" : ` title="${esc(r.nameTitle)}" class="typed"`;
    const id = r.id === "" ? "" : ` <code>${esc(r.id)}</code>`;
    return `<tr><td class="when">${esc(r.when)}</td><td class="who"><span${title}>${esc(r.name)}</span>${id} <br><span class="dim">${esc([r.rank, r.how].filter((w) => w).join(", "))}</span></td>` +
      `<td>${esc(r.map)}</td><td class="what">${esc(r.what)}</td></tr>`;
  }).join("");
}

// ---- Colours ----

/** The first ink of a marked-up string, or -1. */
export const firstInk = (source: string): number => readRichColor(source).find((r) => r.ink !== undefined)?.ink ?? -1;
/** A marked-up string made one colour, or none where `ink` is -1. */
export const coloured = (source: string, ink: number): string => writeRichColor(stripRichColor(source), ink < 0 ? undefined : ink);
export const inkHex = (ink: number): string => `#${((ink < 0 ? 0xffffff : ink) & 0xffffff).toString(16).padStart(6, "0")}`;
export const hexInk = (hex: string): number => (/^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : -1);

// ---- A group's chat block ----

export interface ChatForm {
  format: string;
  priority: string;
  /** Kept as read; chat here shows no icons. */
  icon: string;
  parts: Record<PartKey, string>;
}

/** A fault and the field it belongs beside: "format", "priority", "part.<key>", "tag.<i>", "map.<i>", "muted", or "" for the whole. */
export interface Fault {
  readonly at: string;
  readonly text: string;
}

export function blankChatForm(): ChatForm {
  const f = readChatFormat({}).value!;
  return { format: DEFAULT_CHAT_FORMAT, priority: "0", icon: "", parts: { ...f.parts } };
}

const formOf = (f: ChatFormat): ChatForm => ({ format: f.chatFormat, priority: String(f.priority), icon: f.icon, parts: { ...f.parts } });

/** A group's chat block as its form, or null where it has none. What was wrong in it is said. */
export function chatFormOf(chat: string): { form: ChatForm | null; faults: string[] } {
  if (chat === "") return { form: null, faults: [] };
  const json = readLooseJson(chat);
  if (!json.ok) return { form: blankChatForm(), faults: [json.reason] };
  const read = readChatFormat(json.value);
  return { form: read.value ? formOf(read.value) : blankChatForm(), faults: read.faults };
}

/** The field a reader's fault names. */
function chatFaultAt(text: string): string {
  const part = /^FormattingParts\.([a-z]+)/.exec(text);
  if (part) return `part.${part[1]}`;
  return text.startsWith("ChatFormat") ? "format" : text.startsWith("Priority") ? "priority" : "";
}

/** A chat block from its form, in CrossChat's keys, with what is wrong in it. One with a fault is not sent. */
export function chatBlockOf(form: ChatForm): { text: string; format: ChatFormat | null; faults: Fault[] } {
  const faults: Fault[] = [];
  const p = form.priority.trim();
  const priority = p === "" ? NaN : Number(p);
  if (!Number.isFinite(priority)) faults.push({ at: "priority", text: "Priority is a number. The highest among a speaker's groups gives the format." });
  const block = { ChatFormat: form.format, Priority: Number.isFinite(priority) ? priority : 0, Icon: form.icon, FormattingParts: { ...form.parts } };
  const read = readChatFormat(block);
  for (const text of read.faults) faults.push({ at: chatFaultAt(text), text });
  const text = JSON.stringify(block);
  if (text.length > MAX_CHAT_LENGTH) faults.push({ at: "", text: `A chat block is at most ${MAX_CHAT_LENGTH} letters.` });
  return { text, format: read.value, faults };
}

// ---- The chat settings ----

export interface TagForm {
  name: string;
  text: string;
  priority: string;
  icon: string;
  canBeDisabled: boolean;
}

export interface MapForm {
  map: string;
  /** #rrggbb */
  colour: string;
}

export interface SettingsForm {
  stack: boolean;
  muted: string;
  tags: TagForm[];
  maps: MapForm[];
}

/** The chat settings document as its form, or the server's own where the store holds none. What was wrong in it is said. */
export function settingsFormOf(document: string): { form: SettingsForm; faults: string[] } {
  const faults: string[] = [];
  let raw: unknown = START_CHAT_SETTINGS;
  if (document !== "") {
    const json = readLooseJson(document);
    if (json.ok) raw = json.value;
    else faults.push(json.reason);
  }
  const read = readChatSettings(raw);
  faults.push(...read.faults);
  const s = read.value;
  return {
    form: {
      stack: s.stackTags,
      muted: s.mutedGroup,
      tags: s.tags.map((t) => ({ name: t.name, text: t.text, priority: String(t.priority), icon: t.icon, canBeDisabled: t.canBeDisabled })),
      maps: [...s.mapColors].map(([map, ink]) => ({ map, colour: inkHex(ink) })),
    },
    faults,
  };
}

export const blankTag = (): TagForm => ({ name: "", text: "", priority: "0", icon: "", canBeDisabled: true });

/** The chat settings document from its form, in CrossChat's keys, with what is wrong in it. One with a fault is not sent. */
export function settingsTextOf(form: SettingsForm): { text: string; faults: Fault[] } {
  const faults: Fault[] = [];
  const tags: Record<string, unknown> = { StackChatTags: form.stack };
  const seen = new Set<string>();
  form.tags.forEach((t, i) => {
    const at = `tag.${i}`;
    const name = t.name.trim();
    const priority = t.priority.trim() === "" ? NaN : Number(t.priority);
    if (!isGroupName(name)) faults.push({ at, text: "A tag is named for its group: up to 32 letters, digits and _ . : -" });
    else if (name.toLowerCase() === "stackchattags") faults.push({ at, text: "A tag may not be named StackChatTags." });
    else if (seen.has(name.toLowerCase())) faults.push({ at, text: `Two tags are named ${name}.` });
    if (!Number.isFinite(priority)) faults.push({ at, text: "A tag's priority is a number." });
    seen.add(name.toLowerCase());
    tags[name] = { Priority: Number.isFinite(priority) ? priority : 0, Icon: t.icon, Text: t.text, CanBeDisabled: t.canBeDisabled };
  });
  const muted = form.muted.trim();
  if (muted !== "" && !isGroupName(muted)) faults.push({ at: "muted", text: "The muted group is a group's name: up to 32 letters, digits and _ . : -" });
  const colors: Record<string, number[]> = {};
  const maps = new Set<string>();
  form.maps.forEach((m, i) => {
    const at = `map.${i}`;
    const name = m.map.trim();
    const ink = hexInk(m.colour);
    if (name === "") faults.push({ at, text: "Name the map, as its players see it." });
    else if (maps.has(name.toLowerCase())) faults.push({ at, text: `${name} has two colours.` });
    if (ink < 0) faults.push({ at, text: "Choose the map's colour." });
    maps.add(name.toLowerCase());
    colors[name] = [(ink >> 16) & 255, (ink >> 8) & 255, ink & 255];
  });
  const text = JSON.stringify({ ChatTags: tags, MutedPermissionGroup: muted, MapColors: colors });
  if (text.length > MAX_DOCUMENT_LENGTH) faults.push({ at: "", text: `The chat settings are at most ${MAX_DOCUMENT_LENGTH} letters.` });
  return { text, faults };
}

/** The runs a tag's text shows. */
export const tagRuns = (text: string): TextRun[] => readRichColor(text);

// ---- The sample line ----

export const SAMPLE = { sender: "Rowan", tribe: "River Folk", message: "Meet at the river at dusk." } as const;

/** A line from a member of `group` alone, drawn with the form's chat block and tags as they are typed. */
export function sampleRuns(state: State, group: string, form: ChatForm | null, settings: SettingsForm): TextRun[] {
  const format = form ? chatBlockOf(form).format : null;
  const json = readLooseJson(settingsTextOf(settings).text);
  const s = readChatSettings(json.ok ? json.value : {}).value;
  const map = state.me.world === 0 ? "The Island" : worldName(state, state.me.world);
  const ink = mapInk(s, map);
  return formatLine(format, chooseTags(s, [group]), { ...SAMPLE, map, ...(ink === undefined ? {} : { mapInk: ink }) });
}

// ---- HTML ----

/** The attributes of a control the viewer may not use, with the reason as its title. */
const off = (why: string): string => (why ? ` disabled title="${esc(why)}"` : "");
const faultsHtml = (faults: readonly Fault[], at: string): string =>
  `<span class="bad fault" data-fault="${esc(at)}">${esc(faults.filter((f) => f.at === at).map((f) => f.text).join(" "))}</span>`;

/** The ranks a choice offers, each the viewer may not choose disabled with the reason. */
export function rankOptions(current: number, why: (rank: number) => string): string {
  return RANK_NAMES.map((name, rank) => {
    const no = rank === current ? "" : why(rank);
    return `<option value="${rank}"${rank === current ? " selected" : ""}${off(no)}>${esc(name)}</option>`;
  }).join("");
}

/** Each group, a rank someone changed meanwhile shown as the draft beside theirs, by group name in lower case. */
export function groupsHtml(state: State, ranks: ReadonlyMap<string, Edit<number>> = new Map()): string {
  return state.groups.map((g) => {
    const edit = ranks.get(g.name.toLowerCase());
    const shown = edit?.theirs !== null && edit?.theirs !== undefined ? edit.draft : g.rank;
    const others = RANK_NAMES.map((_, r) => (r === g.rank ? "" : whyNot(state, { op: "setRank", group: g.name, rank: r })));
    const stuck = others.every((w, r) => r === g.rank || w !== "");
    const rankWhyOf = (r: number) => others[r]!;
    const n = memberCount(state, g.name);
    const grantWhy = whyNot(state, { op: "grant", group: g.name, permission: "*" });
    const chips = g.permissions.map((p) =>
      `<span class="chip">${esc(p)} <button class="x" data-act="revoke" data-group="${esc(g.name)}" data-perm="${esc(p)}" aria-label="Take ${esc(p)} from ${esc(g.name)}"${off(whyNot(state, { op: "revoke", group: g.name, permission: p }))}>×</button></span>`).join("");
    return `<div class="group" data-group="${esc(g.name)}">
      <div class="bar"><h3 class="grow">${esc(g.name)}</h3>
        <label>Rank <select data-act="rank" data-group="${esc(g.name)}"${off(stuck ? others.find((w) => w !== "") ?? "" : "")}>${rankOptions(shown, rankWhyOf)}</select></label>
        <span class="dim">${g.name.toLowerCase() === DEFAULT_GROUP.toLowerCase() ? "Everyone" : counted(n, "member")}</span>
        <button class="risk" data-act="remove-group" data-group="${esc(g.name)}"${off(whyNot(state, { op: "removeGroup", group: g.name }))}>Remove group</button></div>
      ${edit && edit.theirs !== null ? conflictHtml("rank", g.name, RANK_NAMES[Number(edit.theirs)] ?? String(edit.theirs), `Make it ${RANK_NAMES[edit.draft] ?? ""} over theirs`) : ""}
      ${freeCheats(g) ? `<p class="warn">${FREE_CHEATS}</p>` : ""}
      <div class="marks">${chips || '<span class="dim">No permissions.</span>'}</div>
      <div class="bar"><input data-grant="${esc(g.name)}" list="permission-list" placeholder="Add a permission, such as Cheat.kick" aria-label="A permission for ${esc(g.name)}" autocomplete="off"${off(grantWhy)}>
        <button data-act="grant" data-group="${esc(g.name)}"${off(grantWhy)}>Add permission</button></div>
    </div>`;
  }).join("") || '<p class="dim">No groups yet.</p>';
}

export function permissionListHtml(state: State): string {
  return permissionOptions(state).map((p) => `<option value="${esc(p)}">`).join("");
}

export function memberGroupOptions(state: State, chosen: string): string {
  return state.groups.filter((g) => g.name.toLowerCase() !== DEFAULT_GROUP.toLowerCase()).map((g) => {
    const why = rankWhy(state, g.rank);
    return `<option value="${esc(g.name)}"${g.name === chosen ? " selected" : ""}${off(why)}>${esc(g.name)} (${esc(RANK_NAMES[g.rank] ?? "")})</option>`;
  }).join("");
}

/** The picker's choices: this world's survivors, online first, or its tribes. */
export function whoOptions(state: State, kind: MemberKind): string {
  if (kind === "tribe") return state.tribes.map((t) => `<option value="${esc(pickWords(t.name, String(t.team)))}">`).join("");
  const sorted = [...state.survivors].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return sorted.map((s) => `<option value="${esc(pickWords(s.name, s.id))}" label="${esc(s.online ? `${s.name}, online` : s.name)}">`).join("");
}

export function memberRowsHtml(rows: readonly MemberRow[]): string {
  if (rows.length === 0) return '<tr><td colspan="5" class="dim">Nobody is in a group yet, beyond Default.</td></tr>';
  return rows.map((r, i) => `<tr>
    <td>${esc(r.who)} <code>${esc(r.member.key)}</code></td>
    <td>${esc(r.group)} <span class="dim">${esc(RANK_NAMES[r.rank] ?? "")}</span></td>
    <td>${esc(r.span)}</td><td>${esc(r.where)}</td>
    <td><button class="risk" data-act="remove-member" data-row="${i}"${off(r.removeWhy)}>Remove</button></td></tr>`).join("");
}

export function passwordRowsHtml(rows: readonly PasswordRow[]): string {
  if (rows.length === 0) return '<tr><td colspan="4" class="dim">Nobody is in a staff group yet.</td></tr>';
  return rows.map((r) => `<tr>
    <td>${esc(r.name || "A survivor this world does not know")} <code>${esc(r.id)}</code></td>
    <td>${esc(r.groups.join(", ") || "No staff group now")}</td>
    <td>${r.has ? `Claimed${r.at > 0 ? ` on ${esc(whenText(r.at, 0).slice(0, 16))}` : ""}` : '<span class="warn">Not claimed yet</span>'}</td>
    <td><button class="risk" data-act="clear-password" data-id="${esc(r.id)}"${off(r.clearWhy)}>Clear password</button></td></tr>`).join("");
}

/** One group's chat block: its form, the faults beside their fields, and a place for its sample line. */
export function chatGroupHtml(state: State, g: Group, form: ChatForm | null, faults: readonly Fault[], theirs: string | null = null): string {
  const why = whyNot(state, { op: "setChat", group: g.name, chat: "" });
  const conflict = theirs === null ? "" : conflictHtml("chat", g.name, theirs, "Save mine over theirs");
  const head = `<div class="bar"><h3 class="grow">${esc(g.name)}</h3>`;
  if (!form) {
    return `<div class="chat-block" data-chat="${esc(g.name)}">${head}<button data-act="chat-add" data-group="${esc(g.name)}"${off(why)}>Give it a chat format</button></div>${conflict}
      <p class="dim">No chat format of its own. A member's lines take another group's, or <code>${esc(DEFAULT_CHAT_FORMAT)}</code>.</p>
      <p class="sample" data-sample="${esc(g.name)}"></p></div>`;
  }
  const parts = PART_KEYS.map((key) => `<div class="part">
      <label><code>{${key}}</code> <input data-field="part.${key}" value="${esc(form.parts[key])}" autocomplete="off"${off(why)}></label>
      <input type="color" data-colour="${key}" value="${inkHex(firstInk(form.parts[key]))}" aria-label="The colour of {${key}}"${off(why)}>
      <button data-act="plain" data-part="${key}"${off(why)}>No colour</button>
      ${faultsHtml(faults, `part.${key}`)}</div>`).join("");
  return `<div class="chat-block" data-chat="${esc(g.name)}">${head}
      <label>Priority <input type="number" step="any" data-field="priority" value="${esc(form.priority)}"${off(why)}></label>${faultsHtml(faults, "priority")}</div>${conflict}
    <label class="line">Format line <input data-field="format" value="${esc(form.format)}" autocomplete="off"${off(why)}></label>${faultsHtml(faults, "format")}
    <div class="parts">${parts}</div>
    <p class="sample" data-sample="${esc(g.name)}"></p>
    ${faultsHtml(faults, "")}
    <div class="bar"><button class="primary" data-act="chat-save" data-group="${esc(g.name)}"${off(why)}>Save chat format</button>
      <button data-act="chat-undo" data-group="${esc(g.name)}">Undo changes</button>
      <button class="risk" data-act="chat-remove" data-group="${esc(g.name)}"${off(why)}>Remove chat format</button></div></div>`;
}

export function settingsHtml(state: State, form: SettingsForm, faults: readonly Fault[], theirs: string | null = null): string {
  const why = defineWhy(state);
  const conflict = theirs === null ? "" : conflictHtml("settings", "", theirs, "Save mine over theirs");
  const tags = form.tags.map((t, i) => `<tr data-tag="${i}">
      <td><input data-set="tag.name" value="${esc(t.name)}" list="group-list" aria-label="The tag's group" autocomplete="off"${off(why)}></td>
      <td><input data-set="tag.text" value="${esc(t.text)}" aria-label="The tag's text" autocomplete="off"${off(why)}>
        <input type="color" data-set="tag.colour" value="${inkHex(firstInk(t.text))}" aria-label="The tag's colour"${off(why)}></td>
      <td><span class="sample" data-tag-sample="${i}"></span></td>
      <td><input type="number" step="any" data-set="tag.priority" value="${esc(t.priority)}" aria-label="The tag's priority"${off(why)}></td>
      <td><input type="checkbox" data-set="tag.off"${t.canBeDisabled ? " checked" : ""} aria-label="A player may switch it off"${off(why)}></td>
      <td><button class="risk" data-act="tag-del" data-tag="${i}"${off(why)}>Remove</button> ${faultsHtml(faults, `tag.${i}`)}</td></tr>`).join("");
  const maps = form.maps.map((m, i) => `<tr data-map="${i}">
      <td><input data-set="map.map" value="${esc(m.map)}" list="world-list" aria-label="The map's name" autocomplete="off"${off(why)}></td>
      <td><input type="color" data-set="map.colour" value="${esc(m.colour)}" aria-label="The map's colour"${off(why)}></td>
      <td><button class="risk" data-act="map-del" data-map="${i}"${off(why)}>Remove</button> ${faultsHtml(faults, `map.${i}`)}</td></tr>`).join("");
  return `${conflict}<div class="bar"><label><input type="checkbox" data-set="stack"${form.stack ? " checked" : ""}${off(why)}> Show every tag a speaker has. Off, only the highest shows.</label></div>
    <div class="bar"><label>Muted group <input data-set="muted" value="${esc(form.muted)}" list="group-list" autocomplete="off"${off(why)}></label>
      <span class="dim">Its members may not speak in global chat.</span>${faultsHtml(faults, "muted")}</div>
    <h3>Tags</h3>
    <div class="scroll"><table><thead><tr><th>Group</th><th>Text and colour</th><th>Shown as</th><th>Priority</th><th>A player may switch it off</th><th></th></tr></thead>
      <tbody>${tags || '<tr><td colspan="6" class="dim">No tags.</td></tr>'}</tbody></table></div>
    <div class="bar"><button data-act="tag-add"${off(why)}>Add a tag</button></div>
    <h3>Map colours</h3>
    <p class="dim">The {map} part of a line from another map takes its map's colour.</p>
    <div class="scroll"><table><thead><tr><th>Map</th><th>Colour</th><th></th></tr></thead>
      <tbody>${maps || '<tr><td colspan="3" class="dim">No map colours.</td></tr>'}</tbody></table></div>
    <div class="bar"><button data-act="map-add"${off(why)}>Add a map colour</button></div>
    ${faultsHtml(faults, "")}
    <div class="bar"><button class="primary" data-act="settings-save"${off(why)}>Save chat settings</button><button data-act="settings-undo">Undo changes</button></div>`;
}

/** What an import's check or apply answered. */
export function importHtml(answer: PermissionsAnswer, applied: boolean): string {
  // An apply refused because the plan changed since its check carries the plan as it is now.
  const changed = !answer.ok && answer.digest !== undefined;
  if (!answer.ok && !changed) return `<p class="bad">${esc(answer.why || "The import was refused.")}</p>`;
  const ops = answer.ops ?? 0;
  const would = ops === 0 ? "It would change nothing." : `It would make ${counted(ops, "change")}. Apply makes them.`;
  const head = changed ? `${answer.why} ${would}` : applied ? `Made ${counted(ops, "change")}.` : would;
  const notes = (answer.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join("");
  const refused = (answer.refused ?? []).map((r) => `<li><b>${esc(r.what)}</b>: ${esc(r.why)}</li>`).join("");
  return `<p class="${changed ? "warn" : applied ? "well" : ""}">${esc(head)}</p>
    ${notes ? `<h3>Notes</h3><ul>${notes}</ul>` : ""}
    ${refused ? `<h3 class="bad">Refused</h3><ul>${refused}</ul>` : ""}`;
}
