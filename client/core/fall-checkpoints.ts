import { newerCorpseMotion, type CorpseMotion } from "../../shared/net/corpse.ts";
import { MAX_VIEW, VIEW_RING } from "../../shared/net/view.ts";

/** Eight deliveries cover a delayed draw even when a body gets a correction every tick. */
const EARLIER = 8;

export class FallCheckpoints extends Map<number, CorpseMotion> {
  private readonly earlier = new Map<number, CorpseMotion[]>();

  constructor() { super(); }

  override set(id: number, next: CorpseMotion): this {
    const last = this.get(id);
    if (!newerCorpseMotion(next, last)) return this;
    if (last) {
      const kept = this.earlier.get(id) ?? [];
      if (last.tick < next.tick) kept.push(last);
      while (kept.length && (kept.length > EARLIER || kept[0]!.tick < next.tick - VIEW_RING)) kept.shift();
      if (kept.length) this.earlier.set(id, kept);
      else this.earlier.delete(id);
      super.delete(id);
    } else if (this.size >= MAX_VIEW) this.delete(this.keys().next().value!);
    return super.set(id, next);
  }

  override delete(id: number): boolean {
    this.earlier.delete(id);
    return super.delete(id);
  }

  override clear(): void {
    this.earlier.clear();
    super.clear();
  }

  /** Before the first checkpoint is due, return it so the renderer can wait. */
  atTick(id: number, tick: number): CorpseMotion | undefined {
    const latest = this.get(id);
    if (latest && latest.tick > tick) {
      const kept = this.earlier.get(id);
      if (kept) for (let i = kept.length - 1; i >= 0; i--) if (kept[i]!.tick <= tick) return kept[i];
    }
    return latest;
  }
}

export function checkpointAt(motions: ReadonlyMap<number, CorpseMotion> | undefined, id: number, tick: number): CorpseMotion | undefined {
  return motions instanceof FallCheckpoints ? motions.atTick(id, tick) : motions?.get(id);
}
