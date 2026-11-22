// Nodes: a tree, a rock, a bush. Harvested, used up, and grown back.

import { CHUNK_SIZE } from "../../coords.ts";
import { drawnFaults, f, f32, mesh, row, u8, type Fields, type Kind, type Named } from "../kind.ts";
import { MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF, type ShapeBox } from "./shapes.ts";

/** The most a node kind may be drawn at, as a multiple of its modelled size, and the most variants it may have. */
export const MOST_NODE_SIZE = 3.9;
export const MAX_NODE_VARIANTS = 64;
/** Metres a node's boxes may reach up from its origin at its largest size, as a tall palm's trunk does. Sideways, a structure's half. */
export const MAX_NODE_HEIGHT = 32;
export const MAX_NODE_HITS = 10000;

/**
 * A mesh a node is drawn as, and the boxes bodies and rays meet, in metres from its origin at its modelled size. Its origin
 * is where it meets the ground.
 */
export interface NodeShape {
  readonly mesh: string;
  readonly boxes?: readonly ShapeBox[];
}

/** One individual a node kind grows as. */
export interface NodeVariant extends NodeShape {
  /** How often it is chosen against the kind's other variants. 1 where not given. */
  readonly weight?: number;
  /** What is left of it once used up, in place of the kind's. */
  readonly depleted?: NodeShape;
}

/** A resource node: a tree, a rock, a bush. Node positions come from the map and are the same on every client. Only touched nodes are saved. */
export interface NodeDef extends Named {
  readonly type: "node";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  /** Graybox half extents, and the collider of a variant without boxes. The node stands on its base. */
  readonly half: readonly [number, number, number];
  /** A second box on top of the first, for a crown. Drawn, not collided with. */
  readonly top?: { readonly half: readonly [number, number, number]; readonly color: number };
  /** Bodies walk through it (a bush). It can still be looked at and used. */
  readonly soft?: boolean;
  /** Hits (or picks) before it is used up. */
  readonly hits: number;
  /** In-game hours until it grows back. */
  readonly respawnHours: number;
  /** Matched against a tool's `on`. Omitted for things picked by hand with the use key. */
  readonly material?: string;
  /**
   * What each hit gives. `tool` true means only with the right tool. A right tool multiplies every yield by its power but
   * one marked `flat`, whose range is what a hit gives whatever the tool: where the reference game's page says what its
   * stone pick gets a hit (oil), or that it gets very little (crystal).
   */
  readonly yields: readonly { readonly item: string; readonly min: number; readonly max: number; readonly tool?: boolean; readonly flat?: boolean }[];
  /** Experience per hit. */
  readonly xp: number;
  /** The individuals it grows as. Each node is one of them, chosen by its place. Without them it is its own mesh and `half`. */
  readonly variants?: readonly NodeVariant[];
  /** The least and most it is drawn at, as multiples of its modelled size. Each node's is chosen by its place. 1 where not given. */
  readonly size?: readonly [number, number];
  /** What stands where a node was from when it is used up until it grows back. Without it, nothing does. */
  readonly depleted?: NodeShape;
  /**
   * How far its footing spreads from its origin, in metres at its largest size, and how far the ground may fall away
   * under it below the ground at the origin. A scattered slot whose ground falls further grows the kind `else` names in
   * its place, as it is, or nothing.
   */
  readonly footing?: { readonly reach: number; readonly fall: number; readonly else?: string };
  /**
   * Where a scattered slot grows it against the sea: "under", only where the ground is under the sea (a clam, an oil rock);
   * "either", there or on dry ground (crystal). Without it, only where the ground is 0.3 m above the sea or more. A listed
   * node stands where it is listed.
   */
  readonly sea?: "under" | "either";
  /**
   * Metres within which two of its nodes in one chunk of a scattered layer are not the same variant while it has another
   * to give (shared/world/nodes.ts placedNodes), so heaps side by side differ. Without it, each slot's own hash decides.
   */
  readonly apart?: number;
}

const FIELDS = {
  mesh: f("text"),
  color: f("number"),
  half: f("vec3"),
  top: f("facet"),
  soft: f("switch"),
  hits: f("number", "MaxHarvestHealth"),
  respawnHours: f("number", "the replenish timing"),
  material: f("text"),
  yields: f("list", "the harvest component's item entries", { refs: { "[].item": "item" }, open: true }),
  xp: f("number"),
  variants: f("list", "the foliage type's meshes"),
  size: f("list", "the foliage type's scale range"),
  depleted: f("facet", "what a depleted foliage instance leaves"),
  footing: f("facet", "", { refs: { else: "node" } }),
  sea: f("text"),
  apart: f("number"),
} satisfies Fields<NodeDef>;

const columns = (n: number) => ({
  /** 1 for box kinds that bodies pass through (bushes). */
  soft: u8(n),
  nodeHits: f32(n),
});

