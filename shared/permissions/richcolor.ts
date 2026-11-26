// CrossChat's colour markup, `<RichColor Color="r, g, b, a">text</>`, read into runs and written back. Tags do not nest.

import type { TextRun } from "../net/chat.ts";

const OPEN = /<\s*richcolor\s+color\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'<>]*?))\s*>/iy;
const CLOSE = /<\s*\/\s*(?:richcolor\s*)?>/iy;
const HEX = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;

/** One channel of a Color attribute, or NaN. It may be written `R=1`, as Unreal writes a colour. */
function channel(part: string): number {
  const s = part.replace(/^\s*[rgba]\s*=/i, "").trim();
  return s === "" ? NaN : Number(s);
}

/**
 * The ink a Color attribute names as 0xRRGGBB, or -1 where it names none. Red, green and blue run from 0 to 1, or from 0 to
 * 255 where one of them is above 1. Alpha is read and left out. `#RRGGBB` is taken too.
 */
export function readInk(value: string): number {
  const v = value.trim();
  const hex = HEX.exec(v);
  if (hex) return parseInt(hex[1]!, 16);
  const parts = v.replace(/[()]/g, "").split(",");
  if (parts.length < 3 || parts.length > 4) return -1;
  const r = channel(parts[0]!), g = channel(parts[1]!), b = channel(parts[2]!);
  const a = parts.length === 4 ? channel(parts[3]!) : 1;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) return -1;
  const scale = r > 1 || g > 1 || b > 1 ? 1 : 255;
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n * scale)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/**
 * The runs a marked-up string shows. Text outside a tag has no ink; a tag left open colours the rest; anything that is not
 * a well-formed tag, a stray `</>` among them, is shown as written. A tag inside another ends it and starts its own colour.
 */
export function readRichColor(source: string): TextRun[] {
  const runs: TextRun[] = [];
  let ink = -1;
  let text = "";
  const flush = () => {
    if (text === "") return;
    const last = runs[runs.length - 1];
    if (last && (last.ink ?? -1) === ink) last.text += text;
    else runs.push(ink < 0 ? { text } : { text, ink });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      text += source.slice(i);
      break;
    }
    text += source.slice(i, lt);
    OPEN.lastIndex = lt;
    const open = OPEN.exec(source);
    if (open) {
      const named = readInk(open[1] ?? open[2] ?? open[3] ?? "");
      if (named >= 0) {
        flush();
        ink = named;
        i = OPEN.lastIndex;
        continue;
      }
    }
    if (ink >= 0) {
      CLOSE.lastIndex = lt;
      if (CLOSE.exec(source)) {
        flush();
        ink = -1;
        i = CLOSE.lastIndex;
        continue;
      }
    }
    text += "<";
    i = lt + 1;
  }
  flush();
  return runs;
}

/** The text a marked-up string shows, without its tags. */
export function stripRichColor(source: string): string {
  let text = "";
  for (const run of readRichColor(source)) text += run.text;
  return text;
}

/** A channel from 0 to 255 as a fraction with at most three places, which reads back as the same byte. */
function fraction(byte: number): string {
  return String(Math.round((byte / 255) * 1000) / 1000);
}

/** The markup for a text in an ink, or the text alone where there is no ink. The text is written as it is given. */
export function writeRichColor(text: string, ink?: number): string {
  if (ink === undefined || ink < 0) return text;
  const c = ink & 0xffffff;
  return `<RichColor Color="${fraction(c >> 16)}, ${fraction((c >> 8) & 0xff)}, ${fraction(c & 0xff)}, 1">${text}</>`;
}

/** The markup for a line of runs. */
export function writeRuns(runs: readonly TextRun[]): string {
  let out = "";
  for (const run of runs) out += writeRichColor(run.text, run.ink);
  return out;
}
