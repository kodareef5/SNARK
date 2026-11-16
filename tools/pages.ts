// Builds a standalone cluster wiki and optionally serves the completed files on loopback.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GuideData } from "../shared/pages/types.ts";
import { buildAudio } from "./pages/audio.ts";
import { buildCatalogue, buildServers } from "./pages/catalogue.ts";
import { buildMaps } from "./pages/maps.ts";
import { buildModels } from "./pages/models.ts";
import { renderGuide } from "./pages/presentation.ts";
import { fingerprintEntries, indexRelease, pruneReleases, publishRelease, retainImmutable } from "./pages/release.ts";
import { serveGuide } from "./pages/serve.ts";
import { uiSheet } from "./ui/assets.ts";
import { encodePng } from "./snap/png.ts";

const ROOT = resolve(import.meta.dir, "..");
export interface GuideBuildOptions { output?: string; snapshot?: unknown; createdAt?: string; progress?: (message: string) => void }

export async function buildGuide(options: GuideBuildOptions = {}): Promise<{ output: string; release: string; data: GuideData }> {
  const output = resolve(options.output ?? join(ROOT, "dist/guide"));
  const releaseRoot = join(ROOT, ".cache/pages/releases");
  mkdirSync(releaseRoot, { recursive: true });
  const lock = join(releaseRoot, "build.lock");
  let handle: number;
  try { handle = openSync(lock, "wx"); }
  catch { throw new Error(`A guide build owns ${lock}. If its process has stopped, remove that lock before rebuilding.`); }
  writeFileSync(handle, String(process.pid)); closeSync(handle);
  const staging = mkdtempSync(join(releaseRoot, ".building-"));
  const say = options.progress ?? console.log;
  try {
    const generatedAt = options.createdAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("invalid capture time");
    const entries = buildCatalogue();
    const servers = buildServers(options.snapshot);
    say(`Catalogue: ${entries.length} entries, ${servers.length} world cards`);
    const maps = await buildMaps(staging);
    say(`Maps: ${maps.length} authored atlases`);
    const models = await buildModels(staging, entries);
    say(`Models: ${Object.keys(models).length} model associations`);
    const { sounds, music } = await buildAudio(staging);
    say(`Audio: ${sounds.length} sound takes, ${music.length} music tracks`);
    const rev = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT });
    const revision = rev.exitCode === 0 ? new TextDecoder().decode(rev.stdout).trim() : "local";
    const data: GuideData = {
      version: 1, generatedAt, revision,
      cluster: { id: "local", label: "Cluster wiki", mode: options.snapshot === undefined ? "catalogue" : "snapshot", description: "Maps, creatures, crafting and server tools." },
      entries, maps, servers, models, sounds, music,
    };
    const assets = join(staging, "assets");
    mkdirSync(assets, { recursive: true });
    copyFileSync(join(ROOT, "tools/pages/guide.css"), join(assets, "guide.css"));
    copyFileSync(join(ROOT, "tools/pages/guide-mark.svg"), join(assets, "guide-mark.svg"));
    const glass = uiSheet();
    writeFileSync(join(assets, "hud-material.png"), encodePng(glass.width, glass.height, glass.data));
    copyFileSync(join(ROOT, "assets/raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"), join(assets, "barlow.ttf"));
    copyFileSync(join(ROOT, "assets/raw/fonts/barlow/OFL.txt"), join(assets, "OFL.txt"));
    const bundle = await Bun.build({ entrypoints: [join(ROOT, "client/pages/guide.ts")], outdir: assets, target: "browser", format: "esm", splitting: true, minify: true, naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" } });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    await renderGuide(data, staging);
    fingerprintEntries(staging);
    mkdirSync(join(staging, "data/v1"), { recursive: true });
    writeFileSync(join(staging, "data/v1/guide.json"), JSON.stringify(data));
    const retained = retainImmutable(staging, output, generatedAt);
    const manifest = indexRelease(staging, generatedAt, retained);
    const release = join(releaseRoot, manifest.id);
    if (existsSync(release)) rmSync(staging, { recursive: true });
    else renameSync(staging, release);
    publishRelease(output, release, releaseRoot);
    pruneReleases(releaseRoot, manifest.id);
    say(`Published ${Object.keys(manifest.files).length} static files to ${output}`);
    return { output, release, data };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally { rmSync(lock, { force: true }); }
}

async function main(args: string[]): Promise<void> {
  const has = (key: string): boolean => args.includes(key);
  const value = (key: string, fallback: string): string => {
    const at = args.indexOf(key);
    if (at < 0) return fallback;
    const found = args[at + 1];
    if (!found || found.startsWith("--")) throw new Error(`${key} needs a value`);
    return found;
  };
  if (has("--help")) { console.log("bun run pages -- [--out dist/guide] [--snapshot public.json] [--serve] [--port 8794]\nbun run pages -- --serve-only [--out dist/guide] [--port 8794]"); return; }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") continue;
    if (["--out", "--snapshot", "--port"].includes(arg)) { i++; continue; }
    if (!["--serve", "--serve-only"].includes(arg)) throw new Error(`unknown argument: ${arg}`);
  }
  const output = resolve(value("--out", join(ROOT, "dist/guide")));
  const snapshotFile = value("--snapshot", "");
  let snapshot: unknown;
  if (snapshotFile) {
    const raw = readFileSync(snapshotFile);
    if (raw.length > 4 * 1024 * 1024) throw new Error("public snapshot exceeds 4 MiB");
    snapshot = JSON.parse(raw.toString("utf8"));
  }
  if (!has("--serve-only")) await buildGuide({ output, ...(snapshot === undefined ? {} : { snapshot }) });
  if (has("--serve") || has("--serve-only")) {
    const port = Number(value("--port", "8794"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid preview port");
    serveGuide(output, port);
  }
}

if (import.meta.main) main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
