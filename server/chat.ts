// Text chat. A line goes out as "name: words" to everyone its channel reaches who has not muted the speaker.
// The server decides who that is. A client names a channel and nothing else.

import type { AdminChatLine } from "../shared/admin.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MAX_CHAT_CHARS, RESULT_BUSY, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_SPECTATING, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Tribes } from "./tribes.ts";

/** Metres. */
export const LOCAL_RANGE = 60;
/** A survivor may say BURST lines at once, and earns another every EARN_TICKS. */
const BURST = 5;
const EARN_TICKS = 2 * TICK_RATE;
const RECENT_LINES = 100;

export interface ChatContext {
  readonly game: GameServer;
  readonly records: Records;
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly bus: Bus;
}

const CHAT_SAY = event("chat.say");
const CHAT_SAID = event("chat.said");

/**
 * The text as it will be shown, or "" if nothing is left. Format characters go: the marks that turn text round and the ones
 * of no width, with which a line can show as another's or a word slip past whoever looks for it.
 */
export function cleanChat(text: string): string {
  const clean = text.replace(/\p{Cf}/gu, "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return clean.length > MAX_CHAT_CHARS ? clean.slice(0, MAX_CHAT_CHARS) : clean;
}

export class Chat {
  /** Counts one per listener a line reaches. */
  delivered = 0;
  /** Muted names by listener name. Both are exact: a name in other capitals is another survivor's (server/names.ts). */
  private readonly mutes = new Map<string, Set<string>>();
  /** By speaker name, exact: the lines it may still say at once, and the tick that count was true at. */
  private readonly allowance = new Map<string, { lines: number; at: number }>();

  private readonly recent: AdminChatLine[] = [];
  private readonly ctx: ChatContext;
  /** Told of every line a survivor says, once it is said: Cast's people hear it (server/cast/host.ts). */
  readonly listeners: ((speaker: string, channel: number, x: number, z: number, text: string) => void)[] = [];

  constructor(ctx: ChatContext) {
    this.ctx = ctx;
  }

  /** Names, exactly. */
  muted(listener: string, speaker: string): boolean {
    return this.mutes.get(listener)?.has(speaker) ?? false;
  }

  /** Mutes text and voice. False if nothing changed. */
  mute(listener: string, speaker: string, on: boolean): boolean {
    let set = this.mutes.get(listener);
    if (on) {
      if (!set) this.mutes.set(listener, (set = new Set()));
      if (set.has(speaker)) return false;
      set.add(speaker);
      return true;
    }
    if (!set?.delete(speaker)) return false;
    if (set.size === 0) this.mutes.delete(listener);
    return true;
  }

  /** Everyone `listener` has muted. */
  mutedBy(listener: string): string[] {
    return [...(this.mutes.get(listener) ?? [])];
  }

  /** Accepted player messages in delivery order, oldest first. Kept for this run only. */
  recentLines(): AdminChatLine[] {
    return this.recent.slice();
  }

  /** Returns a RESULT code. A refusal also tells the speaker why. */
  say(c: Client, channel: number, text: string): number {
    const { game, records, rules, tribes, bus } = this.ctx;
    let line = cleanChat(text);
    if (line === "" || (channel !== TEXT_GLOBAL && channel !== TEXT_LOCAL && channel !== TEXT_TRIBE)) return RESULT_INVALID;
    const rec = records.byPid.get(c.pid);
    const refuse = (code: number, why: string): number => {
      game.sendText(c, TEXT_NOTICE, why);
      return code;
    };
    if (channel === TEXT_GLOBAL && rules.on("ProximityChat")) return refuse(RESULT_DENIED, "There is no global channel on this server; Insert speaks to those near you.");
    // Local chat needs a position and tribe chat needs a tribe, so both need a survivor.
    if (channel !== TEXT_GLOBAL && (!rec || c.state === SESSION_SPECTATING)) return refuse(RESULT_DENIED, "Only a survivor can say that.");
    const tribe = channel === TEXT_TRIBE ? tribes.of(rec!) : null;
    if (channel === TEXT_TRIBE && !tribe) return refuse(RESULT_DENIED, "You are not in a tribe.");

    const now = game.world.tick;
    let a = this.allowance.get(c.name);
    if (!a) this.allowance.set(c.name, (a = { lines: BURST, at: now }));
    const earned = Math.floor((now - a.at) / EARN_TICKS);
    if (earned > 0) {
      a.lines = Math.min(BURST, a.lines + earned);
      a.at = a.lines === BURST ? now : a.at + earned * EARN_TICKS;
    }
    if (a.lines === 0) return refuse(RESULT_BUSY, "You are saying too much at once; wait a moment.");
    if (a.lines === BURST) a.at = now;
    a.lines--;
    // A module may refuse the line or reword it. It has been counted against the speaker either way.
    const asked = { pid: c.pid, channel, text: line };
    const refused = bus.before(CHAT_SAY, asked);
    line = cleanChat(String(asked.text));
    if (refused !== "" || line === "") return refuse(RESULT_DENIED, refused === "" ? "Nothing was said." : refused);
    const heard = this.delivered;

    const out = `${c.name}: ${line}`;
    const x = c.body.x;
    const y = c.body.y;
    const z = c.body.z;
    for (const to of game.clients) {
      if (!to?.active || to.closed) continue;
      if (to !== c) {
        if (this.muted(to.name, c.name)) continue;
        if (channel === TEXT_LOCAL) {
          const dx = to.body.x - x;
          const dy = to.body.y - y;
          const dz = to.body.z - z;
          if (dx * dx + dy * dy + dz * dz > LOCAL_RANGE * LOCAL_RANGE) continue;
        } else if (channel === TEXT_TRIBE && records.byPid.get(to.pid)?.team !== tribe!.id) continue;
      }
      game.sendText(to, channel, out);
      this.delivered++;
    }
    if (this.recent.length === RECENT_LINES) this.recent.shift();
    this.recent.push({ at: Date.now(), channel, speaker: c.name, text: line });
    bus.after(CHAT_SAID, { pid: c.pid, channel, text: line, heard: this.delivered - heard });
    for (const l of this.listeners) l(c.name, channel, x, z, line);
    return RESULT_OK;
  }

  /**
   * A line said aloud by one of the world's people (Cast's), heard in local chat by survivors within `range` of where it
   * stands, as a survivor's would be; a survivor who muted the name hears nothing. Returns how many heard it.
   */
  npcSay(name: string, x: number, y: number, z: number, text: string, range = LOCAL_RANGE): number {
    const line = cleanChat(text);
    if (line === "") return 0;
    const out = `${name}: ${line}`;
    let n = 0;
    for (const to of this.ctx.game.clients) {
      if (!to?.active || to.closed || this.muted(to.name, name)) continue;
      const dx = to.body.x - x, dy = to.body.y - y, dz = to.body.z - z;
      if (dx * dx + dy * dy + dz * dz > range * range) continue;
      this.ctx.game.sendText(to, TEXT_LOCAL, out);
      this.delivered++;
      n++;
    }
    return n;
  }
}
