// A crowd is not a chorus: six bodies calling one sound at once are a few voices, each a different take, each its own
// pitch, staggered; and each body keeps its own voice from call to call.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cueKey } from "../../shared/sound/cues.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { START_FIELDS, type SoundSink } from "../../client/core/sound/packet.ts";
import { Sounds, voiceOf } from "../../client/core/sound/sounds.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const hf = buildProvingHeightfield();

function pack(): { sounds: Sounds; frame: () => number[][] } {
  const root = mkdtempSync(join(tmpdir(), "snark-variety-"));
  try {
    const dir = join(root, "core", "creatures", "packbeast", "sound");
    mkdirSync(join(dir, "takes"), { recursive: true });
    const takes = [0, 1, 2, 3, 4, 5].map((k) => {
      writeFileSync(join(dir, "takes", `${k}.wav`), writeWav(chirp(0.5 + k * 0.05, 32000), 32000));
      return { file: `takes/${k}.wav` };
    });
    writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds: { chase: { range: 60, level: -20, vary: 0, takes } } }));
    const built = buildSounds(1, root, null)!;
    const net = new FakeNet([new Uint8Array(0), built.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
    const sounds = new Sounds({ sounds: built.sounds }, net, reg, () => null);
    let now = 0;
    const ear = { x: 380, y: hf.heightAt(380, 380) + 1.6, z: 380, yaw: 0, pitch: 0 };
    const frame = (): number[][] => {
      const out: number[][] = [];
      const sink: SoundSink = { running: true, apply: (p) => { for (let i = 0; i < p.starts.length; i += START_FIELDS) out.push(p.starts.slice(i, i + START_FIELDS)); } };
      now += 1000 / 30;
      net.advance(now);
      sounds.frame(sink, now, new RemoteSample(), hf, ear, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 });
      return out;
    };
    return { sounds, frame };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("six of a pack calling at once are at most three voices, each a different take at a different pitch, spread in time", () => {
  const { sounds, frame } = pack();
  const owner = sounds.resolver.owner("core:packbeast");
  const key = cueKey("chase");
  const call = (): void => {
    for (let id = 1; id <= 6; id++) sounds.hear(owner, key, id, 380 + id, 3, 383, 1, 1, false);
  };
  // Its first two takes come first: two voices, and no take twice at once while there are more to hold.
  let first: number[][] = [];
  while (first.length === 0) {
    call();
    first = frame();
  }
  expect(new Set(first.map((s) => s[1])).size).toBe(first.length);
  expect(first.length).toBe(2);
  // Until the rest are held.
  for (let k = 0; k < 60; k++) {
    call();
    frame();
  }
  // Until what the warm-up started has ended.
  for (let k = 0; k < 40; k++) frame();
  call();
  const started = frame();
  expect(started.length).toBe(3);
  expect(new Set(started.map((s) => s[1])).size).toBe(3);
  expect(new Set(started.map((s) => s[3]!.toFixed(4))).size).toBe(3);
  expect(Math.max(...started.map((s) => s[2]!))).toBeGreaterThan(0);
  // When those have ended, the pack is heard again.
  for (let k = 0; k < 40; k++) frame();
  call();
  expect(frame().length).toBe(3);
});

test("a body's own voice stays with it, and bodies differ", () => {
  expect(voiceOf(17)).toBe(voiceOf(17));
  const voices = Array.from({ length: 50 }, (_, i) => voiceOf(i));
  expect(Math.min(...voices)).toBeGreaterThanOrEqual(-1);
  expect(Math.max(...voices)).toBeLessThan(1);
  expect(new Set(voices.map((v) => v.toFixed(3))).size).toBe(50);
  // Spread over the whole range, not bunched.
  expect(voices.filter((v) => v < 0).length).toBeGreaterThan(15);
  expect(voices.filter((v) => v > 0).length).toBeGreaterThan(15);
});
