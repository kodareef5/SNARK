// The creatures a fight's ticks were timed under: how many were awake and how many were stepped, the median over the timed
// ticks. A tick's time can then be read against its load, which grows as players walk into populated land.

import type { Host } from "../../server/host.ts";

type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const median = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

export class CreatureLoad {
  private readonly host: Host;
  private readonly awake: number[] = [];
  private readonly stepped: number[] = [];

  constructor(host: Host) {
    this.host = host;
  }

  /** Call after each timed tick. */
  sample(): void {
    this.awake.push(this.host.creatures.awakeCount);
    this.stepped.push(this.host.creatures.stepped);
  }

  reset(): void {
    this.awake.length = 0;
    this.stepped.length = 0;
  }

  /** Records the two medians since the last reset, and resets. */
  rows(record: Row): void {
    record("creatures awake on a timed tick, median", median(this.awake), "");
    record("creatures stepped on a timed tick, median", median(this.stepped), "");
    this.reset();
  }
}
