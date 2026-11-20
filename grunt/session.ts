// One connection to a game, as the protocol has it: hello and welcome, observing and subscribing, acts with their ack
// and an outcome for each action, and enough pings to stay inside the leash. It decides nothing.

import type { Link } from "./link.ts";
import {
  GRUNT_VERSION, type Ack, type Action, type ChannelRequest, type GameEvent, type GameMessage, type Observation,
  type Outcome, type Refused, type Welcome,
} from "./protocol.ts";

/** Time as grunt sees it: the runtime's clock, so tests can drive it with the world. */
export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

export interface Acted {
  command: string;
  ack: Promise<Ack>;
  outcomes: Promise<Outcome>[];
  /** The same, filled in as the messages arrive, for code that checks rather than waits (the skills' steps). */
  state: { ack?: Ack; outcomes: (Outcome | undefined)[]; done: boolean };
}

type Listener = { observation: (o: Observation) => void; event: (e: GameEvent) => void; outcome: (o: Outcome) => void; message: (m: GameMessage) => void };

export class Session {
  welcome: Welcome | null = null;
  /** The highest `seq` heard: what a decision is made on. */
  seq = 0;
  private n = 0;
  private readonly waiting = new Map<string, (m: GameMessage) => void>();
  private readonly acks = new Map<string, (a: Ack) => void>();
  private readonly outcomeWait = new Map<string, (o: Outcome) => void>();
  private readonly listeners: { [K in keyof Listener]: Listener[K][] } = { observation: [], event: [], outcome: [], message: [] };
  private stopPing: (() => void) | null = null;
  private readonly link: Link;
  private readonly clock: Clock;

  constructor(link: Link, clock: Clock = systemClock) {
    this.link = link;
    this.clock = clock;
    link.onMessage((m) => this.receive(m));
  }

  on<K extends keyof Listener>(kind: K, fn: Listener[K]): void {
    this.listeners[kind].push(fn);
  }

  private id(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  private receive(m: GameMessage): void {
    if ("seq" in m && typeof m.seq === "number") this.seq = Math.max(this.seq, m.seq);
    for (const fn of this.listeners.message) fn(m);
    if (m.re && this.waiting.has(m.re)) {
      const done = this.waiting.get(m.re)!;
      this.waiting.delete(m.re);
      done(m);
    }
    if (m.type === "ack") this.acks.get(m.command)?.(m);
    if (m.type === "outcome") {
      const key = `${m.command}/${m.index}`;
      this.outcomeWait.get(key)?.(m);
      this.outcomeWait.delete(key);
      for (const fn of this.listeners.outcome) fn(m);
    }
    if (m.type === "observation") for (const fn of this.listeners.observation) fn(m);
    if (m.type === "event") for (const fn of this.listeners.event) fn(m);
  }

  private request<T extends GameMessage>(m: Record<string, unknown> & { type: string }): Promise<T> {
    const id = this.id(m.type[0]!);
    return new Promise((resolve) => {
      this.waiting.set(id, (reply) => resolve(reply as T));
      this.link.send({ grunt: GRUNT_VERSION, ...m, id } as never);
    });
  }

  async hello(name: string, client = { name: "pi-grunt", version: "0.0.1" }): Promise<Welcome> {
    const resume = this.welcome ? { session: this.welcome.session, last_seq: this.seq } : undefined;
    const reply = await this.request<Welcome | Refused>({ type: "hello", versions: [GRUNT_VERSION], client, auth: { method: "name", name }, ...(resume ? { resume } : {}) });
    if (reply.type !== "welcome") throw new Error(`refused (${reply.code}): ${reply.reason}`);
    this.welcome = reply;
    this.stopPing?.();
    this.stopPing = this.clock.every(Math.max(100, Math.floor(reply.limits.leash_ms / 3)), () => this.link.send({ grunt: GRUNT_VERSION, type: "ping" }));
    return reply;
  }

  observe(channels: ChannelRequest): Promise<Observation> {
    return this.request<Observation>({ type: "observe", channels });
  }

  subscribe(channels: ChannelRequest, events: string[] = ["*"]): Promise<GameMessage> {
    return this.request({ type: "subscribe", channels, events });
  }

  /** Sends actions to start together. Each accepted action's outcome resolves when it ends; a rejected one at once. */
  act(actions: Action[]): Acted {
    const command = `${this.welcome?.session ?? "x"}-${++this.n}`;
    const state: Acted["state"] = { outcomes: actions.map(() => undefined), done: false };
    const settle = (o: Outcome) => {
      state.outcomes[o.index] = o;
      state.done = state.outcomes.every(Boolean);
    };
    const outcomes = actions.map((_, index) => new Promise<Outcome>((resolve) => this.outcomeWait.set(`${command}/${index}`, (o) => (settle(o), resolve(o)))));
    const ack = new Promise<Ack>((resolve) => {
      this.acks.set(command, (a) => {
        this.acks.delete(command);
        state.ack = a;
        for (const r of a.actions) {
          if (r.accepted) continue;
          const key = `${command}/${r.index}`;
          this.outcomeWait.get(key)?.({ grunt: GRUNT_VERSION, type: "outcome", command, index: r.index, seq: a.seq, status: "failed", code: r.code });
          this.outcomeWait.delete(key);
        }
        resolve(a);
      });
    });
    this.link.send({ grunt: GRUNT_VERSION, type: "act", command, basis: this.seq, actions });
    return { command, ack, outcomes, state };
  }

  close(): void {
    this.stopPing?.();
    this.link.send({ grunt: GRUNT_VERSION, type: "bye" });
    this.link.close();
  }
}
