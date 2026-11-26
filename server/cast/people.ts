// Cast's people: everyone it keeps, featured and extra. An extra is a seed and an archetype, its name, look and leanings
// drawn from the seed whenever wanted, so thousands cost little; promoted (a player engaged it, or it plays a featured
// part), its life is drawn once and kept, with facts and what it thinks of each player, and a featured person comes back
// in later scenes (Shadow of Mordor's nemesis: the gang member who drew on you last week). A body is drawn from the seed,
// the population and the outfit as they are now; only a named person's is saved, in its own record.

import type { Archetype, Catalogue, Look, Traits } from "../../shared/cast/catalogue.ts";
import type { Character, Fact } from "../../shared/cast/state.ts";
import type { PopulationDef } from "../../shared/content/kinds/populations.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Bodies, PersonDoc, Revision, RevisedKind, WornDoc } from "../../shared/people/doc.ts";
import { dyeNumber, partSeed, personFrom, populationsOf, sexOf, wardrobeFrom, wireNumber } from "../../shared/people/person.ts";
import { Rng } from "../../shared/rng.ts";
import type { Born } from "../../shared/sim/entities.ts";

/** Facts a person keeps; past this the oldest unlocked go (the keeper's summaries keep what matters). */
export const MOST_FACTS = 12;
/** Notes kept of what passed with one player. */
export const MOST_NOTES = 6;

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)]!;

/** The population a look names where it names none. */
export const CAST_POPULATION = "core:people_city";
/** Mixed with a named person's store id for its character's seed. */
const NAMED_TAG = 0x6e616d65;
/** Seeds tried for a person of its name's sex before the first is kept whatever it gives. */
const SEX_TRIES = 16;

/** What Cast reads of the cluster's people store (server/people/store.ts): a thing's latest revision, and an admin
 * population's revision as the generator takes it. */
export interface CastStore {
  latest<K extends RevisedKind>(kind: K, id: number): Revision<Bodies[K]> | undefined;
  population(id: number, rev: number): PopulationDef | undefined;
}

/** A look and outfit an admin chose for a catalogue look, by store id (shared/cast/state.ts Casting). */
export type LookChoice = { readonly population?: number; readonly outfit?: number };

/** One wardrobe slot worn: the garment by item id, its edition and its dye as one number. */
export type Worn = readonly [string, number, number];

/** A body as drawn: its look, the seed form it goes as (null to send the bytes) and what it wears. */
export interface CastBody {
  readonly look: Uint8Array;
  readonly born: Born | null;
  readonly wear: readonly string[];
  readonly wardrobe: readonly (Worn | null)[];
}

/** A population by content id (revision 0: it has none), or by store id at its latest revision. */
function populationBy(ref: string | number, reg: Registry, store: CastStore | null): { p: PopulationDef; rev: number } | undefined {
  if (typeof ref === "string") {
    const people = populationsOf(reg), n = people.number.get(ref);
    return n === undefined ? undefined : { p: people.list[n]!, rev: 0 };
  }
  const rev = store?.latest("population", ref)?.rev, p = rev === undefined ? undefined : store?.population(ref, rev);
  return p && { p, rev: rev! };
}

const wornOf = (w: WornDoc | null): Worn | null => (w ? [w.garment, w.edition, dyeNumber(w.dye)] : null);
const isGarment = (id: string, reg: Registry): boolean => (reg.garmentSlot[reg.index.get(id) ?? -1] ?? -1) >= 0;

/** A role's pieces a body wears: all of them, but cloth where it wears a garment. Cloth stands in for clothes; armour stays. */
function roleWear(wear: readonly string[], dressed: boolean, reg: Registry): readonly string[] {
  if (!dressed) return wear;
  return wear.filter((id) => {
    const d = reg.defs[reg.index.get(id) ?? -1];
    return !(d?.type === "item" && d.wear?.set === "cloth");
  });
}

