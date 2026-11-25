// Draws the forms past the first nine as a tier's recipe makes them, with their pictures, under var/pieces/:
//
//   bun tools/pieces/forms.ts                       new-wood.png, new-levels-wood.png, trims-wood.png, corners-wood.png, village-wood.png
//   bun tools/pieces/forms.ts --only roof,ramp      those alone, large and from four sides: look-<names>.png
//   bun tools/pieces/forms.ts --only roof --level 1 at another level
//   bun tools/pieces/forms.ts --village             the village alone; --shots 1,7 those of its views
//   bun tools/pieces/forms.ts --tier thatch         thatch's share of them, and its hamlet for a village
//   bun tools/pieces/forms.ts --village --look 1.5,3,1.5,4,200,10   one view of it: the point looked at, the radius, round and above
//   bun tools/pieces/forms.ts --tier stone          another tier's: its village is a keep
//   bun tools/pieces/forms.ts --village --roofs     roofs that meet at hips, and a ridge's open end: roofs-<tier>-<n>.png
//
// A village's trims are the client's own laying (client/core/render/trims.ts) of the trims the tier's recipe makes, and
// each piece that gives way to one is drawn as the client's rule leaves it. --no-trims draws it with none.
//
// The pieces are baked from the recipe as it stands, not read from a pack, so a change is seen at once.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL_FORMS, FIRST_FORMS } from "../../content/building/forms.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import type { PiecesAsset } from "../art/spec.ts";
import { SOURCE } from "../art/source.ts";
import { colliderBox } from "../pack/pieces/lod.ts";
import type { TierRecipe } from "../pack/pieces/lod.ts";
import { STONE } from "../pack/pieces/stone.ts";
import { THATCH_FORMS, THATCH_PLANNED } from "../pack/pieces/thatch.ts";
import { bakeMetal } from "../pack/pieces/metal.ts";
import { bakeTier } from "../pack/pieces/tier.ts";
import { WOOD } from "../pack/pieces/wood.ts";
import type { SourceMesh } from "../pack/write.ts";
import { piecesPack, tierMeshes } from "./joints.ts";
import type { Placed } from "./layout.ts";
import { Canvas, Studio } from "./sheet.ts";
import { CORNERS, FORT_SHOTS, HAMLET_SHOTS, KEEP_SHOTS, ROOF_SHOTS, VILLAGE_SHOTS, corner, fitted, fort, hamlet, keep, roofs, village, type VillageShot } from "./village.ts";

const SMOOTH = 2;
/** The tier drawn: wood unless `--tier` names another. */
let TIER = "wood";
/** Whether thatch's walls keep their own posts, as before its joints are drawn: `--posts`. */
let POSTS = false;
/** The tiers whose recipes the tier's own bake makes the forms from. Thatch bakes its own. */
const RECIPES: Readonly<Record<string, TierRecipe>> = { wood: WOOD, stone: STONE };
const ALL: Readonly<Record<string, FormDef>> = ALL_FORMS;
/** The forms a tier is made in where that is not all of them, the first nine and the rest. */
const MADE: Readonly<Record<string, readonly [readonly string[], readonly string[]]>> = { thatch: [THATCH_FORMS, THATCH_PLANNED] };
const firstOf = (): string[] => MADE[TIER]?.[0].slice() ?? Object.keys(FIRST_FORMS);
const plannedOf = (): string[] => MADE[TIER]?.[1].slice() ?? Object.keys(ALL).filter((name) => !(name in FIRST_FORMS));
/** Metres on medium at which a made piece's levels begin, and pixels a metre is a metre off at 1,080 rows. */
const LEVEL_FROM = [0, 19, 60, 147, 386] as const;
const PIXELS = 935;

