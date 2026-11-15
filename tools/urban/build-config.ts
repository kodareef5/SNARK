// Paths for the optional bounded urban asset merge. Core art is an explicit, read-only build input.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const INTEGRATED_DIST = resolve(import.meta.dir, "../../client/dist");
export interface UrbanBuildOptions { baseDist?: string; dist?: string; cache?: string }
export interface UrbanBuildPaths { baseDist: string; dist: string; cache: string }
type Environment = Readonly<Record<string, string | undefined>>;

/** An override also permits a cache on the source filesystem when the OS cache is on another device. */
export function urbanCacheDir(env: Environment = process.env, platform = process.platform, home = homedir()): string {
  if (env.SNARK_CORE_CACHE?.trim()) return resolve(env.SNARK_CORE_CACHE);
  const root = platform === "darwin" ? join(home, "Library/Caches")
    : platform === "win32" ? env.LOCALAPPDATA || join(home, "AppData/Local")
    : env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(home, ".cache");
  return resolve(root, "snark/urban-assets");
}

export function urbanBuildPaths(opts: UrbanBuildOptions = {}, env: Environment = process.env): UrbanBuildPaths {
  const source = opts.baseDist ?? env.SNARK_CORE_DIST;
  if (!source?.trim()) throw new Error("Urban assets need an existing unmodified core build. Pass --base-dist /absolute/path/to/core/client/dist or set SNARK_CORE_DIST; no asset build was started.");
  return { baseDist: resolve(source), dist: resolve(opts.dist ?? INTEGRATED_DIST), cache: resolve(opts.cache ?? urbanCacheDir(env)) };
}

export function argumentValue(args: readonly string[], key: string): string | undefined {
  const at = args.findIndex((arg) => arg === key || arg.startsWith(`${key}=`));
  if (at < 0) return undefined;
  const value = args[at] === key ? args[at + 1] : args[at]!.slice(key.length + 1);
  if (!value?.trim() || value.startsWith("--")) throw new Error(`${key} requires a value.`);
  return value;
}

export function urbanBuildOptions(args: readonly string[]): UrbanBuildOptions {
  return { baseDist: argumentValue(args, "--base-dist"), dist: argumentValue(args, "--dist"), cache: argumentValue(args, "--cache") };
}

/** Resolve existing parent symlinks too, before creating output directories or replacing any files. */
function canonical(path: string): string {
  let parent = path;
  const tail: string[] = [];
  for (;;) {
    try { return join(realpathSync(parent), ...tail); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw error;
      tail.unshift(basename(parent)); parent = dirname(parent);
    }
  }
}

function overlaps(a: string, b: string): boolean {
  const under = (parent: string, child: string): boolean => {
    const path = relative(parent, child);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
  };
  return under(a, b) || under(b, a);
}

export function assertUrbanBuildIsolation(paths: UrbanBuildPaths): void {
  const source = canonical(paths.baseDist), target = canonical(paths.dist), cache = canonical(paths.cache);
  if (overlaps(source, target)) throw new Error("Urban build needs an isolated --dist outside the --base-dist tree; the source remains read-only.");
  if (overlaps(source, cache) || overlaps(target, cache)) throw new Error("Choose --cache or SNARK_CORE_CACHE outside both the source and output dist trees; cached core files must survive dist rebuilds.");
}
