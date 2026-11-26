// Cast's people: everyone it keeps, featured and extra. An extra is a seed and an archetype, its name, look and leanings
// drawn from the seed whenever wanted, so thousands cost little; promoted (a player engaged it, or it plays a featured
// part), its life is drawn once and kept, with facts and what it thinks of each player, and a featured person comes back
// in later scenes (Shadow of Mordor's nemesis: the gang member who drew on you last week).

import { LOOK_BYTES, validLook } from "../../shared/anim/look.ts";
import type { Archetype, Catalogue, Look, Traits } from "../../shared/cast/catalogue.ts";
import type { Character, Fact, KeptPerson } from "../../shared/cast/state.ts";
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

/** A body as drawn: its look, the seed form it goes as (null to send the bytes), what it wears and what it came from. */
export interface CastBody {
  readonly look: Uint8Array;
  readonly born: Born | null;
  /** The seed form with its population by content id or store id, where the look is one without locks. */
  readonly from: { seed: number; population: string | number; revision: number } | null;
  readonly wear: readonly string[];
  readonly wardrobe: readonly (Worn | null)[];
  /** The named person's revision it was drawn from. */
  readonly rev?: number;
  /** Drawn from what the character keeps. */
  readonly kept: boolean;
}

/** A population by content id, as the content has it now, or by store id at revision `rev` (its latest where null). */
function populationBy(ref: string | number, rev: number | null, reg: Registry, store: CastStore | null): PopulationDef | undefined {
  if (typeof ref === "string") {
    const people = populationsOf(reg), n = people.number.get(ref);
    return n === undefined ? undefined : people.list[n];
  }
  const at = rev ?? store?.latest("population", ref)?.rev;
  return at === undefined ? undefined : store?.population(ref, at);
}

const wornOf = (w: WornDoc | null): Worn | null => (w ? [w.garment, w.edition, dyeNumber(w.dye)] : null);

/**
 * The person a character's body is, from its seed and its look's population (an admin's choice of population first): of
 * its first name's sex where the catalogue knows it. An admin outfit chosen for the look dresses it in place of the look's
 * clothes; an admin population's own outfits do too. Null where no population it names is held.
 */
export function castPerson(c: Character, look: Look | undefined, cat: Catalogue, reg: Registry, store: CastStore | null = null, choice?: LookChoice) {
  let ref: string | number = CAST_POPULATION, p: PopulationDef | undefined;
  for (const r of [choice?.population, look?.population, CAST_POPULATION]) if (!p && r !== undefined && (p = populationBy(r, null, reg, store))) ref = r;
  const number = p ? wireNumber(reg, ref) : undefined;
  if (!p || number === undefined) return null;
  const wanted = cat.sexes?.[c.name.split(" ")[0]!];
  let seed = c.seed >>> 0;
  for (let k = 1; wanted !== undefined && k < SEX_TRIES && sexOf(seed, p) !== wanted; k++) seed = partSeed(c.seed, 0x100 + k);
  if (wanted !== undefined && sexOf(seed, p) !== wanted) seed = c.seed >>> 0;
  const person = personFrom(seed, p);
  const outfit = choice?.outfit !== undefined ? store?.latest("outfit", choice.outfit) : undefined;
  const wardrobe = outfit ? wardrobeFrom(c.seed >>> 0, outfit.body).map(wornOf) : [];
  const own = person.outfit >= 0 ? p.outfits![person.outfit]!.wear : null;
  const wear: readonly string[] = wardrobe.some((w) => w) ? [] : typeof ref === "number" && own ? own : look?.wear.length ? look.wear : own ?? [];
  return { person, born: { seed, population: number, revision: p.revision } as Born, from: { seed, population: ref, revision: p.revision }, wear, wardrobe };
}

/**
 * A named person's body at revision `rec`: its bytes, or its seed in its population with its locks; and its outfit at
 * that outfit's latest revision, or its own wardrobe. A person dressed in either wears none of the look's clothes. Null
 * where the store lacks its population.
 */
