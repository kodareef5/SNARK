// The game's side of the grunt protocol (grunt/protocol.md), for the mock world. It knows nothing of the transport:
// `connect` takes a function that sends a message, and returns what receives them, so a test can wire it to a client
// in the same process and serve.ts can put it on a WebSocket. Call `afterStep` after each world step: it sends the
// observations that are due and lets go of the character's controls when the client goes quiet.

import { BUILDING } from "./structures.ts";
import {
  GRUNT_VERSION, type Ack, type Capabilities, type ChannelName, type ChannelOptions, type ChannelRequest, type Channels,
  type ClientMessage, type GameMessage, type Limits,
} from "../../grunt/protocol.ts";
import { ASSIST, TICK_MS, VOICE_RANGE, type World, type WorldEvent } from "./world.ts";

export const LIMITS: Limits = { max_duration_ms: 2000, leash_ms: 1500, max_rate_hz: 20, act_per_s: 20, command_memory_s: 600 };
export const CAPABILITIES: Capabilities = {
  channels: ["self", "entities", "terrain", "inventory", "chat", "focus"],
  controls: ["move", "look", "jump", "crouch", "stop", "interact", "use", "select", "items", "craft", "chat", "plan", "assist"],
  events: ["hurt", "died", "chat", "item", "notice", "blocked", "heard", "crafted", "built", "mounted", "dismounted", "struck", "damaged", "repaired"],
  verbs: ["harvest", "open", "close"],
  building: BUILDING,
  assists: { kinds: ["aim", "attack", "harvest", "follow", "repair"], ...ASSIST },
  voice: { range: VOICE_RANGE },
};

export interface Connection {
  receive(raw: unknown): void;
  close(): void;
}

interface Sub {
  opts: ChannelOptions;
  hz: number | null;
  due: number;
}

export class GameEndpoint {
  private seq = 0;
  private session: string | null = null;
  private live: { send: (m: GameMessage) => void } | null = null;
  private subs = new Map<ChannelName, Sub>();
  private events = new Set<string>();
  private acks = new Map<string, Ack>();
  private mine = new Set<string>();
  private heard = 0;
  private chatSent = 0;
  private leashed = false;
  private readonly world: World;
  private readonly game: { name: string; version: string; world: string };

  constructor(world: World, game = { name: "mock", version: "0", world: "beach" }) {
    this.world = world;
    this.game = game;
    world.on((e) => this.fromWorld(e));
  }

  connect(send: (m: GameMessage) => void): Connection {
    const link = { send };
    return {
      receive: (raw) => this.receive(link, raw),
      close: () => {
        if (this.live === link) this.live = null;
      },
    };
  }

  private stamp() {
    return { seq: ++this.seq, tick: this.world.tick, t: this.world.t };
  }

  private send(m: GameMessage): void {
    this.live?.send(m);
  }

