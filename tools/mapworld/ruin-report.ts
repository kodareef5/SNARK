// A local review page: game rasterizer views, licensed references and a searchable inventory.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuinRecord } from "./ruins.ts";

const root = "assets/source/maps/miami/reports/ruins1";
const read = (file: string): any => JSON.parse(readFileSync(join(root, file), "utf8"));
const html = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const g = read("generation.json"); const labels = read("labels.json");
const buildings = read("buildings.json") as RuinRecord[];
const views = read("views.json") as { name: string }[];
const refs = read("references/pictures.json") as { title: string; page: string; licence: string; author: string; licence_url?: string; report_file: string }[];
copyFileSync("var/maps/miami/stats.json", join(root, "build.json"));
for (const [from, to] of [["/tmp/ruins-walk.log", "walk.txt"], ["/tmp/ruins-check.log", "check.txt"], ["/tmp/ruins-views.log", "render.txt"]]) if (existsSync(from!)) copyFileSync(from!, join(root, to!));
const image = (file: string, title: string): string => `<a href="${html(file)}"><img loading="lazy" src="${html(file)}" alt="${html(title)}"></a>`;
const comparison = (name: string): string => {
  const ref = refs.find((r) => r.report_file === `references/${name}.jpg`);
  if (!ref) return "";
  return `<figure>${image(ref.report_file, ref.title)}<figcaption><a href="${html(ref.page)}">${html(ref.title)}</a><br>${html(ref.author)} · ${ref.licence_url ? `<a href="${html(ref.licence_url)}">${html(ref.licence)}</a>` : html(ref.licence)}. Reference only; never a game texture.</figcaption></figure>`;
};
const captions: Record<string, string> = {
  "skyline-bay": "Downtown from the bay. The distant city uses the engine's 4 m column representation.",
  "downtown-street": "Downtown: a street through measured tower masses and climbable lower floors.",
  "deco-row": "Beach hotels: pastel brows, open rooms and broken crowns.",
  "bungalow-street": "Low residential fabric: small rooms, open porches and roof fragments.",
  port: "The port: mapped sheds, container cover and cranes at supplied positions.",
  freedom: "Freedom Tower: base wings, a slender shaft, belfry and stepped cupola.",
  arena: "Kaseya Center: open bowl, seating aisles, concourse and surviving roof rim.",
  convention: "Convention Center: the real broad footprint and 13.7 m supplied height determine the low hall.",
  dupont: "DuPont: pale piers and a narrow upper bar above its joined footprint. The source kind says warehouse; the named rule corrects the form.",
  ritz: "SLS, formerly Ritz Plaza: the corrected footprint. The 21.4 m USA Structures height stays authoritative despite the taller appearance in the postcard.",
  interior: "Inside the convention hall. Ruin gaps admit daylight and create crossing sightlines.",
  rooftop: "From the climbable DuPont refuge, eight floors above ground.",
  "worst-first-pass": "Hard case: a very large joined footprint. Uniform slabs erase the separate wings and volumes. Kept visible as a next-round priority."
};
const row = (cells: unknown[]): string => `<tr>${cells.map((x) => `<td>${html(x)}</td>`).join("")}</tr>`;
const data = buildings.filter((b) => b.name).map((b) => ({ id: b.footprint, name: b.name, district: b.district, kind: b.kind, recipe: b.recipe, height: b.sourceHeight, ruin: Number(b.height.toFixed(1)), blocks: b.blocks, research: b.researchFrom ?? "none", x: Math.round(b.x), z: Math.round(b.z) }));
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Miami ruins · round one</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#10171b;color:#e3e6e0;margin:0;padding:3vw;max-width:1500px;margin:auto}a{color:#a8d9d2}h1{font-size:clamp(2rem,5vw,4rem);line-height:1.05}h2{margin-top:3rem}p{max-width:80ch}header{border-bottom:1px solid #566065;padding-bottom:1rem}.numbers{display:flex;gap:2rem;flex-wrap:wrap}.numbers b{display:block;font-size:2rem}section{margin:2rem 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}figure{margin:0}img{width:100%;max-height:600px;object-fit:contain;background:#050909}figcaption{padding:.8rem 0;color:#bac9c8}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #344349}thead{position:sticky;top:0;background:#18262b}input,select{background:#24363c;color:inherit;border:1px solid #597275;border-radius:3px;padding:.7rem;font:inherit;margin:.4rem}.scroll{overflow:auto;max-height:65vh}details{margin:1rem 0}code{color:#d0ccab}.note{border-left:3px solid #bd955d;padding-left:1rem}</style>
<header><p>SNARK / MIAMI / RUINS 1</p><h1>A city from its own footprints</h1><p>Plain boxes, measured heights, deterministic damage. These are images from the game's rasterizer using the packed city, with source photographs alongside three hand rules.</p><div class="numbers"><div><b>${g.blocks.toLocaleString()}</b>blocks</div><div><b>${g.topChunks[0].blocks}</b>peak chunk</div><div><b>${g.buildings.toLocaleString()}</b>building parts</div><div><b>${g.routes}</b>stair routes</div></div><p><a href="../../ruins/REPORT.md">Method and limitations</a> · <a href="generation.json">Generation audit</a> · <a href="labels.json">Labels and every inference</a> · <a href="places.json">Positioned places</a> · <a href="circulation.json">Circulation tests</a> · <a href="views.json">Cameras</a></p></header>
${views.map((v) => `<section><h2>${html(v.name.replace(/-/g, " "))}</h2><div class="pair"><figure>${image(`${v.name}.png`, v.name)}<figcaption>${html(captions[v.name] ?? v.name)}</figcaption></figure>${comparison(v.name)}</div></section>`).join("\n")}
<h2>What the labels supplied</h2><p>${labels.labels} labelled footprints; ${labels.named} named. Kinds: ${labels.resolvedKinds.label} supplied, ${labels.resolvedKinds.neighbours} inferred from neighbours, ${labels.resolvedKinds["district area use"]} from district, area and use. Heights: ${labels.resolvedHeights.osm} OSM, ${labels.resolvedHeights.usa_structures} USA Structures, ${labels.resolvedHeights.levels} tagged storeys, ${labels.resolvedHeights.neighbours} neighbour medians, ${labels.resolvedHeights["recipe district area"]} recipe defaults. ${labels.heightLevelConflicts.length} height/storey conflicts retain the supplied height.</p>
<p class="note">The 59-square survey is stopped. It enriches only unambiguous name matches. Its footprint letters, heights and ordinary fabric do not drive this city. The 539 missing squares are not awaited.</p>
<details><summary>Category counts by district</summary>${Object.entries(labels.categoriesByDistrict).map(([district, counts]) => `<h3>${html(district)}</h3><table>${Object.entries(counts as object).sort().map(([k, n]) => row([k, n])).join("")}</table>`).join("")}</details>
<details><summary>Blocks by kind</summary><table>${Object.entries(g.kinds).sort((a, b) => Number(b[1]) - Number(a[1])).map(([k, n]) => row([k, n])).join("")}</table></details>
<h2>Named buildings</h2><label>Find <input id="search" placeholder="Name, kind, district, footprint"></label><label>District <select id="district"><option value="">All districts</option>${[...new Set(data.map((b) => b.district))].sort().map((d) => `<option>${html(d)}</option>`).join("")}</select></label><p id="count"></p><div class="scroll"><table><thead><tr>${["Footprint", "Name", "District", "Kind → recipe", "Source / ruin metres", "Blocks", "Research", "Engine x,z"].map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody id="rows"></tbody></table></div>
<script>const data=${JSON.stringify(data).replace(/</g, "\\u003c")};const q=document.querySelector('#search'),d=document.querySelector('#district');function render(){const found=data.filter(b=>(!d.value||b.district===d.value)&&JSON.stringify(b).toLowerCase().includes(q.value.toLowerCase()));document.querySelector('#count').textContent=found.length+' matching building parts';const body=document.querySelector('#rows');body.replaceChildren();for(const b of found){const tr=document.createElement('tr');for(const value of [b.id,b.name,b.district,b.kind+' → '+b.recipe,b.height+' / '+b.ruin,b.blocks,b.research,b.x+', '+b.z]){const td=document.createElement('td');td.textContent=value;tr.append(td)}body.append(tr)}}q.oninput=d.onchange=render;render();</script></html>`;
writeFileSync(join(root, "index.html"), page);
console.log(join(root, "index.html"));
