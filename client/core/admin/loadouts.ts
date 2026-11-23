// The loadouts' admin page, its parts that are not the page's wiring (client/admin/loadouts.ts): the draft and each
// change to it, what a picker finds, what the draft changes of the book in force, and the page's lists as HTML.

import { LOADOUT_ID, MOST, isTame, loadoutFaults, type Entry, type ItemEntry, type Loadout, type LoadoutBook, type LoadoutFault, type Place, type TameEntry } from "../../../shared/loadout/book.ts";
import type { LoadoutCatalog, LoadoutItem, LoadoutSpecies } from "../../../shared/loadout/catalog.ts";
import { esc } from "./format.ts";

export type Role = "player" | "admin";
export const ROLES: readonly Role[] = ["player", "admin"];
export const ROLE_WORDS: Readonly<Record<Role, string>> = { player: "New players get", admin: "New admins get" };
const PLACE_WORDS: Readonly<Record<Place, string>> = { wear: "worn", hotbar: "hotbar", bag: "bag" };

/** The catalogue with each item and species found by its id. */
export interface Known {
  catalog: LoadoutCatalog;
  item: Map<string, LoadoutItem>;
  species: Map<string, LoadoutSpecies>;
}

export function knownOf(catalog: LoadoutCatalog): Known {
  return { catalog, item: new Map(catalog.items.map((i) => [i.id, i])), species: new Map(catalog.species.map((s) => [s.id, s])) };
}

/** A copy of the book to change, none of it the book in force. */
export const draftOf = (book: LoadoutBook): LoadoutBook => JSON.parse(JSON.stringify(book)) as LoadoutBook;

const find = (book: LoadoutBook, id: string): Loadout | undefined => book.loadouts.find((l) => l.id === id);

/** `want`, or `want` with the first number after it that no loadout of the book has. */
function freeId(book: LoadoutBook, want: string): string {
  const base = want.slice(0, 28);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!find(book, id)) return id;
  }
}

/** Adds an empty loadout and returns its id, or null where the book is full. */
export function addLoadout(book: LoadoutBook): string | null {
  if (book.loadouts.length >= MOST.loadouts) return null;
  const id = freeId(book, "new");
  book.loadouts.push({ id, label: "New loadout", note: "", respawn: false, entries: [] });
  return id;
}

/** Adds a copy of loadout `id` after it and returns the copy's id, or null. */
export function copyLoadout(book: LoadoutBook, id: string): string | null {
  const at = book.loadouts.findIndex((l) => l.id === id);
  if (at < 0 || book.loadouts.length >= MOST.loadouts) return null;
  const from = book.loadouts[at]!;
  const copy: Loadout = { ...draftOf({ revision: 0, assign: book.assign, loadouts: [from] }).loadouts[0]!, id: freeId(book, `${id.slice(0, 23)}-copy`), label: [...`${from.label} copy`].slice(0, MOST.label).join("") };
  book.loadouts.splice(at + 1, 0, copy);
  return copy.id;
}

/** Removes loadout `id`. Returns why not, having changed nothing, or "": one a role is given is not removed. */
export function removeLoadout(book: LoadoutBook, id: string): string {
  const at = book.loadouts.findIndex((l) => l.id === id);
  if (at < 0) return "There is no such loadout.";
  for (const role of ROLES) if (book.assign[role] === id) return `${ROLE_WORDS[role]} this loadout. Choose another for them first.`;
  book.loadouts.splice(at, 1);
  return "";
}

/** Gives loadout `id` the id `next`, and the roles given it with it. Returns why not, or "". */
export function renameLoadout(book: LoadoutBook, id: string, next: string): string {
  const l = find(book, id);
  if (!l) return "There is no such loadout.";
  if (next === id) return "";
  if (!LOADOUT_ID.test(next)) return "An id is 1 to 32 of a to z, 0 to 9 and -.";
  if (find(book, next)) return `Another loadout is ${next} already.`;
  l.id = next;
  for (const role of ROLES) if (book.assign[role] === id) book.assign[role] = next;
  return "";
}

