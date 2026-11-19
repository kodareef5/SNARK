import { IMPALE_SLOT } from "../../shared/sim/seats.ts";
// One client's connection, with no DOM, clock or socket. The shell or a test supplies a Connection and calls update().
// It runs ahead of the server so input T arrives before tick T, and steers its tick clock to keep the reported margin small and positive.

import { PredictedTrees } from "./vehicle-trees.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { deriveRegistry, parseTuning } from "../../shared/content/tuning.ts";
import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, TICK_RATE, YAW_UNITS, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { handleIndex, makeHandle } from "../../shared/ids.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { BitReader, BitWriter, Named } from "../../shared/net/codec.ts";
import { ContactSnapshot, readContacts } from "../../shared/net/contact.ts";
import { VehiclePrediction } from "./vehicle-prediction.ts";
import { VehicleCorrection } from "./vehicle-correction.ts";
import { newerCorpseMotion, readCorpseMotion, type CorpseMotion } from "../../shared/net/corpse.ts";
import { CMD_CORPSE, S_CORPSE } from "../../shared/net/protocol.ts";
import {
  CMD_TEXT,
  CMD_VIEW,
  BUTTON_MASK,
  HELLO_SPECTATE,
  HELLO_STATICS, HELLO_NEW, HELLO_RESUME,
  INPUT_HOLD_TICKS,
  VEHICLE_HOLD_TICKS,
  INPUT_KEPT,
  INPUT_REDUNDANCY,
  InputBuffer,
  MARGIN_UNKNOWN,
  MAX_CLIENT_MESSAGE,
  MAX_NAME_BYTES,
  MAX_PLACE_NAME_BYTES,
  MAX_SERVER_TEXT_BYTES,
  MAX_TEXT_BYTES,
  CMD_CREATE,
  OWN_BUFFS,
  OWN_RULES,
  RULE_CORPSE_LOCATOR,
  RULE_CREATIVE,
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
  OWN_STATION,
  OWN_PROGRESSION,
  OWN_RESPAWN,
  CHOOSE_ARRIVED,
  CHOOSE_DIED,
  OWN_SESSION,
  OWN_SLOTS,
  OWN_VITALS,
  BOX_SELF,
  PITCH_LIMIT,
  PROTOCOL_VERSION,
  SESSION_ALIVE,
  SESSION_DEAD,
  S_CHUNK,
  S_CHUNK_DROP,
  S_EVENT,
  S_NODES,
  EVENT_DEATH,
  EVENT_HIT,
  EVENT_TAMED,
  OWN_SUBJECT,
  OWN_OVERHEAD,
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
  S_TRAVEL,
  S_MOTION,
  S_WELCOME,
  REJECT_TRAVEL,
  TICKET_BYTES,
  nextCommandSeq,
  readBody,
  writeCommand,
  writeHello,
  PASSENGER_VIEW_DELAY,
  writeInputs,
} from "../../shared/net/protocol.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { readMotions, type MotionState } from "../../shared/sim/motion.ts";
import type { MotionSource } from "./render/motion.ts";
import { TOKEN_BYTES } from "../../shared/voice/packet.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection } from "../../shared/net/transport.ts";
import { EntityView, MAX_VIEW, VIEW_RING, ViewRing, dequantX, dequantY, readViewDelta } from "../../shared/net/view.ts";
import { BTN_JUMP, Body, stanceEye, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { quatNlerp } from "../../shared/math/quat.ts";
import { unpackBoatHullCondition, unpackBoatFlooding, interpolateRotorPhase, unpackVehicleQuaternion, unpackRotorRpm, unpackRotorPhase, unpackVehicleFuel, unpackEngineCondition, unpackRotorCondition, vehicleEngineRunning } from "../../shared/sim/vehicle-presentation.ts";
import { MAX_VEHICLE_DOORS } from "../../shared/sim/vehicle.ts";
import { PredictionTrace } from "./diagnostics.ts";
import { stepVehicleBody, unpackVehiclePitch, unpackVehicleRoll, unpackVehicleSteering, unpackVehicleWheel, unpackVehicleGroundPitch, unpackVehicleGroundRoll, unpackVehicleRideOffset, vehicleRideGrounded, vehicleDoor, withVehicleDoor, unpackVehicleGear, unpackVehicleRpm, vehicleShifting, unpackVehicleLightMode } from "../../shared/sim/vehicle-body.ts";
import { stepCreature } from "../../shared/sim/creature-actions.ts";
import { ACT_NONE, FISTS, actionOut, biteCost, stepAction } from "../../shared/sim/weapon.ts";
import { aimSeed, aimShot, scopeFitted, shotAim, stepAim } from "../../shared/sim/aim.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { staticKinds, type MapLandmark, type MapStatics } from "../../shared/world/mapfile.ts";
import { NodeField, type NodeSource } from "../../shared/world/nodes.ts";
import { GONE_TAKEN, StructureStore } from "../../shared/world/structures.ts";
import { CMD_FAR, CMD_STATICS, RESULT_BUSY, RESULT_OK, S_FAR, S_MARKS, S_TACTICAL } from "../../shared/net/protocol.ts";
import { FarStore } from "./farcells.ts";
import type { FarSource } from "./render/far.ts";
import type { CityMaker } from "./render/citymake.ts";
import type { CitySource } from "./render/farcity.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { NodeChanges, type FarNodeSource } from "./render/farnodes.ts";
import { MapStore } from "./tactical.ts";

export interface SessionOptions {
  intent?: "create" | "resume";
  createRequest?: Uint8Array;
  name: string;
  /** The device key that owns the name, 16 random bytes kept by this client. */
  key: Uint8Array;
  /** Join without a body, if the server allows it. */
  spectate?: boolean;
  /** Content as written. ClientSession.registry holds the server-tuned version after the welcome. */
  registry: Registry;
  password?: string;
  /** Manifest.clipHash, the hash of every clip of the build. The server must pose with the same clips. */
  clipHash?: number;
  /** A look for a new survivor (shared/anim/look.ts). Without one, a new name waits in the creator for `create`. */
  look?: Uint8Array;
  /** A travel ticket: the survivor arrives with it from another server of the cluster (S_TRAVEL). */
  ticket?: Uint8Array;
  /** Returns null if this client does not have the map. */
  resolveMap(mapId: string, mapHash: number, dims: MapDims): Heightfield | null;
  /** The map's resource nodes, from the same pure function the server uses. */
  nodes?(hf: Heightfield, registry: Registry): NodeSource | null;
  /**
   * The map's static pieces by chunk, which the far city draws past the near rows (render/farcity.ts); without it the far
   * city is made of the statics staticsArrived gives. And where its levels are made, here if not given.
   */
  city?(registry: Registry): CityStatics | null;
  cityMaker?: CityMaker;
  /** The statics of the map file resolveMap accepts. With them the server sends a chunk's only where they differ (HELLO_STATICS). */
  statics?: MapStatics;
  /** The landmarks that map file sets down (MapContent). Past the near rows the scene draws each from its far mesh. */
  landmarks?: readonly MapLandmark[];
  tideEyes?: readonly TideEyeSite[];
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
  /** The bodies the server said died, by id, with the tick of the snapshot that said so. Kept for a few seconds. */
  died: ReadonlyMap<number, number> = new Map();
  readonly id = new Uint32Array(MAX_VIEW);
  readonly gen = new Uint16Array(MAX_VIEW);
  readonly kind = new Uint16Array(MAX_VIEW);
  readonly x = new Float32Array(MAX_VIEW);
  readonly y = new Float32Array(MAX_VIEW);
  readonly z = new Float32Array(MAX_VIEW);
  /** Radians. */
  readonly yaw = new Float32Array(MAX_VIEW);
  readonly vehiclePitch = new Float32Array(MAX_VIEW);
  readonly vehicleRoll = new Float32Array(MAX_VIEW);
  readonly steering = new Float32Array(MAX_VIEW);
  readonly wheelAngle = new Float32Array(MAX_VIEW);
  readonly vehicleGroundPitch = new Float32Array(MAX_VIEW);
  readonly vehicleGroundRoll = new Float32Array(MAX_VIEW);
  readonly vehicleRideOffset = new Float32Array(MAX_VIEW);
  readonly vehicleGrounded = new Uint8Array(MAX_VIEW);
  /** Each door's open share, 8 bits a door (shared/sim/vehicle-body.ts vehicleDoor). */
  readonly vehicleDoors = new Uint32Array(MAX_VIEW);
  readonly vehicleGear = new Int8Array(MAX_VIEW);
  readonly vehicleRpm = new Float32Array(MAX_VIEW);
  readonly vehicleLightMode = new Uint8Array(MAX_VIEW);
  readonly vehicleShifting = new Uint8Array(MAX_VIEW);
  readonly vehicleRotorcraft = new Uint8Array(MAX_VIEW);
  readonly vehicleBoat = new Uint8Array(MAX_VIEW);
  readonly vehicleHullCondition = new Float32Array(MAX_VIEW);
  readonly vehicleFlooding = new Float32Array(MAX_VIEW);
  readonly vehicleRotorRpm = new Float32Array(MAX_VIEW);
  readonly vehicleRotorPhase = new Float32Array(MAX_VIEW);
  readonly vehicleFuel = new Float32Array(MAX_VIEW);
  readonly vehicleEngineCondition = new Float32Array(MAX_VIEW);
  readonly vehicleRotorCondition = new Float32Array(MAX_VIEW);
  readonly vehicleEngineOn = new Uint8Array(MAX_VIEW);
  readonly vehicleQx = new Float32Array(MAX_VIEW);
  readonly vehicleQy = new Float32Array(MAX_VIEW);
  readonly vehicleQz = new Float32Array(MAX_VIEW);
  readonly vehicleQw = new Float32Array(MAX_VIEW);
  /** 1 where the vehicle columns hold what a body sent no vehicle parts has, which then need not be written again. */
  readonly bare = new Uint8Array(MAX_VIEW);
  readonly flags = new Uint8Array(MAX_VIEW);
  readonly level = new Uint16Array(MAX_VIEW);
  /** Six colour regions per entity. Zero means the species' own colour. */
  readonly colors = new Uint8Array(MAX_VIEW * 6);
  readonly name: string[] = new Array<string>(MAX_VIEW).fill("");
  /** The moment sampled, in ticks. It may be fractional. */
  tick = 0;
  /** The pose and the cues, packed as the server sent them. See `AnimState.pack` and `packCue`. */
  readonly anim = new Uint32Array(MAX_VIEW);
  readonly cue = new Uint32Array(MAX_VIEW);
  /** LOOK_BYTES each, valid where `hasLook` is 1. */
  readonly look = new Uint8Array(MAX_VIEW * LOOK_BYTES);
  readonly hasLook = new Uint8Array(MAX_VIEW);
  /** GEAR_COUNT content indices each, 0 for nothing. */
  readonly gear = new Uint16Array(MAX_VIEW * GEAR_COUNT);
  /** 1 while the laser in its hand is on (the gear's "on" bit). */
  readonly on = new Uint8Array(MAX_VIEW);
  /** Each 0 for none: the owning team, the entity it sits on plus one, the ticks its growing takes, and the tick it will be grown. */
  readonly team = new Uint32Array(MAX_VIEW);
  readonly seat = new Uint32Array(MAX_VIEW);
  readonly seatSlot = new Uint8Array(MAX_VIEW);
  readonly seatGen = new Uint16Array(MAX_VIEW);
  readonly span = new Uint32Array(MAX_VIEW);
  readonly grown = new Uint32Array(MAX_VIEW);
}

const HISTORY = 128;
/**
 * Remote entities are drawn at least this many ticks behind the render clock, so there are two snapshots to blend between,
 * and further while snapshots come unevenly, up to REMOTE_DELAY_MAX. The server allows for it when it judges a shot (REWIND_SLACK).
 */
export const REMOTE_DELAY = 2;
export const REMOTE_DELAY_MAX = 4;
/** Seconds of how far the render clock ran past the newest snapshot before the next came, that the delay is set from. */
const JITTER_SECONDS = 5;
/** Ticks the client starts ahead of the server before any feedback. */
const INITIAL_LEAD = 4;
/**
 * The clock steers on the margins of the last MARGIN_WINDOW ticks of snapshots: the server should have had at least
 * TARGET_MARGIN inputs in hand each time, and never more than MARGIN_CAP, so that a lossy line does not spend on inputs in
 * hand the rewind a shot may have (REWIND_TICKS).
 */
const TARGET_MARGIN = 1;
const MARGIN_CAP = 5;
/** Ticks more of its sent inputs than the window's least the server may lack before late inputs say the line held them back. */
const STALL_TICKS = 4;
const MARGIN_WINDOW = 90;
const MAX_STEPS_PER_UPDATE = 8;
/** Time constant of the fade that hides a correction, and the largest correction hidden, in metres. */
const SMOOTH_MS = 90;
const SMOOTH_LIMIT = 3;
/** Chunks around the body whose nodes stay filled until the tier says how many (assets/tiers.ts `nodes`). Collision needs one, drawing wants more. */
const NODE_RADIUS = 3;
/**
 * Metres round the body whose ground a prediction may read: what a tick's step reaches, a vehicle's length, and the way
 * from the snapshot a replay starts at, at 250 m/s on a link of 200 ms. Its body is predicted only where every chunk this
 * near holds the map's own ground (shared/world/heightfield.ts), and the page's first frame waits for the sectors it meets.
 */
export const PREDICTED_REACH = 128;
/** Milliseconds with no snapshot past which the game's socket is taken as held back (`behind`): some snapshots' worth. */
export const BEHIND_MS = 300;
/** A view or far request the server was too busy to take is sent again this long after. The server reads either once a second. */
const ASK_AGAIN_MS = 1000;
/**
 * Ticks of snapshots after which a page that sent no input, such as a hidden one that draws no frames, acknowledges by
 * itself. The server reads against an acknowledged view only while it is younger than VIEW_RING, and sends it whole after.
 */
const QUIET_TICKS = 8;
const CLOSED_BY_PEER = -1;
const CLOSED_BAD_MAP = -2;
/** The content this client derives from the server's tuning does not hash to the server's. */
export const CLOSED_BAD_CONTENT = -3;
/** The server speaks another version of the protocol. REJECT_VERSION is the same news from the server's side. */
export const CLOSED_BAD_VERSION = -4;
const LOG_LINES = 200;
/** Ticks a death the server told of is kept for the bodies drawn behind it. */
const DIED_KEPT = 2 * TICK_RATE;

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
  /** The side harm came from, as a facing in 256ths of a turn, if `side`; a silenced shot's is not told (Silencer Attachment). */
  bearing: number;
  side: boolean;
  /** A shot from a weapon with a silencer: no flash is drawn. */
  silenced: boolean;
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
   * velocity and `back` the ticks since it left. If not, (vx, vy, vz) is where it ended; for a shot of more than one ray
   * (`rays`, a shotgun's pellets) it is the aim's yaw and pitch in wire units and its cone in degrees, and each ray is
   * shotDir(`seed`, k, ...) of shared/sim/aim.ts.
   */
  flies: boolean;
  vx: number;
  vy: number;
  vz: number;
  back: number;
  rays: number;
  seed: number;
}

/** A predicted shot of this client's own, from its eye. yaw and pitch are in input units. */
export interface LocalShot {
  x: number;
  y: number;
  z: number;
  /** Where the shot was pointed, with its kick and sway, in wire units, and its cone in degrees and seed (shared/sim/aim.ts). */
  yaw: number;
  pitch: number;
  cone: number;
  seed: number;
  draw: number;
  ammo: number;
  /** The weapon's content index: its rays a shot are shotRays of it and the ammunition. */
  weapon: number;
}

export interface TextLine {
  channel: number;
  text: string;
}

export class ClientSession {
  state: "connecting" | "active" | "closed" = "connecting";
  /** Reject reason from the server, or a negative local reason. */
  closeReason = 0;
  /** What the server said of a REJECT_TRAVEL. */
  closeText = "";
  /** The survivor left for another server of the cluster: the ticket to take there, and that server's world id (S_TRAVEL). */
  travelled: { ticket: Uint8Array; world: number } | null = null;

  /** Every moving static's state as the server last told it (S_MOTION), by ref: all after a welcome, then each as it is thrown. */
  readonly motions = new Map<number, MotionState>();
  /** Sparse exact launch/resume state, keyed by generation-qualified entity handle. Kept across packet/snapshot ordering. */
  readonly corpseMotions = new Map<number, CorpseMotion>();
  private corpseRetryAt = -TICK_RATE;
  private readonly motionSource: MotionSource = { states: () => this.motions, tick: () => this.tickClock, statics: () => this.arrived ?? this.opts.statics ?? null };
  world: (CollisionWorld & { mapId: string; dims: MapDims; far: FarSource; farNodes?: FarNodeSource; city?: CitySource; motion?: MotionSource; tideEyes?: readonly TideEyeSite[]; landmarks?: readonly MapLandmark[] }) | null = null;
  /** Handle of the local entity, or 0 while there is none (spectating, dead). */
  ownHandle = 0;
  ownKind = 0;
  /** Index of the entity its inputs drive in place of its own body, or -1. */
  driving = -1;

  /** Species of the predicted body: the survivor's own, or its mount's. */
  get bodyKind(): number {
    return this.own.kind !== 0 ? this.own.kind : this.ownKind;
  }
  /** A seat may stow the held item without changing its inventory slot. */
  get weaponsAllowed(): boolean {
    if (this.driving >= 0) return !this.registry.vehicle[this.own.kind];
    const b = this.own;
    if (!b.seat || !b.seatSlot) return true;
    if (b.seatSlot === IMPALE_SLOT) return false;
    const view = this.views.find(this.latestSnapshot);
    if (!view) return false;
    const parent = b.seat - 1;
    for (let i = 0; i < view.count; i++) if (view.id[i] === parent && view.gen[i] === b.seatGen) {
      return this.registry.vehicle[view.kind[i]!]?.seats[b.seatSlot - 1]?.weapons !== false;
    }
    return false;
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
  /** It came from another server of the cluster and chooses where to rise, as the server says (CHOOSE_ARRIVED). */
  get arriving(): boolean {
    return this.sessionState === SESSION_DEAD && this.choosing === CHOOSE_ARRIVED;
  }
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
  /** The server shows creative mode: the menu has a Creative entry. Whether its tools work is the admin role's to say. */
  creative = false;
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
  /** Presentation-time carrier, current own pose. Installed by App; false retains the bootstrap capsule fallback. */
  shotOrigin: ((out: Float64Array, tick: number, yaw: number, pitch: number) => boolean) | null = null;
  private readonly shotEye = new Float64Array(3);
  private firedTick = 0;
  /** Oldest first. Shots.absorb takes the shots and blasts, then Feedback.absorb empties it. */
  readonly events: CombatEvent[] = [];
  /** Creatures just tamed, waiting for the naming prompt. te is in percent. */
  readonly tamed: { handle: number; kind: number; level: number; te: number }[] = [];
  /** The creature whose inventory is open, or null when the open container is not a creature. Shares are 0 to 1. */
  subject: { taming: boolean; owned: boolean; level: number; progress: number; te: number; torpor: number; food: number; id: number; points: number; stance: number; following: boolean; wandering: boolean; saddled: boolean; breeds: boolean; mating: boolean; female: boolean; stage: number; maturity: number; mate: number; wait: number } | null = null;
  /** What the server tells of the creature the survivor looks at (OWN_OVERHEAD), or null. Shares are 0 to 1, or -1 where it tells nothing. */
  looked: { id: number; health: number; food: number; torpor: number; taming: number; te: number; mating: number; tribe: string } | null = null;
  inventory: Inventory | null = null;
  open: { name: string; inventory: Inventory } | null = null;
  /**
   * The open container when it is a crafting station (OWN_STATION), or null. `kind` is the station's structure kind and `ref`
   * the structure; `out` the tick its fire is due to go out (0 when it does not burn); `lanes` what its fire makes by itself,
   * each unit done at `doneAt` (0 while it waits); `jobs` its queue, a unit paused for want of fuel with `rest` ticks left.
   */
  station: { kind: number; ref: number; out: number; lanes: { item: number; doneAt: number }[]; jobs: { item: number; left: number; doneAt: number; rest: number }[] } | null = null;
  /** Oldest first. */
  readonly markers: { kind: number; x: number; y: number; z: number; tick: number }[] = [];
  /**
   * While the survivor has no body: the map's spawn points, then its tribe's beds. `kind` is the bed's structure kind (0 for a
   * spawn point), `readyAt` the tick it may be risen at from (0 for now). `choosing` says why (CHOOSE_), and `placesList` is the
   * list's number, which a choice names.
   */
  readonly respawnPoints: { kind: number; name: string; x: number; z: number; readyAt: number }[] = [];
  choosing = CHOOSE_DIED;
  placesList = 0;
  /** The map beyond the view: structure cells and marks, as the server sends them. */
  readonly tactical = new MapStore();
  /** Every tribe's structures beyond the view, within the reach `askFar` names, for drawing and never for the map. */
  readonly far = new FarStore();
  /** Per chunk, 1 once its last row has come since it was last dropped: the near store holds it whole. */
  private whole = new Uint8Array(0);
  /** The map's statics, come after the session began (staticsArrived). */
  private arrived: MapStatics | null = null;
  private heldCity: CityStatics | null = null;
  /** The command that told the server of them (CMD_STATICS), until its answer. */
  private staticsSeq = 0;
  /** The map's statics' kinds as content indices, from the welcome or CMD_STATICS's answer, when the client takes chunks from them. */
  private staticKinds: Uint16Array | null = null;
  private readonly kinds = new Named();
  private readonly yaws = new Named();
  private readonly owners = new Named();
  readonly progress = { xp: 0, level: 1, statPoints: 0, engramPoints: 0, engrams: [] as number[], jobs: [] as { item: number; left: number; doneAt: number }[], version: 0 };
  /** Resource nodes around the body, filled from the map minus those the server reports used up. */
  nodeField: NodeField | null = null;
  private vehicleTrees: PredictedTrees | null = null;
  get predictedTrees(): PredictedTrees | null { return this.vehicleTrees; }
  private treeDriver = 0;
  private nodeChunk = -1;
  private nodeRadius = NODE_RADIUS;
  /** The chunks the near node field holds for the body, and the ground's changes when they were chosen. */
  private nodeHeld: number[] = [];
  private nodeSeen = -1;
  private readonly nodeGone = new Map<number, number[]>();
  private readonly nodeCrushed = new Map<number, number[]>();
  /** Chunks whose used-up nodes were told, for the far nodes. */
  private nodeChanges: NodeChanges | null = null;
  /** Bodies the server said died, by id, and the ids one snapshot said so of. */
  private readonly died = new Map<number, number>();
  private readonly dying: number[] = [];
  onResult: ((seq: number, code: number) => void) | null = null;
  /**
   * Told of each structure row a snapshot changes in a chunk already whole: its kind before and after (0 where there is
   * none), where, its health before and after, and for a removal its GONE_ cause (else -1). For sound only.
   */
  onStructure: ((was: number, kind: number, x: number, y: number, z: number, hpWas: number, hp: number, cause: number) => void) | null = null;
  /** A witnessed depletion/regrowth in a known chunk. Crushed trees leave no stump; initial join state emits no effects. */
  onNode: ((chunk: number, index: number, used: boolean, crushed: boolean, form?: number) => void) | null = null;
  /** Predicted local body after the latest simulated tick; while its ground is not held, the body the server last told. */
  readonly own = new Body();
  /** The ground within PREDICTED_REACH of the body is the map's own and its nodes held, so the body is predicted on it. */
  predicting = false;
  /** Settles once the welcome has come or the session has closed. */
  readonly welcomed: Promise<void>;
  private welcomedNow!: () => void;
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
  /** How many ticks behind the render clock remote entities are drawn: further while snapshots come unevenly. */
  remoteDelay = REMOTE_DELAY;
  /** The tick sampleRemote last drew remote entities at, which is what was on screen when the next input is sampled. 0 before the first. */
  shown = 0;
  latestSnapshot = 0;
  /** The frame clock, in ms, when the newest snapshot was taken in; -1 before the first. */
  private snapshotAt = -1;

  /**
   * `corrections` counts snapshots that moved the predicted body. `stateCorrections` counts those that changed only other
   * predicted state. `transitions` counts those that changed which body it is or where it sits (a mount, a seat), which
   * nothing predicts and are not counted as either. `unsent` counts commands too long for a message.
   */
  readonly stats = { snapshots: 0, undecodable: 0, corrections: 0, stateCorrections: 0, transitions: 0, clockJumps: 0, margin: 0, rttTicks: 0, bytesIn: 0, unsent: 0, unheld: 0 };
  readonly prediction = new PredictionTrace();
  /** What is left to hide of the last correction. Add it to the body's position when drawing. */
  smoothX = 0;
  smoothY = 0;
  smoothZ = 0;
  readonly vehicleCorrection = new VehicleCorrection();
  vehicleContacts: VehiclePrediction | null = null;
  private readonly contactSnapshot = new ContactSnapshot();
  private readonly contactBefore = new Body();

  private readonly conn: Connection;
  private readonly opts: SessionOptions;
  private move: MoveParams | null = null;
  private readonly inputs = new InputBuffer(HISTORY);
  /** Buttons seen down on any frame since the last tick was sampled. */
  private tapped = 0;
  private readonly bodies: Body[] = [];
  private readonly bodyTick = new Uint32Array(HISTORY);
  private readonly rotorQuatA = new Float64Array(4);
  private readonly rotorQuatB = new Float64Array(4);
  private readonly rotorQuat = new Float64Array(4);
  private readonly views = new ViewRing(() => new EntityView());
  /** What is drawn after each snapshot: every body as it was last told of. `views` are what deltas are read against. */
  private readonly drawn = new ViewRing(() => new EntityView());
  private readonly w = new BitWriter(MAX_CLIENT_MESSAGE);
  private readonly r = new BitReader();
  private readonly serverBody = new Body();
  /** The body the server last told while it was not predicted, that prediction starts again from. */
  private readonly told = new Body();
  private readonly passengerCompared = new Body();
  private lastNow = -1;
  private dilation = 1;
  private guardTick = 0;
  /** The furthest the render clock ran past the newest snapshot before the next came, in each of the last few seconds, and which second each is. */
  private readonly ahead = new Float32Array(8);
  private readonly aheadAt = new Int32Array(8).fill(-1);
  /** A frame came late, and the render clock has not yet come back to the snapshots. */
  private hitch = false;
  /**
   * The margins reported, by their snapshot's tick, and how many inputs this client had sent past the newest the server had
   * then, as each came (NaN where the margin is a bound).
   */
  private readonly margins = new Int8Array(128);
  private readonly marginAt = new Uint32Array(128);
  private readonly marginHeld = new Float32Array(128);
  private needFull = true;
  /** The newest input sent, and the snapshot it acknowledged. */
  private sentInput = 0;
  private sentAck = 0;
  private commandSeq = 0;
  /** What `view` and `askFar` last asked the server for, and the commands that asked. After the server refuses one, neither is sent before `askAt`. */
  private viewCap = 0;
  private viewBytes = 0;
  private viewSeq = 0;
  private farAsked = -1;
  private farSeq = 0;
  private askAt = -Infinity;

  constructor(conn: Connection, opts: SessionOptions) {
    this.registry = opts.registry;
    this.name = opts.name;
    this.conn = conn;
    this.opts = opts;
    this.welcomed = new Promise((go) => (this.welcomedNow = go));
    for (let i = 0; i < HISTORY; i++) this.bodies.push(new Body());
    conn.onMessage = (channel, data) => this.receive(channel, data);
    conn.onClose = () => {
      if (this.state !== "closed") {
        this.state = "closed";
        this.closeReason = CLOSED_BY_PEER;
      }
      this.welcomedNow();
    };
    const w = this.w;
    writeHello(w, PROTOCOL_VERSION, (opts.registry.source ?? opts.registry).hash, opts.clipHash ?? 0, opts.name, (opts.intent === "create" ? HELLO_NEW : opts.intent === "resume" ? HELLO_RESUME : 0) | (opts.spectate ? HELLO_SPECTATE : 0) | (opts.statics ? HELLO_STATICS : 0), opts.key, opts.look ?? null, opts.password ?? "", opts.ticket ?? null,opts.createRequest);
    conn.send(CH_RELIABLE, w.bytes());
  }

  /** `args` appends the op's arguments. Returns the sequence number, or 0 if nothing was sent. Commands are not predicted or resent. */
  command(op: number, args?: (w: BitWriter) => void): number {
    // The server expects sequence numbers without gaps, so an unsent command uses none.
    if (this.state !== "active") return 0;
    const seq = nextCommandSeq(this.commandSeq);
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

  /** A stalled/resumed renderer asks for current visible corpse state instead of replaying an unbounded old fall. */
  requestCorpseMotions(wanted: ReadonlySet<number>): void {
    if (wanted.size === 0 || this.tickClock - this.corpseRetryAt < TICK_RATE) return;
    const ids: number[] = [];
    for (const id of wanted) { ids.push(id); if (ids.length === 8) break; }
    if (this.command(CMD_CORPSE, w => { w.u8(ids.length); for (const id of ids) w.u32(id); })) this.corpseRetryAt = this.tickClock;
  }

  /**
   * Asks to be shown at most `cap` entities, in snapshots of at most `bytes`. Sent when either changes, and again when the
   * server was too busy to take it. The server holds both to its limits.
   */
  view(cap: number, bytes: number): void {
    if ((cap === this.viewCap && bytes === this.viewBytes) || this.lastNow < this.askAt) return;
    const seq = this.command(CMD_VIEW, (w) => (w.u16(cap), w.u16(bytes)));
    if (seq === 0) return;
    this.viewCap = cap;
    this.viewBytes = bytes;
    this.viewSeq = seq;
  }

  /** Asks for far cells within `metres`. Sent when it changes, and again when the server was too busy to take it. The server holds it to its FarRadius. */
  askFar(metres: number): void {
    const m = Math.max(0, Math.min(0xffff, Math.round(metres)));
    if (m === this.farAsked || this.lastNow < this.askAt) return;
    const seq = this.command(CMD_FAR, (w) => w.u16(m));
    if (seq === 0) return;
    this.farAsked = m;
    this.farSeq = seq;
  }

  create(look: Uint8Array, spawn?: number): number {
    return this.command(CMD_CREATE, (w) => {
      for (let i = 0; i < LOOK_BYTES; i++) w.u8(look[i] ?? 0);
      if (spawn !== undefined) w.u8(spawn);
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
    const frameMs = dt;
    this.lastNow = nowMs;
    if (this.arrived && !this.staticKinds && this.staticsSeq === 0) this.staticsSeq = this.command(CMD_STATICS);
    if (dt > 100) this.hitch = true;
    if (dt > 250) dt = 250;
    const ticks = (dt / 1000) * TICK_RATE;
    this.tickClock += ticks * this.dilation;
    this.renderClock += ticks;
    this.followJitter(ticks);
    this.vehicleCorrection.update(dt);
    this.vehicleContacts?.update(dt);
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
    this.holdGround();
    const target = Math.floor(this.tickClock);
    let steps = 0;
    while (this.simTick < target && steps < MAX_STEPS_PER_UPDATE) {
      const t = ++this.simTick;
      steps++;
      this.inputs.set(t, qx, qz, qyaw, qpitch, this.tapped | buttons);
      this.tapped = 0;
      this.ownPrev.copy(this.own);
      if (this.predicting) this.step(t);
      else this.stats.unheld++;
    }
    // Too far behind to catch up by simulating, so skip. The server held the last input meanwhile.
    const newestInput = this.simTick;
    this.prediction.frame(frameMs, steps, Math.max(0, target - newestInput));
    if (this.simTick < target) this.simTick = target;
    if (steps > 0) {
      this.sendInputs(newestInput, steps);
      this.recenterNodes();
    }
  }

  /** Where its living body is and how it moves, or null before the welcome, while dead or choosing, and watching. */
  get place(): { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number } | null {
    return this.state === "active" && this.sessionState === SESSION_ALIVE && this.ownHandle !== 0 ? this.own : null;
  }

  /**
   * Whether the body is predicted from here on: the near node field takes the chunks whose ground has come, and the body
   * is predicted while all within PREDICTED_REACH hold the map's own ground. Where they do not it is drawn as the server
   * last told it, and where they come to, its prediction starts again from that.
   */
  private holdGround(): void {
    this.recenterNodes();
    const held = this.groundHeld();
    if (held && !this.predicting && this.latestSnapshot > 0 && this.latestSnapshot < this.simTick) {
      this.predicting = true;
      this.told.copy(this.own);
      this.reconcile(this.latestSnapshot, this.told);
    }
    this.predicting = held;
  }

  private groundHeld(): boolean {
    const b = this.own, r = PREDICTED_REACH;
    return this.world?.hf.exactIn(b.x - r, b.z - r, b.x + r, b.z + r) ?? false;
  }

  /** Fill `out` with remote entities interpolated to the current render time. */
  sampleRemote(out: RemoteSample, delayTicks = this.remoteDelay): void {
    out.count = 0;
    out.died = this.died;
    const renderAt = this.renderClock - delayTicks;
    const at = this.own.seat && this.driving < 0 ? Math.max(renderAt, this.latestSnapshot - PASSENGER_VIEW_DELAY) : renderAt;
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
    if (!b) {
      // Nothing newer has come: everyone stands as the newest snapshot has them, and that is the moment drawn.
      b = a;
      if (a) out.tick = this.shown = a.tick;
    }
    if (!b) return;
    const k = a && a !== b ? (at - a.tick) / (b.tick - a.tick) : 1;
    let i = 0;
    const na = a ? a.count : 0;
    for (let j = 0; j < b.count; j++) {
      const id = b.id[j]!;
      while (i < na && a!.id[i]! < id) i++;
      const n = out.count++;
      out.id[n] = id;
      out.gen[n] = b.gen[j]!;
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
      out.on[n] = b.on[j]!;
      for (let q = 0; q < 6; q++) out.colors[n * 6 + q] = b.colors[j * 6 + q]!;
      out.team[n] = b.team[j]!;

      out.span[n] = b.span[j]!;
      out.grown[n] = b.grown[j]!;
      const both = a !== b && i < na && a!.id[i] === id && a!.gen[i] === b.gen[j];
      const sameSeat = both && a!.seat[i] === b.seat[j] && a!.seatGen[i] === b.seatGen[j] && a!.seatSlot[i] === b.seatSlot[j];
      const attachment = both && k < .5 ? a! : b, attachmentRow = attachment === a ? i : j;
      out.seat[n] = attachment.seat[attachmentRow]!; out.seatSlot[n] = attachment.seatSlot[attachmentRow]!; out.seatGen[n] = attachment.seatGen[attachmentRow]!;
      const vehicle = this.registry.vehicle[b.kind[j]!];
      if (vehicle || hasVehicleParts(b, j) || (both && hasVehicleParts(a!, i))) {
        this.vehicleColumns(out, n, b, j, both ? a : null, i, k, vehicle?.movement);
        out.bare[n] = 0;
      } else if (out.bare[n] === 0) {
        noVehicle(out, n);
        out.bare[n] = 1;
      }
      if (both && sameSeat) {
        out.x[n] = dequantX(a!.qx[i]! + (b.qx[j]! - a!.qx[i]!) * k);
        out.y[n] = dequantY(a!.qy[i]! + (b.qy[j]! - a!.qy[i]!) * k);
        out.z[n] = dequantX(a!.qz[i]! + (b.qz[j]! - a!.qz[i]!) * k);
        let turn = b.yaw[j]! - a!.yaw[i]!;
        if (turn > 512) turn -= 1024;
        else if (turn < -512) turn += 1024;
        out.yaw[n] = ((a!.yaw[i]! + turn * k) * TAU) / 1024;
        // The pose is not blended. It comes from the nearer snapshot.
        out.anim[n] = k < 0.5 ? a!.anim[i]! : b.anim[j]!;
        out.cue[n] = k < 0.5 ? a!.cue[i]! : b.cue[j]!;
      } else {
        out.anim[n] = attachment.anim[attachmentRow]!;
        out.cue[n] = attachment.cue[attachmentRow]!;
        out.x[n] = dequantX(attachment.qx[attachmentRow]!);
        out.y[n] = dequantY(attachment.qy[attachmentRow]!);
        out.z[n] = dequantX(attachment.qz[attachmentRow]!);
        out.yaw[n] = (attachment.yaw[attachmentRow]! * TAU) / 1024;
      }
      if (this.predicting && this.driving >= 0 && this.registry.vehicle[this.own.kind]) this.vehicleContacts?.draw(out, n, Math.max(0, Math.min(1, this.tickClock - this.simTick)), this.simTick);
    }
  }

  /** The vehicle columns of `out` at `n`, from entity `j` of `b`, blended with entity `i` of `a` where it is given. */
  private vehicleColumns(out: RemoteSample, n: number, b: EntityView, j: number, a: EntityView | null, i: number, k: number, movement: string | undefined): void {
    const vehiclePose = b.vehiclePose[j]!;
    out.vehiclePitch[n] = unpackVehiclePitch(vehiclePose);
    out.vehicleRoll[n] = unpackVehicleRoll(vehiclePose);
    out.steering[n] = unpackVehicleSteering(vehiclePose);
    out.wheelAngle[n] = unpackVehicleWheel(b.vehicleWheel[j]!);
    const ride = b.vehicleRide[j]!;
    out.vehicleGroundPitch[n] = unpackVehicleGroundPitch(ride);
    out.vehicleGroundRoll[n] = unpackVehicleGroundRoll(ride);
    out.vehicleRideOffset[n] = unpackVehicleRideOffset(ride);
    out.vehicleGrounded[n] = vehicleRideGrounded(ride) ? 1 : 0;
    out.vehicleDoors[n] = b.vehicleDoors[j]!;
    out.vehicleRotorcraft[n] = movement === "rotor" ? 1 : 0;
    out.vehicleBoat[n] = movement === "boat" ? 1 : 0;
    out.vehicleHullCondition[n] = unpackBoatHullCondition(b.vehicleWater[j]!);
    out.vehicleFlooding[n] = unpackBoatFlooding(b.vehicleWater[j]!);
    const rotor = b.vehicleRotor[j]!, systems = b.vehicleSystems[j]!;
    out.vehicleRotorRpm[n] = unpackRotorRpm(rotor); out.vehicleRotorPhase[n] = unpackRotorPhase(rotor);
    out.vehicleFuel[n] = unpackVehicleFuel(systems); out.vehicleEngineCondition[n] = unpackEngineCondition(systems);
    out.vehicleRotorCondition[n] = unpackRotorCondition(systems); out.vehicleEngineOn[n] = vehicleEngineRunning(systems) ? 1 : 0;
    unpackVehicleQuaternion(b.vehicleAttitudeA[j]!, b.vehicleAttitudeB[j]!, this.rotorQuat);
    const drive = b.vehicleDrive[j]!;
    out.vehicleGear[n] = unpackVehicleGear(drive);
    out.vehicleRpm[n] = unpackVehicleRpm(drive);
    out.vehicleShifting[n] = vehicleShifting(drive) ? 1 : 0;
    out.vehicleLightMode[n] = unpackVehicleLightMode(drive);
    if (a) {
      if (b.vehicleAttitudeA[j] || b.vehicleAttitudeB[j]) {
        unpackVehicleQuaternion(a.vehicleAttitudeA[i]!, a.vehicleAttitudeB[i]!, this.rotorQuatA);
        this.rotorQuatB.set(this.rotorQuat);
        quatNlerp(this.rotorQuat, 0, this.rotorQuatA, 0, this.rotorQuatB, 0, k);
      }
      if (out.vehicleRotorcraft[n]) {
        const oldRotor = a.vehicleRotor[i]!, rpm = unpackRotorRpm(oldRotor);
        out.vehicleRotorPhase[n] = interpolateRotorPhase(unpackRotorPhase(oldRotor), unpackRotorPhase(rotor), rpm, out.vehicleRotorRpm[n]!, (b.tick - a.tick) / TICK_RATE, k);
        out.vehicleRotorRpm[n] = rpm + (out.vehicleRotorRpm[n]! - rpm) * k;
      }
      const oldPose = a.vehiclePose[i]!;
      out.vehiclePitch[n] = unpackVehiclePitch(oldPose) + (out.vehiclePitch[n]! - unpackVehiclePitch(oldPose)) * k;
      out.vehicleRoll[n] = unpackVehicleRoll(oldPose) + (out.vehicleRoll[n]! - unpackVehicleRoll(oldPose)) * k;
      out.steering[n] = unpackVehicleSteering(oldPose) + (out.steering[n]! - unpackVehicleSteering(oldPose)) * k;
      const oldRide = a.vehicleRide[i]!;
      out.vehicleGroundPitch[n] = unpackVehicleGroundPitch(oldRide) + (out.vehicleGroundPitch[n]! - unpackVehicleGroundPitch(oldRide)) * k;
      out.vehicleGroundRoll[n] = unpackVehicleGroundRoll(oldRide) + (out.vehicleGroundRoll[n]! - unpackVehicleGroundRoll(oldRide)) * k;
      out.vehicleRideOffset[n] = unpackVehicleRideOffset(oldRide) + (out.vehicleRideOffset[n]! - unpackVehicleRideOffset(oldRide)) * k;
      out.vehicleGrounded[n] = vehicleRideGrounded(k < .5 ? oldRide : ride) ? 1 : 0;
      let doors = 0;
      for (let d = 0; d < MAX_VEHICLE_DOORS; d++) {
        const was = vehicleDoor(a.vehicleDoors[i]!, d);
        doors = withVehicleDoor(doors, d, was + (vehicleDoor(b.vehicleDoors[j]!, d) - was) * k);
      }
      out.vehicleDoors[n] = doors;
      const oldDrive = a.vehicleDrive[i]!;
      out.vehicleGear[n] = unpackVehicleGear(k < .5 ? oldDrive : drive);
      out.vehicleRpm[n] = unpackVehicleRpm(oldDrive) + (out.vehicleRpm[n]! - unpackVehicleRpm(oldDrive)) * k;
      out.vehicleShifting[n] = vehicleShifting(k < .5 ? oldDrive : drive) ? 1 : 0;
      const oldWheel = unpackVehicleWheel(a.vehicleWheel[i]!);
      let wheelTurn = out.wheelAngle[n]! - oldWheel;
      wheelTurn -= Math.floor((wheelTurn + TAU / 2) / TAU) * TAU;
      out.wheelAngle[n] = out.vehicleBoat[n]
        ? interpolateRotorPhase(oldWheel, out.wheelAngle[n]!, unpackVehicleRpm(oldDrive) * unpackVehicleGear(oldDrive), unpackVehicleRpm(drive) * unpackVehicleGear(drive), (b.tick - a.tick) / TICK_RATE, k)
        : oldWheel + wheelTurn * k;
    }
    out.vehicleQx[n] = this.rotorQuat[0]!; out.vehicleQy[n] = this.rotorQuat[1]!;
    out.vehicleQz[n] = this.rotorQuat[2]!; out.vehicleQw[n] = this.rotorQuat[3]!;
  }

  close(): void {
    this.state = "closed";
    this.conn.close();
    this.welcomedNow();
  }

  /**
   * How far the render clock ran past the newest snapshot before snapshot `tick` came. After a long frame the render clock
   * runs ahead of the snapshots until it is pulled back, and that is not an uneven line.
   */
  private noteGap(tick: number): void {
    const gap = this.renderClock - this.latestSnapshot;
    if (this.hitch) {
      this.hitch = gap > 1.5;
      return;
    }
    const second = Math.floor(tick / TICK_RATE);
    const k = second & 7;
    if (this.aheadAt[k] !== second) {
      this.aheadAt[k] = second;
      this.ahead[k] = gap;
    } else if (gap > this.ahead[k]!) this.ahead[k] = gap;
  }

  /**
   * Draws remote entities far enough behind that the newest snapshot was ahead of them at every moment of the last few
   * seconds. The delay grows quickly and shrinks slowly, so what is drawn never jumps.
   */
  private followJitter(ticks: number): void {
    const second = Math.floor(this.latestSnapshot / TICK_RATE);
    let most = 0;
    for (let i = 0; i < 8; i++) if (this.aheadAt[i]! > second - JITTER_SECONDS && this.ahead[i]! > most) most = this.ahead[i]!;
    // Half a tick more than the furthest, within the bounds. It moves a tenth of a tick a tick when growing, a hundredth when shrinking.
    const want = most + 0.5 < REMOTE_DELAY ? REMOTE_DELAY : most + 0.5 > REMOTE_DELAY_MAX ? REMOTE_DELAY_MAX : most + 0.5;
    const d = this.remoteDelay;
    this.remoteDelay = want > d ? Math.min(want, d + ticks * 0.1) : Math.max(want, d - ticks * 0.01);
  }

  private step(t: number, pilot = true): void {
    const i = t & this.inputs.mask;
    const inp = this.inputs;
    const buttons = inp.buttons[i]!;
    // The body steps with the move parameters of the kind the server last sent: its own species, or its mount's once tamed.
    const vehicle = this.registry.vehicle[this.own.kind];
    const combat = this.registry.combat[this.own.kind];
    const was = inp.has(t - 1) ? inp.buttons[(t - 1) & inp.mask]! : 0;
    if (vehicle) {
      this.contactBefore.copy(this.own);
      this.vehicleTrees?.begin(t, this.treeDriver);
      stepVehicleBody(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, buttons, vehicle, TICK_DT, inp.yaw[i]!, pilot, this.vehicleTrees ?? undefined);
      this.vehicleContacts?.step(t, this.contactBefore, this.own, vehicle);
    }
    // Any vehicle seat slot other than 0 holds the body still, as the server does (server/game.ts).
    else if (combat && this.driving >= 0) stepCreature(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, inp.yaw[i]!, inp.pitch[i]!, buttons, buttons & ~was, this.registry.tamedMove[this.own.kind] ?? this.move!, combat, TICK_DT, true, !pilot);
    else if (this.own.seatSlot === 0) stepBody(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, inp.yaw[i]!, inp.pitch[i]!, buttons, this.registry.tamedMove[this.own.kind] ?? this.move!, TICK_DT);
    else { this.own.yaw = inp.yaw[i]!; this.own.jetThrust = 0; }
    if (this.driving >= 0) {
      // A mount's bite is stepped here as the server steps it, so both agree on the body's action.
      const jaws = this.registry.weapon[this.own.kind];
      if (jaws && !vehicle && !combat) {
        const was = inp.has(t - 1) ? inp.buttons[(t - 1) & inp.mask]! : 0;
        stepAction(this.own, buttons, buttons & ~was, jaws);
        biteCost(this.own, this.registry.biteStamina[this.own.kind]!);
      }
      this.bodies[t & (HISTORY - 1)]!.copy(this.own);
      this.bodyTick[t & (HISTORY - 1)] = t;
      return;
    }
    // The action step takes the same buttons as the server's, and those that went down since the tick before.
    const before = inp.has(t - 1) ? inp.buttons[(t - 1) & inp.mask]! : 0;
    const armed = this.weaponsAllowed;
    if (!armed) { this.own.act = ACT_NONE; this.own.actTicks = 0; }
    const w = armed ? this.registry.weapon[this.own.held] ?? FISTS : FISTS;
    stepAction(this.own, armed ? buttons : 0, armed ? buttons & ~before : 0, w);
    stepAim(this.own, w, t);
    // A replay after a correction steps old ticks again, so a shot is noted only on a tick's first step.
    if (actionOut.fire && t > this.firedTick) {
      this.firedTick = t;
      const inv = this.inventory;
      const slot = inv && inv.hotbar >= 0 && this.held >= 0 ? inv.hotbar + this.held : -1;
      const ammo = slot >= 0 ? inv!.ammo[slot]! : 0;
      // It leaves where the server will send it: the look with its kick, sway and cone, from the same body and seed.
      aimShot(this.own, buttons, w, this.registry.tamedMove[this.own.kind] ?? this.move!, inp.yaw[i]!, inp.pitch[i]!, scopeFitted(this.registry, inv, slot), this.ownHandle, t);
      if (ammo !== 0 && this.fired.length < 16) {
        const eye = this.shotEye;
        eye[0] = this.own.x; eye[1] = this.own.y + stanceEye(this.move!, this.own.stance); eye[2] = this.own.z;
        this.shotOrigin?.(eye, t, inp.yaw[i]! * TAU / 65536, inp.pitch[i]! * Math.PI / 32768);
        this.fired.push({ x: eye[0]!, y: eye[1]!, z: eye[2]!, yaw: shotAim.yaw, pitch: shotAim.pitch, cone: shotAim.cone, seed: aimSeed(this.ownHandle, t), draw: actionOut.draw, ammo, weapon: inv!.item[slot]! });
      }
    }
    this.bodies[t & (HISTORY - 1)]!.copy(this.own);
    this.bodyTick[t & (HISTORY - 1)] = t;
  }

  private sendInputs(newest: number, sampled: number): void {
    // Every freshly sampled tick must be sent, including a short tap at the start of a catch-up frame.
    // The existing wire count holds eight ticks, the same bound as one update's simulation work.
    let count = 1;
    while (count < Math.max(INPUT_REDUNDANCY, sampled) && this.inputs.has(newest - count)) count++;
    const w = this.w;
    w.reset();
    // The last argument is how far behind the newest snapshot remote entities were drawn when the newest input was sampled.
    writeInputs(w, this.inputs, this.needFull ? 0 : this.latestSnapshot, newest, count, this.latestSnapshot - (this.shown > 0 ? this.shown : this.renderClock - this.remoteDelay));
    this.conn.send(CH_UNRELIABLE, w.bytes());
    [this.sentInput, this.sentAck] = [newest, this.latestSnapshot];
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
    else if (type === S_CHUNK_DROP) {
      const chunk = r.u16();
      this.whole[chunk] = 0;
      this.world?.structs.dropChunk(chunk);
    }
    else if (type === S_NODES) this.nodes(r);
    else if (type === S_EVENT) this.event(r);
    else if (type === S_TACTICAL && this.world) this.tactical.readCells(r, this.world.hf);
    else if (type === S_MARKS && this.world) this.tactical.readMarks(r, this.world.hf);
    else if (type === S_FAR && this.world) this.far.read(r, this.world.dims);
    else if (type === S_WELCOME) this.welcome(r);
    else if (type === S_RESULT) {
      const seq = r.u16();
      const code = r.u8();
      if (r.overflow) return;
      if (seq !== 0 && seq === this.staticsSeq) {
        if (code === RESULT_OK) this.staticKinds = staticKinds(this.arrived!, this.registry);
        else if (code === RESULT_BUSY) this.staticsSeq = 0;
      }
      // The newest view or far request, refused, is forgotten so that it is asked again.
      if (code === RESULT_BUSY && seq !== 0 && (seq === this.viewSeq || seq === this.farSeq)) {
        if (seq === this.viewSeq) this.viewCap = this.viewBytes = -1;
        else this.farAsked = -1;
        this.askAt = this.lastNow + ASK_AGAIN_MS;
      }
      this.onResult?.(seq, code);
    } else if (type === S_TEXT) {
      const channel = r.u8();
      const text = r.string(MAX_SERVER_TEXT_BYTES);
      if (r.overflow) return;
      this.log.push({ channel, text });
      if (this.log.length > LOG_LINES) this.log.shift();
      this.logVersion++;
    } else if (type === S_OWN) this.ownState(r);
    else if (type === S_MOTION) {
      const told = readMotions(r);
      if (told) for (const [ref, s] of told) this.motions.set(ref, s);
    }
    else if (type === S_CORPSE) {
      const motion = readCorpseMotion(r);
      if (motion && newerCorpseMotion(motion, this.corpseMotions.get(motion.id))) {
        this.corpseMotions.delete(motion.id);
        while (this.corpseMotions.size >= MAX_VIEW) this.corpseMotions.delete(this.corpseMotions.keys().next().value!);
        this.corpseMotions.set(motion.id, motion);
      }
    }
    else if (type === S_REJECT) {
      this.state = "closed";
      this.closeReason = r.u8();
      if (this.closeReason === REJECT_TRAVEL) this.closeText = r.string(MAX_SERVER_TEXT_BYTES);
      this.welcomedNow();
    } else if (type === S_TRAVEL) {
      const ticket = new Uint8Array(TICKET_BYTES);
      for (let i = 0; i < TICKET_BYTES; i++) ticket[i] = r.u8();
      const world = r.u16();
      if (!r.overflow) this.travelled = { ticket, world };
    }
  }

  /** The used-up nodes of a chunk. Applied now if the chunk is filled, and remembered for when it is. */
  private nodes(r: BitReader): void {
    const chunk = r.u16();
    r.u32();
    const count = r.u16();
    const gone: number[] = [];
    const crushed: number[] = [];
    for (let k = 0; k < count; k++) { const slot = r.u8(); gone.push(slot); if (r.bool()) crushed.push(slot); }
    const field = this.nodeField;
    if (r.overflow || !field) return;
    const known = this.nodeGone.has(chunk);
    const before = this.nodeGone.get(chunk) ?? [];
    const oldCrushed = this.nodeCrushed.get(chunk) ?? [];
    this.nodeGone.set(chunk, gone);
    this.nodeCrushed.set(chunk, crushed);
    for (const i of before) if (!gone.includes(i)) {
      field.set(chunk, i, true);
      if (known) this.onNode?.(chunk, i, false, false);
    }
    for (const i of gone) if (!before.includes(i) || oldCrushed.includes(i) !== crushed.includes(i)) {
      const form = field.store.chunks[chunk]?.kind[i];
      field.set(chunk, i, false, crushed.includes(i));
      if (known) this.onNode?.(chunk, i, true, crushed.includes(i), form);
    }
    this.vehicleTrees?.confirm(chunk, gone, crushed);
    this.nodeChanges?.touch(chunk);
  }

  /** The near node field holds `chunks` round the body's chunk from now on, as the tier says. */
  holdNodes(chunks: number): void {
    if (chunks === this.nodeRadius) return;
    this.nodeRadius = chunks;
    this.nodeSeen = -1;
    this.recenterNodes();
  }

  /**
   * The near node field holds the chunks round the body's chunk whose ground is the map's own: a node there is placed as
   * the server places it. Each is taken before those left are let go, so a chunk in both stays filled.
   */
  private recenterNodes(): void {
    const field = this.nodeField;
    const world = this.world;
    if (!field || !world) return;
    const { dims, hf } = world;
    const chunk = chunkAt(dims, this.own.x, this.own.z);
    if (chunk === this.nodeChunk && hf.changes.length === this.nodeSeen) return;
    [this.nodeChunk, this.nodeSeen] = [chunk, hf.changes.length];
    const gone = (c: number, i: number): boolean => this.nodeGone.get(c)?.includes(i) ?? false;
    const [cx, cz, r] = [chunkCx(dims, chunk), chunkCz(dims, chunk), this.nodeRadius];
    const held: number[] = [];
    for (let z = Math.max(0, cz - r); z <= Math.min(dims.chunksZ - 1, cz + r); z++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(dims.chunksX - 1, cx + r); x++) {
        const c = z * dims.chunksX + x;
        if (hf.exact[c] === 0) continue;
        if (!this.nodeHeld.includes(c)) field.retain(c, 0, 1, gone, undefined, (chunk, index) => this.nodeCrushed.get(chunk)?.includes(index) ?? false);
        held.push(c);
      }
    }
    for (const c of this.nodeHeld) if (!held.includes(c)) field.retain(c, 0, -1, gone);
    this.nodeHeld = held;
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
      // A survivor with a body has no places to choose among. The list of the next spell without one follows this message.
      if (state !== SESSION_DEAD) {
        this.respawnPoints.length = 0;
        this.choosing = CHOOSE_DIED;
      }
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
        // Flags (SLOT_ bits): a blueprint.
        const flags = item === 0 ? 0 : r.u8();
        const dur = item === 0 ? 0 : r.u16();
        const spoilAt = item === 0 ? 0 : r.u32();
        const holds = item !== 0 && r.bool();
        const ammo = holds ? r.u16() : 0;
        const loaded = holds ? r.u8() : 0;
        const attach = holds ? r.u16() : 0;
        if (r.overflow || slot >= cap) return;
        inv.set(slot, item, n, quality, dur, spoilAt, flags);
        if (holds) inv.setGear(slot, ammo, loaded, attach);
      }
    } else if (component === OWN_SUBJECT) {
      if (!r.bool()) this.subject = null;
      else {
        const next = { taming: r.bool(), owned: r.bool(), level: r.u16(), progress: r.bits(10) / 1000, te: r.bits(10) / 1000, torpor: r.bits(10) / 1000, food: r.bits(10) / 1000, id: r.u32(), points: r.u8(), stance: r.bits(2), following: r.bool(), wandering: r.bool(), saddled: r.bool(), breeds: r.bool(), mating: r.bool(), female: r.bool(), stage: r.bits(2), maturity: r.bits(10) / 1000, mate: r.bits(10) / 1000, wait: r.varint() };
        if (!r.overflow) this.subject = next;
      }
    } else if (component === OWN_OVERHEAD) {
      if (!r.bool()) this.looked = null;
      else {
        const share = (): number => (r.bool() ? r.bits(10) / 1000 : -1);
        const id = r.u32();
        const [health, food, torpor] = [share(), share(), share()];
        const tamed = r.bool();
        const taming = tamed ? r.bits(10) / 1000 : -1;
        const te = tamed ? r.bits(10) / 1000 : -1;
        const mating = share();
        const tribe = r.bool() ? r.string(MAX_NAME_BYTES * 3) : "";
        if (!r.overflow) this.looked = { id, health, food, torpor, taming, te, mating, tribe };
      }
    } else if (component === OWN_STATION) {
      const kind = r.u16();
      const ref = r.u32();
      const out = r.u32();
      const lanes: { item: number; doneAt: number }[] = [];
      for (let k = r.u8(); k > 0 && !r.overflow; k--) lanes.push({ item: r.u16(), doneAt: r.u32() });
      const jobs: { item: number; left: number; doneAt: number; rest: number }[] = [];
      for (let k = r.u8(); k > 0 && !r.overflow; k--) jobs.push({ item: r.u16(), left: r.u8(), doneAt: r.u32(), rest: r.u32() });
      if (!r.overflow) this.station = kind === 0 ? null : { kind, ref, out, lanes, jobs };
    } else if (component === OWN_OPEN) {
      // A station's queue comes after it is opened.
      this.station = null;
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
      this.creative = (flags & RULE_CREATIVE) !== 0;
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
      const why = r.u8();
      const number = r.u8();
      const count = r.u8();
      const list = [];
      for (let k = 0; k < count; k++) list.push({ kind: r.u16(), name: r.string(MAX_PLACE_NAME_BYTES), x: r.f32(), z: r.f32(), readyAt: r.u32() });
      if (r.overflow) return;
      this.choosing = why;
      this.placesList = number;
      this.respawnPoints.length = 0;
      this.respawnPoints.push(...list);
    }
  }

  /**
   * Whether the game's socket is held back: no snapshot has come for BEHIND_MS of the frame clock while the session
   * plays, as when what the page fetches besides takes the link. That fetching holds back then (Residency.holdBack, the
   * map's loader), so the game's own packets come first.
   */
  get behind(): boolean {
    return this.state === "active" && this.snapshotAt >= 0 && this.lastNow - this.snapshotAt > BEHIND_MS;
  }

  /** The client's estimate of the server tick, for evaluating vitals and spoil clocks. */
  get serverTick(): number {
    return Math.floor(this.renderClock);
  }

  private event(r: BitReader): void {
    const kind = r.u8();
    const ev: CombatEvent = { kind, x: 0, y: 0, z: 0, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0, side: false, silenced: false, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0, rays: 1, seed: 0 };
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
      // Protocol 13: rays and seed (W3), and whether its weapon has a silencer (W7).
      ev.rays = r.u8();
      ev.seed = r.u32();
      ev.silenced = r.bool();
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
      // Protocol 13: whether the side is shown. A silenced shot's is not.
      ev.side = r.bool();
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
    this.motions.clear(); this.corpseMotions.clear(); this.corpseRetryAt = -TICK_RATE;
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
    const fills = r.bool();
    const refuse = (reason: number): void => {
      this.state = "closed";
      this.closeReason = reason;
      this.conn.close();
      this.welcomedNow();
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
    this.nodeField = source ? new NodeField(dims, reg, source) : null;
    this.nodeGone.clear(); this.nodeCrushed.clear();
    [this.nodeChunk, this.nodeSeen, this.nodeHeld] = [-1, -1, []];
    this.whole = new Uint8Array(dims.chunksX * dims.chunksZ);
    this.staticKinds = fills && this.opts.statics ? staticKinds(this.opts.statics, reg) : null;
    this.staticsSeq = 0;
    const far: FarSource = { cells: this.far, complete: (chunk) => this.whole[chunk] === 1 };
    const field = this.nodeField;
    this.nodeChanges = field ? new NodeChanges(dims) : null;
    const nodes = field ? { nodes: field.store, farNodes: { nodes: field.source, held: (c: number) => field.isLoaded(c), gone: (c: number) => this.nodeGone.get(c), changes: this.nodeChanges!, city: () => this.world?.city?.statics ?? this.nodeCity(), ground: hf } } : {};
    // The file's dims, which say where the map sits on the lattice as the welcome's do not.
    this.world = { mapId, tideEyes: this.opts.tideEyes, dims: hf.dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), far, ...nodes, ...(reg.motion.some((t) => t !== null) ? { motion: this.motionSource } : {}), ...(this.opts.landmarks?.length ? { landmarks: this.opts.landmarks } : {}) };
    this.vehicleTrees = field ? new PredictedTrees(this.world, reg, field) : null;
    this.startCity(this.arrived);
    this.vehicleContacts = new VehiclePrediction(this.world, reg, field ? () => new PredictedTrees(this.world!, reg, field) : undefined, this.vehicleTrees ?? undefined);
    this.recenterNodes();
    this.move = move;
    this.ownPrev.copy(this.own);
    this.ownYaw = (yaw * TAU) / YAW_UNITS;
    this.tickClock = tick + INITIAL_LEAD;
    this.simTick = tick + INITIAL_LEAD;
    this.renderClock = tick;
    this.state = "active";
    this.predicting = this.groundHeld();
    this.welcomedNow();
  }

  /**
   * Call when map statics arrive after the session began: those of the sectors round the body first, `whole` false, which
   * the far city starts with, and then the whole map's, which it is made again of and the server is told of, so that from
   * its answer on it sends a chunk's statics only where they differ from them (CMD_STATICS).
   */
  staticsArrived(statics: MapStatics, whole = true): void {
    const steps = this.staticsSteps(statics, whole);
    while (!steps.next().done);
  }

  /**
   * staticsArrived a step at a time (CityStatics.steps), for a page that lets frames go between them: what it changes of
   * this session and its world is changed at the last step.
   */
  *staticsSteps(statics: MapStatics, whole = true): Generator<void, void> {
    const world = this.world, reg = this.registry;
    const city = world && !this.opts.city ? yield* CityStatics.steps(world.dims, statics, reg) : null;
    if (whole) this.arrived = statics;
    this.startCity(statics, true, world === this.world && reg === this.registry ? city : null);
  }

  /**
   * The map's statics for the far nodes' tops where this session draws no far city of them (it was given them at its
   * hello): the server sends no far cells of a chunk still as the map placed it to a session that holds them.
   */
  private nodeCity(): CityStatics | null {
    if (!this.staticKinds || !this.world) return null;
    return (this.heldCity ??= new CityStatics(this.world.dims, (this.arrived ?? this.opts.statics)!, this.registry));
  }

  /** The far city of `statics`, `made` where it is made already, where the world has none or, `again`, in place of the one it has. */
  private startCity(statics: MapStatics | null, again = false, made: CityStatics | null = null): void {
    const world = this.world;
    if (!world || (world.city && !again)) return;
    const city = this.opts.city?.(this.registry) ?? made ?? (statics ? new CityStatics(world.dims, statics, this.registry) : null);
    if (city && city.count > 0) world.city = { statics: city, complete: world.far.complete, maker: this.opts.cityMaker };
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
    if (!readContacts(r, this.contactSnapshot, tick, this.world?.hf.sizeX, this.world?.hf.sizeZ)) { this.stats.undecodable++; return; }
    this.snapshotAt = this.lastNow;

    const base = age > 0 ? this.views.find(tick - age) : null;
    if (age > 0 && !base) {
      // Encoded against a view this client no longer has. Ask for a full one.
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    const next = this.views.alloc(tick);
    const drawn = this.drawn.alloc(tick);
    const dying = this.dying;
    dying.length = 0;
    if (!readViewDelta(r, base, next, this.drawn.find(this.latestSnapshot), drawn, dying) || r.overflow) {
      next.tick = drawn.tick = 0;
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    // A death is told again until a snapshot that told it is acknowledged, so the first telling is the one kept.
    for (const id of dying) if (!this.died.has(id)) this.died.set(id, tick);
    for (const [id, at] of this.died) if (tick - at > DIED_KEPT) this.died.delete(id);
    if (this.latestSnapshot > 0) this.noteGap(tick);
    this.latestSnapshot = tick;
    this.needFull = false;
    this.sessionState = state;
    this.driving = driving;
    this.treeDriver = 0;
    for (let i = 0; i < next.count; i++) if (next.id[i] === driving) { this.treeDriver = makeHandle(driving, next.gen[i]!); break; }
    this.stats.snapshots++;
    // The inputs sent again are ones the server has, so this says only which snapshot came.
    if (this.sentInput > 0 && tick - this.sentAck >= QUIET_TICKS) this.sendInputs(this.sentInput, 1);

    // Render clock follows the newest server tick, smoothly unless far off.
    const lag = tick - this.renderClock;
    if (lag > 6 || lag < -6) this.renderClock = tick;
    else this.renderClock += lag * 0.1;

    // Until an input of its own reaches the server there is no margin to steer by. A page that stalled as it joined, a
    // great landmark's files coming, is behind the server by then and samples no input at all, so it would never have
    // one: its input clock starts again ahead of this snapshot, as at the welcome.
    if (margin === MARGIN_UNKNOWN && this.tickClock < tick) this.tickClock = tick + INITIAL_LEAD;
    // The input clock keeps the server's margin near the target, once the server has one to report. A stall that held
    // inputs back lowers the least margin for a few seconds and speeds the clock gently; it is not a reason to jump.
    if (margin !== MARGIN_UNKNOWN) {
      this.stats.margin = margin;
      // At either end of its range the margin is a bound, not a measurement.
      const bound = margin <= -127 || margin >= 127;
      if (!bound) this.stats.rttTicks = this.simTick - tick - margin;
      if (this.simTick >= this.guardTick) {
        this.margins[tick & 127] = margin;
        this.marginAt[tick & 127] = tick;
        this.marginHeld[tick & 127] = bound ? NaN : this.sentInput - tick - margin;
        // The least and most of the window, and of its last quarter second; the fewest inputs in flight of the window, and
        // the most of its last quarter second.
        let lo = 127;
        let hi = -127;
        let nowLo = 127;
        let nowHi = -127;
        let n = 0;
        let least = Infinity;
        let most = -Infinity;
        for (let i = 0; i < 128; i++) {
          if (this.marginAt[i] === 0 || this.marginAt[i]! + MARGIN_WINDOW <= tick) continue;
          const m = this.margins[i]!;
          if (m < lo) lo = m;
          if (m > hi) hi = m;
          if (this.marginHeld[i]! < least) least = this.marginHeld[i]!;
          if (this.marginAt[i]! + 8 > tick) {
            if (m < nowLo) nowLo = m;
            if (m > nowHi) nowHi = m;
            if (this.marginHeld[i]! > most) most = this.marginHeld[i]!;
            n++;
          }
        }
        // Far off is every input late for a quarter second, or every one early. That moves the best of them, or the worst, to
        // the target. Late inputs the client did not send, a page stopped or a clock behind, are a reason to jump. Late
        // inputs it sent that the line holds back are not: then the server lacks more of those sent than it did, as it
        // never does while it lacks only those not sent.
        const behind = n >= 4 && nowHi < 0 && !(most > least + STALL_TICKS);
        if (behind || (n >= 4 && nowLo >= TARGET_MARGIN + 7)) {
          this.marginAt.fill(0);
          this.tickClock += TARGET_MARGIN - (behind ? nowHi : nowLo);
          this.dilation = 1;
          this.stats.clockJumps++;
          // Simulated far past the new time. Waiting for the clock would freeze the player, so start again here.
          // The next snapshot supplies the body. Short of that, the inputs already sent stand, and the server's margin is
          // the newest of them until one past them is sent on the new clock.
          const at = Math.floor(this.tickClock);
          let from = Math.max(at, this.sentInput);
          if (this.simTick - at > TICK_RATE) {
            this.simTick = from = at;
            this.bodyTick.fill(0);
            this.inputs.tick.fill(0);
          }
          // Ignore feedback until snapshots can reflect this jump. That is a round trip, capped at a second
          // because the estimate is unreliable just after a jump.
          const wait = Math.ceil(this.stats.rttTicks);
          this.guardTick = from + (wait < 0 ? 0 : wait > TICK_RATE ? TICK_RATE : wait) + 2;
        } else {
          const e = Math.min(TARGET_MARGIN - lo, MARGIN_CAP - hi);
          this.dilation = 1 + (e > 2 ? 2 : e < -1 ? -1 : e) * 0.01;
        }
      }
    }

    const discontinuity = this.vehicleContacts?.accept(this.contactSnapshot, sb, this.simTick, this.alpha);
    this.reconcile(tick, sb);
    if (discontinuity) {
      this.smoothX = this.smoothY = this.smoothZ = 0;
      this.vehicleCorrection.reset();
    }
    this.vehicleContacts?.finishReplay(this.alpha);
  }

  /** On a mismatch with the body predicted for `tick`, rewinds and replays. */
  private reconcile(tick: number, sb: Body): void {
    this.vehicleTrees?.acknowledge(tick);
    const passenger = this.driving < 0 && sb.seatSlot !== 0 && sb.seat > 0;
    if (tick >= this.simTick) {
      // The server is at or past the prediction (join, stall), so adopt its state.
      this.vehicleContacts?.beginReplay(this.alpha);
      this.prediction.adopt(tick, this.simTick);
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      this.vehicleCorrection.reset();
      // This is the state AFTER tick, so no later update may step tick (or an earlier one) again.
      // Keep the input clock's elapsed time: moving its clock here would add the stalled interval twice.
      this.simTick = tick;
      const slot = tick & (HISTORY - 1);
      this.bodies[slot]!.copy(sb);
      this.bodyTick[slot] = tick;
      return;
    }
    if (!this.predicting) {
      // Drawn from snapshots, as nothing is predicted.
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      this.smoothX = this.smoothY = this.smoothZ = 0;
      this.vehicleCorrection.reset();
      return;
    }
    const slot = tick & (HISTORY - 1);
    const predicted = this.bodyTick[slot] === tick;
    let compared = this.bodies[slot]!;
    const pinned = passenger && predicted && compared.seat === sb.seat && compared.seatSlot === sb.seatSlot && compared.seatGen === sb.seatGen;
    if (pinned) {
      // The host owns passenger movement. Look, weapon actions, ammo, bloom and recoil still predict normally.
      this.passengerCompared.copy(compared);
      compared = this.passengerCompared;
      compared.x = sb.x; compared.y = sb.y; compared.z = sb.z;
      compared.vx = sb.vx; compared.vy = sb.vy; compared.vz = sb.vz;
      compared.grounded = sb.grounded;
    }
    const matches = predicted && compared.equals(sb);
    // Even an exact own-body baseline can have newer target facts that change the future replay.
    const replayContacts = this.registry.vehicle[sb.kind] && this.vehicleContacts?.needsReplay;
    if (matches && !passenger && !replayContacts) return;
    if (predicted && !matches && this.prediction.enabled) {
      const i = tick & this.inputs.mask;
      this.prediction.record(tick, this.simTick, this.stats.margin, this.driving, compared, sb,
        [this.inputs.moveX[i]!, this.inputs.moveZ[i]!, this.inputs.buttons[i]!, this.inputs.yaw[i]!, this.inputs.pitch[i]!]);
    }
    const moved = !predicted || !compared.samePosition(sb);
    // The server changed which body this is or where it sits (a mount, a seat, getting out, being pulled out), or what the
    // vehicle it drives carries (someone getting in or out of it, its hold changed). Nothing
    // predicts when the server commits one, so it is no misprediction; it is taken as told and shown at once.
    const changed = predicted && (compared.kind !== sb.kind || compared.vehicle !== sb.vehicle || compared.seat !== sb.seat || compared.seatSlot !== sb.seatSlot || compared.seatGen !== sb.seatGen || compared.vehiclePayloadMass !== sb.vehiclePayloadMass);
    if (predicted && !matches) {
      if (changed) this.stats.transitions++;
      else if (moved) this.stats.corrections++;
      else this.stats.stateCorrections++;
    }
    if (this.simTick - tick >= HISTORY) {
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      this.smoothX = this.smoothY = this.smoothZ = 0;
      this.vehicleCorrection.reset();
      return;
    }
    const vehicle = !!this.registry.vehicle[this.own.kind];
    const alpha = vehicle ? this.alpha : 1;
    const wasX = this.ownPrev.x + (this.own.x - this.ownPrev.x) * alpha;
    const wasY = this.ownPrev.y + (this.own.y - this.ownPrev.y) * alpha;
    const wasZ = this.ownPrev.z + (this.own.z - this.ownPrev.z) * alpha;
    // Replay can replace both render endpoints. Preserve the actual interpolated pose visible this frame.
    this.vehicleCorrection.capture(this.own, this.ownPrev, alpha);
    this.vehicleContacts?.beginReplay(this.alpha);
    this.own.copy(sb);
    this.bodies[slot]!.copy(sb);
    this.bodyTick[slot] = tick;
    // Replay. Ticks with no stored input repeat the previous one for as long as the server did, then stop as it did.
    let last = this.inputs.has(tick) ? tick : 0;
    let gap = 0;
    for (let t = tick + 1; t <= this.simTick; t++) {
      let pilot = true;
      if (this.inputs.has(t)) {
        last = t;
        gap = 0;
      } else if (last !== 0) {
        const i = last & this.inputs.mask;
        // Past the hold the server stops a quiet car on its handbrake (server/game.ts); replay the same.
        const vehicle = this.registry.vehicle[this.own.kind];
        const held = ++gap <= (vehicle && this.driving >= 0 ? VEHICLE_HOLD_TICKS : INPUT_HOLD_TICKS);
        const quiet = vehicle ? (vehicle.movement === "rotor" ? 0 : BTN_JUMP) : this.inputs.buttons[i]! & INPUT_KEPT;
        pilot = held;
        this.inputs.set(t, held ? this.inputs.moveX[i]! : 0, held ? this.inputs.moveZ[i]! : 0, this.inputs.yaw[i]!, this.inputs.pitch[i]!, held ? this.inputs.buttons[i]! & BUTTON_MASK : quiet);
        last = t;
      } else this.inputs.set(t, 0, 0, Math.round((this.ownYaw / TAU) * YAW_UNITS) & 0xffff, 0, 0);
      if (t === this.simTick) this.ownPrev.copy(this.own);
      this.step(t, pilot);
    }
    // Replaying a seated body only steps look/action/aim. Its spatial state is the latest authoritative pin;
    // rendering attaches it to the interpolated host, so it needs no independent correction fade.
    if (passenger || changed) { this.smoothX = this.smoothY = this.smoothZ = 0; this.vehicleCorrection.reset(); return; }
    // Keep drawing from where the body appeared to be, and let that fade. A large jump (a teleport) is shown at once.
    const dx = wasX - (this.ownPrev.x + (this.own.x - this.ownPrev.x) * alpha) + this.smoothX;
    const dy = wasY - (this.ownPrev.y + (this.own.y - this.ownPrev.y) * alpha) + this.smoothY;
    const dz = wasZ - (this.ownPrev.z + (this.own.z - this.ownPrev.z) * alpha) + this.smoothZ;
    const smoothLimit = vehicle ? 12 : SMOOTH_LIMIT;
    if (predicted && dx * dx + dy * dy + dz * dz < smoothLimit * smoothLimit) {
      this.smoothX = dx;
      this.smoothY = dy;
      this.smoothZ = dz;
    } else this.smoothX = this.smoothY = this.smoothZ = 0;
    this.vehicleCorrection.reconcile(this.own, vehicle && predicted && dx * dx + dy * dy + dz * dz < smoothLimit * smoothLimit, this.ownPrev, alpha);
  }

  private chunk(r: BitReader): void {
    const world = this.world;
    if (!world) return;
    const chunk = r.u16();
    const version = r.u32();
    const final = r.bool();
    const count = r.bits(16);
    if (chunk >= world.structs.chunks.length) return;
    const structs = world.structs;
    const statics = this.staticKinds ? (this.arrived ?? this.opts.statics)! : null;
    const maxHp = this.registry.maxHp;
    if (statics && statics.first[chunk + 1]! > statics.first[chunk]! && r.bool()) {
      // Slots the server has as the map has them, set down from this client's own copy of the map.
      const first = r.u16();
      const n = r.u16();
      const at = statics.first[chunk]! + first;
      if (r.overflow || at + n > statics.first[chunk + 1]!) return;
      for (let m = at; m < at + n; m++) {
        const kind = this.staticKinds![statics.kind[m]!]!;
        structs.put(chunk, m - at + first, kind, statics.x[m]!, statics.y[m]!, statics.z[m]!, statics.yaw[m]!, 0, maxHp[kind]!, version);
      }
    }
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const kinds = this.registry.defs.length;
    const told = this.onStructure && this.whole[chunk] === 1 ? this.onStructure : null;
    const rows = structs.chunks[chunk];
    this.kinds.reset();
    this.yaws.reset();
    this.owners.reset();
    let slot = -1;
    let height = 0;
    for (let i = 0; i < count; i++) {
      slot += r.bool() ? 1 : r.varint() + 2;
      const inPlace = r.bool();
      const kind = inPlace ? 0 : this.kinds.read(r, 16);
      if (r.overflow || slot > 0xffff || kind >= kinds) return;
      const was = rows && slot < rows.high ? rows.kind[slot]! : 0;
      const hpWas = was !== 0 ? rows!.hp[slot]! : 0;
      if (inPlace) {
        const owner = this.owners.read(r, 0);
        const hp = r.bool() ? maxHp[was]! : r.f32();
        if (r.overflow) return;
        if (was === 0) continue;
        if (told && hpWas !== Math.fround(hp)) told(was, was, rows!.x[slot]!, rows!.y[slot]!, rows!.z[slot]!, hpWas, hp, -1);
        structs.put(chunk, slot, was, rows!.x[slot]!, rows!.y[slot]!, rows!.z[slot]!, rows!.yaw[slot]!, owner, hp, version);
        continue;
      }
      if (kind === 0) {
        if (told && was !== 0) told(was, 0, rows!.x[slot]!, rows!.y[slot]!, rows!.z[slot]!, hpWas, 0, GONE_TAKEN);
        structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, version);
        continue;
      }
      const x = x0 + r.bits(15) / STRUCT_UNITS;
      const z = z0 + r.bits(15) / STRUCT_UNITS;
      if (!r.bool()) height += r.svarint();
      const yaw = this.yaws.read(r, 16);
      const owner = this.owners.read(r, 0);
      const hp = r.bool() ? maxHp[kind]! : r.f32();
      if (r.overflow) return;
      const y = height / STRUCT_UNITS;
      if (told && (was !== kind || hpWas !== Math.fround(hp))) told(was, kind, x, y, z, hpWas, hp, -1);
      structs.put(chunk, slot, kind, x, y, z, yaw, owner, hp, version);
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
          this.onStructure?.(t.kind[slot]!, 0, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.hp[slot]!, 0, cause);
          if (told) {
            if (this.rubble.length >= MAX_RUBBLE_QUEUED) this.rubble.shift();
            this.rubble.push({ kind: t.kind[slot]!, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, cause, ox, oy, oz, tick });
          }
          world.structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, version);
        }
      }
    }
    if (!final) return;
    world.structs.setVersion(chunk, version);
    this.whole[chunk] = 1;
  }
}

