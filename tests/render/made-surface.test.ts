// A material made from a recipe as a surface reads it (client/core/render/world-surfaces.ts made) and as it reaches the
// card: a near chunk's piece's state, an instance's last two regions, and the lit program's text.
import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { RUIN_FINISHES, ruinKind } from "../../content/ruins.ts";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { NearMaking } from "../../client/core/render/nearcity.ts";
import { PIECE_KEYS, PIECE_MADE, pieceMade } from "../../client/core/render/pieces.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { MADE_MARK, SPALL_PALETTE, coatLost, madeFar, madeShift, worldSurface, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { TWIN_SLOTS, madeTwin, materialHeight, materialRows } from "../../client/core/texgen/materials.ts";
import { MADE_FLOATS, materialIndex } from "../../client/core/texgen/layers.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { CityStatics, mergedPart } from "../../shared/world/city.ts";
import { flatMap } from "../fixtures/map.ts";
import { nearClient } from "../fixtures/nearclient.ts";
import { coreRegistry } from "../fixtures/world.ts";

const city = [1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0], rose = [0.8, 0.45, 0.4];
const plaster = surfaceIndex(RUIN_FINISHES.rose.color, false);
/** A painted finish read as mid grey everywhere, so that what a made material adds is what differs. */
const flat: WorldSample = (role, _layer, _u, _v, _spread, out) => void out.set(role === 1 ? [128 / 255, 128 / 255, 1, 1] : [0.5, 0.5, 0.5, 0.5]);
const twin = madeTwin(64);
/** A wall facing +z at (x, y), a pixel `footprint` metres wide, wearing material `k` as `slots` say. */
function wall(k: number, x: number, y: number, footprint: number, slots: ArrayLike<number> | null, early = 0, normal = [0, 0, 1]): { albedo: number[]; orm: number[]; n: number[] } {
  const albedo = new Float64Array(3), orm = new Float64Array(3), n = new Float64Array(3);
  worldSurface(albedo, orm, n, rose, plaster, x, y, 5, normal[0]!, normal[1]!, normal[2]!, footprint, city, flat, false, null, null, early, k, slots, slots ? twin : null);
  return { albedo: [...albedo], orm: [...orm], n: [...n] };
}

test("a material with no slot, not yet come up or far off is its finish's means, as a finish is before its maps come", () => {
  const stucco = materialIndex("stucco"), none = new Float32Array(TWIN_SLOTS.length).fill(-1).map((v, i) => (i % MADE_FLOATS === 1 ? 0 : v));
  const means = wall(0, 3.3, 1.7, 0.002, null, 2);
  expect(wall(stucco, 3.3, 1.7, 0.002, none)).toEqual(means);
  // Far off, a pixel an eighth of its tile wide, it is the same whatever the card holds.
  expect(wall(stucco, 3.3, 1.7, MATERIAL_RECIPES[stucco - 1]!.metres / 8, TWIN_SLOTS)).toEqual(means);
});

test("near, a held material shows its grain about its finish's mean, dyed by the piece's colour, and leans the light", () => {
  const stucco = materialIndex("stucco"), means = wall(0, 0, 0, 0.002, null, 2), sum = [0, 0, 0];
  let least = Infinity, most = 0, lean = 0;
  const half = new Float32Array(TWIN_SLOTS);
  half[(stucco - 1) * MADE_FLOATS + 1] = 0.5;
  for (let k = 0; k < 400; k++) {
    const x = ((k * 0.6180339) % 1) * 4, y = ((k * 0.7548776) % 1) * 4, w = wall(stucco, x, y, 0.002, TWIN_SLOTS);
    for (let c = 0; c < 3; c++) sum[c]! += w.albedo[c]! / 400;
    least = Math.min(least, w.albedo[1]!);
    most = Math.max(most, w.albedo[1]!);
    lean = Math.max(lean, Math.hypot(w.n[0]!, w.n[1]!));
    // Half come up, it is half way from its means.
    if (k < 20) expect(wall(stucco, x, y, 0.002, half).orm[1]!).toBeCloseTo((w.orm[1]! + wall(stucco, x, y, 0.002, null, 2).orm[1]!) / 2, 1);
  }
  // The macro tone and the patch's tone move a wall's light a few per cent over 4 m; the grain's mean is the finish's.
  for (let c = 0; c < 3; c++) expect(Math.abs(sum[c]! / means.albedo[c]! - 1)).toBeLessThan(0.12);
  expect(most / least).toBeGreaterThan(1.15);
  expect(lean).toBeGreaterThan(0.1);
  // Rose's red over its green, as the painted finish is dyed.
  expect(sum[0]! / sum[1]!).toBeCloseTo(means.albedo[0]! / means.albedo[1]!, 1);
});

