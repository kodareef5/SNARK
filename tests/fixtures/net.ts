// A server and any number of clients in one process, on virtual time.

import { ClientSession } from "../../client/core/session.ts";
import type { GameOptions, GameServer } from "../../server/game.ts";
import { createHost, type Host, type HostOptions } from "../../server/host.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { LoopbackNet, type LinkOptions, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { coreRegistry } from "./world.ts";

export interface Pilot {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

export class Harness {
  readonly reg: Registry;
  readonly host: Host;
  readonly world: ServerWorld;
  readonly server: GameServer;
  readonly net: LoopbackNet;
  readonly sessions: ClientSession[] = [];
  readonly ends: LoopbackEnd[] = [];
  readonly pilots: Pilot[] = [];
  /** Virtual milliseconds. */
  now = 0;
  private serverClock = 0;
  private readonly clientFrameMs: number;
  // Clients share one generated heightfield; it is immutable.
  private readonly hf = buildProvingHeightfield();

  constructor(opts: Partial<GameOptions> = {}, seed = 1, clientFps = 60, host: HostOptions = {}, reg: Registry = coreRegistry()) {
    this.reg = reg;
    this.host = createHost(reg, { ...host, game: opts });
    this.world = this.host.world;
    this.server = this.host.game;
    this.net = new LoopbackNet(seed);
    this.server.listen(this.net);
    this.clientFrameMs = 1000 / clientFps;
  }

  join(name: string, link: LinkOptions = {}): ClientSession {
    const end = this.net.connect(link);
    const session = new ClientSession(end, {
      name,
      registry: this.reg,
      resolveMap: (_id, hash) => (hash === this.world.mapHash ? this.hf : null),
    });
    this.sessions.push(session);
    this.ends.push(end);
    this.pilots.push({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 });
    return session;
  }

  /** Run for `ms` of virtual time: clients at their frame rate, the server at the tick rate. */
  run(ms: number, eachFrame?: (now: number) => void): void {
    const end = this.now + ms;
    const tickMs = 1000 / TICK_RATE;
    while (this.now < end) {
      this.now += this.clientFrameMs;
      this.net.advance(this.now);
      while (this.serverClock + tickMs <= this.now) {
        this.serverClock += tickMs;
        this.server.tick();
      }
      eachFrame?.(this.now);
      for (let i = 0; i < this.sessions.length; i++) {
        const p = this.pilots[i]!;
        this.sessions[i]!.update(this.now, p.moveX, p.moveZ, p.yaw, p.pitch, p.buttons);
      }
    }
  }

  /** Server-side entity index for a session. */
  ent(session: ClientSession): number {
    return this.world.ents.resolve(session.ownHandle);
  }
}
