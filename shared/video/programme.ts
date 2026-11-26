// What a screen plays at a moment on the wall clock: worked out from the channel and the clips' lengths, so a server
// that restarts, or another world of the cluster, lands on the same place. The world turns it into its own tick (screen.ts).
import { Rng } from "../rng.ts";
import { ONCE_STILL_SECONDS, STILL_SECONDS, type Channel, type Screen } from "./clip.ts";

/** An item's id and length, which is all the programme needs of it. An image's length is its channel's to give. */
export interface Timed {
  readonly id: string;
  readonly seconds: number;
  readonly image?: boolean;
}

/** Seconds `item` holds in `channel`: a clip its own length, an image the channel's still. */
export const heldFor = (item: Timed, channel: Channel | null): number => (item.image ? (channel ? (channel.still ?? STILL_SECONDS) : ONCE_STILL_SECONDS) : item.seconds);

/** What plays: the clip, the wall time (ms) its first second plays at, and the clip after it, or null for the scenes. */
export interface Playing {
  readonly clip: string;
  readonly start: number;
  readonly next: string | null;
}

/** The channel's items that are in the library and have length, in its order, each with the length it holds there. */
function playable(channel: Channel, clips: ReadonlyMap<string, Timed>): Timed[] {
  const out: Timed[] = [];
  for (const id of channel.items) {
    const clip = clips.get(id);
    const seconds = clip ? heldFor(clip, channel) : 0;
    if (clip && seconds > 0) out.push(clip.image ? { id: clip.id, seconds, image: true } : clip);
  }
  return out;
}

/** Milliseconds a round of `channel` takes, 0 where it has nothing to play. */
export function roundMs(channel: Channel, clips: ReadonlyMap<string, Timed>): number {
  let total = 0;
  for (const c of playable(channel, clips)) total += c.seconds * 1000;
  return total;
}

/** The order of a round: as listed, or shuffled by the channel's epoch and the round's number. */
function order(items: readonly Timed[], channel: Channel, round: number): Timed[] {
  if (!channel.shuffle || items.length < 2) return items.slice();
  const out = items.slice(), rng = new Rng((Math.floor(channel.epoch / 1000) ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1), t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** What `channel` plays at `wall` ms, or null where it has nothing to play. */
export function channelAt(channel: Channel, clips: ReadonlyMap<string, Timed>, wall: number): Playing | null {
  const items = playable(channel, clips);
  if (items.length === 0) return null;
  let total = 0;
  for (const c of items) total += c.seconds * 1000;
  const since = wall - channel.epoch, round = Math.floor(since / total);
  let into = since - round * total, start = channel.epoch + round * total;
  const now = order(items, channel, round);
  for (let i = 0; i < now.length; i++) {
    const length = now[i]!.seconds * 1000;
    if (into < length || i === now.length - 1) {
      const next = i + 1 < now.length ? now[i + 1]! : order(items, channel, round + 1)[0]!;
      return { clip: now[i]!.id, start, next: next.id };
    }
    into -= length;
    start += length;
  }
  return null;
}

/**
 * What one screen of a channel plays at `wall` ms, `offset` ms ahead of the channel's own place: each screen of a type
 * has its own offset, so screens side by side show different items. The start is the item's on that screen.
 */
export function channelAtOffset(channel: Channel, clips: ReadonlyMap<string, Timed>, wall: number, offset: number): Playing | null {
  const p = channelAt(channel, clips, wall + offset);
  return p && { ...p, start: p.start - offset };
}

/** Whether `screen`'s one showing plays at `wall` ms. */
export function onceShowing(screen: Screen, clips: ReadonlyMap<string, Timed>, wall: number): boolean {
  const once = screen.once ? clips.get(screen.once.clip) : undefined;
  return !!(screen.once && once && wall >= screen.once.from && wall < screen.once.from + heldFor(once, null) * 1000);
}

/**
 * What `screen` plays at `wall` ms: its one showing while it lasts, else its channel, else null for the scenes or a dark
 * face. `night` says whether it is night in the world, for a screen that plays only then.
 */
export function screenAt(screen: Screen, channels: ReadonlyMap<string, Channel>, clips: ReadonlyMap<string, Timed>, wall: number, night: boolean): Playing | null {
  if (screen.night && !night) return null;
  const channel = channels.get(screen.show) ?? null;
  if (onceShowing(screen, clips, wall)) {
    const once = clips.get(screen.once!.clip)!;
    const after = channel ? channelAt(channel, clips, screen.once!.from + heldFor(once, null) * 1000) : null;
    return { clip: once.id, start: screen.once!.from, next: after ? after.clip : null };
  }
  return channel ? channelAt(channel, clips, wall) : null;
}

/** The wall time (ms) after `wall` at which what plays changes: the end of what plays, or of the one showing. */
export function changesAt(playing: Playing | null, clips: ReadonlyMap<string, Timed>, channel: Channel | null = null): number {
  if (!playing) return Infinity;
  const clip = clips.get(playing.clip);
  return clip ? playing.start + heldFor(clip, channel) * 1000 : Infinity;
}
