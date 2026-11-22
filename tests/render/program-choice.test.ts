// The program a draw is drawn with is the first row of CHOICE it fits (client/core/render/programs.ts). The rows took
// the place of a branch for each program, which is written out here to hold them to it.
import { expect, test } from "bun:test";
import { HAND_FAR, HAND_NEAR } from "../../client/core/render/hand.ts";
import { DRAW_BENT, DRAW_BLEND, DRAW_CUTOUT, DRAW_EMISSIVE, DRAW_GROUND, DRAW_HEAT_SHIFT, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_PULLED, DRAW_RANGED, DRAW_SIZED, DRAW_SKINNED, DRAW_SKYLINE, DRAW_TEXTURED, DRAW_TWO_SIDED, DRAW_WATER, FramePacket, WATER_MARK_COUNT } from "../../client/core/render/packet.ts";
import { CHOICE, HAS_SPLIT, IS_LAYERED, PROGRAM, PROGRAMS, drawProgram } from "../../client/core/render/programs.ts";
import type { PackMaterial } from "../../shared/pack/pack.ts";

/** The choice as the branches made it. */
function branches(p: FramePacket, d: number, material: PackMaterial | undefined): number {
  const flags = p.drawFlags[d]!;
  if ((flags & DRAW_EMISSIVE) !== 0 && (flags & DRAW_TEXTURED) === 0) return PROGRAM.signal;
  if (flags & DRAW_SKYLINE) return PROGRAM.skyline;
  const hand = p.drawHand[d]!;
  if ((flags & DRAW_TEXTURED) !== 0) {
    if (p.drawLayer[d]! > 0) return PROGRAM.surfaceLayer;
    const dyed = !material || material.mask >= 0 || material.mask2 >= 0;
    const drops = hand !== 0 || p.drawSwap[d] !== 0 || (flags & DRAW_CUTOUT) !== 0;
    return [PROGRAM.surfaceUndyedWhole, PROGRAM.surfaceUndyed, PROGRAM.surfaceWhole, PROGRAM.surface][(dyed ? 2 : 0) + (drops ? 1 : 0)]!;
  }
  if ((flags & DRAW_PULLED) !== 0) return PROGRAM.pulled;
  if (p.drawFade[d] !== 0 || hand !== 0) return PROGRAM.far;
  if ((flags & DRAW_WATER) !== 0) return p.frame[WATER_MARK_COUNT]! > 0 ? PROGRAM.waterWake : PROGRAM.water;
  return (flags & DRAW_BLEND) !== 0 && p.split > 0 ? PROGRAM.seeThrough : PROGRAM.flat;
}

test("the rows pick the program the branches picked, for every mix of what picks one", () => {
  const picking = [DRAW_BLEND, DRAW_TEXTURED, DRAW_CUTOUT, DRAW_WATER, DRAW_PULLED, DRAW_EMISSIVE, DRAW_SKYLINE];
  // Every flag that picks nothing, which a draw may have or not.
  const rest = DRAW_SKINNED | DRAW_PLAIN | DRAW_NEAR | DRAW_ONE_BONE | DRAW_TWO_SIDED | DRAW_SIZED | DRAW_RANGED | DRAW_GROUND | DRAW_BENT | (3 << DRAW_HEAT_SHIFT);
  const material = (mask: number, mask2: number): PackMaterial => ({ mask, mask2 }) as PackMaterial;
  const materials = [undefined, material(-1, -1), material(4, -1), material(-1, 7)];
  const p = new FramePacket(), wrong: string[] = [], seen = new Set<number>();
  let mixes = 0;
  for (let bits = 0; bits < 1 << picking.length; bits++) {
    const flags = picking.reduce((f, flag, k) => (bits & (1 << k) ? f | flag : f), 0);
    for (const more of [0, rest]) for (const layer of [0, 3]) for (const hand of [0, HAND_NEAR, HAND_FAR]) for (const swap of [0, 0.5, -0.5]) for (const fade of [0, 300]) {
      for (const wakes of [0, 2]) for (const split of [0, 80]) for (const m of materials) {
        p.drawFlags[1] = flags | more;
        p.drawLayer[1] = layer;
        p.drawHand[1] = hand;
        p.drawSwap[1] = swap;
        p.drawFade[1] = fade;
        p.frame[WATER_MARK_COUNT] = wakes;
        p.split = split;
        const was = branches(p, 1, m), is = drawProgram(p, 1, m);
        if (was !== is && wrong.length < 5) wrong.push(`flags ${flags | more} layer ${layer} hand ${hand} swap ${swap} fade ${fade} wakes ${wakes} split ${split}: ${is}, was ${was}`);
        seen.add(is);
        mixes++;
      }
    }
  }
  expect(wrong).toEqual([]);
  expect(mixes).toBe(128 * 2 * 2 * 3 * 3 * 2 * 2 * 2 * 4);
  // Each row is some draw's program, and no fact shares a bit with a flag.
  expect([...seen].sort((a, b) => a - b)).toEqual([...new Set(CHOICE.map((c) => c.program))].sort((a, b) => a - b));
  expect((picking.reduce((a, b) => a | b) | rest) < IS_LAYERED && HAS_SPLIT > 0).toBe(true);
});

test("the last row takes any draw, and every row names a program", () => {
  const last = CHOICE.at(-1)!;
  expect([last.program, last.all, last.any, last.none]).toEqual([PROGRAM.flat, 0, 0, 0]);
  for (const c of CHOICE) expect(Object.keys(PROGRAMS)[c.program]).toBeDefined();
});
