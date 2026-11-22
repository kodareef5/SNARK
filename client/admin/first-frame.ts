// The admin's first-frame page: what a player downloads before the first frame, as the last build weighed it
// (first-frame.json). What it shows is made in client/core/admin/first-frame.ts; this is the page's wiring.

import { $, ask, esc } from "./dom.ts";
import { firstFrameView, type FirstFrameJson } from "../core/admin/first-frame.ts";

let weighed: FirstFrameJson | null = null;

function show(): void {
  if (!weighed) return;
  for (const [id, html] of Object.entries(firstFrameView(weighed, $<HTMLSelectElement>("map").value))) $(id).innerHTML = html;
}

void ask("first-frame.json").then(async (r) => {
  weighed = (await r.json()) as FirstFrameJson;
  $<HTMLSelectElement>("map").innerHTML = `<option value="">the core, every map's</option>${weighed.maps.map((m) => `<option>${esc(m.map)}</option>`).join("")}`;
  show();
}).catch((e: unknown) => ($("summary").textContent = `no weighing yet: build the client (${String(e)})`));
$<HTMLSelectElement>("map").onchange = show;
