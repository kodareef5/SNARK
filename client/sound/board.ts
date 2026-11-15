// The listening page, sounds.html: every sound of the build by name, each take as the game plays it, decoded from the
// same file, with the maker of each so two methods can be heard side by side. A distance and a direction place what is
// played as the game would, by the same rules.

import { parseManifest } from "../../shared/pack/manifest.ts";
import { decodeTake } from "../../shared/pack/sound.ts";
import { distanceGain, lowpassAt, semitones } from "../core/sound/place.ts";

const list = document.querySelector<HTMLElement>("#sounds")!;
const far = document.querySelector<HTMLInputElement>("#far")!;
const way = document.querySelector<HTMLSelectElement>("#way")!;
const vary = document.querySelector<HTMLInputElement>("#vary")!;
const note = document.querySelector<HTMLElement>("#note")!;
let ctx: AudioContext | null = null;

/** Directions as the ear hears them: x to the right, z ahead (the listener faces -z). */
const WAYS: Record<string, [number, number]> = { ahead: [0, -1], right: [1, 0], behind: [0, 1], left: [-1, 0] };

function play(buffer: AudioBuffer, range: number, semis: number): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  const d = Number(far.value);
  const [x, z] = WAYS[way.value]!;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = vary.checked ? semitones(semis * (Math.random() * 2 - 1)) : 1;
  const low = new BiquadFilterNode(ctx, { type: "lowpass", frequency: lowpassAt(d, range) });
  const gain = new GainNode(ctx, { gain: distanceGain(d, range) });
  // The panner places by direction only, a metre or more away so that HRTF has a side to hear it from.
  const r = Math.max(1, d);
  const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", rolloffFactor: 0, positionX: x * r, positionY: 0, positionZ: z * r });
  source.connect(low).connect(gain).connect(pan).connect(ctx.destination);
  source.start();
}

async function boot(): Promise<void> {
  const manifest = parseManifest(await (await fetch("assets/manifest.json")).text());
  const sounds = manifest.sounds ?? [];
  if (sounds.length === 0) {
    list.textContent = "This build has no sounds.";
    return;
  }
  const files = new Map<number, Uint8Array>();
  for (const s of sounds) if (!files.has(s.file)) files.set(s.file, new Uint8Array(await (await fetch(`assets/${manifest.files[s.file]!.name}`)).arrayBuffer()));
  let total = 0;
  for (const s of sounds) {
    const row = list.appendChild(document.createElement("div"));
    row.className = "sound";
    const [owner, name] = s.id.split("/sound/") as [string, string];
    row.innerHTML = `<div class="name">${name}<span>${owner}, heard to ${s.range} m${s.vary > 0 ? `, pitch ±${s.vary} semitones` : ""}</span></div>`;
    const takes = row.appendChild(document.createElement("div"));
    takes.className = "takes";
    const makers = new Map<string, AudioBuffer[]>();
    let at = s.at;
    s.takes.forEach((t, k) => {
      const samples = new Float32Array(t.samples);
      decodeTake(files.get(s.file)!.subarray(at, at + t.bytes), t.samples, samples);
      at += t.bytes;
      total += t.bytes;
      const buffer = new AudioBuffer({ length: t.samples, numberOfChannels: 1, sampleRate: s.rate });
      buffer.copyToChannel(samples, 0);
      const from = t.from ?? "take";
      makers.set(from, [...(makers.get(from) ?? []), buffer]);
      const b = takes.appendChild(document.createElement("button"));
      b.textContent = `${from} ${k + 1} (${(t.samples / s.rate).toFixed(2)} s)`;
      b.className = from;
      b.onclick = () => play(buffer, s.range, s.vary);
    });
    if (makers.size < 2) continue;
    // Where two makers made it, one button each plays one of theirs, another each time.
    for (const [from, buffers] of makers) {
      const b = takes.appendChild(document.createElement("button"));
      b.textContent = `any ${from}`;
      b.className = `${from} any`;
      let next = 0;
      b.onclick = () => play(buffers[next++ % buffers.length]!, s.range, s.vary);
    }
  }
  note.textContent = `${sounds.length} sounds, ${sounds.reduce((n, s) => n + s.takes.length, 0)} takes, ${(total / 1024).toFixed(0)} KB as the game fetches them.`;
}

boot().catch((err: unknown) => (list.textContent = err instanceof Error ? err.message : String(err)));
