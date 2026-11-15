// The class table: every kind of content, as ARK organises its own, with what each must and may declare and the assets
// it expects. A definition's `type` is its family and its class is a leaf of this table. A field its class neither must
// nor may declare is refused. The reference page, the shape checks and the asset slots are all derived from these rows.

import { FEATURES, type Feature } from "../features.ts";
import type { BuffDef, DamageDef, Def, EngramDef, GameDef, ItemDef, LevelsDef, LootDef, MapDef, MaterialDef, NodeDef, PropDef, RenameDef, ShapeDef, SpawnsDef, SpeciesDef, StructureDef } from "./defs.ts";

/** "built": systems read it. "partial": part of it lives in code. "stub": the row exists and nothing reads it yet. */
export type Status = "built" | "partial" | "stub";

export interface Field {
  kind: "text" | "number" | "switch" | "vec3" | "list" | "facet";
  /** ARK's name for the same thing, or "" for a field of our own. */
  ark: string;
  /** Paths in the field that name other definitions, and the class or family each must be. "" is the field itself, "[]" each entry. */
  refs?: Record<string, string>;
  /** Packs may add entries to it, and a remap rewrites what it names. */
  open?: boolean;
  /** A stub field is declared and checked, and nothing reads it until the feature it waits for is built. */
  waits?: Feature;
  /** Fields inside a facet that are stubs in the same sense, and the feature each waits for. The facet itself is read. */
  stubs?: Readonly<Record<string, Feature>>;
}

export interface Slot {
  asset: "mesh" | "rig" | "clip" | "icon" | "sound" | "effect";
  need: "must" | "may";
  /**
   * A slot with several values has one asset for each key: the keys listed, or every hair or beard style, or ("any")
   * whatever names the content gives.
   */
  keys?: readonly string[] | "hair" | "beard" | "any";
  /** The slot applies only to a definition that declares this field. */
  when?: string;
  /**
   * The asset's id by today's naming. `{id}` is the definition's id, `{mesh}` its mesh (its id, for a generated one),
   * `{a.b}` a field of it, `{key}` the slot's key, `{sex}` each sex, `{body}` each body a survivor may have.
   */
  from: string;
  /**
   * What stands in when the slot is empty, tried in order: an asset id written as `from` is, or a word for something
   * that needs no asset ("box", "shape", "swatch", "none", "hidden", "rigid", "rest", or "#slot" for another slot).
   */
  fallback: readonly string[];
}

export interface ClassRow {
  /** "item/weapon". A family with one class is its own leaf: "node". */
  id: string;
  type: Def["type"];
  parent: string | null;
  /** An abstract class groups others and no definition is of it. */
  abstract: boolean;
  ark: string;
  status: Status;
  waits: Feature | "";
  /** Where its definitions sit under their pack: "items/weapons". */
  shelf: string;
  must: readonly string[];
  may: readonly string[];
  /** At least one of these must be present. */
  any: readonly string[];
  slots: Readonly<Record<string, Slot>>;
  doc: string;
}

const f = (kind: Field["kind"], ark = "", more: Partial<Field> = {}): Field => ({ kind, ark, ...more });
const stub = (waits: Feature, kind: Field["kind"], ark = "", more: Partial<Field> = {}): Field => ({ kind, ark, waits, ...more });

type Fields<D> = { [K in Exclude<keyof D, "type" | "class" | "id" | "aliases">]-?: Field };

const ITEM = {
  stack: f("number", "MaxItemQuantity"),
  weight: f("number", "BaseItemWeight"),
  spoilHours: f("number", "SpoilingTime"),
  decomposeHours: f("number", "the time a dropped item decomposes in"),
  youngFor: f("text", "prime meat from the young in place of raw meat", { refs: { "": "item" } }),
  eat: f("facet", "UseItemAddCharacterStatusValues"),
  fuel: f("number"),
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
  places: f("list", "StructureToBuild", { refs: { "[]": "structure" }, open: true }),
  craft: f("facet", "BaseCraftingResourceRequirements, BlueprintTimeToCraft, BaseCraftingXP", { refs: { "needs[].item": "item", at: "structure/station" } }),
  description: stub("polish", "text", "ItemDescription"),
  folder: stub("polish", "text", "DefaultFolderPaths"),
  spoilsInto: f("text", "SpoilingItem", { refs: { "": "item" } }),
  blueprint: f("switch", "whether it may be a blueprint (a crafted item may, unless false)"),
  use: f("facet", "UseItemAddCharacterStatusValues and the buffs a consumable gives", { refs: { "buffs[]": "buff" } }),
  travels: f("switch", "bPreventUpload, inverted"),
} satisfies Fields<ItemDef>;

