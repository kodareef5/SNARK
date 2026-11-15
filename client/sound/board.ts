// The sound board, sounds.html: every occasion of the catalogue (shared/sound/cues.ts) with what it is heard by in this
// build (client/core/sound/coverage.ts), and every sound by owner with each take as the game plays it, decoded from the
// same file and labelled with its maker. A distance and a direction place what is played by the game's own rules.

import { parseManifest } from "../../shared/pack/manifest.ts";
import { decodeTake } from "../../shared/pack/sound.ts";
import { coverage } from "../core/sound/coverage.ts";
import { distanceGain, lowpassAt, semitones } from "../core/sound/place.ts";

const $ = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
const [list, cues, note, far, way, vary, find, silentOnly] = [$("sounds"), $("cues"), $("note"), $<HTMLInputElement>("far"), $<HTMLSelectElement>("way"), $<HTMLInputElement>("vary"), $<HTMLInputElement>("find"), $<HTMLInputElement>("silent")];
let ctx: AudioContext | null = null;
/** Directions as the ear hears them: x to the right, z ahead (the listener faces -z). */
const WAYS: Record<string, [number, number]> = { ahead: [0, -1], right: [1, 0], behind: [0, 1], left: [-1, 0] };
const held = new Map<string, { buffers: AudioBuffer[]; range: number; vary: number; next: number }>();

function play(buffer: AudioBuffer, range: number, semis: number, rate = 1): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  const d = Number(far.value);
  const [x, z] = WAYS[way.value]!;
  const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate * (vary.checked ? semitones(semis * (Math.random() * 2 - 1)) : 1) });
  const low = new BiquadFilterNode(ctx, { type: "lowpass", frequency: range > 0 ? lowpassAt(d, range) : 20000 });
  const gain = new GainNode(ctx, { gain: range > 0 ? distanceGain(d, range) : 1 });
  // The panner places by direction only, a metre or more away so that HRTF has a side to hear it from.
  const r = Math.max(1, d);
  const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", rolloffFactor: 0, positionX: x * r, positionY: 0, positionZ: z * r });
  source.connect(low).connect(gain).connect(pan).connect(ctx.destination);
  source.start();
}

/** One take of the sound, another each time, as the game picks. */
function playAny(id: string, rate = 1): void {
  const h = held.get(id);
  if (h) play(h.buffers[h.next++ % h.buffers.length]!, h.range, h.vary, rate);
}

function el(parent: HTMLElement, tag: string, cls: string, html = ""): HTMLElement {
  const e = parent.appendChild(document.createElement(tag));
  e.className = cls;
  e.innerHTML = html;
  return e;
}

async function boot(): Promise<void> {
  const manifest = parseManifest(await (await fetch("assets/manifest.json")).text());
  const sounds = manifest.sounds ?? [];
  const files = new Map<number, Uint8Array>();
  for (const s of sounds) if (!files.has(s.file)) files.set(s.file, new Uint8Array(await (await fetch(`assets/${manifest.files[s.file]!.name}`)).arrayBuffer()));
  let total = 0;
  let owner = "";
  for (const s of sounds) {
    const [o, name] = s.id.split("/sound/") as [string, string];
    if (o !== owner) el(list, "h3", "owner", (owner = o));
    const row = el(list, "div", "sound", `<div class="name">${name}<span>heard to ${s.range} m${s.vary > 0 ? `, pitch ±${s.vary} semitones` : ""}</span></div>`);
    const takes = el(row, "div", "takes");
    const buffers: AudioBuffer[] = [];
    let at = s.at;
    s.takes.forEach((t, k) => {
      const samples = new Float32Array(t.samples);
      decodeTake(files.get(s.file)!.subarray(at, at + t.bytes), t.samples, samples);
      at += t.bytes;
      total += t.bytes;
      const buffer = new AudioBuffer({ length: t.samples, numberOfChannels: 1, sampleRate: s.rate });
      buffer.copyToChannel(samples, 0);
      buffers.push(buffer);
      const b = el(takes, "button", t.from ?? "take", `${t.from ?? "take"} ${k + 1} (${(t.samples / s.rate).toFixed(2)} s)`);
      b.onclick = () => play(buffer, s.range, s.vary);
    });
    held.set(s.id, { buffers, range: s.range, vary: s.vary, next: 0 });
  }
  const c = coverage(sounds.map((s) => s.id));
  note.textContent = `${sounds.length} sounds, ${sounds.reduce((n, s) => n + s.takes.length, 0)} takes, ${(total / 1024).toFixed(0)} KB as the game fetches them. ${c.rows.length} occasions: ${c.shared} heard through a shared sound, ${c.ownOnly} only by owners' own, ${c.silent} silent (${c.silentWaiting} wait on a feature).`;
  const rows = c.rows.map((r) => {
    const heard = r.shared ? `<b>${r.shared.replace("/sound/", " / ")}</b>${r.rate !== 1 ? ` at ${r.rate}` : ""}` : r.owners.length > 0 ? "own sounds only" : "<b>nothing</b>";
    const e = el(cues, "div", `cue ${r.shared ? "shared" : r.owners.length > 0 ? "own" : "silent"}`, `<code>${r.key}</code><span>${r.cue.status}</span><span>${r.cue.kind}, ${r.cue.space}${r.cue.loop ? ", loops" : ""}</span><span>${heard}${r.owners.length > 0 ? `; own: ${r.owners.join(", ")}` : ""}</span><small>${r.cue.when}</small>`);
    e.onclick = () => (r.shared ? playAny(r.shared, r.rate) : r.owners[0] && playAny(`${r.owners[0]}/sound/${r.key}`));
    return { r, e, text: `${r.key} ${r.cue.status} ${r.cue.kind} ${r.shared ?? ""} ${r.owners.join(" ")} ${r.cue.when}`.toLowerCase() };
  });
  const filter = (): void => {
    const q = find.value.toLowerCase();
    for (const x of rows) x.e.hidden = (q !== "" && !x.text.includes(q)) || (silentOnly.checked && (x.r.shared !== null || x.r.owners.length > 0));
  };
  find.oninput = silentOnly.onchange = filter;
}

boot().catch((err: unknown) => (list.textContent = err instanceof Error ? err.message : String(err)));
