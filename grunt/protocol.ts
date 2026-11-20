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
  /** The assists (the assist control), where the game has them. */
  assists?: Assists;
  /** Players' speech, transcribed and heard by the character within `range` metres. The character itself talks in
   * chat: it has no voice. */
  voice?: { range: number };
}

/** The assists' limits: the hands done for the client no better than a good player's. */
export interface Assists {
  kinds: AssistKind[];
  /** How far behind the target an assist's tracking runs: a player's reaction, ms. */
  reaction_ms: number;
  /** A ranged shot's error at a still target, degrees; it grows with how fast the target crosses the line. */
  spread_deg: number;
}

export type AssistKind = "aim" | "attack" | "harvest" | "follow" | "repair";

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
  /** Each tier: the item that places each form in it. */
  tiers: Record<string, Partial<Record<PieceForm, string>>>;
  /** The forms the game has, and how each goes on the grid. A game adds a piece (a fence, a gate, a sloped roof, a
   * triangle foundation) by adding it here; a client that knows the placement classes builds it unchanged. Absent:
   * the eight square forms of version 0. */
  forms?: FormSpec[];
  /** Seconds after placing in which a piece is taken back whole (a full refund); after, it is demolished for part. */
  pickup_s?: number;
  /** Items set down on a floor (boxes, vaults, beds, stations): what a layout furnishes rooms with. */
  things?: string[];
}

/** A form's way onto the grid: `floor` a cell at a storey (foundations, ceilings), `edge` a cell's side (walls,
 * frames, fences, railings), `edge_top` on an edge piece (a sloped roof), `corner` a cell's corner (pillars),
 * `in_frame` in a frame on an edge (doors, windows, gates, hatches), `centre` a cell's middle facing a way (stairs,
 * ramps, ladders), `thing` set down on a floor. */
export interface FormSpec {
  form: PieceForm;
  place: "floor" | "edge" | "edge_top" | "corner" | "in_frame" | "centre" | "thing";
  /** `square` (the default) or `triangle` (half a cell, on a square's side). */
  shape?: "square" | "triangle";
  /** On the ground (a foundation, a fence foundation), or on what stands (a ceiling). */
  ground?: boolean;
  /** The form whose frame it fills (a door: doorframe; a gate: gateway). */
  frame?: PieceForm;
}

/** The forms of version 0; a game may list more in `Building.forms`. */
export const BASIC_FORMS = ["foundation", "wall", "doorframe", "windowframe", "ceiling", "door", "pillar", "stairs"] as const;
/** A form's name: open, since games add pieces. */
export type PieceForm = (typeof BASIC_FORMS)[number] | (string & {});
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
  /** A triangle piece: the side of the square cell it stands against, the triangle pointing out of it. */
  half?: Side;
  /** A thing on a floor: where on the cell (a side, or `c` its middle). */
  spot?: Side | "c";
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
  | "ok" | "built" | "occupied" | "blocked" | "no_support" | "terrain" | "too_high" | "too_far" | "not_in_tier" | "enemy_near"
  | "missing_items" | "not_in_game";

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
  /** What sort of thing it is, as the game sorts it: resource, food, tool, weapon, ammo, armor, structure, fuel. */
  kind?: string;
  uses?: Gauge | null;
}

/** A recipe as the inventory screen offers it. `level`: the character's level it is first learned at, when that is
 * still ahead (it cannot be made until then: `can` is 0). */
export interface Craftable {
  item: string;
  needs: Record<string, number>;
  /** How many could be made now. */
  can: number;
  seconds: number;
  /** A station kind the recipe needs, or null for the hands. */
  at: string | null;
  level?: number;
}

export interface InventoryChannel {
  slots: Slot[];
  capacity: number;
  weight: Gauge;
  hotbar: (number | null)[];
  open: { id: EntityId; slots: Slot[]; capacity: number; name?: string } | null;
  craftable: Craftable[];
  crafting: { item: string; left: number; ready_in_s: number }[];
}

export interface ChatLine {
  /** "voice": a player's microphone speech, transcribed; heard only within a voice's range, as a player hears it. */
  channel: "local" | "global" | "group" | "voice" | (string & {});
  from: string;
  /** Who said it: for voice, always (the game knows whose microphone it was). */
  from_id?: EntityId;
  text: string;
  t: number;
  /** Speech: where it came from, how loud it was here, and how sure the transcription is (0 to 1). */
  voice?: { distance: number; bearing: number; loudness: number; confidence: number };
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
  | "move" | "look" | "jump" | "crouch" | "stop" | "interact" | "use" | "select" | "items" | "craft" | "rotate" | "chat" | "plan" | "assist";

export type Action =
  | { control: "move"; forward: number; strafe: number; sprint?: boolean; duration_ms: number }
  | { control: "look"; yaw?: number; pitch?: number; yaw_delta?: number; pitch_delta?: number }
  | { control: "jump"; hold_ms?: number }
  | { control: "crouch"; on: boolean }
  | { control: "stop" }
  | { control: "interact"; target: EntityId; verb: string; hold_ms?: number }
  | { control: "use"; hand: "primary" | "secondary"; hold_ms?: number }
  | { control: "select"; slot: number }
  | { control: "items"; op: "move" | "drop" | "equip" | "consume"; slot: number; from?: "self" | "open"; to?: "self" | "open" | "ground"; count?: number }
  /** The inventory screen's "transfer all": every stack that matches, between the character and the open container,
   * at once, as far as the destination has room (and the character can carry). `keep` leaves so many of an item. */
  | { control: "items"; op: "transfer"; from: "self" | "open"; to: "self" | "open"; items?: string[]; kinds?: string[]; keep?: Record<string, number> }
  | { control: "craft"; item: string; count: number }
  | { control: "rotate"; steps: number }
  /** The build helper. check: at once, a verdict for every piece and the bill of what is still to place. build: places
   * the pieces from `from` up to `to` in order, at the game's rate, from the inventory, each within reach; it stops at
   * the first that cannot go, saying which and why. */
  | { control: "plan"; op: "check" | "build" | "remove" | "upgrade"; plan: Plan; from?: number; to?: number; ids?: EntityId[] }
  /** An assist: the game works the hands on a target until it is done or an `until` holds. aim: keep the crosshair on
   * it (leading it, with a bow in hand). attack: close in and strike at the weapon's pace; with a bow, keep `range`
   * [near, far] metres, lead and loose. harvest: swing at a tool's pace until it is gone. The client's own move or look
   * takes over from it. */
  | { control: "assist"; kind: AssistKind; target: EntityId; range?: [number, number]; natural?: boolean; until?: { health_below?: number; mount_health_below?: number; stamina_below?: number; count?: number; seconds?: number } }
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
