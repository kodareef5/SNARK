// The default clips (assets/source/core/video, tools/video/clips.ts): every recipe, clip and channel against the caps
// and the rights, the sheet `clips add` reads, the files the art release holds, and the copy a client build makes of
// them (tools/video/starter.ts).

import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLOUR_PARTS } from "../../shared/video/clip.ts";
import { probeMp4 } from "../../shared/video/mp4.ts";
import { SOURCES_FILE, VIDEO_DIR, clipNames, frameColours, isClipName, nameOf, parseCsv, problems, readChannels, readClip, readRecipe, recipeOf } from "../../tools/video/clips.ts";
import { copyStarterClips, type StarterList } from "../../tools/video/starter.ts";
import { artTest } from "../fixtures/needs-art.ts";

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const top = mkdtempSync(join(tmpdir(), "snark-video-clips-"));
afterAll(() => rmSync(top, { recursive: true, force: true }));
const names = clipNames();

test("every default clip, recipe and channel passes the clip tool's check", () => {
  expect(names.length).toBeGreaterThan(0);
  expect(problems()).toEqual([]);
});

test("every default clip has a row in SOURCES.md with its licence", () => {
  const page = readFileSync(SOURCES_FILE, "utf8");
  for (const name of names) {
    const row = page.split("\n").find((line) => line.startsWith(`| ${readRecipe(name).title} |`));
    expect(row, name).toContain(`\`${name}\` \`${readClip(name)!.id}\``);
  }
});

test("no default channel holds a clip that flashes", () => {
  const flashing = names.filter((n) => readRecipe(n).flashes);
  for (const ch of readChannels()) for (const item of ch.items) expect(flashing).not.toContain(item);
  expect(flashing).toContain("lightning");
});

test("the check finds a clip with no rights, one over the caps and a channel naming none", () => {
  const dir = join(top, "bad");
  cpSync(VIDEO_DIR, dir, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  const clouds = readRecipe("clouds", dir);
  writeFileSync(join(dir, "clouds/source.json"), JSON.stringify({ ...clouds, rights: "" }));
  writeFileSync(join(dir, "lightning/clip.json"), JSON.stringify({ ...readClip("lightning", dir), width: 1920, height: 1080 }));
  writeFileSync(join(dir, "channels.json"), JSON.stringify([{ name: "strip", shuffle: false, items: ["clouds", "lightning", "nothing"] }]));
  const found = problems(dir, []).join("\n");
  expect(found).toContain("clouds: source.json needs a rights line");
  expect(found).toContain("lightning: it is 1920×1080, over the caps.");
  expect(found).toContain("strip lists lightning, which flashes.");
  expect(found).toContain("strip lists nothing, which is no clip.");
});

test("a sheet's rows become recipes, and a row without its rights is refused", () => {
  const rows = parseCsv('File,Title,Rights,Licence,By,Channels,Poster,Audio\r\nfoo.mp4,"Dusk, over ""the"" Strip",Mine,"CC0, given",A. Person,strip; night,brightest,yes\n\nbar.mp4,Bar,,,,,,\n');
  expect(rows.length).toBe(2);
  const { name, recipe, channels } = recipeOf(rows[0]!, "ab".repeat(32));
  expect([name, recipe.title, recipe.licence, recipe.poster, recipe.audio, recipe.from.by, channels]).toEqual(["dusk-over-the-strip", 'Dusk, over "the" Strip', "CC0, given", "brightest", true, "A. Person", ["strip", "night"]]);
  expect(() => recipeOf(rows[1]!, "")).toThrow("bar.mp4: the sheet needs rights, licence, url or by.");
  expect(() => recipeOf({ ...rows[0]!, flashes: "yes" }, "")).toThrow("it flashes, so it may not be in a default channel.");
  expect([nameOf("Café — Night #2!"), isClipName("cafe-night-2"), isClipName("Bad_Name"), isClipName("-x")]).toEqual(["cafe-night-2", true, false, false]);
});

test("colours are averaged in linear light, each edge from its own band", () => {
  // 16 × 8: the left half white, the right half black. Half the light is sRGB 188, not 128.
  const w = 16, h = 8, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) rgb.fill(255, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const [mean, top, right, bottom, left] = [0, 1, 2, 3, 4].map((p) => frameColours(rgb, w, h)[p * 3]);
  expect([mean, top, right, bottom, left]).toEqual([188, 188, 0, 188, 255]);
  expect(frameColours(rgb, w, h).length).toBe(COLOUR_PARTS * 3);
});

artTest("each clip and poster is installed with the stated bytes, and passes the server's MP4 check", () => {
  for (const name of names) {
    const c = readClip(name)!, bytes = readFileSync(join(VIDEO_DIR, name, c.file));
    expect(bytes.length).toBe(c.bytes);
    expect(sha256(bytes).slice(0, 16)).toBe(c.id);
    expect(readFileSync(join(VIDEO_DIR, name, c.poster)).length).toBeLessThanOrEqual(40 * 1024);
    const probe = probeMp4(new Uint8Array(bytes));
    if (typeof probe === "string") throw new Error(`${name}: ${probe}`);
    expect([probe.width, probe.height, probe.audio, probe.faststart]).toEqual([c.width, c.height, c.audio, true]);
    expect(probe.seconds).toBeCloseTo(c.seconds, 1);
  }
});

artTest("a build copies the clips under hashed names and lists them with the channels", () => {
  const dist = join(top, "dist");
  expect(copyStarterClips(VIDEO_DIR, dist)).toBe(names.length);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  const idOf = new Map(names.map((n) => [n, readClip(n)!.id]));
  expect(starter.channels).toEqual(readChannels().map((ch) => ({ name: ch.name, shuffle: ch.shuffle, items: ch.items.map((n) => idOf.get(n)!) })));
  for (const [i, c] of starter.clips.entries()) {
    expect(c.file).toBe(`/media/${names[i]}.${c.id}.mp4`);
    expect(c.poster).toMatch(/^\/media\/[a-z0-9-]+\.[0-9a-f]{16}\.jpg$/);
    for (const served of [c.file, c.poster]) expect(served).toContain(`.${sha256(readFileSync(join(dist, served))).slice(0, 16)}.`);
  }
});

test("a build leaves out a clip whose art is missing, and writes nothing with none", () => {
  const from = join(top, "half"), dist = join(top, "dist-half");
  cpSync(VIDEO_DIR, from, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  for (const f of ["clip.mp4", "poster.jpg"]) writeFileSync(join(from, "lightning", f), "stand-in");
  expect(copyStarterClips(from, dist)).toBe(1);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  // The strip held only clouds, whose art is missing, so it is left out with it.
  expect([starter.clips.map((c) => c.title), starter.channels]).toEqual([["Lightning storm over Colorado"], []]);
  rmSync(join(from, "lightning"), { recursive: true });
  mkdirSync(join(dist, "media"), { recursive: true });
  expect(copyStarterClips(from, dist)).toBe(0);
  expect(existsSync(join(dist, "media"))).toBe(false);
  expect(copyStarterClips(join(top, "nowhere"), join(top, "dist-none"))).toBe(0);
  expect(readdirSync(top)).not.toContain("dist-none");
});