/** Sets a loadout's label, note or whether it is handed out again after each death. */
export function setLoadout(book: LoadoutBook, id: string, change: Partial<Pick<Loadout, "label" | "note" | "respawn">>): boolean {
  const l = find(book, id);
  if (!l) return false;
  Object.assign(l, change);
  return true;
}

/** Gives `role` the loadout `id`. False if the book has none. */
export function setAssign(book: LoadoutBook, role: Role, id: string): boolean {
  if (!find(book, id)) return false;
  book.assign[role] = id;
  return true;
}

/** Adds an entry with nothing chosen yet to the end of loadout `id`. False where it is full. */
export function addEntry(book: LoadoutBook, id: string, kind: "item" | "tame"): boolean {
  const l = find(book, id);
  if (!l || l.entries.length >= MOST.entries) return false;
  l.entries.push(kind === "item" ? { item: "", count: 1, place: "bag" } : { tame: "", level: 1, saddled: false, place: "bag" });
  return true;
}

/** The places an entry of `item` may be given in: worn only for armor, and a blueprint only in the bag. */
export function placesFor(item: LoadoutItem | undefined, blueprint = false): Place[] {
  if (blueprint) return ["bag"];
  return item?.wear ? ["wear", "hotbar", "bag"] : ["hotbar", "bag"];
}

/** Whether an entry of `item` is offered a quality: only where quality changes what the item does. */
export const qualityFor = (item: LoadoutItem | undefined): boolean => item?.quality === true;

/** A change to an entry: any of an item's or a tame's fields. */
export type EntryChange = Partial<Omit<ItemEntry, "place"> & Omit<TameEntry, "place"> & { place: Place }>;

/** What a field of an entry's row holds, as a change to the entry, or null for what the field does not take. */
export function fieldChange(field: string, raw: string | boolean): EntryChange | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  const whole = (most: number): number | null => (/^\d+$/.test(text) ? Math.min(most, Math.max(1, Number(text))) : null);
  if (field === "item" || field === "tame" || field === "ammo" || field === "attach") return typeof raw === "string" ? { [field]: text } : null;
  if (field === "blueprint" || field === "saddled") return typeof raw === "boolean" ? { [field]: raw } : null;
  if (field === "place") return text === "wear" || text === "hotbar" || text === "bag" ? { place: text } : null;
  if (field === "quality") return /^\d+$/.test(text) ? { quality: Number(text) } : null;
  const n = field === "count" ? whole(MOST.count) : field === "level" ? whole(MOST.level) : null;
  return n === null ? null : { [field]: n };
}

/** Sets on `e` each of `keys` that `change` has. */
function take(e: Entry, change: EntryChange, keys: readonly (keyof EntryChange)[]): void {
  for (const key of keys) if (change[key] !== undefined) (e as unknown as Record<string, unknown>)[key] = change[key];
}

/**
 * Changes entry `index` of loadout `id`, and puts right what no longer goes with the change: a piece that is not armor is
 * not worn, a worn piece is one, a blueprint lies in the bag unloaded, and what the item does not take is taken off.
 */
