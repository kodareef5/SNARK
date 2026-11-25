// Creative mode (bShowCreativeMode): the rule that gives the game's menu its Creative entry, the admin role CreativeForAll
// gives, and the sundial's command. Each tool on the Creative screen is one admin action checked here; no creative state is
// kept for a session beyond the admin role it already has.

import { TICK_RATE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { RESULT_DENIED, RESULT_INVALID, RESULT_OK, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { MODE_FLY, MODE_GHOST, MODE_WALK } from "../shared/sim/character.ts";
import { CLOCK_SHARES, formatHour, hourOfShare, offsetForHour } from "../shared/sim/clock.ts";
import { RANK_OPEN, RANK_STAFF } from "../shared/ranks.ts";
import { OP_ADMIN } from "./console.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Client, GameServer } from "./game.ts";
import type { Host } from "./host.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

const SESSION_ADMIN = event("session.admin");
const COMMAND = event("command");
const COMMAND_RAN = event("command.ran");

/** Ticks a turn of the sundial waits for its last message before it is journalled as it stands, as when a page shuts mid-turn. */
export const TURN_IDLE = 10 * TICK_RATE;

/** Raises a session to `rank`, and with `full` gives it every cheat. Never lowers. Modules hear only the first grant of cheats. */
export function raise(bus: Bus, c: Client, rank: number, full: boolean): void {
  const gained = full && !c.admin;
  if (!gained && rank <= c.rank) return;
  c.rank = Math.max(c.rank, rank);
  if (full) c.admin = true;
  c.ownDirty = true;
  if (gained) bus.after(SESSION_ADMIN, { pid: c.pid });
}

/** Gives a session the admin role, as `enablecheats` does. The role lasts as long as the connection. */
export function admit(bus: Bus, c: Client): void {
  raise(bus, c, RANK_STAFF, true);
}

/**
 * Puts a session back on its floor, as when an admin's password is revoked. Without cheats there, it also loses what they gave
 * that would outlast them: god mode, flight or ghost, and a creature it possesses.
 */
export function demote(host: Host, c: Client): void {
  host.creative.floor(c);
  if (c.admin) return;
  const world = host.world;
  const ents = world.ents;
  if (c.ent >= 0 && c.drive >= 0 && ents.seat[c.ent] === 0) host.game.release(c);
  if (c.ent >= 0 && (ents.mode[c.ent] === MODE_GHOST || ents.mode[c.ent] === MODE_FLY)) {
    ents.mode[c.ent] = MODE_WALK;
    ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
  }
  const rec = host.records.byPid.get(c.pid);
  if (rec) host.buffs.take(rec, world.reg.index.get("core:god")!);
}

interface Turn {
  hour: number;
  at: number;
}

export class Creative {
  /** The sundial turns under way, by session: the hour last set and the tick it was set at. */
  private readonly turns = new Map<Client, Turn>();
  private seen = -1;
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly rules: Rules;
  private readonly bus: Bus;
  private readonly persistence: Persistence | null;

  constructor(world: ServerWorld, game: GameServer, rules: Rules, bus: Bus, persistence: Persistence | null) {
    this.world = world;
    this.game = game;
    this.rules = rules;
    this.bus = bus;
    this.persistence = persistence;
  }

  get shown(): boolean {
    return this.rules.on("bShowCreativeMode");
  }

  /** Whether everyone who enters is given the admin role. */
  get forAll(): boolean {
    return this.shown && this.rules.on("CreativeForAll");
  }

  /** A session enters the world, before its welcome is written, so the welcome carries the role. */
  enter(c: Client): void {
    this.floor(c);
  }

  /** Sets what a connection has with no sign-in: every cheat at staff rank while CreativeForAll gives it, else nothing. */
  floor(c: Client): void {
    const all = this.forAll;
    const rank = all ? RANK_STAFF : RANK_OPEN;
    if ((c.admin && !all) || c.rank > rank) {
      c.admin = all;
      c.rank = rank;
      c.ownDirty = true;
    }
    if (all) raise(this.bus, c, rank, true);
  }

  /** Each tick. CreativeForAll switched on while the server runs reaches those already in, and a turn left open is journalled. */
  step(tick: number): void {
    if (this.seen !== this.rules.version) {
      this.seen = this.rules.version;
      if (this.forAll) for (const c of this.game.clients) if (c?.active && !c.closed) admit(this.bus, c);
    }
    if (this.turns.size === 0) return;
    for (const [c, t] of this.turns) if (c.closed || tick - t.at >= TURN_IDLE) this.end(c, t);
  }

  /** CMD_CLOCK: the hour is set for everyone at once, and a turn is one `settime` to the journal and to modules. */
  turn(c: Client, r: BitReader): number {
    const share = r.u16();
    const last = r.bool();
    if (r.overflow || share >= CLOCK_SHARES) return RESULT_INVALID;
    if (!c.admin || !this.shown) return RESULT_DENIED;
    const w = this.world;
    const hour = hourOfShare(share);
    let t = this.turns.get(c);
    if (!t) {
      // A module is asked once, as the turn begins, as it is asked about a typed `settime`.
      const refused = this.bus.before(COMMAND, { byPid: c.pid, name: "settime", line: `settime ${formatHour(hour)}`, source: "session" });
      if (refused !== "") {
        this.game.sendText(c, TEXT_NOTICE, `denied: ${refused}`);
        return RESULT_DENIED;
      }
      t = { hour, at: w.tick };
      this.turns.set(c, t);
    }
    t.hour = hour;
    t.at = w.tick;
    w.dayOffset = offsetForHour(w.tick, hour, w.clock);
    this.game.replication.markAllOwn();
    if (last) this.end(c, t);
    return RESULT_OK;
  }

  private end(c: Client, t: Turn): void {
    this.turns.delete(c);
    const line = `settime ${formatHour(t.hour)}`;
    this.persistence?.journal(OP_ADMIN, new TextEncoder().encode(`${c.name}\t${line}`));
    this.bus.after(COMMAND_RAN, { byPid: c.pid, name: "settime", line, source: "session" });
  }
}
