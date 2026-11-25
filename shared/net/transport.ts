// The protocol assumes only what a datagram transport offers, so WebTransport can replace WebSocket without redesign.
//   CH_UNRELIABLE  may drop, duplicate or reorder. Inputs and snapshots.
//   CH_RELIABLE    ordered and lossless. Handshake, chunk tables, durable events.
// WebSocket delivers both channels reliably, and the protocol must never rely on that.

export const CH_UNRELIABLE = 0;
export const CH_RELIABLE = 1;

/** The most bytes a message to a server may hold. A socket that sends a longer one is closed. */
export const MESSAGE_BYTES_MAX = 4096;

/** Unsent bytes at which a slow client is dropped. */
const HARD_BACKLOG = 4 * 1024 * 1024;

/** Unsent bytes at which a listener's voice packets are dropped. About a quarter second of everyone it can hear. */
export const VOICE_BACKLOG = 16 * 1024;

/**
 * What a socket does with a message on `channel` when `buffered` bytes wait unsent: 0 sends it, 1 skips it, 2 drops the
 * client. Unreliable traffic waits behind no more than two snapshots of `snapshotBytes`, so what a stall leaves queued is
 * not seconds of stale snapshots.
 */
export function backlog(channel: number, buffered: number, snapshotBytes: number): number {
  // A datagram that cannot be sent now is dropped, as an unreliable channel would drop it.
  if (channel !== CH_RELIABLE && buffered > 2 * snapshotBytes) return 1;
  return buffered > HARD_BACKLOG ? 2 : 0;
}

export interface Connection {
  /** Before preparing a message, a transport can refuse it and count the skip against its local queue. */
  admit?(channel: number): boolean;
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