const SPECIES = {
  mesh: f("text"),
  skeleton: f("text"),
  color: f("number"),
  radius: f("number"),
  height: f("number"),
  eyeHeight: f("number"),
  walkSpeed: f("number"),
  sprintMul: f("number"),
  jumpSpeed: f("number"),
  crouch: f("facet"),
  prone: f("facet"),
  turn: f("number"),
  strafe: f("switch"),
  swimSpeed: f("number"),
  stamina: f("facet"),
  food: f("facet"),
  waterPerHour: f("number"),
  slots: f("number"),
  keeps: f("number", "GetSpoilingTimeMultiplier of its inventory"),
  equips: f("switch"),
  fists: f("number"),
  fistsTorpor: f("number", "the torpor of a bare-handed strike"),
  drops: f("list", "DeathHarvestingComponent", { refs: { "[].item": "item" }, open: true }),
  corpse: f("facet", "DeathHarvestingComponent's health and damage per roll"),
  stats: f("facet", "MaxStatusValues and the per-level gains"),
  takes: f("facet", "DamageTypeAdjusters"),
  zones: f("facet"),
  killXp: f("number"),
  still: f("switch"),
  temper: f("text"),
  sight: f("number"),
  leash: f("number"),
  bite: f("facet", "AttackInfos"),
  taming: f("facet", "RequiredTameAffinity"),
  eats: f("list", "DinoSettings food effectiveness", { refs: { "[].item": "item" }, open: true }),
  torporDrain: f("number"),
  breeds: f("facet", "EggItemsToSpawn, BabyAgeSpeed", { refs: { egg: "prop/egg" } }),
  tag: f("text", "DinoNameTag"),
  regions: f("list", "the ColorSetDefinitions of RandomColorSetsMale, PreventColorizationRegions"),
  mutations: f("list"),
  alarm: f("number", "the herd that flees with a creature when it is hurt"),
  tamedSprintMul: f("number", "the tamed running speed"),
  drag: f("number", "drag weight"),
  mass: f("number", "mass"),
  carriable: f("switch", "picked up and thrown by a player"),
  feces: f("text", "the creature's feces item", { refs: { "": "item/feces" } }),
  eggChance: f("number", "the chance of an egg in place of feces"),
  variant: stub("bosses", "text", "a child blueprint's kind"),
  attacks: stub("polish", "list", "AttackInfos"),
  loot: stub("loot", "text", "DeathInventoryTemplates", { refs: { "": "loot" } }),
  saddle: stub("polish", "text", "SaddleItemClass", { refs: { "": "item/saddle" } }),
  buffs: stub("polish", "list", "DefaultBuffs", { refs: { "[]": "buff" }, open: true }),
  boss: stub("bosses", "switch", "bIsBossDino"),
} satisfies Fields<SpeciesDef>;

const STRUCTURE = {
  mesh: f("text"),
  color: f("number"),
  half: f("vec3"),
  shape: f("text", "SnapPoints", { refs: { "": "shape" } }),
  hp: f("number", "Health"),
  material: f("text", "StructureSettingsClass", { refs: { "": "material" } }),
  slots: f("number", "an inventory component"),
  opens: f("text", "", { refs: { "": "structure" } }),
  locked: f("switch"),
  falls: f("switch"),
  decayDays: f("number", "DecayDestructionPeriod"),
  lights: f("text", "", { refs: { "": "structure" } }),
  lit: f("switch"),
  bed: f("switch"),
  wait: f("number"),
  once: f("switch"),
  floor: f("switch"),
  rise: f("vec3"),
} satisfies Fields<StructureDef>;

const NODE = {
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
} satisfies Fields<NodeDef>;

const PROP = {
  mesh: f("text"),
  color: f("number"),
  radius: f("number"),
  height: f("number"),
  slots: f("number"),
  pitched: f("switch"),
  size: f("number", "the egg's size class"),
  item: f("text", "the egg item a dropped egg is", { refs: { "": "item/egg" } }),
  fertile: f("text", "the egg item a fertilised egg is", { refs: { "": "item/egg" } }),
} satisfies Fields<PropDef>;

