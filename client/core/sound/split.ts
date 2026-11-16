// One asset port shared by the asset library and the sound library. Each asks and cancels by its own slots; sounds use
// slots from SOUND_SLOT up, and each side takes only what came for its own.

import type { AssetArrival, AssetPart, AssetPort, AssetRequest } from "../assets/port.ts";

export const SOUND_SLOT = 1 << 28;

class Side implements AssetPort {
  readonly inbox: AssetArrival[] = [];
  private readonly split: SplitPort;

  constructor(split: SplitPort) {
    this.split = split;
  }

  get cache(): AssetPort["cache"] {
    return this.split.port.cache;
  }

  get protocol(): string {
    return this.split.port.protocol;
  }

  request(r: AssetRequest): void {
    this.split.port.request(r);
  }

  cancel(slot: number): void {
    this.split.port.cancel(slot);
  }

  fill(parts: readonly { file: number; part: AssetPart }[]): void {
    this.split.port.fill(parts);
  }

  take(out: AssetArrival[]): number {
    this.split.pull();
    const n = this.inbox.length;
    for (let i = 0; i < n; i++) out[i] = this.inbox[i]!;
    this.inbox.length = 0;
    return n;
  }
}

export class SplitPort {
  readonly port: AssetPort;
  readonly assets: AssetPort;
  readonly sounds: AssetPort;
  private readonly got: AssetArrival[] = [];

  constructor(port: AssetPort) {
    this.port = port;
    this.assets = new Side(this);
    this.sounds = new Side(this);
  }

  /** Moves what has arrived to the side it is for. */
  pull(): void {
    const n = this.port.take(this.got);
    for (let i = 0; i < n; i++) {
      const a = this.got[i]!;
      ((a.slot >= SOUND_SLOT ? this.sounds : this.assets) as Side).inbox.push(a);
    }
    this.got.length = 0;
  }
}
