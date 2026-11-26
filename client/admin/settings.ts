import { adminContext } from "./shell.ts";
// The admin's settings page: every setting that takes effect (server/admin/settings.ts's settings.json), each in a box
// that sends its change as it is left (POST settings). What it shows is made in client/core/admin/settings.ts; this is
// the page's wiring. The rows are made once, so a box being written in is never replaced under the hand.

import type { SettingRow, SettingsPage } from "../../shared/admin.ts";
import { $, ask } from "./dom.ts";
import { SHOWS, SHOW_WORDS, boxLines, boxValue, countText, isSwitch, matches, sentValue, settingsHtml, sourceText, type Show } from "../core/admin/settings.ts";

type Box = HTMLInputElement | HTMLTextAreaElement;
let page: SettingsPage = { ok: true, why: "", note: "", keeps: false, stopLeft: -1, rows: [] };
let rows: SettingRow[] = [];
let made = false;

const say = (text: string, kind = "dim"): void => {
  $("msg").textContent = text;
  $("msg").className = kind;
};

async function send(body: object, done: string): Promise<void> {
  const r = await fetch((await adminContext()).api("settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // A refusal that is not about the change, such as a rank lost since sign-in, says why.
  if (r.status !== 200 && r.status !== 400) return say(((await r.json().catch(() => null)) as { why?: string } | null)?.why ?? `The server answered ${r.status}.`, "bad");
  const p = (await r.json()) as SettingsPage;
  show(p);
  if (!p.ok) say(p.why, "bad");
  else say(p.note === "" ? done : p.note, p.note === "" ? "well" : "warn");
}

function wire(r: SettingRow): void {
  const box = $<Box>(`v-${r.name}`);
  box.onchange = () => {
    const now = rows.find((x) => x.name === r.name) ?? r;
    // An emptied password box is one nobody wrote in, not a password taken away.
    if (now.secret && box.value === "") return;
    void send({ op: "set", name: r.name, value: sentValue(now, isSwitch(now) ? (box as HTMLInputElement).checked : box.value) }, `${r.name} is set${page.keeps ? ", and kept across restarts" : ""}.`);
  };
  const reset = document.getElementById(`b-${r.name}`);
  if (reset) reset.onclick = () => void send({ op: "reset", name: r.name }, `${r.name} is as it was before this page set it.`);
}

function show(got: SettingsPage): void {
  page = got;
  rows = got.rows;
  if (!made) {
    $("groups").innerHTML = settingsHtml(rows);
    for (const r of rows) wire(r);
    made = true;
  }
  for (const r of rows) {
    const box = $<Box>(`v-${r.name}`);
    if (document.activeElement !== box) {
      const v = boxValue(r);
      if (typeof v === "boolean") (box as HTMLInputElement).checked = v;
      else box.value = v;
      if (box instanceof HTMLTextAreaElement) box.rows = boxLines(r.value);
      if (r.secret) (box as HTMLInputElement).placeholder = r.has ? "set: write a new one to change it" : "none";
    }
    $(`s-${r.name}`).textContent = sourceText(r);
    $(`r-${r.name}`).classList.toggle("kept", r.kept);
    const reset = document.getElementById(`b-${r.name}`);
    if (reset) reset.hidden = !r.kept;
  }
  filter();
}

function filter(): void {
  const search = $<HTMLInputElement>("search").value.trim(), which = $<HTMLSelectElement>("show").value as Show;
  let shown = 0;
  for (const r of rows) {
    const on = matches(r, search, which);
    $(`r-${r.name}`).hidden = !on;
    if (on) shown++;
  }
  for (const group of document.querySelectorAll<HTMLElement>(".group")) group.hidden = !group.querySelector(".row:not([hidden])");
  $("count").textContent = countText(shown, rows.length);
}

async function refresh(): Promise<void> {
  show((await (await ask("settings.json")).json()) as SettingsPage);
}

$("show").innerHTML = SHOWS.map((s) => `<option value="${s}">${SHOW_WORDS[s]}</option>`).join("");
$<HTMLSelectElement>("show").value = "live";
$("search").oninput = filter;
$("show").onchange = filter;
const tick = () => void refresh().catch((e: unknown) => say(String(e), "bad"));
tick();
// The console and the live file change settings too.
setInterval(tick, 5000);
