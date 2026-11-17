import { TICK_RATE } from "../shared/coords.ts";

/** Wrong guesses allowed before the first wait. */
const FREE = 3;
/** The first wait, in ticks. Each further wrong guess doubles it, up to an hour. */
const WAIT = 30 * TICK_RATE;
const LONGEST = 3600 * TICK_RATE;
/** A count is forgotten a day after its last wrong guess. */
const FORGET = 24 * 3600 * TICK_RATE;
/** Keys a table holds. */
const MOST = 65536;
/** Of a table full of counts, those looked at from the oldest for one that can be forgotten. */
const LOOK = 64;
/** An IPv6 site's first 48 bits are allowed as much as this many machines are. */
const SITE = 4;

/**
 * The keys a client is counted under, narrowest first. An IPv4 address is one key. An IPv6 address is two: its first 64 bits,
 * which one machine is given whole and may take any address of, and its first 48, the most one site is given and what anyone
 * may have of a tunnel broker, allowed as much as SITE machines. Anything that is no address, a name, is its own key.
 */
export function countedAs(who: string): string[] {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(who);
  if (mapped) return [mapped[1]!];
  if (!who.includes(":")) return [who];
  const halves = who.replace(/%.*$/, "").toLowerCase().split("::");
  const parts = halves.map((h) => (h === "" ? [] : h.split(":")));
  if (halves.length > 2 || !parts.every((p) => p.every((g) => /^[0-9a-f]{1,4}$/.test(g) || /^\d{1,3}(\.\d{1,3}){3}$/.test(g)))) return [who];
  const head = parts[0]!;
  const groups = halves.length === 2 ? [...head, ...Array<string>(Math.max(0, 8 - head.length - parts[1]!.length)).fill("0"), ...parts[1]!] : head;
  const hex = groups.slice(0, 4).map((g) => (g.includes(".") ? "0" : parseInt(g, 16).toString(16)));
  return [`${hex.join(":")}::/64`, `${hex.slice(0, 3).join(":")}::/48`];
}

/**
 * Counts wrong passwords by who sent them, across connections. A count kept on the connection starts again at every
 * reconnect, which made a four-digit password a matter of minutes. A guess waits while any key it is counted under
 * (countedAs) waits. A full table forgets the oldest count with no wait running to make room, and with none it judges no
 * guess from a key it has no room for: forgetting a running wait would give it back to whoever made the table full.
 */
export class Guesses {
  /** In the order of each key's last wrong guess, oldest first. */
  private readonly by = new Map<string, { wrong: number; until: number; last: number }>();
  private readonly free: number;
  private readonly first: number;

  /** `free` wrong guesses are allowed before the first wait, of `first` ticks. */
  constructor(free = FREE, first = WAIT) {
    this.free = free;
    this.first = first;
  }

  /** Ticks `who` must still wait before a guess is judged, or 0. */
  wait(who: string, tick: number): number {
    const keys = countedAs(who);
    let most = 0;
    for (const key of keys) {
      const e = this.by.get(key);
      if (e && e.until > tick) most = Math.max(most, e.until - tick);
    }
    const unknown = keys.filter((key) => !this.by.has(key)).length;
    return most === 0 && unknown > 0 && !this.room(tick, unknown) ? this.first : most;
  }

  wrong(who: string, tick: number): void {
    countedAs(who).forEach((key, wide) => {
      let e = this.by.get(key);
      if (e) this.by.delete(key);
      else if (!this.room(tick, 1)) return;
      e ??= { wrong: 0, until: 0, last: 0 };
      e.wrong++;
      e.last = tick;
      const free = wide > 0 ? this.free * SITE : this.free;
      if (e.wrong >= free) e.until = tick + Math.min(LONGEST, this.first * 2 ** Math.min(20, e.wrong - free));
      this.by.set(key, e);
    });
  }

  /** The right password forgives the machine's count and not its site's, which others share. */
  right(who: string): void {
    this.by.delete(countedAs(who)[0]!);
  }

  /** Whether `n` more keys can be counted, forgetting what is a day old and then, if need be, counts with no wait running. */
  private room(tick: number, n: number): boolean {
    for (const [key, e] of this.by) {
      if (tick - e.last < FORGET) break;
      this.by.delete(key);
    }
    let looked = 0;
    for (const [key, e] of this.by) {
      if (this.by.size + n <= MOST || ++looked > LOOK) break;
      if (e.until <= tick) this.by.delete(key);
    }
    return this.by.size + n <= MOST;
  }
}

/**
 * What one machine may do so many times in a window, as make a new survivor, and its IPv6 site SITE times as many
 * (countedAs). Each key's window starts with its first use. A table full of windows still running allows nothing to a key it
 * has no room for.
 */
export class Allowance {
  /** In the order each key's window started, oldest first. */
  private readonly by = new Map<string, { n: number; since: number }>();
  private readonly most: number;
  private readonly ticks: number;

  constructor(most: number, ticks: number) {
    this.most = most;
    this.ticks = ticks;
  }

  /** Counts one use by `who` and says true, or says false if it has none left. */
  take(who: string, tick: number): boolean {
    for (const [key, e] of this.by) {
      if (tick - e.since < this.ticks) break;
      this.by.delete(key);
    }
    const keys = countedAs(who);
    const live = keys.map((key) => this.by.get(key) ?? null);
    if (live.some((e, wide) => e !== null && e.n >= (wide > 0 ? this.most * SITE : this.most))) return false;
    if (this.by.size + live.filter((e) => e === null).length > MOST) return false;
    keys.forEach((key, i) => {
      const e = live[i];
      if (e) e.n++;
      else this.by.set(key, { n: 1, since: tick });
    });
    return true;
  }
}
