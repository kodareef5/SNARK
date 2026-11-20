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
  /** The build helper (the plan control), where the game has it. */
  building?: Building;
}

/** How a game's structures go together, for the plan control: a grid of foundation cells, storeys, the pieces each
 * tier has (form → the item that places it), and how fast and how far off the helper places them. */
export interface Building {
  /** A foundation cell's side, metres. */
  cell: number;
  /** A storey's height, metres. */
  storey: number;
  /** How far from the character a piece may be placed, metres. */
  reach: number;
  /** Pieces placed a second. */
  rate: number;
  /** Pieces in one plan, at most. */
  max_pieces: number;
  tiers: Record<string, Partial<Record<PieceForm, string>>>;
}

export type PieceForm = "foundation" | "wall" | "doorframe" | "windowframe" | "ceiling" | "door" | "pillar" | "stairs";
export type Side = "n" | "e" | "s" | "w";

/** A piece of a plan, on the plan's grid: cell i grows east and j south of cell 0, 0; storey 0 is the ground. A piece
 * on an edge (wall, doorframe, windowframe, door) names the cell's side it is on; stairs name the way up. A ceiling's
 * storey is the one it roofs: it is the floor of the storey above. A pillar stands at its cell's north-west corner. */
export interface PlanPiece {
  form: PieceForm;
  item: string;
  cell: [number, number];
  level: number;
  side?: Side;
  up?: Side;
}

/** Where a plan's grid lies: cell 0, 0's centre at a point, turned a number of quarter turns clockwise (seen from
 * above: 1 turns its south to the west), or on the grid of a base already standing. */
export type PlanAnchor = { at: [number, number]; turns?: number } | { base: EntityId };

export interface Plan {
  anchor: PlanAnchor;
  pieces: PlanPiece[];
}

/** What the game says of each piece of a plan, checked in order as though those before it stood. */
export type PieceVerdict =
  | "ok" | "built" | "occupied" | "blocked" | "no_support" | "terrain" | "too_far" | "not_in_tier" | "enemy_near";

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

export type ChannelName = "self" | "entities" | "terrain" | "inventory" | "chat" | "focus" | "image" | "map";

export interface ChannelOptions {
  hz?: number;
  /** The map's metres a letter. */
  cell?: number;
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

/** The map screen: the whole map coarsely, as the game's map shows it; under fog only what has been explored. It is
 * the map as drawn, not the ground as it is now: what changed since is seen only in `terrain`, up close. */
export interface MapChannel {
  cell: number;
  origin: [number, number];
  size: [number, number];
  rows: string[];
  legend: Record<string, string>;
  known: "full" | "explored";
}

export interface Slot {
  slot: number;
  item: string;
  count: number;
  uses?: Gauge | null;
}

/** A recipe as the inventory screen offers it. */
export interface Craftable {
  item: string;
  needs: Record<string, number>;
  /** How many could be made now. */
  can: number;
  seconds: number;
  /** A station kind the recipe needs, or null for the hands. */
  at: string | null;
}

export interface InventoryChannel {
  slots: Slot[];
  capacity: number;
  weight: Gauge;
  hotbar: (number | null)[];
  open: { id: EntityId; slots: Slot[] } | null;
  craftable: Craftable[];
  crafting: { item: string; left: number; ready_in_s: number }[];
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

export type PlacementRefusal = "no_support" | "blocked" | "occupied" | "too_far" | "not_flat" | "not_permitted";

/** The preview of a held structure, as a player sees it. */
export interface Placement {
  piece: string;
  pos: Vec3;
  yaw: number;
  snapped: { to: EntityId; where: string } | null;
  valid: boolean;
  reason: PlacementRefusal | null;
}

export interface FocusChannel {
  target: EntityId | null;
  distance?: number;
  verbs?: string[];
  placement?: Placement;
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
  map: MapChannel;
}

export interface Observation extends Envelope<"observation">, Sequenced {
  channels: Partial<Channels>;
}

export interface GameEvent extends Envelope<"event">, Sequenced {
  kind: string;
  data: Record<string, unknown>;
}

// --- Acting -------------------------------------------------------------------------------------------------------

export type ControlName =
  | "move" | "look" | "jump" | "crouch" | "stop" | "interact" | "use" | "select" | "items" | "craft" | "rotate" | "chat" | "plan";

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
  | { control: "craft"; item: string; count: number }
  | { control: "rotate"; steps: number }
  /** The build helper. check: at once, a verdict for every piece and the bill of what is still to place. build: places
   * the pieces from `from` up to `to` in order, at the game's rate, from the inventory, each within reach; it stops at
   * the first that cannot go, saying which and why. */
  | { control: "plan"; op: "check" | "build"; plan: Plan; from?: number; to?: number }
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
  | "no_body" | "stale" | "rate_limited" | "too_long" | "missing_items";

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
