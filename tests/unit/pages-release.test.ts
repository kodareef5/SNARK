import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintEntries, indexRelease, publishRelease, retainImmutable } from "../../tools/pages/release.ts";
import { guideHandler } from "../../tools/pages/serve.ts";

function fixture(work: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "guide-release-"));
  return Promise.resolve().then(() => work(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("publication only switches to a complete validated release and preserves the last good page", async () => fixture(async (root) => {
  const releases = join(root, "releases"), first = join(releases, "first"), next = join(releases, "next"), output = join(root, "public");
  mkdirSync(first, { recursive: true }); mkdirSync(next);
  writeFileSync(join(first, "index.html"), "first"); indexRelease(first, "2026-11-16T00:00:00Z");
  publishRelease(output, first, releases);
  const fetch = guideHandler(output);
  expect(await fetch(new Request("http://guide/")).text()).toBe("first");
  writeFileSync(join(next, "index.html"), '<a href="/missing/">broken</a>');
  expect(() => indexRelease(next, "2026-11-16T01:00:00Z")).toThrow("broken link");
  expect(() => publishRelease(output, next, releases)).toThrow("completed");
  expect(await fetch(new Request("http://guide/")).text()).toBe("first");
  writeFileSync(join(next, "index.html"), "next"); indexRelease(next, "2026-11-16T01:00:00Z");
  publishRelease(output, next, releases);
  expect(await fetch(new Request("http://guide/")).text()).toBe("next");
}));

test("the static preview refuses unindexed files, symlink escapes and non-read requests", async () => fixture((root) => {
  writeFileSync(join(root, "index.html"), "guide"); indexRelease(root, "2026-11-16T00:00:00Z");
  writeFileSync(join(root, "secret.json"), '{"password":"canary"}');
  const fetch = guideHandler(root);
  expect(fetch(new Request("http://guide/secret.json")).status).toBe(404);
  expect(fetch(new Request("http://guide/.env")).status).toBe(404);
  expect(fetch(new Request("http://guide/", { method: "POST" })).status).toBe(405);
  symlinkSync(join(root, "secret.json"), join(root, "leak.json"));
  expect(() => indexRelease(root, "2026-11-16T00:00:00Z")).toThrow("symlinks");
}));

test("static media supports bounded byte ranges and cache validation without application endpoints", async () => fixture(async (root) => {
  writeFileSync(join(root, "index.html"), '<audio src="/sound.wav"></audio>');
  writeFileSync(join(root, "sound.wav"), "0123456789"); indexRelease(root, "2026-11-16T00:00:00Z");
  const fetch = guideHandler(root);
  const partial = fetch(new Request("http://guide/sound.wav", { headers: { Range: "bytes=2-5" } }));
  expect([partial.status, partial.headers.get("Content-Range"), await partial.text()]).toEqual([206, "bytes 2-5/10", "2345"]);
  expect(fetch(new Request("http://guide/sound.wav", { headers: { Range: "bytes=90-99" } })).status).toBe(416);
  const full = fetch(new Request("http://guide/sound.wav"));
  expect(fetch(new Request("http://guide/sound.wav", { headers: { "If-None-Match": full.headers.get("ETag")! } })).status).toBe(304);
  expect(full.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
}));

test("a new release retains recent lazy media but never carries old roster data forward", async () => fixture(async (root) => {
  const releases = join(root, "releases"), first = join(releases, "first"), next = join(releases, "next"), output = join(root, "public");
  mkdirSync(join(first, "media"), { recursive: true }); mkdirSync(next);
  const asset = "media/aaaaaaaaaaaaaaaaaaaa.wav";
  writeFileSync(join(first, asset), "old lazy audio");
  writeFileSync(join(first, "players.json"), '["old-character"]');
  writeFileSync(join(first, "index.html"), `<audio src="/${asset}"></audio>`);
  indexRelease(first, "2026-11-16T00:00:00Z"); publishRelease(output, first, releases);
  writeFileSync(join(next, "index.html"), "new page");
  const carried = retainImmutable(next, output, "2026-11-16T01:00:00Z");
  const manifest = indexRelease(next, "2026-11-16T01:00:00Z", carried);
  expect(manifest.files["players.json"]).toBeUndefined();
  expect(manifest.files[asset]!.referencedAt).toBe("2026-11-16T00:00:00Z");
  publishRelease(output, next, releases);
  expect(await guideHandler(output)(new Request(`http://guide/${asset}`)).text()).toBe("old lazy audio");
}));

test("fragment links still require their target route to exist", async () => fixture((root) => {
  writeFileSync(join(root, "index.html"), '<a href="/missing/#section">missing</a>');
  expect(() => indexRelease(root, "2026-11-16T00:00:00Z")).toThrow("broken link");
}));

test("HTML and CSS pin immutable entry assets across a publication", async () => fixture((root) => {
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<link href="/assets/guide.css"><script src="/assets/guide.js"></script><img src="/assets/guide-mark.svg">');
  for (const name of ["guide.js", "guide-mark.svg", "barlow.ttf", "hud-material.png"]) writeFileSync(join(root, "assets", name), name);
  writeFileSync(join(root, "assets/guide.css"), '@font-face{src:url("/assets/barlow.ttf")}body{background:url("/assets/hud-material.png")}');
  fingerprintEntries(root);
  const manifest = indexRelease(root, "2026-11-16T00:00:00Z");
  const html = readFileSync(join(root, "index.html"), "utf8");
  expect(html).toMatch(/guide-[a-f0-9]{20}\.css/);
  expect(html).not.toContain('src="/assets/guide.js"');
  const cssName = Object.keys(manifest.files).find((name) => name.endsWith(".css"))!;
  const css = readFileSync(join(root, cssName), "utf8");
  expect(css).toMatch(/barlow-[a-f0-9]{20}\.ttf/);
  expect(css).toMatch(/hud-material-[a-f0-9]{20}\.png/);
  expect(guideHandler(root)(new Request(`http://wiki/${cssName}`)).headers.get("Cache-Control")).toContain("immutable");
}));
