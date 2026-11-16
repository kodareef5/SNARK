// Which sound an owner makes for a cue: its own, or the first of the cue's fallbacks the build has (shared/sound/cues.ts),
// looked up once and kept, so that hearing an occasion costs a map read. Owners are ids: a definition's (`core:dodo`),
// or a shared family's (`core:surface`). Each key also counts what was asked of it and what had no sound, for the board
// and the log.

import { KEYS, candidates } from "../../../shared/sound/cues.ts";

export class Resolver {
  readonly owners: string[] = [];
  /** By owner: the shared families its `{family}` fallbacks stand for (a vehicle's, from vehicleFamilies). */
  private readonly families: (readonly string[])[] = [];
  private readonly ownerIndex = new Map<string, number>();
  private readonly found = new Map<number, number>();
  private readonly index: ReadonlyMap<string, number>;
  /** By found entry: the sound, or -1, and the rate it plays at. */
  private readonly sound: number[] = [];
  private readonly rates: number[] = [];
  /** By key: times asked, and times nothing was found. */
  readonly asked = new Uint32Array(KEYS.length);
  readonly missed = new Uint32Array(KEYS.length);

  private readonly familiesOf: (id: string) => readonly string[];

  /**
   * `index` maps sound ids (`core:dodo/sound/call`) to sound numbers, as the library's does. `familiesOf` gives an owner's
   * families where its first asking does not (a vehicle's, from its definition).
   */
  constructor(index: ReadonlyMap<string, number>, familiesOf: (id: string) => readonly string[] = () => []) {
    this.index = index;
    this.familiesOf = familiesOf;
  }

  /** The number of an owner id, made the first time it is asked for, with the families it falls back to (the first asking names them). */
  owner(id: string, families?: readonly string[]): number {
    let o = this.ownerIndex.get(id);
    if (o === undefined) {
      o = this.owners.length;
      this.owners.push(id);
      this.families.push(families ?? this.familiesOf(id));
      this.ownerIndex.set(id, o);
    }
    return o;
  }

  private entry(owner: number, key: number): number {
    const at = owner * KEYS.length + key;
    let e = this.found.get(at);
    if (e === undefined) {
      e = this.sound.length;
      let sound = -1;
      let rate = 1;
      for (const c of candidates(this.owners[owner]!, KEYS[key]!, this.families[owner])) {
        const s = this.index.get(c.id);
        if (s === undefined) continue;
        sound = s;
        rate = c.rate;
        break;
      }
      this.sound.push(sound);
      this.rates.push(rate);
      this.found.set(at, e);
    }
    return e;
  }

  /** The sound `owner` makes for cue key `key`, or -1 for none. Counts the asking. */
  find(owner: number, key: number): number {
    const s = this.sound[this.entry(owner, key)]!;
    this.asked[key]!++;
    if (s < 0) this.missed[key]!++;
    return s;
  }

  /** As `find` without counting: for code that looks ahead to what it may need. */
  peek(owner: number, key: number): number {
    return this.sound[this.entry(owner, key)]!;
  }

  /** The playback rate of what `find` gave: below 1 where a stand-in plays lower. */
  rate(owner: number, key: number): number {
    return this.rates[this.entry(owner, key)]!;
  }
}
