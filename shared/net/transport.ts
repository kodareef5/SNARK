// Transport contract. The protocol above it assumes only what a datagram
// transport offers, so WebTransport can replace WebSocket without redesign:
//
//   CH_UNRELIABLE  may drop, duplicate or reorder. Inputs and snapshots.
//   CH_RELIABLE    ordered and lossless. Handshake, chunk tables, durable events.
//
// WebSocket delivers both channels reliably; that is a transport property the
// protocol must never rely on. Tests run on the loopback with loss enabled.

export const CH_UNRELIABLE = 0;
export const CH_RELIABLE = 1;

export interface Connection {
  /** Send one message. The bytes are consumed before send returns. */
  send(channel: number, data: Uint8Array): void;
  close(): void;
  readonly open: boolean;
  /** Called with a buffer the receiver may keep. */
  onMessage: ((channel: number, data: Uint8Array) => void) | null;
  onClose: (() => void) | null;
}

export interface Listener {
  onConnection: ((conn: Connection) => void) | null;
}
