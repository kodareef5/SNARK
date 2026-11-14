// WebSocket as a Connection. Each frame is one channel byte followed by the message.
// WebSocket delivers both channels reliably and in order, but the protocol does not depend on that.

import type { Connection } from "../../shared/net/transport.ts";

export function connect(url: string): Connection {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const queue: Uint8Array<ArrayBuffer>[] = [];
  const conn: Connection & { open: boolean } = {
    open: true,
    onMessage: null,
    onClose: null,
    send(channel, data) {
      const frame = new Uint8Array(data.length + 1);
      frame[0] = channel;
      frame.set(data, 1);
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      else if (ws.readyState === WebSocket.CONNECTING) queue.push(frame);
    },
    close() {
      ws.close();
    },
  };
  ws.onopen = () => {
    for (const frame of queue) ws.send(frame);
    queue.length = 0;
  };
  ws.onmessage = (e) => {
    const bytes = new Uint8Array(e.data as ArrayBuffer);
    if (bytes.length > 0) conn.onMessage?.(bytes[0]!, bytes.subarray(1));
  };
  ws.onclose = () => {
    conn.open = false;
    conn.onClose?.();
  };
  return conn;
}
