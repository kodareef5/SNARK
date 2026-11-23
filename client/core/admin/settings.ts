// The admin's settings page, its parts that are not the page's wiring (client/admin/settings.ts): the rows as HTML,
// made once, which rows a search shows, and what each row's box holds for the value the server gave.

import type { SettingRow } from "../../../shared/admin.ts";
import { esc } from "./format.ts";

/** Which rows the page shows. */
export const SHOWS = ["all", "live", "kept", "changed"] as const;
export type Show = (typeof SHOWS)[number];
export const SHOW_WORDS: Record<Show, string> = { all: "Every setting", live: "May change now", kept: "Set on this page", changed: "Not at its default" };

const isList = (r: SettingRow): boolean => r.kind === "struct" || r.kind === "names" || r.kind === "lines";
/** A switch: a setting that is on or off, or a command-line flag that takes no value. */
export const isSwitch = (r: SettingRow): boolean => r.kind === "bool" || (r.kind === "flag" && (r.def === "False" || r.def === "True"));

/** Whether a row is among those shown, and holds every word of the search in its name, its meaning or its heading. */
export function matches(r: SettingRow, search: string, show: Show): boolean {
  if (show === "live" && r.fixed !== "") return false;
  if (show === "kept" && !r.kept) return false;
  if (show === "changed" && (r.secret ? !r.has : r.value === r.def)) return false;
  const hay = `${r.name} ${r.doc} ${r.group}`.toLowerCase();
  return search.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
}

/** The range a number may have, in words, or "" for a setting that is no number. */
export function rangeText(r: SettingRow): string {
  return r.kind === "float" || r.kind === "int" || r.kind === "indexed" || r.kind === "lines" ? `${r.min} to ${r.max}` : "";
}

/** Lines a list's box shows: its entries and one to write the next in, eight at the most. */
export const boxLines = (value: string): number => Math.min(8, (value === "" ? 0 : value.split("\n").length) + 1);

/** The box a row's value is changed in. Its value is set by the page as the server answers. */
function boxHtml(r: SettingRow): string {
  const id = `v-${esc(r.name)}`;
  const off = r.fixed === "" ? "" : " disabled";
  const name = ` aria-label="${esc(r.name)}"`;
  if (isSwitch(r)) return `<input id="${id}" type="checkbox"${name}${off}>`;
  if (isList(r)) return `<textarea id="${id}" rows="2" spellcheck="false"${name}${off}></textarea>`;
  if (r.secret) return `<input id="${id}" type="password" autocomplete="new-password"${name}${off}>`;
  if (r.kind === "float" || r.kind === "int") return `<input id="${id}" type="number" min="${r.min}" max="${r.max}" step="${r.kind === "int" ? 1 : "any"}"${name}${off}>`;
  return `<input id="${id}" type="text" spellcheck="false"${name}${off}>`;
}

function rowHtml(r: SettingRow): string {
  const range = rangeText(r);
  const def = isSwitch(r) ? (r.def === "True" ? "on" : "off") : r.def;
  const about = [r.secret || def === "" ? "" : `default ${def}`, range].filter((x) => x !== "").join(" · ");
  return (
    `<div class="row${r.fixed === "" ? "" : " fixed"}" id="r-${esc(r.name)}">` +
    `<div class="what"><b>${esc(r.name)}</b><span class="dim">${esc(r.doc)}${r.note === "" ? "" : ` <span class="faint">${esc(r.note)}</span>`}</span></div>` +
    `<div class="box">${boxHtml(r)}<span class="faint">${esc(about)}</span></div>` +
    `<div class="from"><span id="s-${esc(r.name)}"></span>${r.fixed === "" ? `<button id="b-${esc(r.name)}" hidden>Reset</button>` : `<span class="faint">${esc(r.fixed)}</span>`}</div>` +
    `</div>`
  );
}

/** Every row under its heading, in the catalogue's order. Made once: the page then only sets what changes. */
export function settingsHtml(rows: readonly SettingRow[]): string {
  const groups = new Map<string, SettingRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return [...groups].map(([group, of]) => `<section class="glass group"><h2>${esc(group)}</h2>${of.map(rowHtml).join("")}</section>`).join("");
}

/** What a row's box holds for the server's value: a switch is on or off, and a password's box is always empty. */
export function boxValue(r: SettingRow): string | boolean {
  if (isSwitch(r)) return r.value === "True";
  return r.secret ? "" : r.value;
}

/** What a changed box sends as the row's value. */
export const sentValue = (r: SettingRow, box: string | boolean): string => (typeof box === "boolean" ? (box ? "True" : "False") : box);

/** Where a row's value came from, for its row: nothing for one left at its default. */
export function sourceText(r: SettingRow): string {
  if (r.secret) return r.has ? `set · ${r.source}` : "none";
  return r.source === "default" ? "" : r.source;
}

/** A count of the rows shown, for the page's head. */
export function countText(shown: number, all: number): string {
  return shown === all ? `${all} settings` : `${shown} of ${all} settings`;
}
