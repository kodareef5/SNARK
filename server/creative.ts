// Creative mode (bShowCreativeMode): the rule that gives the game's menu its Creative entry, the admin role CreativeForAll
// gives with what else a connection stands at, and the sundial's command. Each tool on the Creative screen is one admin
// action checked here; no creative state is kept for a session beyond the admin role it already has.

import { TICK_RATE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_SPECTATING, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { MODE_FLY, MODE_GHOST, MODE_WALK } from "../shared/sim/character.ts";
import { CLOCK_SHARES, formatHour, hourOfShare, offsetForHour } from "../shared/sim/clock.ts";
import { RANK_OPEN, RANK_STAFF } from "../shared/ranks.ts";
import { sessionActor, type Acts } from "./acts.ts";
import type { Buffs } from "./buffs.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Client, GameServer } from "./game.ts";
import type { Host } from "./host.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

const SESSION_ADMIN = event("session.admin");
const COMMAND = event("command");
const COMMAND_RAN = event("command.ran");

/** Ticks a turn of the sundial waits for its last message before it is journalled as it stands, as when a page shuts mid-turn. */
export const TURN_IDLE = 10 * TICK_RATE;

/** What a session's survivor's groups give it: their highest rank, and whether they hold every cheat (`*`). */
export interface GroupStanding {
  readonly rank: number;
  readonly every: boolean;
}

/** What a session has from groups before it has a survivor. */
export const NO_GROUPS: GroupStanding = { rank: RANK_OPEN, every: false };

/** Raises a session by a password it gave to `rank`, and with `full` gives it every cheat. Never lowers. Modules hear only the first grant of cheats. */
export function raise(bus: Bus, c: Client, rank: number, full: boolean): void {
  c.passwordRank = Math.max(c.passwordRank, rank);
  c.proved = Math.max(c.proved, c.passwordRank);
  if (full) c.passwordCheats = true;
  const gained = full && !c.admin;
  if (!gained && rank <= c.rank) return;
  c.rank = Math.max(c.rank, rank);
  if (full) c.admin = true;
  c.ownDirty = true;
  if (gained) bus.after(SESSION_ADMIN, { pid: c.pid });
}

/** Takes back what a session's password gave, as when an admin's password is revoked, and leaves it where the rest puts it. */
export function demote(host: Host, c: Client): void {
  c.passwordRank = RANK_OPEN;
  c.passwordCheats = false;
  host.creative.stand(c);
}

interface Turn {
  hour: number;
  at: number;
}

export class Creative {
  /** The sundial turns under way, by session: the hour last set and the tick it was set at. */
  private readonly turns = new Map<Client, Turn>();
  private seen = -1;
  /** Whether everyone had the role at the last look, so a switch either way is seen. */
  private wasForAll = false;
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly rules: Rules;
  private readonly bus: Bus;
  private readonly acts: Acts;
  private readonly records: Records;
  private readonly buffs: Buffs;
  /** What a session's groups give it, as the host reads them from its permissions. */
  groups: (c: Client) => GroupStanding = () => NO_GROUPS;
  /** Whether a session's groups let it run console command `command` without every cheat. */
  granted: (c: Client, command: string) => boolean = () => false;

  constructor(world: ServerWorld, game: GameServer, rules: Rules, bus: Bus, acts: Acts, records: Records, buffs: Buffs) {
    this.world = world;
    this.game = game;
    this.rules = rules;
    this.bus = bus;
    this.acts = acts;
    this.records = records;
    this.buffs = buffs;
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
    this.stand(c);
  }

  /**
   * Works out what a connection stands at from the three things that give it anything: CreativeForAll (every cheat at staff
   * rank), the host password it gave, and its survivor's groups. Its rank is the highest, and it has every cheat if any
   * gives them. Without every cheat, what a cheat left running ends unless its groups still let it run that cheat. What it
   * proved, apart from creative mode for all, is kept for the admin log.
   */
  stand(c: Client): void {
    const all = this.forAll;
    const groups = this.groups(c);
    c.proved = Math.max(c.passwordRank, groups.rank);
    const rank = Math.max(all ? RANK_STAFF : RANK_OPEN, c.proved);
    const full = all || c.passwordCheats || groups.every;
    if (rank !== c.rank || full !== c.admin) {
      const gained = full && !c.admin;
      c.rank = rank;
      c.admin = full;
      c.ownDirty = true;
      if (gained) this.bus.after(SESSION_ADMIN, { pid: c.pid });
    }
    if (!full) this.uncheat(c);
  }

  /**
   * Ends what a cheat left running that the session may no longer run, as the command that undoes it would: a creature it
   * possesses, ghost or flight, god mode, and spectating where only admins may. Each is looked at before the permission.
   */
  private uncheat(c: Client): void {
    const ents = this.world.ents;
    const e = c.ent;
    if (e >= 0 && c.drive >= 0 && ents.seat[e] === 0 && !this.granted(c, "possess")) this.game.release(c);
    if (e >= 0 && ((ents.mode[e] === MODE_GHOST && !this.granted(c, "ghost")) || (ents.mode[e] === MODE_FLY && !this.granted(c, "fly")))) {
      ents.mode[e] = MODE_WALK;
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    }
    const rec = this.records.byPid.get(c.pid);
    const god = this.world.reg.index.get("core:god")!;
    // God mode is a buff, so `buff god` gives it too.
    if (rec && this.buffs.has(rec, god) && !this.granted(c, "god") && !this.granted(c, "buff")) this.buffs.take(rec, god);
    if (c.state === SESSION_SPECTATING && this.game.opts.spectators === "admin") this.game.sessions.setSpectating(c, false);
  }

  /**
   * Each tick. CreativeForAll switched while the server runs reaches those already in: on, they get it; off, those with no
   * other reason for it lose it at once, with what a cheat left running. A turn left open is journalled.
   */
  step(tick: number): void {
    if (this.seen !== this.rules.version) {
      this.seen = this.rules.version;
      if (this.forAll !== this.wasForAll) {
        this.wasForAll = this.forAll;
        for (const c of this.game.clients) if (c?.active && !c.closed) this.stand(c);
      }
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
    this.acts.write(sessionActor(c, this.records), line);
    this.bus.after(COMMAND_RAN, { byPid: c.pid, name: "settime", line, source: "session" });
  }
}
