// Cast's people: everyone it keeps, featured and extra. An extra is a seed and an archetype, its name, look and leanings
// drawn from the seed whenever wanted, so thousands cost little; promoted (a player engaged it, or it plays a featured
// part), its life is drawn once and kept, with facts and what it thinks of each player, and a featured person comes back
// in later scenes (Shadow of Mordor's nemesis: the gang member who drew on you last week).

import type { Archetype, Catalogue, Look, Traits } from "../../shared/cast/catalogue.ts";
import type { Character, Fact } from "../../shared/cast/state.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { partSeed, personFrom, populationsOf, sexOf, type Person } from "../../shared/people/person.ts";
import { Rng } from "../../shared/rng.ts";
import type { Born } from "../../shared/sim/entities.ts";

/** Facts a person keeps; past this the oldest unlocked go (the keeper's summaries keep what matters). */
export const MOST_FACTS = 12;
/** Notes kept of what passed with one player. */
export const MOST_NOTES = 6;

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)]!;

/** The population a look names where it names none. */
export const CAST_POPULATION = "core:people_city";
/** Seeds tried for a person of its name's sex before the first is kept whatever it gives. */
const SEX_TRIES = 16;

/**
 * The person a character's body is, from its seed and its look's population: of its first name's sex where the catalogue
 * knows it. Null where the content has no such population.
 */
export function castPerson(c: Character, look: Look | undefined, cat: Catalogue, reg: Registry): { person: Person; born: Born; wear: readonly string[] } | null {
  const people = populationsOf(reg), number = people.number.get(look?.population ?? CAST_POPULATION);
  if (number === undefined) return null;
  const p = people.list[number]!, wanted = cat.sexes?.[c.name.split(" ")[0]!];
  let seed = c.seed >>> 0;
  for (let k = 1; wanted !== undefined && k < SEX_TRIES && sexOf(seed, p) !== wanted; k++) seed = partSeed(c.seed, 0x100 + k);
  if (wanted !== undefined && sexOf(seed, p) !== wanted) seed = c.seed >>> 0;
  const person = personFrom(seed, p);
  const wear = look?.wear.length ? look.wear : person.outfit >= 0 ? p.outfits![person.outfit]!.wear : [];
  return { person, born: { seed, population: number, revision: p.revision }, wear };
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
