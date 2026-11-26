// The admin's Cast page, its parts that are not the page's wiring (client/admin/cast.ts): what cast.json holds, the knobs,
// and the page's tables, people and map, made from it as HTML strings and canvas strokes.

import { esc } from "./format.ts";

export interface CastJson {
  enabled: boolean;
  settings: Record<string, number | string | boolean>;
  size: { x: number; z: number };
  counts: Record<string, number>;
  planner: { calls: number; failed: number; refused: number; cost: number; tokens: number; applied: number; dropped: number; hour: { calls: number; tokens: number }; model: string };
  players: { name: string; x: number; z: number }[];
  regions: { x: number; z: number; heat: number; players: number; pace: string }[];
  stories: { id: string; scene: string; phase: string; x: number; z: number; people: number; choices: Record<string, string>; slots: Record<string, string>; engaged: string[]; age: number }[];
  people: { id: string; name: string; person: number | null; kept: boolean; kind: string; want?: string; struggle?: string; hope?: string; dead: boolean; story: string | null; facts: string[]; knows: Record<string, { stance: number; met: number }> }[];
  decisions: { t: number; point: string; policy: string; why: string; choice: string }[];
  scenes: { id: string; name: string; weight: number; placeholder: boolean; ok: boolean }[];
  /** Each look's population and an admin's choice over it, each role a named person plays, and what the people store offers. */
  looks: { id: string; population: string | number | null; note: string; chosen: { population?: number; outfit?: number } }[];
  roles: { key: string; scene: string; role: string; person: number | null }[];
  store: { populations: { id: number; label: string }[]; outfits: { id: number; name: string }[]; people: { id: number; name: string }[] };
}

/** The knobs: setting, label, range, step, and the field of cast.json's settings it shows. */
export const CAST_KNOBS: [string, string, number, number, number, string][] = [
  ["CastActivity", "Activity", 0, 3, 0.1, "activity"], ["CastSpikiness", "Spikiness", 0, 1, 0.05, "spikiness"], ["CastSize", "Stories kept", 0, 2000, 10, "size"],
  ["CastMaxBodies", "Bodies at most", 0, 600, 5, "maxBodies"], ["CastMaxPerPlayer", "About each survivor", 0, 100, 1, "maxPerPlayer"], ["CastCrowdMax", "Crowd at most", 0, 400, 10, "crowdMax"],
  ["CastHostility", "Hostility (0, 1, 2)", 0, 2, 1, "hostility"], ["CastCallsPerHour", "Planner calls an hour", 0, 600, 10, "callsPerHour"],
];
const PACE_COLOUR: Record<string, string> = { relax: "#5f778c", build: "#a9d6f2", peak: "#ecb048", fade: "#8fd9c4" };

export function knobsHtml(): string {
  return CAST_KNOBS.map(([name, text, lo, hi, step]) => `<label for="k-${name}">${esc(text)}</label><input id="k-${name}" type="range" min="${lo}" max="${hi}" step="${step}"><span id="v-${name}"></span>`).join("");
}

export function scenesHtml(s: CastJson): string {
  return s.scenes.map((c) => `<option value="${esc(c.id)}"${c.ok ? "" : " disabled"}>${esc(c.name)}${c.placeholder ? " (placeholder)" : ""}${c.ok ? "" : " (not yet)"}</option>`).join("");
}

export function tilesHtml(s: CastJson): string {
  const p = s.planner;
  const t: [string, string | number][] = [
    ["Bodies", s.counts.bodies!], ["Stories", s.counts.stories!], ["People kept", s.counts.people!], ["Woken", s.counts.woken!], ["Ended", s.counts.done!],
    ["Reactions", s.counts.reactions!], ["Lines said", s.counts.said!], ["Cars", s.counts.cars!], ["Planner", p.model || "rules only"],
    ["Calls this hour", p.hour.calls], ["Spent", `$${p.cost.toFixed(4)}`], ["Plans taken", `${p.applied} of ${p.applied + p.dropped}`],
  ];
  return t.map(([k, v]) => `<div class="tile"><b>${esc(String(v))}</b><span>${esc(k)}</span></div>`).join("");
}

/** The stories under way, then the first forty only planned. */
export function storiesHtml(s: CastJson): string {
  const live = s.stories.filter((st) => st.phase !== "planned"), planned = s.stories.filter((st) => st.phase === "planned").slice(0, 40);
  return live.concat(planned).map((st) => {
    const choices = esc(Object.entries(st.choices).map(([a, b]) => `${a}: ${b}`).join(", "));
    const lines = Object.values(st.slots).map((l) => `<br>“${esc(l)}”`).join("");
    const met = st.engaged.length ? `<br>met ${esc(st.engaged.join(", "))}` : "";
    const end = st.phase === "planned" || st.phase === "done" ? "" : `<button data-retire="${esc(st.id)}">End</button>`;
    return `<tr><td>${esc(st.scene)} <span class="dim">${esc(st.id)}</span></td><td class="${st.phase === "planned" ? "dim" : "warn"}">${esc(st.phase)}</td><td>${st.people}</td><td class="dim">${choices}${lines}${met}</td><td>${end}</td></tr>`;
  }).join("");
}

