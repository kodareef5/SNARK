// How grunt reaches a game: a Link carries protocol messages both ways. Over a WebSocket in play (Node's own
// WebSocket, which Pi has), or straight into a game's endpoint in the same process for tests and the mock world.

import type { ClientMessage, GameMessage } from "./protocol.ts";

export interface Link {
  send(m: ClientMessage): void;
  onMessage(fn: (m: GameMessage) => void): void;
  onClose(fn: (why: string) => void): void;
  close(): void;
}

/** Anything shaped like a game's endpoint: give it a sender, get back what receives. */
export type Endpoint = (send: (m: GameMessage) => void) => { receive(raw: unknown): void; close(): void };

/** A link into an endpoint in this process. Messages are passed as JSON text both ways, as a socket would. */
export function memoryLink(connect: Endpoint): Link {
  const handlers: ((m: GameMessage) => void)[] = [];
  const closers: ((why: string) => void)[] = [];
  const conn = connect((m) => {
    const copy = JSON.parse(JSON.stringify(m)) as GameMessage;
    for (const h of handlers) h(copy);
  });
  return {
    send: (m) => conn.receive(JSON.stringify(m)),
    onMessage: (fn) => void handlers.push(fn),
    onClose: (fn) => void closers.push(fn),
    close: () => {
      conn.close();
      for (const c of closers) c("closed");
    },
  };
}

/** A link over a WebSocket, open when the promise resolves. */
export function socketLink(url: string): Promise<Link> {
  const WS = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!WS) return Promise.reject(new Error("this runtime has no WebSocket (Node 22 or later has one)"));
  const ws = new WS(url);
  const handlers: ((m: GameMessage) => void)[] = [];
  const closers: ((why: string) => void)[] = [];
  return new Promise((resolve, reject) => {
    ws.onopen = () =>
      resolve({
        send: (m) => ws.send(JSON.stringify(m)),
        onMessage: (fn) => void handlers.push(fn),
        onClose: (fn) => void closers.push(fn),
        close: () => ws.close(),
      });
    ws.onerror = () => reject(new Error(`could not open ${url}`));
    ws.onmessage = (e) => {
      let m: GameMessage;
      try {
        m = JSON.parse(String(e.data)) as GameMessage;
      } catch {
        return;
      }
      for (const h of handlers) h(m);
    };
    ws.onclose = (e) => {
      for (const c of closers) c(e.reason || `closed (${e.code})`);
    };
  });
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
}
