// The admin's settings page (client/admin/settings.ts): every setting that takes effect, and a change to one that may
// change while the server runs. Both are behind the admin pages' gate (gate.ts), which the caller has passed.
//
//   GET  /admin/settings.json   shared/admin.ts SettingsPage: each setting, its value and where it came from
//   POST /admin/settings        {"op":"set","name":"XPMultiplier","value":"2"}   set it now, and keep it across restarts
//                               {"op":"reset","name":"XPMultiplier"}             what it had before the page set it
//
// A change is answered with the page as it then stands, so the page never shows a value from before its own change.
// It is made by Host.pageSetting, which writes it in the admin journal. No password's value ever leaves.

import type { SettingRow, SettingsPage } from "../../shared/admin.ts";
import type { Host } from "../host.ts";
import { AT_START, CATALOG, fixedWhy } from "../settings/catalog.ts";
import type { Row } from "../settings/row.ts";
import { slotOf, wordsOf } from "../settings/rules.ts";
import { body, refusedWrite } from "./supply-routes.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
/** Characters of a change at the most: a whole Game.ini's worth of one list. */
export const SETTING_BODY_MOST = 700000;

const defaultWords = (row: Row): string => (row.def === null ? "" : wordsOf(row, row.def as number | boolean | string | readonly number[]));

export function settingsPage(host: Host, ok = true, why = "", note = ""): SettingsPage {
  const { rules, kept } = host;
  const rows: SettingRow[] = [];
  for (const row of CATALOG) {
    if (row.status !== "live") continue;
    const name = slotOf(row);
    const value = wordsOf(row, rules.valueOf(row));
    rows.push({
      name, group: row.group, kind: row.kind, doc: row.doc, note: row.note, min: row.min, max: row.max,
      def: row.secret ? "" : defaultWords(row), value: row.secret ? "" : value, has: value !== "",
      source: rules.sourceOf(row), secret: row.secret, fixed: fixedWhy(row) === "" ? "" : `Set at start. ${AT_START[name] ?? ""}`.trim(), kept: kept.words.has(name),
    });
  }
  return { ok, why, note, keeps: host.persistence !== null, rows };
}

function act(host: Host, b: Record<string, unknown>): SettingsPage {
  const name = b.name;
  if (typeof name !== "string" || (b.op !== "set" && b.op !== "reset")) return settingsPage(host, false, 'A change is {"op":"set","name","value"} or {"op":"reset","name"}.');
  if (b.op === "set" && typeof b.value !== "string") return settingsPage(host, false, "A value is words.");
  const did = host.pageSetting(name, b.op === "set" ? (b.value as string) : null);
  return settingsPage(host, did.why === "", did.why, did.unkept === undefined ? "" : `It is set until the server starts again: it could not be written beside the save (${did.unkept}).`);
}

/** The answer to a request for /admin/settings.json or /admin/settings, or null for any other path. */
export function settingsAnswer(host: Host, req: Request, at: string): Response | Promise<Response> | null {
  const json = (page: SettingsPage, status = 200): Response => new Response(JSON.stringify(page), { status, headers: JSON_HEADERS });
  if (at === "/admin/settings.json") return json(settingsPage(host));
  if (at !== "/admin/settings") return null;
  const no = refusedWrite(req);
  if (no) return no;
  return body(req, SETTING_BODY_MOST).then((b) => {
    if (b === null) return json(settingsPage(host, false, "Expected a JSON object no larger than a list."), 400);
    const page = act(host, b);
    return json(page, page.ok ? 200 : 400);
  });
}
