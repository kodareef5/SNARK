// The player step: what each session sends, and what the tick does with it. Its inputs are taken in as they arrive; each
// tick the input for that tick steps the session's body, or the creature or vehicle it drives, then its action and its aim;
// and its commands run, a few a tick, through the table the systems fill with `handle`.

import { TICK_DT, TICK_RATE, chunkAt } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { IMPALE_SLOT } from "../shared/sim/seats.ts";
import {
  CMD_STATICS,
  CMD_VIEW,
  C_COMMAND,
  C_INPUT,
  INPUT_HOLD_TICKS,
  INPUT_KEPT,
  INPUT_WINDOW,
  MAX_CLIENT_MESSAGE,
  REJECT_DENIED,
  REJECT_MALFORMED,
  RESULT_BUSY,
  RESULT_DENIED,
  RESULT_INVALID,
  TEXT_NOTICE,
  VEHICLE_HOLD_TICKS,
  VIEW_STEPS,
  nextCommandSeq,
  readInputs,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE } from "../shared/net/transport.ts";
import { BTN_JUMP, BTN_SECONDARY, Body, stepBody, stepOut } from "../shared/sim/character.ts";
import { stepVehicleBody } from "../shared/sim/vehicle-body.ts";
import { cancelCreatureAction, creatureHold, stepCreature } from "../shared/sim/creature-actions.ts";
import { ACT_NONE, FISTS, actionOut, biteCost, stepAction } from "../shared/sim/weapon.ts";
import { stepAim } from "../shared/sim/aim.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { BodyBlocking } from "./blocking.ts";
import { ServerFootContacts } from "./foot-contacts.ts";
import type { Client, GameStats } from "./game.ts";
import { FAULT_REFUSED_TICKS } from "./sessions.ts";
import { Signal, Veto } from "./signal.ts";
import type { ServerWorld } from "./world.ts";

/**
 * Unreliable messages from one client: this many a tick, and up to PACKETS_HELD at once, what a page sends at most, one a
 * tick, in the ticks of input the server buffers, which a stalled loop reads in one go. The rest are dropped.
 */
const MAX_PACKETS_PER_TICK = 8;
const PACKETS_HELD = INPUT_WINDOW;
/** An input this many ticks older than a client's newest is from its clock started again, which a page does a second back (client/core/session.ts). */
const RESTARTED = 16;
/** Reliable messages from one client per tick. A command past this is answered busy, and anything else is a strike. */
const MAX_RELIABLE_PER_TICK = 32;
/** Malformed messages tolerated before disconnecting. */
const MAX_STRIKES = 8;
const COMMAND_QUEUE = 16;
const COMMANDS_PER_TICK = 4;

/** Bits of Client.did, set by the action step on the tick just stepped. */
export const DID_STRIKE = 1;
/** The mount it drives landed a bite. */
export const DID_BITE = 8;
export const DID_FIRE = 2;
export const DID_RELOAD = 4;
/** The flyer it drives began a barrel roll. */
export const DID_ROLL = 16;

/** Read every argument and check r.overflow before acting. Returns a RESULT code. */
export type CommandHandler = (c: Client, r: BitReader) => number;

/** What the player step needs: of the game, and two things each of the other two parts. */
export interface PlayersContext {
  readonly world: ServerWorld;
  /** The sessions, by slot (GameServer.clients). */
  readonly clients: readonly (Client | null)[];
  readonly stats: GameStats;
  /** The game's one reader: a message is read in it as it arrives, and a command again as it runs. */
  readonly r: BitReader;
  /** Of the game: the answer to a command, and words to a session. */
  readonly tell: { result(c: Client, seq: number, code: number): void; sendText(c: Client, channel: number, text: string): void };
  /** Of the sessions: a session that sends nonsense, or whose command threw, is put out, and its device refused a while. */
  readonly sessions: { reject(c: Client, reason: number): void; fault(c: Client): void };
  /** Of replication: its answers to the two commands that are a session's own to ask in any state. */
  readonly replication: { askView(c: Client, r: BitReader): number; takeStatics(c: Client): number };
}