test("tar and gravel lies on a face that looks up alone, about the mean of its colour's painted finish, asphalt", () => {
  const gravel = materialIndex("gravel"), asphalt = surfaceIndex(RUIN_FINISHES.tar.color, false);
  expect((SURFACE_NAMES as readonly string[])[asphalt]).toBe("asphalt");
  expect(wall(gravel, 1.1, 2.3, 0.002, TWIN_SLOTS)).toEqual(wall(0, 1.1, 2.3, 0.002, null));
  const at = (k: number, x: number, slots: ArrayLike<number> | null, early: number): number[] => {
    const albedo = new Float64Array(3), orm = new Float64Array(3), n = new Float64Array(3);
    worldSurface(albedo, orm, n, [0.1, 0.1, 0.1], asphalt, x, 9, x * 0.7, 0, 1, 0, 0.002, city, flat, false, null, null, early, k, slots, slots ? twin : null);
    return [...albedo];
  };
  let sum = 0, mean = 0;
  for (let k = 0; k < 400; k++) {
    sum += at(gravel, k * 0.137, TWIN_SLOTS, 0)[1]! / 400;
    mean += at(0, k * 0.137, null, 2)[1]! / 400;
  }
  expect(Math.abs(sum / mean - 1)).toBeLessThan(0.1);
});

test("a second copy, moved by whole courses and ribs, shows in patches of the world, and the world's mottle lies over a tile", () => {
  for (const r of MATERIAL_RECIPES) {
    const [du, dv] = madeShift(r), f = materialRows(r, 0), look = new Float64Array(3);
    // A tile of one unit has no other place to show: its second copy is itself, and a piece reads it with none.
    const one = r.course !== undefined && r.course.size[0] === r.metres && r.course.size[1] === r.metres;
    expect([r.name, du > 0 && dv > 0 && (one ? du === 1 && dv === 1 : du < 1 && dv < 1)]).toEqual([r.name, true]);
    // A course's joints and a rib's crown lie where they lay: the height moved by the shift differs by grain and pores alone (0.9 off its units).
    if (r.course || r.rib) for (let k = 0; k < 200; k++) {
      const x = ((k * 0.381966) % 1) * r.metres, y = ((k * 0.2360679) % 1) * r.metres;
      expect(Math.abs(materialHeight(f, x + du * r.metres, y + dv * r.metres, look) - materialHeight(f, x, y, look))).toBeLessThan(0.5);
    }
    expect(madeFar(r)).toBeLessThanOrEqual(r.metres);
  }
  // Two points a whole tile apart read the same texel, and differ by the mottle and the copy shown.
  const stucco = materialIndex("stucco"), T = MATERIAL_RECIPES[stucco - 1]!.metres;
  let differ = 0;
  for (let k = 0; k < 200; k++) {
    const x = k * 0.731, y = (k * 0.377) % 9, a = wall(stucco, x, y, 0.002, TWIN_SLOTS).albedo[1]!, b = wall(stucco, x + 7 * T, y, 0.002, TWIN_SLOTS).albedo[1]!;
    if (Math.abs(a / b - 1) > 0.02) differ++;
  }
  expect(differ).toBeGreaterThan(100);
  // Ribs 76 mm apart are gone by a pixel 38 mm wide, long before their tile's own far.
  const sheet = materialIndex("corrugated"), means = wall(0, 3.3, 1.7, 0.002, null, 2);
  expect(wall(sheet, 3.3, 1.7, 0.04, TWIN_SLOTS)).toEqual(means);
  expect(wall(sheet, 3.3, 1.7, 0.01, TWIN_SLOTS)).not.toEqual(means);
});

test("a coat's relief is marked to lie down with lost plaster; a block's joints are not", () => {
  wall(materialIndex("stucco"), 3.3, 1.7, 0.002, TWIN_SLOTS);
  expect([coatLost.coat, coatLost.lost]).toEqual([1, 0]);
  wall(materialIndex("render"), 3.3, 1.7, 0.002, TWIN_SLOTS);
  expect(coatLost.coat).toBe(1);
  // Far off, where it is its means, there is no relief to lay down.
  wall(materialIndex("stucco"), 3.3, 1.7, 1, TWIN_SLOTS);
  expect(coatLost.coat).toBe(0);
  for (const name of ["block", "corrugated", "seam"]) {
    wall(materialIndex(name), 3.3, 1.7, 0.002, TWIN_SLOTS);
    expect(coatLost.coat).toBe(0);
  }
  expect(PROGRAMS.flat!(tierOf("high"), "bc").fragment).toContain("n = normalize(mix(n, geometric, worldLost * worldCoat * risen));");
});

