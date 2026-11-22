// Numbers and words bug report mode's files take from the code the first frame waits for, as copies: they import no
// value of it, or the build would cut that script into more pieces (D915). tests/ui/notes.test.ts holds each to its
// original. What they need of its code comes to them in the kit (notes-kit.ts).

/** shared/coords.ts: ticks a second, metres a chunk, chunks a sector. */
export const TICK_RATE = 30;
export const CHUNK_SIZE = 64;
export const SECTOR_CHUNKS = 16;
/** shared/net/protocol.ts: the chat's channel for the game's own notices, and a session with a body. */
export const TEXT_NOTICE = 1;
export const SESSION_ALIVE = 0;
/** render/packet.ts FRAME.sun: where the sun's way is in a frame's numbers. */
export const FRAME_SUN = 0;
/** shared/world/streets.ts: a side's kinds, and a stretch's flags. */
export const VERGES = ["none", "planted", "grass", "dirt", "paved", "gravel"] as const;
export const WALKS = ["none", "walk", "full"] as const;
export const KERBS = ["raised", "flush", "worn"] as const;
export const STREET_ONE_WAY = 1;
export const STREET_PAIRED = 2;
/** shared/sim/character.ts: the movement modes MODE_NONE to MODE_FLYER, by their numbers. */
export const MODE_NAMES = ["none", "walk", "swim", "ghost", "fly", "flyer"] as const;
/** render/packet.ts: draw flags the census reads, and the step a draw is in (stepOf). */
export const DRAW_BLEND = 1;
export const DRAW_NEAR = 8;
export const STEP_NAMES = ["near", "far", "far see-through", "near see-through", "body"] as const;
/** The instance buffers' numbers by store (render/scene.ts, far.ts, farnodes.ts, lakes.ts, farlandmarks.ts, packet.ts). */
export const NODE_BUFFERS = 1 << 20;
export const FAR_BUFFER = 2 << 20;
export const FAR_NODE_BUFFERS = 3 << 20;
export const BEND_BUFFERS = 4 << 20;
export const TRANSIENT_BUFFER = 0xffffffff;
