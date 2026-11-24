import { adminContext } from "./shell.ts";
// The sound board, sounds.html: every sound the build has, by owner and then by occasion as client/core/sound/listing.ts
// lists them, each take playable as the game plays it, decoded from the same file when first played: the game's file, or
// for a sound no cue reaches yet, the build's loose file (assets/loose.json). An admin's page:
// server/sound-board.ts serves it and the owners' folders, briefs and recipes. A distance and a direction place what is
// played by the game's own rules.

import { parseManifest } from "../../shared/pack/manifest.ts";
import { decodeTakes, type ManifestSound } from "../../shared/pack/sound.ts";
import { listSounds, takesOf, type ListedOwner, type Variant } from "../core/sound/listing.ts";
import { distanceGain, lowpassAt, semitones } from "../core/sound/place.ts";

const $ = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
const [list, note, far, way, vary, find, missing, later] = [$("list"), $("note"), $<HTMLInputElement>("far"), $<HTMLSelectElement>("way"), $<HTMLInputElement>("vary"), $<HTMLInputElement>("find"), $<HTMLInputElement>("missing"), $<HTMLInputElement>("later")];
let ctx: AudioContext | null = null;
/** Directions as the ear hears them: x to the right, z ahead (the listener faces -z). */
const WAYS: Record<string, [number, number]> = { ahead: [0, -1], right: [1, 0], behind: [0, 1], left: [-1, 0] };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const world = await adminContext();
const resource = (path: string) => world.api(`../${path}`);
const decoded = new Map<string, AudioBuffer[]>();
const next = new Map<string, number>();

async function buffers(name: string, s: ManifestSound): Promise<AudioBuffer[]> {
  const kept = decoded.get(s.id);
  if (kept) return kept;
  const bytes = s.takes.reduce((n, t) => n + t.bytes, 0);
  const answer = await fetch(resource(`assets/${name}`), { headers: { range: `bytes=${s.at}-${s.at + bytes - 1}` } });
  // A server that ignores the range would send the whole file for one sound.
  if (answer.status !== 206 && Number(answer.headers.get("content-length")) !== bytes) {
    void answer.body?.cancel();
    throw new Error(`the server sent ${answer.status} for a range of ${name}`);
  }
  const takes = decodeTakes(new Uint8Array(await answer.arrayBuffer()), s.takes);
  if (!takes) throw new Error(`${s.id} does not decode`);
  const out = takes.map((samples) => {
    const b = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: s.rate });
    b.copyToChannel(samples, 0);
    return b;
  });
  decoded.set(s.id, out);
  return out;
}

function play(buffer: AudioBuffer, range: number, semis: number, rate: number): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  const d = Number(far.value);
  const [x, z] = WAYS[way.value]!;
  const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate * (vary.checked ? semitones(semis * (Math.random() * 2 - 1)) : 1) });
  const low = new BiquadFilterNode(ctx, { type: "lowpass", frequency: lowpassAt(d, range) });
  const gain = new GainNode(ctx, { gain: distanceGain(d, range) });
  // A metre or more away, so that HRTF has a side to hear it from.
  const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", rolloffFactor: 0, positionX: x * Math.max(1, d), positionZ: z * Math.max(1, d) });
  source.connect(low).connect(gain).connect(pan).connect(ctx.destination);
  source.start();
}

const chip = (v: Variant): string =>
  `<button class="chip ${v.by}" ${v.sound ? `data-play="${esc(v.sound)}" data-rate="${v.rate}"` : "disabled"}>${esc(v.word || "heard")}: ${v.by === "none" ? "no take yet" : v.by === "own" ? "its own" : `${v.by} ${esc(v.sound!.replace("/sound/", " "))}${v.rate !== 1 ? ` at ${v.rate}` : ""}`}</button>`;

