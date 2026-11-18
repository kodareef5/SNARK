// The sound board (client/sound/sounds.html) is an admin's page, behind the admin pages' gate (server/admin/gate.ts).
// Besides the page it serves what the build does not ship: which owners there are and the folder of each, the takes'
// files and what made them, and the briefs, recipes and sheets themselves, for whoever makes more sounds.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, normalize, posix, relative, resolve, sep } from "node:path";
import type { Registry } from "../shared/content/registry.ts";
import { adminPath, refused, type AdminGate } from "./admin/gate.ts";

export const SOURCE_DIR = resolve(import.meta.dir, "../assets/source");
/** Files of a sound folder, and the cue sheet beside an asset's art, that the board links to. */
const SHOWN = new Set(["brief.json", "recipes.json", "sounds.json", "make.sh", "cues.json"]);
/** Where an owner's folder lies says its class, for one whose definition is not in the content yet. */
const FOLDER_CLASS: Readonly<Record<string, string>> = { creatures: "species/creature", humans: "species/survivor", structures: "structure", items: "item", nodes: "node", sfx: "family", world: "family", music: "family" };

/** What the board is told of an owner of sounds. */
export interface BoardOwner {
  id: string;
  cls: string;
  /** Relative to assets/source, or null for an owner with no folder. */
  folder: string | null;
  files: string[];
  /** By sound name, the file of each take, in the order the build codes them. */
  takes: Record<string, string[]>;
  /** By slot of its brief, what is wanted of it. */
  wants: Record<string, string>;
  /** By take file, what made it: model, seed and prompt. */
  made: Record<string, string>;
}

/** Every `sound` folder under `root`, but the review sheets kept under `ref`, as owner id and folder. */
export function soundFolders(root = SOURCE_DIR): { id: string; dir: string }[] {
  const out: { id: string; dir: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "takes" || e.name === "ref" || e.name === "maps" || e.name.startsWith(".")) continue;
      const path = join(dir, e.name);
      if (e.name === "sound") out.push({ id: `${relative(root, path).split(sep)[0]}:${basename(dir)}`, dir: path });
      else walk(path);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function json(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The owners the board lists: every species, the shared families named by the catalogue, and every sound folder. */
export function boardOwners(reg: Registry, families: readonly string[], root = SOURCE_DIR): BoardOwner[] {
  const folders = new Map(soundFolders(root).map((f) => [f.id, f.dir]));
  const ids = new Set([...reg.defs.flatMap((d) => (d?.type === "species" && d.class !== "target" ? [d.id] : [])), ...families, ...folders.keys()]);
  return [...ids].map((id) => {
    const def = reg.defs[reg.index.get(id) ?? -1] ?? null;
    const dir = folders.get(id) ?? null;
    const place = dir ? relative(root, dir).split(sep)[1] ?? "" : "";
    const cls = def ? (def.type === "species" ? `species/${def.class}` : def.type) : families.includes(id) ? "family" : (FOLDER_CLASS[place] ?? "");
    const sheet = dir ? (json(join(dir, "sounds.json")).sounds as Record<string, { takes?: { file: string }[] }> | undefined) ?? {} : {};
    const slots = dir ? (json(join(dir, "brief.json")).slots as Record<string, { want?: string }> | undefined) ?? {} : {};
    const recipes = dir ? (json(join(dir, "recipes.json")).takes as Record<string, { model?: string; seed?: number; prompt?: string }> | undefined) ?? {} : {};
    const files = dir ? [...readdirSync(dir).filter((f) => SHOWN.has(f)).sort().map((f) => join(relative(root, dir), f)), ...(existsSync(join(dirname(dir), "cues.json")) ? [join(relative(root, dirname(dir)), "cues.json")] : [])] : [];
    return {
      id,
      cls,
      folder: dir ? relative(root, dir) : null,
      files,
      takes: Object.fromEntries(Object.entries(sheet).map(([name, s]) => [name, (s.takes ?? []).map((t) => t.file)])),
      wants: Object.fromEntries(Object.entries(slots).flatMap(([name, s]) => (s.want ? [[name, s.want]] : []))),
      made: Object.fromEntries(Object.entries(recipes).map(([file, r]) => [file, [r.model, r.seed !== undefined ? `seed ${r.seed}` : "", r.prompt].filter(Boolean).join(" · ")])),
    };
  });
}

/** Whether a request's path is the board's: its page, its list of owners, or a file of theirs, in any spelling. */
export function boardAsked(pathname: string): boolean {
  const at = adminPath(pathname);
  return at === "/sounds.html" || at === "/admin/sounds.json" || (at?.startsWith("/admin/source/") ?? false);
}

/**
 * The board's answer to a request, or null for a request that is not the board's. `page` is the built sounds.html, and
 * `owners` makes the list of owners when it is asked for. `pathname` is the request's path, or for a server reached at a
 * path of its host the part of it under that path (server/site.ts placeOf).
 */
export function soundBoard(req: Request, who: string, gate: AdminGate, page: string, owners: () => BoardOwner[], root = SOURCE_DIR, pathname = new URL(req.url).pathname): Response | null {
  if (!boardAsked(pathname)) return null;
  const no = refused(req, who, gate);
  if (no) return no;
  // An address's path, which has / between its parts on every system, and the same folded for matching.
  const path = posix.normalize(decodeURIComponent(pathname)), at = path.toLowerCase();
  const fresh = { "cache-control": "no-store" };
  if (at === "/sounds.html") return existsSync(page) ? new Response(Bun.file(page), { headers: { ...fresh, "content-type": "text/html; charset=utf-8" } }) : new Response("build the client first", { status: 404 });
  if (at === "/admin/sounds.json") return new Response(JSON.stringify(owners()), { headers: { ...fresh, "content-type": "application/json" } });
  const file = normalize(join(root, path.slice("/admin/source/".length)));
  if (!at.startsWith("/admin/source/") || !file.startsWith(root + sep) || !SHOWN.has(basename(file)) || !existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(Bun.file(file), { headers: { ...fresh, "content-type": file.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8" } });
}
