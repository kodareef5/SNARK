// The prints on garments (shared/people/doc.ts EditionPrint), as a frame draws them: each print a layer of the prints'
// array on the card (picture-layers.ts), its place a row of the prints' table, and the layer's number in the third region
// byte of each wearer's instance, so every wearer of a cut is still one draw a level (print-term.ts draws it). A wearer
// drawn at a flat level shows the print's swatch there instead, the palette colour nearest its picture's mean. The array
// is made at the tier's size the first frame a print is wanted, and let go PRINTS_IDLE after the last. A picture goes to
// the card PRINTS_A_FRAME at a time; under the governor's step the prints are their swatches and nothing is uploaded.

import type { EditionPrint } from "../../../shared/people/doc.ts";
import { printPath } from "../../../shared/people/doc.ts";
import { nearestColour } from "../../../shared/pack/palette.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import type { Tier } from "../assets/tiers.ts";
import { PRINTS_DRAWN } from "../governor.ts";
import { DRAW_PRINTED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "./packet.ts";
import type { Frame, Pass } from "./pass.ts";
import { PictureLayers, PictureLoads, type PictureHost } from "./picture-layers.ts";
import { LATE } from "./programs.ts";
import { MAX_PRINT_LAYERS, PRINT_FLOATS, printRow } from "./print-term.ts";

/** What the page makes of a print's picture: what the card is given, and its mean colour as light, premultiplied, and its cover. */
export interface PrintMade {
  readonly source: unknown;
  readonly mean: readonly number[];
}
export type PrintHost = PictureHost<PrintMade>;

/** Pictures put on the card a frame. */
export const PRINTS_A_FRAME = 1;
/** Pictures fetched at once; seconds after which one that has not come is given up, or one that failed is asked for again. */
export const PRINT_LOADS = 3;
export const PRINT_GIVES_UP = 15;
export const PRINT_FAILED_WAIT = 30;
/** Seconds with no print wanted after which the array is let go. */
export const PRINTS_IDLE = 30;
/** The instance byte that carries a print's layer, one more than the layer, 0 for none: the third region's. */
export const PRINT_REGION = 2;

/** Bytes a layer of `side` texels takes on the card with all its levels. */
export const printLayerBytes = (side: number): number => (side > 0 ? Math.round((side * side * 4 * (1 - 4 ** -(Math.log2(side) + 1)) * 4) / 3) : 0);

/** A print's key, its picture and where it lies, so two editions alike share a layer; and its picture's path. Made once a print. */
const named = new WeakMap<EditionPrint, { readonly key: string; readonly path: string }>();
function nameOf(print: EditionPrint): { readonly key: string; readonly path: string } {
  let n = named.get(print);
  if (n === undefined) {
    const { u, v, w, h, scale, turn } = print.place;
    named.set(print, (n = { key: `${print.hash} ${u} ${v} ${w} ${h} ${scale} ${turn} ${print.width}x${print.height}`, path: printPath(print.hash) }));
  }
  return n;
}
export const printKey = (print: EditionPrint): string => nameOf(print).key;

/** A test's or a tool's prints on a mesh's draws until garments carry them: the meshes, and the print of each body by entity. */
export interface PrintsWorn {
  readonly meshes: readonly number[];
  of(entity: number): EditionPrint | null;
}

export class Prints implements Pass {
  readonly layers = new PictureLayers(PRINT_GIVES_UP * 1000);
  readonly loads = new PictureLoads<PrintMade>(this.layers, PRINT_LOADS, PRINT_FAILED_WAIT * 1000);
  /** What the frame's prints took, as the governor's PRINTS_DRAWN bit. */
  mask = 0;
  /** Pictures put on the card in all, and the most in one frame. */
  uploaded = 0;
  most = 0;
  /** Prints drawn until garments draw them (PrintsWorn), or null. */
  worn: PrintsWorn | null = null;
  private readonly palette: Uint8Array;
  /** By layer: the print it waits for or holds, and its swatch, a palette colour. */
  private readonly prints: (EditionPrint | null)[] = new Array<EditionPrint | null>(MAX_PRINT_LAYERS).fill(null);
  private readonly swatches = new Uint8Array(MAX_PRINT_LAYERS);
  private side = 0;
  private frame = 0;
  private now = 0;
  private wantedAt = -Infinity;

  constructor(palette: Uint8Array) {
    this.palette = palette;
  }

  set host(host: PrintHost | null) {
    this.loads.host = host;
  }

  get host(): PrintHost | null {
    return this.loads.host;
  }

  update(f: Frame): void {
    this.step(f.packet, f.tier, f.now);
    f.assets.residency.reserve("prints", f.packet.printLayers * printLayerBytes(f.packet.printSide));
  }

  /** A frame begins at `now` ms on `tier`: the array made or let go, what came put on the card. */
  step(p: FramePacket, tier: Tier, now: number): void {
    this.frame++;
    this.now = now;
    this.mask = 0;
    const t = tier.prints, on = t.layers > 0 && t.side > 0 && now - this.wantedAt < PRINTS_IDLE * 1000;
    const side = on ? t.side : 0, layers = on ? Math.min(t.layers, MAX_PRINT_LAYERS) : 0;
    if (side !== this.side || layers !== this.layers.size) {
      this.side = side;
      this.layers.resize(layers);
      this.loads.clear();
      this.prints.fill(null);
      p.printTable.fill(0);
      if (layers > 0) LATE.prints = true;
    }
    p.printSide = side;
    p.printLayers = layers;
    p.printSwatches = t.swatches === true;
    this.loads.sweep(this.frame, now);
    p.printUploads = 0;
    p.printSource = null;
    if (p.printSwatches) return;
    for (let c = this.loads.next(); c; c = p.printUploads < PRINTS_A_FRAME ? this.loads.next() : null) {
      const print = this.prints[c.layer];
      if (!print) continue;
      p.printLayer = c.layer;
      p.printSource = c.source.source;
      p.printUploads++;
      this.layers.filled(c.layer, Math.log2(side));
      const mean = c.source.mean;
      printRow(p.printTable, c.layer, print.place, print.height / Math.max(1, print.width), mean);
      // The swatch is the picture's colour where it is covered.
      const a = Math.max(mean[3]!, 1e-6), shown = (x: number): number => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)));
      this.swatches[c.layer] = nearestColour(this.palette, shown(mean[0]! / a), shown(mean[1]! / a), shown(mean[2]! / a));
      if (p.printUploads >= PRINTS_A_FRAME) break;
    }
    this.uploaded += p.printUploads;
    this.most = Math.max(this.most, p.printUploads);
  }

  /** The layer holding `print` this frame, asked for where none does; -1 until it has come, and -1 where no tier's array is. */
  want(print: EditionPrint): number {
    this.wantedAt = this.now;
    if (this.side === 0) return -1;
    const { key, path } = nameOf(print);
    const k = this.loads.want(key, path, this.side, this.side, this.frame, this.now);
    if (k >= 0) return k;
    const waiting = this.layers.find(key, this.frame);
    if (waiting >= 0) this.prints[waiting] = print;
    return -1;
  }

  /**
   * What a wearer's instance carries in its third region byte for `print`: on a textured level one more than its layer,
   * on a flat one its swatch, and 0 where it has none yet.
   */
  byteOf(print: EditionPrint | null, flat: boolean): number {
    if (!print) return 0;
    const k = this.want(print);
    if (k < 0) return 0;
    this.mask |= PRINTS_DRAWN;
    return flat ? this.swatches[k]! : k + 1;
  }

  /** A layer's swatch, a palette colour, or 0 where it holds no print. */
  swatch(layer: number): number {
    return this.layers.holds(layer) ? this.swatches[layer]! : 0;
  }

  /** After every other pass: the prints of PrintsWorn on the frame's draws of its meshes, each body's in its instance. */
  draw(f: Frame): void {
    const worn = this.worn, p = f.packet;
    if (!worn) return;
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawBuffer[d] !== TRANSIENT_BUFFER || !worn.meshes.includes(p.drawMesh[d]!)) continue;
      const textured = (p.drawFlags[d]! & DRAW_TEXTURED) !== 0, first = p.drawFirst[d]!, end = first + p.drawInstances[d]!;
      let any = false;
      for (let i = first; i < end && !any; i++) any = this.byteOf(worn.of(p.transientIds[i]!), !textured) > 0;
      // A draw where nobody has a print yet is left as it was; in one where some have, the rest name no layer.
      if (!any) continue;
      for (let i = first; i < end; i++) {
        const b = this.byteOf(worn.of(p.transientIds[i]!), !textured);
        if (textured || b > 0) p.transient[i * INSTANCE_BYTES + 14 + PRINT_REGION] = b;
      }
      if (textured) p.drawFlags[d]! |= DRAW_PRINTED;
    }
  }

  /** How many layers hold their prints. */
  get held(): number {
    let n = 0;
    for (let k = 0; k < this.layers.size; k++) if (this.layers.holds(k)) n++;
    return n;
  }
}

export { MAX_PRINT_LAYERS, PRINT_FLOATS };
