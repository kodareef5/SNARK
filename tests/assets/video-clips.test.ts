// The starter clips (tools/video/clips.ts): their list against the caps and the rights, the files the art release holds,
// and the copy a client build makes of them (tools/video/starter.ts).

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, isClipId } from "../../shared/video/clip.ts";
import { probeMp4 } from "../../shared/video/mp4.ts";
import { CLIPS_DIR, SOURCES, SOURCES_FILE, frameColours } from "../../tools/video/clips.ts";
import { copyStarterClips, type StarterList } from "../../tools/video/starter.ts";
import { artTest } from "../fixtures/needs-art.ts";

const list = JSON.parse(readFileSync(join(CLIPS_DIR, "clips.json"), "utf8")) as StarterList;
const page = readFileSync(SOURCES_FILE, "utf8");
const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const top = mkdtempSync(join(tmpdir(), "snark-video-clips-"));
afterAll(() => rmSync(top, { recursive: true, force: true }));

test("every starter clip is within the caps and is a starter", () => {
  expect(list.clips.length).toBe(SOURCES.length);
  for (const c of list.clips) {
    expect(isClipId(c.id)).toBe(true);
    expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(CLIP_MAX_WIDE);
    expect(Math.min(c.width, c.height)).toBeLessThanOrEqual(CLIP_MAX_HIGH);
    expect(c.seconds).toBeGreaterThan(0);
    expect(c.seconds).toBeLessThanOrEqual(CLIP_MAX_SECONDS);
    expect(c.bytes).toBeLessThanOrEqual(CLIP_MAX_BYTES);
    expect((c.bytes * 8) / c.seconds / 1000).toBeLessThanOrEqual(CLIP_MAX_KBPS);
    expect(c.starter).toBe(true);
  }
  expect(new Set(list.clips.map((c) => c.id)).size).toBe(list.clips.length);
});

test("every starter clip has a rights line and a row in SOURCES.md", () => {
  for (const c of list.clips) {
    expect(c.rights.trim().length).toBeGreaterThan(20);
    const row = page.split("\n").find((line) => line.startsWith(`| ${c.title} |`));
    expect(row).toContain(`\`${c.file}\``);
    expect(row).toMatch(/"[^"]{40,}/);
  }
});

test("the strip holds the four calm clips and leaves the lightning out", () => {
  const byFile = new Map(list.clips.map((c) => [c.file, c.id]));
  expect(list.strip).toEqual(["sneeze.mp4", "black-diamond.mp4", "train-robbery.mp4", "clouds.mp4"].map((f) => byFile.get(f)!));
  expect(list.strip).not.toContain(byFile.get("lightning.mp4")!);
});

test("a colour track has COLOUR_RATE samples a second of COLOUR_PARTS colours", () => {
  for (const c of list.clips) {
    const track = Buffer.from(c.colours, "base64");
    expect(track.length % (3 * COLOUR_PARTS)).toBe(0);
    expect(Math.abs(track.length / (3 * COLOUR_PARTS) - c.seconds * COLOUR_RATE)).toBeLessThanOrEqual(1);
  }
});

test("colours are averaged in linear light, each edge from its own band", () => {
  // 16 × 8: the left half white, the right half black. Half the light is sRGB 188, not 128.
  const w = 16, h = 8, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) rgb.fill(255, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const [mean, top, right, bottom, left] = [0, 1, 2, 3, 4].map((p) => frameColours(rgb, w, h)[p * 3]);
  expect(mean).toBe(188);
  expect(top).toBe(188);
  expect(bottom).toBe(188);
  expect(right).toBe(0);
  expect(left).toBe(255);
});

artTest("each clip and poster is installed with the stated bytes and hash", () => {
  for (const c of list.clips) {
    const bytes = readFileSync(join(CLIPS_DIR, c.file));
    expect(bytes.length).toBe(c.bytes);
    const hex = sha256(bytes);
    expect(hex.slice(0, 16)).toBe(c.id);
    expect(page).toContain(`\`${c.file}\` \`${hex}\``);
    expect(statSync(join(CLIPS_DIR, c.poster)).size).toBeLessThanOrEqual(40 * 1024);
  }
});

artTest("a build copies the clips under hashed names and lists them in starter.json", () => {
  const dist = join(top, "dist");
  expect(copyStarterClips(CLIPS_DIR, dist)).toBe(list.clips.length);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  expect(starter.strip).toEqual([...list.strip]);
  for (const [i, c] of starter.clips.entries()) {
    expect(c.file).toBe(`/media/${list.clips[i]!.file.replace(".mp4", `.${c.id}.mp4`)}`);
    expect(c.poster).toMatch(/^\/media\/[a-z-]+\.[0-9a-f]{16}\.jpg$/);
    for (const served of [c.file, c.poster]) {
      const bytes = readFileSync(join(dist, served));
      expect(served).toContain(`.${sha256(bytes).slice(0, 16)}.`);
    }
  }
});

test("a build without the clips writes no starter.json and does not fail", () => {
  const from = join(top, "half"), dist = join(top, "dist-half");
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, "clips.json"), JSON.stringify(list));
  writeFileSync(join(from, list.clips[0]!.file), "not all here");
  mkdirSync(join(dist, "media"), { recursive: true });
  writeFileSync(join(dist, "media/starter.json"), "{}");
  expect(copyStarterClips(from, dist)).toBe(0);
  expect(existsSync(join(dist, "media"))).toBe(false);
  expect(copyStarterClips(join(top, "nowhere"), join(top, "dist-none"))).toBe(0);
  expect(existsSync(join(top, "dist-none/media"))).toBe(false);
  expect(readdirSync(top)).not.toContain("dist-none");
});

artTest("each clip passes the server's MP4 check and is already faststart", () => {
  for (const c of list.clips) {
    const probe = probeMp4(new Uint8Array(readFileSync(join(CLIPS_DIR, c.file))));
    if (typeof probe === "string") throw new Error(`${c.file}: ${probe}`);
    expect([probe.width, probe.height, probe.audio, probe.faststart]).toEqual([c.width, c.height, c.audio, true]);
    expect(probe.seconds).toBeCloseTo(c.seconds, 1);
  }
});