async function boot(): Promise<void> {
  const manifest = parseManifest(await (await fetch(resource("assets/manifest.json"))).text());
  if (manifest.soundRows) manifest.sounds = (await (await fetch(resource(`assets/${manifest.soundRows}`))).json()) as ManifestSound[];
  const answer = await fetch(resource("admin/sounds.json"));
  if (!answer.ok) throw new Error(await answer.text());
  const owners = (await answer.json()) as ListedOwner[];
  const loose = await fetch(resource("assets/loose.json")).then((r) => (r.ok ? (r.json() as Promise<{ file: string; sounds: ManifestSound[] }>) : null));
  const sounds = [...(manifest.sounds ?? []), ...(loose?.sounds ?? [])];
  const byId = new Map(sounds.map((s) => [s.id, s]));
  const fileOf = (s: ManifestSound): string => (s.file < 0 ? loose!.file : manifest.files[s.file]!.name);
  const ownerOf = new Map(owners.map((o) => [o.id, o]));
  const takes = (id: string): string => {
    const s = byId.get(id)!;
    return takesOf(s, ownerOf.get(id.slice(0, id.indexOf("/sound/")))).map((t, k) => `<button class="take ${esc(t.from)}" data-take="${esc(id)}" data-k="${k}" title="${esc(t.made || t.file)}">${k + 1} · ${t.seconds.toFixed(2)} s · ${esc(t.file.split("/").pop() || t.from)}</button>`).join("");
  };
  const seconds = sounds.reduce((n, s) => n + s.takes.reduce((m, t) => m + t.samples / s.rate, 0), 0);
  const bytes = sounds.reduce((n, s) => n + s.takes.reduce((m, t) => m + t.bytes, 0), 0);
  note.textContent = `${sounds.length} sounds, ${sounds.reduce((n, s) => n + s.takes.length, 0)} takes, ${seconds.toFixed(0)} s, ${(bytes / 1048576).toFixed(1)} MB, ${manifest.sounds?.length ?? 0} of them in the game's file.`;
  list.innerHTML = listSounds(sounds, owners).map((g) => `<h2>${esc(g.title)}</h2>${g.cards.map((c) => `<details class="card" open><summary><b>${esc(c.title)}</b> <code>${esc(c.id)}</code> <span class="count"><i class="own">${c.count.own} own</i> <i class="stand-in">${c.count["stand-in"]} stand-in</i> <i class="shared">${c.count.shared} shared</i> <i class="none">${c.count.none} none</i></span>${c.files.map((f) => ` <a href="${esc(resource(`admin/source/${f}`))}" target="_blank">${esc(f.split("/").pop()!)}</a>`).join("")}</summary>
    ${c.occasions.map((o) => `<div class="occ${o.status.startsWith("waits:") ? " later" : ""}${o.variants.every((v) => v.by === "own") ? "" : " gap"}" data-text="${esc(`${c.id} ${o.name} ${o.label} ${o.status} ${o.when}`.toLowerCase())}"><div class="what"><b>${esc(o.label)}</b> <code>${esc(o.name)}</code> <i>${esc(o.status)}${o.loop ? ", loops" : ""}</i><small>${esc(o.when)}</small>${o.want ? `<small class="want">the brief asks for: ${esc(o.want)}</small>` : ""}</div><div class="how">${o.variants.map(chip).join("")}</div>${o.variants.filter((v) => v.by === "own").map((v) => `<div class="takes">${v.word ? `<span>${esc(v.word)}</span>` : ""}${takes(v.sound!)}</div>`).join("")}</div>`).join("")}
    ${c.loose.length > 0 ? `<div class="occ"><div class="what"><b>its own, heard by no occasion</b></div>${c.loose.map((n) => `<div class="takes"><span>${esc(n)}</span>${takes(`${c.id}/sound/${n}`)}</div>`).join("")}</div>` : ""}</details>`).join("")}`).join("");
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-play], [data-take]");
    const s = b && byId.get(b.dataset.play ?? b.dataset.take ?? "");
    if (!b || !s) return;
    // A take as asked, or the next take round, as the game never plays one twice running.
    const k = b.dataset.k !== undefined ? Number(b.dataset.k) : (next.get(s.id) ?? 0);
    next.set(s.id, (k + 1) % s.takes.length);
    buffers(fileOf(s), s).then((all) => play(all[k]!, s.range, s.vary, Number(b.dataset.rate ?? 1)), (err: unknown) => (note.textContent = String(err)));
  });
  const filter = (): void => {
    const q = find.value.toLowerCase();
    for (const o of list.querySelectorAll<HTMLElement>(".occ[data-text]")) o.hidden = (q !== "" && !o.dataset.text!.includes(q)) || (missing.checked && !o.classList.contains("gap")) || (!later.checked && o.classList.contains("later"));
  };
  find.oninput = missing.onchange = later.onchange = filter;
  filter();
}

boot().catch((err: unknown) => (list.textContent = err instanceof Error ? err.message : String(err)));
