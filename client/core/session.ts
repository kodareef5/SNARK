// One client's connection, with no DOM, clock or socket. The shell or a test supplies a Connection and calls update().
// It runs ahead of the server so input T arrives before tick T, and steers its tick clock to keep the reported margin small and positive.

import type { Registry } from "../../shared/content/registry.ts";
import { deriveRegistry, parseTuning } from "../../shared/content/tuning.ts";
import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, TICK_RATE, YAW_UNITS, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { handleIndex } from "../../shared/ids.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import {
  CMD_TEXT,
  CMD_VIEW,
  BUTTON_MASK,
  HELLO_SPECTATE,
  INPUT_HOLD_TICKS,
  INPUT_KEPT,
  INPUT_REDUNDANCY,
  InputBuffer,
  MARGIN_UNKNOWN,
  MAX_CLIENT_MESSAGE,
  MAX_NAME_BYTES,
  MAX_SERVER_TEXT_BYTES,
  MAX_TEXT_BYTES,
  CMD_CREATE,
  OWN_BUFFS,
  OWN_RULES,
  RULE_CORPSE_LOCATOR,
  RULE_CROSSHAIR,
  RULE_DAMAGE_NUMBERS,
  RULE_GLOBAL_CHAT,
  RULE_HIT_MARKERS,
  RULE_MAP_LOCATION,
  RULE_THIRD_PERSON,
  MAX_TUNING_BYTES,
  OWN_TRIBE,
  OWN_VOICE,
  CMD_CHAT,
  MAX_CHAT_CHARS,
  OWN_HELD,
  OWN_LOOK,
  OWN_MARKERS,
  OWN_OPEN,
  OWN_PROGRESSION,
  OWN_RESPAWN,
  OWN_SESSION,
  OWN_SLOTS,
  OWN_VITALS,
  BOX_SELF,
  PITCH_LIMIT,
  PROTOCOL_VERSION,
  SESSION_ALIVE,
  S_CHUNK,
  S_CHUNK_DROP,
  S_EVENT,
  S_NODES,
  EVENT_DEATH,
  EVENT_HIT,
  EVENT_TAMED,
  OWN_SUBJECT,
  EVENT_HURT,
  EVENT_KILL,
  EVENT_NAME_BYTES,
  EVENT_SHOT,
  EVENT_BLAST,
  S_OWN,
  S_REJECT,
  S_RESULT,
  S_SNAPSHOT,
  S_TEXT,
  S_WELCOME,
  readBody,
  writeCommand,
  writeHello,
  writeInputs,
} from "../../shared/net/protocol.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { TOKEN_BYTES } from "../../shared/voice/packet.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection } from "../../shared/net/transport.ts";
import { EntityView, MAX_VIEW, VIEW_RING, ViewRing, dequantX, dequantY, readViewDelta } from "../../shared/net/view.ts";
import { Body, stanceEye, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { FISTS, actionOut, stepAction } from "../../shared/sim/weapon.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { NodeField, type NodeSource } from "../../shared/world/nodes.ts";
import { GONE_TAKEN, StructureStore } from "../../shared/world/structures.ts";
import { S_MARKS, S_TACTICAL } from "../../shared/net/protocol.ts";
import { MapStore } from "./tactical.ts";

export interface SessionOptions {
  name: string;
  /** The device key that owns the name, 16 random bytes kept by this client. */
  key: Uint8Array;
  /** Join without a body, if the server allows it. */
  spectate?: boolean;
  /** Content as written. ClientSession.registry holds the server-tuned version after the welcome. */
  registry: Registry;
  password?: string;
  /** Pack.clips.hash. The server must pose with the same clips. */
  clipHash?: number;
  /** A look for a new survivor (shared/anim/look.ts). Without one, a new name waits in the creator for `create`. */
  look?: Uint8Array;
  /** Returns null if this client does not have the map. */
  resolveMap(mapId: string, mapHash: number, dims: MapDims): Heightfield | null;
  /** The map's resource nodes, from the same pure function the server uses. */
  nodes?(hf: Heightfield, registry: Registry): NodeSource | null;
}

/** Null if the tuning does not parse or the derived content does not compile. */
function derive(reg: Registry, tuning: string): Registry | null {
  const t = parseTuning(tuning);
  if (!t) return null;
  try {
    return deriveRegistry(reg, t);
  } catch {
    return null;
  }
}

/** A structure that was just destroyed or fell. */
export interface Rubble {
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** GONE_DESTROYED or GONE_FELL. */
  cause: number;
  /** Where the removal began. For a fall, where support was lost. */
  ox: number;
  oy: number;
  oz: number;
  tick: number;
}

/** Beyond this the oldest queued rubble is dropped. */
const MAX_RUBBLE_QUEUED = 2048;

export class RemoteSample {
  count = 0;
  readonly id = new Uint32Array(MAX_VIEW);
  readonly kind = new Uint16Array(MAX_VIEW);
  readonly x = new Float32Array(MAX_VIEW);
  readonly y = new Float32Array(MAX_VIEW);
  readonly z = new Float32Array(MAX_VIEW);
  /** Radians. */
  readonly yaw = new Float32Array(MAX_VIEW);
  readonly flags = new Uint8Array(MAX_VIEW);
  readonly level = new Uint16Array(MAX_VIEW);
  /** Six colour regions per entity. Zero means the species' own colour. */
  readonly colors = new Uint8Array(MAX_VIEW * 6);
  readonly name: string[] = new Array<string>(MAX_VIEW).fill("");
  /** The moment sampled, in ticks. It may be fractional. */
  tick = 0;
  /** The pose, packed as the server sent it. See `AnimState.pack`. */
  readonly anim = new Uint32Array(MAX_VIEW);
  /** LOOK_BYTES each, valid where `hasLook` is 1. */
  readonly look = new Uint8Array(MAX_VIEW * LOOK_BYTES);
  readonly hasLook = new Uint8Array(MAX_VIEW);
  /** GEAR_COUNT content indices each, 0 for nothing. */
  readonly gear = new Uint16Array(MAX_VIEW * GEAR_COUNT);
  /** Each 0 for none: the owning team, the entity it sits on plus one, the ticks its growing takes, and the tick it will be grown. */
  readonly team = new Uint32Array(MAX_VIEW);
  readonly seat = new Uint32Array(MAX_VIEW);
  readonly span = new Uint32Array(MAX_VIEW);
  readonly grown = new Uint32Array(MAX_VIEW);
}

const HISTORY = 128;
/** Remote entities are drawn this many ticks behind the render clock, so there are two snapshots to blend between. */
export const REMOTE_DELAY = 2;
/** Ticks the client starts ahead of the server before any feedback. */
const INITIAL_LEAD = 4;
/**
 * The clock steers on the margins of the last MARGIN_WINDOW ticks of snapshots: the server should have had at least
 * TARGET_MARGIN inputs in hand each time, and never more than MARGIN_CAP, because it judges shots on a few (REWIND_SLACK).
 */
const TARGET_MARGIN = 1;
const MARGIN_CAP = 5;
const MARGIN_WINDOW = 90;
const MAX_STEPS_PER_UPDATE = 8;
/** Time constant of the fade that hides a correction, and the largest correction hidden, in metres. */
const SMOOTH_MS = 90;
const SMOOTH_LIMIT = 3;
/** Chunks around the body whose nodes stay filled. Collision needs one, drawing wants more. */
const NODE_RADIUS = 3;
const CLOSED_BY_PEER = -1;
const CLOSED_BAD_MAP = -2;
/** The content this client derives from the server's tuning does not hash to the server's. */
export const CLOSED_BAD_CONTENT = -3;
/** The server speaks another version of the protocol. REJECT_VERSION is the same news from the server's side. */
export const CLOSED_BAD_VERSION = -4;
const LOG_LINES = 200;

/** Beyond this the oldest untaken event is dropped. */
const MAX_EVENTS = 64;

/** One S_EVENT as received. Fields its kind does not carry are zero. See EVENT_* in shared/net/protocol.ts. */
export interface CombatEvent {
  kind: number;
  /** Where a hit landed. */
  x: number;
  y: number;
  z: number;
  /** A ZONE_ of shared/anim/human.ts. */
  zone: number;
  damage: number;
  kill: boolean;
  /** Armor stopped some of it. */
  blocked: boolean;
  /** The side harm came from, as a facing in 256ths of a turn. */
  bearing: number;
  /** Who killed this body, or what this body killed. */
  name: string;
  /** The killing item's content index (0 for bare hands), and the range in metres. For a blast, `far` is its reach. */
  item: number;
  far: number;
  /** The killed body's level, and the experience the kill gave. */
  level: number;
  xp: number;
  /**
   * For a shot, (x, y, z) is the origin and `item` the ammunition. If it `flies`, (vx, vy, vz) is its
   * velocity and `back` the ticks since it left. If not, (vx, vy, vz) is where it ended.
   */
  flies: boolean;
  vx: number;
  vy: number;
  vz: number;
  back: number;
}

/** A predicted shot of this client's own, from its eye. yaw and pitch are in input units. */
export interface LocalShot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  draw: number;
  ammo: number;
}

