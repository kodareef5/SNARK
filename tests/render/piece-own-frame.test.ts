// A built piece reads its recipe material in its own frame (client/core/render/world-surfaces.ts made, PiecePixel): its
// sheets and rivets lie along its own axes at any yaw of its base and 30 degrees round in it, each piece by its own seed.
import { expect, test } from "bun:test";
import { surfaceIndex } from "../../content/surfaces.ts";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FACE_PLAIN, FACE_WEARS, FIT_CLASS_SHIFT, FIT_WALL, FrameTable, PIECE_FRAMED, PieceFit, pieceWord, writePiece } from "../../client/core/render/piece-fit.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { PIECE_ALLOY, PIECE_FIXED, PIECE_OVER_WEAR, PIECE_OWN, PIECE_PLAIN, PIECE_SEED, PIECE_SEEDS, pieceSeed, worldSurface, type PiecePixel, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { MADE_READS, materialIndex } from "../../client/core/texgen/layers.ts";
import { TWIN_SLOTS, madeTwin } from "../../client/core/texgen/materials.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { METAL, metalColours } from "../../tools/pack/pieces/metal.ts";

const city = [1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0];
const plate = materialIndex("plate"), steel = surfaceIndex(90, false), SHEET = MATERIAL_RECIPES[plate - 1]!.metres;
const flat: WorldSample = (role, _layer, _u, _v, _spread, out) => void out.set(role === 1 ? [128 / 255, 128 / 255, 1, 1] : [0.5, 0.5, 0.5, 0.5]);
const twin = madeTwin(128);
const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const colour = (i: number): number[] => [0, 1, 2].map((c) => linear(defaultPalette()[i * 4 + c]! / 255));
const DEG = 65536 / 360;
/** Where the walls stand: off every grid of the world's. */
const AT = [137.31, 12.47, 211.93] as const;

/** The cosine and sine a wall's vertices are turned by, in a base at `yaw` and `tw` twelfths of a turn round in it, as the draw has them. */
function turnOf(yaw: number, tw: number): { c: number; s: number } {
  const table = new FrameTable(), bytes = new Uint8Array(INSTANCE_BYTES), fit = new PieceFit();
  writePiece(bytes, 0, pieceWord(table.add(yaw), yaw, tw), plate, PIECE_FRAMED, FIT_WALL << FIT_CLASS_SHIFT);
  fit.begin(table, bytes, 0);
  return { c: fit.c, s: fit.s };
}

/**
 * A wall's front at (x, y) metres of its own, as a client reads it: the world point the draw puts it at, the pixel's
 * place in the piece as the rasterizer finds it back, and the surface there. `own` false reads it in the world's metres.
 */
function front(turn: { c: number; s: number }, x: number, y: number, bits: number, own = true, dye = colour(90), footprint = 0.001): { albedo: number[]; rough: number; lean: number[] } {
  const { c, s } = turn, z = 0.06, n = c * c + s * s;
  const wx = AT[0] + c * x + s * z, wy = AT[1] + y, wz = AT[2] + c * z - s * x;
  const dx = wx - AT[0], dz = wz - AT[2];
  const piece: PiecePixel = { x: (c * dx - s * dz) / n, y: wy - AT[1], z: (s * dx + c * dz) / n, c, s, bits };
  const albedo = new Float64Array(3), orm = new Float64Array(3), normal = new Float64Array(3), l = Math.sqrt(n);
  worldSurface(albedo, orm, normal, dye, steel, wx, wy, wz, s / l, 0, c / l, footprint, city, flat, false, null, null, 0, plate, TWIN_SLOTS, twin, own ? piece : null);
  // The normal's lean across the wall and up it, in the wall's own frame.
  return { albedo: [...albedo], rough: orm[1]!, lean: [(c * normal[0]! - s * normal[2]!) / l, normal[1]!] };
}

const SEED = 1234 << PIECE_SEED;
/** The roughness along a line parallel to the top rail, a texel of the card's apart. */
function line(turn: { c: number; s: number }, y: number, bits: number, own = true): number[] {
  const out: number[] = [];
  for (let x = -1.3; x <= 1.3; x += SHEET / 512) out.push(front(turn, x, y, bits, own).rough);
  return out;
}
const worst = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
/** The texels `b` must be moved along the line to lie on `a` best, within 40 either way. */
function shift(a: number[], b: number[]): number {
  let best = 0, least = Infinity;
  for (let d = -40; d <= 40; d++) {
    let sum = 0;
    for (let i = 40; i < a.length - 40; i++) sum += (a[i]! - b[i + d]!) ** 2;
    if (sum < least) [best, least] = [d, sum];
  }
  return best;
}

