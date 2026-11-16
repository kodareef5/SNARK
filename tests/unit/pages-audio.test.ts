import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudio, soundSource } from "../../tools/pages/audio.ts";
import { prepareTake, readWav, writeWav } from "../../tools/pack/sound.ts";

test("public audio matches processed game samples, reuses its cache and exposes no source recipe", async () => {
  const root = mkdtempSync(join(tmpdir(), "guide-audio-"));
  try {
    const source = join(root, "source"), dir = join(source, "core/creatures/bird/sound"), out = join(root, "out");
    mkdirSync(dir, { recursive: true });
    const original = Float32Array.from({ length: 6400 }, (_, i) => Math.sin(i * .08) * .4);
    const raw = writeWav(original, 32000);
    writeFileSync(join(dir, "take.wav"), raw);
    const take = { file: "take.wav", start: .02, end: .12, from: "private-generation-canary" };
    const cue = { range: 20, level: -20, takes: [take] };
    writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds: { call: cue } }));
    const options = { source, cache: join(root, "cache") };
    const result = await buildAudio(out, options);
    expect(result.sounds).toHaveLength(1);
    const sound = result.sounds[0]!;
    expect(sound.seconds).toBe(.1);
    expect(JSON.stringify(result)).not.toContain("private-generation-canary");
    expect(JSON.stringify(result)).not.toContain(root);
    expect(readFileSync(join(out, sound.url.slice(1)))).toEqual(Buffer.from(writeWav(prepareTake(readWav(raw), take, cue).samples, 32000)));
    expect(await buildAudio(out, options)).toEqual(result);
    writeFileSync(join(root, "outside.wav"), raw);
    expect(() => soundSource(dir, "../../../../outside.wav")).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
