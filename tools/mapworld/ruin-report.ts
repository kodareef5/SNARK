// A local comparison page from the committed small records and regenerated inventories.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "assets/source/maps/miami/reports/ruins2";
const read = (file: string): any => JSON.parse(readFileSync(join(root, file), "utf8"));
const html = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const g = read("generation.json"); const labels = read("labels.json"); const bridges = read("bridge-summary.json");
const views = read("views.json") as { name: string; baseline?: string }[];
copyFileSync("var/maps/miami/stats.json", join(root, "build.json"));
for (const [from, to] of [["walk", "walk.txt"], ["check", "check.txt"], ["views", "render.txt"], ["unit", "unit.txt"]]) {
  const path = `/tmp/ruins2-${from}.log`; if (existsSync(path)) copyFileSync(path, join(root, to!));
}
const old = read("../ruins1/build.json"); const build = read("build.json");
const corrections = read("../../blocks/height-corrections.json") as Record<string, { name: string; before: { height_m: number; levels: number | null }; set: { height_m: number; levels: number }; sources: string[]; reason: string }>;
const row = (cells: unknown[]): string => `<tr>${cells.map((x) => `<td>${html(x)}</td>`).join("")}</tr>`;
const image = (file: string, title: string): string => `<a href="${html(file)}"><img loading="lazy" src="${html(file)}" alt="${html(title)}"></a>`;
const captions: Record<string, string> = {
  "skyline-bay": "The exact round-one bay camera. Corrected tower labels change the skyline; distant columns still erase facade colour and open spans.",
  "downtown-street": "Pale masonry and blue infill define the downtown street. Independent wall and damage choices restore solid facade panels.",
  "deco-row": "Pastel beach fabric with low brows. Smaller trees leave the low buildings visible.",
  "bungalow-street": "Little Havana: terracotta and painted block, low rooms and open entrances.",
  "port": "The same view across the port shore. Low scrub replaces the tree screen along the industrial edge.",
  "port-street": "Rust and steel warehouse walls, open yards and container cover.",
  "wynwood-street": "Painted warehouse walls distinguish Wynwood from downtown and the beach.",
  "campus": "The former worst footprint now has separate wings, courtyards, several heights and fourteen stair cores. The orthogonal grid is still conspicuous.",
  "macarthur-water": "MacArthur stands on piers over a cut bed. The authored broken span remains open.",
  "macarthur-deck": "A broad exposed approach to the MacArthur break, with interrupted edge cover.",
  "venetian-water": "The lower Venetian deck has a navigable water passage beneath it.",
  "venetian-deck": "A narrow exposed crossing between the islands.",
  "metromover": "Bayfront Park access: existing step blocks lead from dry ground to the downtown Metromover viaduct.",
  "metrorail": "Government Center access to the higher Metrorail. Both directions are tested with the real survivor controller.",
  "pier": "The Old Rickenbacker pier reaches into the bay, with water between its supports.",
  "street-entry": "A verified route from the street into DuPont. The opening and cleared approach line up with the core.",
  "rooftop": "The same DuPont rooftop camera, now with an independent descending route beside the stair.",
  "roof-exit": "The roof escape uses staggered plates with 2 m drops. It is a one-way descent; climbing back requires the stair.",
  "ritz": "The same close SLS camera. Its corrected 62.2 m source height now puts the crown above the old framing.",
  "sls-height": "A wider look at the corrected SLS mass. The plain frame and repeated floors still fall short of its historic facade.",
  "worst-interchange": "The dense interchange remains a hard case: inferred elevations and independent source ways need a more deliberate junction model.",
  "worst-distance": "Worst remaining visual defect: distant columns make an open bridge look like a wall across the water. The nearby deck and its tested water passage remain open."
};
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Miami ruins, round two</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#10171b;color:#e3e6e0;margin:0;padding:3vw;max-width:1500px;margin:auto}a{color:#a8d9d2}h1{font-size:clamp(2rem,5vw,4rem);line-height:1.05}h2{margin-top:2rem}p{max-width:85ch}.numbers{display:flex;gap:2rem;flex-wrap:wrap}.numbers b{display:block;font-size:2rem}section{margin:2rem 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}figure{margin:0}img{width:100%;max-height:620px;object-fit:contain;background:#050909}figcaption{padding:.8rem 0;color:#bac9c8}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #344349}details{margin:1rem 0}.note{border-left:3px solid #bd955d;padding-left:1rem}</style>
<header><p>SNARK / MIAMI / RUINS 2</p><h1>The foundation made strong</h1><p>Mapped bridges and railways, divided campuses, district colour, dry entrances and roof escapes. Every picture is from the game's software rasterizer and the packed city. Where available, round one is on the left using the same camera.</p><div class="numbers"><div><b>${g.blocks.toLocaleString()}</b>blocks</div><div><b>${g.topChunks[0].blocks}</b>peak chunk</div><div><b>${bridges.built}</b>mapped ways built</div><div><b>${g.routes}</b>stairs</div></div><p><a href="../../ruins/REPORT_2.md">Full report and limitations</a> · <a href="generation.json">Generation counts</a> · <a href="bridge-summary.json">Bridge audit</a> · <a href="bridge-test.json">Bridge and swim tests</a> · <a href="route-test.json">Stair and roof tests</a> · <a href="access-test.json">Street-entry tests</a> · <a href="views.json">Cameras</a> · <a href="check.txt">Full check</a></p></header>
<table><thead><tr><th>Measurement</th><th>Round one</th><th>Round two</th></tr></thead><tbody>${[["Blocks",old.staticTotal,build.staticTotal],["Map bytes",old.bytes,build.bytes],["Gzip bytes",old.gzipped,build.gzipped],["Build seconds",old.buildSeconds,build.buildSeconds],["Total seconds",old.totalSeconds,build.totalSeconds],["Peak resident MiB",old.peakResidentMiB,build.peakResidentMiB],["Resource nodes",old.nodeTotal,build.nodeTotal]].map(row).join("")}</tbody></table>
${views.map((v) => `<section><h2>${html(v.name.replace(/-/g, " "))}</h2><div class="pair">${v.baseline ? `<figure>${image(`../ruins1/${v.baseline}.png`, "Round one")}<figcaption>Round one, same camera.</figcaption></figure>` : ""}<figure>${image(`${v.name}.png`, v.name)}<figcaption>${html(captions[v.name] ?? v.name)}</figcaption></figure></div></section>`).join("\n")}
<h2>Reviewed heights</h2><p>Eight sourced corrections. The review ledger covers all 73 original conflicts; unresolved values retain their source height. Deck elevations are gameplay settlements and do not alter building labels.</p><table><thead><tr><th>Footprint</th><th>Place</th><th>Height, before → after</th><th>Floors, before → after</th><th>Evidence</th></tr></thead><tbody>${Object.entries(corrections).map(([id,c])=>`<tr><td>${id}</td><td>${html(c.name)}</td><td>${c.before.height_m} → ${c.set.height_m} m</td><td>${c.before.levels ?? "missing"} → ${c.set.levels}</td><td>${c.sources.map((url,i)=>`<a href="${html(url)}">Source ${i+1}</a>`).join(" · ")}<br>${html(c.reason)}</td></tr>`).join("")}</tbody></table>
<p>${labels.labels} directly labelled footprints. ${labels.inferred.length} still require a missing kind or height to be settled. The old square survey remains research by name only. Full building, label and bridge inventories are generated by the build and deliberately excluded from git.</p>
<details><summary>Categories by district</summary>${Object.entries(labels.categoriesByDistrict).map(([d,c])=>`<h3>${html(d)}</h3><table>${Object.entries(c as object).sort().map(row).join("")}</table>`).join("")}</details>
<details><summary>Blocks by kind</summary><table>${Object.entries(g.kinds).sort((a,b)=>Number(b[1])-Number(a[1])).map(row).join("")}</table></details>
<p class="note">These are automated movement checks and visual review, not an evening of human PvP playtesting. The full check's two socket tests need the coordinator's socket-capable environment.</p></html>`;
writeFileSync(join(root, "index.html"), page);
console.log(join(root, "index.html"));
