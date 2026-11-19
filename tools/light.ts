// bun tools/light.ts [record of play file...] [--all] [--over <luma>]: prints each capture of the light a page took at F9
// (client/core/light-capture.ts) from the record of play, the newest file in var/play unless named: every frame marked
// whose brightness, whole or in a part, differs from the frame before's by more than --over (1.5 of 255), with what else
// changed in that frame, and the frames either side. --all prints every frame.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Capture {
  id: string;
  about: Record<string, unknown>;
  fields: string[];
  rows: (number | string)[][];
}

/** The captures among a record's lines, their parts joined in order. */
export function captures(lines: readonly { page: { light?: Record<string, unknown> } }[]): Capture[] {
  const by = new Map<string, { parts: Map<number, (number | string)[][]>; light: Record<string, unknown> }>();
  for (const { page } of lines) {
    const l = page.light;
    if (!l) continue;
    const c = by.get(String(l.id)) ?? by.set(String(l.id), { parts: new Map(), light: l }).get(String(l.id))!;
    c.parts.set(Number(l.part), l.rows as (number | string)[][]);
  }
  return [...by].map(([id, { parts, light }]) => {
    const { rows: _, fields, part: __, id: ___, ...about } = light;
    return { id, about, fields: fields as string[], rows: [...parts].sort((a, b) => a[0] - b[0]).flatMap(([, r]) => r) };
  });
}

/** Columns that, where they changed from the frame before, are named beside a marked frame. */
const WATCHED = ["sunStepped", "level", "tier", "cascades", "cascadesDrawn", "exposure", "gradeR", "gamma", "clockJumps", "texUploads", "assetUploads", "worldLevel", "worldEarly", "farScale", "canvasW", "canvasH"];
const PARTS = ["luma", "topLeft", "topRight", "bottomLeft", "bottomRight", "top", "bottom"];

/**
 * Each frame whose brightness, whole or in any part, differs from the frame before's by more than `over`, so a dip is
 * marked where it goes and where it comes back: its index, the part that moved most and by how much, and what else
 * changed from the frame before.
 */
export function marked(c: Capture, over: number): { at: number; part: string; by: number; notes: string[] }[] {
  const col = (name: string): number => c.fields.indexOf(name);
  const out: { at: number; part: string; by: number; notes: string[] }[] = [];
  const frameMs = c.rows.map((r) => Number(r[col("frameMs")])).sort((a, b) => a - b);
  const typical = frameMs[frameMs.length >> 1] ?? 0;
  for (let k = 1; k < c.rows.length; k++) {
    let part = "", by = 0;
    for (const p of PARTS) {
      const d = Number(c.rows[k]![col(p)]) - Number(c.rows[k - 1]![col(p)]);
      if (Math.abs(d) > Math.abs(by)) [part, by] = [p, d];
    }
    if (Math.abs(by) <= over) continue;
    const notes: string[] = [];
    for (const w of WATCHED) {
      const i = col(w);
      if (i < 0) continue;
      const was = c.rows[k - 1]![i], now = c.rows[k]![i];
      if (w === "sunStepped" ? Number(now) > 0 : w === "texUploads" || w === "assetUploads" ? Number(now) > 0 : now !== was) notes.push(w === "sunStepped" ? "the sun stepped" : w.endsWith("Uploads") ? `${now} ${w}` : `${w} ${was} to ${now}`);
    }
    const ms = Number(c.rows[k]![col("frameMs")]);
    if (ms > typical * 1.8) notes.push(`a long frame, ${ms} ms where most are ${typical}`);
    out.push({ at: k, part, by, notes });
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const over = args.includes("--over") ? Number(args[args.indexOf("--over") + 1]) : 1.5;
  const named = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--over");
  const folder = resolve(import.meta.dir, "../var/play");
  const files = named.length > 0 ? named : !existsSync(folder) ? [] : readdirSync(folder).filter((f) => f.endsWith(".jsonl")).map((f) => join(folder, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).slice(-1);
  const lines = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)));
  const found = captures(lines);
  if (found.length === 0) throw new Error(`no capture of the light in ${files.join(", ") || folder}: press F9 in a page of a world started with --dev`);
  for (const c of found) {
    const col = (name: string): number => c.fields.indexOf(name);
    const luma = c.rows.map((r) => Number(r[col("luma")]));
    const ms = Number(c.rows.at(-1)![col("ms")]);
    console.log(`capture ${c.id}: ${c.rows.length} frames over ${(ms / 1000).toFixed(1)} s (${(c.rows.length / (ms / 1000)).toFixed(0)} a second), brightness ${Math.min(...luma).toFixed(1)} to ${Math.max(...luma).toFixed(1)} of 255; ${JSON.stringify(c.about)}`);
    const marks = marked(c, over);
    console.log(`${marks.length} frames differ from the frame before by more than ${over}`);
    const show = new Set(args.includes("--all") ? c.rows.map((_, k) => k) : marks.flatMap((m) => [m.at - 1, m.at, m.at + 1]));
    const keys = ["ms", "frameMs", "tick", ...PARTS, "sunStepped", "hour", "level", "tier", "cascadesDrawn", "exposure", "renderClock", "tickClock", "clockJumps", "texUploads", "assetUploads", "worldLevel", "worldEarly", "farScale"];
    console.log(["  ", ...keys].join("\t"));
    for (const k of [...show].filter((k) => k >= 0 && k < c.rows.length).sort((a, b) => a - b)) {
      const m = marks.find((x) => x.at === k);
      console.log([m ? "* " : "  ", ...keys.map((name) => c.rows[k]![col(name)])].join("\t") + (m ? `\t${m.part} ${m.by > 0 ? "+" : ""}${m.by.toFixed(1)}${m.notes.length ? `: ${m.notes.join(", ")}` : ""}` : ""));
    }
  }
}
