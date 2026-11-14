// Text chat. A line goes out as "name: words" to everyone its channel reaches who has not muted the speaker.
// The server decides who that is. A client names a channel and nothing else.

import { TICK_RATE } from "../shared/coords.ts";
import { MAX_CHAT_CHARS, RESULT_BUSY, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_SPECTATING, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Tribes } from "./tribes.ts";

/** Metres. */
export const LOCAL_RANGE = 60;
/** A survivor may say BURST lines at once, and earns another every EARN_TICKS. */
const BURST = 5;
const EARN_TICKS = 2 * TICK_RATE;

export interface ChatContext {
  readonly game: GameServer;
  readonly records: Records;
  readonly rules: Rules;
  readonly tribes: Tribes;
}

/** The text as it will be shown, or "" if nothing is left. */
export function cleanChat(text: string): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > MAX_CHAT_CHARS ? clean.slice(0, MAX_CHAT_CHARS) : clean;
}

export class Chat {
  /** Counts one per listener a line reaches. */
  delivered = 0;
  /** Muted names by listener name. Both are lower case. */
  private readonly mutes = new Map<string, Set<string>>();
  /** By speaker name, lower case: the lines it may still say at once, and the tick that count was true at. */
  private readonly allowance = new Map<string, { lines: number; at: number }>();

  private readonly ctx: ChatContext;

  constructor(ctx: ChatContext) {
    this.ctx = ctx;
  }

  /** Names, in any case. */
  muted(listener: string, speaker: string): boolean {
    return this.mutes.get(listener.toLowerCase())?.has(speaker.toLowerCase()) ?? false;
  }

  /** Mutes text and voice. False if nothing changed. */
  mute(listener: string, speaker: string, on: boolean): boolean {
    const key = listener.toLowerCase();
    const who = speaker.toLowerCase();
    let set = this.mutes.get(key);
    if (on) {
      if (!set) this.mutes.set(key, (set = new Set()));
      if (set.has(who)) return false;
      set.add(who);
      return true;
    }
    if (!set?.delete(who)) return false;
    if (set.size === 0) this.mutes.delete(key);
    return true;
  }

  /** Everyone `listener` has muted. */
  mutedBy(listener: string): string[] {
    return [...(this.mutes.get(listener.toLowerCase()) ?? [])];
  }

  /** Returns a RESULT code. A refusal also tells the speaker why. */
  say(c: Client, channel: number, text: string): number {
    const { game, records, rules, tribes } = this.ctx;
    const line = cleanChat(text);
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
    const key = c.name.toLowerCase();
    let a = this.allowance.get(key);
    if (!a) this.allowance.set(key, (a = { lines: BURST, at: now }));
    const earned = Math.floor((now - a.at) / EARN_TICKS);
    if (earned > 0) {
      a.lines = Math.min(BURST, a.lines + earned);
      a.at = a.lines === BURST ? now : a.at + earned * EARN_TICKS;
    }
    if (a.lines === 0) return refuse(RESULT_BUSY, "You are saying too much at once; wait a moment.");
    if (a.lines === BURST) a.at = now;
    a.lines--;

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
    return RESULT_OK;
  }
}
