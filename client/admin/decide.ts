import { adminContext } from "./shell.ts";
// The Decider page: the decider's state (server/admin/decide.ts's decide.json, every second, looking so answers are kept)
// and its knobs (POST decide). What it shows is made in client/core/admin/decide.ts; this is the page's wiring.

import { $, ask, paintHtml } from "./dom.ts";
import type { DecideJson } from "../../shared/admin-decide.ts";
import { labHtml, mapSvg, pointsHtml, recentHtml, scorersHtml, statusText, tilesHtml } from "../core/admin/decide.ts";

async function act(body: object): Promise<void> {
  $("msg").textContent = "…";
  const r = await fetch((await adminContext()).api("decide"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; why: string };
  $("msg").textContent = j.ok ? "Done." : j.why;
  void refresh();
}

/**
 * Draws the points again. With a select of the table in hand it is drawn cell by cell around the selects, since drawing
 * one again would shut its list; a select not in hand takes the value the server holds.
 */
function paintPoints(el: HTMLElement, html: string): void {
  if (!el.contains(document.activeElement)) return paintHtml(el, html);
  const next = document.createElement("div");
  next.innerHTML = html;
  const was = el.querySelectorAll("td"), now = next.querySelectorAll("td");
  if (was.length !== now.length) return paintHtml(el, html);
  now.forEach((cell, i) => {
    const old = was[i]!, held = old.querySelector("select");
    if (!held) old.innerHTML = cell.innerHTML;
    else if (held !== document.activeElement) held.value = cell.querySelector("select")?.value ?? held.value;
  });
}

async function refresh(): Promise<void> {
  const s = (await (await ask("decide.json?look=1")).json()) as DecideJson;
  paintPoints($("points"), pointsHtml(s));
  paintHtml($("tiles"), tilesHtml(s));
  paintHtml($("scorers"), scorersHtml(s));
  paintHtml($("recent"), recentHtml(s));
  paintHtml($("map"), mapSvg(s));
  paintHtml($("lab"), labHtml(s.lab.scoreboard));
  $("status").textContent = statusText(s.lab.status);
  $<HTMLButtonElement>("clone").disabled = s.world === 0;
  $("clone").title = s.world === 0 ? "This world is in no cluster." : s.copied > 0 ? `This world last took the cluster's copy ${s.copied}.` : "";
}

$("points").addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.dataset.point !== undefined) void act({ op: "policy", point: sel.dataset.point, policy: sel.value });
});
$("reload").onclick = () => void act({ op: "reload" });
$("clone").onclick = () => void act({ op: "clone" });
const tick = () => void refresh().catch((e: unknown) => ($("msg").textContent = String(e)));
tick();
setInterval(tick, 1000);
