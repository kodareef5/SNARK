import { adminContext } from "./shell.ts";
// The admin's Cast page: what the city's background people are doing (server/admin/cast.ts's cast.json, every two seconds)
// and the knobs an admin turns (POST cast: a Cast setting live, a scene played now, a story ended). What it shows is made
// in client/core/admin/cast.ts; this is the page's wiring.

import { $, ask } from "./dom.ts";
import { CAST_KNOBS, castMarks, castView, type CastJson } from "../core/admin/cast.ts";

let last: CastJson | null = null;

async function act(body: object): Promise<void> {
  const r = await fetch((await adminContext()).api("cast"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; why: string };
  $("msg").textContent = j.ok ? "Done." : j.why;
  void refresh();
}

async function refresh(): Promise<void> {
  const s = (last = (await (await ask("cast.json")).json()) as CastJson);
  const first = !$("knobs").childElementCount;
  for (const [id, html] of Object.entries(castView(s, first))) $(id).innerHTML = html;
  for (const [name, , , , , field] of CAST_KNOBS) {
    const input = $<HTMLInputElement>(`k-${name}`), v = String(s.settings[field]);
    if (first) input.onchange = () => void act({ op: "set", name, value: input.value });
    if (document.activeElement !== input) input.value = v;
    $(`v-${name}`).textContent = v;
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-retire]")) b.onclick = () => void act({ op: "retire", story: b.dataset.retire });
  const c = $<HTMLCanvasElement>("map"), g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.font = "12px sans-serif";
  for (const m of castMarks(c.width, s)) {
    g.globalAlpha = m.alpha;
    g.fillStyle = m.colour;
    if (m.text) g.fillText(m.text, m.x, m.y);
    else g.fillRect(m.x, m.y, m.w, m.h);
  }
}

const tick = () => void refresh().catch((e: unknown) => ($("msg").textContent = String(e)));
$("toggle").onclick = () => void act({ op: "set", name: "CastEnabled", value: last?.enabled ? "false" : "true" });
$("spawn").onclick = () => void act({ op: "spawn", scene: $<HTMLSelectElement>("scene").value });
tick();
setInterval(tick, 2000);
