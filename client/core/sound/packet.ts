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

export class SoundPacket {
  /** Takes to hold, each a buffer number, mono samples from -1 to 1, and samples a second. */
  readonly loads: { buffer: number; samples: Float32Array; rate: number }[] = [];
  /** Buffer numbers to let go. A voice playing one plays on to its end. */
  readonly unloads: number[] = [];
  /** Positions are metres from the ear, in the world's axes. */
  readonly starts: number[] = [];
  readonly moves: number[] = [];
  /** Voices to stop, each faded out over a few milliseconds. */
  readonly stops: number[] = [];
  /** The ear's facing and its up, unit vectors in the world's axes. Its right is facing cross up. */
  readonly ear = [0, 0, 1, 0, 1, 0];
  /** Gain over everything. */
  volume = 1;
  /** Gain of each bus, under `volume`. */
  readonly buses = [1, 1, 1, 1];
  /** The music to play (music.ts): a track and its layers' gains, or null for no music system. */
  music: MusicPlan | null = null;

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
