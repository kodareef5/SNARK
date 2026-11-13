// A server and any number of clients in one process, on virtual time.

import { ClientSession } from "../../client/core/session.ts";
import type { GameOptions, GameServer } from "../../server/game.ts";
import { createHost, type Host, type HostOptions } from "../../server/host.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { LoopbackNet, type LinkOptions, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { hashString } from "../../shared/hash.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { buildProvingHeightfield, provingNodes } from "../../shared/world/proving.ts";
import { corePack } from "./pack.ts";
import { coreRegistry } from "./world.ts";

export interface Pilot {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

/** A device key derived from a label, so a test can log in again as the same device. */
export function testKey(label: string): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i += 4) {
    const h = hashString(label, 0x9e3779b9 + i);
    key[i] = h;
    key[i + 1] = h >>> 8;
    key[i + 2] = h >>> 16;
    key[i + 3] = h >>> 24;
  }
  return key;
}

export interface JoinOptions {
  /** Device key; defaults to one derived from the name. */
  key?: Uint8Array;
  spectate?: boolean;
  /** The test advances this session itself (through an App); the harness does not call `update`. */
  manual?: boolean;
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
  private readonly manual = new Set<ClientSession>();
  /** Virtual milliseconds. */
  now = 0;
  private serverClock = 0;
  private readonly clientFrameMs: number;
  // Clients share one generated heightfield; it is immutable.
  private readonly hf = buildProvingHeightfield();

  constructor(opts: Partial<GameOptions> = {}, seed = 1, clientFps = 60, host: HostOptions = {}, reg: Registry = coreRegistry()) {
    this.reg = reg;
    // Posed with the clips of the real pack, as a server started from the built client is.
    this.host = createHost(reg, { clips: corePack().clips, ...host, game: opts });
    this.world = this.host.world;
    this.server = this.host.game;
    this.net = new LoopbackNet(seed);
    this.server.listen(this.net);
    this.clientFrameMs = 1000 / clientFps;
  }

  join(name: string, link: LinkOptions = {}, opts: JoinOptions = {}): ClientSession {
    const end = this.net.connect(link);
    const session = new ClientSession(end, {
      name,
      key: opts.key ?? testKey(name),
      spectate: opts.spectate ?? false,
      registry: this.reg,
      clipHash: this.world.anim.set.hash,
      resolveMap: (_id, hash) => (hash === this.world.mapHash ? this.hf : null),
      nodes: (hf, reg) => (this.world.nodeField ? provingNodes(hf, reg) : null),
    });
    this.sessions.push(session);
    if (opts.manual) this.manual.add(session);
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
        if (!this.manual.has(this.sessions[i]!)) this.sessions[i]!.update(this.now, p.moveX, p.moveZ, p.yaw, p.pitch, p.buttons);
      }
    }
  }

  /** Server-side entity index for a session. */
  ent(session: ClientSession): number {
    return this.world.ents.resolve(session.ownHandle);
  }

  /** The server's side of a session. */
  client(session: ClientSession) {
    const i = this.sessions.indexOf(session);
    return this.server.clients.find((c) => c !== null && c.conn === this.ends[i]!.peer) ?? null;
  }

  /** Type a console line as `session` and return every line the server printed in reply. */
  say(session: ClientSession, line: string, ms = 300): string[] {
    const before = session.logVersion;
    session.text(line);
    this.run(ms);
    const n = session.logVersion - before;
    return n > 0 ? session.log.slice(-n).map((l) => l.text) : [];
  }
}