/** The tier's pieces and trims baked with their pictures: every form, or those named. */
export async function baked(names?: readonly string[]): Promise<SourceMesh[]> {
  const dir = join(SOURCE, "core/structures", TIER);
  const source = await import(join(dir, "asset.ts"));
  const asset = source.default as PiecesAsset;
  const made = [...firstOf(), ...plannedOf()];
  const forms = Object.fromEntries(Object.entries(ALL).filter(([name]) => made.includes(name) && (!names || names.includes(name))));
  const trims = !names || names.some((n) => !(n in ALL));
  // Thatch bakes its own: two of its materials are a picture drawn whole, which the tier's bake has no word for. It
  // bakes every piece each time, since a picture that says nothing of tiling takes its span from all that wear it.
  if (TIER === "thatch") return source.bakeThatch(Object.fromEntries(made.map((name) => [name, ALL[name]!])), true, POSTS);
  // Metal has no pictures: its bake is flat, and needs nothing of its asset.
  if (TIER === "metal") return bakeMetal(forms, trims);
  if (!(TIER in RECIPES)) throw new Error(`no recipe makes the new forms in ${TIER}`);
  return bakeTier(RECIPES[TIER]!, forms, dir, asset.materials!, 2048, trims);
}

/** A ball round a piece's box: its middle and its radius. */
function ballOf(box: readonly number[]): [[number, number, number], number] {
  const mid: [number, number, number] = [(box[0]! + box[3]!) / 2, (box[1]! + box[4]!) / 2, (box[2]! + box[5]!) / 2];
  return [mid, Math.max(0.35, Math.hypot(box[3]! - box[0]!, box[4]! - box[1]!, box[5]! - box[2]!) * 0.56)];
}

/** The box of a mesh's finest level, for a trim, which has no form. */
function boxOf(mesh: SourceMesh): number[] {
  const p = mesh.lods[0]!.positions, box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < p.length; v++) {
    box[v % 3] = Math.min(box[v % 3]!, p[v]!);
    box[(v % 3) + 3] = Math.max(box[(v % 3) + 3]!, p[v]!);
  }
  return box;
}

