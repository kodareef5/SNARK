// Draws a tier's fort (village.ts) and its new forms as a client draws them: lit, wearing the tier's material, each
// piece set down by its key in a base at an odd yaw, and the corner posts and skirts laid by the client's own code
// (client/core/render/trims.ts), with the software rasterizer. Under var/pieces/:
//
//   bun tools/pieces/fort.ts metal            fort-metal.png: the fort on high from six sides
//   bun tools/pieces/fort.ts metal --tiers    fort-tiers-metal.png: one view on high, medium, a phone's medium and low poly
//   bun tools/pieces/fort.ts metal --new      lit-new-metal.png: every form past the first nine, close to, on high
//   bun tools/pieces/fort.ts metal --look x,y,z,metres,around,above   one view of the fort, of the base's own point
//   --turn 17   the base's yaw in degrees (197 unless given); --hour 15 the hour
//   --pack FILE the tier's pack, where it is not the one under assets/source: var/pieces/metal.snpk
//
// The forms past the first nine may have no kinds yet, so each that has none is given one here, of its tier's material
// and colour, and its row for a form: nothing of this is content. The game drawn is the tier's pack and the world's
// finishes alone, the rest grey boxes, from a tree of its own under .cache/lit: with every picture of the game a run
// is over 10 GB, and so it is not offered. A run is 15 seconds and under a gigabyte.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FRAME } from "../../client/core/render/packet.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { formHalf, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { provingView, type ProvingView } from "../snap.ts";
import { SOURCE } from "../art/source.ts";
import { SNAP_CACHE, corePack, rgbaOf, splitWithTextures, type GameFiles } from "../snap/files.ts";
import { HAS_SURFACES, worldMaterials, worldSurfaceMeshes } from "../surfaces/build.ts";
import { Canvas } from "./sheet.ts";
import { fortKeys } from "./village.ts";

const [W, H] = [800, 600];
const TEAM = 7;
const PLANNED: Readonly<Record<string, FormDef>> = PLANNED_FORMS;
/** Where the fort's base has its corner, and the row of single forms theirs: open ground west of the proving ground's plaza. */
const BASE = [PROVING_SPAWN.x - 70, PROVING_SPAWN.z - 60] as const;
const ROW = [BASE[0] - 16, BASE[1] - 16] as const;
const STEP = 8;
const ACROSS = 5;
/** How far over the ground a form's slot's level is where it stands alone: a slab a storey up, a foundation on the ground. */
const liftOf = (row: FormDef): number => (row.layer === "slab" && row.root === undefined ? 3 : row.layer === "slab" || row.layer === "footing" ? row.thick : row.layer === "leaf" && row.plane === "flat" ? 0.6 : 0);

/** The core's kinds and one more for each form past the first nine that `tier` has no kind for, its row its form. */
export function registry(tier: string): Registry {
  const like = CORE_CONTENT.find((d) => d.id === `core:wall_${tier}`);
  if (!like || like.type !== "structure") throw new Error(`no tier "${tier}"`);
  const names = Object.keys(PLANNED).filter((name) => !CORE_CONTENT.some((d) => d.id === `core:${name}_${tier}`));
  // Each has its form's box for a shape, with no form: a sloped form's collider is convex parts, which are the placing lane's to write.
  const role = (form: FormDef): string => (form.layer === "slab" ? (form.root ? "foundation" : "ceiling") : form.layer === "post" ? "pillar" : form.layer === "leaf" ? "door" : form.layer === "fill" ? "stairs" : "wall");
  const extra = names.flatMap((name): Def[] => {
    const half = formHalf(PLANNED[name]!);
    return [
      { type: "shape", id: `core:shape_lit_${name}`, role: role(PLANNED[name]!), boxes: [{ at: [0, 0, 0], half }] } as Def,
      { type: "structure", class: "piece", id: `core:${name}_${tier}`, mesh: "shape", shape: `core:shape_lit_${name}`, half, color: like.color, hp: like.hp, material: like.material!, ...(like.made ? { made: like.made } : {}) } as Def,
    ];
  });
  const made = compileContent([...CORE_CONTENT, ...extra]);
  if (!made.registry) throw new Error(made.errors.join("\n"));
  for (const name of names) setForm(made.registry.forms!, made.registry.index.get(`core:${name}_${tier}`)!, PLANNED[name]!);
  return made.registry;
}

/**
 * The game of one tier's pack and the world's finishes: what a piece of a tier with no pictures needs to be drawn as a
 * client draws it. The pack and the tier's asset are set in a tree of their own, as deep as the art's, so the asset's
 * own imports hold.
 */
