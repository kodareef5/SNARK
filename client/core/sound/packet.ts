// What the audio device must do this frame, as client/core decided it: takes to hold and to let go, voices to start,
// move and stop, and where the ear is. client/sound carries it out with the browser's own audio and decides nothing.

import type { MusicPlan } from "./music.ts";

/**
 * Numbers per voice in `starts`: voice, buffer, delay in seconds, playback rate, gain, x, y, z, low-pass in Hz, bus, and
 * flags (mixer.ts: FLAT, not placed; LOOP, plays until stopped).
 */
export const START_FIELDS = 11;
/** The buses a voice goes through, each with its own volume: effects, ambience, music, the interface. */
export const BUSES = 4;
/** Numbers per voice in `moves`: voice, gain, x, y, z, low-pass in Hz. */
export const MOVE_FIELDS = 6;

/**
 * Seconds a volume takes to move, which the device eases it over (planning/workstreams/sound-engine.md, "Every level
 * eased"): up from silence, as when the page is unmuted or the world's sounds are first heard; down to it, as when muted;
 * between two heard levels, as a slider moves; and down to silence when the world is gone, as when a session ends.
 */
export const UNMUTE_SECONDS = 1.5;
export const MUTE_SECONDS = 0.3;
export const SLIDER_SECONDS = 0.1;
export const SESSION_END_SECONDS = 1;
/** Seconds the device takes to bring the world's sounds down when the tab is hidden, before its context is suspended, and back up when it is shown. */
export const HIDE_SECONDS = 0.25;
export const SHOW_SECONDS = 0.6;

/** The seconds a volume takes from `was` to `to`. */
export function volumeSeconds(was: number, to: number): number {
  return was <= 0 && to > 0 ? UNMUTE_SECONDS : to <= 0 ? MUTE_SECONDS : SLIDER_SECONDS;
}

export class SoundPacket {
  /** Takes to hold, each a buffer number, mono samples from -1 to 1, and samples a second. */
  readonly loads: { buffer: number; samples: Float32Array; rate: number }[] = [];
  /** Buffer numbers to let go. A voice playing one plays on to its end. */
  readonly unloads: number[] = [];
  /** Positions are metres from the ear, in the world's axes. A voice is in `moves` only in a frame it changed enough to hear. */
  readonly starts: number[] = [];
  readonly moves: number[] = [];
  /** Voices to stop, each faded out over a few milliseconds. */
  readonly stops: number[] = [];
  /** The ear's facing and its up, unit vectors in the world's axes. Its right is facing cross up. */
  readonly ear = [0, 0, 1, 0, 1, 0];
  /** Gain over everything. A device starts silent, and so does this, so the first volumes rise from silence. */
  volume = 0;
  /** Gain of each bus, under `volume`. */
  readonly buses = [0, 0, 0, 0];
  /** Seconds `volume` and each bus took to reach what it is, from its last change (volumeSeconds). */
  volumeSeconds = UNMUTE_SECONDS;
  readonly busSeconds = [UNMUTE_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS];
  /** Whether `volume` or `buses` changed since the last packet, and whether `ear` did. */
  mixed = true;
  turned = true;
  /** The music to play (music.ts): a track and its layers' gains, or null for no music system. */
  music: MusicPlan | null = null;

  /** The volume over everything and each bus's, `buses` in bus order, with the seconds each takes to reach it. */
  mix(volume: number, buses: readonly number[]): void {
    this.mixed = false;
    if (volume !== this.volume) {
      this.mixed = true;
      this.volumeSeconds = volumeSeconds(this.volume, volume);
      this.volume = volume;
    }
    for (let k = 0; k < BUSES; k++) {
      if (buses[k] === this.buses[k]) continue;
      this.mixed = true;
      this.busSeconds[k] = volumeSeconds(this.buses[k]!, buses[k]!);
      this.buses[k] = buses[k]!;
    }
  }

  /** Silence over everything as the world goes, as when a session ends. */
  fallSilent(): void {
    this.mixed = true;
    this.volumeSeconds = SESSION_END_SECONDS;
    this.volume = 0;
  }

  clear(): void {
    this.loads.length = 0;
    this.unloads.length = 0;
    this.starts.length = 0;
    this.moves.length = 0;
    this.stops.length = 0;
  }
}

/** What plays sounds: client/sound in a browser. A headless client has none, and then no sound work is done at all. */
export interface SoundSink {
  /** False until the device plays. A browser plays nothing before the viewer has touched the page, so no voice starts before then. */
  readonly running: boolean;
  apply(p: SoundPacket): void;
}
