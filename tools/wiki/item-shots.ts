// Item portraits use the game's geometry or its inventory swatch. Group portraits arrange the same subjects.

import { REGION_MAIN, REGION_SECOND, REGION_TRIM, defaultLook, lookColors } from "../../shared/anim/look.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { Def } from "../../shared/content/defs.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { glyphPixel, GLYPH_HEIGHT, GLYPH_WIDTH } from "../snap/font.ts";
import type { Entry } from "./catalogue.ts";
import { slug } from "./html.ts";
import type { Subject } from "./posters.ts";

import { daylight, finishPlate, graphite, olive, paper, stage, stamp, stone, type Cutout, type Photograph, type RGB, type Placement, type Stage } from "./photography.ts";

const SURFACES: Readonly<Record<string, Stage>> = {
  Ammunition: graphite,
  Armor: daylight,
  Attachment: graphite,
  Ball: graphite,
  Bed: stone,
  Building: stone,
  Consumable: paper,
  "Crafting station": stone,
  Egg: olive,
  Feces: olive,
  Glider: stone,
  Instrument: graphite,
  Resource: paper,
  Saddle: olive,
  Storage: stone,
  Vehicle: daylight,
  Weapon: graphite,
};

const ARRANGEMENTS: Readonly<Record<string, readonly string[]>> = {
  Ammunition: ["arrow_stone", "dart_tranq", "round_pistol"],
  Armor: ["cloth_hat", "meridian_shirt", "hide_boots", "meridian_gloves"],
  Attachment: ["scope", "flashlight", "silencer", "laser"],
  Ball: ["soul_ball", "soul_ball_full"],
  Bed: ["piece_bed", "piece_sleeping_bag", "piece_bunk_bed"],
  Building: ["piece_foundation_wood", "piece_wall_stone", "piece_stairs_wood", "piece_wall_thatch"],
  Consumable: ["waterskin", "meat_cooked", "narcoberry", "narcotic"],
  "Crafting station": ["piece_smithy", "piece_forge", "piece_mortar", "piece_fabricator"],
  Egg: ["dodo_egg", "rex_egg", "raptor_egg", "trike_egg"],
  Feces: ["feces_small", "feces_medium", "feces_large", "feces_massive"],
  Glider: ["frond_glider"],
  Instrument: ["spyglass", "compass", "radio", "gps"],
  Resource: ["wood", "stone", "fiber", "ore"],
  Saddle: ["saddle_pteranodon", "saddle_rex", "saddle_stego", "saddle_carbonemys"],
  Storage: ["piece_storage_box", "piece_storage_large", "piece_vault", "piece_refrigerator"],
  Vehicle: ["boat_assembly", "helicopter_assembly", "zzzzzskateboard_assembly"],
  Weapon: ["hatchet", "bow", "slingshot", "pistol"],
};

export interface ItemDirection {
  surface: Stage;
  /** Offset in degrees from the asset camera, or its automatic framing. */
  azimuth: number;
  elevation: number;
  pair?: true;
  swatch?: { color: number; text: string; name: string };
}

export interface GroupDirection {
  surface: Stage;
  members: readonly Subject[];
  layout?: readonly Placement[];
}

export interface ItemShots {
  subjects: Subject[];
  byItem: Map<string, string>;
  groups: Map<string, { key: string; members: Entry[] }>;
  swatches: Set<string>;
}

function wornColors(colors: readonly [number, number, number]): number[] {
  const out = new Uint8Array(6);
  lookColors(defaultLook(), out);
  out[REGION_MAIN - REGION_BASE] = colors[0];
  out[REGION_SECOND - REGION_BASE] = colors[1];
  out[REGION_TRIM - REGION_BASE] = colors[2];
  return [...out];
}

