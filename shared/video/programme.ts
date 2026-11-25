// What a screen plays at a moment on the wall clock: worked out from the channel and the clips' lengths, so a server
// that restarts, or another world of the cluster, lands on the same place. The world turns it into its own tick (screen.ts).
import { Rng } from "../rng.ts";
import type { Channel, Screen } from "./clip.ts";

/** A clip's id and length, which is all the programme needs of it. */
export interface Timed {
  readonly id: string;
  readonly seconds: number;
}

/** What plays: the clip, the wall time (ms) its first second plays at, and the clip after it, or null for the scenes. */
export interface Playing {
  readonly clip: string;
  readonly start: number;
  readonly next: string | null;
}

/** The channel's items that are in the library and have length, in its order. */
function playable(channel: Channel, clips: ReadonlyMap<string, Timed>): Timed[] {
  const out: Timed[] = [];
  for (const id of channel.items) {
    const clip = clips.get(id);
    if (clip && clip.seconds > 0) out.push(clip);
  }
  return out;
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
 * What `screen` plays at `wall` ms: its one showing while it lasts, else its channel, else null for the scenes. `night`
 * says whether it is night in the world, for a screen that plays only then.
 */
export function screenAt(screen: Screen, channels: ReadonlyMap<string, Channel>, clips: ReadonlyMap<string, Timed>, wall: number, night: boolean): Playing | null {
  if (screen.night && !night) return null;
  const channel = channels.get(screen.show) ?? null;
  const once = screen.once ? clips.get(screen.once.clip) : undefined;
  if (screen.once && once && wall >= screen.once.from && wall < screen.once.from + once.seconds * 1000) {
    const after = channel ? channelAt(channel, clips, screen.once.from + once.seconds * 1000) : null;
    return { clip: once.id, start: screen.once.from, next: after ? after.clip : null };
  }
  return channel ? channelAt(channel, clips, wall) : null;
}

/** The wall time (ms) after `wall` at which what plays changes: the end of what plays, or of the one showing. */
export function changesAt(playing: Playing | null, clips: ReadonlyMap<string, Timed>): number {
  if (!playing) return Infinity;
  const clip = clips.get(playing.clip);
  return clip ? playing.start + clip.seconds * 1000 : Infinity;
}
