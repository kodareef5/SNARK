// Prints on garments without a page (client/core/render/prints.ts): pictures made in code, premultiplied as the page
// decodes them, a host that serves them at once or when told, and a print laid on the scene fixture's tube.

import type { EditionPrint } from "../../shared/people/doc.ts";
import { printMean } from "../../client/core/render/print-term.ts";
import type { PrintHost, PrintMade } from "../../client/core/render/prints.ts";

/**
 * Picture `k` at `side` texels a side, RGBA premultiplied sRGB, as a layer holds it: a disc of a colour of its own on
 * nothing, half-covered at its rim, with a dark bar across and a white quarter, so where it lies and which way up shows.
 */
export function printBytes(side: number, k = 0): Uint8Array {
  const out = new Uint8Array(side * side * 4);
  const hue = (k * 0.618034) % 1, colour = [0, 1, 2].map((c) => Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue + c / 3)))));
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const dx = (x + 0.5) / side - 0.5, dy = (y + 0.5) / side - 0.5, r = Math.hypot(dx, dy);
    if (r > 0.48) continue;
    const a = r > 0.42 ? 128 : 255;
    const c = Math.abs(dy) < 0.06 ? [20, 20, 30] : dx > 0 && dy < 0 ? [250, 250, 250] : colour;
    out.set([Math.round((c[0]! * a) / 255), Math.round((c[1]! * a) / 255), Math.round((c[2]! * a) / 255), a], (y * side + x) * 4);
  }
  return out;
}

/** Print `k` of a hash of its own, at `place`. */
export function testPrint(k: number, place: EditionPrint["place"], width = 256, height = 256): EditionPrint {
  return { hash: (0xab000000 + k).toString(16).padStart(16, "0"), width, height, place };
}

/** Where a print lies on the tube's sheet: all round its dyed hide, a little turned, so some of it faces any way. */
export const TUBE_PLACE: EditionPrint["place"] = { u: 0, v: 0.3, w: 1, h: 0.65, scale: 1, turn: 0.2 };

/** A host whose pictures come at once, or, with `held`, when `release` is called; it counts what it was asked. */
export function testPrintHost(held = false): PrintHost & { asked: string[]; dropped: string[]; fail: Set<string>; release(): void } {
  const waiting: (() => void)[] = [];
  const host = {
    asked: [] as string[],
    dropped: [] as string[],
    fail: new Set<string>(),
    image(path: string, width: number): Promise<PrintMade> {
      host.asked.push(path);
      const k = parseInt(/print\.([0-9a-f]{16})\.png/.exec(path)?.[1] ?? "0", 16) & 0xffff;
      const made = (): PrintMade => {
        const source = printBytes(width, k);
        return { source, mean: [...printMean(source)] };
      };
      if (host.fail.has(path)) return Promise.reject(new Error(`${path}: 404`));
      if (!held) return Promise.resolve(made());
      return new Promise((done) => waiting.push(() => done(made())));
    },
    drop(path: string): void {
      host.dropped.push(path);
    },
    release(): void {
      for (const go of waiting.splice(0)) go();
    },
  };
  return host;
}
