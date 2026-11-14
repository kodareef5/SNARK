// The protocol assumes only what a datagram transport offers, so WebTransport can replace WebSocket without redesign.
//   CH_UNRELIABLE  may drop, duplicate or reorder. Inputs and snapshots.
//   CH_RELIABLE    ordered and lossless. Handshake, chunk tables, durable events.
// WebSocket delivers both channels reliably, and the protocol must never rely on that.

export const CH_UNRELIABLE = 0;
export const CH_RELIABLE = 1;

export interface Connection {
  /** The bytes are consumed before send returns. */
  send(channel: number, data: Uint8Array): void;
  close(): void;
  readonly open: boolean;
  /** Where it came from, if the transport knows: a network address. Wrong passwords are counted by it. */
  readonly address?: string;
  /** Called with a buffer the receiver may keep. */
  onMessage: ((channel: number, data: Uint8Array) => void) | null;
  onClose: (() => void) | null;
}

export interface Listener {
  onConnection: ((conn: Connection) => void) | null;
}
