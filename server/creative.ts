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
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly rules: Rules;
  private readonly bus: Bus;
  private readonly acts: Acts;
  private readonly records: Records;
  private readonly buffs: Buffs;
  /** What a session's groups give it, as the host reads them from its permissions. */
  groups: (c: Client) => GroupStanding = () => NO_GROUPS;

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
   * gives them. Losing them takes what they gave that would outlast them.
   */
  stand(c: Client): void {
    const all = this.forAll;
    const groups = this.groups(c);
    const rank = Math.max(all ? RANK_STAFF : RANK_OPEN, c.passwordRank, groups.rank);
    const full = all || c.passwordCheats || groups.every;
    if (rank === c.rank && full === c.admin) return;
    const gained = full && !c.admin;
    const lost = c.admin && !full;
    c.rank = rank;
    c.admin = full;
    c.ownDirty = true;
    if (gained) this.bus.after(SESSION_ADMIN, { pid: c.pid });
    if (lost) this.uncheat(c);
  }

  /** God mode, flight or ghost, a creature it possesses, and spectating where only admins may. */
  private uncheat(c: Client): void {
    const ents = this.world.ents;
    if (c.ent >= 0 && c.drive >= 0 && ents.seat[c.ent] === 0) this.game.release(c);
    if (c.ent >= 0 && (ents.mode[c.ent] === MODE_GHOST || ents.mode[c.ent] === MODE_FLY)) {
      ents.mode[c.ent] = MODE_WALK;
      ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    }
    const rec = this.records.byPid.get(c.pid);
    if (rec) this.buffs.take(rec, this.world.reg.index.get("core:god")!);
    if (c.state === SESSION_SPECTATING && this.game.opts.spectators === "admin") this.game.sessions.setSpectating(c, false);
  }

  /** Each tick. CreativeForAll switched on while the server runs reaches those already in, and a turn left open is journalled. */
  step(tick: number): void {
    if (this.seen !== this.rules.version) {
      this.seen = this.rules.version;
      if (this.forAll) for (const c of this.game.clients) if (c?.active && !c.closed) this.stand(c);
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