export function changeEntry(book: LoadoutBook, id: string, index: number, change: EntryChange, known: Known): boolean {
  const e = find(book, id)?.entries[index];
  if (!e) return false;
  if (isTame(e)) {
    take(e, change, ["tame", "level", "saddled"]);
    if (change.place === "hotbar" || change.place === "bag") e.place = change.place;
    if (known.species.get(e.tame)?.saddle === false) e.saddled = false;
    return true;
  }
  const fresh = e.item === "" && change.item !== undefined && change.item !== "";
  take(e, change, ["item", "count", "quality", "blueprint", "place", "ammo", "attach"]);
  const item = known.item.get(e.item);
  // A piece of armor just chosen is worn, as nearly every one in a loadout is.
  if (fresh && item?.wear && change.place === undefined && !e.blueprint) e.place = "wear";
  if (item) {
    if (!item.blueprint) delete e.blueprint;
    if (!item.quality) delete e.quality;
    if (e.ammo !== undefined && !item.ammo.includes(e.ammo)) delete e.ammo;
    if (e.attach !== undefined && !item.fits.includes(e.attach)) delete e.attach;
  }
  if (e.blueprint !== true) delete e.blueprint;
  else {
    delete e.ammo;
    delete e.attach;
  }
  if (!placesFor(item, e.blueprint === true).includes(e.place) && (item || e.blueprint)) e.place = "bag";
  if (e.place === "wear") e.count = 1;
  if (e.quality === 0) delete e.quality;
  if (e.ammo === "") delete e.ammo;
  if (e.attach === "") delete e.attach;
  return true;
}

/** Moves entry `index` one up (`by` -1) or down (1). False at the end of the list. */
export function moveEntry(book: LoadoutBook, id: string, index: number, by: -1 | 1): boolean {
  const entries = find(book, id)?.entries;
  const to = index + by;
  if (!entries || index < 0 || index >= entries.length || to < 0 || to >= entries.length) return false;
  [entries[index], entries[to]] = [entries[to]!, entries[index]!];
  return true;
}

