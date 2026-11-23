// The components the sheet shows: one of each family, built from the kit's own shapes (content/ruins.ts).

import { RUIN_FINISHES, RUIN_SHAPES } from "../../content/ruins.ts";
import { FLOOR, WALL, partBox, type Part } from "./cut.ts";
import { halves, plateForms, slabBreach, slabOpen, wallBreach, wallOpen, type Component, type Plate } from "./forms.ts";
import type { Rect } from "./geometry.ts";
import { MORE_A } from "./more-a.ts";
import { MORE_B } from "./more-b.ts";

const finish = (name: keyof typeof RUIN_FINISHES): readonly [number, number] => [RUIN_FINISHES[name].color, RUIN_FINISHES[name].under];

/** A plain box of the kit standing on its floor: along it, up from 0, through its thickness. */
function standing(shape: keyof typeof RUIN_SHAPES): { bounds: Rect; part: Part } {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, 0, h];
  return { bounds, part: { r: bounds, w0: -d / 2, w1: d / 2 } };
}

/** A plain slab of the kit, its plane level. */
function lying(shape: keyof typeof RUIN_SHAPES): { bounds: Rect; part: Part } {
  const [w, h, d] = RUIN_SHAPES[shape];
  const bounds: Rect = [-w / 2, w / 2, -d / 2, d / 2];
  return { bounds, part: { r: bounds, w0: -h / 2, w1: h / 2 } };
}

function plate(name: string, family: string, material: string, colours: readonly [number, number], p: Plate, eye?: readonly [number, number]): Component {
  return { name, family, material, finish: colours, skin: p.solid.map((s) => partBox(p.frame, s)), ...(eye ? { eye } : {}), ...(p.frame === FLOOR ? { apart: [0, 2.2, 0] as const } : {}), forms: (variant) => plateForms(p, variant) };
}

function slab(): Component {
  const { bounds, part } = lying("floor8");
  return plate("floor8", "slab", "concrete", finish("concrete"), {
    name: "floor8", frame: FLOOR, parts: [part], solid: [part], cells: halves(bounds),
    breach: slabBreach, open: () => slabOpen(bounds), barsIn: [part.w0, part.w1], bears: { breached: true, open: false },
  }, [32, 40]);
}

function bearingWall(): Component {
  const { bounds, part } = standing("wall8");
  return plate("wall8", "bearing wall", "block", finish("mintblock"), {
    name: "wall8", frame: WALL, parts: [part], solid: [part], cells: halves(bounds),
    breach: wallBreach, open: () => wallOpen(bounds), barsIn: null, bears: { breached: true, open: false },
  });
}

export const SAMPLES: readonly Component[] = [slab(), bearingWall(), ...MORE_A, ...MORE_B];
