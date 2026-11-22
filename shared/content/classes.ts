// The class table: every kind of content, as ARK organises its own, with what each must and may declare and the assets
// it expects. A definition's `type` is its family and its class is a leaf of this table. A field its class neither must
// nor may declare is refused. The reference page, the shape checks and the asset slots are all derived from these rows.

import { FEATURES, type Feature } from "../features.ts";
import { f, icon, mesh, stub, type ClassRow, type Field, type Fields, type Slot, type Status } from "./kind.ts";
import { KINDS } from "./kinds.ts";
import type { Def, ItemDef } from "./defs.ts";


export type { ClassRow, Field, Slot, Status } from "./kind.ts";

const ITEM = {
  stack: f("number", "MaxItemQuantity"),
  weight: f("number", "BaseItemWeight"),
  spoilHours: f("number", "SpoilingTime"),
  decomposeHours: f("number", "the time a dropped item decomposes in"),
  youngFor: f("text", "prime meat from the young in place of raw meat", { refs: { "": "item" } }),
  eat: f("facet", "UseItemAddCharacterStatusValues"),
  fuel: f("number"),
  // The stations wave's (planning/reference/stations-plan.md, S0, read since S1): what a piece of fuel leaves when it burns out.
  burnsInto: f("text", "the charcoal a fire leaves for each piece of wood burnt out", { refs: { "": "item" } }),
  saddle: f("facet", "equipment type DinoSaddle", { refs: { fits: "species/creature" } }),
  dose: f("facet", "UseItemAddCharacterStatusValues"),
  cooks: f("facet", "", { refs: { into: "item" } }),
  label: f("text", "DescriptiveNameBase"),
  color: f("number"),
  tool: f("facet"),
  // The stubs inside the weapon and ammo facets are planning/reference/weapons-plan.md's, each flipped by its project.
  weapon: f("facet", "WeaponTemplate", {
    refs: { "ammo[]": "item", "fits[]": "item/attachment", "cloud.prop": "prop/cloud", "cloud.buff": "buff" },
    open: true,
  }),
  ammo: f("facet", "", { refs: { buff: "buff" } }),
  wear: f("facet", "equipment type and ItemStatInfos"),
  attachment: f("text", "item type WeaponAttachment"),
  optic: f("facet", "the scope's zoom (ScopeOverlay, FOV)"),
  places: f("list", "StructureToBuild", { refs: { "[]": "structure" }, open: true }),
  deploys: f("text", "the vehicle an assembly deploys", { refs: { "": "species/vehicle" } }),
  craft: f("facet", "BaseCraftingResourceRequirements, BlueprintTimeToCraft, BaseCraftingXP", { refs: { "needs[].item": "item", at: "structure/station" } }),
  description: stub("polish", "text", "ItemDescription"),
  folder: stub("polish", "text", "DefaultFolderPaths"),
  spoilsInto: f("text", "SpoilingItem", { refs: { "": "item" } }),
  blueprint: f("switch", "whether it may be a blueprint (a crafted item may, unless false)"),
  use: f("facet", "UseItemAddCharacterStatusValues and the buffs a consumable gives", { refs: { "buffs[]": "buff" } }),
  glide: f("facet", "none of its own: the Parachute's slow fall and the Glider Suit's glide, as one thing carried"),
  ball: f("facet", "PrimalItem_WeaponEmptyCryopod and the creature it holds", { refs: { full: "item", empty: "item" } }),
  charge: f("switch", "a cryopod's charge, which only a powered cryofridge holds"),
  travels: f("switch", "bPreventUpload, inverted"),
} satisfies Fields<ItemDef>;

/** The fields of a type whose kind has a file of its own (kinds.ts). */
const fieldsOf = (type: string): Readonly<Record<string, Field>> => KINDS.find((k) => k.type === type && k.fields)!.fields!;
const rowsOf = (type: string): readonly ClassRow[] => KINDS.find((k) => k.type === type && k.rows)!.rows!;

/** Every field of every family that has a definition type. */
export const FIELDS: Readonly<Record<Def["type"], Readonly<Record<string, Field>>>> = {
  item: ITEM,
  species: fieldsOf("species"),
  structure: fieldsOf("structure"),
  node: fieldsOf("node"),
  prop: fieldsOf("prop"),
  engram: fieldsOf("engram"),
  levels: fieldsOf("levels"),
  buff: fieldsOf("buff"),
  material: fieldsOf("material"),
  shape: fieldsOf("shape"),
  damage: fieldsOf("damage"),
  loot: fieldsOf("loot"),
  spawns: fieldsOf("spawns"),
  map: fieldsOf("map"),
  game: fieldsOf("game"),
  rename: fieldsOf("rename"),
};

