// Blocks for the ASTC decoder's test and for `bun run probe -- --textured`, which shows the same ones to a GPU.

import { astcBlockInfo, decodeAstcBlock } from "../../tools/pack/astc.ts";

const MODE_NAMES: Record<number, string> = { 0: "l", 1: "l offset", 4: "la", 5: "la offset", 6: "rgb scale", 8: "rgb", 9: "rgb offset", 10: "rgb scale a", 12: "rgba", 13: "rgba offset" };
const GRIDS = [[4, 4], [4, 3], [3, 4], [4, 2], [2, 4], [3, 3], [3, 2], [2, 3], [2, 2]] as const;

/** A seeded source of whole numbers below `n`. */
function dice(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.floor(((state >>> 0) / 4294967296) * n);
  };
}

export interface Sample {
  block: Uint8Array;
  /** Whether the format allows it, and what kind of block it is. */
  set: "built" | "invalid";
  row: string;
}

function describe(block: Uint8Array): string {
  const b = astcBlockInfo(block, 0);
  if (b.solid) return "solid";
  const names = b.modes.map((m) => MODE_NAMES[m] ?? "hdr");
  const mode = names.every((n) => n === names[0]) ? names[0]! : names.join(" + ");
  return `${b.partitions} part${b.partitions > 1 ? "s" : " "} ${mode}${b.secondPlane >= 0 ? ", two planes" : ""}`;
}

function setBits(block: Uint8Array, at: number, count: number, value: number): void {
  for (let i = 0; i < count; i++, at++) block[at >> 3] = (block[at >> 3]! & ~(1 << (at & 7))) | (((value >> i) & 1) << (at & 7));
}

/**
 * Blocks of random bits under a block mode, a partition count and endpoint modes that were chosen: `each` or so for
 * every grid, weight range, number of planes and number of partitions. Then some of random bits alone, and some
 * void-extent blocks, good and bad. Each comes with whether the format allows it.
 */
export function builtBlocks(seed: number, each: number): Sample[] {
  const below = dice(seed);
  const out: Sample[] = [];
  const add = (block: Uint8Array): void => {
    const b = astcBlockInfo(block, 0);
    if (b.valid) out.push({ block, set: "built", row: describe(block) });
    else out.push({ block, set: "invalid", row: b.partitions > 0 ? "a partition with an hdr mode" : block[0] === 0xfc && block[1]! & 1 ? "void-extent that is not allowed" : "block mode or bit counts not allowed" });
  };
  const ldr = [0, 1, 4, 5, 6, 8, 9, 10, 12, 13];
  for (let parts = 1; parts <= 4; parts++) {
    for (const [w, h] of GRIDS) {
      for (let range = 0; range < 12; range++) {
        for (let dual = 0; dual < 2; dual++) {
          for (let n = 0; n < (parts === 1 ? each * 2 : each * 3); n++) {
            const block = new Uint8Array(16).map(() => below(256));
            const r = (range % 6) + 2;
            const shape = w === 4 ? ((h - 2) << 5) | (r >> 1) : 0x100 | ((w - 2) << 7) | ((h - 2) << 5) | 0xc | (r >> 1);
            setBits(block, 0, 11, (dual << 10) | (range >= 6 ? 0x200 : 0) | shape | ((r & 1) << 4));
            setBits(block, 11, 2, parts - 1);
            // One mode for every partition two times in three, else a mode for each.
            if (parts === 1) setBits(block, 13, 4, ldr[below(10)]!);
            else if (n % 3 !== 0) setBits(block, 23, 6, ldr[below(10)]! << 2);
            else setBits(block, 23, 2, 1 + below(3));
            add(block);
          }
        }
      }
    }
  }
  for (let n = 0; n < each * 340; n++) {
    const block = new Uint8Array(16).map(() => below(256));
    if (n % 4 === 0) {
      // A void-extent block: sometimes with its reserved bits wrong, sometimes with an extent, which random bits rarely
      // make a legal one.
      block[0] = 0xfc;
      block[1] = (block[1]! & 0xf0) | (n % 16 === 0 ? below(16) : 0xd);
      if (n % 8 !== 0) block.fill(0xff, 2, 8), (block[1] = block[1]! | 0xf0);
    }
    add(block);
  }
  return out;
}

/** A sum over what our decoder makes of some blocks, in both formats. */
export function decodedSum(samples: Sample[]): string {
  const out = new Uint8Array(64);
  let sum = 0x811c9dc5;
  for (const s of samples) {
    for (const srgb of [false, true]) {
      decodeAstcBlock(s.block, 0, srgb, out);
      for (let i = 0; i < 64; i++) sum = Math.imul(sum ^ out[i]!, 0x01000193);
    }
  }
  return (sum >>> 0).toString(16).padStart(8, "0");
}

/** The seed and count of the set the unit test pins. */
export const PINNED = { seed: 0x5eed0a57, each: 1 };
