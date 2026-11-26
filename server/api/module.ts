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

/** Who ran a command. `pid` is 0, `id` "" and `operator` true for the server's own console. */
export interface Caller {
  readonly pid: number;
  /** The survivor's 17-digit ID, or "" for none. */
  readonly id: string;
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
  online(): { pid: number; id: string; name: string }[];
}

/**
 * What the cluster's permission groups let a survivor do. Lookups only, true at the moment of the call. For a survivor
 * that is not connected, groups that wait for a sign-in do not count. A pid that is no survivor has nothing.
 */
export interface PermissionsView {
  /** Whether a group that counts for the survivor holds `permission`, such as "Cheat.fly" or one a module names. */
  has(pid: number, permission: string): boolean;
  /** Whether a group of that name counts for the survivor. */
  inGroup(pid: number, group: string): boolean;
  /** The names of the groups that count for the survivor now, Default among them. */
  groups(pid: number): string[];
  /** The survivor's 17-digit ID, or "" for none. */
  id(pid: number): string;
}

/**
 * The only way a module changes anything. A change to the groups is made as an admin named for the module in round
 * brackets: it may fill open, staff and admin groups, never one of the map's or the cluster's rank. Each change is in
 * the admin log under that name and is heard as `perm.changed`.
 */
export interface Actions {
  /** Shows a line to one survivor, if connected. */
  tell(pid: number, text: string): void;
  /** Shows a line to everyone connected. */
  broadcast(text: string): void;
  /** Puts a survivor in a group on this map, for good or for `hours`; more hours lengthen a stay. Answers "" or why not. */
  addToGroup(pid: number, group: string, hours?: number): string;
  /** Takes a survivor out of a group, whether it was in it for good or for a time. Answers "" or why not. */
  removeFromGroup(pid: number, group: string): string;
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
  readonly perms: PermissionsView;
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
