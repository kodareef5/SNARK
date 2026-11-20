// The game's side of the grunt protocol (grunt/protocol.md), for any game: hello and welcome, observing and subscribing,
// acts with their acks and outcomes, events, and the leash. A game supplies a GameWorld (its character's senses and
// controls) and its capabilities; this knows nothing of the transport: `connect` takes a function that sends a
// message and returns what receives them. Call `afterStep` after each step of the world: it sends the observations
// that are due and lets go of the character's controls when the client goes quiet. The mock world (tools/grunt) and
// SNARK's gateway (agent/gateway.ts) both use it.

import {
  type Ack, type Action, type Capabilities, type ChannelName, type ChannelOptions, type ChannelRequest, type Channels, type ChatLine,
  type ClientMessage, type EntitiesChannel, type FocusChannel, GRUNT_VERSION, type GameMessage, type Interruption,
  type InventoryChannel, type Limits, type MapChannel, type RejectCode, type SelfChannel, type TerrainChannel,
} from "./protocol.ts";

/** What a world tells the endpoint: an outcome of an action it accepted, or an event. */
export type WorldEvent =
  | { type: "event"; kind: string; data: Record<string, unknown> }
  | { type: "outcome"; command: string; index: number; status: "completed" | "interrupted" | "failed";
      by?: Interruption; code?: RejectCode | "blocked"; detail?: Record<string, unknown> };

/** A game's character as the protocol sees it: its senses (the channels) and its controls (act). */
export interface GameWorld {
  readonly tick: number;
  /** Milliseconds, the game's clock. */
  readonly t: number;
  readonly me: { id: string; name: string; alive: boolean };
  /** Every chat line the character has heard, oldest first. */
  readonly heardChat: ChatLine[];
  on(fn: (e: WorldEvent) => void): void;
  /** Takes one action: null if accepted (its outcome comes later, as a WorldEvent), else why not. */
  act(command: string, index: number, a: Action): RejectCode | null;
  /** Tells the outcomes of instant actions taken since the last flush. */
  flush(): void;
  releaseAll(by: Interruption): void;
  selfChannel(): SelfChannel;
  entitiesChannel(radius?: number, max?: number): EntitiesChannel;
  terrainChannel(radius?: number, cell?: number): TerrainChannel;
  mapChannel(cell?: number): MapChannel | null;
  inventoryChannel(): InventoryChannel;
  focusChannel(): FocusChannel;
  /** The name a hello gives the character, where the game takes one then. */
  named?(name: string): void;
}

export interface EndpointOptions {
  capabilities: () => Capabilities;
  limits: Limits;
  game: { name: string; version: string; world?: string };
  /** The shortest time between two observations of a channel, ms: the world's step. */
  tickMs: number;
}

export interface Connection {
  receive(raw: unknown): void;
  close(): void;
}

interface Sub {
  opts: ChannelOptions;
  hz: number | null;
  due: number;
}

export class Endpoint {
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
  private readonly world: GameWorld;
  private readonly opts: EndpointOptions;

  constructor(world: GameWorld, opts: EndpointOptions) {
    this.world = world;
    this.opts = opts;
    world.on((e) => this.fromWorld(e));
  }

  private get caps(): Capabilities {
    return this.opts.capabilities();
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
        if (m.auth?.name) this.world.named?.(String(m.auth.name));
      }
      this.live = link;
      const me = this.world.me;
      this.send({
        grunt: GRUNT_VERSION, type: "welcome", ...(re ? { re } : {}), session: this.session!, seq: ++this.seq, game: this.opts.game,
        character: { id: me.id, name: me.name, alive: me.alive }, frame: { units: "m", up: "+y", east: "+x", south: "+z" },
        capabilities: this.caps, limits: this.opts.limits,
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
          if (!this.caps.channels.includes(name)) continue;
          const hz = opts.hz ? Math.min(opts.hz, this.opts.limits.max_rate_hz) : null;
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
          if (!this.caps.controls.includes(a?.control)) return { index, accepted: false as const, code: "unknown_control" as const };
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
    if (!this.leashed && this.world.t - this.heard > this.opts.limits.leash_ms) {
      this.leashed = true;
      this.world.releaseAll("disconnected");
    }
    const due: ChannelRequest = {};
    for (const [name, s] of this.subs) {
      if (!s.hz || this.world.t < s.due) continue;
      s.due = this.world.t + Math.max(this.opts.tickMs, 1000 / s.hz);
      due[name] = s.opts;
    }
    if (Object.keys(due).length) this.send({ grunt: GRUNT_VERSION, type: "observation", ...this.stamp(), channels: this.channels(due) });
  }
}