export interface TextLine {
  channel: number;
  text: string;
}

export class ClientSession {
  state: "connecting" | "active" | "closed" = "connecting";
  /** Reject reason from the server, or a negative local reason. */
  closeReason = 0;

  world: (CollisionWorld & { dims: MapDims }) | null = null;
  /** Handle of the local entity, or 0 while there is none (spectating, dead). */
  ownHandle = 0;
  ownKind = 0;
  /** Index of the entity its inputs drive in place of its own body, or -1. */
  driving = -1;

  /** Species of the predicted body: the survivor's own, or its mount's. */
  get bodyKind(): number {
    return this.own.kind !== 0 ? this.own.kind : this.ownKind;
  }
  /** A SESSION_* state, as the server last sent it. */
  sessionState = SESSION_ALIVE;
  readonly name: string;
  /** Cheats enabled. */
  admin = false;
  ownLook: Uint8Array | null = null;
  /** Hotbar slot in hand, 0 to 9, or -1. */
  held = -1;
  /** Added to the tick to get the time of day. */
  dayOffset = 0;
  /** Text from the server, oldest first. `logVersion` counts every line ever added. */
  readonly log: TextLine[] = [];
  logVersion = 0;
  /** Values at a tick and their rates, as the server last sent them. Evaluate with `vitals.at(i, serverTick)`. */
  readonly vitals = new Vitals();
  hasVitals = false;
  /** Oldest first. Falling.absorb empties it. */
  readonly rubble: Rubble[] = [];
  /** Server rules the client acts on. */
  damageNumbers = true;
  globalChat = true;
  hitMarkers = true;
  thirdPerson = true;
  crosshair = true;
  mapLocation = true;
  corpseLocator = true;
  motdSeconds = 20;
  /** The server's clock scales: the whole cycle, and the day and the night within it. */
  readonly clock = { cycle: 1, day: 1, night: 1 };
  /** Content as written until the welcome, then what the server's tuning makes of it (shared/content/tuning.ts). */
  registry: Registry;
  /**
   * voice is what opens the voice socket: speaker number, token and rights. In tribe, name is "" alone
   * and invite is "" for none. Each `version` counts updates.
   */
  readonly voice = { slot: 0, token: new Uint8Array(TOKEN_BYTES), rights: 0, version: 0 };
  readonly tribe = { team: 0, name: "", rank: 0, members: [] as { name: string; online: boolean; owner: boolean }[], invite: "", inviteBy: "", version: 0 };
  /** Each is a buff's content index and the tick it ends, or 0 for no end. */
  readonly buffs: { buff: number; until: number }[] = [];
  /** Predicted shots of its own body, oldest first. Shots.absorb empties it. */
  readonly fired: LocalShot[] = [];
  private firedTick = 0;
  /** Oldest first. Shots.absorb takes the shots and blasts, then Feedback.absorb empties it. */
  readonly events: CombatEvent[] = [];
  /** Creatures just tamed, waiting for the naming prompt. te is in percent. */
  readonly tamed: { handle: number; kind: number; level: number; te: number }[] = [];
  /** The creature whose inventory is open, or null when the open container is not a creature. Shares are 0 to 1. */
  subject: { taming: boolean; owned: boolean; level: number; progress: number; te: number; torpor: number; food: number; id: number; points: number; stance: number; following: boolean; saddled: boolean; breeds: boolean; mating: boolean; female: boolean; stage: number; maturity: number; mate: number; wait: number } | null = null;
  inventory: Inventory | null = null;
  open: { name: string; inventory: Inventory } | null = null;
  /** Oldest first. */
  readonly markers: { kind: number; x: number; y: number; z: number; tick: number }[] = [];
  /** The world's respawn points, then the tribe's beds. wait is in seconds. */
  readonly respawnPoints: { name: string; x: number; z: number; wait: number }[] = [];
  /** The map beyond the view: structure cells and marks, as the server sends them. */
  readonly tactical = new MapStore();
  readonly progress = { xp: 0, level: 1, statPoints: 0, engramPoints: 0, engrams: [] as number[], jobs: [] as { item: number; left: number; doneAt: number }[], version: 0 };
  /** Resource nodes around the body, filled from the map minus those the server reports used up. */
  nodeField: NodeField | null = null;
  private nodeChunk = -1;
  private readonly nodeGone = new Map<number, number[]>();
  onResult: ((seq: number, code: number) => void) | null = null;
  /** Predicted local body after the latest simulated tick. */
  readonly own = new Body();
  /** One tick earlier, for render interpolation. */
  readonly ownPrev = new Body();
  ownYaw = 0;
  ownPitch = 0;

