// Loads modules and gives each what the contract promises (server/api/module.ts). A module that fails its setup stops
// the server from starting: half a module is worse than none.

import type { Actions, Caller, ModuleCommand, ModuleContext, ModuleDef, WorldView } from "../api/module.ts";
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
  readonly act: Actions;
  /** Adds a console command. Throws if the name is taken. */
  addCommand(module: string, c: ModuleCommand): void;
  log(line: string): void;
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
      act: host.act,
      log: (line) => host.log(`[${module}] ${line}`),
    };
  }
}

export type { Caller };
