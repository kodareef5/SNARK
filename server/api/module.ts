// The contract between the server and a module. A module imports this file, event.ts and `shared`, and nothing else of
// the server.
// A module is trusted code that runs in the server's process, on the tick thread. It hears events, may refuse or change
// what a "before" event is about to do, and acts on the world only through `act`. It may define kinds of map event,
// which the server runs, saves and sends (event.ts).

import type { Fields } from "../../shared/mapevent/fields.ts";
import type { EventKindDef, EventsApi } from "./event.ts";

export type EventData = Record<string, number | string | boolean>;

export interface ModuleEvent {
  readonly name: string;
  /**
   * What happened, as numbers, text and switches: persistent ids, content ids, amounts. Never an object of the server's.
   * A handler of a "before" event may change the fields the event's catalogue row lists under "may change".
   */
  readonly data: EventData;
  /** Stops what a "before" event is about to do. The first refusal ends the event, and the player is told the reason. */
  refuse(reason: string): void;
}

export interface HandlerOptions {
  /** Handlers run from the highest priority to the lowest. 0 where not given. */
  priority?: number;
  /** What a "before" handler that throws counts as. "allow", the default, is no opinion. */
  onError?: "allow" | "refuse";
}

/** Who ran a command. `pid` is 0 and `operator` true for the server's own console. */
export interface Caller {
  readonly pid: number;
  readonly name: string;
  readonly operator: boolean;
}

export interface ModuleCommand {
  readonly name: string;
  /** Argument summary shown by `help`, such as "<name>". */
  readonly usage: string;
  readonly help: string;
  /** Only for sessions with cheats enabled, and the operator. */
  readonly admin: boolean;
  run(by: Caller, args: string[]): string;
}

/** What a module may read. Values only, true at the moment of the call. */
export interface WorldView {
  readonly tick: number;
  /** Survivors with a live connection. */
  online(): { pid: number; name: string }[];
}

/** The only way a module changes anything. */
export interface Actions {
  /** Shows a line to one survivor, if connected. */
  tell(pid: number, text: string): void;
  /** Shows a line to everyone connected. */
  broadcast(text: string): void;
}

export interface ModuleContext {
  /** Hears `event`. Throws if there is no such event (planning/reference/events.md lists them). */
  on(event: string, fn: (e: ModuleEvent) => void, o?: HandlerOptions): void;
  /** Adds a console command. Throws if the name is taken. */
  command(c: ModuleCommand): void;
  /** Runs `fn` once, `ticks` game ticks from now. Returns a handle for `cancel`. Timers are not saved. */
  after(ticks: number, fn: () => void): number;
  /** Runs `fn` every `ticks` game ticks. */
  every(ticks: number, fn: () => void): number;
  cancel(timer: number): void;
  readonly world: WorldView;
  readonly act: Actions;
  log(line: string): void;
  /** Defines a kind of map event (event.ts). Throws, saying every fault, if it cannot be. In setup only. */
  mapEvent<F extends Fields>(def: EventKindDef<F>): void;
  /** Every kind of map event and every event: calls and ends any. Not in setup. */
  readonly mapEvents: EventsApi;
}

export interface ModuleDef {
  /** Lower-case letters, digits and underscores. */
  readonly name: string;
  /** The version of this contract the module was written for. */
  readonly api: 1;
  /** Modules that must be loaded before this one. */
  readonly needs?: readonly string[];
  /** Called once, as the server starts. Everything is registered here: nothing may be added later. */
  setup(m: ModuleContext): void;
}
