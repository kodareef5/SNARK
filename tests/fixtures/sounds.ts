// A sound file built as the build makes it, from a cue sheet of made-up takes in a folder of its own, and the manifest
// that lists it beside a pack.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describePack, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";

/** A rising chirp with a little noise, as a take might be. */
export function chirp(seconds: number, rate: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const env = Math.sin((Math.PI * i) / out.length);
    out[i] = amp * env * (Math.sin(2 * Math.PI * (300 + 400 * t) * t) + 0.05 * (seed / 2 ** 31 - 1));
  }
  return out;
}

/**
 * The dodo's sounds, made of chirps: two makers' calls, a startle, pain, a peck, a landing and steps on two grounds.
 * With `beds`, the world's grass beds by day and by night as well, which loop; with `flap`, the pteranodon's wingbeat.
 */
export function builtSounds(file = 1, beds = false, flap = false): { sounds: NonNullable<Manifest["sounds"]>; file: Uint8Array } {
  const root = mkdtempSync(join(tmpdir(), "snark-sound-"));
  try {
    if (flap) {
      const flyer = join(root, "core", "creatures", "pteranodon", "sound");
      mkdirSync(join(flyer, "takes"), { recursive: true });
      writeFileSync(join(flyer, "takes", "flap.wav"), writeWav(chirp(0.3, 44100), 44100));
      writeFileSync(join(flyer, "sounds.json"), JSON.stringify({ sounds: { flap: { range: 120, level: -20, takes: [{ file: "takes/flap.wav", from: "moss" }] } } }));
    }
    if (beds) {
      const world = join(root, "core", "world", "sound");
      mkdirSync(join(world, "takes"), { recursive: true });
      writeFileSync(join(world, "takes", "bed.wav"), writeWav(chirp(1, 32000), 32000));
      const bed = { range: 1, level: -30, loop: true, takes: [{ file: "takes/bed.wav" }] };
      writeFileSync(join(world, "sounds.json"), JSON.stringify({ sounds: { "bed/grass/day": bed, "bed/grass/night": bed } }));
    }
    const dir = join(root, "core", "creatures", "dodo", "sound");
    mkdirSync(join(dir, "takes"), { recursive: true });
    writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(0.4, 44100), 44100));
    writeFileSync(join(dir, "takes", "b.wav"), writeWav(chirp(0.25, 48000, 0.3), 48000));
    const take = (name: string, from: string) => ({ file: `takes/${name}`, from });
    const sheet = {
      sounds: {
        call: { range: 40, level: -20, vary: 1, takes: [take("a.wav", "moss"), take("b.wav", "stable")] },
        startled: { range: 60, level: -14, takes: [take("b.wav", "moss")] },
        hurt: { range: 45, level: -16, takes: [take("b.wav", "moss")] },
        peck: { range: 15, level: -24, takes: [take("a.wav", "moss")] },
        land: { range: 25, level: -20, takes: [take("a.wav", "moss")] },
        "step/grass": { range: 20, level: -28, takes: [{ ...take("a.wav", "moss"), start: 0, end: 0.1 }, { ...take("a.wav", "moss"), start: 0.1, end: 0.2 }] },
        "step/sand": { range: 20, level: -28, takes: [{ ...take("b.wav", "moss"), start: 0, end: 0.1 }] },
      },
    };
    writeFileSync(join(dir, "sounds.json"), JSON.stringify(sheet));
    const built = buildSounds(file, root, null)!;
    return { sounds: built.sounds, file: built.bytes };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A manifest of `pack` whole as the boot file, and the sound file after it. */
export function manifestWithSounds(pack: Pack, packBytes: number, built: ReturnType<typeof builtSounds>): Manifest {
  const m = describePack(pack, { name: "boot", bytes: packBytes });
  m.files.push({ name: "sounds", bytes: built.file.length, role: "sound" });
  m.sounds = built.sounds;
  return parseManifest(JSON.stringify(m));
}