/**
 * The person a character's body is, from its seed and its look's population (an admin's choice of population first): of
 * its first name's sex where the catalogue knows it. What an admin chose takes its slots first: an admin outfit chosen for
 * the look, then an admin population's own outfit, armour or garments. The look's pieces fill the slots left, less its
 * cloth where a garment is worn. Null where no population it names is held.
 */
export function castPerson(c: Character, look: Look | undefined, cat: Catalogue, reg: Registry, store: CastStore | null = null, choice?: LookChoice) {
  let ref: string | number = CAST_POPULATION, by: { p: PopulationDef; rev: number } | undefined;
  for (const r of [choice?.population, look?.population, CAST_POPULATION]) if (!by && r !== undefined && (by = populationBy(r, reg, store))) ref = r;
  const number = by ? wireNumber(reg, ref) : undefined;
  if (!by || number === undefined) return null;
  const p = by.p;
  const wanted = cat.sexes?.[c.name.split(" ")[0]!];
  let seed = c.seed >>> 0;
  for (let k = 1; wanted !== undefined && k < SEX_TRIES && sexOf(seed, p) !== wanted; k++) seed = partSeed(c.seed, 0x100 + k);
  if (wanted !== undefined && sexOf(seed, p) !== wanted) seed = c.seed >>> 0;
  const person = personFrom(seed, p);
  const outfit = choice?.outfit !== undefined ? store?.latest("outfit", choice.outfit) : undefined;
  const wardrobe = outfit ? wardrobeFrom(c.seed >>> 0, outfit.body).map(wornOf) : [];
  const own = person.outfit >= 0 ? p.outfits![person.outfit]!.wear : null;
  // A content population's outfit dresses only a look that wears nothing.
  const chosen = typeof ref === "number" ? own ?? [] : [];
  const role = look?.wear.length ? look.wear : typeof ref === "number" ? [] : own ?? [];
  const wear = [...chosen, ...roleWear(role, wardrobe.some((w) => w) || chosen.some((id) => isGarment(id, reg)), reg)];
  return { person, born: { seed, population: number, revision: by.rev } as Born, wear, wardrobe };
}

/** A named person's body: its look's bytes and its wardrobe as saved, never a seed form, and its role's armour. */
function namedBody(rec: Revision<PersonDoc>, look: Look | undefined, reg: Registry): CastBody {
  const wardrobe = (rec.body.wardrobe ?? []).map(wornOf);
  return { look: Uint8Array.from(rec.body.look), born: null, wear: roleWear(look?.wear ?? [], wardrobe.some((w) => w), reg), wardrobe };
}

/** The body a character is drawn as: a named person's record as it is now, anyone else drawn from its look. */
export function castBody(c: Character, look: Look | undefined, cat: Catalogue, reg: Registry, store: CastStore | null, choice?: LookChoice): CastBody | null {
  const rec = c.person !== undefined ? store?.latest("person", c.person) : undefined;
  if (rec) return namedBody(rec, look, reg);
  const made = castPerson(c, look, cat, reg, store, choice);
  return made && { look: made.person.look, born: made.born, wear: made.wear, wardrobe: made.wardrobe };
}

export class People {
  readonly byId = new Map<string, Character>();
  private next = 1;
  private readonly cat: Catalogue;
  private readonly archetypes: Map<string, Archetype>;

  constructor(cat: Catalogue) {
    this.cat = cat;
    this.archetypes = new Map(cat.archetypes.map((a) => [a.id, a]));
  }

  archetype(id: string): Archetype | undefined {
    return this.archetypes.get(id);
  }

