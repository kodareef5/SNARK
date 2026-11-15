import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { reportPaths } from "./report-path.ts";

const paths = reportPaths(); const root = paths.folder;
const read = (name: string): any => JSON.parse(readFileSync(join(root, name), "utf8"));
const html = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const config = JSON.parse(readFileSync(join(paths.source, "ruins/proof.json"), "utf8"));
copyFileSync(join("var/maps", basename(paths.mapFile, ".snmap"), "stats.json"), join(root, "build.json"));
const g = read("generation.json"); const build = read("build.json"); const samples = read("samples.json");
const old = JSON.parse(readFileSync(join(paths.source, "reports", config.previous, "build.json"), "utf8"));
const views = read("views.json") as { name: string; baseline?: string }[];
const captionsFile = join(paths.source, "ruins/captions.json");
const captions = existsSync(captionsFile) ? JSON.parse(readFileSync(captionsFile, "utf8")) : {};
const licenceFile = join(root, "references/licences.json");
const references: { file: string; page: string; licence: string; author: string }[] = existsSync(licenceFile) ? JSON.parse(readFileSync(licenceFile, "utf8")) : [];
const comparison = read("baseline-kinds.json");
const csv = (rows: unknown[][]): string => rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
writeFileSync(join(root, "pieces-by-kind.csv"), csv([["kind", "before_buildings", "before_pieces", "before_mean", "after_buildings", "after_pieces", "after_mean", "after_max"], ...[...new Set([...Object.keys(comparison.byKind), ...Object.keys(g.piecesByKind)])].sort().map((kind) => {
  const a = comparison.byKind[kind] ?? { buildings: 0, pieces: 0 }; const b = g.piecesByKind[kind] ?? { buildings: 0, pieces: 0, max: 0 };
  return [kind, a.buildings, a.pieces, (a.pieces / Math.max(1, a.buildings)).toFixed(2), b.buildings, b.pieces, (b.pieces / Math.max(1, b.buildings)).toFixed(2), b.max];
})]));
writeFileSync(join(root, "blocks-by-kind.csv"), csv([["kind", "pieces"], ...Object.entries(g.kinds).sort((a, b) => Number(b[1]) - Number(a[1]))]));
const labels = read("labels.json");
writeFileSync(join(root, "label-summary.json"), JSON.stringify({ ...Object.fromEntries(["fingerprint", "footprints", "labels", "named", "neither", "suppliedKinds", "suppliedHeights", "resolvedKinds", "resolvedHeights", "categoriesByDistrict", "places", "famous"].map((k) => [k, labels[k]])), researchRecords: read("survey.json").enrichmentMatches, heightLevelConflicts: labels.heightLevelConflicts.length }, null, 2) + "\n");
const row = (cells: unknown[]): string => `<tr>${cells.map((c) => `<td>${html(c)}</td>`).join("")}</tr>`;
const pictures = (list: typeof views): string => list.map((v) => {
  const ref = references.find((r) => r.file === config.references?.[v.name]);
  return `<section><h2>${html(v.name)}</h2><div class="pair">${v.baseline ? `<figure><img src="${html(v.baseline)}"><figcaption>Previous round, same camera.</figcaption></figure>` : ""}${ref ? `<figure><img src="references/${html(ref.file)}"><figcaption><a href="${html(ref.page)}">${html(ref.author)}; ${html(ref.licence)}</a>. Unmodified reference only.</figcaption></figure>` : ""}<figure><img src="${html(v.name)}.png"><figcaption>${html(captions[v.name] ?? "")}</figcaption></figure></div></section>`;
}).join("\n");
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(paths.world.label)} ruins</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#11191d;color:#e3e7e3;margin:0 auto;padding:3vw;max-width:1500px}a{color:#a8d9d2}h1{font-size:3rem;line-height:1.1}h2{font-size:1.25rem}p{max-width:90ch}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}.lineup{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}figure{margin:0}img{width:100%;background:#080c0e}section{margin:2rem 0}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #344349}details{margin:1rem 0}</style>
<h1>${html(paths.world.label)}: a city that fell</h1><p>${g.blocks.toLocaleString()} pieces, ${g.topChunks[0].blocks} in the busiest chunk. ${g.routes} stairs, ${g.roomRoutes} room and rubble routes. The line-ups use exact packed building pieces, translated and rotated onto the same flat stage. No parts are added or removed. City views retain terrain, neighbouring buildings and plants.</p>
<p><a href="../../ruins/REPORT_3.md">Report</a> · <a href="generation.json">Counts</a> · <a href="samples.json">Selection and seeded draw</a> · <a href="views.json">Cameras</a> · <a href="route-test.json">Stairs and roofs</a> · <a href="room-test.json">Rooms and rubble</a> · <a href="access-test.json">Street approaches</a> · <a href="bridge-test.json">Decks and swims</a></p>
<h2>Building line-up</h2><div class="lineup">${views.filter((v) => v.name.startsWith("kind-")).map((v) => `<img src="${v.name}.png">`).join("")}</div>
<details><summary>Building answer key, in picture order</summary><table>${samples.samples.filter((s: any) => s.view.startsWith("kind-")).map((s: any) => row([s.view, s.form, s.kind, s.name, s.footprint, s.pieces])).join("")}</table></details>
<h2>Collapse line-up</h2><div class="lineup">${views.filter((v) => v.name.startsWith("fall-")).map((v) => `<img src="${v.name}.png">`).join("")}</div>
<details><summary>Collapse answer key</summary><table>${samples.samples.filter((s: any) => s.view.startsWith("fall-")).map((s: any) => row([s.collapse, s.footprint, s.pieces])).join("")}</table></details>
${pictures(views.filter((v) => !v.name.startsWith("kind-") && !v.name.startsWith("fall-")))}
<h2>Build comparison</h2><table>${[["Measurement",config.previous,basename(root)],["Pieces",old.staticTotal,build.staticTotal],["Map bytes",old.bytes,build.bytes],["Compressed bytes",old.gzipped,build.gzipped],["Build seconds",old.buildSeconds,build.buildSeconds],["Total seconds",old.totalSeconds,build.totalSeconds],["Peak resident MiB",old.peakResidentMiB,build.peakResidentMiB],["Resource nodes",old.nodeTotal,build.nodeTotal]].map(row).join("")}</table>
<details><summary>Pieces per building by supplied or resolved use</summary><table>${[["Kind","Before buildings","Before pieces / building","After buildings","After pieces / building","After total"],...Object.entries(g.piecesByKind).sort().map(([kind,value]) => { const now = value as any; const before = comparison.byKind[kind]; return [kind,before?.buildings ?? 0,before ? (before.pieces / before.buildings).toFixed(1) : "",now.buildings,(now.pieces / now.buildings).toFixed(1),now.pieces]; })].map(row).join("")}</table></details>
<details><summary>Blocks by shape and finish</summary><table>${Object.entries(g.kinds).sort((a,b) => Number(b[1]) - Number(a[1])).map(row).join("")}</table></details></html>`;
writeFileSync(join(root, "index.html"), page); console.log(join(root, "index.html"));