test("a wall's sheets and rivets lie the same along its top rail at base yaws 0, 17 and 45 degrees and 30 degrees round in its base", () => {
  const square = turnOf(0, 0);
  for (const y of [1.2, 0.3]) {
    const want = line(square, y, PIECE_OWN | SEED);
    // The line crosses rivets and joints: it is no flat stretch.
    expect(Math.max(...want) - Math.min(...want)).toBeGreaterThan(0.03);
    for (const [deg, tw] of [[17, 0], [45, 0], [17, 1], [303.7, 2]] as const) {
      const got = line(turnOf(Math.round(deg * DEG), tw), y, PIECE_OWN | SEED);
      expect([deg, tw, y, shift(want, got), worst(want, got) < 1e-6]).toEqual([deg, tw, y, 0, true]);
    }
    // Read in the world's metres, as a city's wall is, the same wall at 17 degrees is another pattern.
    expect(worst(want, line(turnOf(Math.round(17 * DEG), 0), y, PIECE_OWN | SEED, false))).toBeGreaterThan(0.03);
  }
});

test("a joint lies on every 0.75 m from a piece's origin whatever its seed, and the lean of a rivet turns with the piece", () => {
  const turned = turnOf(Math.round(17 * DEG), 1), square = turnOf(0, 0);
  for (const seed of [0, 1, 77, 1234, 4095]) {
    const bits = PIECE_OWN | (seed << PIECE_SEED);
    // A joint is struck back and rough; a hand to either side of it the sheet is not.
    for (const x of [-0.75, 0, 0.75]) expect([seed, x, front(turned, x, 0.3, bits).rough - Math.max(front(turned, x - 0.2, 0.3, bits).rough, front(turned, x + 0.2, 0.3, bits).rough) > 0.02]).toEqual([seed, x, true]);
    for (const y of [-0.75, 0.75]) expect([seed, y, front(turned, 0.33, y, bits).rough - front(turned, 0.33, y + 0.2, bits).rough > 0.02]).toEqual([seed, y, true]);
  }
  let leans = 0;
  for (let k = 0; k < 400; k++) {
    const x = ((k * 0.6180339) % 1) * 2.6 - 1.3, y = ((k * 0.7548776) % 1) * 2.6 - 1.3, a = front(square, x, y, PIECE_OWN | SEED).lean, b = front(turned, x, y, PIECE_OWN | SEED).lean;
    // A basis is a few parts in ten thousand off a metre long, and the lean with it.
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeLessThan(1e-3);
    leans = Math.max(leans, Math.hypot(a[0]!, a[1]!));
  }
  expect(leans).toBeGreaterThan(0.1);
});

test("no two pieces wear alike: sheets differ by seed in tone and rust, and a seed is its instance's own floats", () => {
  const turn = turnOf(Math.round(17 * DEG), 0), tones = new Set<string>();
  let rusted = 0;
  for (let seed = 0; seed < 512; seed += 5) {
    const a = front(turn, 0.36, 0.41, PIECE_OWN | (seed << PIECE_SEED)).albedo;
    tones.add(a[1]!.toFixed(3));
    // Up from a sheet's foot, on some sheets and not on most.
    const foot = front(turn, 0.36, 0.775, PIECE_OWN | ((seed * 8) << PIECE_SEED)).albedo;
    if (foot[0]! > 1.6 * foot[2]!) rusted++;
  }
  expect(tones.size).toBeGreaterThan(20);
  expect(rusted > 4 && rusted < 45).toBe(true);
  const bits = (v: number): number => new Uint32Array(new Float32Array([v]).buffer)[0]!;
  const seeds = new Set<number>();
  for (let i = 0; i < 200; i++) seeds.add(pieceSeed(bits(1.5 + 3 * (i % 20)), bits(2.25 + 3 * Math.floor(i / 100)), bits(1.5 + 3 * (Math.floor(i / 20) % 5))));
  expect(seeds.size).toBeGreaterThan(190);
  expect(Math.max(...seeds)).toBeLessThan(PIECE_SEEDS);
});