const ITEM_SLOTS = { icon, dropped: mesh("may", "{id}/dropped", "core:bag") };
/**
 * An item in the hand that is not a weapon (whose held mesh is its `weapon.mesh`): a pieces asset's held piece, named for
 * its item (tools/art/build.ts, heldOn). ARK holds a shield in the other hand; anything else on the hotbar is taken in
 * hand here when chosen (CMD_SELECT), so a food, a drink or an egg chosen shows in the hand when it has a piece.
 */
const HELD = mesh("may", "{id}", "none");

interface RowIn<K extends string> {
  parent?: string;
  abstract?: boolean;
  ark: string;
  status?: Status;
  waits?: Feature;
  shelf: string;
  must?: readonly K[];
  may?: readonly K[];
  any?: readonly K[];
  slots?: Record<string, Slot>;
  doc: string;
}

const rows: ClassRow[] = [];

/** Adds a class of a family whose fields are `_fields`. The keys of must, may and any are checked against them. */
function row<T extends Record<string, Field>>(id: string, type: ClassRow["type"], _fields: T, r: RowIn<Extract<keyof T, string>>): void {
  rows.push({
    id,
    type,
    parent: r.parent ?? null,
    abstract: r.abstract ?? false,
    ark: r.ark,
    status: r.status ?? "built",
    waits: r.waits ?? "",
    shelf: r.shelf,
    must: r.must ?? [],
    may: r.may ?? [],
    any: r.any ?? [],
    slots: r.slots ?? {},
    doc: r.doc,
  });
}

const ANY_ITEM = ["weight", "label", "color", "craft", "description", "folder", "blueprint", "decomposeHours", "travels"] as const;