const ENGRAM = {
  label: f("text"),
  level: f("number", "RequiredCharacterLevel"),
  cost: f("number", "RequiredEngramPoints"),
  item: f("text", "BluePrintEntry", { refs: { "": "item" } }),
  hidden: f("switch", "EngramHidden"),
  auto: f("number", "EngramEntryAutoUnlocks"),
  requires: stub("polish", "list", "EngramRequirementSets", { refs: { "[]": "engram" } }),
  group: stub("maps", "text", "EngramGroup"),
  from: stub("bosses", "text", "a boss's unlock", { refs: { "": "species/creature" } }),
} satisfies Fields<EngramDef>;

const LEVELS = {
  xp: f("list", "LevelExperienceRampOverrides"),
  engramPoints: f("list", "OverridePlayerLevelEngramPoints"),
  most: f("number", "OverrideMaxExperiencePointsPlayer"),
  tame: f("facet", "the tames' ramp"),
} satisfies Fields<LevelsDef>;

const BUFF = {
  label: f("text"),
  color: f("number"),
  seconds: f("number", "DeactivateAfterTime"),
  again: f("text"),
  health: f("number", "ValuesToAddPerSecond"),
  torpor: f("number", "ValuesToAddPerSecond"),
  damage: f("text"),
  speed: f("number", "CharacterMultiplier"),
  dealt: f("number", "CharacterMultiplier"),
  taken: f("number", "CharacterMultiplier"),
  root: f("switch"),
  immune: f("switch"),
  good: stub("polish", "switch"),
  // Built by W4 of planning/reference/weapons-plan.md (server/entangle.ts gives a buff that names them).
  only: f("list", "the species a bola takes (Bola)", { refs: { "[]": "species" } }),
  survivorSeconds: f("number", "a bola's time on a survivor"),
  after: f("text", "", { refs: { "": "buff" } }),
} satisfies Fields<BuffDef>;

const MATERIAL = {
  takes: f("facet", "the structure settings' damage by type"),
  decayDays: f("number", "DecayDestructionPeriodMultiplier"),
} satisfies Fields<MaterialDef>;

const SHAPE = {
  role: f("text", "the snap type"),
  boxes: f("list"),
  hulls: f("list"),
  look: f("facet"),
  doorway: f("switch"),
} satisfies Fields<ShapeDef>;

const DAMAGE = {
  label: stub("polish", "text"),
  torpor: stub("polish", "number", "DamageTorpidityIncreaseMultiplier"),
  trueShare: stub("polish", "number", "PercentTrueDamage"),
  melee: stub("polish", "switch", "bIsMeleeDamage"),
} satisfies Fields<DamageDef>;

const LOOT = {
  sets: f("facet", "MinItemSets, MaxItemSets"),
  from: f("list", "ItemSets", { refs: { "[].entries[].items[]": "item" }, open: true }),
} satisfies Fields<LootDef>;

const SPAWNS = {
  entries: f("list", "NPCSpawnEntries", { refs: { "[].group[]": "species/creature" }, open: true }),
  limits: f("list", "NPCSpawnLimits", { refs: { "[].species": "species/creature" } }),
} satisfies Fields<SpawnsDef>;

const MAP = {
  label: stub("maps", "text"),
  chunks: f("list"),
  seaLevel: f("number"),
  game: stub("maps", "text", "the game data a level names", { refs: { "": "game" } }),
  zones: f("list", "zone managers and crate volumes", { refs: { "[].spawns": "spawns", "[].crate": "prop/crate" } }),
} satisfies Fields<MapDef>;

const GAME = {
  survivor: f("text", "", { refs: { "": "species/survivor" } }),
  cache: f("text", "", { refs: { "": "prop/container" } }),
  bag: f("text", "", { refs: { "": "prop/container" } }),
  levels: f("text", "", { refs: { "": "levels" } }),
  buffs: f("list", "AdditionalDefaultBuffs", { refs: { "[]": "buff" }, open: true }),
} satisfies Fields<GameDef>;

const RENAME = {
  to: f("list", "a reference redirect"),
} satisfies Fields<RenameDef>;

/** Every field of every family that has a definition type. */
export const FIELDS: Readonly<Record<Def["type"], Readonly<Record<string, Field>>>> = {
  item: ITEM,
  species: SPECIES,
  structure: STRUCTURE,
  node: NODE,
  prop: PROP,
  engram: ENGRAM,
  levels: LEVELS,
  buff: BUFF,
  material: MATERIAL,
  shape: SHAPE,
  damage: DAMAGE,
  loot: LOOT,
  spawns: SPAWNS,
  map: MAP,
  game: GAME,
  rename: RENAME,
};

