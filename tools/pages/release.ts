// Complete releases are verified before the public directory changes. Only indexed regular files can be served.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export interface ReleaseFile { bytes: number; sha256: string; referencedAt?: string }
export interface GuideRelease { version: 1; id: string; createdAt: string; files: Record<string, ReleaseFile> }
const EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".png", ".webp", ".jpg", ".jpeg", ".svg", ".ttf", ".woff2", ".snpk", ".bin", ".opus", ".wav", ".txt", ".ini"]);
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** HTML pins its stylesheet, module and font so publication cannot mix an old document with a new entry bundle. */
export function fingerprintEntries(root: string): void {
  const renamed = new Map<string, string>();
  for (const name of ["barlow.ttf", "guide-mark.svg", "hud-material.png", "guide.css", "guide.js"]) {
    const file = join(root, "assets", name);
    let bytes = readFileSync(file);
    if (name.endsWith(".css")) {
      let css = bytes.toString("utf8");
      for (const [old, next] of renamed) css = css.replaceAll(old, next);
      bytes = Buffer.from(css);
    }
    const extension = extname(name);
    const next = `${name.slice(0, -extension.length)}-${sha(bytes).slice(0, 20)}${extension}`;
    writeFileSync(join(root, "assets", next), bytes);
    rmSync(file);
    renamed.set(`/assets/${name}`, `/assets/${next}`);
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (lstatSync(file).isDirectory()) { walk(file); continue; }
      if (!name.endsWith(".html")) continue;
      const html = readFileSync(file, "utf8").replace(/\b(src|href|poster)="([^"]*)"/g, (all, attribute: string, url: string) => renamed.has(url) ? `${attribute}="${renamed.get(url)}"` : all);
      writeFileSync(file, html);
    }
  };
  walk(root);
}

export function immutablePath(path: string): boolean {
  return /^(media|assets)\//.test(path) && (/[a-f0-9]{20,}/.test(path) || /^assets\/.+-[a-zA-Z0-9_-]{8,}\.js$/.test(path));
}

/** Shared cache files are immutable and atomically written; hardlinks avoid copying media every hour. */
export function linkMedia(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) return;
  try { linkSync(source, target); }
  catch (error) {
    if ((error as { code?: string }).code === "EXDEV") copyFileSync(source, target);
    else throw error;
  }
}

/** Keep lazy assets used by recently opened pages, without retaining old HTML, rosters or public snapshots. */
export function retainImmutable(root: string, previous: string, createdAt: string): Record<string, ReleaseFile> {
  const retained: Record<string, ReleaseFile> = {};
  if (!existsSync(join(previous, "release.json"))) return retained;
  const manifest = JSON.parse(readFileSync(join(previous, "release.json"), "utf8")) as GuideRelease;
  const since = Date.parse(createdAt) - 7 * 24 * 60 * 60 * 1000;
  for (const [name, file] of Object.entries(manifest.files)) {
    if (!immutablePath(name) || existsSync(join(root, name)) || Date.parse(file.referencedAt ?? manifest.createdAt) < since) continue;
    linkMedia(join(previous, name), join(root, name));
    retained[name] = { ...file, referencedAt: file.referencedAt ?? manifest.createdAt };
  }
  return retained;
}

export function pruneReleases(releaseRoot: string, current: string): void {
  const completed = readdirSync(releaseRoot).filter((name) => /^[a-f0-9]{20}$/.test(name) && name !== current).map((name) => ({ name, mtime: statSync(join(releaseRoot, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  for (const old of completed.slice(1)) rmSync(join(releaseRoot, old.name), { recursive: true, force: true });
}

export function indexRelease(root: string, createdAt: string, retained: Record<string, ReleaseFile> = {}): GuideRelease {
  const files: Record<string, ReleaseFile> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name.includes("\\")) throw new Error("private or ambiguous path in public artifact");
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("public artifacts cannot contain symlinks");
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || !EXTENSIONS.has(extname(name))) throw new Error(`unsupported public artifact: ${name}`);
      const url = relative(root, path).split(sep).join("/");
      if (url === "release.json") continue;
      const bytes = readFileSync(path);
      files[url] = { bytes: bytes.length, sha256: sha(bytes), ...(immutablePath(url) ? { referencedAt: retained[url]?.referencedAt ?? createdAt } : {}) };
    }
  };
  walk(root);
  if (!files["index.html"]) throw new Error("release has no index.html");
  const release: GuideRelease = { version: 1, id: sha(JSON.stringify(files)).slice(0, 20), createdAt, files };
  validateLinks(root, release);
  writeFileSync(join(root, "release.json"), JSON.stringify(release));
  return release;
}

/** Static HTML references must resolve without a running application or a fallback route. */
export function validateLinks(root: string, release: GuideRelease): void {
  for (const name of Object.keys(release.files)) {
    if (!name.endsWith(".html")) continue;
    const html = readFileSync(join(root, name), "utf8");
    for (const match of html.matchAll(/\b(?:href|src|poster)="([^"]*)"/g)) {
      const target = match[1]!;
      if (!target || target.startsWith("#") || /^(https?:|mailto:|data:)/.test(target)) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) throw new Error(`unsafe link in ${name}`);
      const url = new URL(target.replaceAll("&amp;", "&"), `https://guide.invalid/${name}`).pathname;
      const key = decodeURIComponent(url).slice(1);
      if (!release.files[key] && !release.files[`${key.replace(/\/$/, "")}/index.html`] && !(key === "" && release.files["index.html"])) throw new Error(`broken link: ${name} -> ${target}`);
    }
  }
}

/** A release directory and its output link must stay on the same local filesystem. */
export function publishRelease(output: string, releaseDir: string, releaseRoot: string): void {
  const target = realpathSync(releaseDir);
  const allowed = realpathSync(releaseRoot);
  if (!target.startsWith(allowed + sep) || !existsSync(join(target, "release.json"))) throw new Error("only a completed private release can be published");
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output) || (() => { try { lstatSync(output); return true; } catch { return false; } })()) {
    if (!lstatSync(output).isSymbolicLink()) throw new Error("output exists and is not a managed guide link");
    if (existsSync(output) && !realpathSync(output).startsWith(allowed + sep)) throw new Error("output is managed elsewhere");
  }
  const temporary = `${resolve(output)}.next-${process.pid}`;
  try { symlinkSync(target, temporary, "dir"); renameSync(temporary, output); }
  finally { rmSync(temporary, { force: true }); }
}
