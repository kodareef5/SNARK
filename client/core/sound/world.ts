// What the world sounds like where the ear is: a bed for the place and the time of day, the shore when the sea is near,
// wind high up, the muffled deep under water, the sea's or a lake's, and a short stinger as day breaks and as it ends. A
// map has no layer of biomes yet, so the place is read from what the client has: the sea round the ear makes a beach (or
// the open sea), many trees round it a jungle, and anywhere else grass. Beds fade into one another as the ear moves and
// the clock turns.

import { SUNRISE, SUNSET } from "../../../shared/sim/clock.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { seaHere } from "../../../shared/world/water.ts";

/** Metres round the ear the sea and the trees are looked for. */
const RING = 30;
const RING_POINTS = 12;
/** Trees within RING that make a jungle. */
const JUNGLE_TREES = 14;
/** Metres above the ground at which wind is heard, and blows hard. */
const WIND_LIGHT = 12;
const WIND_STRONG = 35;

const BIOMES = ["beach", "jungle", "grass"];
const BED = BIOMES.map((b) => [cueKey(`bed/${b}/day`), cueKey(`bed/${b}/night`)]);
const K = {
  sea: cueKey("bed/sea"),
  under: cueKey("underwater"),
  shore: cueKey("shore"),
  windLight: cueKey("wind/light"),
  windStrong: cueKey("wind/strong"),
  dawn: cueKey("stinger/dawn"),
  dusk: cueKey("stinger/dusk"),
};
/** Loop ids of world.ts's beds, for Sounds.loop. Each bed key is its own loop, so two can fade across. */
export const WORLD_LOOPS = 100;

export type Loop = (id: number, key: number, level: number, on: boolean) => void;

export class WorldSounds {
  private hour = -1;
  /** What the ear was last found to be near, kept a while so that a bed does not flicker at an edge. */
  biome = 2;
  /** What the music hears of the place: under water, night, and the open sea about the ear. */
  under = false;
  night = false;
  get openSea(): boolean {
    return this.sea >= 0.85;
  }
  private recheckMs = 0;
  private sea = 0;

  /** One frame at the ear (x, y, z), `hour` of the day; `trees(x, z, r)` counts trees within r metres. */
  update(nowMs: number, hf: Heightfield, x: number, y: number, z: number, hour: number, trees: (x: number, z: number, r: number) => number, loop: Loop, once: (key: number) => void): void {
    if (nowMs >= this.recheckMs) {
      this.recheckMs = nowMs + 1000;
      let wet = 0;
      for (let k = 0; k < RING_POINTS; k++) {
        const a = (k / RING_POINTS) * Math.PI * 2;
        const [sx, sz] = [x + Math.cos(a) * RING, z + Math.sin(a) * RING];
        if (hf.heightAt(sx, sz) < hf.seaLevel && seaHere(hf.water, sx, sz)) wet++;
      }
      this.sea = wet / RING_POINTS;
      this.biome = this.sea > 0 ? 0 : trees(x, z, RING) >= JUNGLE_TREES ? 1 : 2;
    }
    const under = y < hf.waterAt(x, z);
    this.under = under;
    this.night = hour < SUNRISE || hour >= SUNSET;
    const night = hour < SUNRISE || hour >= SUNSET ? 1 : 0;
    const openSea = this.sea >= 0.85;
    BED.forEach((pair, b) => pair.forEach((key, t) => loop(WORLD_LOOPS + b * 2 + t, key, 1, !under && !openSea && b === this.biome && t === night)));
    loop(WORLD_LOOPS + 10, K.sea, 1, !under && openSea);
    loop(WORLD_LOOPS + 11, K.under, 1, under);
    loop(WORLD_LOOPS + 12, K.shore, Math.min(1, this.sea * 3), !under && this.sea > 0 && !openSea);
    const above = y - Math.max(hf.heightAt(x, z), hf.waterAt(x, z));
    loop(WORLD_LOOPS + 13, K.windLight, Math.min(1, (above - WIND_LIGHT) / WIND_LIGHT), !under && above > WIND_LIGHT && above <= WIND_STRONG);
    loop(WORLD_LOOPS + 14, K.windStrong, 1, !under && above > WIND_STRONG);
    if (this.hour >= 0 && !under) {
      if (this.hour < SUNRISE && hour >= SUNRISE && hour < SUNRISE + 1) once(K.dawn);
      if (this.hour < SUNSET && hour >= SUNSET && hour < SUNSET + 1) once(K.dusk);
    }
    this.hour = hour;
  }
}
