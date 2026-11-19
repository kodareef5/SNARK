// `bun tools/map/link.ts <port> <mbit> <latency ms>`: the map trip's link (tools/map/trip.ts), in a process of its own so
// that its hops never wait on the loop of the server it leads to. It prints the port it listens on, and runs until it is
// ended.

/** Bytes a connection may put on the line in its turn. */
export const SLICE = 16384;

/** What the server sent a connection that the line has not taken, and its bytes. */
export interface Waiting {
  down: Uint8Array[];
  queued: number;
}

/**
 * The line's turns: each connection with bytes waiting puts up to SLICE of them on it in turn, across as many of the
 * server's writes as that makes, so a socket of small messages beside downloads is given all it has each round.
 */
export class Turns<P extends Waiting> {
  readonly pipes: P[] = [];
  private turn = 0;

  /** The next connection in turn and the bytes it puts on the line, taken from what waits; null when nothing waits. */
  next(): { pipe: P; slice: Uint8Array } | null {
    const live = this.pipes.filter((p) => p.down.length > 0);
    if (live.length === 0) return null;
    const pipe = live[this.turn++ % live.length]!;
    let n = 0;
    for (const bytes of pipe.down) if ((n += bytes.length) >= SLICE) break;
    const slice = new Uint8Array(Math.min(n, SLICE));
    for (let at = 0; at < slice.length; ) {
      const head = pipe.down[0]!, take = Math.min(head.length, slice.length - at);
      slice.set(head.subarray(0, take), at);
      at += take;
      if (take === head.length) pipe.down.shift();
      else pipe.down[0] = head.subarray(take);
    }
    pipe.queued -= slice.length;
    return { pipe, slice };
  }
}

/**
 * A link to `port` on this machine, as a player's would be: what the server sends goes out over one line of `mbit`, each
 * connection given its turn (Turns), and every byte either way comes `latency` / 2 ms late. A connection holds at most
 * WINDOW bytes waiting for the line before the link stops reading the server's side of it, so the server meets a slow
 * link as it would over TCP: its own sends wait, and it skips what it may.
 */
export function shapedLink(port: number, mbit: number, latency: number): { port: number; stop(): void } {
  const rate = (mbit * 1e6) / 8 / 1000;
  const WINDOW = 65536;
  interface Pipe extends Waiting {
    client: import("bun").Socket<Pipe>;
    up: import("bun").Socket<undefined> | null;
    early: Uint8Array[];
    /** Slices on the line not yet come. */
    flying: number;
    out: Uint8Array[];
    upOut: Uint8Array[];
    closed: boolean;
    upClosed: boolean;
  }
  /** Ends the page's side of a connection once the server's has ended and all it sent has come. */
  const ended = (client: import("bun").Socket<Pipe>): void => void (client.data.upClosed && client.data.down.length === 0 && client.data.flying === 0 && !client.data.closed && client.end());
  const turns = new Turns<Pipe>();
  let free = 0;
  let pumping = false;
  const flush = (socket: import("bun").Socket<any>, queue: Uint8Array[]): void => {
    while (queue.length > 0) {
      const n = socket.write(queue[0]!);
      if (n < queue[0]!.length) {
        queue[0] = queue[0]!.subarray(Math.max(0, n));
        return;
      }
      queue.shift();
    }
  };
  const send = (socket: import("bun").Socket<any>, queue: Uint8Array[], bytes: Uint8Array): void => {
    queue.push(bytes);
    if (queue.length === 1) flush(socket, queue);
  };
  const pump = (): void => {
    const next = turns.next();
    if (!next) {
      pumping = false;
      return;
    }
    const { pipe, slice } = next, client = pipe.client;
    if (pipe.queued <= WINDOW / 2) pipe.up?.resume();
    free = Math.max(free, performance.now()) + slice.length / rate;
    pipe.flying++;
    setTimeout(() => {
      pipe.flying--;
      if (!pipe.closed) send(client, pipe.out, slice);
      ended(client);
    }, Math.max(0, free - performance.now()) + latency / 2);
    setTimeout(pump, Math.max(0, free - performance.now()));
  };
  const listener = Bun.listen<Pipe>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(client) {
        const pipe: Pipe = { client, up: null, early: [], down: [], queued: 0, flying: 0, out: [], upOut: [], closed: false, upClosed: false };
        client.data = pipe;
        turns.pipes.push(pipe);
        void Bun.connect<undefined>({
          hostname: "127.0.0.1",
          port,
          socket: {
            data(up, bytes) {
              pipe.down.push(new Uint8Array(bytes));
              pipe.queued += bytes.length;
              if (pipe.queued > WINDOW) up.pause();
              if (!pumping) {
                pumping = true;
                pump();
              }
            },
            drain(up) {
              flush(up, pipe.upOut);
            },
            close() {
              pipe.upClosed = true;
              ended(client);
            },
            error() {},
          },
        }).then((up) => {
          pipe.up = up;
          for (const bytes of pipe.early.splice(0)) send(up, pipe.upOut, bytes);
        }, () => client.end());
      },
      data(client, bytes) {
        const pipe = client.data, copy = new Uint8Array(bytes);
        setTimeout(() => (pipe.up ? send(pipe.up, pipe.upOut, copy) : pipe.early.push(copy)), latency / 2);
      },
      drain(client) {
        flush(client, client.data.out);
      },
      close(client) {
        client.data.closed = true;
        client.data.up?.end();
        const at = turns.pipes.indexOf(client.data);
        if (at >= 0) turns.pipes.splice(at, 1);
      },
      error() {},
    },
  });
  return { port: listener.port, stop: () => listener.stop(true) };
}

if (import.meta.main) {
  const [port, mbit, latency] = process.argv.slice(2).map(Number);
  console.log(shapedLink(port!, mbit!, latency!).port);
}