/** Puts the middle square of a picture on a canvas `size` pixels across at (x, y), each pixel the mean of what it covers. */
function shrunk(canvas: Canvas, src: Uint8ClampedArray, sw: number, sh: number, size: number, x: number, y: number): void {
  const side = Math.min(sw, sh), [x0, y0] = [(sw - side) / 2, (sh - side) / 2];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const [u0, u1, v0, v1] = [Math.floor(x0 + (px * side) / size), Math.ceil(x0 + ((px + 1) * side) / size), Math.floor(y0 + (py * side) / size), Math.ceil(y0 + ((py + 1) * side) / size)];
    const sum = [0, 0, 0];
    for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) for (let c = 0; c < 3; c++) sum[c]! += src[(v * sw + u) * 4 + c]!;
    const n = Math.max(1, (u1 - u0) * (v1 - v0));
    canvas.pixels.set([sum[0]! / n, sum[1]! / n, sum[2]! / n, 255], ((y + py) * canvas.width + x + px) * 4);
  }
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const out = resolve(value("out") ?? "var/pieces");
  mkdirSync(out, { recursive: true });
  TIER = value("tier") ?? "wood";
  POSTS = args.includes("--posts") || args.includes("--no-trims");
  const only = value("only")?.split(",");
  const made0 = await baked(only);
  // The other tiers as installed, and this one's installed pieces under those the recipe makes now.
  const own = new Set(made0.map((m) => m.id));
  // Metal is drawn alone: it has no pictures, and the other tiers' are 2 GB a view.
  const others = TIER === "metal" ? [] : tierMeshes().filter((m) => !own.has(m.id));
  const turn = Number(value("turn") ?? 17);
  const has = (id: string): boolean => !args.includes("--no-trims") && own.has(id);
  // What is set down, before the pack is made: a piece the client's rule moves the points of is a mesh of its own.
  const corners = !only && !args.includes("--village") && own.has(`core:joint_sq_${TIER}`) ? CORNERS.map(([, ways, storeys]) => corner(TIER, ways, storeys, has)) : [];
  const roofed = args.includes("--roofs");
  const built: Placed[] = only ? [] : roofed ? roofs(TIER, has) : TIER === "wood" ? village(TIER, has) : TIER === "stone" ? keep(TIER, has) : TIER === "metal" ? fort(TIER, turn, has) : hamlet(TIER, has);
  const meshes = [...made0, ...fitted([...others, ...made0], [...corners.flat(), ...built])];
  const pack = piecesPack([...others, ...meshes]);
  const studio = await Studio.of(pack);
  const made = new Map(meshes.map((m) => [m.id, m] as const));
  const id = (name: string): string => `core:${name}_${TIER}`;
  const ball = (name: string): [[number, number, number], number] => ballOf(name in ALL ? colliderBox(ALL[name]!) : boxOf(made.get(id(name))!));
  const one = (name: string, w: number, h: number, around: number, above: number, level = 0, zoom = 1): Uint8ClampedArray => {
    const [mid, radius] = ball(name);
    return studio.shoot([{ id: id(name), x: 0, y: 0, z: 0, yaw: 0 }], w * SMOOTH, h * SMOOTH, mid, radius / zoom, around, above, level, null);
  };
  const write = (file: string, canvas: Canvas): void => {
    writeFileSync(join(out, file), canvas.png());
    say(join(out, file));
  };
  if (only) {
    const level = Number(value("level") ?? 0), zoom = Number(value("zoom") ?? 1);
    const views: readonly (readonly [number, number])[] = value("around") ? [[Number(value("around")), Number(value("above") ?? 14)]] : [[35, 18], [215, 18], [125, 55], [35, -35]];
    const [cw, ch] = views.length === 1 ? [900, 760] : [470, 420];
    const canvas = new Canvas(8 + views.length * (cw + 4), 8 + only.length * (ch + 4));
    only.forEach((name, row) => views.forEach(([around, above], col) => {
      canvas.shrink(one(name, cw, ch, around, above, level, zoom), cw * SMOOTH, ch * SMOOTH, SMOOTH, 8 + col * (cw + 4), 8 + row * (ch + 4));
      if (col === 0) canvas.text(`${name} ${level}: ${made.get(id(name))!.lods[Math.min(level, made.get(id(name))!.lods.length - 1)]!.indices.length / 3}`, 12, 12 + row * (ch + 4));
    }));
    return write(`look-${only.join("-").slice(0, 60)}.png`, canvas);
  }
  if (!args.includes("--village")) {
    const names = plannedOf();
    // Every new form from its front left and its back right.
    const [cw, ch, across] = [250, 230, 7];
    const close = new Canvas(8 + across * (cw + 4), 30 + Math.ceil(names.length / across) * 2 * (ch + 4));
    close.text(`${TIER}: the forms past the first nine, front and back`, 8, 6, undefined, 2);
    names.forEach((name, k) => {
      const [x, y] = [8 + (k % across) * (cw + 4), 30 + Math.floor(k / across) * 2 * (ch + 4)];
      close.shrink(one(name, cw, ch, 35, 18), cw * SMOOTH, ch * SMOOTH, SMOOTH, x, y);
      close.shrink(one(name, cw, ch, 215, 24), cw * SMOOTH, ch * SMOOTH, SMOOTH, x, y + ch + 4);
      close.text(name, x + 4, y + 4);
    });
    write(`new-${TIER}.png`, close);
    // Each at every level, and small at the size it is where medium first draws that level.
    const [lw, lh] = [168, 150];
    const levels = new Canvas(8 + 2 * (LEVEL_FROM.length * (lw + 4) + 12), 30 + Math.ceil(names.length / 2) * (lh + 4));
    levels.text(`${TIER}: the new forms' levels, from ${LEVEL_FROM.join(", ")} m on medium`, 8, 6, undefined, 2);
    names.forEach((name, k) => {
      const lods = made.get(id(name))!.lods;
      const [, radius] = ball(name);
      lods.forEach((lod, level) => {
        const [x, y] = [8 + (k % 2) * (LEVEL_FROM.length * (lw + 4) + 12) + level * (lw + 4), 30 + Math.floor(k / 2) * (lh + 4)];
        const large = one(name, lw, lh, 35, 18, level);
        levels.shrink(large, lw * SMOOTH, lh * SMOOTH, SMOOTH, x, y);
        levels.text(`${level === 0 ? `${name} ` : ""}${lod.indices.length / 3}`, x + 4, y + 4);
        const small = Math.max(4, Math.round((PIXELS * 2 * radius) / Math.max(LEVEL_FROM[level]!, 6)));
        // The small one is the large one's middle square shrunk: a picture of each size is a view of its own, with every texture again.
        if (level > 0 && small < lw / 2) shrunk(levels, large, lw * SMOOTH, lh * SMOOTH, small, x + lw - small - 2, y + lh - small - 2);
      });
    });
    write(`new-levels-${TIER}.png`, levels);
    const trims = made0.filter((m) => !(m.id.slice(5, -TIER.length - 1) in ALL)).map((m) => m.id.slice(5, -TIER.length - 1));
    if (trims.length > 0) {
      const [tw, th] = [200, 300];
      const sheet = new Canvas(8 + trims.length * 4 * (tw + 4), 30 + th + 4);
      sheet.text(`${TIER}: trims at each level`, 8, 6, undefined, 2);
      trims.forEach((name, k) => made.get(id(name))!.lods.forEach((lod, level) => {
        const x = 8 + (k * 4 + level) * (tw + 4);
        sheet.shrink(one(name, tw, th, 35, 20, level), tw * SMOOTH, th * SMOOTH, SMOOTH, x, 30);
        sheet.text(`${level === 0 ? `${name} ` : ""}${lod.indices.length / 3}`, x + 4, 34);
      }));
      write(`trims-${TIER}.png`, sheet);
    }
  }
  if (!args.includes("--village") && made0.some((m) => m.id === id("joint_sq"))) {
    // Each corner with the joints the client would lay at it, from outside and from above.
    const [jw, jh] = [216, 250];
    const sheet = new Canvas(8 + CORNERS.length * (jw + 4), 30 + 2 * (jh + 4));
    sheet.text(`${TIER}: corners with their joints, from outside and from above`, 8, 6, undefined, 2);
    CORNERS.forEach(([name, , storeys], k) => {
      const laid = corners[k]!;
      const tall = Math.max(1, storeys ?? 1) * 3;
      [[225, 12], [225, 58]].forEach(([around, above], row) => sheet.shrink(studio.shoot(laid, jw * SMOOTH, jh * SMOOTH, [0, 0.375 + tall / 2, 0], tall * 0.62 + 0.4, around!, above!, 0, null), jw * SMOOTH, jh * SMOOTH, SMOOTH, 8 + k * (jw + 4), 30 + row * (jh + 4)));
      sheet.text(name, 12 + k * (jw + 4), 34);
    });
    write(`corners-${TIER}.png`, sheet);
  }
  // The fort's views are of its base, which is turned.
  const turned = ([name, centre, radius, around, above, only]: VillageShot): VillageShot => {
    const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
    return [name, [c * centre[0] - s * centre[2], centre[1], s * centre[0] + c * centre[2]], radius, around - turn, above, only];
  };
  const shots = roofed ? ROOF_SHOTS.filter(([name]) => TIER !== "thatch" || !/triangle|apex/.test(name)) : TIER === "wood" ? VILLAGE_SHOTS : TIER === "stone" ? KEEP_SHOTS : TIER === "metal" ? FORT_SHOTS.map(turned) : HAMLET_SHOTS;
  const [vw, vh] = [1000, 720];
  const wanted = value("shots")?.split(",").map(Number);
  // One view of one's own: --look x,y,z,radius,around,above.
  const look = value("look")?.split(",").map(Number);
  if (look) {
    const canvas = new Canvas(vw, vh);
    canvas.shrink(studio.shoot(built, vw * SMOOTH, vh * SMOOTH, [look[0]!, look[1]!, look[2]!], look[3]!, look[4]!, look[5]!, Number(value("level") ?? 0), 0), vw * SMOOTH, vh * SMOOTH, SMOOTH, 0, 0);
    return write(`village-${TIER}-look${value("name") ? `-${value("name")}` : ""}.png`, canvas);
  }
  shots.forEach(([name, centre, radius, around, above, only], k) => {
    if (wanted && !wanted.includes(k + 1)) return;
    const canvas = new Canvas(vw, vh);
    const drawn = only ? built.filter((q) => only.test(q.id)) : built;
    canvas.shrink(studio.shoot(drawn, vw * SMOOTH, vh * SMOOTH, centre, radius, around, above, 0, 0), vw * SMOOTH, vh * SMOOTH, SMOOTH, 0, 0);
    canvas.text(`${TIER} ${roofed ? "roofs" : "village"}: ${name}`, 8, 6);
    write(`${roofed ? "roofs" : "village"}-${TIER}-${k + 1}.png`, canvas);
  });
}

if (import.meta.main) await main(process.argv.slice(2));
