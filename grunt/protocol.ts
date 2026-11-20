// The grunt protocol, version 0 (draft): the messages of protocol.md as types. The spec is the authority; these
// follow it. Nothing here depends on Pi or on the game, so a game, a mock server or a test can import it as is.

export const GRUNT_VERSION = 0;

/** `[x, y, z]` in metres, in the game's `frame`. */
export type Vec3 = [number, number, number];
/** A vital as `[value, max]`. */
export type Gauge = [number, number];
export type EntityId = string;

interface Envelope<T extends string> {
  grunt: typeof GRUNT_VERSION;
  type: T;
  id?: string;
  re?: string;
}

/** Messages that carry a place in the connection's one order. */
interface Sequenced {
  seq: number;
  tick: number;
  /** The game's clock, in milliseconds. */
  t: number;
}

// --- Connecting ---------------------------------------------------------------------------------------------------

export interface Hello extends Envelope<"hello"> {
  versions: number[];
  client: { name: string; version: string };
  /** Game-defined; `name` is the character's name where the method has one. */
  auth: { method: string; name?: string; [field: string]: unknown };
  resume?: { session: string; last_seq: number };
}

export interface Frame {
  units: "m";
  up: string;
  east: string;
  south: string;
}

export interface Capabilities {
  channels: ChannelName[];
  controls: ControlName[];
  events: string[];
  verbs: string[];
}

export interface Limits {
  max_duration_ms: number;
  leash_ms: number;
  max_rate_hz: number;
  act_per_s: number;
  command_memory_s: number;
}

export interface Welcome extends Envelope<"welcome"> {
  session: string;
  seq: number;
  game: { name: string; version: string; world?: string };
  character: { id: EntityId; name: string; alive: boolean };
  frame: Frame;
  capabilities: Capabilities;
  limits: Limits;
}

export interface Refused extends Envelope<"refused"> {
  code: "auth" | "version" | "full" | "banned" | "content" | (string & {});
  reason: string;
  retry: boolean;
}

// --- Observing ----------------------------------------------------------------------------------------------------

export type ChannelName = "self" | "entities" | "terrain" | "inventory" | "chat" | "focus" | "image";

export interface ChannelOptions {
  hz?: number;
  radius?: number;
  max?: number;
  heights?: boolean;
  width?: number;
  height?: number;
}

export type ChannelRequest = Partial<Record<ChannelName, ChannelOptions>>;

export interface Observe extends Envelope<"observe"> {
  channels: ChannelRequest;
}

export interface Subscribe extends Envelope<"subscribe"> {
  channels: ChannelRequest;
  /** Event kinds, or `["*"]` for all. */
  events?: string[];
}

export interface Subscribed extends Envelope<"subscribed"> {
  channels: ChannelRequest;
}

export interface Unsubscribe extends Envelope<"unsubscribe"> {
  channels?: ChannelName[];
  events?: string[];
}

export interface SelfChannel {
  id: EntityId;
  name: string;
  alive: boolean;
  pos: Vec3;
  /** Radians, 0 north, clockwise from above. */
  yaw: number;
  /** Radians, 0 level, positive up. */
  pitch: number;
  vel: Vec3;
  on: "ground" | "water" | "air" | "mount" | "vehicle";
  vitals: Record<string, Gauge>;
  held: { item: string; slot: number; uses?: Gauge | null } | null;
  mount: EntityId | null;
  status: string[];
  level?: number;
}

export type EntityKind =
  | "creature" | "player" | "resource" | "item" | "structure" | "container" | "vehicle" | "projectile" | "other";

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  type: string;
  name?: string | null;
  pos: Vec3;
  distance: number;
  /** Radians relative to facing: 0 ahead, positive right, in (−π, π]. */
  bearing: number;
  vel?: Vec3;
  /** A fraction, only where the player's interface shows it. */
  health?: number;
  disposition?: "hostile" | "neutral" | "friendly" | "own";
  tags?: string[];
  affords: string[];
}

export interface EntitiesChannel {
  items: Entity[];
  more: number;
}