export const nodes: Kind<NodeDef, ReturnType<typeof columns>> = {
  type: "node",
  fields: FIELDS,
  rows: [
    row("node", "node", FIELDS, { ark: "a foliage type and its harvest component", shelf: "nodes", must: ["mesh", "color", "half", "hits", "respawnHours", "yields", "xp"], may: ["top", "soft", "material", "variants", "size", "depleted", "footing", "sea", "apart"], slots: { mesh: mesh("must", "{mesh}", "box"), depleted: { ...mesh("may", "{depleted.mesh}", "hidden"), when: "depleted" } }, doc: "A tree, a rock, a bush: harvested, used up, and grown back. Each node is one of its variants, turned and sized by its place." }),
  ],
  check(d, cx) {
    const { errors, positive } = cx;
    for (let a = 0; a < 3; a++) positive(d, `half[${a}]`, d.half[a]!, MAX_STRUCTURE_HALF);
    positive(d, "hits", d.hits, MAX_NODE_HITS);
    positive(d, "respawnHours", d.respawnHours, 1e6);
    for (const y of d.yields) if (!(y.min >= 0 && y.max >= y.min)) errors.push(`${d.id}: a yield's range must be 0 <= min <= max`);
    if (d.sea !== undefined && d.sea !== "under" && d.sea !== "either") errors.push(`${d.id}: its sea is "under" or "either", not "${d.sea}"`);
    if (d.apart !== undefined) positive(d, "apart", d.apart, CHUNK_SIZE);
    const largest = d.size?.[1] ?? 1;
    if (!(d.half[1] * 2 * largest <= MAX_NODE_HEIGHT && Math.max(d.half[0], d.half[2]) * largest <= MAX_STRUCTURE_HALF)) errors.push(`${d.id}: its box reaches further than ${MAX_STRUCTURE_HALF} m sideways or ${MAX_NODE_HEIGHT} m up from its origin at its largest size`);
    const shaped = (what: string, s: NodeShape): void => {
      if (typeof s.mesh !== "string" || s.mesh.length === 0) errors.push(`${d.id}: ${what} names its mesh`);
      if (s.boxes !== undefined && !(Array.isArray(s.boxes) && s.boxes.length <= MAX_SHAPE_BOXES)) errors.push(`${d.id}: ${what} has at most ${MAX_SHAPE_BOXES} boxes`);
      for (const b of s.boxes ?? []) {
        for (let a = 0; a < 3; a++) {
          positive(d, `a box's half[${a}]`, b.half?.[a]!, MAX_STRUCTURE_HALF);
          if (!((Math.abs(b.at?.[a]!) + b.half?.[a]!) * largest <= (a === 1 ? MAX_NODE_HEIGHT : MAX_STRUCTURE_HALF))) errors.push(`${d.id}: a box of ${what} reaches further than ${MAX_STRUCTURE_HALF} m sideways or ${MAX_NODE_HEIGHT} m up from its origin at the kind's largest size`);
        }
      }
    };
    if (d.variants !== undefined && !(d.variants.length >= 1 && d.variants.length <= MAX_NODE_VARIANTS)) errors.push(`${d.id}: a node has 1 to ${MAX_NODE_VARIANTS} variants`);
    for (const v of d.variants ?? []) {
      shaped("a variant", v);
      if (v.weight !== undefined && !(Number.isInteger(v.weight) && v.weight >= 1 && v.weight <= 255)) errors.push(`${d.id}: a variant's weight is a whole number from 1 to 255`);
      if (v.depleted) shaped("a variant's depleted form", v.depleted);
    }
    if (d.depleted) shaped("its depleted form", d.depleted);
    if (d.footing !== undefined && !(d.footing.reach > 0 && d.footing.reach <= MAX_STRUCTURE_HALF && d.footing.fall >= 0 && d.footing.fall <= MAX_NODE_HEIGHT)) errors.push(`${d.id}: footing reaches more than 0 and at most ${MAX_STRUCTURE_HALF} m, and allows a fall of 0 to ${MAX_NODE_HEIGHT} m`);
    if (d.size !== undefined && !(d.size.length === 2 && d.size[0] >= 0.25 && d.size[1] >= d.size[0] && d.size[1] <= MOST_NODE_SIZE)) errors.push(`${d.id}: size is [least, most], from 0.25 to ${MOST_NODE_SIZE}`);
    drawnFaults(d, cx);
  },
  columns,
  fill(d, i, reg, { boxes }) {
    reg.halfX[i] = d.half[0];
    reg.halfY[i] = d.half[1];
    reg.halfZ[i] = d.half[2];
    boxes.push(0, 0, 0, d.half[0], d.half[1], d.half[2]);
    reg.nodeHits[i] = d.hits;
    if (d.soft) reg.soft[i] = 1;
  },
};