export function lean(tier: string, pack: string): GameFiles {
  if (!existsSync(pack)) throw new Error(`${pack} is not built: bun run art -- core:${tier}, or --pack FILE`);
  const source = resolve(".cache/lit");
  const dir = join(source, "core/structures", tier);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(SOURCE, "core/structures", tier, "asset.ts"), join(dir, "asset.ts"));
  copyFileSync(pack, join(dir, `${tier}.snpk`));
  const [meshes, materials] = HAS_SURFACES ? [worldSurfaceMeshes(), worldMaterials()] : [[], []];
  return splitWithTextures(corePack(source, meshes), (t) => {
    const k = meshes.findIndex((mesh) => mesh.textures!.some((own) => own.id === t.id));
    if (k < 0) throw new Error(`texture ${t.id} is no finish's: this draws a tier with no pictures of its own`);
    return rgbaOf(materials[k]!, t.role, t.top, SNAP_CACHE);
  });
}

interface Built {
  view: ProvingView;
  /** The base's corner in the world, its level 0, and the cosine and sine of its turn. */
  at: readonly [number, number, number];
  turn: readonly [number, number];
}

export function build(files: GameFiles, tier: Tier, name: string, hour: number | null, degrees: number, what: "fort" | "row"): Built {
  const reg = registry(name);
  const view = provingView(W, H, {}, files, undefined, { reg, pack: new Uint8Array(0) });
  view.scene.assets.tier = tier;
  view.scene.viewHeight = H;
  if (hour !== null) view.scene.hour = hour;
  const { structs, hf } = view;
  const kind = (form: string): number => reg.index.get(`core:${form}_${name}`)!;
  if (what === "row") {
    const ground = hf.heightAt(ROW[0], ROW[1]);
    Object.entries(PLANNED).forEach(([form, row], k) => {
      const [x, z] = [ROW[0] + (k % ACROSS) * STEP, ROW[1] + Math.floor(k / ACROSS) * STEP];
      // Each stands as in a slot of its own: its collider's origin is its row's `at` from there.
      structs.add(kind(form), x + row.at[0], ground + liftOf(row) + row.at[1], z + row.at[2], 0, 0, 1);
    });
    return { view, at: [ROW[0], ground, ROW[1]], turn: [1, 0] };
  }
  const units = Math.round((degrees * 65536) / 360);
  const ground = Math.max(...[-15, 0, 14].flatMap((x) => [-10, 0, 9].map((z) => hf.heightAt(BASE[0] + x, BASE[1] + z))));
  const floor = Math.ceil((ground + ALL_FOUNDATION) * STRUCT_UNITS) / STRUCT_UNITS;
  const frame = structs.frames.make(Math.round(BASE[0] * STRUCT_UNITS), Math.round(floor * STRUCT_UNITS), Math.round(BASE[1] * STRUCT_UNITS), (65536 - units) & 65535, TEAM);
  let lost = 0;
  for (const { name: form, k0, k1 } of fortKeys(name)) if (structs.place(kind(form), frame.gid, k0, k1, TEAM, reg.maxHp[kind(form)]!) < 0) lost++;
  if (lost > 0) console.warn(`${lost} of the fort's pieces did not fit their slots`);
  const a = (degrees * Math.PI) / 180;
  return { view, at: [BASE[0], floor, BASE[1]], turn: [Math.cos(a), Math.sin(a)] };
}

const ALL_FOUNDATION = FORMS.foundation.thick;

/** snap.ts settle, each frame drawn with the ground under a wall known where the scene has no far shadows to say so (look.ts). */
export function settle(view: ProvingView): void {
  const { scene, cam, remote, raster, port } = view, r = scene.assets.residency;
  for (let frame = 1; frame <= 5000; frame++) {
    scene.now += 1000 / 60;
    port?.advance(scene.now);
    const p = scene.build(cam, remote);
    const done = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length === 0 && r.flying === 0 && r.waiting === 0;
    if (!done) p.drawCount = p.tileCount = 0;
    if (p.frame[FRAME.farScale] === 0) [p.frame[FRAME.farScale], p.frame[FRAME.farAt], p.frame[FRAME.farAt + 1]] = [-1 / 4, cam.x / 4, cam.z / 4];
    raster.render(p);
    if (done) return;
  }
  throw new Error("the card was still being filled after 5000 frames");
}

/** A view: the point looked at in the base's own metres over its level 0, metres off, and degrees round and above. */
type Look = readonly [name: string, x: number, y: number, z: number, metres: number, around: number, above: number];

function shoot(b: Built, look: Look): Uint8ClampedArray {
  const [, x, y, z, metres, around, above] = look;
  const { cam } = b.view;
  const [c, s] = b.turn;
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  // The way from the point to the eye, in the base's frame, then both in the world's.
  const out = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
  const world = (px: number, pz: number): [number, number] => [c * px - s * pz, s * px + c * pz];
  const [cx, cz] = world(x, z), [ox, oz] = world(out[0]!, out[2]!);
  [cam.x, cam.y, cam.z] = [b.at[0] + cx + ox * metres, b.at[1] + y + out[1]! * metres, b.at[2] + cz + oz * metres];
  [cam.yaw, cam.pitch] = [Math.atan2(-ox, -oz), -e];
  settle(b.view);
  return b.view.raster.color.slice();
}