const mesh = (need: Slot["need"], from: string, ...fallback: string[]): Slot => ({ asset: "mesh", need, from, fallback });
const icon: Slot = { asset: "icon", need: "may", from: "{id}/icon", fallback: ["swatch"] };
const ITEM_SLOTS = { icon, dropped: mesh("may", "{id}/dropped", "core:bag") };
const BODY_PARTS = ["head", "torso", "hands", "legs", "feet"] as const;

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
row("item/resource", "item", ITEM, { parent: "item", ark: "PrimalItemResource_", shelf: "items/resources", must: ["stack"], may: [...ANY_ITEM, "fuel", "spoilHours", "spoilsInto", "youngFor", "ammo"], slots: { shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "A material: gathered, stacked, and spent in crafting. One a weapon fires, as a slingshot fires stone, has an ammo facet." });
row("item/consumable", "item", ITEM, { parent: "item", ark: "PrimalItemConsumable_", shelf: "items/consumables", must: ["stack"], may: [...ANY_ITEM, "eat", "dose", "spoilHours", "spoilsInto", "cooks", "fuel", "youngFor", "use"], any: ["eat", "dose", "use"], slots: ITEM_SLOTS, doc: "Something eaten, drunk or fed for what it does to a body." });
row("item/weapon", "item", ITEM, { parent: "item", ark: "PrimalItem_Weapon", shelf: "items/weapons", must: ["stack", "weapon"], may: [...ANY_ITEM, "tool", "ammo"], slots: { held: mesh("must", "{weapon.mesh}", "none"), shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "Held in the hand to strike, shoot or throw. A hatchet or pick is a weapon that is also a tool. A thrown one with an ammo facet of its own flies and hits as an arrow does (the bola)." });
row("item/ammo", "item", ITEM, { parent: "item", ark: "PrimalItemAmmo_", shelf: "items/ammo", must: ["stack", "ammo"], may: ANY_ITEM, slots: { shot: mesh("may", "{ammo.mesh}", "core:tracer"), ...ITEM_SLOTS }, doc: "What a bow or gun fires." });
row("item/attachment", "item", ITEM, { parent: "item", ark: "item type WeaponAttachment", shelf: "items/attachments", must: ["stack", "attachment"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Fitted to a weapon that takes it." });
row("item/equipment", "item", ITEM, { parent: "item", abstract: true, ark: "item type Equipment", shelf: "items/equipment", doc: "Worn by a body, in a slot." });
row("item/armor", "item", ITEM, { parent: "item/equipment", ark: "PrimalItemArmor_, hat to boots", shelf: "items/armor", must: ["stack", "wear"], may: ANY_ITEM, slots: { worn: mesh("must", "{body}/armor/{wear.set}/{wear.slot}", "{body}/{wear.slot}"), ...ITEM_SLOTS }, doc: "A piece worn on the head, torso, hands, legs or feet." });
row("item/saddle", "item", ITEM, { parent: "item/equipment", ark: "PrimalItemArmor_, DinoSaddle", shelf: "items/saddles", must: ["stack", "saddle"], may: ANY_ITEM, slots: { worn: mesh("may", "{id}/worn", "none"), ...ITEM_SLOTS }, doc: "Worn by a tamed creature so that it can be ridden." });
row("item/structure", "item", ITEM, { parent: "item", ark: "PrimalItemStructure_", shelf: "items/structures", must: ["stack", "places"], may: ANY_ITEM, slots: { preview: mesh("may", "{id}/preview", "#mesh"), ...ITEM_SLOTS }, doc: "Set down as a structure." });
row("item/egg", "item", ITEM, { parent: "item/consumable", ark: "PrimalItemConsumable_Egg_", shelf: "items/eggs", must: ["stack"], may: [...ANY_ITEM, "eat", "spoilHours", "spoilsInto"], slots: ITEM_SLOTS, doc: "An egg in the hand, eaten or set down. A fertilised one stacks to 1, keeps its young and does not hatch while held." });
row("item/feces", "item", ITEM, { parent: "item/resource", ark: "the feces items, small to massive", shelf: "items/feces", must: ["stack"], may: [...ANY_ITEM, "spoilHours", "spoilsInto", "fuel"], slots: ITEM_SLOTS, doc: "What a creature leaves when it defecates, a size for each kind of creature." });
row("item/shield", "item", ITEM, { parent: "item/equipment", ark: "equipment type Shield", status: "stub", waits: "cosmetics", shelf: "items/shields", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Held in the other hand to block." });
row("item/costume", "item", ITEM, { parent: "item/equipment", ark: "equipment types Costume and Trophy", status: "stub", waits: "cosmetics", shelf: "items/costumes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Worn for its look alone." });
row("item/skin", "item", ITEM, { parent: "item", ark: "PrimalItemSkin_", status: "stub", waits: "cosmetics", shelf: "items/skins", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Changes the look of the item it is put on." });
row("item/dye", "item", ITEM, { parent: "item", ark: "PrimalItemDye_", status: "stub", waits: "cosmetics", shelf: "items/dyes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Colours a region of what it is used on." });
row("item/artifact", "item", ITEM, { parent: "item", ark: "PrimalItemArtifact_", status: "stub", waits: "bosses", shelf: "items/artifacts", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Found once in its place and spent to call a boss." });

row("engram", "engram", ENGRAM, { ark: "EngramEntry_", shelf: "engrams", must: ["label", "level", "cost", "item"], may: ["hidden", "auto", "requires", "group", "from"], slots: { icon: { ...icon, fallback: ["#icon"] } }, doc: "Learned with points at a level, for good. Its one item can then be made." });
row("levels", "levels", LEVELS, { ark: "the level ramp of the game data", shelf: "rules", must: ["xp", "engramPoints"], may: ["most", "tame"], doc: "The experience each level takes and the engram points it gives." });

const BODY = ["mesh", "color", "radius", "height", "eyeHeight", "walkSpeed", "sprintMul", "jumpSpeed"] as const;
const HUMAN_SLOTS = {
  body: { asset: "mesh", need: "must", keys: BODY_PARTS, when: "skeleton", from: "{mesh}_{sex}/{key}", fallback: ["{mesh}/{key}", "core:mannequin/{key}"] },
  hair: { asset: "mesh", need: "may", keys: "hair", when: "skeleton", from: "{mesh}_{sex}/hair/{key}", fallback: ["none"] },
  beard: { asset: "mesh", need: "may", keys: "beard", when: "skeleton", from: "{mesh}_{sex}/beard/{key}", fallback: ["none"] },
  icon,
} satisfies Record<string, Slot>;
row("species", "species", SPECIES, { abstract: true, ark: "a character", shelf: "species", doc: "A kind of body that lives." });
row("species/survivor", "species", SPECIES, { parent: "species", ark: "the player's character", shelf: "survivors", must: [...BODY, "skeleton", "stats", "equips"], may: ["crouch", "prone", "swimSpeed", "stamina", "food", "waterPerHour", "slots", "fists", "fistsTorpor", "drops", "takes", "zones", "killXp", "torporDrain"], slots: HUMAN_SLOTS, doc: "The body a player has." });
row("species/creature", "species", SPECIES, {
  parent: "species",
  ark: "a creature's character, its status component and its entry",
  shelf: "creatures",
  must: [...BODY, "stats"],
  may: ["skeleton", "turn", "strafe", "swimSpeed", "stamina", "food", "slots", "keeps", "fists", "bite", "drops", "corpse", "takes", "zones", "killXp", "temper", "sight", "leash", "taming", "eats", "torporDrain", "breeds", "still", "tag", "regions", "mutations", "alarm", "tamedSprintMul", "drag", "mass", "carriable", "feces", "eggChance", "fistsTorpor", "variant", "attacks", "loot", "saddle", "buffs", "boss"],
  slots: {
    body: mesh("must", "{mesh}", "box"),
    rig: { asset: "rig", need: "must", when: "skeleton", from: "{mesh}", fallback: ["rigid"] },
    clip: { asset: "clip", need: "must", keys: ["idle", "walk", "run", "attack", "death"], when: "skeleton", from: "{mesh}/{key}", fallback: ["{mesh}/idle", "rest"] },
    // Without one, what it does besides goes on.
    move: { asset: "clip", need: "may", keys: ["swim", "swim_idle", "fall", "land", "turn", "startled", "flinch", "call", "torpor_eat", "held", "carried", "jump"], when: "skeleton", from: "{mesh}/{key}", fallback: ["none"] },
    torpor: { asset: "clip", need: "may", keys: ["torpor_in", "torpor_idle", "torpor_out"], when: "skeleton", from: "{mesh}/{key}", fallback: ["{mesh}/death", "rest"] },
    icon,
    sound: { asset: "sound", need: "may", keys: "any", from: "{id}/sound/{key}", fallback: ["none"] },
  },
  doc: "A wild thing that may be tamed, ridden and bred.",
});
row("species/target", "species", SPECIES, { parent: "species", ark: "none, ours", shelf: "targets", must: [...BODY, "skeleton", "still"], may: ["stats", "equips", "slots", "zones", "takes", "torporDrain", "crouch", "prone", "stamina", "fists", "food", "drops", "killXp"], slots: HUMAN_SLOTS, doc: "A human-shaped body that stands where it is put, to be practised on. A creature that must stand still is a creature that says so." });

const BUILT = ["mesh", "color", "half", "hp"] as const;
const STRUCTURE_SLOTS = { mesh: mesh("must", "{mesh}", "shape"), destroyed: mesh("may", "{id}/destroyed", "none"), preview: mesh("may", "{id}/preview", "#mesh") };
row("structure", "structure", STRUCTURE, { abstract: true, ark: "APrimalStructure", shelf: "structures", doc: "Anything built or standing in the world that is not alive." });
row("structure/piece", "structure", STRUCTURE, { parent: "structure", ark: "a structure with snap points", shelf: "structures/pieces", must: [...BUILT, "shape", "material"], may: ["opens", "locked", "decayDays", "falls"], slots: STRUCTURE_SLOTS, doc: "A foundation, wall, ceiling, pillar, door or stair: it joins others and holds them up." });
row("structure/container", "structure", STRUCTURE, { parent: "structure", ark: "an item container", shelf: "structures/containers", must: [...BUILT, "slots"], may: ["shape", "material", "decayDays", "locked", "falls"], slots: STRUCTURE_SLOTS, doc: "Holds stacks: a box, a vault." });
row("structure/station", "structure", STRUCTURE, { parent: "structure/container", ark: "a crafting inventory with its engrams and speed", status: "partial", waits: "stations", shelf: "structures/stations", must: BUILT, may: ["shape", "material", "decayDays", "locked", "falls", "slots", "lights", "lit"], slots: STRUCTURE_SLOTS, doc: "Things are made or changed at it: fuel burns and food cooks, and an item whose craft names it in `at` is made from what lies in it. How fast it makes things waits." });
row("structure/bed", "structure", STRUCTURE, { parent: "structure", ark: "a bed", shelf: "structures/beds", must: [...BUILT, "bed"], may: ["shape", "material", "decayDays", "falls", "wait", "once", "floor", "rise"], slots: STRUCTURE_SLOTS, doc: "Its tribe may come back to life at it, after its wait, and travel to it from another; a sleeping bag once, and only for whoever set it down." });
row("structure/static", "structure", STRUCTURE, { parent: "structure", ark: "level geometry, ours", shelf: "structures/static", must: BUILT, may: ["material", "shape"], slots: { mesh: mesh("must", "{mesh}", "box", "shape") }, doc: "Part of a map: set there with the world and joined to nothing. With a shape it may be sloped." });
row("structure/defence", "structure", STRUCTURE, { parent: "structure", ark: "turrets and spikes", status: "stub", waits: "defences", shelf: "structures/defences", must: BUILT, may: ["shape", "material", "decayDays", "falls", "slots"], slots: STRUCTURE_SLOTS, doc: "Harms what comes near it." });
row("shape", "shape", SHAPE, { ark: "snap points and collision", shelf: "shapes", must: ["role", "boxes"], may: ["doorway", "hulls", "look"], doc: "The form of a piece, shared by every material: what bodies walk on and what joins what." });
row("material", "material", MATERIAL, { ark: "StructureSettings and its tier", shelf: "materials", must: ["takes"], may: ["decayDays"], doc: "What each type of damage does to what is built of it, and how long it lasts unvisited." });

row("node", "node", NODE, { ark: "a foliage type and its harvest component", shelf: "nodes", must: ["mesh", "color", "half", "hits", "respawnHours", "yields", "xp"], may: ["top", "soft", "material", "variants", "size", "depleted", "footing"], slots: { mesh: mesh("must", "{mesh}", "box"), depleted: { ...mesh("may", "{depleted.mesh}", "hidden"), when: "depleted" } }, doc: "A tree, a rock, a bush: harvested, used up, and grown back. Each node is one of its variants, turned and sized by its place." });

const PROP_BODY = ["mesh", "color", "radius", "height"] as const;
const PROP_SLOTS = { mesh: mesh("must", "{mesh}", "box") };
row("prop", "prop", PROP, { abstract: true, ark: "an actor that is not alive", shelf: "props", doc: "Stands in the world and neither moves nor lives." });
row("prop/container", "prop", PROP, { parent: "prop", ark: "a death cache, a dropped bag", shelf: "props/containers", must: [...PROP_BODY, "slots"], slots: PROP_SLOTS, doc: "Holds what was dropped or left by the dead." });
row("prop/projectile", "prop", PROP, { parent: "prop", ark: "a projectile actor", status: "partial", shelf: "props/projectiles", must: PROP_BODY, may: ["pitched"], slots: PROP_SLOTS, doc: "Something loosed or thrown, where it lies. How it flies is on the ammunition." });
row("prop/egg", "prop", PROP, { parent: "prop", ark: "a laid or dropped egg, fertilised or not", shelf: "props/eggs", must: PROP_BODY, may: ["size", "item", "fertile"], slots: PROP_SLOTS, doc: "An egg where it lies: taken up as its item, and hatching where it lies if fertilised." });
row("prop/cloud", "prop", PROP, { parent: "prop", ark: "the gas and smoke actors of grenades", shelf: "props/clouds", must: PROP_BODY, slots: PROP_SLOTS, doc: "Smoke or gas that stays where a grenade burst, as far as its radius and as high as its height, for its grenade's seconds, giving its buff to the survivors inside it every half second (server/clouds.ts). It has no body, and is drawn as puffs over that reach (client/core/render/clouds.ts); its mesh is not drawn." });
row("prop/crate", "prop", PROP, { parent: "prop", ark: "SupplyCrate_", status: "stub", waits: "loot", shelf: "props/crates", must: PROP_BODY, may: ["slots"], slots: PROP_SLOTS, doc: "Comes down with loot and goes when it is emptied." });

row("buff", "buff", BUFF, { ark: "Buff_", shelf: "buffs", must: ["label", "color"], may: ["seconds", "again", "health", "torpor", "damage", "speed", "dealt", "taken", "root", "immune", "good", "only", "survivorSeconds", "after"], slots: { icon, effect: { asset: "effect", need: "may", from: "{id}/effect", fallback: ["none"] } }, doc: "Acts on a body for a time." });

row("damage", "damage", DAMAGE, { ark: "DmgType_", status: "partial", waits: "polish", shelf: "damage", may: ["label", "torpor", "trueShare", "melee"], doc: "A type of harm. Five are named in code: melee, pierce, bullet, fire, explosive." });
row("loot", "loot", LOOT, { ark: "a crate's item sets, a death inventory template", status: "partial", waits: "loot", shelf: "loot", must: ["from"], may: ["sets"], doc: "Sets of items with weights, counts, qualities and blueprint chances. A seeded roll draws from it (shared/sim/loot.ts) and the console's loot mints one; what opens a crate or leaves a body waits for map zones." });
row("spawns", "spawns", SPAWNS, { ark: "NPCSpawnEntriesContainer", shelf: "spawns", must: ["entries"], may: ["limits"], doc: "Which creatures live in a place, in what share and in what groups. A map's spawn zones name these." });
row("map", "map", MAP, { ark: "a level and the game data it names", status: "partial", waits: "maps", shelf: "maps", must: ["chunks"], may: ["label", "seaLevel", "game", "zones"], doc: "A world. Its ground is the map file that carries its id, and its zones say what spawns, grows and drops where. A spawn zone with a spawns definition is kept stocked from it; one without is where a test's starting creatures are put." });
row("game", "game", GAME, { ark: "PrimalGameData", status: "stub", waits: "polish", shelf: "game", must: ["survivor", "cache", "bag"], may: ["levels", "buffs"], doc: "What a game names once: the survivor's species, the death cache, the dropped bag, the standing buffs." });

row("rename", "rename", RENAME, { ark: "a redirect for a class that was renamed", shelf: "renames", must: ["to"], doc: "An id that is no longer defined, and what it is called now. Saves and settings that use it still read." });

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