  /** Latest tick the client has simulated. */
  simTick = 0;
  /** Fractional tick clock that `simTick` follows. */
  tickClock = 0;
  /** Smoothed estimate of the newest server tick received. */
  renderClock = 0;
  /** The tick sampleRemote last drew remote entities at, which is what was on screen when the next input is sampled. 0 before the first. */
  shown = 0;
  latestSnapshot = 0;

  /**
   * `corrections` counts snapshots that moved the predicted body. `stateCorrections` counts those that changed only other
   * predicted state. `unsent` counts commands too long for a message.
   */
  readonly stats = { snapshots: 0, undecodable: 0, corrections: 0, stateCorrections: 0, clockJumps: 0, margin: 0, rttTicks: 0, bytesIn: 0, unsent: 0 };
  /** What is left to hide of the last correction. Add it to the body's position when drawing. */
  smoothX = 0;
  smoothY = 0;
  smoothZ = 0;

  private readonly conn: Connection;
  private readonly opts: SessionOptions;
  private move: MoveParams | null = null;
  private readonly inputs = new InputBuffer(HISTORY);
  /** Buttons seen down on any frame since the last tick was sampled. */
  private tapped = 0;
  private readonly bodies: Body[] = [];
  private readonly bodyTick = new Uint32Array(HISTORY);
  private readonly views = new ViewRing(() => new EntityView());
  /** What is drawn after each snapshot: every body as it was last told of. `views` are what deltas are read against. */
  private readonly drawn = new ViewRing(() => new EntityView());
  private readonly w = new BitWriter(MAX_CLIENT_MESSAGE);
  private readonly r = new BitReader();
  private readonly serverBody = new Body();
  private lastNow = -1;
  private dilation = 1;
  private guardTick = 0;
  /** The margins reported, by their snapshot's tick. */
  private readonly margins = new Int8Array(128);
  private readonly marginAt = new Uint32Array(128);
  private needFull = true;
  private commandSeq = 0;
  /** What `view` last asked the server for. */
  private viewCap = 0;
  private viewBytes = 0;

  constructor(conn: Connection, opts: SessionOptions) {
    this.registry = opts.registry;
    this.name = opts.name;
    this.conn = conn;
    this.opts = opts;
    for (let i = 0; i < HISTORY; i++) this.bodies.push(new Body());
    conn.onMessage = (channel, data) => this.receive(channel, data);
    conn.onClose = () => {
      if (this.state !== "closed") {
        this.state = "closed";
        this.closeReason = CLOSED_BY_PEER;
      }
    };
    const w = this.w;
    writeHello(w, PROTOCOL_VERSION, (opts.registry.source ?? opts.registry).hash, opts.clipHash ?? 0, opts.name, opts.spectate ? HELLO_SPECTATE : 0, opts.key, opts.look ?? null, opts.password ?? "");
    conn.send(CH_RELIABLE, w.bytes());
  }

  /** `args` appends the op's arguments. Returns the sequence number, or 0 if nothing was sent. Commands are not predicted or resent. */
  command(op: number, args?: (w: BitWriter) => void): number {
    // The server expects sequence numbers without gaps, so an unsent command uses none.
    if (this.state !== "active") return 0;
    const seq = (this.commandSeq + 1) & 0xffff;
    const w = this.w;
    w.reset();
    writeCommand(w, seq, op);
    args?.(w);
    // Part of a command is worse than none, so one that does not fit a message is counted and not sent.
    if (w.overflow) {
      this.stats.unsent++;
      return 0;
    }
    this.commandSeq = seq;
    this.conn.send(CH_RELIABLE, w.bytes());
    return seq;
  }

  /** Asks to be shown at most `cap` entities, in snapshots of at most `bytes`. Sent when either changes. The server holds both to its limits. */
  view(cap: number, bytes: number): void {
    if ((cap === this.viewCap && bytes === this.viewBytes) || this.command(CMD_VIEW, (w) => (w.u16(cap), w.u16(bytes))) === 0) return;
    this.viewCap = cap;
    this.viewBytes = bytes;
  }

  create(look: Uint8Array): number {
    return this.command(CMD_CREATE, (w) => {
      for (let i = 0; i < LOOK_BYTES; i++) w.u8(look[i] ?? 0);
    });
  }

  /** Send a console line. */
  text(line: string): number {
    // Cut by characters. At most three bytes each keeps the line under the server's limit.
    const cut = line.length > MAX_TEXT_BYTES / 3 ? line.slice(0, Math.floor(MAX_TEXT_BYTES / 3)) : line;
    return this.command(CMD_TEXT, (w) => w.string(cut));
  }

  /** `channel` is TEXT_GLOBAL, TEXT_LOCAL or TEXT_TRIBE. The server decides who reads it. */
  chat(channel: number, words: string): number {
    const cut = words.length > MAX_CHAT_CHARS ? words.slice(0, MAX_CHAT_CHARS) : words;
    return this.command(CMD_CHAT, (w) => (w.bits(channel, 3), w.string(cut)));
  }

