// A server and any number of clients in one process, on virtual time.

import type { CityMaker } from "../../client/core/render/citymake.ts";
import { ClientSession } from "../../client/core/session.ts";
import type { GameOptions, GameServer } from "../../server/game.ts";
import { createHost, type Host, type HostOptions } from "../../server/host.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { backlog } from "../../shared/net/transport.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { LoopbackNet, type LinkOptions, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { hashString } from "../../shared/hash.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import type { Connection } from "../../shared/net/transport.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, mapNodes, parseMap, type MapFile } from "../../shared/world/mapfile.ts";
import { defaultLook } from "../../shared/anim/look.ts";
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

/**
 * SNARK_NET="tcp loss=0.02 burst=60 latency=50 jitter=10" runs every join over such a link. Its fields replace a test's
 * own, but latency only ever adds.
 */
export function forcedLink(spec: string): LinkOptions {
  const link: LinkOptions = {};
  for (const word of spec.split(/\s+/)) {
    const [key, value] = word.split("=");
    const n = Number(value);
    if (key === "tcp") link.tcp = true;
    else if (key === "loss") link.loss = n;
    else if (key === "burst") link.burstMs = n;
    else if (key === "latency") link.latencyMs = n;
    else if (key === "jitter") link.jitterMs = n;
  }
  return link;
}

const FORCED = forcedLink(process.env.SNARK_NET ?? "");

/**
 * What a server gives every survivor unless its host says not: the menu's Creative entry with the admin role for all (D956),
 * the Meridian set at every spawn (D957), and a starter pteranodon in a soul ball (D992); and its drop book's circuits call
 * supply drops near whoever is in the world. The tests of everything else were written for a world with none of them, so
 * a Harness leaves them out: each of these settings its rules still hold at
 * the default is put as here. `asShipped` keeps them. The welcome said to each who joins is left out the same way: the
 * tests count the lines a survivor is sent.
 */
const PLAIN: readonly (readonly [name: string, value: boolean | string])[] = [["bShowCreativeMode", false], ["CreativeForAll", false], ["bDisableDefaultMapItemSets", true], ["StarterMount", false], ["bDisableLootCrates", true], ["Message", ""]];
const SHIPPED = new WeakSet<Rules>();

/** Rules a Harness leaves as the server ships them: everyone's cheats, the suit at spawn and the starter mount on. */
export function asShipped(rules = new Rules()): Rules {
  SHIPPED.add(rules);
  return rules;
}

/** `rules`, or new ones, with what PLAIN names put as there, unless they are asShipped. */
export function plainRules(rules = new Rules()): Rules {
  if (SHIPPED.has(rules)) return rules;
  for (const [name, value] of PLAIN) {
    const row = rowOf(name)!;
    if (rules.sourceOf(row) === "default") rules.put(row, value, "default");
  }
  return rules;
}

export interface JoinOptions {
  intent?: "create"|"resume";
  createRequest?: Uint8Array;
  /** Defaults to testKey(name). */
  key?: Uint8Array;
  spectate?: boolean;
  /** The test advances this session itself, through an App. The harness does not call `update`. */
  manual?: boolean;
  /** Defaults to defaultLook(). With null the survivor arrives in the creator instead. */
  look?: Uint8Array | null;
  password?: string;
  /** Defaults to the harness's registry. */
  registry?: Registry;
  /** A travel ticket another server gave (S_TRAVEL). */
  ticket?: Uint8Array;
  /** False joins without the map's statics, so every chunk's rows come whole. */
  statics?: boolean;
  /** Where the far city's levels are made, here by default. */
  cityMaker?: CityMaker;
  /** The map's ground as this client holds it, the map's own by default: a page's comes a part at a time. */
  ground?: Heightfield;
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
  /** The server's side of each session's connection. */
  private readonly servers: Connection[] = [];
  private readonly manual = new Set<ClientSession>();
  /** Virtual milliseconds. */
  now = 0;
  private serverClock = 0;
  private readonly clientFrameMs: number;
  // Clients read the map file the host serves, as a browser does, and share its ground, which is immutable.
  private readonly map: MapFile;
  private readonly hf: Heightfield;

  constructor(opts: Partial<GameOptions> = {}, seed = 1, clientFps = 60, host: HostOptions = {}, reg: Registry = coreRegistry()) {
    // The host uses the real pack's clips and rigs, as a server started from the built client does, unless given others.
    this.host = createHost(reg, { ...host, config: plainRules(host.config), clips: host.clips ?? corePack().clips, rigs: host.rigs ?? corePack().header.rigs, game: opts });
    this.world = this.host.world;
    this.map = parseMap(this.host.mapFile!);
    // A map with landmarks adds their definitions, as a browser compiles them from the map it fetched.
    this.reg = this.map.content?.defs.length ? (this.world.reg.source ?? this.world.reg) : reg;
    this.hf = mapHeightfield(this.map);
    this.server = this.host.game;
    this.net = new LoopbackNet(seed);
    this.server.listen(this.net);
    this.clientFrameMs = 1000 / clientFps;
  }

  join(name: string, link: LinkOptions = {}, opts: JoinOptions = {}): ClientSession {
    const end = this.net.connect({ ...link, ...FORCED, latencyMs: Math.max(link.latencyMs ?? 0, FORCED.latencyMs ?? 0) });
    this.gate(end.peer);
    return this.adopt(name, end, end, end.peer, opts);
  }

  /** The server's socket skips what it cannot send, as the real one does. */
  gate(server: LoopbackEnd): void {
    server.gate = (channel, buffered) => {
      const rule = backlog(channel, buffered, this.server.opts.snapshotBytesMax);
      if (rule === 2) server.close();
      return rule === 0;
    };
  }

  /** A session over a connection made apart, `end` standing for it in `ends`, whose server side the server has accepted as `server`. */
  adopt(name: string, conn: Connection, end: LoopbackEnd, server: Connection, opts: JoinOptions = {}): ClientSession {
    const session = new ClientSession(conn, {
      name,
      key: opts.key ?? testKey(name),
      intent:opts.intent, createRequest:opts.createRequest,
      spectate: opts.spectate ?? false,
      registry: opts.registry ?? this.reg,
      ...(opts.password !== undefined ? { password: opts.password } : {}),
      clipHash: this.world.anim.set.hash,
      ...(opts.look === null ? {} : { look: opts.look ?? defaultLook() }),
      ...(opts.ticket ? { ticket: opts.ticket } : {}),
      resolveMap: (id, hash) => (id === this.map.id && hash === this.map.hash ? (opts.ground ?? this.hf) : null),
      nodes: (hf, reg) => mapNodes(this.map, hf, reg),
      ...(opts.statics === false ? {} : { statics: this.map.statics }),
      ...(this.map.content ? { landmarks: this.map.content.landmarks } : {}),
      ...(opts.cityMaker ? { cityMaker: opts.cityMaker } : {}),
    });
    this.sessions.push(session);
    if (opts.manual) this.manual.add(session);
    this.ends.push(end);
    this.servers.push(server);
    this.pilots.push({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 });
    return session;
  }

  /** `ms` is virtual time. Clients run at their frame rate and the server at the tick rate. */
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

  /** The server's Client for a session, or null. */
  client(session: ClientSession) {
    const i = this.sessions.indexOf(session);
    return this.server.clients.find((c) => c !== null && c.conn === this.servers[i]) ?? null;
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
