// Loads modules and gives each what the contract promises (server/api/module.ts). A module that fails its setup stops
// the server from starting: half a module is worse than none.

import type { PermissionOp } from "../../shared/permissions/model.ts";
import { RANK_ADMIN } from "../../shared/ranks.ts";
import type { Actor } from "../acts.ts";
import type { Actions, Caller, ModuleCommand, ModuleContext, ModuleDef, PermissionsView, WorldView } from "../api/module.ts";
import type { EventKindDef, EventsApi } from "../api/event.ts";
import type { Fields } from "../../shared/mapevent/fields.ts";
import type { Bus } from "./bus.ts";
import { eventIndex } from "./catalog.ts";

const NAME = /^[a-z][a-z0-9_]*$/;
const MODULE_LOADED = eventIndex("module.loaded");

interface Timer {
  id: number;
  module: string;
  at: number;
  every: number;
  fn: () => void;
}

/** What the loader needs of the host. */
export interface ModuleHost {
  readonly bus: Bus;
  readonly world: WorldView;
  readonly perms: PermissionsView;
  readonly act: Pick<Actions, "tell" | "broadcast">;
  /** The world a module's memberships are for. */
  readonly permissionWorld: number;
  /** Makes one permission change as `by`, as the host does for commands and pages. Answers "" or why not. */
  changePermissions(by: Actor, op: PermissionOp): string;
  /** Adds a console command. Throws if the name is taken. */
  addCommand(module: string, c: ModuleCommand): void;
  log(line: string): void;
  /** Defines a kind of map event for a module, and what a module may do with map events. */
  defineEvent(module: string, def: EventKindDef<Fields>): void;
  events(module: string): EventsApi;
}

export class Modules {
  readonly names: string[] = [];
  private readonly host: ModuleHost;
  private readonly timers: Timer[] = [];
  private nextTimer = 1;
  private settingUp = false;

  constructor(host: ModuleHost, defs: readonly ModuleDef[]) {
    this.host = host;
    for (const def of defs) {
      if (!NAME.test(def.name)) throw new Error(`module "${def.name}": a name is lower-case letters, digits and underscores`);
      if (this.names.includes(def.name)) throw new Error(`module ${def.name} is loaded twice`);
      if (def.api !== 1) throw new Error(`module ${def.name} was written for version ${String(def.api)} of the contract, and this server speaks 1`);
      for (const need of def.needs ?? []) if (!this.names.includes(need)) throw new Error(`module ${def.name} needs ${need}, which is not loaded before it`);
      this.settingUp = true;
      try {
        def.setup(this.context(def.name));
      } finally {
        this.settingUp = false;
      }
      this.names.push(def.name);
    }
    host.bus.close();
    for (const name of this.names) host.bus.after(MODULE_LOADED, { name });
  }

  /** Runs the timers that are due. Call once a tick. A timer that throws is logged and kept. */
  step(tick: number): void {
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i]!;
      if (tick < t.at) continue;
      if (t.every > 0) t.at = tick + t.every;
      else this.timers.splice(i--, 1);
      try {
        t.fn();
      } catch (err) {
        this.host.log(`module ${t.module} threw in a timer: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private context(module: string): ModuleContext {
    const host = this.host;
    const late = (what: string): void => {
      if (!this.settingUp) throw new Error(`${module}: ${what} are added in setup, not later`);
    };
    const timer = (ticks: number, every: number, fn: () => void): number => {
      if (!(ticks >= 1)) throw new Error(`${module}: a timer waits at least one tick`);
      const id = this.nextTimer++;
      this.timers.push({ id, module, at: host.world.tick + Math.ceil(ticks), every: every > 0 ? Math.ceil(every) : 0, fn });
      return id;
    };
    // The round brackets keep it from being any survivor's name.
    const by: Actor = Object.freeze({ name: `(${module})`, id: "", pid: 0, rank: RANK_ADMIN, via: "module", from: "", baseRank: RANK_ADMIN, open: false });
    const member = (pid: number, op: (key: string) => PermissionOp): string => {
      const key = host.perms.id(pid);
      if (key === "") return "No survivor with an ID has that pid.";
      try {
        return host.changePermissions(by, op(key));
      } catch (err) {
        host.log(`module ${module} made a permission change that threw: ${err instanceof Error ? err.message : String(err)}`);
        return "That change could not be made.";
      }
    };
    return {
      on: (event, fn, o) => host.bus.on(module, event, fn, o),
      command: (c) => {
        late("commands");
        host.addCommand(module, c);
      },
      after: (ticks, fn) => timer(ticks, 0, fn),
      every: (ticks, fn) => timer(ticks, ticks, fn),
      cancel: (id) => {
        const at = this.timers.findIndex((t) => t.id === id && t.module === module);
        if (at >= 0) this.timers.splice(at, 1);
      },
      world: host.world,
      perms: host.perms,
      act: {
        ...host.act,
        addToGroup: (pid, group, hours) =>
          member(pid, (key) => ({ op: "addMember", kind: "survivor", key, group, world: host.permissionWorld, ...(hours === undefined ? {} : { hours }) })),
        removeFromGroup: (pid, group) => member(pid, (key) => ({ op: "removeMember", kind: "survivor", key, group })),
      },
      log: (line) => host.log(`[${module}] ${line}`),
      mapEvent: (def) => {
        late("map events");
        host.defineEvent(module, def as unknown as EventKindDef<Fields>);
      },
      mapEvents: host.events(module),
    };
  }
}

export type { Caller };