test("the lit program of a near static reads the made array and the vertex's material; a phone's and low poly's do not", () => {
  for (const name of ["medium", "high", "ultra"] as const) {
    const p = PROGRAMS.flat!(tierOf(name), "bc");
    expect(p.vertex).toContain(`vMade = aPiece != 0u ? int((aColor == ${SPALL_PALETTE}u ? 0u : piece.a & ${PIECE_MADE}u)`);
    expect(p.vertex).toContain(`iRegB.x == ${MADE_MARK}u ? int(iRegB.y)`);
    expect(p.fragment).toContain("worldMade = vMade & 31;");
    expect(p.fragment).toContain("fMade[k * 2 - 2]");
    expect(p.fragment).toContain("&& over < 1e5");
    expect(p.defines).toContain("WORLD_WEATHER");
  }
  const touch = { ...tierOf("medium"), finish: "light" as const };
  for (const p of [PROGRAMS.flat!(tierOf("lowpoly"), "bc"), PROGRAMS.flat!(touch, "astc")]) {
    expect(p.vertex).not.toContain("vMade");
    expect(p.defines).not.toContain("WORLD_WEATHER");
  }
  // The mark is no colour a vertex or a region can name.
  expect(MADE_MARK).toBeGreaterThanOrEqual(REGION_BASE + 6);
  expect((SURFACE_NAMES as readonly string[])[plaster]).toBeDefined();
});

test("a chunk's faces of two materials in one colour stay apart, and each piece's state says its material", () => {
  const reg = coreRegistry(), dims = { chunksX: 1, chunksZ: 1 };
  const kinds = [ruinKind("wall8", "rose"), ruinKind("wall8", "rosestucco"), ruinKind("wall8", "roseblock")];
  const statics = kinds.map((kind, i) => ({ kind, x: 12 + i * 8, y: 2, z: 20, yaw: 0 }));
  const labels = Uint8Array.from(reg.defs, (d) => (d?.type === "structure" ? materialIndex(d.made) << 2 : 0));
  const part = mergedPart(new CityStatics(dims, statics, reg), 0, { heightAt: () => 0 }, () => new Uint8Array(3), 0.01, 0, labels);
  const made = new Set(part.made.subarray(0, part.faces));
  expect([...made].sort()).toEqual([0, materialIndex("stucco"), materialIndex("block")].sort());
  // Three coplanar walls of one colour merge into one front without the byte, and into three with it.
  const plain = mergedPart(new CityStatics(dims, statics, reg), 0, { heightAt: () => 0 }, () => new Uint8Array(3), 0.01, 0);
  expect(part.faces).toBeGreaterThan(plain.faces);
  expect(new Set(part.color.subarray(0, part.faces)).size).toBe(new Set(plain.color.subarray(0, plain.faces)).size);
  // Its mesh carries a word a vertex, the same for a face's four, whose own key is the face's piece.
  const making = new NearMaking(new CityStatics(dims, statics, reg), 0, { heightAt: () => 0 }, new Uint8Array(3).fill(1), () => null, 4, labels, true);
  while (!making.done) making.step();
  const mesh = making.finish(), words = new Uint32Array(mesh.piece.buffer);
  expect(words.length).toBe(mesh.faces * 4);
  for (let f = 0; f < mesh.faces; f++) expect(new Set(words.subarray(f * 4, f * 4 + 4)).size).toBe(1);
  expect([...new Set(Array.from(words.subarray(0, mesh.shown * 4), (w) => w & (PIECE_KEYS - 1)))].sort()).toEqual([0, 1, 2]);
  // Drawn by a client, each piece's texel holds its material, which the rasterizer reads as the card does.
  const w = nearClient(flatMap(3, { statics }));
  w.scene.near!.pieces = Infinity;
  w.follow(32, 32);
  const p = w.frame(), row = p.pieceRowOf.get(0)!;
  expect(row).toBeGreaterThan(0);
  expect(kinds.map((_, s) => p.pieces[(row * PIECE_KEYS + s) * 4 + 3]! & PIECE_MADE)).toEqual([0, materialIndex("stucco"), materialIndex("block")]);
  expect(kinds.map((_, s) => pieceMade(p.pieces, p.pieceRows, row * 9, s))).toEqual([0, materialIndex("stucco"), materialIndex("block")]);
});
