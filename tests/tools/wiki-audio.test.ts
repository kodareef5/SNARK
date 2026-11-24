import { expect, test } from "bun:test";
import { takeRange, takeSamples } from "../../client/core/wiki/sound.ts";
import { encodeTransform } from "../../tools/pack/transform.ts";
import { renderSound, renderTrack, type Sound } from "../../tools/wiki/audio.ts";

test("the wiki asks for and decodes only the chosen take", async () => {
  const tone = Float32Array.from({ length: 480 }, (_, k) => Math.sin(k * 0.15) * 0.5);
  const packed = encodeTransform(tone, 32000, 8, { looser: 0, loop: false, noise: false });
  const row = { file: "/assets/core.snsd", at: "100", takes: `3:5 ${tone.length}:${packed.length} 2:7` };
  let asked = "";
  const decoded = await takeSamples(row, 1, async (url, { headers }) => {
    asked = `${url} ${headers.range}`;
    return { status: 206, arrayBuffer: async () => Uint8Array.from(packed).buffer };
  });
  expect(asked).toBe(`/assets/core.snsd bytes=105-${104 + packed.length}`);
  expect(decoded.length).toBe(tone.length);
  expect(decoded.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
});

test("a take rejects a whole-file, truncated or undecodable response", async () => {
  const row = { file: "/assets/core.snsd", at: "100", takes: "480:5" };
  const reply = (status: number, bytes: number) => async () => ({ status, arrayBuffer: async () => new ArrayBuffer(bytes) });
  await expect(takeSamples(row, 0, reply(200, 5))).rejects.toThrow("server sent 200");
  await expect(takeSamples(row, 0, reply(206, 4))).rejects.toThrow("wrong length");
  await expect(takeSamples(row, 0, reply(206, 5))).rejects.toThrow("could not be decoded");
  expect(() => takeRange(row, 1)).toThrow("no such take");
});

test("audio markup names takes and leaves music unloaded until play", () => {
  const sound: Sound = {
    id: "core:raptor/sound/call", owner: "core:raptor", name: "Alert <call>", file: "core.snsd", at: 8, rate: 32000,
    takes: [[16000, 20], [24000, 30]], game: false,
  };
  const html = renderSound(sound, "Raptor");
  expect(html).toContain('aria-label="Play raptor alert &lt;call&gt;, take 2 of 2, 0.75 s"');
  expect(html).toContain('data-takes="16000:20 24000:30"');
  expect(html).toContain("Unused in game");
  expect(html).toContain('data-audio-status role="status"');
  const music = renderTrack({ id: "night_shift", seconds: 75, bpm: 90, layers: [{ name: "Calm", file: "quiet.opus" }] });
  expect(music).toContain('<audio data-wiki-audio controls preload="none" aria-label="night shift, Calm" src="/assets/music/night_shift/quiet.opus">');
});