  private receive(link: { send: (m: GameMessage) => void }, raw: unknown): void {
    let m: ClientMessage;
    try {
      m = (typeof raw === "string" ? JSON.parse(raw) : raw) as ClientMessage;
    } catch {
      link.send({ grunt: GRUNT_VERSION, type: "error", code: "malformed", message: "not JSON" });
      return;
    }
    if (!m || typeof m !== "object" || typeof m.type !== "string") {
      link.send({ grunt: GRUNT_VERSION, type: "error", code: "malformed", message: "no type" });
      return;
    }
    this.heard = this.world.t;
    this.leashed = false;
    const re = m.id;
    if (m.type === "hello") {
      if (!m.versions?.includes(GRUNT_VERSION)) {
        link.send({ grunt: GRUNT_VERSION, type: "refused", ...(re ? { re } : {}), code: "version", reason: `this game speaks grunt ${GRUNT_VERSION}`, retry: false });
        return;
      }
      const resumed = !!m.resume && m.resume.session === this.session;
      if (this.live && this.live !== link && !resumed) {
        link.send({ grunt: GRUNT_VERSION, type: "refused", ...(re ? { re } : {}), code: "full", reason: "the character is played from another connection", retry: true });
        return;
      }
      if (!resumed) {
        this.session = `s-${(this.world.tick + 1).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        this.subs.clear();
        this.events.clear();
        this.acks.clear();
        this.mine.clear();
        if (m.auth?.name) this.world.me.name = String(m.auth.name);
      }
      this.live = link;
      const me = this.world.me;
      this.send({
        grunt: GRUNT_VERSION, type: "welcome", ...(re ? { re } : {}), session: this.session!, seq: ++this.seq, game: this.game,
        character: { id: me.id, name: me.name, alive: me.alive }, frame: { units: "m", up: "+y", east: "+x", south: "+z" },
        capabilities: this.world.terrain ? { ...CAPABILITIES, channels: [...CAPABILITIES.channels, "map"] } : CAPABILITIES, limits: LIMITS,
      });
      return;
    }
    if (link !== this.live) {
      link.send({ grunt: GRUNT_VERSION, type: "error", ...(re ? { re } : {}), code: "unknown_type", message: "say hello first" });
      return;
    }
    switch (m.type) {
      case "ping":
        return this.send({ grunt: GRUNT_VERSION, type: "pong", ...(re ? { re } : {}), ...this.stamp() });
      case "bye":
        this.world.releaseAll("disconnected");
        this.live = null;
        return;
      case "observe":
        return this.send({ grunt: GRUNT_VERSION, type: "observation", ...(re ? { re } : {}), ...this.stamp(), channels: this.channels(m.channels) });
      case "subscribe": {
        this.subs.clear();
        const granted: ChannelRequest = {};
        for (const [name, opts] of Object.entries(m.channels ?? {}) as [ChannelName, ChannelOptions][]) {
          if (!CAPABILITIES.channels.includes(name) && !(name === "map" && this.world.terrain)) continue;
          const hz = opts.hz ? Math.min(opts.hz, LIMITS.max_rate_hz) : null;
          this.subs.set(name, { opts, hz, due: this.world.t });
          granted[name] = { ...opts, ...(hz ? { hz } : {}) };
        }
        this.events = new Set(m.events ?? []);
        this.send({ grunt: GRUNT_VERSION, type: "subscribed", ...(re ? { re } : {}), channels: granted });
        return;
      }
      case "unsubscribe":
        for (const c of m.channels ?? []) this.subs.delete(c);
        for (const e of m.events ?? []) this.events.delete(e);
        return;
      case "act": {
        const before = this.acks.get(m.command);
        if (before) return this.send({ ...before, ...(re ? { re } : {}), duplicate: true });
        this.mine.add(m.command);
        const actions = (m.actions ?? []).map((a, index) => {
          if (!CAPABILITIES.controls.includes(a?.control)) return { index, accepted: false as const, code: "unknown_control" as const };
          const code = this.world.act(m.command, index, a);
          return code ? { index, accepted: false as const, code } : { index, accepted: true as const };
        });
        const ack: Ack = { grunt: GRUNT_VERSION, type: "ack", command: m.command, ...this.stamp(), actions };
        this.acks.set(m.command, ack);
        this.send({ ...ack, ...(re ? { re } : {}) });
        this.world.flush();
        return;
      }
      default:
        this.send({ grunt: GRUNT_VERSION, type: "error", ...(re ? { re } : {}), code: "unknown_type", message: `no message ${(m as { type: string }).type}` });
    }
  }

  private channels(req: ChannelRequest): Partial<Channels> {
    const w = this.world, out: Partial<Channels> = {};
    for (const [name, o] of Object.entries(req ?? {}) as [ChannelName, ChannelOptions][]) {
      if (name === "self") out.self = w.selfChannel();
      else if (name === "entities") out.entities = w.entitiesChannel(o.radius, o.max);
      else if (name === "terrain") out.terrain = w.terrainChannel(o.radius, o.cell);
      else if (name === "map") {
        const m = w.mapChannel(o.cell);
        if (m) out.map = m;
      }
      else if (name === "inventory") out.inventory = w.inventoryChannel();
      else if (name === "focus") out.focus = w.focusChannel();
      else if (name === "chat") {
        out.chat = { lines: w.heardChat.slice(this.chatSent) };
        this.chatSent = w.heardChat.length;
      }
    }
    return out;
  }

  private fromWorld(e: WorldEvent): void {
    if (e.type === "outcome") {
      if (!this.mine.has(e.command)) return;
      this.send({
        grunt: GRUNT_VERSION, type: "outcome", command: e.command, index: e.index, seq: ++this.seq, status: e.status,
        ...(e.by ? { by: e.by } : {}), ...(e.code ? { code: e.code } : {}), ...(e.detail ? { detail: e.detail } : {}),
      });
      return;
    }
    if (e.kind === "chat" && this.subs.has("chat")) {
      const lines = this.world.heardChat.slice(this.chatSent);
      this.chatSent = this.world.heardChat.length;
      this.send({ grunt: GRUNT_VERSION, type: "observation", ...this.stamp(), channels: { chat: { lines } } });
    }
    if (this.events.has("*") || this.events.has(e.kind)) {
      this.send({ grunt: GRUNT_VERSION, type: "event", ...this.stamp(), kind: e.kind, data: e.data });
    }
  }

  /** After each world step: the observations that are due, and the leash. */
  afterStep(): void {
    if (!this.live) return;
    if (!this.leashed && this.world.t - this.heard > LIMITS.leash_ms) {
      this.leashed = true;
      this.world.releaseAll("disconnected");
    }
    const due: ChannelRequest = {};
    for (const [name, s] of this.subs) {
      if (!s.hz || this.world.t < s.due) continue;
      s.due = this.world.t + Math.max(TICK_MS, 1000 / s.hz);
      due[name] = s.opts;
    }
    if (Object.keys(due).length) this.send({ grunt: GRUNT_VERSION, type: "observation", ...this.stamp(), channels: this.channels(due) });
  }
}
