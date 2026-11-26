// What the debug bar counts of the game's socket (debug/net.ts makes one). Without the bar the session's tap is null.

/** Sections of a snapshot, in the order it is written. */
export const SNAP_HEAD = 0, SNAP_OWN = 1, SNAP_CONTACTS = 2, SNAP_BODIES = 3, SNAP_REST = 4;

export interface NetTap {
  /** A message from the server: its S_ kind, the byte after it where that names a sub-kind (S_OWN, S_EVENT, S_TEXT, S_CHAT) or -1, and its bytes. */
  received(kind: number, sub: number, bytes: number): void;
  /** A message to the server: its C_ kind, the command's CMD_ op or -1, and its bytes. */
  sent(kind: number, sub: number, bytes: number): void;
  /** Bits of a snapshot's section (SNAP_). For SNAP_BODIES, one entity op: `op` is view.ts's OP_, `kind` the entity's kind or -1. */
  snapshot(section: number, op: number, kind: number, bits: number): void;
}