export function removeEntry(book: LoadoutBook, id: string, index: number): boolean {
  const entries = find(book, id)?.entries;
  if (!entries || index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  return true;
}

/** Puts `entries` in place of all that loadout `id` has: what was read from a survivor. */
export function replaceEntries(book: LoadoutBook, id: string, entries: readonly Entry[]): boolean {
  const l = find(book, id);
  if (!l) return false;
  l.entries = entries.slice(0, MOST.entries).map((e) => ({ ...e }));
  return true;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What the draft changes of the book in force, a line each, none where they are the same. */
export function differs(inForce: LoadoutBook, draft: LoadoutBook): string[] {
  const out: string[] = [];
  for (const role of ROLES) if (inForce.assign[role] !== draft.assign[role]) out.push(`${ROLE_WORDS[role]} ${draft.assign[role]}, not ${inForce.assign[role]}`);
  for (const l of draft.loadouts) {
    const was = find(inForce, l.id);
    if (!was) {
      out.push(`${l.id}: new, with ${countWords(l.entries.length)}`);
      continue;
    }
    const what: string[] = [];
    if (was.label !== l.label) what.push("its label");
    if (was.note !== l.note) what.push("its note");
    if (was.respawn !== l.respawn) what.push(l.respawn ? "handed out again after each death" : "handed out once");
    if (!same(was.entries, l.entries)) what.push(was.entries.length === l.entries.length ? "its entries" : `${countWords(l.entries.length)}, not ${was.entries.length}`);
    if (what.length > 0) out.push(`${l.id}: ${what.join(", ")}`);
  }
  for (const l of inForce.loadouts) if (!find(draft, l.id)) out.push(`${l.id}: removed`);
  if (out.length === 0 && !same(inForce.loadouts.map((l) => l.id), draft.loadouts.map((l) => l.id))) out.push("the order of the loadouts");
  return out;
}

const countWords = (n: number): string => (n === 1 ? "1 entry" : `${n} entries`);

export interface Picked {
  id: string;
  label: string;
}

/** The items, or the species for "tame", that hold every word of `text` in their label or id: the nearest first. */
export function pickerMatches(known: Known, text: string, kind: "item" | "tame", most = 40): Picked[] {
  const all: readonly Picked[] = kind === "item" ? known.catalog.items : known.catalog.species;
  const want = text.trim().toLowerCase();
  const wanted = want.split(/\s+/).filter((w) => w !== "");
  const rank = (p: Picked): number => {
    const [id, label] = [p.id.toLowerCase(), p.label.toLowerCase()];
    if (id === want || label === want || id.slice(id.indexOf(":") + 1) === want) return 0;
    return label.startsWith(want) || id.slice(id.indexOf(":") + 1).startsWith(want) ? 1 : 2;
  };
  return all
    .filter((p) => wanted.every((w) => `${p.label} ${p.id}`.toLowerCase().includes(w)))
    .map((p) => ({ id: p.id, label: p.label, rank: rank(p) }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, most)
    .map(({ id, label }) => ({ id, label }));
}

/** The id that `text` written in a picker means: its one exact match, or the only thing found; "" where that is unclear. */
export function picked(known: Known, text: string, kind: "item" | "tame"): string {
  const want = text.trim().toLowerCase();
  if (want === "") return "";
  const found = pickerMatches(known, text, kind, 3);
  const exact = found.filter((p) => p.id.toLowerCase() === want || p.label.toLowerCase() === want || p.id.slice(p.id.indexOf(":") + 1).toLowerCase() === want);
  if (exact.length === 1) return exact[0]!.id;
  return exact.length === 0 && found.length === 1 ? found[0]!.id : "";
}

/** The faults at `path` or anywhere under it. */
export function faultAt(faults: readonly LoadoutFault[], path: string): LoadoutFault[] {
  return faults.filter((f) => f.path === path || f.path.startsWith(`${path}.`) || f.path.startsWith(`${path}[`));
}

/**
 * What is wrong with the draft as the page can tell: the book's own checks, and as warnings what the catalogue does not
 * have or cannot do as written. The server checks a save against the game itself, and may refuse more.
 */
export function draftFaults(draft: LoadoutBook, known: Known): LoadoutFault[] {
  const out = loadoutFaults(draft);
  const warn = (path: string, message: string): void => void out.push({ path, message, warn: true });
  draft.loadouts.forEach((l, i) => {
    l.entries.forEach((e, j) => {
      const at = `loadouts[${i}].entries[${j}]`;
      if (isTame(e)) {
        const species = known.species.get(e.tame);
        if (!species && e.tame !== "") warn(`${at}.tame`, `the game has no creature ${e.tame}`);
        else if (species && e.saddled === true && !species.saddle) warn(`${at}.saddled`, `no saddle fits ${e.tame}`);
        return;
      }
      const item = known.item.get(e.item);
      if (!item) {
        if (e.item !== "") warn(`${at}.item`, `${e.item} is not among the items the game hands out`);
        return;
      }
      if (e.ammo !== undefined && !item.ammo.includes(e.ammo)) warn(`${at}.ammo`, `${e.item} does not take ${e.ammo}`);
      if (e.attach !== undefined && !item.fits.includes(e.attach)) warn(`${at}.attach`, `${e.attach} does not fit ${e.item}`);
    });
  });
  return out;
}

/** `own` with `server`'s faults in place of its own at the same paths: the server knows the game, the page a catalogue. */
export function withServer(own: readonly LoadoutFault[], server: readonly LoadoutFault[]): LoadoutFault[] {
  const paths = new Set(server.map((f) => f.path));
  return [...server, ...own.filter((f) => !paths.has(f.path))];
}

/** Whether the faults leave the draft fit to save: a warning does not stop a save. */
export const savable = (faults: readonly LoadoutFault[]): boolean => faults.every((f) => f.warn === true);

/** A book read from a file's text, to become the draft, or why it is none: a file with a fault is not read. */
export function parseBook(text: string): { book: LoadoutBook } | { error: string } {
  let made: unknown;
  try {
    made = JSON.parse(text);
  } catch (err) {
    return { error: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  // A file's revision is not this world's: the page gives the draft the one in force.
  if (typeof made === "object" && made !== null && !Array.isArray(made) && (made as { revision?: unknown }).revision === undefined) (made as { revision?: unknown }).revision = 0;
  const faults = loadoutFaults(made).filter((f) => !f.warn);
  if (faults.length > 0) return { error: `${faults[0]!.path === "" ? "" : `${faults[0]!.path}: `}${faults[0]!.message}${faults.length > 1 ? `, and ${faults.length - 1} more` : ""}` };
  return { book: made as LoadoutBook };
}

/** The faults as lines under what they are about: red for one that stops a save, amber for a warning. */
export function markHtml(faults: readonly LoadoutFault[]): string {
  return faults.map((f) => `<div class="${f.warn ? "warn" : "bad"}">${esc(f.message)}</div>`).join("");
}

/** What marks a field with faults: its colour, and the faults as its hint. */
function wrong(faults: readonly LoadoutFault[], path: string): string {
  const at = faultAt(faults, path);
  return at.length === 0 ? "" : ` class="${savable(at) ? "odd" : "wrong"}" title="${esc(at.map((f) => f.message).join("; "))}"`;
}

const option = (value: string, words: string, chosen: boolean): string => `<option value="${esc(value)}"${chosen ? " selected" : ""}>${esc(words)}</option>`;

/** The book's loadouts as the options of a role's picker. One the book lacks is shown, so it is seen to be wrong. */
export function assignOptions(book: LoadoutBook, role: Role): string {
  const now = book.assign[role];
  const gone = find(book, now) ? "" : option(now, `${now} (no such loadout)`, true);
  return gone + book.loadouts.map((l) => option(l.id, `${l.label} (${l.id})`, l.id === now)).join("");
}

/** The loadouts as a list to pick from, each with what it is given to and how much is wrong with it. */
export function listHtml(book: LoadoutBook, selected: string, faults: readonly LoadoutFault[]): string {
  return book.loadouts
    .map((l, i) => {
      const at = faultAt(faults, `loadouts[${i}]`);
      const bad = at.filter((f) => !f.warn).length;
      const marks = [
        ...ROLES.filter((r) => book.assign[r] === l.id).map((r) => `<span class="chip">${r === "player" ? "players" : "admins"}</span>`),
        bad > 0 ? `<span class="chip bad">${bad === 1 ? "1 fault" : `${bad} faults`}</span>` : "",
        at.length > bad ? `<span class="chip warn">${at.length - bad === 1 ? "1 warning" : `${at.length - bad} warnings`}</span>` : "",
      ].join("");
      return `<button class="pick${l.id === selected ? " on" : ""}" data-pick="${esc(l.id)}"><b>${esc(l.label)}</b><span class="faint">${esc(l.id)} · ${countWords(l.entries.length)}${l.respawn ? " · after each death" : ""}</span>${marks === "" ? "" : `<span class="marks">${marks}</span>`}</button>`;
    })
    .join("");
}

function itemRow(e: ItemEntry, at: string, known: Known, faults: readonly LoadoutFault[]): string {
  const item = known.item.get(e.item);
  const label = (id: string): string => known.item.get(id)?.label ?? id;
  const quality = qualityFor(item) || e.quality !== undefined ? `<select data-field="quality" aria-label="Quality"${wrong(faults, `${at}.quality`)}>${known.catalog.quality.map((q, k) => option(String(k), q, (e.quality ?? 0) === k)).join("")}</select>` : "";
  const blueprint = item?.blueprint || e.blueprint ? `<input type="checkbox" data-field="blueprint" aria-label="Blueprint"${e.blueprint ? " checked" : ""}${wrong(faults, `${at}.blueprint`)}>` : "";
  const places = [...new Set([...placesFor(item, e.blueprint === true), e.place])];
  /** A choice among what the weapon takes, with what the entry has though the weapon does not take it. */
  const gear = (field: "ammo" | "attach", takes: readonly string[]): string => {
    const now = e[field];
    const all = now !== undefined && !takes.includes(now) ? [...takes, now] : takes;
    return all.length === 0 || e.blueprint ? "" : `<select data-field="${field}" aria-label="${field === "ammo" ? "Loaded with" : "Fitted with"}"${wrong(faults, `${at}.${field}`)}>${option("", "none", now === undefined)}${all.map((id) => option(id, label(id), id === now)).join("")}</select>`;
  };
  return (
    `<td><input data-field="item" list="things" value="${esc(e.item)}" placeholder="an item" spellcheck="false" aria-label="Item"${wrong(faults, `${at}.item`)}><span class="dim">${esc(item?.label ?? "")}</span></td>` +
    `<td><input data-field="count" type="number" min="1" max="${MOST.count}" step="1" value="${Number(e.count)}" aria-label="Count"${e.place === "wear" ? " disabled" : ""}${wrong(faults, `${at}.count`)}></td>` +
    `<td>${quality}</td><td>${blueprint}</td>` +
    `<td><select data-field="place" aria-label="Place"${wrong(faults, `${at}.place`)}>${places.map((p) => option(p, PLACE_WORDS[p] ?? String(p), p === e.place)).join("")}</select></td>` +
    `<td>${gear("ammo", item?.ammo ?? [])}</td><td>${gear("attach", item?.fits ?? [])}</td>`
  );
}

function tameRow(e: TameEntry, at: string, known: Known, faults: readonly LoadoutFault[]): string {
  const species = known.species.get(e.tame);
  const saddle = species?.saddle !== false || e.saddled;
  return (
    `<td><input data-field="tame" list="creatures" value="${esc(e.tame)}" placeholder="a creature" spellcheck="false" aria-label="Creature"${wrong(faults, `${at}.tame`)}><span class="dim">${esc(species?.label ?? "")} in a soul ball</span></td>` +
    `<td><label>level <input data-field="level" type="number" min="1" max="${MOST.level}" step="1" value="${Number(e.level)}"${wrong(faults, `${at}.level`)}></label></td>` +
    `<td></td><td>${saddle ? `<label><input type="checkbox" data-field="saddled"${e.saddled ? " checked" : ""}${wrong(faults, `${at}.saddled`)}> saddled</label>` : ""}</td>` +
    `<td><select data-field="place" aria-label="Place"${wrong(faults, `${at}.place`)}>${(["hotbar", "bag"] as const).map((p) => option(p, PLACE_WORDS[p], p === e.place)).join("")}</select></td><td></td><td></td>`
  );
}

/** Loadout `index` of the book as the page shows it: its own fields, then a row to each entry with its faults under it. */
export function loadoutHtml(book: LoadoutBook, index: number, known: Known, faults: readonly LoadoutFault[]): string {
  const l = book.loadouts[index];
  if (!l) return '<p class="dim">Choose a loadout, or make a new one.</p>';
  const path = `loadouts[${index}]`;
  const own = faults.filter((f) => f.path === path || f.path === `${path}.entries` || [`${path}.id`, `${path}.label`, `${path}.note`, `${path}.respawn`].includes(f.path));
  const rows = l.entries.map((e, j) => {
    const at = `${path}.entries[${j}]`;
    const said = faultAt(faults, at);
    const tools = `<td class="tools"><button data-do="up" data-entry="${j}" title="Up"${j === 0 ? " disabled" : ""}>↑</button><button data-do="down" data-entry="${j}" title="Down"${j === l.entries.length - 1 ? " disabled" : ""}>↓</button><button data-do="del" data-entry="${j}" class="risk" title="Take this entry out">×</button></td>`;
    const cells = isTame(e) ? tameRow(e, at, known, faults) : itemRow(e, at, known, faults);
    return `<tr data-entry="${j}"><td class="n faint">${j + 1}</td>${cells}${tools}</tr>${said.length === 0 ? "" : `<tr class="said"><td></td><td colspan="8">${markHtml(said)}</td></tr>`}`;
  });
  return (
    `<div class="fields">` +
    `<label>Id <input data-head="id" value="${esc(l.id)}" maxlength="32" spellcheck="false" style="width: 14em"${wrong(faults, `${path}.id`)}></label>` +
    `<label>Label <input data-head="label" value="${esc(l.label)}" maxlength="${MOST.label}" style="width: 18em"${wrong(faults, `${path}.label`)}></label>` +
    `<label class="grow">Note <input data-head="note" value="${esc(l.note)}" maxlength="${MOST.note}"${wrong(faults, `${path}.note`)}></label>` +
    `<label><input type="checkbox" data-head="respawn"${l.respawn ? " checked" : ""}> Hand out again after each death</label></div>${markHtml(own)}` +
    `<div class="scroll"><table><thead><tr><th></th><th>Item or tame</th><th>Count</th><th>Quality</th><th>Blueprint</th><th>Place</th><th>Loaded with</th><th>Fitted with</th><th></th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>${l.entries.length === 0 ? '<p class="dim">Nothing worn and nothing carried.</p>' : ""}` +
    `<div class="bar"><button data-do="item"${l.entries.length >= MOST.entries ? " disabled" : ""}>Add an item</button><button data-do="tame"${l.entries.length >= MOST.entries ? " disabled" : ""}>Add a tame</button><span class="faint">${l.entries.length} of ${MOST.entries} entries</span></div>`
  );
}

/** What stands between the draft and the book in force: its changes and faults, and the revision a save lost to. */
export function barHtml(revision: number, changes: readonly string[], faults: readonly LoadoutFault[], conflict: number): string {
  const stops = faults.filter((f) => !f.warn);
  const lost = conflict < 0 ? "" : `<div class="warn">The book changed: another editor saved revision ${conflict} since this page read it. <button data-do="theirs">Read theirs, and lose these changes</button> <button data-do="over" class="risk">Save over revision ${conflict}</button></div>`;
  const tools = `<button data-do="export" title="The draft as a file.">Export JSON</button><button data-do="import" title="A book from a file becomes the draft. Nothing is saved until Save.">Import JSON</button><button data-do="reset" class="risk" title="The built-in loadouts again, as the next revision.">Reset to built-ins</button>`;
  if (changes.length === 0) return `<div class="bar"><span class="dim">The book in force, revision ${revision}. A change here is a draft until it is saved.</span><span class="grow"></span>${tools}</div>${lost}`;
  const said = stops.length === 0 ? "" : `<div class="bad">${stops.slice(0, 6).map((f) => `${esc(f.path)}: ${esc(f.message)}`).join("<br>")}${stops.length > 6 ? `<br>and ${stops.length - 6} more` : ""}</div>`;
  return (
    `<div class="bar"><b>Not saved</b><span class="dim">${changes.length === 1 ? "1 change" : `${changes.length} changes`} to revision ${revision}</span><span class="grow"></span>` +
    `<input id="note" placeholder="what this save is for" maxlength="200" style="width: 20em" aria-label="What this save is for"><button data-do="save" class="go"${stops.length > 0 ? " disabled" : ""}>Save</button><button data-do="discard">Discard</button>${tools}</div>` +
    `<div class="faint lines">${changes.slice(0, 12).map(esc).join("<br>")}${changes.length > 12 ? `<br>and ${changes.length - 12} more` : ""}</div>${said}${lost}`
  );
}

/** What the pickers offer: every item, and every creature a tame may be. */
export function datalistsHtml(known: Known): string {
  const options = (all: readonly Picked[]): string => all.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
  return `<datalist id="things">${options(known.catalog.items)}</datalist><datalist id="creatures">${options(known.catalog.species)}</datalist>`;
}

/** The survivors as a picker's options: those online first, then by name. */
export function survivorOptions(survivors: readonly { name: string; online: boolean }[], chosen: string): string {
  const sorted = [...survivors].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return sorted.map((s) => option(s.name, s.online ? `${s.name} (online)` : s.name, s.name === chosen)).join("");
}

/** Whether loadout `id` is in force as the draft has it: only then does handing it out give what the page shows. */
export function asShown(book: LoadoutBook, draft: LoadoutBook, id: string): boolean {
  const [was, now] = [find(book, id), find(draft, id)];
  return was !== undefined && now !== undefined && same(was.entries, now.entries);
}