export function peopleHtml(s: CastJson): string {
  const rows = s.people.map((p) => {
    const life = p.want ? `<div class="dim">wants ${esc(p.want)} · struggles with ${esc(p.struggle ?? "")} · hopes for ${esc(p.hope ?? "")}</div>` : "";
    const facts = p.facts.length ? `<div>${p.facts.map(esc).join(" · ")}</div>` : "";
    const knows = Object.entries(p.knows).map(([n, r]) => `${esc(n)} ${r.stance > 0.1 ? "likes" : r.stance < -0.1 ? "dislikes" : "knows"} (${r.met}×)`).join(", ");
    return `<div class="person"><b>${esc(p.name)}</b> <span class="dim">${esc(p.kind)}${p.person !== null ? ` · named person ${p.person}` : ""}${p.dead ? " · dead" : ""}${p.story ? ` · in ${esc(p.story)}` : ""}</span>${life}${facts}${knows ? `<div class="dim">${knows}</div>` : ""}</div>`;
  });
  return rows.join("") || '<p class="dim">Nobody yet: people become featured when a player engages them, or play a featured part.</p>';
}

export function decisionsHtml(s: CastJson): string {
  return s.decisions.map((d) => `<tr><td>${d.t}</td><td>${esc(d.point)}</td><td class="dim">${esc(d.policy)}</td><td>${esc(d.choice.slice(0, 160))}</td><td class="dim">${esc(d.why)}</td></tr>`).join("");
}

/** A mark on the map: a filled box, or a word where `text` is given. */
export interface CastMark {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  alpha: number;
  text?: string;
}

/** The map, `side` pixels square, as marks: each region shaded by its heat in its pace's colour, the stories (planned
 * small and grey, under way large and amber) and the survivors, a box and a name each. */
export function castMarks(side: number, s: CastJson): CastMark[] {
  const k = side / Math.max(s.size.x, s.size.z);
  const out: CastMark[] = s.regions.map((r) => ({ x: (r.x - 128) * k, y: (r.z - 128) * k, w: 256 * k, h: 256 * k, colour: PACE_COLOUR[r.pace] ?? "#5f778c", alpha: Math.min(0.8, 0.1 + r.heat * 0.3) }));
  for (const st of s.stories) {
    const big = st.phase !== "planned", d = big ? 5 : 3;
    out.push({ x: st.x * k - d / 2, y: st.z * k - d / 2, w: d, h: d, colour: big ? (st.phase === "done" ? "#333" : "#ecb048") : "#5f778c", alpha: 1 });
  }
  for (const p of s.players) out.push({ x: p.x * k - 4, y: p.z * k - 4, w: 8, h: 8, colour: "#eef7ff", alpha: 1 }, { x: p.x * k + 6, y: p.z * k + 4, w: 0, h: 0, colour: "#eef7ff", alpha: 1, text: p.name });
  return out;
}

function options(none: string, list: readonly { id: number; text: string }[], at: number | null | undefined): string {
  return `<option value="">${esc(none)}</option>` + list.map((o) => `<option value="${o.id}"${o.id === at ? " selected" : ""}>${esc(o.text)} (${o.id})</option>`).join("");
}

/** Each look's population and outfit, and each role's named person, as selects the page's wiring sends on change. */
export function castingHtml(s: CastJson): string {
  const pops = s.store.populations.map((p) => ({ id: p.id, text: p.label })), outfits = s.store.outfits.map((o) => ({ id: o.id, text: o.name }));
  const people = s.store.people.map((p) => ({ id: p.id, text: p.name }));
  const looks = s.looks.map((l) => `<tr><td>${esc(l.id)} <span class="dim">${esc(l.note)}</span></td>` +
    `<td><select data-look="${esc(l.id)}" data-field="population">${options(`its own (${l.population ?? "city"})`, pops, l.chosen.population)}</select></td>` +
    `<td><select data-look="${esc(l.id)}" data-field="outfit">${options("its own clothes", outfits, l.chosen.outfit)}</select></td></tr>`).join("");
  const roles = s.roles.map((r) => `<tr><td>${esc(r.scene)} · ${esc(r.role)}</td><td><select data-role="${esc(r.key)}">${options("anyone of its kinds", people, r.person)}</select></td></tr>`).join("");
  return `<table><thead><tr><th>Look</th><th>Population</th><th>Outfit</th></tr></thead><tbody>${looks}</tbody></table>` +
    `<table><thead><tr><th>Role</th><th>Named person</th></tr></thead><tbody>${roles}</tbody></table>`;
}

/** What each part of the page shows, by element id; the knobs, the scene list and the casting only the first time. */
export function castView(s: CastJson, first: boolean): Record<string, string> {
  return {
    tiles: tilesHtml(s), state: s.enabled ? '<span class="well">on</span>' : '<span class="warn">off</span>', toggle: s.enabled ? "Turn Cast off" : "Turn Cast on",
    stories: storiesHtml(s), people: peopleHtml(s), decisions: decisionsHtml(s), ...(first ? { knobs: knobsHtml(), scene: scenesHtml(s), casting: castingHtml(s) } : {}),
  };
}
