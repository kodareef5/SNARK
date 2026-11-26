// What a speaker's permission groups make of their chat line: the format of the highest, their tags, and the muted group.
// The groups' chat blocks and the settings document are read once for each change of the store, not for each line.
import type { TextRun } from "../../shared/net/chat.ts";
import { START_CHAT_SETTINGS, chooseFormat, chooseTags, formatLine, mapInk, readChatFormat, readChatSettings, readLooseJson, type ChatFormat, type ChatSettings, type ChatTag } from "../../shared/permissions/chat.ts";
import { ADMINS_GROUP, type Group } from "../../shared/permissions/model.ts";
import { CHAT_DOCUMENT } from "../../shared/permissions/page.ts";
import { RANK_ADMIN } from "../../shared/ranks.ts";
import type { Permissions, PermissionSubject } from "./permissions.ts";

/** What stands where the store holds no chat settings; the Permissions page shows the same. */
export const START_BOOK: ChatSettings = readChatSettings(START_CHAT_SETTINGS).value;

/** The format of a speaker whose groups give none: the name and the words, after the map's name in brackets on other maps. */
const PLAIN = readChatFormat({ ChatFormat: "{map} {tags} {sender}: {message}", FormattingParts: { map: "[{name}]" } }).value!;

interface Book {
  readonly version: number;
  readonly settings: ChatSettings;
  /** By the group's name in lower case. */
  readonly formats: Map<string, ChatFormat | null>;
}

const books = new WeakMap<Permissions, Book>();

function bookOf(perms: Permissions): Book {
  const kept = books.get(perms);
  if (kept && kept.version === perms.version) return kept;
  const text = perms.document(CHAT_DOCUMENT);
  const json = text === "" ? null : readLooseJson(text);
  const book = { version: perms.version, settings: json?.ok ? readChatSettings(json.value).value : START_BOOK, formats: new Map() };
  books.set(perms, book);
  return book;
}

/** A group's chat block, read once; null where it has none or it does not read. */
function formatOf(book: Book, g: Group): ChatFormat | null {
  const key = g.name.toLowerCase();
  let format = book.formats.get(key);
  if (format === undefined) {
    const json = g.chat === "" ? null : readLooseJson(g.chat);
    format = json?.ok ? readChatFormat(json.value).value : null;
    book.formats.set(key, format);
  }
  return format;
}

/** The groups that count for a speaker now. A connection at an admin's rank is in Admins too, whatever password it gave. */
function groupsOf(perms: Permissions, subject: PermissionSubject, rank: number): Group[] {
  const groups = perms.groupsOf(subject);
  const admins = perms.group(ADMINS_GROUP);
  if (rank >= RANK_ADMIN && admins && !groups.includes(admins)) groups.push(admins);
  return groups;
}

/** The tags `subject` switched off. */
function offOf(perms: Permissions, settings: ChatSettings, id: string): string[] {
  const off: string[] = [];
  for (const t of settings.tags) if (perms.tagChoice(id, t.name) === false) off.push(t.name);
  return off;
}

function shownTags(perms: Permissions, book: Book, subject: PermissionSubject, groups: readonly Group[]): ChatTag[] {
  return chooseTags(book.settings, groups.map((g) => g.name), offOf(perms, book.settings, subject.id));
}

/** What a speaker's line says, as runs. `map` and `mapId` are given only for a line going to the cluster's other maps. */
export function speakerLine(perms: Permissions, subject: PermissionSubject, rank: number, words: { sender: string; tribe: string; message: string }, map?: string, mapId = ""): TextRun[] {
  const book = bookOf(perms);
  const groups = groupsOf(perms, subject, rank);
  const format = chooseFormat(groups.map((g) => ({ name: g.name, format: formatOf(book, g) }))) ?? PLAIN;
  const ink = map ? (mapInk(book.settings, mapId) ?? mapInk(book.settings, map)) : undefined;
  return formatLine(format, shownTags(perms, book, subject, groups), { ...words, ...(map ? { map } : {}), ...(ink !== undefined ? { mapInk: ink } : {}) });
}

/** The names of the tags a speaker's line shows now. */
export function shownTagNames(perms: Permissions, subject: PermissionSubject, rank: number): string[] {
  const book = bookOf(perms);
  return shownTags(perms, book, subject, groupsOf(perms, subject, rank)).map((t) => t.name);
}

/** Each tag a speaker has by their groups, highest first, and whether their lines show it now. */
export function heldTags(perms: Permissions, subject: PermissionSubject, rank: number): { tag: ChatTag; shown: boolean }[] {
  const book = bookOf(perms);
  const groups = groupsOf(perms, subject, rank);
  const shown = shownTags(perms, book, subject, groups);
  const all = chooseTags({ ...book.settings, stackTags: true }, groups.map((g) => g.name));
  return all.map((tag) => ({ tag, shown: shown.includes(tag) }));
}

/** Why `subject` may not use global chat, or "": the muted group's members may not. */
export function globalRefused(perms: Permissions, subject: PermissionSubject): string {
  return perms.inGroup(subject, bookOf(perms).settings.mutedGroup) ? "You are muted: global chat is closed to you. Local and tribe chat still work." : "";
}