export class Players {
  private readonly world: ServerWorld;
  private readonly clients: readonly (Client | null)[];
  private readonly stats: GameStats;
  private readonly r: BitReader;
  private readonly tell: PlayersContext["tell"];
  private readonly sessions: PlayersContext["sessions"];
  private readonly replication: PlayersContext["replication"];
  /**
   * A command's handler threw `err`. Its key and machine are refused (refusals). Returns whether the world goes on, its
   * session then put out; false, or no hook, throws on, so the server stops as at any throw and saves nothing of the tick.
   */
  onFault: ((c: Client, op: number, command: Uint8Array, err: unknown) => boolean) | null = null;
  /** Whether the session may run command `op` now: any listener may refuse. A refused command answers RESULT_DENIED and its handler is not called. */
  readonly allows = new Veto<[c: Client, op: number]>(true);
  /** speed is in metres per second. onMountLand is told of a driven creature `e` landing. */
  readonly onLand = new Signal<[c: Client, speed: number]>();
  /** A survivor's glider opened this tick, or folded (planning/workstreams/glider.md). */
  readonly onGlide = new Signal<[c: Client, opened: boolean]>();
  readonly onMountLand = new Signal<[e: number, speed: number]>();
  /** A rising secondary input on the mounted body, after movement and its ordinary bite step. */
  readonly onMountSecondary = new Signal<[e: number]>();
  /** A driven flyer `e` took off, set down from flight or began a barrel roll this tick, as stepOut still says. */
  readonly onMountFlight = new Signal<[e: number]>();
  /** Vehicle report is still current; authoritative damage consumes it immediately after the body is stored. */
  readonly onVehicleStep = new Signal<[e: number]>();
  /** The host adds resource contacts around this same shared vehicle step. */
  vehicleStep: typeof stepVehicleBody = stepVehicleBody;
  /** A body a session drives on foot meets the vehicles round it in its own step, as the page predicting it does. */
  readonly feet: ServerFootContacts;
  /** Bodies a walker cannot walk through (server/blocking.ts). */
  readonly blocking: BodyBlocking;
  /** Whether a survivor's body lies knocked down, which its session's step leaves be. The host sets it. */
  isDown: (e: number) => boolean = () => false;
  /** The bodies besides the sessions' that may block a walker this tick: the awake creatures (server/creatures.ts). */
  blockBodies: (() => readonly [ArrayLike<number>, number]) | null = null;
  private sessionBodies = new Int32Array(64);
  private readonly footBefore = new Body();
  private readonly handlers: (CommandHandler | null)[] = new Array(256).fill(null);

  constructor(ctx: PlayersContext) {
    const world = (this.world = ctx.world);
    this.clients = ctx.clients;
    this.stats = ctx.stats;
    this.r = ctx.r;
    this.tell = ctx.tell;
    this.sessions = ctx.sessions;
    this.replication = ctx.replication;
    this.feet = new ServerFootContacts(world);
    this.blocking = new BodyBlocking(world);
  }

  handle(op: number, fn: CommandHandler): void {
    this.handlers[op] = fn;
  }

  /** How long a client's last input goes on when none comes: longer for a vehicle it drives or flies. */
  private holdTicks(c: Client): number {
    return c.drive >= 0 && this.world.reg.vehicle[this.world.ents.kind[c.drive]!] ? VEHICLE_HOLD_TICKS : INPUT_HOLD_TICKS;
  }

