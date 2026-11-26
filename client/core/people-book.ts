// The cluster's admin populations as this client holds them, from each people manifest the server names (OWN_PEOPLE).
// A revision is never changed, so every manifest's populations are kept together. A body drawn from a revision this
// client has not loaded yet is drawn from a stand-in until a manifest holding it comes, then made again in place: the
// view keeps the look by reference, so the next frame draws the right person. A stand-in is held weakly: one no view
// holds any more is let go.
import { defaultLook } from "../../shared/anim/look.ts";
import type { PopulationDef } from "../../shared/content/kinds/populations.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { HASH, peopleManifestPath, readPeopleManifest, storePopulation, type Edition } from "../../shared/people/doc.ts";
import { lookOfSeed, personFrom, populationsOf, storeIdOf, type StorePopulations } from "../../shared/people/person.ts";

/**
 * The most stand-ins waited on at once. One no view holds any more is let go first; past that, the oldest stays a
 * stand-in. Chosen.
 */
export const PENDING_MAX = 4096;
/** How long after each failed fetch of a manifest it is tried again, after which it is given up. Chosen. */
export const RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];
/** How long a fetch may take before it counts as failed. Chosen. */
export const FETCH_TIMEOUT_MS = 15_000;

interface Pending {
  readonly look: WeakRef<Uint8Array>;
  readonly seed: number;
  readonly id: number;
  readonly rev: number;
}

export class PeopleBook implements StorePopulations {
  /** Fetches a JSON file the server serves, as the page does; without one no manifest is fetched. */
  fetcher: ((path: string) => Promise<unknown>) | null = null;
  /** The wall clock in ms that retries and timeouts are measured on. */
  now: () => number = Date.now;
  private readonly defs = new Map<number, PopulationDef[]>();
  /** Every garment edition of the manifests loaded, by id. An edition never changes. */
  private readonly editions = new Map<number, Edition>();
  private pending: Pending[] = [];
  private readonly loaded = new Set<string>();
  /** The manifest last named, how many fetches of it failed, and when the next may start. */
  private named = "";
  private failed = 0;
  private nextAt = 0;
  /** The fetch under way, by its number, and when it started; 0 for none. */
  private attempt = 0;
  private attempts = 0;
  private startedAt = 0;
  private loading: Promise<void> = Promise.resolve();

  population(id: number, rev: number): PopulationDef | undefined {
    return this.defs.get(id)?.[rev - 1];
  }

  /** Garment edition `id` as published, or undefined for one no manifest loaded so far holds. */
  edition(id: number): Edition | undefined {
    return this.editions.get(id);
  }

  /** Fills `out` with edition `id`'s three colours, as the renderer takes them (Characters.edition); false for one not held. */
  readonly editionColours = (id: number, out: Uint8Array): boolean => {
    const e = this.editions.get(id);
    if (!e) return false;
    out[0] = e.colours[0];
    out[1] = e.colours[1];
    out[2] = e.colours[2];
    return true;
  };

  /** How many bodies are drawn from a stand-in now. */
  get waiting(): number {
    return this.pending.length;
  }

  /** Fetches the manifest `id` names unless it is loaded. */
  want(id: string): void {
    if (!HASH.test(id) || this.loaded.has(id)) return;
    if (id !== this.named) {
      this.named = id;
      this.failed = 0;
      this.nextAt = 0;
    }
    this.poll();
  }

  /**
   * Starts the fetch of the manifest last named when it is due, and counts one that took too long as failed. A failed
   * fetch is tried again after each of RETRY_MS in turn. Costs a comparison while nothing is owed.
   */
  poll(): void {
    if (this.named === "" || this.loaded.has(this.named) || !this.fetcher) return;
    const at = this.now();
    if (this.attempt !== 0) {
      if (at - this.startedAt < FETCH_TIMEOUT_MS) return;
      this.fail(this.attempt, at);
    }
    if (this.failed > RETRY_MS.length || at < this.nextAt) return;
    const id = this.named, attempt = (this.attempt = ++this.attempts);
    this.startedAt = at;
    this.loading = this.fetcher(peopleManifestPath(id)).then(
      (json) => {
        // A revision never changes, so a late answer is as good as a timely one.
        this.loaded.add(id);
        this.take(json);
        if (this.attempt === attempt) this.attempt = 0;
        this.poll();
      },
      () => {
        this.fail(attempt, this.now());
        this.poll();
      },
    );
  }

  /** Fetch `attempt` failed at `at`: the next is due after the next wait, unless one is already under way. */
  private fail(attempt: number, at: number): void {
    if (this.attempt !== attempt) return;
    this.attempt = 0;
    this.nextAt = at + (RETRY_MS[this.failed] ?? 0);
    this.failed++;
  }

  /** Settles once every fetch started so far has answered. */
  async settled(): Promise<void> {
    let at: Promise<void>;
    do await (at = this.loading);
    while (at !== this.loading);
  }

  /** Takes a manifest's editions and populations, and makes again each body drawn from a stand-in that it now holds. */
  take(json: unknown): void {
    const read = readPeopleManifest(json);
    for (const e of read.editions) if (Number.isInteger(e?.id) && Array.isArray(e.colours)) this.editions.set(e.id, e);
    for (const p of read.populations) {
      const defs = this.defs.get(p.id) ?? [];
      defs[p.rev - 1] ??= storePopulation(p.id, p.rev, p.population);
      this.defs.set(p.id, defs);
    }
    this.pending = this.pending.filter((w) => {
      const look = w.look.deref();
      if (!look) return false;
      const def = this.population(w.id, w.rev);
      if (def) personFrom(w.seed, def, look);
      return !def;
    });
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
    this.poll();
    const first = populationsOf(reg).list[0];
    const look = first ? personFrom(seed, first).look : defaultLook();
    if (this.pending.length >= PENDING_MAX) this.pending = this.pending.filter((w) => w.look.deref() !== undefined);
    if (this.pending.length >= PENDING_MAX) this.pending.shift();
    this.pending.push({ look: new WeakRef(look), seed, id, rev: revision });
    return look;
  }
}
