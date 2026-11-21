// What the Storage tab does and shows (ui/storage.ts). It tells the asset port what the chosen graphics tier would keep
// on this device, whether to fetch it, how much the disk may hold and when to delete it all, and works out how things
// stand as plain numbers. Three quantities are kept apart: bytes saved on this device (the disk), bytes still to
// download (the network) and bytes on the graphics card (never saved). It comes with the Storage page, after the first
// frame, and imports nothing the first frame's script holds but types, or the bundler would split that script into
// more files to share it (D903).

import type { Settings } from "../settings.ts";
import type { SoundLibrary } from "../sound/library.ts";
import { KEEP_OFF, KEEP_ON, KEEP_PAUSED } from "./bulk.ts";
import type { AssetPort } from "./port.ts";
import type { Residency } from "./residency.ts";
import type { Tier } from "./tiers.ts";

/**
 * How the download stands. built: there is nothing to download. none: the browser saves nothing. confirm: the player
 * pressed Delete once. full: the device ran out of room. done: all of the tier's files are saved. over: they would pass
 * the disk's limit. downloading, paused, idle: as they say.
 */
export type KeepState = "built" | "none" | "confirm" | "full" | "done" | "over" | "downloading" | "paused" | "idle";

export interface StorageView {
  state: KeepState;
  tier: Tier["name"];
  /** Bytes saved on this device, and the most the game keeps there on the chosen tier. */
  saved: number;
  limit: number;
  /** Bytes of what the chosen tier would keep, and of them not yet saved. Null while they are still being counted. */
  total: number | null;
  missing: number | null;
  /** Bytes a second the download brought lately, 0 where not known, and the seconds left at that, null where not known. */
  rate: number;
  left: number | null;
  /** The room the browser gives the game, and whether it has agreed not to clear the files when short of room. Null where it does not say. */
  room: number | null;
  kept: boolean | null;
  /** Bytes the graphics card holds for what is drawn, and about the most it holds on the chosen tier. */
  card: number;
  cardOf: number;
}

/** A first press of Delete asks; a second within this long deletes. */
export const CONFIRM_MS = 4000;
/** The download's rate is over this long. */
const RATE_MS = 10000;
/** How often the browser is asked for its room while the page is shown. */
const ESTIMATE_MS = 5000;

export class Keeping {
  readonly view: StorageView = { state: "built", tier: "medium", saved: 0, limit: 0, total: null, missing: null, rate: 0, left: null, room: null, kept: null, card: 0, cardOf: 0 };
  /** Until when Delete waits for its second press, 0 for not. */
  confirmUntil = 0;
  private now = 0;
  /**
   * Presses waiting for the next step: ask the browser to keep the files; delete everything; tell the port the mode
   * again (Resume after the disk filled).
   */
  private persist = false;
  private clearing = false;
  private poke = false;
  /** The tier and variant whose parts the port was given, "" for none; whether the sounds' were; the mode and limit told. */
  private planned = "";
  private soundsNamed = false;
  private told = KEEP_OFF;
  private limitTold = -1;
  private estimatedAt = -Infinity;
  /** The bulk fill's bytes written, sampled with their times, for the rate. */
  private readonly times: number[] = [];
  private readonly filled: number[] = [];