  /** Once a tick, before commands: each session's input for tick `T` steps its body, or what it drives, then its action and aim. */
  step(T: number): void {
    const world = this.world;
    const ents = world.ents;
    // Every body that may block a walker, where this tick's snapshots will carry it.
    let sessions = 0;
    for (const c of this.clients) {
      if (!c?.active) continue;
      const e = c.drive >= 0 ? c.drive : c.ent;
      if (e < 0) continue;
      if (sessions === this.sessionBodies.length) {
        const wider = new Int32Array(sessions * 2);
        wider.set(this.sessionBodies);
        this.sessionBodies = wider;
      }
      this.sessionBodies[sessions++] = e;
    }
    const others = this.blockBodies?.();
    if (others) this.blocking.begin([this.sessionBodies, others[0]], [sessions, others[1]]);
    else this.blocking.begin([this.sessionBodies], [sessions]);

    for (const c of this.clients) {
      if (!c) continue;
      c.packets = Math.max(0, c.packets - MAX_PACKETS_PER_TICK);
      c.reliable = 0;
      if (!c.active) continue;
      const inputs = c.inputs;
      if (c.closed) {
        c.heldX = c.heldZ = c.heldButtons = 0;
      } else if (inputs.has(T)) {
        const i = T & inputs.mask;
        // Any change of input counts as activity.
        if (c.heldX !== inputs.moveX[i] || c.heldZ !== inputs.moveZ[i] || c.heldYaw !== inputs.yaw[i] || c.heldPitch !== inputs.pitch[i] || c.heldButtons !== inputs.buttons[i]) c.activeAt = T;
        c.heldX = inputs.moveX[i]!;
        c.heldZ = inputs.moveZ[i]!;
        c.heldYaw = inputs.yaw[i]!;
        c.heldPitch = inputs.pitch[i]!;
        c.heldFineYaw = inputs.fineYaw[i]!;
        c.heldFinePitch = inputs.finePitch[i]!;
        c.heldButtons = inputs.buttons[i]!;
        c.inputAt = T;
      } else {
        this.stats.heldInputs++;
        // A client gone quiet, a hidden tab for one, stops where it is and keeps only its stance.
        if (T - c.inputAt > this.holdTicks(c)) {
          c.heldX = c.heldZ = 0;
          c.heldButtons &= INPUT_KEPT;
        }
      }
      c.carried = c.closed ? 0 : c.carry;
      c.heldButtons |= c.carried;
      c.carry = 0;
      c.stepped[T & (INPUT_WINDOW - 1)] = c.heldButtons;
      c.steppedAt[T & (INPUT_WINDOW - 1)] = T;
      c.lateFrom = T - TICK_RATE;
      c.edges();
      if (c.ent >= 0 && ents.seatSlot[c.ent] === IMPALE_SLOT && ents.seat[c.ent] !== 0) {
        c.heldButtons = c.pressed = 0;
        c.heldX = c.heldZ = 0;
      }
      c.did = 0;
      const b = c.body;
      // Let go of a mount that died or was replaced.
      if (c.drive >= 0 && ((ents.flags[c.drive]! & F_ALIVE) === 0 || ents.gen[c.drive] !== c.driveGen)) this.release(c);
      const driving = c.drive >= 0;
      const e = driving ? c.drive : c.ent;
      if (e >= 0 && !driving && this.isDown(e)) {
        // Lying as its ragdoll, it is moved where the ragdoll goes (server/falls.ts).
        c.chunk = chunkAt(world.dims, ents.x[e]!, ents.z[e]!);
      } else if (e >= 0) {
        ents.loadBody(e, b);
        const vehicle = world.reg.vehicle[b.kind];
        const combat = world.reg.combat[b.kind];
        const parent = ents.seat[e]! - 1;
        // Who sits in a seat of a car or a saddle and does not steer it is held there; a carried body has no seat slot.
        const passenger = !driving && parent >= 0 && ents.seatSlot[e] !== 0 && ents.gen[parent] === ents.seatGen[e];
        if (vehicle) {
          const quiet = c.closed || T - c.inputAt > VEHICLE_HOLD_TICKS;
          this.vehicleStep(world, b, quiet ? 0 : c.heldX, quiet ? 0 : c.heldZ, quiet ? (vehicle.movement === "rotor" ? 0 : BTN_JUMP) : c.heldButtons, vehicle, TICK_DT, c.heldYaw, !quiet);
        } else if (!passenger) {
          // A survivor's tamed numbers are its own. A body that is driven is a tame's.
          this.footBefore.copy(b);
          const moving = world.reg.tamedMove[b.kind]!;
          // The bodies about it as the snapshot its client stepped this tick with showed them, where it says which.
          const ack = c.inputs.has(T) ? c.inputAcks[T & c.inputs.mask]! : 0;
          const seen = ack !== 0 ? c.views.find(ack) : null;
          // Its tribe is the survivor's, riding or not, as its client knows it (OWN_TRIBE).
          const team = c.ent >= 0 ? ents.team[c.ent]! : ents.team[e]!;
          world.blockers = seen ? this.blocking.inView(e, seen, b.x, b.y, b.z, moving.radius, team) : this.blocking.around(e, b.x, b.y, b.z, moving.radius, team);
          if (combat && driving) stepCreature(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, c.pressed, world.reg.tamedMove[b.kind]!, combat, TICK_DT, true, c.closed || T - c.inputAt > INPUT_HOLD_TICKS);
          else stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.tamedMove[b.kind]!, TICK_DT);
          world.blockers = null;
          this.feet.meet(e, this.footBefore, b, world.reg.tamedMove[b.kind]!);
        } else {
          b.yaw = c.heldYaw;
          b.jetThrust = b.jetKeys = b.jetJumpTap = b.jetSprintTap = 0;
          stepOut.landSpeed = 0;
        }
        if (!driving) {
          // Enclosed cabins stow weapons while preserving the held inventory slot for exit.
          // Both hands are on an open glider, which stows what they held as a cabin does.
          const stowed = b.glide !== 0 || (passenger && (ents.seatSlot[e] === IMPALE_SLOT || world.reg.vehicle[ents.kind[parent]!]?.seats[ents.seatSlot[e]! - 1]?.weapons === false));
          if (stowed) { b.act = ACT_NONE; b.actTicks = 0; }
          // Hits are resolved later, once every body has moved.
          stepAction(b, stowed ? 0 : c.heldButtons, stowed ? 0 : c.pressed, stowed ? FISTS : world.reg.weapon[b.held] ?? FISTS);
          c.did = (actionOut.strike ? DID_STRIKE : 0) | (actionOut.fire ? DID_FIRE : 0) | (actionOut.reloaded ? DID_RELOAD : 0);
          c.drawn = actionOut.draw;
          stepAim(b, stowed ? FISTS : world.reg.weapon[b.held] ?? FISTS, T);
        } else {
          // A mount's bite goes through the same action step as any blow.
          const jaws = world.reg.weapon[b.kind];
          if (jaws && !combat) {
            stepAction(b, c.heldButtons, c.pressed, jaws);
            if (actionOut.strike) c.did = DID_BITE;
            biteCost(b, world.reg.biteStamina[b.kind]!);
          }
          if (stepOut.rolled) c.did |= DID_ROLL;
        }
        ents.storeBody(e, b);
        if (combat) ents.hold[e] = creatureHold(b);
        if (driving && !vehicle && (c.pressed & BTN_SECONDARY) !== 0 && b.act === ACT_NONE) this.onMountSecondary.emit(e);
        if (vehicle) this.onVehicleStep.emit(e);
        ents.pitch[e] = c.heldPitch;
        ents.pose(e, T);
        if (driving && (stepOut.tookOff || stepOut.setDown || stepOut.rolled)) this.onMountFlight.emit(e);
        if (!driving && (stepOut.glideOpened || stepOut.glideFolded)) this.onGlide.emit(c, stepOut.glideOpened);
        if (stepOut.landSpeed > 0) {
          if (driving) this.onMountLand.emit(e, stepOut.landSpeed);
          else this.onLand.emit(c, stepOut.landSpeed);
        }
      } else {
        b.kind = c.kind;
        stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.move[c.kind]!, TICK_DT);
      }
      c.chunk = chunkAt(world.dims, b.x, b.z);
    }
  }

  /** Once a tick, after the step: each session's queued commands, COMMANDS_PER_TICK of them at most. */
  commands(): void {
    for (const c of this.clients) if (c?.active && c.queue.length > 0) this.runCommands(c);
  }

  /** Put a session's inputs in charge of entity `e`. Its own body stays, unstepped, until `release`. */
  take(c: Client, e: number): boolean {
    const ents = this.world.ents;
    if (c.ent < 0 || c.drive >= 0 || e === c.ent || (ents.flags[e]! & (F_ALIVE | F_PLAYER | F_PROP)) !== F_ALIVE || ents.driven[e] !== 0) return false;
    if (!this.world.reg.move[ents.kind[e]!]) return false;
    c.drive = e;
    c.driveGen = ents.gen[e]!;
    ents.driven[e] = 1;
    return true;
  }

  release(c: Client): void {
    const ents = this.world.ents;
    if (c.drive < 0) return;
    if ((ents.flags[c.drive]! & F_ALIVE) !== 0 && ents.gen[c.drive] === c.driveGen) {
      ents.driven[c.drive] = 0;
      const combat = this.world.reg.combat[ents.kind[c.drive]!];
      if (combat) {
        const body = new Body();
        ents.loadBody(c.drive, body);
        cancelCreatureAction(body, combat);
        ents.storeBody(c.drive, body);
        ents.hold[c.drive] = creatureHold(body);
        ents.pose(c.drive, this.world.tick);
      }
    }
    c.drive = -1;
  }

  receive(c: Client, channel: number, data: Uint8Array): void {
    if (c.closed) return;
    let over = false;
    if (channel !== CH_RELIABLE) {
      if (++c.packets > PACKETS_HELD) {
        this.stats.throttled++;
        return;
      }
    } else over = ++c.reliable > MAX_RELIABLE_PER_TICK;
    let ok = data.length <= MAX_CLIENT_MESSAGE;
    if (ok) {
      const r = this.r;
      r.reset(data);
      const type = r.bits(4);
      // A stalled connection delivers a burst of commands in one tick. Each is still read for its place in the sequence.
      if (over && !(type === C_COMMAND && c.active)) ok = false;
      else if (type === C_INPUT && c.active) ok = this.input(c, r);
      else if (type === C_COMMAND && c.active && channel === CH_RELIABLE) ok = this.command(c, r, data, over);
      else ok = false;
    }
    if (!ok) {
      this.stats.malformed++;
      if (++c.strikes > MAX_STRIKES) this.sessions.reject(c, REJECT_MALFORMED);
    }
  }

  private input(c: Client, r: BitReader): boolean {
    const ack = r.u32();
    const behind = r.u8() / VIEW_STEPS;
    const validAck = ack >= c.highestAck && ack <= c.lastSnapshot && c.views.find(ack) ? ack : 0;
    const newest = readInputs(r, c.inputs, this.world.tick, validAck, behind, c.inputAcks, c.late);
    if (newest === 0) return false;
    if (newest <= this.world.tick) this.stats.lateInputs++;
    // Track the newest tick even when it is too far ahead to buffer, because the margin sent back tells a
    // client its clock has run away. It moves backward only by more than RESTARTED, which is a restarted clock.
    const fresh = newest > c.newestInput || newest < c.newestInput - RESTARTED;
    if (fresh) {
      // A stream delivers in order, so an input arrives with the first message whose newest reaches it.
      for (let t = Math.max(newest > c.newestInput ? c.newestInput + 1 : 0, newest - INPUT_WINDOW + 1); t <= newest; t++) c.arrived[t & (INPUT_WINDOW - 1)] = this.world.tick;
      c.newestInput = newest;
    }
    // An ack can only name a snapshot that was sent, and only move forward. An ack of 0 says the client cannot read against
    // the view it acknowledged, so the next snapshot is whole. An input that arrives out of order may not say that.
    if (ack === 0) {
      if (fresh) c.ackTick = 0;
    } else if (validAck > c.ackTick) c.highestAck = c.ackTick = validAck;
    return true;
  }

  /** A gap in the sequence means a broken client. A command `over` the tick's limit, or the queue's, is answered busy and not run. */
  private command(c: Client, r: BitReader, data: Uint8Array, over: boolean): boolean {
    const seq = r.u16();
    r.u8();
    if (r.overflow || seq !== nextCommandSeq(c.cmdSeq)) return false;
    c.cmdSeq = seq;
    c.activeAt = this.world.tick;
    if (over || c.queue.length >= COMMAND_QUEUE) this.tell.result(c, seq, RESULT_BUSY);
    else c.queue.push(data);
    return true;
  }

  private runCommands(c: Client): void {
    const r = this.r;
    for (let n = 0; n < COMMANDS_PER_TICK && c.queue.length > 0; n++) {
      const data = c.queue.shift()!;
      r.reset(data);
      r.bits(4);
      const seq = r.u16();
      const op = r.u8();
      const handler = this.handlers[op];
      let code: number;
      try {
        // What a session is shown is its own to ask in any state, so that is answered here.
        code = op === CMD_VIEW ? this.replication.askView(c, r) : op === CMD_STATICS ? this.replication.takeStatics(c) : !handler ? RESULT_INVALID : !this.allows.ask(c, op) ? RESULT_DENIED : handler(c, r);
      } catch (err) {
        this.stats.faults++;
        this.sessions.fault(c);
        if (!this.onFault?.(c, op, data, err)) throw err;
        this.tell.sendText(c, TEXT_NOTICE, `the server could not carry out a command of yours, so it has put you out; you may come back in ${FAULT_REFUSED_TICKS / TICK_RATE / 60} minutes`);
        this.sessions.reject(c, REJECT_DENIED);
        return;
      }
      this.stats.commands++;
      // The handler may have ended the session (a kick, too many password attempts).
      if (this.clients[c.id] !== c || c.closed || !c.conn.open) return;
      this.tell.result(c, seq, code);
    }
  }
}