  /** Fraction of the way from `ownPrev` to `own` at the last `update`. */
  get alpha(): number {
    const a = this.tickClock - this.simTick;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Samples the given input for every tick that elapses. moveX and moveZ are -1..1 (right, forward). yaw and pitch are radians.
   * A button down on any frame since the last tick is down for the next one, so a press shorter than a tick is not lost between two.
   */
  update(nowMs: number, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number): void {
    if (this.state !== "active") return;
    let dt = this.lastNow < 0 ? 0 : nowMs - this.lastNow;
    this.lastNow = nowMs;
    if (dt > 250) dt = 250;
    const ticks = (dt / 1000) * TICK_RATE;
    this.tickClock += ticks * this.dilation;
    this.renderClock += ticks;
    if (this.smoothX !== 0 || this.smoothY !== 0 || this.smoothZ !== 0) {
      const keep = Math.exp(-dt / SMOOTH_MS);
      this.smoothX *= keep;
      this.smoothY *= keep;
      this.smoothZ *= keep;
      if (this.smoothX * this.smoothX + this.smoothY * this.smoothY + this.smoothZ * this.smoothZ < 1e-8) this.smoothX = this.smoothY = this.smoothZ = 0;
    }

    const qx = Math.round(clamp1(moveX) * 127);
    const qz = Math.round(clamp1(moveZ) * 127);
    const qyaw = Math.round((yaw / TAU) * YAW_UNITS) & 0xffff;
    const qpitch = Math.round((pitch / (PI / 2)) * PITCH_LIMIT);
    this.ownYaw = yaw;
    this.ownPitch = pitch;

    this.tapped |= buttons;
    const target = Math.floor(this.tickClock);
    let steps = 0;
    while (this.simTick < target && steps < MAX_STEPS_PER_UPDATE) {
      const t = ++this.simTick;
      steps++;
      this.inputs.set(t, qx, qz, qyaw, qpitch, this.tapped | buttons);
      this.tapped = 0;
      this.ownPrev.copy(this.own);
      this.step(t);
    }
    // Too far behind to catch up by simulating, so skip. The server held the last input meanwhile.
    if (this.simTick < target) this.simTick = target;
    if (steps > 0) {
      this.sendInputs();
      this.recenterNodes();
    }
  }

  /** Fill `out` with remote entities interpolated to the current render time. */
  sampleRemote(out: RemoteSample, delayTicks = REMOTE_DELAY): void {
    out.count = 0;
    const at = this.renderClock - delayTicks;
    out.tick = at;
    this.shown = at;
    let a: EntityView | null = null;
    let b: EntityView | null = null;
    for (let i = 0; i < VIEW_RING; i++) {
      const v = this.drawn.at(i);
      if (v.tick === 0) continue;
      if (v.tick <= at) {
        if (!a || v.tick > a.tick) a = v;
      } else if (!b || v.tick < b.tick) b = v;
    }
    if (!b) b = a;
    if (!b) return;
    const k = a && a !== b ? (at - a.tick) / (b.tick - a.tick) : 1;
    let i = 0;
    const na = a ? a.count : 0;
    for (let j = 0; j < b.count; j++) {
      const id = b.id[j]!;
      while (i < na && a!.id[i]! < id) i++;
      const n = out.count++;
      out.id[n] = id;
      out.kind[n] = b.kind[j]!;
      out.flags[n] = b.flags[j]!;
      out.level[n] = b.level[j]!;
      out.name[n] = b.name[j]!;
      const look = b.look[j]!;
      out.hasLook[n] = look ? 1 : 0;
      if (look) out.look.set(look, n * LOOK_BYTES);
      const gear = b.gear[j]!;
      if (gear) out.gear.set(gear, n * GEAR_COUNT);
      else out.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
      for (let q = 0; q < 6; q++) out.colors[n * 6 + q] = b.colors[j * 6 + q]!;
      out.team[n] = b.team[j]!;
      out.seat[n] = b.seat[j]!;
      out.span[n] = b.span[j]!;
      out.grown[n] = b.grown[j]!;
      if (a !== b && i < na && a!.id[i] === id && a!.gen[i] === b.gen[j]) {
        out.x[n] = dequantX(a!.qx[i]! + (b.qx[j]! - a!.qx[i]!) * k);
        out.y[n] = dequantY(a!.qy[i]! + (b.qy[j]! - a!.qy[i]!) * k);
        out.z[n] = dequantX(a!.qz[i]! + (b.qz[j]! - a!.qz[i]!) * k);
        let turn = b.yaw[j]! - a!.yaw[i]!;
        if (turn > 512) turn -= 1024;
        else if (turn < -512) turn += 1024;
        out.yaw[n] = ((a!.yaw[i]! + turn * k) * TAU) / 1024;
        // The pose is not blended. It comes from the nearer snapshot.
        out.anim[n] = k < 0.5 ? a!.anim[i]! : b.anim[j]!;
      } else {
        out.anim[n] = b.anim[j]!;
        out.x[n] = dequantX(b.qx[j]!);
        out.y[n] = dequantY(b.qy[j]!);
        out.z[n] = dequantX(b.qz[j]!);
        out.yaw[n] = (b.yaw[j]! * TAU) / 1024;
      }
    }
  }

  close(): void {
    this.state = "closed";
    this.conn.close();
  }

  private step(t: number): void {
    const i = t & this.inputs.mask;
    const inp = this.inputs;
    const buttons = inp.buttons[i]!;
    // The body steps with the move parameters of the kind the server last sent: its own species or its mount's.
    stepBody(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, inp.yaw[i]!, inp.pitch[i]!, buttons, this.registry.move[this.own.kind] ?? this.move!, TICK_DT);
    if (this.driving >= 0) {
      // A mount's bite is stepped here as the server steps it, so both agree on the body's action.
      const jaws = this.registry.weapon[this.own.kind];
      if (jaws) {
        const was = inp.has(t - 1) ? inp.buttons[(t - 1) & inp.mask]! : 0;
        stepAction(this.own, buttons, buttons & ~was, jaws);
      }
      this.bodies[t & (HISTORY - 1)]!.copy(this.own);
      this.bodyTick[t & (HISTORY - 1)] = t;
      return;
    }
    // The action step takes the same buttons as the server's, and those that went down since the tick before.
    const before = inp.has(t - 1) ? inp.buttons[(t - 1) & inp.mask]! : 0;
    stepAction(this.own, buttons, buttons & ~before, this.registry.weapon[this.own.held] ?? FISTS);
    // A replay after a correction steps old ticks again, so a shot is noted only on a tick's first step.
    if (actionOut.fire && t > this.firedTick) {
      this.firedTick = t;
      const inv = this.inventory;
      const slot = inv && inv.hotbar >= 0 && this.held >= 0 ? inv.hotbar + this.held : -1;
      const ammo = slot >= 0 ? inv!.ammo[slot]! : 0;
      if (ammo !== 0 && this.fired.length < 16) this.fired.push({ x: this.own.x, y: this.own.y + stanceEye(this.move!, this.own.stance), z: this.own.z, yaw: inp.yaw[i]!, pitch: inp.pitch[i]!, draw: actionOut.draw, ammo });
    }
    this.bodies[t & (HISTORY - 1)]!.copy(this.own);
    this.bodyTick[t & (HISTORY - 1)] = t;
  }

  private sendInputs(): void {
    let count = 1;
    while (count < INPUT_REDUNDANCY && this.inputs.has(this.simTick - count)) count++;
    const w = this.w;
    w.reset();
    // The last argument is how far behind the newest snapshot remote entities were drawn when the newest input was sampled.
    writeInputs(w, this.inputs, this.needFull ? 0 : this.latestSnapshot, this.simTick, count, this.latestSnapshot - (this.shown > 0 ? this.shown : this.renderClock - REMOTE_DELAY));
    this.conn.send(CH_UNRELIABLE, w.bytes());
  }

  private receive(_channel: number, data: Uint8Array): void {
    if (this.state === "closed") return;
    this.stats.bytesIn += data.length;
    const r = this.r;
    r.reset(data);
    const type = r.u8();
    if (type === S_SNAPSHOT) {
      if (this.state === "active") this.snapshot(r);
    } else if (type === S_CHUNK) this.chunk(r);
    else if (type === S_CHUNK_DROP) this.world?.structs.dropChunk(r.u16());
    else if (type === S_NODES) this.nodes(r);
    else if (type === S_EVENT) this.event(r);
    else if (type === S_TACTICAL && this.world) this.tactical.readCells(r, this.world.hf);
    else if (type === S_MARKS && this.world) this.tactical.readMarks(r, this.world.hf);
    else if (type === S_WELCOME) this.welcome(r);
    else if (type === S_RESULT) {
      const seq = r.u16();
      const code = r.u8();
      if (!r.overflow) this.onResult?.(seq, code);
    } else if (type === S_TEXT) {
      const channel = r.u8();
      const text = r.string(MAX_SERVER_TEXT_BYTES);
      if (r.overflow) return;
      this.log.push({ channel, text });
      if (this.log.length > LOG_LINES) this.log.shift();
      this.logVersion++;
    } else if (type === S_OWN) this.ownState(r);
    else if (type === S_REJECT) {
      this.state = "closed";
      this.closeReason = r.u8();
    }
  }

  /** The used-up nodes of a chunk. Applied now if the chunk is filled, and remembered for when it is. */
  private nodes(r: BitReader): void {
    const chunk = r.u16();
    r.u32();
    const count = r.u16();
    const gone: number[] = [];
    for (let k = 0; k < count; k++) gone.push(r.u8());
    const field = this.nodeField;
    if (r.overflow || !field) return;
    const before = this.nodeGone.get(chunk) ?? [];
    this.nodeGone.set(chunk, gone);
    for (const i of before) if (!gone.includes(i)) field.set(chunk, i, true);
    for (const i of gone) if (!before.includes(i)) field.set(chunk, i, false);
  }

  private recenterNodes(): void {
    const field = this.nodeField;
    const world = this.world;
    if (!field || !world) return;
    const chunk = chunkAt(world.dims, this.own.x, this.own.z);
    if (chunk === this.nodeChunk) return;
    const gone = (c: number, i: number): boolean => this.nodeGone.get(c)?.includes(i) ?? false;
    field.retain(chunk, NODE_RADIUS, 1, gone);
    if (this.nodeChunk >= 0) field.retain(this.nodeChunk, NODE_RADIUS, -1, gone);
    this.nodeChunk = chunk;
  }

  /** One component per message. */
  private ownState(r: BitReader): void {
    const component = r.u8();
    if (component === OWN_SESSION) {
      const state = r.bits(2);
      const admin = r.bool();
      const handle = r.u32();
      const dayOffset = r.u32();
      if (r.overflow) return;
      this.sessionState = state;
      this.admin = admin;
      this.ownHandle = handle;
      this.dayOffset = dayOffset;
    } else if (component === OWN_VITALS) {
      const v = this.vitals;
      const tick = r.u32();
      const fields = new Array<number>(V_COUNT * 3).fill(0);
      for (let i = 0; i < V_COUNT * 3; i += 3) {
        fields[i] = r.uint53();
        fields[i + 1] = r.svarint();
        fields[i + 2] = r.uint53();
      }
      if (r.overflow) return;
      v.tick = tick;
      for (let i = 0; i < V_COUNT; i++) {
        v.value[i] = fields[i * 3]!;
        v.rate[i] = fields[i * 3 + 1]!;
        v.max[i] = fields[i * 3 + 2]!;
      }
      v.version++;
      this.hasVitals = true;
    } else if (component === OWN_SLOTS) {
      const box = r.bits(1);
      const cap = r.varint();
      const bag = r.varint();
      const full = r.bool();
      const count = r.u16();
      if (r.overflow || bag > cap) return;
      let inv: Inventory | null;
      if (box === BOX_SELF) {
        inv = this.inventory;
        if (!inv || inv.cap !== cap || inv.bag !== bag || full) inv = this.inventory = new Inventory(cap, bag);
      } else {
        if (!this.open) return;
        if (this.open.inventory.cap !== cap || this.open.inventory.bag !== bag || full) this.open.inventory = new Inventory(cap, bag);
        inv = this.open.inventory;
      }
      for (let k = 0; k < count; k++) {
        const slot = r.varint();
        const item = r.u16();
        const n = item === 0 ? 0 : r.u16();
        const quality = item === 0 ? 0 : r.u8();
        const dur = item === 0 ? 0 : r.u16();
        const spoilAt = item === 0 ? 0 : r.u32();
        const holds = item !== 0 && r.bool();
        const ammo = holds ? r.u16() : 0;
        const loaded = holds ? r.u8() : 0;
        const attach = holds ? r.u16() : 0;
        if (r.overflow || slot >= cap) return;
        inv.set(slot, item, n, quality, dur, spoilAt);
        if (holds) inv.setGear(slot, ammo, loaded, attach);
      }
    } else if (component === OWN_SUBJECT) {
      if (!r.bool()) this.subject = null;
      else {
        const next = { taming: r.bool(), owned: r.bool(), level: r.u16(), progress: r.bits(10) / 1000, te: r.bits(10) / 1000, torpor: r.bits(10) / 1000, food: r.bits(10) / 1000, id: r.u32(), points: r.u8(), stance: r.bits(2), following: r.bool(), saddled: r.bool(), breeds: r.bool(), mating: r.bool(), female: r.bool(), stage: r.bits(2), maturity: r.bits(10) / 1000, mate: r.bits(10) / 1000, wait: r.varint() };
        if (!r.overflow) this.subject = next;
      }
    } else if (component === OWN_OPEN) {
      if (!r.bool()) this.open = null;
      else {
        const cap = r.varint();
        const name = r.string(64);
        if (!r.overflow) this.open = { name, inventory: new Inventory(cap) };
      }
    } else if (component === OWN_MARKERS) {
      const count = r.u8();
      const list = [];
      for (let k = 0; k < count; k++) list.push({ kind: r.u8(), x: r.f32(), y: r.f32(), z: r.f32(), tick: r.u32() });
      if (r.overflow) return;
      this.markers.length = 0;
      this.markers.push(...list);
    } else if (component === OWN_RULES) {
      const flags = r.u16();
      if (r.overflow) return;
      this.damageNumbers = (flags & RULE_DAMAGE_NUMBERS) !== 0;
      this.globalChat = (flags & RULE_GLOBAL_CHAT) !== 0;
      this.hitMarkers = (flags & RULE_HIT_MARKERS) !== 0;
      this.thirdPerson = (flags & RULE_THIRD_PERSON) !== 0;
      this.crosshair = (flags & RULE_CROSSHAIR) !== 0;
      this.mapLocation = (flags & RULE_MAP_LOCATION) !== 0;
      this.corpseLocator = (flags & RULE_CORPSE_LOCATOR) !== 0;
    } else if (component === OWN_VOICE) {
      const slot = r.u16();
      const token = new Uint8Array(TOKEN_BYTES);
      for (let i = 0; i < TOKEN_BYTES; i++) token[i] = r.u8();
      const rights = r.u8();
      if (r.overflow) return;
      this.voice.slot = slot;
      this.voice.token = token;
      this.voice.rights = rights;
      this.voice.version++;
    } else if (component === OWN_TRIBE) {
      const team = r.varint();
      const name = r.string(MAX_NAME_BYTES * 3);
      let rank = 0;
      const members: { name: string; online: boolean; owner: boolean }[] = [];
      if (name !== "") {
        rank = r.u8();
        for (let k = r.u8(); k > 0 && !r.overflow; k--) members.push({ name: r.string(MAX_NAME_BYTES * 3), online: r.bool(), owner: r.bool() });
      }
      const invite = r.string(MAX_NAME_BYTES * 3);
      const inviteBy = invite !== "" ? r.string(MAX_NAME_BYTES * 3) : "";
      if (r.overflow) return;
      const t = this.tribe;
      t.team = team;
      t.name = name;
      t.rank = rank;
      t.members = members;
      t.invite = invite;
      t.inviteBy = inviteBy;
      t.version++;
    } else if (component === OWN_BUFFS) {
      const n = r.u8();
      const got: { buff: number; until: number }[] = [];
      for (let i = 0; i < n; i++) got.push({ buff: r.u16(), until: r.u32() });
      if (r.overflow) return;
      this.buffs.length = 0;
      this.buffs.push(...got);
    } else if (component === OWN_HELD) {
      const held = r.u8();
      if (!r.overflow) this.held = held === 255 ? -1 : held;
    } else if (component === OWN_LOOK) {
      const look = new Uint8Array(LOOK_BYTES);
      for (let i = 0; i < LOOK_BYTES; i++) look[i] = r.u8();
      if (!r.overflow) this.ownLook = look;
    } else if (component === OWN_PROGRESSION) {
      const p = this.progress;
      const xp = r.u32();
      const level = r.u16();
      const statPoints = r.u16();
      const engramPoints = r.varint();
      const engrams: number[] = [];
      for (let k = r.varint(); k > 0 && !r.overflow; k--) engrams.push(r.u16());
      const jobs: { item: number; left: number; doneAt: number }[] = [];
      for (let k = r.u8(); k > 0 && !r.overflow; k--) jobs.push({ item: r.u16(), left: r.u8(), doneAt: r.u32() });
      if (r.overflow) return;
      p.xp = xp;
      p.level = level;
      p.statPoints = statPoints;
      p.engramPoints = engramPoints;
      p.engrams = engrams;
      p.jobs = jobs;
      p.version++;
    } else if (component === OWN_RESPAWN) {
      const count = r.u8();
      const list = [];
      for (let k = 0; k < count; k++) list.push({ name: r.string(MAX_NAME_BYTES), x: r.f32(), z: r.f32(), wait: r.u16() });
      if (r.overflow) return;
      this.respawnPoints.length = 0;
      this.respawnPoints.push(...list);
    }
  }

  /** The client's estimate of the server tick, for evaluating vitals and spoil clocks. */
  get serverTick(): number {
    return Math.floor(this.renderClock);
  }

  private event(r: BitReader): void {
    const kind = r.u8();
    const ev: CombatEvent = { kind, x: 0, y: 0, z: 0, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0 };
    if (kind === EVENT_SHOT) {
      ev.x = r.f32();
      ev.y = r.f32();
      ev.z = r.f32();
      ev.item = r.u16();
      ev.flies = r.bool();
      ev.vx = r.f32();
      ev.vy = r.f32();
      ev.vz = r.f32();
      if (ev.flies) ev.back = r.u8();
    } else if (kind === EVENT_BLAST) {
      ev.x = r.f32();
      ev.y = r.f32();
      ev.z = r.f32();
      ev.far = r.f32();
    } else if (kind === EVENT_HIT) {
      ev.x = r.f32();
      ev.y = r.f32();
      ev.z = r.f32();
      ev.zone = r.bits(4);
      ev.damage = r.u16();
      ev.kill = r.bool();
      ev.blocked = r.bool();
    } else if (kind === EVENT_HURT || kind === EVENT_DEATH) {
      ev.damage = r.u16();
      ev.bearing = r.u8();
      ev.zone = r.bits(4);
      if (kind === EVENT_DEATH) {
        ev.kill = true;
        ev.name = r.string(EVENT_NAME_BYTES);
        ev.item = r.u16();
        ev.far = r.u16() / 10;
      }
    } else if (kind === EVENT_KILL) {
      ev.name = r.string(EVENT_NAME_BYTES);
      ev.level = r.u16();
      ev.xp = r.u16() / 10;
    } else if (kind === EVENT_TAMED) {
      // Not a combat event. It is queued for the naming prompt.
      const won = { handle: r.u32(), kind: r.u16(), level: r.u16(), te: r.u8() };
      if (!r.overflow && this.tamed.length < 8) this.tamed.push(won);
      return;
    } else return;
    if (r.overflow) return;
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private welcome(r: BitReader): void {
    const version = r.u16();
    const tick = r.u32();
    this.ownHandle = r.u32();
    this.ownKind = r.u16();
    this.sessionState = r.bits(2);
    this.admin = r.bool();
    this.dayOffset = r.u32();
    const mapId = r.string(64);
    const mapHash = r.u32();
    const dims = { chunksX: r.u8() + 1, chunksZ: r.u8() + 1 };
    readBody(r, this.own);
    const yaw = r.u16();
    const contentHash = r.u32();
    const tuning = r.string(MAX_TUNING_BYTES);
    const cycle = r.f64();
    const day = r.f64();
    const night = r.f64();
    const motdSeconds = r.u16();
    const refuse = (reason: number): void => {
      this.state = "closed";
      this.closeReason = reason;
      this.conn.close();
    };
    // Another version lays the rest out differently, so nothing after the version is believed.
    if (version !== PROTOCOL_VERSION) return refuse(CLOSED_BAD_VERSION);
    if (r.overflow) return refuse(CLOSED_BAD_MAP);
    // Derive the server's content here with the same function. If the hash differs, this client would predict other numbers, so it leaves.
    const reg = derive(this.registry, tuning);
    if (!reg || reg.hash !== contentHash) return refuse(CLOSED_BAD_CONTENT);
    const hf = this.opts.resolveMap(mapId, mapHash, dims);
    const move = reg.move[this.ownKind];
    if (!hf || !move) return refuse(CLOSED_BAD_MAP);
    this.registry = reg;
    this.clock.cycle = cycle;
    this.clock.day = day;
    this.clock.night = night;
    this.motdSeconds = motdSeconds;
    const source = this.opts.nodes?.(hf, reg) ?? null;
    this.nodeField = source ? new NodeField(dims, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, source) : null;
    this.world = { dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), ...(this.nodeField ? { nodes: this.nodeField.store } : {}) };
    this.recenterNodes();
    this.move = move;
    this.ownPrev.copy(this.own);
    this.ownYaw = (yaw * TAU) / YAW_UNITS;
    this.tickClock = tick + INITIAL_LEAD;
    this.simTick = tick + INITIAL_LEAD;
    this.renderClock = tick;
    this.state = "active";
  }

  private snapshot(r: BitReader): void {
    const tick = r.u32();
    const age = r.u8();
    const margin = r.sbits(8);
    const state = r.bits(2);
    const driving = r.varint() - 1;
    const sb = this.serverBody;
    readBody(r, sb);
    if (r.overflow || tick <= this.latestSnapshot) return;

    const base = age > 0 ? this.views.find(tick - age) : null;
    if (age > 0 && !base) {
      // Encoded against a view this client no longer has. Ask for a full one.
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    const next = this.views.alloc(tick);
    const drawn = this.drawn.alloc(tick);
    if (!readViewDelta(r, base, next, this.drawn.find(this.latestSnapshot), drawn) || r.overflow) {
      next.tick = drawn.tick = 0;
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    this.latestSnapshot = tick;
    this.needFull = false;
    this.sessionState = state;
    this.driving = driving;
    this.stats.snapshots++;

    // Render clock follows the newest server tick, smoothly unless far off.
    const lag = tick - this.renderClock;
    if (lag > 6 || lag < -6) this.renderClock = tick;
    else this.renderClock += lag * 0.1;

    // The input clock keeps the server's margin near the target, once the server has one to report. A stall that held
    // inputs back lowers the least margin for a few seconds and speeds the clock gently; it is not a reason to jump.
    if (margin !== MARGIN_UNKNOWN) {
      this.stats.margin = margin;
      // At either end of its range the margin is a bound, not a measurement.
      if (margin > -127 && margin < 127) this.stats.rttTicks = this.simTick - tick - margin;
      if (this.simTick >= this.guardTick) {
        this.margins[tick & 127] = margin;
        this.marginAt[tick & 127] = tick;
        // The least and most of the window, and of its last quarter second.
        let lo = 127;
        let hi = -127;
        let nowLo = 127;
        let nowHi = -127;
        let n = 0;
        for (let i = 0; i < 128; i++) {
          if (this.marginAt[i] === 0 || this.marginAt[i]! + MARGIN_WINDOW <= tick) continue;
          const m = this.margins[i]!;
          if (m < lo) lo = m;
          if (m > hi) hi = m;
          if (this.marginAt[i]! + 8 > tick) {
            if (m < nowLo) nowLo = m;
            if (m > nowHi) nowHi = m;
            n++;
          }
        }
        // Far off is every input late for a quarter second, or every one early. That moves the best of them, or the worst, to the target.
        const behind = n >= 4 && nowHi < 0;
        if (behind || (n >= 4 && nowLo >= TARGET_MARGIN + 7)) {
          this.marginAt.fill(0);
          this.tickClock += TARGET_MARGIN - (behind ? nowHi : nowLo);
          this.dilation = 1;
          this.stats.clockJumps++;
          // Simulated far past the new time. Waiting for the clock would freeze the player, so start again here.
          // The next snapshot supplies the body.
          const at = Math.floor(this.tickClock);
          if (this.simTick - at > TICK_RATE) {
            this.simTick = at;
            this.bodyTick.fill(0);
            this.inputs.tick.fill(0);
          }
          // Ignore feedback until snapshots can reflect this jump. That is a round trip, capped at a second
          // because the estimate is unreliable just after a jump.
          const wait = Math.ceil(this.stats.rttTicks);
          this.guardTick = Math.floor(this.tickClock) + (wait < 0 ? 0 : wait > TICK_RATE ? TICK_RATE : wait) + 2;
        } else {
          const e = Math.min(TARGET_MARGIN - lo, MARGIN_CAP - hi);
          this.dilation = 1 + (e > 2 ? 2 : e < -1 ? -1 : e) * 0.01;
        }
      }
    }

    this.reconcile(tick, sb);
  }

  /** On a mismatch with the body predicted for `tick`, rewinds and replays. */
  private reconcile(tick: number, sb: Body): void {
    if (tick >= this.simTick) {
      // The server is at or past the prediction (join, stall), so adopt its state.
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      return;
    }
    const slot = tick & (HISTORY - 1);
    const predicted = this.bodyTick[slot] === tick;
    if (predicted && this.bodies[slot]!.equals(sb)) return;
    const moved = !predicted || !this.bodies[slot]!.samePosition(sb);
    if (predicted) {
      if (moved) this.stats.corrections++;
      else this.stats.stateCorrections++;
    }
    if (this.simTick - tick >= HISTORY) {
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      return;
    }
    const wasX = this.own.x;
    const wasY = this.own.y;
    const wasZ = this.own.z;
    this.own.copy(sb);
    this.bodies[slot]!.copy(sb);
    this.bodyTick[slot] = tick;
    // Replay. Ticks with no stored input repeat the previous one for as long as the server did, then stop as it did.
    let last = this.inputs.has(tick) ? tick : 0;
    let gap = 0;
    for (let t = tick + 1; t <= this.simTick; t++) {
      if (this.inputs.has(t)) {
        last = t;
        gap = 0;
      } else if (last !== 0) {
        const i = last & this.inputs.mask;
        const held = ++gap <= INPUT_HOLD_TICKS;
        this.inputs.set(t, held ? this.inputs.moveX[i]! : 0, held ? this.inputs.moveZ[i]! : 0, this.inputs.yaw[i]!, this.inputs.pitch[i]!, this.inputs.buttons[i]! & (held ? BUTTON_MASK : INPUT_KEPT));
        last = t;
      } else this.inputs.set(t, 0, 0, Math.round((this.ownYaw / TAU) * YAW_UNITS) & 0xffff, 0, 0);
      if (t === this.simTick) this.ownPrev.copy(this.own);
      this.step(t);
    }
    // Keep drawing from where the body appeared to be, and let that fade. A large jump (a teleport) is shown at once.
    const dx = wasX - this.own.x + this.smoothX;
    const dy = wasY - this.own.y + this.smoothY;
    const dz = wasZ - this.own.z + this.smoothZ;
    if (predicted && dx * dx + dy * dy + dz * dz < SMOOTH_LIMIT * SMOOTH_LIMIT) {
      this.smoothX = dx;
      this.smoothY = dy;
      this.smoothZ = dz;
    } else this.smoothX = this.smoothY = this.smoothZ = 0;
  }

  private chunk(r: BitReader): void {
    const world = this.world;
    if (!world) return;
    const chunk = r.u16();
    const version = r.u32();
    const final = r.bool();
    const count = r.bits(16);
    if (chunk >= world.structs.chunks.length) return;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const kinds = this.registry.defs.length;
    for (let i = 0; i < count; i++) {
      const slot = r.u16();
      const kind = r.u16();
      if (kind === 0) {
        if (!r.overflow) world.structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, version);
        continue;
      }
      const x = x0 + r.bits(15) / STRUCT_UNITS;
      const z = z0 + r.bits(15) / STRUCT_UNITS;
      const y = r.svarint() / STRUCT_UNITS;
      const yaw = r.u16();
      const owner = r.varint();
      const hp = r.f32();
      if (r.overflow || kind >= kinds) return;
      world.structs.put(chunk, slot, kind, x, y, z, yaw, owner, hp, version);
    }
    // Removals follow, each as runs of slots. A row newer than its removal (the slot was reused) is left alone.
    const t = world.structs.chunks[chunk];
    for (let b = r.u8(); b > 0 && !r.overflow; b--) {
      const at = version - r.varint();
      const cause = r.bits(2);
      const told = cause !== GONE_TAKEN;
      const ox = told ? r.f32() : 0;
      const oy = told ? r.f32() : 0;
      const oz = told ? r.f32() : 0;
      const tick = told ? r.u32() : 0;
      let last = 0;
      for (let runs = r.varint(); runs > 0 && !r.overflow; runs--) {
        const first = last + r.svarint();
        const more = r.varint();
        last = first + more + 1;
        if (r.overflow || !t || first < 0) break;
        for (let slot = first; slot <= first + more && slot < t.high; slot++) {
          if (t.kind[slot] === 0 || t.mod[slot]! >= at) continue;
          if (told) {
            if (this.rubble.length >= MAX_RUBBLE_QUEUED) this.rubble.shift();
            this.rubble.push({ kind: t.kind[slot]!, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, cause, ox, oy, oz, tick });
          }
          world.structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, version);
        }
      }
    }
    if (final) world.structs.setVersion(chunk, version);
  }
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Index of the local body among replicated entities, for callers that exclude it. */
export function ownIndex(session: ClientSession): number {
  return handleIndex(session.ownHandle);
}
