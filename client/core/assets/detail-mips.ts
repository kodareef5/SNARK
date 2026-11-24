// The renderer owns the texture. These mips survive a lost context, including an answer that arrives during the loss.

import { mipOffset } from "../../../shared/pack/details.ts";

export interface DetailCard {
  upload(bytes: Uint8Array, first: number, end: number): void;
  sample(base: number, minimum: number): void;
}

export class DetailMips {
  private fine: Uint8Array | null = null;
  private asking = false;
  private retryAt = 0;
  private retryMs = 1000;
  private sharpening = -1;
  private complete = false;

  private readonly side: number;
  private readonly first: number;
  private readonly boot: Uint8Array;
  private readonly read?: () => Promise<Uint8Array>;

  constructor(side: number, first: number, boot: Uint8Array, read?: () => Promise<Uint8Array>) {
    this.side = side;
    this.first = first;
    this.boot = boot;
    this.read = read;
  }

  restore(card: DetailCard): void {
    card.upload(this.boot, this.first, Math.log2(this.side) + 1);
    if (this.fine) card.upload(this.fine, 0, this.first);
    this.complete = !!this.fine || this.first === 0;
    this.sharpening = -1;
    card.sample(this.complete ? 0 : this.first, 0);
  }

  /** The first draw uses the boot mips. Fine detail comes into focus over a quarter second. */
  afterDraw(card: DetailCard, now: number): void {
    if (this.complete) return;
    if (!this.fine) {
      if (!this.read || this.asking || now < this.retryAt) return;
      this.asking = true;
      void this.read().then(bytes => {
        if (bytes.length !== mipOffset(this.side, this.first)) throw new Error("incomplete details atlas");
        this.fine = bytes;
      }).catch(() => {
        this.retryAt = now + this.retryMs;
        this.retryMs = Math.min(30000, 2 * this.retryMs);
      }).finally(() => { this.asking = false; });
      return;
    }
    if (this.sharpening < 0) {
      card.upload(this.fine, 0, this.first);
      this.sharpening = now;
    }
    const minimum = this.first * Math.max(0, 1 - (now - this.sharpening) / 250);
    card.sample(0, minimum);
    this.complete = minimum === 0;
  }
}
