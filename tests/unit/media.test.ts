import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The installer itself (tools/release/media.py), run in checkouts made here that share one cache.
const can = Boolean(Bun.which("python3") && Bun.which("zstd") && Bun.which("tar"));
const top = mkdtempSync(join(tmpdir(), "snark-media-"));
afterAll(() => rmSync(top, { recursive: true, force: true }));
const cache = join(top, "cache");
const FILE = "assets/source/core/toy/toy.snpk";

interface Item {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
}

/** An art archive of `files`, packed as the release's are. `keep` puts it among the shared downloads. */
function archive(name: string, files: Record<string, string>, keep = true): Item {
  const stage = mkdtempSync(join(top, "stage-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(stage, path)), { recursive: true });
    writeFileSync(join(stage, path), text);
  }
  const packed = join(stage, "packed.tar.zst");
  expect(Bun.spawnSync(["sh", "-c", 'tar -cf - -C "$0" assets | zstd -q -o "$1"', stage, packed]).exitCode).toBe(0);
  const bytes = readFileSync(packed);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const item = { name, file: `${name}.${sha256.slice(0, 12)}.tar.zst`, bytes: bytes.length, sha256 };
  if (keep) {
    mkdirSync(join(cache, "downloads"), { recursive: true });
    renameSync(packed, join(cache, "downloads", item.file));
  }
  return item;
}

/** A checkout that pins `items`: the manifest and the installer, as a clone has them. */
function checkout(items: Item[]): string {
  const root = mkdtempSync(join(top, "checkout-"));
  mkdirSync(join(root, "distribution"));
  mkdirSync(join(root, "tools/release"), { recursive: true });
  cpSync(join(import.meta.dir, "../../tools/release/media.py"), join(root, "tools/release/media.py"));
  pin(root, items);
  return root;
}

function pin(root: string, items: Item[]): void {
  writeFileSync(join(root, "distribution/release.json"), JSON.stringify({ repository: "nobody/nothing", art: { release: "art", id: "an-id", files: items }, kits: { release: "map-kits", files: [] } }));
}

function media(root: string, ...args: string[]): { status: number; said: string } {
  const r = Bun.spawnSync(["python3", join(root, "tools/release/media.py"), ...args], { env: { ...process.env, SNARK_CACHE: cache }, stdout: "pipe", stderr: "pipe" });
  return { status: r.exitCode, said: r.stdout.toString() + r.stderr.toString() };
}

const stored = (item: Item, path = FILE): string => join(cache, "art", `${item.name}.${item.sha256.slice(0, 12)}`, path);

test.skipIf(!can)("checkouts link one unpacked copy of an archive, and a file renamed over a link changes that checkout alone", () => {
  const toy = archive("core-toy", { [FILE]: "the pack", "assets/source/core/toy/tex/hide.png": "a picture" });
  const one = checkout([toy]);
  const two = checkout([toy]);
  expect(media(one, "art", "--offline")).toEqual({ status: 0, said: expect.stringContaining("All art is installed.") });
  expect(media(two, "art", "--offline").status).toBe(0);
  for (const root of [one, two]) {
    expect(statSync(join(root, FILE)).ino).toBe(statSync(stored(toy)).ino);
    expect(JSON.parse(readFileSync(join(root, "assets/.art-archives.json"), "utf8"))).toEqual({ "core-toy": toy.sha256 });
    expect(media(root, "list").said).toContain("art: 1 archives, 0.00 GiB, 1 installed");
  }
  expect(statSync(stored(toy)).nlink).toBe(3);
  // Read-only, so a tool that opens one to write stops there instead of writing into every checkout.
  expect(statSync(join(one, FILE)).mode & 0o222).toBe(0);

  writeFileSync(join(one, FILE + ".tmp"), "rebuilt");
  renameSync(join(one, FILE + ".tmp"), join(one, FILE));
  expect(readFileSync(join(two, FILE), "utf8")).toBe("the pack");
  expect(readFileSync(stored(toy), "utf8")).toBe("the pack");
  // The rebuilt file is this checkout's own, and a second run leaves it alone.
  expect(media(one, "art").status).toBe(0);
  expect(readFileSync(join(one, FILE), "utf8")).toBe("rebuilt");

  expect(media(two, "art", "core-toy", "--copy").status).toBe(0);
  expect(statSync(join(two, FILE)).ino).not.toBe(statSync(stored(toy)).ino);
  expect(statSync(join(two, FILE)).mode & 0o200).toBe(0o200);
  expect(readFileSync(join(two, FILE), "utf8")).toBe("the pack");
});

test.skipIf(!can)("a file that was there before is replaced only with --force", () => {
  const toy = archive("core-held", { [FILE]: "the pack" });
  const root = checkout([toy]);
  mkdirSync(dirname(join(root, FILE)), { recursive: true });
  writeFileSync(join(root, FILE), "my own");
  const refused = media(root, "art", "--offline");
  expect(refused.status).not.toBe(0);
  expect(refused.said).toContain("Existing file differs");
  expect(readFileSync(join(root, FILE), "utf8")).toBe("my own");
  expect(media(root, "art", "--offline", "--force").status).toBe(0);
  expect(statSync(join(root, FILE)).ino).toBe(statSync(stored(toy)).ino);
});

test.skipIf(!can)("an offline run takes a newly pinned archive, but not over a file this checkout changed", () => {
  const old = archive("core-new", { [FILE]: "the pack" });
  const clean = checkout([old]);
  const edited = checkout([old]);
  for (const root of [clean, edited]) expect(media(root, "art", "--offline").status).toBe(0);
  writeFileSync(join(edited, FILE + ".tmp"), "rebuilt");
  renameSync(join(edited, FILE + ".tmp"), join(edited, FILE));

  const next = archive("core-new", { [FILE]: "the pack, painted again" });
  for (const root of [clean, edited]) pin(root, [next]);
  expect(media(clean, "art", "--offline").status).toBe(0);
  expect(readFileSync(join(clean, FILE), "utf8")).toBe("the pack, painted again");
  expect(statSync(join(clean, FILE)).ino).toBe(statSync(stored(next)).ino);
  expect(readFileSync(stored(old), "utf8")).toBe("the pack");

  expect(media(edited, "art", "--offline").said).toContain("Existing file differs");
  expect(readFileSync(join(edited, FILE), "utf8")).toBe("rebuilt");
  // Asked by hand, the installer replaces what an older archive of the asset left.
  expect(media(edited, "art").status).toBe(0);
  expect(readFileSync(join(edited, FILE), "utf8")).toBe("the pack, painted again");
});

test.skipIf(!can)("an offline run downloads nothing: it names the command that would", () => {
  const away = archive("core-away", { [FILE]: "the pack" }, false);
  const root = checkout([away]);
  const r = media(root, "art", "--offline");
  expect(r.status).not.toBe(0);
  expect(r.said.trim().split("\n").pop()).toBe("Art this commit pins is not on this machine yet. Run: bun run media art");
  expect(existsSync(join(root, "assets"))).toBe(false);
});
