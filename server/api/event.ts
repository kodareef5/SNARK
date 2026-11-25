// What a module writes a kind of map event against (planning/workstreams/map-events.md). A kind is a set of handlers;
// an event is a saved state machine the server runs for it. The server makes, simulates, saves and sends every part,
// and every client draws a part by its type, so a kind is a module's code alone: nothing of it runs in a browser.
//
// Handlers run on the tick thread, in the map events' own row of the tick, never inside a shot or a blast. What they
// keep goes in `run.bag`, which is saved; a closure or a timer is not, and is gone after a restart.

import type { ScheduleDoc } from "../../shared/mapevent/book.ts";
import type { Fields, Tuned } from "../../shared/mapevent/fields.ts";
import type { CraftSpec, CrateSpec, SiteSpec } from "../../shared/mapevent/parts.ts";
import type { Rng } from "../../shared/rng.ts";

/** A value a bag may keep: what JSON keeps. */
export type Plain = number | string | boolean | null | Plain[] | { [key: string]: Plain };

/** What a kind may ask of the map, as it stands now. */
export interface EventMap {
  readonly sizeX: number;
  readonly sizeZ: number;
  /** The highest thing standing within `radius` metres of (x, z): ground, roof, tree or water. */
  top(x: number, z: number, radius: number): number;
  /** The ground's height at (x, z), and the water's (the sea's level where there is no water). */
  ground(x: number, z: number): number;
  water(x: number, z: number): number;
}

/** "notice": called and coming. "live": come. "ended": over. */
export type EventState = "notice" | "live" | "ended";

/** A part as it is now. A craft's place is where it is this tick. */
export type PartView =
  | { readonly type: "craft"; readonly id: number; readonly state: "coming" | "flying" | "falling" | "rest" | "gone"; readonly x: number; readonly y: number; readonly z: number; readonly low: number; readonly health: number; readonly most: number; readonly shield: "none" | "closed" | "open" | "broken" }
  | { readonly type: "crate"; readonly id: number; readonly pid: number; readonly x: number; readonly y: number; readonly z: number; readonly stacks: number }
  | { readonly type: "site"; readonly id: number; readonly x: number; readonly z: number };

/** One event of a kind, as its handlers see it. */
export interface EventRun<F extends Fields = Fields> {
  readonly id: number;
  readonly kind: string;
  /** The seed it was called with: the same seed makes the same event. */
  readonly seed: number;
  /**
   * Draws for this handler, from the seed and how many handlers of this event have run before it: the same on a preview
   * and on the call that follows it with the same seed, and the same after a restart.
   */
  readonly rng: Rng;
  /** The kind's tuning as it was when the event was called. */
  readonly tuned: Tuned<F>;
  /** What the kind keeps of this event: saved with it. Keep it small: plain values only, 16 KB at the most as JSON. */
  readonly bag: Record<string, Plain>;
  readonly state: EventState;
  readonly tick: number;
  /** The ticks it was called at and comes at. */
  readonly called: number;
  readonly start: number;
  /** "schedule", "console", "page", "module", or a module's name, and the schedule's key or "". */
  readonly source: string;
  readonly schedule: string;
  /**
   * A preview for the events page: parts and lines are recorded and nothing is made, told or kept. `part`, `parts` and
   * `remove` act on what was recorded, so a preview shows what the call would leave.
   */
  readonly dry: boolean;
  readonly map: EventMap;
  /** Places the call asked its event to be near, or where each survivor in the world stands. */
  near(): readonly { x: number; z: number }[];
  /** Survivors in the world. */
  survivors(): number;
  /** Calls `on.phase(run, name)` `afterTicks` from now. Saved by name. A phase of the same name is moved. */
  phase(name: string, afterTicks: number): void;
  cancelPhase(name: string): void;
  /** Tells everyone a line, as the book's `announce` says. */
  notice(text: string): void;
  /** Ends it: its craft leave the sky, its crates and sites go. Told a little longer, so its going is seen. */
  end(reason: string): void;
  /** Makes a part. Each returns the part's id in this event. A craft or a site made in `start` comes with the event. */
  craft(spec: CraftSpec): number;
  /** 0 where nothing rolled for it, and it was not made. */
  crate(spec: CrateSpec): number;
  site(spec: SiteSpec): number;
  /** Brings a craft down where it is, as if struck down by nobody. */
  down(craft: number): void;
  remove(part: number): void;
  part(id: number): PartView | null;
  /** Every part it has now, by id. */
  parts(): readonly PartView[];
}

/** Who brought a craft down: the survivor's pid and name. */
export interface Striker {
  readonly pid: number;
  readonly name: string;
}

/** Where a craft came to rest, and the way it was going along the ground as it fell (a unit vector, or 0 0). */
export interface Rest {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
}

export interface EventHandlers<F extends Fields> {
  /** At the call: make its parts, say what is coming. Also the events page's preview, with `run.dry`: no side effects here but through `run`. */
  start(run: EventRun<F>): void;
  /** When it comes, at the end of its notice. */
  live?(run: EventRun<F>): void;
  phase?(run: EventRun<F>, name: string): void;
  /** A craft flew its path out without being brought down. */
  craftOut?(run: EventRun<F>, craft: number): void;
  craftDown?(run: EventRun<F>, craft: number, by: Striker | null): void;
  craftRest?(run: EventRun<F>, craft: number, at: Rest): void;
  crateEmptied?(run: EventRun<F>, crate: number): void;
  /** A crate went by its time, or by some other hand. */
  crateGone?(run: EventRun<F>, crate: number, why: "expired" | "removed"): void;
  end?(run: EventRun<F>, reason: string): void;
  /** After a restart, for an event that was saved: put back what lives outside the bag. `saved` is the kind's version it was saved by. */
  resume?(run: EventRun<F>, saved: number): void;
}

export interface EventKindDef<F extends Fields = Fields> {
  /** "ufo": a letter, then letters, digits and _. One id in the whole server. */
  readonly id: string;
  readonly label: string;
  readonly about: string;
  /** Saved with each event, and given back to `resume`. 1 where not given. */
  readonly version?: number;
  readonly tuning: F;
  /** Faults across fields, at save: each at its field's key. */
  check?(t: Tuned<F>): { key: keyof F & string; message: string }[];
  /** Seconds from its call to its coming. 0 where not given. */
  readonly notice?: number | ((t: Tuned<F>) => number);
  /** The longest it may last after it comes, in seconds: the server ends it then whatever it is doing. 7,200 where not given. */
  readonly maxSeconds?: number;
  /** The owner its sounds are found under ("core:ufo"), "" for the cues' own. */
  readonly sound?: string;
  /** The schedules a world's book begins with for this kind. */
  readonly schedules?: readonly Omit<ScheduleDoc, "kind">[];
  readonly on: EventHandlers<F>;
}

export interface EventInfo {
  readonly id: number;
  readonly kind: string;
  readonly state: EventState;
  readonly called: number;
  readonly start: number;
  readonly seed: number;
  readonly source: string;
  readonly schedule: string;
  readonly parts: readonly PartView[];
}

/** What any module may do with map events, its own kinds and others'. */
export interface EventsApi {
  /** Every kind defined now, and the module that defines it. */
  kinds(): readonly { id: string; label: string; module: string }[];
  /** Events coming, live, and lately ended. */
  list(): readonly EventInfo[];
  /** Calls one. Its id, or why it was not called. Not in setup. */
  call(kind: string, o?: { notice?: number; seed?: number; near?: readonly { x: number; z: number }[] }): number | string;
  /** Ends one. "" or why not. Not in setup. */
  cancel(id: number, reason?: string): string;
}