test("frame and plate are two tones of one material: each face is dyed whole by its own colour, near and far", () => {
  const tone = metalColours(), turn = turnOf(Math.round(17 * DEG), 0), palette = defaultPalette();
  const frame = tone("frame"), framed = PIECE_OWN | PIECE_FIXED | SEED, lit = (a: number[]): number => a[0]! + a[1]! + a[2]!;
  expect([palette[frame * 4], palette[frame * 4 + 1], palette[frame * 4 + 2]]).toEqual([...METAL.tones.frame!]);
  for (const footprint of [0.001, 1]) {
    let plates = 0, frames = 0, blue = 0;
    for (let k = 0; k < 200; k++) {
      const x = ((k * 0.6180339) % 1) * 2.6 - 1.3, y = ((k * 0.7548776) % 1) * 0.5 + 0.1;
      plates += lit(front(turn, x, y, PIECE_OWN | SEED, true, colour(90), footprint).albedo);
      const f = front(turn, x, y, framed, true, colour(frame), footprint).albedo;
      frames += lit(f);
      blue += f[2]! / f[0]!;
    }
    // The plate is more than twice as light as the frame, which is the bluer.
    expect(plates / frames).toBeGreaterThan(2.2);
    expect(blue / 200).toBeGreaterThan(1.1);
  }
  // A face that keeps clear of joints shows none: along a line across a joint it is as even as the sheet's middle.
  const plain = PIECE_OWN | PIECE_PLAIN | PIECE_FIXED | SEED;
  let most = 0, least = Infinity;
  for (let x = -1.3; x <= 1.3; x += 0.004) {
    const r = front(turn, x, 0.3, plain).rough;
    [most, least] = [Math.max(most, r), Math.min(least, r)];
  }
  expect(most - least).toBeLessThan(0.02);
  // The share of the tile such a face is folded into clears the rivets' rows and their rings.
  const r = MATERIAL_RECIPES[plate - 1]!;
  expect((1 - MADE_READS[plate - 1]!.plain) / 2).toBeGreaterThanOrEqual((r.rivet!.inset + 1.8 * r.rivet!.radius) / r.metres);
});

test("the lit program gives a piece's pixel its own frame, turn, seed and face bits; a city static's read is as it was", () => {
  for (const name of ["medium", "high", "ultra"] as const) {
    const p = PROGRAMS.flat!(tierOf(name), "bc");
    expect(p.vertex).toContain(`bool alloy = field && (aBone & ${FACE_PLAIN}u) != 0u`);
    expect(p.vertex).toContain(`(plain ? ${PIECE_PLAIN << PIECE_OVER_WEAR}u : 0u) | (alloy ? ${PIECE_ALLOY << PIECE_OVER_WEAR}u : 0u)`);
    expect(p.vertex).toContain(`(region || inlay ? 0u : ${PIECE_FIXED << PIECE_OVER_WEAR}u) | ((h >> 20u) << ${PIECE_OVER_WEAR + PIECE_SEED}u)`);
    expect(p.vertex).toContain("pieceFit(tl, ts, tc);\n    vPlace = vec2(tc, ts);");
    expect(p.fragment).toContain(`worldPiece = vMade >> ${PIECE_OVER_WEAR};`);
    expect(p.fragment).toContain("if (worldPiece > 0) worldTurn = vPlace;");
    // The world's metres for all but a piece: the same lines, fed the piece's own place only where its bit is set.
    expect(p.fragment).toContain("vec2 q = axis == 1 ? rel.xz / m + ph.xz : axis == 0 ? vec2(rel.z / m + ph.z, -rel.y / m - ph.y) : vec2(rel.x / m + ph.x, -rel.y / m - ph.y);");
    expect(p.fragment).toContain("bool turn = axis == 1 && abs(face.x) > abs(face.z), own = (worldPiece & 1) != 0;");
  }
  // A face that wears its piece's material in a colour of its mesh's takes the piece's finish on every lit tier.
  const touch = { ...tierOf("medium"), finish: "light" as const };
  for (const p of [PROGRAMS.flat!(tierOf("high"), "bc"), PROGRAMS.flat!(touch, "astc")]) expect(p.vertex).toContain(`vSurface = SURFACE_IDS[int(uPiece > 0.5 && (aBone & ${FACE_WEARS}u) != 0u ? iRegA.x : i)];`);
  expect(PROGRAMS.flat!(tierOf("lowpoly"), "bc").vertex).not.toContain("vSurface");
});