export interface TerrainChannel {
  cell: number;
  /** The north-west corner as `[x, z]`. */
  origin: [number, number];
  /** Columns and rows. */
  size: [number, number];
  /** North to south; each string west to east. */
  rows: string[];
  legend: Record<string, string>;
  heights: number[] | null;
}

export interface Slot {
  slot: number;
  item: string;
  count: number;
  uses?: Gauge | null;
}

export interface InventoryChannel {
  slots: Slot[];
  capacity: number;
  weight: Gauge;
  hotbar: (number | null)[];
  open: { id: EntityId; slots: Slot[] } | null;
}

export interface ChatLine {
  channel: "local" | "global" | "group" | (string & {});
  from: string;
  from_id?: EntityId;
  text: string;
  t: number;
}

export interface ChatChannel {
  lines: ChatLine[];
}

export interface FocusChannel {
  target: EntityId | null;
  distance?: number;
  verbs?: string[];
}

export interface ImageChannel {
  mime: string;
  width: number;
  height: number;
  data: string;
}

export interface Channels {
  self: SelfChannel;
  entities: EntitiesChannel;
  terrain: TerrainChannel;
  inventory: InventoryChannel;
  chat: ChatChannel;
  focus: FocusChannel;
  image: ImageChannel;
}

export interface Observation extends Envelope<"observation">, Sequenced {
  channels: Partial<Channels>;
}

export interface GameEvent extends Envelope<"event">, Sequenced {
  kind: string;
  data: Record<string, unknown>;
}

// --- Acting -------------------------------------------------------------------------------------------------------

export type ControlName = "move" | "look" | "jump" | "crouch" | "stop" | "interact" | "use" | "select" | "items" | "chat";

export type Action =
  | { control: "move"; forward: number; strafe: number; sprint?: boolean; duration_ms: number }
  | { control: "look"; yaw?: number; pitch?: number; yaw_delta?: number; pitch_delta?: number }
  | { control: "jump"; hold_ms?: number }
  | { control: "crouch"; on: boolean }
  | { control: "stop" }
  | { control: "interact"; target: EntityId; verb: string; hold_ms?: number }
  | { control: "use"; hand: "primary" | "secondary"; hold_ms?: number }
  | { control: "select"; slot: number }
  | { control: "items"; op: "move" | "drop" | "equip" | "consume"; slot: number; to?: "self" | "open" | "ground"; count?: number }
  | { control: "chat"; channel: "local" | "global" | "group"; text: string };

export interface Act extends Envelope<"act"> {
  /** Unique within the session: what makes the act happen once. */
  command: string;
  /** The `seq` of the observation the decision was made on. */
  basis: number;
  actions: Action[];
}

export type RejectCode =
  | "unknown_control" | "bad_arguments" | "unknown_target" | "out_of_reach" | "not_permitted"
  | "no_body" | "stale" | "rate_limited" | "too_long";

export interface Ack extends Envelope<"ack"> {
  command: string;
  seq: number;
  duplicate?: boolean;
  actions: ({ index: number; accepted: true } | { index: number; accepted: false; code: RejectCode })[];
}

export type Interruption = "replaced" | "stop" | "died" | "mounted" | "knocked_out" | "disconnected" | "game";

export interface Outcome extends Envelope<"outcome"> {
  command: string;
  index: number;
  seq: number;
  status: "completed" | "interrupted" | "failed";
  by?: Interruption;
  code?: RejectCode | "blocked";
  detail?: Record<string, unknown>;
}

// --- Staying connected --------------------------------------------------------------------------------------------

export interface Ping extends Envelope<"ping"> {}
export interface Pong extends Envelope<"pong">, Sequenced {}
export interface Bye extends Envelope<"bye"> {
  reason?: string;
}
export interface ProtocolError extends Envelope<"error"> {
  code: "malformed" | "unknown_type" | "rate_limited" | (string & {});
  message: string;
}

export type ClientMessage = Hello | Observe | Subscribe | Unsubscribe | Act | Ping | Bye;
export type GameMessage =
  | Welcome | Refused | Subscribed | Observation | GameEvent | Ack | Outcome | Pong | Bye | ProtocolError;