export function itemShots(entries: readonly Entry[], defs: readonly Def[], meshes: ReadonlySet<string>): ItemShots {
  const items = entries.filter((e) => e.kind === "items");
  const byId = new Map(defs.map((d) => [d.id, d]));
  const worn = new Map<string, string>();
  for (const s of slotsOf(defs)) {
    if (s.slot === "worn" && meshes.has(s.id) && !worn.has(s.owner)) worn.set(s.owner, s.id);
  }
  const props = new Map<string, string>();
  for (const d of defs) {
    if (d.type !== "prop" || !meshes.has(d.mesh)) continue;
    if (d.item) props.set(d.item, d.mesh);
    if (d.fertile) props.set(d.fertile, d.mesh);
  }

  const result: ItemShots = { subjects: [], byItem: new Map(), groups: new Map(), swatches: new Set() };
  const byGroup = new Map<string, { entry: Entry; subject: Subject }[]>();
  for (const e of items) {
    const d = byId.get(e.id);
    if (d?.type !== "item") throw new Error(`No item definition for ${e.id}`);
    const color = d.color ?? 15;
    const projectile = d.ammo?.mesh;
    const alternate = worn.get(e.id) ?? props.get(e.id) ?? (projectile && meshes.has(projectile) ? projectile : undefined);
    const surface = SURFACES[e.group] ?? paper;
    const stairs = e.id.startsWith("core:piece_stairs_");
    const style: ItemDirection = {
      surface,
      azimuth: stairs ? 145 : e.group === "Vehicle" ? -8 : e.group === "Bed" ? 12 : 0,
      elevation: stairs ? 23 : e.group === "Ammunition" ? 19 : e.group === "Weapon" ? 5 : 10,
      ...(!e.picture && d.wear?.slot === "hands" && worn.has(e.id) ? { pair: true as const } : {}),
      ...(e.picture || alternate ? {} : { swatch: { color, text: (d.label ?? e.id.split(":").at(-1)!).slice(0, 4).toUpperCase(), name: e.label } }),
    };
    const subject: Subject = {
      key: `item-${slug(e.id).replaceAll("/", "-")}`,
      meshes: e.picture?.meshes ?? (alternate ? [alternate] : []),
      colors: e.picture?.colors ?? (d.wear ? wornColors(d.wear.colors) : [color]),
      framing: e.picture?.framing,
      body: false,
      item: style,
    };
    result.subjects.push(subject);
    result.byItem.set(e.id, subject.key);
    if (style.swatch) result.swatches.add(e.id);
    const group = byGroup.get(e.group) ?? [];
    group.push({ entry: e, subject });
    byGroup.set(e.group, group);
  }

  for (const [name, group] of byGroup) {
    const preferred = new Map((ARRANGEMENTS[name] ?? []).map((id, k) => [`core:${id}`, k]));
    const ordered = [...group].sort((a, b) =>
      (preferred.get(a.entry.id) ?? Infinity) - (preferred.get(b.entry.id) ?? Infinity)
      || Number(!!a.subject.item?.swatch) - Number(!!b.subject.item?.swatch)
      || a.entry.id.localeCompare(b.entry.id, "en"));
    const selected = ordered.slice(0, Math.min(preferred.size || 3, 4));
    const key = `item-group-${slug(name.toLowerCase().replaceAll(" ", "_"))}`;
    result.subjects.push({ key, meshes: [], colors: [], body: false, group: { surface: SURFACES[name] ?? paper, members: selected.map(({ subject }) => subject), layout: LAYOUTS[name] } });
    result.groups.set(name, { key, members: selected.map(({ entry }) => entry) });
  }
  return result;
}

export const ITEM_CUTOUT = 768;
export const GROUP_WIDTH = 1080;
export const GROUP_HEIGHT = 560;

const COMPOSITIONS: readonly (readonly Placement[])[] = [
  [],
  [[0.5, 0.5, 0.94, 0]],
  [[0.29, 0.52, 0.78, -0.04], [0.72, 0.48, 0.80, 0.05]],
  [[0.21, 0.58, 0.60, -0.10], [0.50, 0.48, 0.82, 0.01], [0.80, 0.55, 0.60, 0.10]],
  [[0.17, 0.45, 0.55, -0.08], [0.49, 0.46, 0.86, 0.02], [0.80, 0.29, 0.48, -0.05], [0.81, 0.72, 0.48, 0.10]],
];