/** Whether entity `j` of a view was sent any vehicle part. */
function hasVehicleParts(v: EntityView, j: number): boolean {
  return (v.vehiclePose[j]! | v.vehicleWheel[j]! | v.vehicleRide[j]! | v.vehicleDoors[j]! | v.vehicleDrive[j]! | v.vehicleRotor[j]! | v.vehicleSystems[j]! | v.vehicleAttitudeA[j]! | v.vehicleAttitudeB[j]! | v.vehicleWater[j]!) !== 0;
}

/** The vehicle columns of a body that is no vehicle and was sent no vehicle part: each part as it unpacks from 0 (vehicleColumns). */
function noVehicle(out: RemoteSample, n: number): void {
  out.vehiclePitch[n] = 0; out.vehicleRoll[n] = 0; out.steering[n] = 0; out.wheelAngle[n] = 0;
  out.vehicleGroundPitch[n] = 0; out.vehicleGroundRoll[n] = 0; out.vehicleRideOffset[n] = 0; out.vehicleGrounded[n] = 0;
  out.vehicleDoors[n] = 0; out.vehicleRotorcraft[n] = 0; out.vehicleBoat[n] = 0;
  out.vehicleHullCondition[n] = 1; out.vehicleFlooding[n] = 0;
  out.vehicleRotorRpm[n] = 0; out.vehicleRotorPhase[n] = 0; out.vehicleFuel[n] = 0; out.vehicleEngineCondition[n] = 0; out.vehicleRotorCondition[n] = 0; out.vehicleEngineOn[n] = 0;
  out.vehicleLightMode[n] = 0; out.vehicleGear[n] = -1; out.vehicleRpm[n] = 0; out.vehicleShifting[n] = 0;
  out.vehicleQx[n] = 0; out.vehicleQy[n] = 0; out.vehicleQz[n] = 0; out.vehicleQw[n] = 1;
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Index of the local body among replicated entities, for callers that exclude it. */
export function ownIndex(session: ClientSession): number {
  return handleIndex(session.ownHandle);
}