const FORT: readonly Look[] = [
  ["the fort", -1, 4, -2, 30, 292, 22],
  ["the gatehouse, the gateway and its gate", 3, 4.2, -7, 15, 262, 4],
  ["the tower, its parapet and its lantern", -9, 5.4, 3, 18, 222, 14],
  ["the keep's hips, the annex with its parapet and railing, and the ramp", 9, 2.8, 0, 12.5, 322, 20],
  ["the roofs: a slope, two hips, a gable, and the hatch", 5, 4, 3, 16, 285, 52],
  ["a corner: the post, two walls and the skirts", 0, 1.3, 0, 4.4, 225, 8],
];

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const name = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "metal";
  const out = resolve(value("out") ?? "var/pieces");
  const hour = value("hour") === undefined ? null : Number(value("hour"));
  // The sun stands to the world's +Z: a base turned 197 degrees shows it its front, 17 degrees off the grid.
  const turn = Number(value("turn") ?? 197);
  mkdirSync(out, { recursive: true });
  const files = lean(name, resolve(value("pack") ?? join(SOURCE, "core/structures", name, `${name}.snpk`)));
  const sheet = (file: string, title: string, shots: readonly { label: string; px: Uint8ClampedArray }[], across: number): void => {
    const [gap, head] = [6, 30];
    const canvas = new Canvas(gap + across * (W + gap), head + Math.ceil(shots.length / across) * (H + gap));
    canvas.text(title, 8, 6, undefined, 2);
    shots.forEach(({ label, px }, k) => {
      const [x, y] = [gap + (k % across) * (W + gap), head + Math.floor(k / across) * (H + gap)];
      canvas.enlarge(px, W, H, 1, x, y);
      canvas.fill(x, y, label.length * 6 + 8, 13, [242, 243, 245]);
      canvas.text(label, x + 4, y + 3);
    });
    writeFileSync(join(out, file), canvas.png());
    say(join(out, file));
  };
  if (args.includes("--new")) {
    const row = build(files, tierOf("high"), name, hour, 0, "row");
    const shots = Object.entries(PLANNED).map(([form, def], k) => {
      const [hx, hy, hz] = formHalf(def);
      const lift = liftOf(def) + def.at[1];
      // From its front left, a little above, and a slab from further above.
      return { label: form, px: shoot(row, [form, (k % ACROSS) * STEP + def.at[0], lift, Math.floor(k / ACROSS) * STEP + def.at[2], Math.max(2.6, Math.hypot(hx, hy, hz) * 1.9), 62, def.plane === "flat" && def.layer !== "post" && def.layer !== "fill" ? 36 : 12]) };
    });
    return sheet(`lit-new-${name}.png`, `${name}: the forms past the first nine, as high draws them`, shots, 5);
  }
  const look = value("look")?.split(",").map(Number);
  if (look) {
    const b = build(files, tierOf("high"), name, hour, turn, "fort");
    const canvas = new Canvas(W, H);
    canvas.enlarge(shoot(b, ["", look[0]!, look[1]!, look[2]!, look[3]!, look[4]!, look[5]!]), W, H, 1, 0, 0);
    const file = join(out, `fort-${name}-look${value("name") ? `-${value("name")}` : ""}.png`);
    writeFileSync(file, canvas.png());
    return say(file);
  }
  if (args.includes("--tiers")) {
    const tiers: readonly (readonly [string, Tier])[] = [["high", tierOf("high")], ["medium", tierOf("medium")], ["a phone's medium", forTouch(tierOf("medium"), true)], ["low poly", tierOf("lowpoly")]];
    const shots = tiers.flatMap(([label, tier]) => {
      const b = build(files, tier, name, hour, turn, "fort");
      return [{ label: `${label}: ${FORT[0]![0]}`, px: shoot(b, FORT[0]!) }, { label: `${label}: ${FORT[1]![0]}`, px: shoot(b, FORT[1]!) }];
    });
    return sheet(`fort-tiers-${name}.png`, `${name}: the fort on each tier, its base turned ${turn} degrees`, shots, 2);
  }
  const b = build(files, tierOf("high"), name, hour, turn, "fort");
  sheet(`fort-${name}.png`, `${name}: a fort, its base turned ${turn} degrees, as high draws it, its posts and skirts laid by the client`, FORT.map((l) => ({ label: l[0], px: shoot(b, l) })), 3);
}

if (import.meta.main) await main(process.argv.slice(2));
