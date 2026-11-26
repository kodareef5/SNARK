// The garment cuts and their print sheets. A cut is drawn as the mesh "<body>/garment/<cut>" (body "core:human_m" or
// "core:human_f"), made by assets/source/core/humans/garments/. Its one texture map is its print sheet: the square a print
// is placed on (shared/people/doc.ts PrintPlace), u across from the left and v down from the top, as the Wardrobe page
// draws it. Several cuts share a sheet, so a print lies on the same place of the body on each of them.
//
// Each panel is a part of the body unrolled into a rectangle of the sheet, upright and unmirrored as seen from outside:
// what is up on the body is up on the sheet. Cloth outside every panel is not on the body.

/** A rectangle of the sheet: left, top, width and height, each 0 to 1. */
export type SheetRect = readonly [u: number, v: number, w: number, h: number];

export interface SheetPanel {
  readonly name: string;
  readonly rect: SheetRect;
  /** What lies where in it. */
  readonly note: string;
}

export interface Sheet {
  /** Metres of cloth one whole sheet spans, each way, at the body it was laid out on. */
  readonly metres: number;
  readonly panels: readonly SheetPanel[];
}

export type SheetName = "top" | "bottom" | "shoes" | "apron";

export const SHEETS: Readonly<Record<SheetName, Sheet>> = {
  top: {
    metres: 1.4,
    panels: [
      { name: "torso", rect: [0, 0, 0.75, 0.6], note: "round the trunk from the right side seam: the front is the left half (its middle at u 0.1875), the back the right half (its middle at u 0.5625); the collar at the top, the hem below. Below it the sheet is free" },
      { name: "left sleeve", rect: [0.76, 0, 0.24, 0.5], note: "the left arm as it hangs, the shoulder at the top: round from the seam under the arm, the front at a quarter, the outside at the middle, the back at three quarters" },
      { name: "right sleeve", rect: [0.76, 0.5, 0.24, 0.5], note: "the right arm as it hangs, the shoulder at the top: round from the seam under the arm, the back at a quarter, the outside at the middle, the front at three quarters" },
    ],
  },
  bottom: {
    metres: 1.3,
    panels: [
      { name: "left leg", rect: [0, 0, 0.5, 0.86], note: "the left hip and leg from the waist (top) down: the front is the left half from the inside seam to the outer side, the back the right half" },
      { name: "right leg", rect: [0.5, 0, 0.5, 0.86], note: "the right hip and leg from the waist (top) down: the back is the left half from the inside seam to the outer side, the front the right half" },
    ],
  },
  shoes: {
    metres: 0.7,
    panels: [
      { name: "left outer", rect: [0, 0, 0.5, 0.24], note: "the left shoe's outer side from beside it, the heel to the right" },
      { name: "left inner", rect: [0.5, 0, 0.5, 0.24], note: "the left shoe's inner side from beside it, the toe to the right" },
      { name: "right outer", rect: [0, 0.25, 0.5, 0.24], note: "the right shoe's outer side from beside it, the toe to the right" },
      { name: "right inner", rect: [0.5, 0.25, 0.5, 0.24], note: "the right shoe's inner side from beside it, the heel to the right" },
      { name: "left top", rect: [0, 0.5, 0.24, 0.48], note: "the left shoe's top from above, the toe up" },
      { name: "right top", rect: [0.25, 0.5, 0.24, 0.48], note: "the right shoe's top from above, the toe up" },
      { name: "left sole", rect: [0.5, 0.5, 0.24, 0.48], note: "the left sole from below, the toe up" },
      { name: "right sole", rect: [0.75, 0.5, 0.24, 0.48], note: "the right sole from below, the toe up" },
    ],
  },
  apron: {
    metres: 1.2,
    panels: [
      { name: "front", rect: [0, 0, 0.6, 0.85], note: "the apron's face from the bib (top) to the hem (bottom)" },
      { name: "back", rect: [0.62, 0, 0.36, 0.5], note: "its reverse, smaller" },
      { name: "straps", rect: [0, 0.88, 1, 0.1], note: "the neck strap and the ties" },
    ],
  },
};

export type Fabric = "jersey" | "denim" | "canvas";

export interface CutSheet {
  readonly sheet: SheetName;
  readonly fabric: Fabric;
  /** Where a print is placed until an admin moves it: the front's chest, or the cut's best face. */
  readonly print: SheetRect;
  /** The most triangles at each level, the finest first; levels before `flat` are drawn with pictures. */
  readonly levels: readonly number[];
  readonly flat: number;
}

/** Every cut by its name, which a garment's `cut` gives. */
export const CUTS: Readonly<Record<string, CutSheet>> = {
  tee: { sheet: "top", fabric: "jersey", print: [0.06, 0.12, 0.25, 0.2], levels: [4800, 640, 310, 100], flat: 2 },
  tee_loose: { sheet: "top", fabric: "jersey", print: [0.06, 0.12, 0.25, 0.2], levels: [4800, 640, 310, 100], flat: 2 },
  hoodie: { sheet: "top", fabric: "jersey", print: [0.06, 0.14, 0.25, 0.18], levels: [5600, 760, 360, 110], flat: 2 },
  jeans: { sheet: "bottom", fabric: "denim", print: [0.62, 0.05, 0.12, 0.12], levels: [3600, 560, 270, 80], flat: 2 },
  shorts: { sheet: "bottom", fabric: "denim", print: [0.62, 0.05, 0.12, 0.12], levels: [2200, 360, 170, 56], flat: 2 },
  trainers: { sheet: "shoes", fabric: "canvas", print: [0.12, 0.05, 0.26, 0.12], levels: [1800, 320, 130, 44], flat: 1 },
  apron: { sheet: "apron", fabric: "canvas", print: [0.12, 0.08, 0.36, 0.3], levels: [1800, 420, 200, 64], flat: 2 },
};

/** The colour regions an edition's three colours dye, in order: main, accent and trim. A slot's dye goes over them. */
export const EDITION_REGIONS = [1, 4, 5] as const;

/** The mesh a cut is drawn with on a body, such as cutMesh("core:human_f", "tee"). */
export const cutMesh = (body: string, cut: string): string => `${body}/garment/${cut}`;
