// Camera-relative detail cards attached to a drawn vehicle. The scene reserves their slots before writing particles.
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_FLOATS, type FramePacket } from "./packet.ts";

export class VehicleCards {
  count = 0;
  protected readonly cards: Float32Array;
  protected readonly words: Uint32Array;
  private readonly order: Uint16Array;

  constructor(capacity: number) {
    this.cards = new Float32Array(capacity * DETAIL_FLOATS);
    this.words = new Uint32Array(this.cards.buffer);
    this.order = new Uint16Array(capacity);
  }

  begin(): void { this.count = 0; }

  /** Caller has checked its budget. The returned offset is in floats/words. */
  protected next(): number {
    const n = this.count++;
    this.order[n] = n;
    return n * DETAIL_FLOATS;
  }

  /** The caller reserves `count` entries before cosmetic particles; cards are kept far to near. */
  write(p: FramePacket): void {
    if (this.count === 0) return;
    const cards = this.cards, order = this.order.subarray(0, this.count);
    const distance = (i: number) => { const o = i * DETAIL_FLOATS; return cards[o]! ** 2 + cards[o + 1]! ** 2 + cards[o + 2]! ** 2; };
    order.sort((a, b) => distance(b) - distance(a));
    // As words, so that every bit of the colours is kept.
    for (const n of order) {
      const from = n * DETAIL_FLOATS, to = p.detailCount++ * DETAIL_FLOATS;
      for (let f = 0; f < DETAIL_FLOATS; f++) p.detailWords[to + f] = this.words[from + f]!;
    }
  }

  /** Cards can be seen past the near depth range, including a card straddling the split. */
  passes(cam: Camera): number {
    let from = Infinity, to = -Infinity;
    for (let n = 0; n < this.count; n++) {
      const o = n * DETAIL_FLOATS, f = this.cards;
      const d = cam.depth(f[o]!, f[o + 1]!, f[o + 2]!);
      const reach = Math.abs(cam.depth(f[o + DETAIL.along]!, f[o + DETAIL.along + 1]!, f[o + DETAIL.along + 2]!)) + Math.abs(cam.depth(f[o + DETAIL.across]!, f[o + DETAIL.across + 1]!, f[o + DETAIL.across + 2]!));
      from = Math.min(from, d - reach); to = Math.max(to, d + reach);
    }
    return cam.passesOf(from, to);
  }
}