function namedBody(c: Character, rec: Revision<PersonDoc>, look: Look | undefined, reg: Registry, store: CastStore): CastBody | null {
  const doc = rec.body, l = doc.look;
  let bytes: Uint8Array, born: Born | null = null, from: CastBody["from"] = null, seed = c.seed >>> 0;
  if ("bytes" in l) bytes = Uint8Array.from(l.bytes);
  else {
    // A content population has only its revision now: the content changes with a build, never under a running world.
    const p = typeof l.population === "string" ? populationBy(l.population, null, reg, store) : store.population(l.population, l.revision);
    const number = wireNumber(reg, l.population);
    if (!p || number === undefined) return null;
    bytes = personFrom(l.seed, p, undefined, l.locks).look;
    if (Object.keys(l.locks).length === 0) {
      born = { seed: l.seed, population: number, revision: p.revision };
      from = { seed: l.seed, population: l.population, revision: p.revision };
    }
    seed = l.locks.outfit ?? l.seed;
  }
  const outfit = doc.outfit !== null ? store.latest("outfit", doc.outfit) : undefined;
  const wardrobe = (outfit ? wardrobeFrom(seed, outfit.body) : doc.wardrobe ?? []).map(wornOf);
  return { look: bytes, born, from, wear: wardrobe.some((w) => w) ? [] : look?.wear ?? [], wardrobe, rev: rec.rev, kept: false };
}

/** A kept body: its bytes, sent as its seed form while that still gives them byte for byte. Null for a kept look not of its shape. */
function keptBody(k: KeptPerson, reg: Registry, store: CastStore | null): CastBody | null {
  const look = Uint8Array.from(Buffer.from(k.look, "base64"));
  if (look.length !== LOOK_BYTES || !validLook(look)) return null;
  let born: Born | null = null;
  if (k.born) {
    const { seed, population, revision } = k.born;
    const p = typeof population === "string" ? populationBy(population, null, reg, store) : store?.population(population, revision);
    const number = wireNumber(reg, population);
    if (p && p.revision === revision && number !== undefined && personFrom(seed, p).look.every((b, i) => b === look[i])) born = { seed, population: number, revision };
  }
  return { look, born, from: k.born ?? null, wear: k.wear, wardrobe: k.wardrobe, rev: k.rev, kept: true };
}

/**
 * The body a character is drawn as. A named person follows its own record: at a new revision of it the body is drawn
 * again, else it is what was kept. Anyone else keeps the body kept for it, and a person with none is drawn from its look.
 */
export function castBody(c: Character, look: Look | undefined, cat: Catalogue, reg: Registry, store: CastStore | null, choice?: LookChoice): CastBody | null {
  if (c.person !== undefined && store) {
    const rec = store.latest("person", c.person);
    if (rec && rec.rev !== c.kept?.rev) {
      const named = namedBody(c, rec, look, reg, store);
      if (named) return named;
    }
  }
  const kept = c.kept ? keptBody(c.kept, reg, store) : null;
  if (kept) return kept;
  const made = castPerson(c, look, cat, reg, store, choice);
  return made && { look: made.person.look, born: made.born, from: made.from, wear: made.wear, wardrobe: made.wardrobe, kept: false };
}

/** What a body keeps of itself: its look, its seed form, its clothes and the wardrobe it was seen in. */
export function keepOf(b: CastBody, worn: readonly (Worn | null)[]): KeptPerson {
  return {
    look: Buffer.from(b.look).toString("base64"), ...(b.from ? { born: { ...b.from } } : {}), wear: [...b.wear],
    wardrobe: worn.map((w) => (w ? [w[0], w[1], w[2]] : null)), ...(b.rev !== undefined ? { rev: b.rev } : {}),
  };
}

export class People {
  readonly byId = new Map<string, Character>();
  /** Told when a person is made featured, so the host keeps the body it has now (server/cast/host.ts). */
  onPromote: ((c: Character) => void) | null = null;
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

  /** Made featured: its life is drawn from its seed and its archetype's seeds of one, and kept from now on, and its body too. */
  promote(c: Character, tick: number): void {
    if (c.tier === "featured") return;
    const a = this.archetypes.get(c.archetype)!;
    const rng = new Rng(c.seed ^ 0x5bd1e995);
    c.tier = "featured";
    c.want = pick(rng, a.wants);
    c.struggle = pick(rng, a.struggles);
    c.hope = pick(rng, a.hopes);
    c.touched = tick;
    this.onPromote?.(c);
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