const LAYOUTS: Readonly<Record<string, readonly Placement[]>> = {
  Ammunition: [[0.31, 0.48, 0.87, -0.13], [0.65, 0.44, 0.68, 0.07], [0.77, 0.74, 0.54, 0]],
  Attachment: [[0.26, 0.27, 0.62, -0.03], [0.71, 0.27, 0.62, 0.04], [0.29, 0.72, 0.62, 0.02], [0.74, 0.71, 0.62, -0.03]],
  Armor: [[0.18, 0.37, 0.51, -0.10], [0.47, 0.5, 0.86, 0], [0.79, 0.32, 0.52, -0.05], [0.82, 0.69, 0.48, 0.12]],
  Building: [[0.2, 0.55, 0.57, -0.06], [0.49, 0.47, 0.84, 0], [0.81, 0.38, 0.53, 0.05], [0.81, 0.74, 0.42, 0]],
  Egg: [[0.22, 0.60, 0.50, -0.17], [0.48, 0.50, 0.82, 0.06], [0.73, 0.39, 0.57, -0.06], [0.83, 0.71, 0.47, 0.12]],
  Feces: [[0.26, 0.27, 0.62, -0.03], [0.71, 0.27, 0.62, 0.04], [0.29, 0.72, 0.62, 0.02], [0.74, 0.71, 0.62, -0.03]],
  Instrument: [[0.26, 0.27, 0.62, -0.03], [0.71, 0.27, 0.62, 0.04], [0.29, 0.72, 0.62, 0.02], [0.74, 0.71, 0.62, -0.03]],
  Resource: [[0.26, 0.27, 0.62, -0.03], [0.71, 0.27, 0.62, 0.04], [0.29, 0.72, 0.62, 0.02], [0.74, 0.71, 0.62, -0.03]],
  Vehicle: [[0.25, 0.63, 0.67, -0.05], [0.61, 0.40, 0.80, 0.02], [0.82, 0.70, 0.44, 0.12]],
  Weapon: [[0.22, 0.53, 0.66, -0.14], [0.5, 0.44, 0.89, 0.02], [0.8, 0.32, 0.51, -0.07], [0.79, 0.74, 0.47, 0.1]],
};

export function vanity(cutout: Cutout, direction: ItemDirection, alternate = false): Photograph {
  if (!direction.swatch) return finishPlate(cutout, direction.surface, alternate);
  const frame = stage(ITEM_CUTOUT, ITEM_CUTOUT, direction.surface);
  stamp(frame, cutout, [0.5, 0.48, 1, -0.065]);
  return frame;
}

export function groupVanity(cutouts: readonly Cutout[], direction: GroupDirection): Photograph {
  const frame = stage(GROUP_WIDTH, GROUP_HEIGHT, direction.surface);
  const layout = direction.layout?.length === cutouts.length ? direction.layout : COMPOSITIONS[cutouts.length]!;
  cutouts.forEach((cut, k) => stamp(frame, cut, layout[k]!));
  return frame;
}

/** The same palette entry the game shows, on a small plate bearing the public item name. */
export function swatchCutout(palette: Uint8Array, swatch: NonNullable<ItemDirection["swatch"]>): Cutout {
  const size = ITEM_CUTOUT;
  const pixels = new Uint8Array(size * size * 4);
  const offset = swatch.color * 4;
  const rgb = [palette[offset]!, palette[offset + 1]!, palette[offset + 2]!];
  const fill = (x: number, y: number, width: number, height: number, color: readonly number[]): void => {
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) {
      const p = (j * size + i) * 4;
      pixels[p] = color[0]!;
      pixels[p + 1] = color[1]!;
      pixels[p + 2] = color[2]!;
      pixels[p + 3] = 255;
    }
  };
  fill(118, 277, 532, 214, [211, 210, 202]);
  fill(118, 277, 532, 5, [251, 249, 241]);
  fill(118, 283, 532, 202, [242, 240, 228]);
  fill(145, 305, 38, 38, rgb);
  fill(145, 360, 473, 2, [188, 186, 172]);
  const lettering = (text: string, x0: number, top: number, dot: number, ink: RGB): void => {
    for (const [i, letter] of [...text].entries()) {
      for (let y = 0; y < GLYPH_HEIGHT; y++) for (let x = 0; x < GLYPH_WIDTH; x++) {
        if (glyphPixel(letter.charCodeAt(0), x, y)) fill(x0 + (i * (GLYPH_WIDTH + 1) + x) * dot, top + y * dot, dot, dot, ink);
      }
    }
  };
  lettering("INVENTORY", 200, 311, 4, [76, 86, 82]);
  const label = swatch.name.toUpperCase();
  if (label.length <= 19) lettering(label, 147, 385, 4, [33, 45, 43]);
  else {
    const space = label.lastIndexOf(" ", 25);
    const at = space > 0 && label.length > 25 ? space : Math.min(label.length, 25);
    lettering(label.slice(0, at), 147, 382, 3, [33, 45, 43]);
    lettering(label.slice(at).trim().slice(0, 25), 147, 412, 3, [33, 45, 43]);
  }
  if (swatch.text && label !== swatch.text) lettering(swatch.text, 146, 451, 3, [94, 105, 98]);
  return { width: size, height: size, rgba: pixels };
}
