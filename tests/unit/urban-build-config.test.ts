import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertUrbanBuildIsolation, INTEGRATED_DIST, urbanBuildOptions, urbanBuildPaths, urbanCacheDir } from "../../tools/urban/build-config.ts";

test("urban asset merging requires an explicit core build, with actionable flags", () => {
  expect(() => urbanBuildPaths({}, {})).toThrow("--base-dist");
  expect(() => urbanBuildPaths({}, { SNARK_CORE_DIST: " " })).toThrow("SNARK_CORE_DIST");
  // A bundle-only invocation can parse options without requesting or rebuilding core art.
  expect(urbanBuildOptions(["--bundle-only"])).toEqual({ baseDist: undefined, dist: undefined, cache: undefined });
});

test("CLI and programmatic paths override environment while default output stays in this checkout", () => {
  const opts = urbanBuildOptions(["--base-dist", "review/core", "--cache=review/cache", "--dist", "review/output"]);
  expect(urbanBuildPaths(opts, { SNARK_CORE_DIST: "wrong-core", SNARK_CORE_CACHE: "wrong-cache" })).toEqual({
    baseDist: resolve("review/core"), dist: resolve("review/output"), cache: resolve("review/cache"),
  });
  const env = urbanBuildPaths({}, { SNARK_CORE_DIST: "review/core", SNARK_CORE_CACHE: "review/cache" });
  expect(env.baseDist).toBe(resolve("review/core")); expect(env.cache).toBe(resolve("review/cache")); expect(env.dist).toBe(INTEGRATED_DIST);
  for (const args of [["--base-dist"], ["--base-dist", "--bundle-only"], ["--cache="]]) expect(() => urbanBuildOptions(args)).toThrow("requires a value");
});

test("cache defaults follow the OS and explicit cache overrides support another source filesystem", () => {
  const home = resolve("review/home");
  expect(urbanCacheDir({}, "linux", home)).toBe(join(home, ".cache/snark/urban-assets"));
  expect(urbanCacheDir({ XDG_CACHE_HOME: join(home, "xdg") }, "linux", home)).toBe(join(home, "xdg/snark/urban-assets"));
  expect(urbanCacheDir({ XDG_CACHE_HOME: "relative-is-invalid" }, "linux", home)).toBe(join(home, ".cache/snark/urban-assets"));
  expect(urbanCacheDir({}, "darwin", home)).toBe(join(home, "Library/Caches/snark/urban-assets"));
  expect(urbanCacheDir({ LOCALAPPDATA: join(home, "local") }, "win32", home)).toBe(join(home, "local/snark/urban-assets"));
  expect(urbanCacheDir({ SNARK_CORE_CACHE: "same-device/cache" }, "darwin", home)).toBe(resolve("same-device/cache"));
});

test("isolation rejects source/output aliases and caches that would vanish during dist rebuilds", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-urban-paths-"));
  try {
    const baseDist = join(root, "core"), dist = join(root, "output"), cache = join(root, "cache");
    mkdirSync(baseDist); symlinkSync(baseDist, join(root, "core-alias"), "dir");
    expect(() => assertUrbanBuildIsolation({ baseDist, dist, cache })).not.toThrow();
    expect(existsSync(dist)).toBe(false); expect(existsSync(cache)).toBe(false);
    for (const target of [baseDist, join(baseDist, "nested"), root, join(root, "core-alias/new-output")]) {
      expect(() => assertUrbanBuildIsolation({ baseDist, dist: target, cache })).toThrow("isolated");
    }
    for (const kept of [join(baseDist, "cache"), join(dist, "cache"), join(root, "core-alias/cache")]) {
      expect(() => assertUrbanBuildIsolation({ baseDist, dist, cache: kept })).toThrow("--cache");
    }
    // Prefix siblings are independent paths, and an existing unrelated deployment remains untouched.
    expect(() => assertUrbanBuildIsolation({ baseDist, dist: `${baseDist}-review`, cache })).not.toThrow();
    expect(existsSync(join(root, "core-alias"))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
