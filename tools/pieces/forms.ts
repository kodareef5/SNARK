// Draws the forms past the first nine as a tier's recipe makes them, with their pictures, under var/pieces/:
//
//   bun tools/pieces/forms.ts                       new-wood.png, new-levels-wood.png, trims-wood.png, village-wood.png
//   bun tools/pieces/forms.ts --only roof,ramp      those alone, large and from four sides: look-<names>.png
//   bun tools/pieces/forms.ts --only roof --level 1 at another level
//   bun tools/pieces/forms.ts --village             the village alone; --shots 1,7 those of its views
//
// The pieces are baked from the recipe as it stands, not read from a pack, so a change is seen at once.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import type { PiecesAsset } from "../art/spec.ts";
import { SOURCE } from "../art/source.ts";
import { colliderBox } from "../pack/pieces/lod.ts";
import { bakeTier } from "../pack/pieces/tier.ts";
import { WOOD } from "../pack/pieces/wood.ts";
import type { SourceMesh } from "../pack/write.ts";
import { piecesPack, tierMeshes } from "./joints.ts";
import type { Placed } from "./layout.ts";
import { Canvas, Studio } from "./sheet.ts";
import { VILLAGE_SHOTS, village } from "./village.ts";

const SMOOTH = 2;
const TIER = "wood";
const ALL: Readonly<Record<string, FormDef>> = { ...FORMS, ...PLANNED_FORMS };
/** Metres on medium at which a made piece's levels begin, and pixels a metre is a metre off at 1,080 rows. */
const LEVEL_FROM = [0, 19, 60, 147, 386] as const;
const PIXELS = 935;

/** The tier's pieces and trims baked with their pictures: every form, or those named. */
export async function baked(names?: readonly string[]): Promise<SourceMesh[]> {
  const dir = join(SOURCE, "core/structures", TIER);
  const asset = (await import(join(dir, "asset.ts"))).default as PiecesAsset;
  const forms = Object.fromEntries(Object.entries(ALL).filter(([name]) => !names || names.includes(name)));
  return bakeTier(WOOD, forms, dir, asset.materials!, 2048, !names || names.some((n) => !(n in ALL)));
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

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const out = resolve(value("out") ?? "var/pieces");
  mkdirSync(out, { recursive: true });
  const only = value("only")?.split(",");
  const meshes = await baked(only);
  const pack = piecesPack([...tierMeshes(["thatch", "stone"]), ...meshes]);
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
    const names = Object.keys(PLANNED_FORMS);
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
        levels.shrink(one(name, lw, lh, 35, 18, level), lw * SMOOTH, lh * SMOOTH, SMOOTH, x, y);
        levels.text(`${level === 0 ? `${name} ` : ""}${lod.indices.length / 3}`, x + 4, y + 4);
        const small = Math.max(4, Math.round((PIXELS * 2 * radius) / Math.max(LEVEL_FROM[level]!, 6)));
        if (level > 0 && small < lw / 2) levels.shrink(one(name, small, small, 35, 18, level), small * SMOOTH, small * SMOOTH, SMOOTH, x + lw - small - 2, y + lh - small - 2);
      });
    });
    write(`new-levels-${TIER}.png`, levels);
    const trims = meshes.filter((m) => !(m.id.slice(5, -TIER.length - 1) in ALL)).map((m) => m.id.slice(5, -TIER.length - 1));
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
  const built: Placed[] = village(TIER);
  const [vw, vh] = [1000, 720];
  const wanted = value("shots")?.split(",").map(Number);
  VILLAGE_SHOTS.forEach(([name, centre, radius, around, above, only], k) => {
    if (wanted && !wanted.includes(k + 1)) return;
    const canvas = new Canvas(vw, vh);
    const drawn = only ? built.filter((q) => only.test(q.id)) : built;
    canvas.shrink(studio.shoot(drawn, vw * SMOOTH, vh * SMOOTH, centre, radius, around, above, 0, 0), vw * SMOOTH, vh * SMOOTH, SMOOTH, 0, 0);
    canvas.text(`${TIER} village: ${name}`, 8, 6);
    write(`village-${TIER}-${k + 1}.png`, canvas);
  });
}

if (import.meta.main) await main(process.argv.slice(2));