row("item", "item", ITEM, { abstract: true, ark: "PrimalItem", shelf: "items", doc: "Anything that is carried." });
row("item/resource", "item", ITEM, { parent: "item", ark: "PrimalItemResource_", shelf: "items/resources", must: ["stack"], may: [...ANY_ITEM, "fuel", "burnsInto", "spoilHours", "spoilsInto", "youngFor", "ammo"], slots: { shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "A material: gathered, stacked, and spent in crafting. One a weapon fires, as a slingshot fires stone, has an ammo facet." });
row("item/consumable", "item", ITEM, { parent: "item", ark: "PrimalItemConsumable_", shelf: "items/consumables", must: ["stack"], may: [...ANY_ITEM, "eat", "dose", "spoilHours", "spoilsInto", "cooks", "fuel", "burnsInto", "youngFor", "use"], any: ["eat", "dose", "use"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "Something eaten, drunk or fed for what it does to a body." });
row("item/weapon", "item", ITEM, { parent: "item", ark: "PrimalItem_Weapon", shelf: "items/weapons", must: ["stack", "weapon"], may: [...ANY_ITEM, "tool", "ammo", "optic"], slots: { held: mesh("must", "{weapon.mesh}", "none"), shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "Held in the hand to strike, shoot or throw. A hatchet or pick is a weapon that is also a tool. A thrown one with an ammo facet of its own flies and hits as an arrow does (the bola)." });
row("item/ball", "item", ITEM, { parent: "item/weapon", ark: "PrimalItem_WeaponEmptyCryopod", shelf: "items/balls", must: ["stack", "weapon", "ball"], may: [...ANY_ITEM, "spoilHours", "spoilsInto", "charge"], slots: { held: mesh("must", "{weapon.mesh}", "none"), ...ITEM_SLOTS }, doc: "Held in the hand: a click keeps the tame looked at in it, or looses the one it holds." });
row("item/ammo", "item", ITEM, { parent: "item", ark: "PrimalItemAmmo_", shelf: "items/ammo", must: ["stack", "ammo"], may: [...ANY_ITEM, "spoilHours", "spoilsInto"], slots: { shot: mesh("may", "{ammo.mesh}", "core:tracer"), ...ITEM_SLOTS }, doc: "What a bow or gun fires." });
row("item/attachment", "item", ITEM, { parent: "item", ark: "item type WeaponAttachment", shelf: "items/attachments", must: ["stack", "attachment"], may: [...ANY_ITEM, "optic"], slots: ITEM_SLOTS, doc: "Fitted to a weapon that takes it. A sight has an optic facet: how many times it magnifies." });
row("item/equipment", "item", ITEM, { parent: "item", abstract: true, ark: "item type Equipment", shelf: "items/equipment", doc: "Worn by a body, in a slot." });
row("item/armor", "item", ITEM, { parent: "item/equipment", ark: "PrimalItemArmor_, hat to boots", shelf: "items/armor", must: ["stack", "wear"], may: [...ANY_ITEM, "optic"], slots: { worn: mesh("must", "{body}/armor/{wear.set}/{wear.slot}", "{body}/{wear.slot}"), vents: mesh("may", "{body}/armor/{wear.set}/{wear.vents}", "none"), ...ITEM_SLOTS }, doc: "A piece worn on the head, torso, hands, legs or feet." });
row("item/saddle", "item", ITEM, { parent: "item/equipment", ark: "PrimalItemArmor_, DinoSaddle", shelf: "items/saddles", must: ["stack", "saddle"], may: ANY_ITEM, slots: { worn: mesh("may", "{id}/worn", "none"), ...ITEM_SLOTS }, doc: "Worn by a tamed creature so that it can be ridden. Drawn as its worn mesh on the creature's bones, unless the creature has a saddled model, which is drawn in place of both." });
row("item/structure", "item", ITEM, { parent: "item", ark: "PrimalItemStructure_", shelf: "items/structures", must: ["stack", "places"], may: ANY_ITEM, slots: { preview: mesh("may", "{id}/preview", "#mesh"), ...ITEM_SLOTS }, doc: "Set down as a structure." });
row("item/vehicle", "item", ITEM, { parent: "item", ark: "a deployable vehicle assembly", shelf: "items/vehicles", must: ["stack", "deploys"], may: ANY_ITEM, slots: { preview: mesh("may", "{deploys}", "box"), ...ITEM_SLOTS }, doc: "A completed assembly placed as a vehicle on a clear supporting surface." });
row("item/egg", "item", ITEM, { parent: "item/consumable", ark: "PrimalItemConsumable_Egg_", shelf: "items/eggs", must: ["stack"], may: [...ANY_ITEM, "eat", "spoilHours", "spoilsInto"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "An egg in the hand, eaten or set down. A fertilised one stacks to 1, keeps its young and does not hatch while held." });
row("item/feces", "item", ITEM, { parent: "item/resource", ark: "the feces items, small to massive", shelf: "items/feces", must: ["stack"], may: [...ANY_ITEM, "spoilHours", "spoilsInto", "fuel"], slots: ITEM_SLOTS, doc: "What a creature leaves when it defecates, a size for each kind of creature." });
row("item/glider", "item", ITEM, { parent: "item", ark: "PrimalItemConsumable_Parachute, and the Glider Suit skin", shelf: "items/gliders", must: ["stack", "glide"], may: ANY_ITEM, slots: { held: HELD, wing_r: mesh("may", "{id}/wing_r", "none"), wing_l: mesh("may", "{id}/wing_l", "none"), ...ITEM_SLOTS }, doc: "Carried anywhere in the bag, and opened in the air to glide: a wing for each hand, and folded in the hand when chosen." });
row("item/shield", "item", ITEM, { parent: "item/equipment", ark: "equipment type Shield", status: "stub", waits: "cosmetics", shelf: "items/shields", must: ["stack"], may: ANY_ITEM, slots: { held: HELD, ...ITEM_SLOTS }, doc: "Held in the other hand to block." });
row("item/costume", "item", ITEM, { parent: "item/equipment", ark: "equipment types Costume and Trophy", status: "stub", waits: "cosmetics", shelf: "items/costumes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Worn for its look alone." });
row("item/skin", "item", ITEM, { parent: "item", ark: "PrimalItemSkin_", status: "stub", waits: "cosmetics", shelf: "items/skins", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Changes the look of the item it is put on." });
row("item/dye", "item", ITEM, { parent: "item", ark: "PrimalItemDye_", status: "stub", waits: "cosmetics", shelf: "items/dyes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Colours a region of what it is used on." });
row("item/instrument", "item", ITEM, { parent: "item", ark: "PrimalItem_WeaponSpyglass, _WeaponCompass, _WeaponGPS, _WeaponMagnifyingGlass, PrimalItemRadio", status: "partial", waits: "instruments", shelf: "items/instruments", must: ["stack"], may: [...ANY_ITEM, "optic"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "Held to look through or to read. Blocked out: it is made, carried and dropped, and does nothing in the hand yet." });
row("item/artifact", "item", ITEM, { parent: "item", ark: "PrimalItemArtifact_", status: "stub", waits: "bosses", shelf: "items/artifacts", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Found once in its place and spent to call a boss." });

rows.push(...rowsOf("engram"));
rows.push(...rowsOf("levels"));

rows.push(...rowsOf("species"));

rows.push(...rowsOf("structure"));
rows.push(...rowsOf("shape"));
rows.push(...rowsOf("material"));

rows.push(...rowsOf("node"));

rows.push(...rowsOf("prop"));

rows.push(...rowsOf("buff"));

rows.push(...rowsOf("damage"));
rows.push(...rowsOf("loot"));
rows.push(...rowsOf("spawns"));
rows.push(...rowsOf("map"));
rows.push(...rowsOf("game"));

rows.push(...rowsOf("rename"));

export const CLASSES: readonly ClassRow[] = rows;
const BY_ID = new Map(CLASSES.map((r) => [r.id, r]));

export function classRow(id: string): ClassRow | undefined {
  return BY_ID.get(id);
}

/** What is wrong with the table itself. Empty when it is sound. */
export function classFaults(): string[] {
  const out: string[] = [];
  const families = new Set(CLASSES.map((r) => r.type as string));
  const names = (target: string): boolean => BY_ID.has(target) || families.has(target);
  if (BY_ID.size !== CLASSES.length) out.push("a class id is used twice");
  const shelves = new Map<string, string>();
  for (const r of CLASSES) {
    const fields: Record<string, Field> = FIELDS[r.type];
    if (r.parent !== null && !BY_ID.has(r.parent)) out.push(`${r.id}: its parent "${r.parent}" is no class`);
    if (r.id !== r.type && !r.id.startsWith(r.type + "/")) out.push(`${r.id}: a class is named after its family, "${r.type}/…"`);
    if (r.status === "stub" && !(r.waits in FEATURES)) out.push(`${r.id}: a stub names the feature it waits for`);
    if (r.status === "built" && r.waits !== "") out.push(`${r.id}: a built class waits for nothing`);
    if (r.abstract && (r.must.length > 0 || r.may.length > 0)) out.push(`${r.id}: an abstract class declares nothing`);
    for (const k of r.must) if (r.may.includes(k)) out.push(`${r.id}: "${k}" is both must and may`);
    for (const k of [...r.must, ...r.may, ...r.any]) if (!(k in fields)) out.push(`${r.id}: "${k}" is no field of ${r.type}`);
    for (const k of r.any) if (!r.may.includes(k) && !r.must.includes(k)) out.push(`${r.id}: "${k}" is asked for and not allowed`);
    for (const [name, slot] of Object.entries(r.slots)) {
      if (slot.fallback.length === 0) out.push(`${r.id}#${name}: a slot says what stands in when it is empty`);
      if (slot.when !== undefined && !(slot.when in fields)) out.push(`${r.id}#${name}: "${slot.when}" is no field of ${r.type}`);
      if (slot.from === "") out.push(`${r.id}#${name}: a slot says where its asset is found`);
    }
    if (!r.abstract) {
      const before = shelves.get(r.shelf);
      if (before !== undefined && before !== r.type) out.push(`${r.id}: shelf "${r.shelf}" is also ${before}'s`);
      shelves.set(r.shelf, r.type);
    }
  }
  for (const [type, fields] of Object.entries(FIELDS)) {
    for (const [name, field] of Object.entries(fields)) {
      for (const target of Object.values(field.refs ?? {})) if (!names(target)) out.push(`${type}.${name}: names "${target}", which is no class`);
      if (field.waits !== undefined && !(field.waits in FEATURES)) out.push(`${type}.${name}: a stub field names the feature it waits for`);
      for (const [part, waits] of Object.entries(field.stubs ?? {})) if (field.kind !== "facet" || !(waits in FEATURES)) out.push(`${type}.${name}.${part}: a stub inside a facet names the feature it waits for`);
      // Every field belongs to some class of its family, or nothing could declare it.
      if (!CLASSES.some((r) => r.type === type && (r.must.includes(name) || r.may.includes(name)))) out.push(`${type}.${name}: no class may declare it`);
    }
  }
  return out;
}

/** The class of a definition: its family, and its `class` where the family has several. */
export function classOf(d: Def): string {
  return "class" in d ? `${d.type}/${d.class}` : d.type;
}

const article = (type: string): string => (/^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`);

const KIND: Record<Field["kind"], [is: (v: unknown) => boolean, said: string]> = {
  text: [(v) => typeof v === "string", "text"],
  number: [(v) => typeof v === "number", "a number"],
  switch: [(v) => typeof v === "boolean", "true or false"],
  vec3: [(v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number"), "three numbers"],
  list: [(v) => Array.isArray(v), "a list"],
  facet: [(v) => typeof v === "object" && v !== null && !Array.isArray(v), "a group of fields"],
};

/**
 * What is wrong with the shape of a definition: no class or one that does not exist, a field its class must declare and
 * does not, a field of the wrong kind, a field its class may not declare. Ranges and what names what are checked when
 * content is compiled.
 */
export function defFaults(d: Def): string[] {
  const has = d as unknown as Record<string, unknown>;
  const leaves = CLASSES.filter((r) => r.type === has.type && !r.abstract);
  if (leaves.length === 0) return [`${d.id}: unknown type "${String(has.type)}"`];
  const r = BY_ID.get(typeof has.class === "string" ? `${d.type}/${has.class}` : d.type);
  if (!r || r.abstract || r.type !== d.type) {
    const said = has.class === undefined ? "" : `, not "${String(has.class)}"`;
    if (leaves.length === 1 && leaves[0]!.id === d.type) return [`${d.id}: ${article(d.type)} has no class${said}`];
    return [`${d.id}: ${article(d.type)} says its class: ${leaves.map((l) => l.id.slice(d.type.length + 1)).join(", ")}${said}`];
  }
  const fields = FIELDS[d.type] as Record<string, Field>;
  const out: string[] = [];
  for (const k of r.must) if (has[k] === undefined) out.push(`${d.id}: class ${r.id} must declare "${k}"`);
  if (r.any.length > 0 && !r.any.some((k) => has[k] !== undefined)) out.push(`${d.id}: class ${r.id} must declare one of ${r.any.map((k) => `"${k}"`).join(", ")}`);
  for (const k of Object.keys(has)) {
    if (k === "type" || k === "class" || k === "id" || has[k] === undefined) continue;
    if (k === "aliases" && d.type !== "rename") {
      if (!Array.isArray(has[k]) || !has[k].every((a) => typeof a === "string")) out.push(`${d.id}: "aliases" must be a list of names`);
      continue;
    }
    if (!r.must.includes(k) && !r.may.includes(k)) out.push(`${d.id}: class ${r.id} may not declare "${k}"`);
    else if (!KIND[fields[k]!.kind][0](has[k])) out.push(`${d.id}: "${k}" must be ${KIND[fields[k]!.kind][1]}`);
  }
  return out;
}

/** Whether class `id` is `target` or below it: "item/saddle" is an "item/equipment" and an "item". */
function isA(id: string, target: string): boolean {
  for (let at: string | null = id; at !== null; at = BY_ID.get(at)?.parent ?? null) if (at === target) return true;
  return id.startsWith(target + "/");
}

/** The values at `path` in `v`: "" is `v`, "[]" each entry, "a.b" a field of a field, "a[]" each entry of a field. */
function pick(v: unknown, path: string): unknown[] {
  let at: unknown[] = [v];
  for (const part of path === "" ? [] : path.split(".")) {
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    at = at.flatMap((x) => {
      const y = key === "" ? x : (x as Record<string, unknown> | null)?.[key];
      return y === undefined || y === null ? [] : each ? (Array.isArray(y) ? y : []) : [y];
    });
  }
  return at;
}

/** What definitions name that does not exist or is of the wrong class. */
export function refFaults(defs: readonly Def[]): string[] {
  const classById = new Map(defs.map((d) => [d.id, classOf(d)]));
  const out: string[] = [];
  for (const d of defs) {
    const fields: Record<string, Field> = FIELDS[d.type];
    for (const [name, field] of Object.entries(fields)) {
      const value = (d as unknown as Record<string, unknown>)[name];
      if (!field.refs || value === undefined) continue;
      for (const [path, target] of Object.entries(field.refs)) {
        for (const id of pick(value, path)) {
          const is = typeof id === "string" ? classById.get(id) : undefined;
          if (is === undefined || !isA(is, target)) out.push(`${d.id}: "${String(id)}" is not ${article(target)}`);
        }
      }
    }
  }
  return out;
}