  /**
   * Once a frame. `tier` is the one the player chose, as this device draws it; `open`: the settings are up; `shown`: the
   * Storage tab is. `port` is the asset worker's own, `r` the asset library's and `sounds` the sound library's, each
   * null where there is none yet.
   */
  step(s: Settings, tier: Tier, open: boolean, shown: boolean, port: AssetPort | null, r: Residency | null, sounds: SoundLibrary | null, now: number): void {
    this.now = now;
    if (now >= this.confirmUntil) this.confirmUntil = 0;
    const v = this.view;
    v.tier = tier.name;
    v.limit = tier.diskBytes;
    v.card = r ? r.ledger + r.reserved : 0;
    v.cardOf = tier.gpuBytes;
    if (!port || port.cache.mode === "none") {
      v.saved = 0;
      v.total = v.missing = v.left = v.room = v.kept = null;
      return this.say("built");
    }
    // The player asked for the files, so the browser is asked not to clear them first: on a press, never unasked.
    if (this.persist) port.storage?.keep();
    this.persist = false;
    if (this.clearing) {
      port.clear?.();
      s.keepAll = s.keepPaused = false;
      s.changed();
      this.clearing = false;
    }
    const mode = !s.keepAll ? KEEP_OFF : s.keepPaused ? KEEP_PAUSED : KEEP_ON;
    // Everything the tier would keep is named while the tab is shown or the player asked for it; again for a new tier.
    const plan = `${tier.name} ${r?.format}`;
    if ((shown || s.keepAll) && r && plan !== this.planned) {
      port.keep?.(mode, true);
      r.download(tier.texture);
      this.planned = plan;
      this.soundsNamed = false;
      this.told = mode;
    }
    if (this.planned !== "" && sounds && !this.soundsNamed) {
      sounds.download();
      this.soundsNamed = true;
    }
    if (mode !== this.told || this.poke) {
      port.keep?.(mode);
      this.told = mode;
      this.poke = false;
    }
    // The disk's limit follows the tier once the player has left the settings, so a tier passed on the way is not taken.
    if (!open && tier.diskBytes !== this.limitTold) {
      port.limit?.(tier.diskBytes);
      this.limitTold = tier.diskBytes;
    }
    if (shown && now - this.estimatedAt >= ESTIMATE_MS) {
      port.storage?.refresh(now);
      this.estimatedAt = now;
    }
    const c = port.cache, keep = c.keep, written = c.totals?.fillBytes ?? 0;
    this.sample(now, written);
    // Counted once every page has come and the port has heard of every part named.
    const counted = keep !== undefined && this.planned !== "" && (r?.pagesLeft ?? 0) === 0 && (port.named ?? 0) === (c.totals?.fillAsked ?? 0);
    v.total = counted ? keep.bytes : null;
    v.missing = counted ? keep.missingBytes : null;
    v.saved = c.used;
    v.room = port.storage?.quota ?? null;
    v.kept = port.storage?.persisted ?? null;
    v.left = v.rate > 0 && v.missing !== null ? v.missing / v.rate : null;
    if (c.off === "none") return this.say("none");
    if (this.confirmUntil > 0) return this.say("confirm");
    if (c.off === "full") return this.say("full");
    if (v.total === 0) return this.say("built");
    if (v.missing === 0) return this.say("done");
    if (s.keepAll ? keep?.capped === true : v.total !== null && v.total > v.limit) return this.say("over");
    this.say(!s.keepAll ? "idle" : s.keepPaused ? "paused" : "downloading");
  }

  private say(state: KeepState): void {
    this.view.state = state;
  }

  /** Keeps the last RATE_MS of the bytes written, a sample at most every half second, and works out the rate. */
  private sample(now: number, written: number): void {
    const n = this.times.length;
    if (n === 0 || now - this.times[n - 1]! >= 500) {
      this.times.push(now);
      this.filled.push(written);
    }
    while (this.times.length > 2 && now - this.times[0]! > RATE_MS) {
      this.times.shift();
      this.filled.shift();
    }
    const span = now - this.times[0]!;
    this.view.rate = span >= 2000 ? Math.max(0, ((written - this.filled[0]!) * 1000) / span) : 0;
  }

  /**
   * The left button: Download all, Pause or Resume as the download stands, as the settings' Download all row steps;
   * Keep while Delete asks; and Resume after the device filled, which has the port try its disk again.
   */
  primary(s: Settings): void {
    const state = this.view.state;
    if (state === "confirm") {
      this.confirmUntil = 0;
      return;
    }
    s.keepPaused = s.keepAll && !s.keepPaused && state !== "full";
    s.keepAll = true;
    this.poke = state === "full";
    this.persist = !s.keepPaused;
    s.changed();
  }

  /** The right button: Delete saved files asks first, and a second press within CONFIRM_MS deletes them. */
  remove(): void {
    if (this.confirmUntil > 0) {
      this.clearing = true;
      this.confirmUntil = 0;
    } else this.confirmUntil = this.now + CONFIRM_MS;
  }
}
