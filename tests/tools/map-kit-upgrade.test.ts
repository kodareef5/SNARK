import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyKit, withCityLock } from "../../tools/maps/city-lock.ts";
import { unpack } from "../../tools/maps/kit.ts";

const city = "miami", cut = "123456789a";
let dir: string, maps: string, top: string, target: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "snark-kit-upgrade-"));
  maps = join(dir, "mapdata");
  top = join(maps, city);
  target = join(top, cut);
});
afterEach(() => rmSync(dir, { force: true, recursive: true }));

function archive(layer: string, inside = city): { file: string; digest: string } {
  const stage = mkdtempSync(join(dir, "archive-"));
  const work = join(stage, cut, city);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "kit.json"), JSON.stringify({ city: inside, cut, commit: "123456789", stages: { fetch: "one", build: "two" } }));
  writeFileSync(join(work, "layer"), layer);
  const packed = join(stage, "kit.tar.gz");
  expect(Bun.spawnSync(["tar", "-czf", packed, cut], { cwd: stage }).exitCode).toBe(0);
  const digest = new Bun.CryptoHasher("sha256").update(readFileSync(packed)).digest("hex");
  const file = join(stage, `${city}-${cut}.${digest.slice(0, 12)}.tar.gz`);
  renameSync(packed, file);
  return { file, digest };
}

const read = (...path: string[]): string => readFileSync(join(...path), "utf8").trim();

for (const legacy of [false, true]) {
  test(`a new kit retains the ${legacy ? "legacy" : "pinned"} cut and its local edits`, async () => {
    const first = archive("first"), next = archive("second");
    await unpack(first.file, maps);
    if (legacy) rmSync(join(target, ".installed-sha256"));
    writeFileSync(join(target, city, "layer"), "local edit");
    writeFileSync(join(target, "my-report"), "my report");
    await unpack(next.file, maps);
    expect(readlinkSync(join(top, "current"))).toBe(join(cut, city));
    expect(read(top, "current", "layer")).toBe("second");
    expect(read(target, ".installed-sha256")).toBe(next.digest);
    expect(JSON.parse(read(top, "current", "stages.json"))).toEqual({ fetch: "one" });
    const backups = join(top, "previous-kits");
    const prior = join(backups, readdirSync(backups)[0]!, cut);
    expect(read(prior, city, "layer")).toBe("local edit");
    expect(read(prior, "my-report")).toBe("my report");
    await unpack(next.file, maps);
    expect(readdirSync(backups)).toHaveLength(1);
  });
}

test("a live build, an unmanaged cut and a malformed kit preserve existing data", async () => {
  const good = archive("first"), wrong = archive("other", "wrong");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "author"), "keep");
  writeFileSync(join(top, "run.lock"), String(process.pid));
  await expect(unpack(good.file, maps)).rejects.toThrow("run of this city");
  rmSync(join(top, "run.lock"));
  await expect(unpack(good.file, maps)).rejects.toThrow("unmanaged cut");
  renameSync(target, join(top, "authored"));
  await unpack(good.file, maps);
  await expect(unpack(wrong.file, maps)).rejects.toThrow("different or unfinished");
  expect(read(top, "authored", "author")).toBe("keep");
  expect(read(top, "current", "layer")).toBe("first");
  expect(existsSync(join(top, "previous-kits"))).toBe(false);
});

test("the next build completes a staged switch after the installer stops", () => {
  const ready = readyKit(top, cut);
  mkdirSync(join(ready, city), { recursive: true });
  writeFileSync(join(ready, city, "layer"), "whole");
  symlinkSync(join(cut, city), join(top, "current"));
  writeFileSync(join(top, "run.lock"), "2147483647");
  expect(withCityLock(top, cut, () => read(top, "current", "layer"))).toBe("whole");
  expect(existsSync(ready)).toBe(false);
  expect(existsSync(join(top, "run.lock"))).toBe(false);
});

test("concurrent stale-lock takeovers admit one writer at a time", async () => {
  mkdirSync(top, { recursive: true });
  writeFileSync(join(top, "run.lock"), "2147483647");
  const code = `
    import { withCityLock } from ${JSON.stringify(join(import.meta.dir, "../../tools/maps/city-lock.ts"))};
    import { unlinkSync, writeFileSync } from "node:fs";
    const [top, cut] = process.argv.slice(1);
    try {
      withCityLock(top, cut, () => {
        writeFileSync(top + "/writer", "present", { flag: "wx" });
        Bun.sleepSync(35);
        unlinkSync(top + "/writer");
        console.log("wrote");
      });
    } catch (err) {
      if (err.path === top + "/writer") throw err;
      console.log("busy");
    }
  `;
  const children = Array.from({ length: 4 }, () => Bun.spawn(["bun", "-e", code, top, cut], { stdout: "pipe" }));
  expect(await Promise.all(children.map(p => p.exited))).toEqual([0, 0, 0, 0]);
  const outcomes = await Promise.all(children.map(p => new Response(p.stdout).text()));
  expect(outcomes).toContain("wrote\n");
  expect(existsSync(join(top, "run.lock"))).toBe(false);
});
