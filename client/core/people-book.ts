// The cluster's admin populations as this client holds them, from each people manifest the server names (OWN_PEOPLE).
// A revision is never changed, so every manifest's populations are kept together. A body drawn from a revision this
// client has not loaded yet is drawn from a stand-in until a manifest holding it comes, then made again in place: the
// view keeps the look by reference, so the next frame draws the right person.
import { defaultLook } from "../../shared/anim/look.ts";
import type { PopulationDef } from "../../shared/content/kinds/populations.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { HASH, peopleManifestPath, readPeopleManifest, storePopulation } from "../../shared/people/doc.ts";
import { lookOfSeed, personFrom, populationsOf, storeIdOf, type StorePopulations } from "../../shared/people/person.ts";

/** The most stand-ins waiting at once; past it the oldest stays a stand-in. Chosen. */
export const PENDING_MAX = 4096;
/** How many times one manifest is fetched before it is given up. */
const TRIES = 5;

interface Pending {
  readonly look: Uint8Array;
  readonly seed: number;
  readonly id: number;
  readonly rev: number;
}

export class PeopleBook implements StorePopulations {
  /** Fetches a JSON file the server serves, as the page does; without one no manifest is fetched. */
  fetcher: ((path: string) => Promise<unknown>) | null = null;
  private readonly defs = new Map<number, PopulationDef[]>();
  private readonly pending: Pending[] = [];
  private readonly loaded = new Set<string>();
  /** The manifest last named, and whether a fetch of it is under way. */
  private named = "";
  private fetching = false;
  private tries = 0;
  private loading: Promise<void> = Promise.resolve();

  population(id: number, rev: number): PopulationDef | undefined {
    return this.defs.get(id)?.[rev - 1];
  }

  /** How many bodies are drawn from a stand-in now. */
  get waiting(): number {
    return this.pending.length;
  }

  /** Fetches the manifest `id` names unless it is loaded. A failed one is tried again by the next stand-in, a few times. */
  want(id: string): void {
    if (!HASH.test(id) || this.loaded.has(id)) return;
    if (id !== this.named) {
      this.named = id;
      this.tries = 0;
    }
    const fetch = this.fetcher;
    if (!fetch || this.fetching || this.tries >= TRIES) return;
    this.fetching = true;
    this.tries++;
    const done = (): void => {
      this.fetching = false;
      // Named again while this one was on its way.
      if (this.named !== id) this.want(this.named);
    };
    this.loading = fetch(peopleManifestPath(id)).then((json) => {
      this.loaded.add(id);
      this.take(json);
      done();
    }, done);
  }

  /** Settles once every manifest wanted so far is loaded or given up. */
  async settled(): Promise<void> {
    let at: Promise<void>;
    do await (at = this.loading);
    while (at !== this.loading);
  }

  /** Takes a manifest's populations, and makes again each body drawn from a stand-in that it now holds. */
  take(json: unknown): void {
    for (const p of readPeopleManifest(json).populations) {
      const defs = this.defs.get(p.id) ?? [];
      defs[p.rev - 1] ??= storePopulation(p.id, p.rev, p.population);
      this.defs.set(p.id, defs);
    }
    let kept = 0;
    for (const w of this.pending) {
      const def = this.population(w.id, w.rev);
      if (def) personFrom(w.seed, def, w.look);
      else this.pending[kept++] = w;
    }
    this.pending.length = kept;
  }

  /**
   * The look a seed form names (shared/net/view.ts MakePerson). An admin population's revision not held yet gives a
   * stand-in, the seed in the content's first population; a content population or revision the registry lacks, null.
   */
  look(reg: Registry, seed: number, number: number, revision: number): Uint8Array | null {
    const id = storeIdOf(reg, number);
    if (id === 0) return lookOfSeed(reg, seed, number, revision);
    if (!(revision >= 1)) return null;
    const def = this.population(id, revision);
    if (def) return personFrom(seed, def).look;
    if (this.named !== "" && !this.loaded.has(this.named)) this.want(this.named);
    const first = populationsOf(reg).list[0];
    const look = first ? personFrom(seed, first).look : defaultLook();
    if (this.pending.length >= PENDING_MAX) this.pending.shift();
    this.pending.push({ look, seed, id, rev: revision });
    return look;
  }
}
