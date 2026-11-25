// What a kind's handler holds of its event (server/api/event.ts EventRun): reads of the event, and acts the engine
// carries out. On a preview the acts are written down and nothing is made, told or kept.

import type { EventMap, EventRun, EventState, PartView, Plain } from "../api/event.ts";
import { hashString } from "../../shared/hash.ts";
import type { Tuned, Fields } from "../../shared/mapevent/fields.ts";
import type { CraftSpec, CrateSpec, SiteSpec } from "../../shared/mapevent/parts.ts";
import { MAPEVENT_STATES } from "../../shared/mapevent/wire.ts";
import { Rng } from "../../shared/rng.ts";
import type { MapEvent } from "./events.ts";

/** What a preview did: the parts it would make, the lines it would tell, the phases it would set. */
export interface Preview {
  crafts: { id: number; spec: CraftSpec }[];
  crates: { id: number; spec: CrateSpec }[];
  sites: { id: number; spec: SiteSpec }[];
  notices: string[];
  phases: { name: string; at: number }[];
}

/** What a run needs of the engine. */
export interface RunHost {
  readonly map: EventMap;
  tick(): number;
  places(): { x: number; z: number }[];
  phase(ev: MapEvent, name: string, at: number): void;
  cancelPhase(ev: MapEvent, name: string): void;
  notice(ev: MapEvent, text: string): void;
  end(ev: MapEvent, reason: string): void;
  craft(ev: MapEvent, spec: CraftSpec): number;
  crate(ev: MapEvent, spec: CrateSpec): number;
  site(ev: MapEvent, spec: SiteSpec): number;
  down(ev: MapEvent, id: number): void;
  remove(ev: MapEvent, id: number): void;
  view(ev: MapEvent, id: number): PartView | null;
  views(ev: MapEvent): PartView[];
}

export class Run implements EventRun {
  readonly dry: boolean;
  private readonly host: RunHost;
  private readonly ev: MapEvent;
  private readonly handler: string;
  private readonly preview: Preview | null;
  private draws: Rng | null = null;

  constructor(host: RunHost, ev: MapEvent, handler: string, preview: Preview | null = null) {
    this.host = host;
    this.ev = ev;
    this.handler = handler;
    this.preview = preview;
    this.dry = preview !== null;
  }

  get id(): number {
    return this.ev.id;
  }
  get kind(): string {
    return this.ev.kind;
  }
  get seed(): number {
    return this.ev.seed;
  }
  get rng(): Rng {
    // From the seed and the count of handlers run before: a preview's start and the call's start draw alike.
    this.draws ??= new Rng(hashString(`${this.handler}/${this.ev.calls}`, this.ev.seed >>> 0));
    return this.draws;
  }
  get tuned(): Tuned<Fields> {
    return this.ev.tuned as Tuned<Fields>;
  }
  get bag(): Record<string, Plain> {
    return this.ev.bag;
  }
  get state(): EventState {
    return MAPEVENT_STATES[this.ev.state]!;
  }
  get tick(): number {
    return this.host.tick();
  }
  get called(): number {
    return this.ev.called;
  }
  get start(): number {
    return this.ev.start;
  }
  get source(): string {
    return this.ev.source;
  }
  get schedule(): string {
    return this.ev.schedule;
  }
  get map(): EventMap {
    return this.host.map;
  }

  near(): readonly { x: number; z: number }[] {
    return this.ev.near ?? this.host.places();
  }

  survivors(): number {
    return this.host.places().length;
  }

  phase(name: string, afterTicks: number): void {
    if (typeof name !== "string" || name === "" || name.length > 32) throw new Error("a phase's name is 1 to 32 characters");
    if (!(afterTicks >= 1)) throw new Error("a phase comes at least a tick from now");
    const at = this.host.tick() + Math.ceil(afterTicks);
    if (this.preview) {
      this.preview.phases = this.preview.phases.filter((p) => p.name !== name);
      this.preview.phases.push({ name, at });
    } else this.host.phase(this.ev, name, at);
  }

  cancelPhase(name: string): void {
    if (this.preview) this.preview.phases = this.preview.phases.filter((p) => p.name !== name);
    else this.host.cancelPhase(this.ev, name);
  }

  notice(text: string): void {
    const line = String(text).slice(0, 200);
    if (this.preview) this.preview.notices.push(line);
    else this.host.notice(this.ev, line);
  }

  end(reason: string): void {
    if (this.preview) return;
    this.host.end(this.ev, String(reason).slice(0, 48));
  }

  craft(spec: CraftSpec): number {
    if (this.preview) return this.record(this.preview.crafts, spec);
    return this.host.craft(this.ev, spec);
  }

  crate(spec: CrateSpec): number {
    if (this.preview) return this.record(this.preview.crates, spec);
    return this.host.crate(this.ev, spec);
  }

  site(spec: SiteSpec): number {
    if (this.preview) return this.record(this.preview.sites, spec);
    return this.host.site(this.ev, spec);
  }

  down(craft: number): void {
    if (!this.preview) this.host.down(this.ev, craft);
  }

  /** On a preview a part is taken out of what was recorded, so the preview shows what the call would leave. */
  remove(part: number): void {
    const p = this.preview;
    if (!p) return this.host.remove(this.ev, part);
    p.crafts = p.crafts.filter((c) => c.id !== part);
    p.crates = p.crates.filter((c) => c.id !== part);
    p.sites = p.sites.filter((c) => c.id !== part);
  }

  part(id: number): PartView | null {
    return this.parts().find((p) => p.id === id) ?? null;
  }

  /** On a preview, the parts recorded so far, as a call would have them as it is made: craft still to come. */
  parts(): readonly PartView[] {
    const p = this.preview;
    if (!p) return this.host.views(this.ev);
    const out: PartView[] = [];
    for (const { id, spec } of p.crafts) {
      const first = spec.points[0]!;
      out.push({ type: "craft", id, state: "coming", x: first.x, y: first.y, z: first.z, low: 0, health: spec.health, most: spec.health, shield: spec.shield ? "closed" : "none" });
    }
    for (const { id, spec } of p.crates) out.push({ type: "crate", id, pid: 0, x: spec.x, y: 0, z: spec.z, stacks: 0 });
    for (const { id, spec } of p.sites) out.push({ type: "site", id, x: spec.x, z: spec.z });
    return out.sort((a, b) => a.id - b.id);
  }

  private record<T>(list: { id: number; spec: T }[], spec: T): number {
    const id = this.ev.next++;
    list.push({ id, spec });
    return id;
  }
}
