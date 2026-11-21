// What of the game the wiki has. Every class of definition (shared/content/classes.ts) is ruled on here: a definition has
// an entry of its own, is shown within another page, or is left out for a reason this table gives once. A class nobody
// has ruled on, or a definition ruled to have an entry that has none, fails tests/unit/wiki.test.ts.

import type { Def, StructureDef } from "../../shared/content/defs.ts";
import { CLASSES, classOf } from "../../shared/content/classes.ts";
import type { Landmark } from "../../shared/world/landmark.ts";

/** Why a definition has no entry of its own. */
export const LEFT_OUT = {
  scenery: "the scenery a map stands up (ruins, wrecks, lettering, the plaza's blocks, and obelisks, which the map pages mark)",
  form: "the forms pieces are built in",
  standIn: "creatures with no art of their own, which no map spawns",
  target: "the practice target",
  unmade: "road paving, which nothing makes or learns",
  remains: "what bodies and dropped things lie in on the ground",
  flight: "things in flight (a thrown grenade, a fired flare, an arrow where it fell, a grenade's cloud)",
  capsule: "the supply drop's capsule, until drops have a page of their own",
  loot: "loot and crates, which nothing in the world opens yet",
  damage: "damage types, which each figure names",
  game: "what a game names once, which code finds by id",
  rename: "old names of things",
  noFile: "maps still being made",
} as const;
export type LeftOut = keyof typeof LEFT_OUT;

/** An entry by its id, a page of the wiki by its path under /wiki/, or a reason. */
export type Ruling = { entry: string } | { within: string } | { out: LeftOut };

export interface CoverageInput {
  defs: readonly Def[];
  landmarks: readonly Landmark[];
  /** Whether the game's build has a mesh. */
  has: (mesh: string) => boolean;
  /** The maps with a file the wiki has a page for. */
  maps: ReadonlySet<string>;
}

type Rule = (d: Def, c: Context) => Ruling;
interface Context extends CoverageInput {
  /** The item that places each structure, or places its other form (an open door, a lit fire). */
  placer: ReadonlyMap<string, string>;
  /** Each landmark's own definitions, by id, and its name. */
  landmarkOf: ReadonlyMap<string, string>;
}

const entry: Rule = (d) => ({ entry: d.id });
const placed: Rule = (d, c) => (c.placer.has(d.id) ? { within: c.placer.get(d.id)! } : { out: "unmade" });
const out = (why: LeftOut): Rule => () => ({ out: why });
const body: Rule = (d, c) => {
  const s = d as Extract<Def, { type: "species" }>;
  return s.skeleton === "human" || c.has(s.mesh) ? { entry: d.id } : { out: "standIn" };
};

/** By class: how each of its definitions is ruled. Abstract classes have no definitions and no row. */
export const RULINGS: Readonly<Record<string, Rule>> = {
  "item/resource": entry, "item/consumable": entry, "item/weapon": entry, "item/ammo": entry, "item/attachment": entry, "item/instrument": entry,
  "item/armor": entry, "item/saddle": entry, "item/structure": entry, "item/vehicle": entry, "item/egg": entry,
  "item/feces": entry, "item/glider": entry, "item/shield": entry, "item/costume": entry, "item/skin": entry, "item/dye": entry, "item/artifact": entry,
  // A full soul ball is the same ball with a tame in it, on the ball's page.
  "item/ball": (d) => {
    const empty = (d as Extract<Def, { type: "item" }>).ball?.empty;
    return empty ? { within: empty } : { entry: d.id };
  },
  // An engram is its item's page, and the engrams page.
  engram: (d) => ({ within: (d as Extract<Def, { type: "engram" }>).item }),
  levels: () => ({ within: "levels/" }),
  "species/survivor": body, "species/creature": body, "species/civilian": body, "species/vehicle": body,
  "species/target": out("target"),
  "structure/piece": placed, "structure/container": placed, "structure/station": placed, "structure/bed": placed, "structure/defence": placed,
  "structure/static": (d, c) => (c.landmarkOf.has(d.id) ? { within: c.landmarkOf.get(d.id)! } : { out: "scenery" }),
  shape: (d, c) => (c.landmarkOf.has(d.id) ? { within: c.landmarkOf.get(d.id)! } : { out: "form" }),
  // A material is what harms each piece made of it, and when the piece decays, on the piece's page.
  material: () => ({ within: "items/" }),
  node: entry,
  buff: entry,
  "prop/egg": (d) => ({ within: (d as Extract<Def, { type: "prop" }>).item ?? "items/" }),
  "prop/container": out("remains"),
  "prop/projectile": out("flight"),
  "prop/cloud": out("flight"),
  "prop/crate": out("capsule"),
  damage: out("damage"),
  loot: out("loot"),
  // A spawn table is the regions each creature is kept in, on each map's page.
  spawns: () => ({ within: "maps/" }),
  map: (d, c) => (c.maps.has(d.id) ? { within: `maps/${d.id.slice(d.id.indexOf(":") + 1)}/` } : { out: "noFile" }),
  game: out("game"),
  rename: out("rename"),
};

/** The ruling on each definition of the content and of every landmark. */
export function coverage(input: CoverageInput): { def: Def; ruling: Ruling }[] {
  const all = [...input.defs, ...input.landmarks.flatMap((l) => l.defs)];
  const placer = new Map<string, string>();
  for (const d of all) if (d.type === "item") for (const s of d.places ?? []) if (!placer.has(s)) placer.set(s, d.id);
  for (const d of all) {
    const s = d as StructureDef;
    for (const other of d.type === "structure" ? [s.opens, s.lights] : []) if (other && placer.has(d.id) && !placer.has(other)) placer.set(other, placer.get(d.id)!);
  }
  const landmarkOf = new Map(input.landmarks.flatMap((l) => l.defs.map((d) => [d.id, l.name] as const)));
  const context: Context = { ...input, placer, landmarkOf };
  return all.map((d) => {
    const rule = RULINGS[classOf(d)];
    if (!rule) throw new Error(`the wiki has no ruling on ${classOf(d)} (tools/wiki/coverage.ts), so ${d.id} is neither in it nor left out`);
    return { def: d, ruling: rule(d, context) };
  });
}

/** The classes of definition the wiki has no ruling on, and rulings on classes there are not. */
export function unruled(): string[] {
  const classes = CLASSES.filter((c) => !c.abstract).map((c) => c.id);
  return [...classes.filter((c) => !(c in RULINGS)), ...Object.keys(RULINGS).filter((c) => !classes.includes(c)).map((c) => `${c} (no such class)`)];
}

/** What is left out, each reason with how many it leaves out and, for maps, their names. */
export function leftOut(rulings: readonly { def: Def; ruling: Ruling }[]): { why: LeftOut; count: number; names: string[] }[] {
  const by = new Map<LeftOut, Def[]>();
  for (const { def, ruling } of rulings) if ("out" in ruling) by.set(ruling.out, [...(by.get(ruling.out) ?? []), def]);
  return (Object.keys(LEFT_OUT) as LeftOut[]).flatMap((why) => {
    const list = by.get(why) ?? [];
    return list.length ? [{ why, count: list.length, names: why === "noFile" ? list.map((d) => ("label" in d && d.label) || d.id) : [] }] : [];
  });
}