  /** A new person of an archetype, belonging to a region. Featured archetypes start featured, with a life. */
  mint(archetype: string, home: number, seed: number, tick: number): Character {
    const a = this.archetypes.get(archetype);
    if (!a) throw new Error(`cast: no archetype ${archetype}`);
    const rng = new Rng(seed);
    const traits = {} as Traits;
    for (const k of ["calm", "social", "bold", "playful"] as const) {
      const [lo, hi] = a.traits?.[k] ?? [0.2, 0.8];
      traits[k] = Math.round(rng.range(lo, hi) * 100) / 100;
    }
    const c: Character = {
      id: `c${this.next++}`, tier: "extra", archetype, look: pick(rng, a.looks), name: pick(rng, this.cat.names[a.names]!), seed, traits, home,
      facts: [], relations: {}, touched: tick,
    };
    this.byId.set(c.id, c);
    if (a.tier === "featured") this.promote(c, tick);
    return c;
  }

  /** A character for named person `person` of the people store, by its name, of an archetype: featured from the start. */
  mintNamed(archetype: string, home: number, person: number, name: string, tick: number): Character {
    const c = this.mint(archetype, home, partSeed(person, NAMED_TAG), tick);
    c.name = name;
    c.person = person;
    this.promote(c, tick);
    return c;
  }

  /** Made featured: its life is drawn from its seed and its archetype's seeds of one, and kept from now on. */
  promote(c: Character, tick: number): void {
    if (c.tier === "featured") return;
    const a = this.archetypes.get(c.archetype)!;
    const rng = new Rng(c.seed ^ 0x5bd1e995);
    c.tier = "featured";
    c.want = pick(rng, a.wants);
    c.struggle = pick(rng, a.struggles);
    c.hope = pick(rng, a.hopes);
    c.touched = tick;
  }

  /** A featured person of one of the archetypes, free (in no story, alive, not in `not`), from the region or near it: one
   * who knows any of `players` first, then the oldest untouched, so the city's regulars come round again. */
  free(archetypes: readonly string[], region: number, near: (home: number) => boolean, not: ReadonlySet<string> = new Set(), players: readonly string[] = []): Character | null {
    let best: Character | null = null, bestKnows = false;
    for (const c of this.byId.values()) {
      if (c.tier !== "featured" || c.story || c.dead || not.has(c.id) || !archetypes.includes(c.archetype)) continue;
      if (c.home !== region && !near(c.home)) continue;
      // One who knows a player near comes first: the jogger you waved at, the gang member who drew on you.
      const knows = players.some((n) => c.relations[n]);
      if (!best || (knows && !bestKnows) || (knows === bestKnows && c.touched < best.touched)) (best = c), (bestKnows = knows);
    }
    return best;
  }

  remember(c: Character, text: string, tick: number, locked = false): void {
    const f: Fact = { text: text.slice(0, 160), t: tick, ...(locked ? { locked: true } : {}) };
    c.facts.push(f);
    while (c.facts.length > MOST_FACTS) {
      const i = c.facts.findIndex((x) => !x.locked);
      if (i < 0) break;
      c.facts.splice(i, 1);
    }
  }

  /** A player met it: they know each other a little better (or worse), and the person is featured from now on. */
  met(c: Character, player: string, stance: number, note: string, tick: number): void {
    this.promote(c, tick);
    const r = (c.relations[player] ??= { stance: 0, met: 0, last: tick, notes: [] });
    r.met++;
    r.last = tick;
    r.stance = Math.max(-1, Math.min(1, r.stance + stance));
    if (note) {
      r.notes.push(note.slice(0, 120));
      if (r.notes.length > MOST_NOTES) r.notes.shift();
    }
  }

  /** Extras in no story and not met by anyone are only a seed: they go, and are minted again when needed. */
  forgetIdleExtras(): number {
    let n = 0;
    for (const c of this.byId.values()) {
      if (c.tier === "extra" && !c.story && !c.facts.length && !Object.keys(c.relations).length) (this.byId.delete(c.id), n++);
    }
    return n;
  }

  /** Restores from saved state: the ids go on from the highest. */
  load(cs: readonly Character[]): void {
    for (const c of cs) {
      this.byId.set(c.id, c);
      this.next = Math.max(this.next, Number(c.id.slice(1)) + 1);
    }
  }
}
