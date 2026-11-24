import { num, time } from "../../client/core/wiki/format.ts";
import { sentence } from "./catalogue.ts";
import { esc } from "./html.ts";

export interface Sound {
  id: string;
  owner: string;
  name: string;
  file: string;
  at: number;
  rate: number;
  takes: (readonly [samples: number, bytes: number])[];
  /** The game plays this sound. */
  game: boolean;
}

export interface Track {
  id: string;
  bpm: number;
  seconds: number;
  layers: { name: string; file: string }[];
}

const seconds = (length: number): string => length < 60 ? `${num(length, length < 1 ? 2 : 1)} s` : time(length);
const status = '<small class="audio-status" data-audio-status role="status"></small>';

export function renderSound(sound: Sound, ownerLabel: string): string {
  const count = sound.takes.length;
  const of = `${ownerLabel} ${sound.name}`.toLowerCase();
  const takes = sound.takes.map(([samples], index) => {
    const duration = samples / sound.rate;
    const label = `Play ${of}${count > 1 ? `, take ${index + 1} of ${count}` : ""}, ${seconds(duration)}`;
    return `<button type="button" class="take" data-k="${index}" aria-pressed="false" aria-label="${esc(label)}" style="--d:${duration.toFixed(3)}s">${count > 1 ? `<b>${index + 1}</b>` : ""}<small>${seconds(duration)}</small></button>`;
  }).join("");
  const data = `data-file="/assets/${esc(sound.file)}" data-at="${sound.at}" data-rate="${sound.rate}" data-takes="${sound.takes.map((take) => take.join(":")).join(" ")}"`;
  const badge = sound.game ? "" : ' <span class="tag">Unused in game</span>';
  return `<li class="sound" ${data}><span>${esc(sound.name)}${badge}</span><span class="takes" role="group" aria-label="${esc(`${sentence(of)}, ${count} ${count === 1 ? "take" : "takes"}`)}">${takes}</span>${status}</li>`;
}

export function renderTrack(track: Track): string {
  const name = track.id.replaceAll("_", " ");
  const layers = track.layers.map((layer) =>
    `<li><span>${esc(layer.name)}</span><audio data-wiki-audio controls preload="none" aria-label="${esc(`${name}, ${layer.name}`)}" src="/assets/music/${esc(track.id)}/${esc(layer.file)}"></audio>${status}</li>`
  ).join("");
  return `<section><h2>${esc(name)} <small>${time(track.seconds)} · ${num(track.bpm)} BPM</small></h2><ul class="layers">${layers}</ul></section>`;
}
