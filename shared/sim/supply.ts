// A supply drop as every party works it out (planning/workstreams/supply.md): when its cast leaves the obelisk that
// sends it, where its capsule is at a tick, and how the server tells every session of the drops that are live. The
// server stores two states of a drop, pending and landed; coming, flying, braking and leaving are worked out here from
// its ticks, with whole ticks stored and no trigonometry, so the server, a client far off and one that joins while it
// is in the air agree.

import { fitBytes, type BitReader, type BitWriter } from "../net/codec.ts";
import { nextCast, type EyeColor } from "../world/tide-eye.ts";

/**
 * The top-marks a capsule wears for its class, by ClassDoc.mark (shared/supply/book.ts), as sea-marks are told apart
 * by the shape on their tops. These seven read apart as silhouettes eight pixels high.
 */
export const MARKS = ["bar", "saltire", "buckler", "hourglass", "cross", "cone_down", "cone_up"] as const;
/** The most drops live on a map at once: pending or landed, and somebody's to find. */
export const SUPPLY_MOST = 32;
const COUNT_BITS = 6;
/**
 * The most rows a message carries, which is more than may be live: a drop that is leaving is told for LEAVE_SECONDS
 * more, so that its going is seen, while another may already have been called in its place. A message's counts are six
 * bits, and so are a row's tier and class, since every row may have been called under its own.
 */
export const SUPPLY_ROWS = (1 << COUNT_BITS) - 1;
/**
 * Bytes of a tier's or a class's name on the wire: the twenty-four characters a book allows (shared/supply/book.ts
 * NAME_CHARS), at the three bytes the widest of them takes. A book's check, the writer and the reader all go by it.
 */
export const SUPPLY_NAME_BYTES = 72;
/** What a drop's capsule is called: on its record, in the prompt at it and over its open bag. */
export const supplyName = (tier: string, cls: string, ringed: boolean): string => `${ringed ? "Ringed " : ""}${tier} ${cls} drop`;
/** A drop sent by no obelisk: it comes straight down. */
export const SENDER_ZENITH = 255;
/** Metres over its landing at which a capsule lights its jets. */
export const BRAKE_HEIGHT = 120;
/** Seconds a capsule takes to shut, lift off and go once it is emptied or out of time. */
export const LEAVE_SECONDS = 12;
/** Seconds its shaft takes to come up when it is called, and to fade as it leaves. */
export const SHAFT_RISE = 2;
export const SHAFT_FADE = 3;
/** Seconds after landing at which its shutters start to open, and how long they take. */
export const SHUTTERS_AFTER = 1.2;
export const SHUTTERS_TAKE = 4;
/** Metres a second squared it climbs at as it leaves, and the seconds it stands shutting before it lifts. */
export const LEAVE_CLIMB = 9;
export const LEAVE_STANDS = 1.5;
/** How a drop is told of besides its shaft, as the wire carries Announce (shared/supply/book.ts). */
export const ANNOUNCES = ["none", "compass", "map", "chat"] as const;

/** What a drop of a tier shows: its name and colour, the level that opens it, and its place among the tiers (the count of its pulses and collars). */
export interface SupplyTier {
  name: string;
  rgb: number;
  level: number;
  count: number;
}
export interface SupplyClass {
  name: string;
  /** An index into MARKS. */
  mark: number;
}

/** When a drop does what, in world ticks. */
export interface SupplyTimes {
  /** The tick it was called: its shaft stands from here. */
  called: number;
  /** The tick its cast leaves the sender. */
  release: number;
  /** The tick it lands, and how many ticks before that its jets light. */
  land: number;
  brake: number;
  /** The tick it goes if nobody empties it. */
  end: number;
  /** The tick it shut and started to leave, or 0 while it has not. */
  left: number;
}

/** A drop as a session is told of it. Positions are in 1/32 m, as the server keeps them. */
export interface SupplyRow extends SupplyTimes {
  id: number;
  /** Indices into the message's tiers and classes. */
  tier: number;
  cls: number;
  ringed: boolean;
  landed: boolean;
  opened: boolean;
  /** An index into ANNOUNCES. */
  announce: number;
  /** The map's obelisk that sends it (ServerWorld.obelisks), the display it has (the map's tideEyes) or 255, and where the cast leaves it. */
  sender: number;
  eye: number;
  ox: number;
  oy: number;
  oz: number;
  /** Where it lands. Before it has, `y` is the ground the server expects. */
  x: number;
  y: number;
  z: number;
  /** Eight bits of its seed, for what may differ from one capsule to the next and matters to nobody: how it stands turned. */
  look: number;
}

export interface SupplyList {
  tiers: SupplyTier[];
  classes: SupplyClass[];
  rows: SupplyRow[];
}

/** A position as it is stored and sent: thirty-seconds of a metre. */
export const quantise = (v: number): number => Math.round(v * 32) / 32;

/**
 * A drop's ticks from the tick it is called. Its cast leaves at the sender's next cast tick (shared/world/tide-eye.ts)
 * at or after the notice less the flight, so it lands between the notice and one cycle of the obelisk after it; with no
 * display to keep time by, it leaves on the notice exactly. Seconds in, ticks out.
 */
export function supplyTimes(called: number, color: EyeColor | null, notice: number, flight: number, brake: number, life: number, rate: number): SupplyTimes {
  const flightTicks = Math.max(2, Math.round(flight * rate));
  const brakeTicks = Math.max(1, Math.min(flightTicks - 1, Math.round(brake * rate)));
  const earliest = called + Math.max(0, Math.round(notice * rate) - flightTicks);
  const release = color === null ? earliest : nextCast(earliest, color, rate);
  const land = release + flightTicks;
  return { called, release, land, brake: brakeTicks, end: land + Math.max(1, Math.round(life * rate)), left: 0 };
}

export const POSE_COMING = 0;
export const POSE_FLYING = 1;
export const POSE_BRAKING = 2;
export const POSE_LANDED = 3;
export const POSE_LEAVING = 4;
export const POSE_GONE = 5;
export const POSE_NAMES = ["coming", "flying", "braking", "landed", "leaving", "gone"] as const;

export interface SupplyPose {
  /** A POSE_. */
  state: number;
  /** Where the capsule is. While it is coming it is at the sender, and nothing of it is drawn. */
  x: number;
  y: number;
  z: number;
  /** Metres a second it moves at, down as it comes and up as it goes. */
  speed: number;
  /** How far along its flight it is, 0 at the sender to 1 where the jets light. */
  along: number;
  /** 0 to 1: its jets, its legs from folded to splayed, its shutters from shut to open. */
  thrust: number;
  legs: number;
  shutters: number;
  /** 0 to 1: how strongly its shaft stands, and how far its pulses have turned from running down to standing. */
  shaft: number;
  standing: number;
  /** Seconds since it landed, or since it started to leave: negative before. */
  since: number;
}

export const newPose = (): SupplyPose => ({ state: POSE_COMING, x: 0, y: 0, z: 0, speed: 0, along: 0, thrust: 0, legs: 0, shutters: 0, shaft: 0, standing: 0, since: -1 });

const smooth = (v: number): number => {
  const a = v < 0 ? 0 : v > 1 ? 1 : v;
  return a * a * (3 - 2 * a);
};

/**
 * Where a drop is at `tick`, which may be a tick and a part of one. The flight is one curve from the sender to the
 * point where the jets light, level as it leaves and straight down as it arrives, flown fast at first and slowing to
 * the speed the braking starts at; the braking is one steady deceleration to nothing at the ground. So its place is
 * continuous at the release, at the jets and at the landing, and its speed at the last two.
 */
export function supplyPose(d: SupplyRow | (SupplyTimes & Pick<SupplyRow, "ox" | "oy" | "oz" | "x" | "y" | "z">), tick: number, rate: number, out: SupplyPose): SupplyPose {
  const jets = d.land - d.brake;
  const brakeS = d.brake / rate;
  out.thrust = 0;
  out.legs = 0;
  out.shutters = 0;
  out.speed = 0;
  out.along = 0;
  out.standing = 0;
  out.since = -1;
  out.shaft = smooth((tick - d.called) / (SHAFT_RISE * rate));
  if (d.left > 0 && tick >= d.left) {
    // Shut, then up on the jets, the legs folding as the ground leaves them.
    const t = (tick - d.left) / rate;
    const up = t - LEAVE_STANDS;
    out.state = t >= LEAVE_SECONDS ? POSE_GONE : POSE_LEAVING;
    out.since = t;
    out.x = d.x;
    out.z = d.z;
    out.y = d.y + (up > 0 ? 0.5 * LEAVE_CLIMB * up * up : 0);
    out.speed = up > 0 ? LEAVE_CLIMB * up : 0;
    out.along = 1;
    out.shutters = 1 - smooth(t / 1.2);
    out.thrust = out.state === POSE_GONE ? 0 : smooth((t - 0.7) / 0.8);
    out.legs = 1 - smooth((t - 2.2) / 1.4);
    out.shaft = 1 - smooth(t / SHAFT_FADE);
    out.standing = 1;
    return out;
  }
  if (tick < d.release) {
    out.state = POSE_COMING;
    out.x = d.ox;
    out.y = d.oy;
    out.z = d.oz;
    return out;
  }
  if (tick < jets) {
    // A curve of three points: the sender, the point at its height over the landing, and where the jets light.
    const span = jets - d.release;
    const u = (tick - d.release) / span;
    const top = d.y + BRAKE_HEIGHT;
    const fall = d.oy - top;
    // The share of an even pace it ends at, so that it meets the jets at the speed the braking starts with.
    const m = fall > 1 ? Math.min(1, Math.max(0.02, (BRAKE_HEIGHT / brakeS) * (span / rate) / fall)) : 1;
    const s = m * u + (1 - m) * (2 * u - u * u);
    const pace = (m + (1 - m) * (2 - 2 * u)) / (span / rate);
    const a = (1 - s) * (1 - s);
    out.state = POSE_FLYING;
    out.along = s;
    out.x = d.x + a * (d.ox - d.x);
    out.z = d.z + a * (d.oz - d.z);
    out.y = top + (1 - s * s) * fall;
    // The curve's rate of change along itself, times the pace it is flown at.
    const hx = 2 * (1 - s) * (d.x - d.ox);
    const hz = 2 * (1 - s) * (d.z - d.oz);
    const hy = 2 * s * fall;
    out.speed = Math.sqrt(hx * hx + hy * hy + hz * hz) * pace;
    return out;
  }
  out.x = d.x;
  out.z = d.z;
  out.along = 1;
  if (tick < d.land) {
    const v = (tick - jets) / d.brake;
    out.state = POSE_BRAKING;
    out.y = d.y + BRAKE_HEIGHT * (1 - v) * (1 - v);
    out.speed = (2 * BRAKE_HEIGHT * (1 - v)) / brakeS;
    // The jets swell as they light and ease as the ground comes up; the legs come out over the last third.
    out.thrust = smooth(v / 0.08) * (1 - 0.3 * smooth((v - 0.7) / 0.3));
    out.legs = smooth((v - 0.55) / 0.3);
    return out;
  }
  const t = (tick - d.land) / rate;
  out.state = POSE_LANDED;
  out.since = t;
  out.y = d.y;
  out.legs = 1;
  out.thrust = 0.7 * (1 - smooth(t / 0.3));
  out.shutters = smooth((t - SHUTTERS_AFTER) / SHUTTERS_TAKE);
  out.standing = smooth(t / 1.5);
  return out;
}

const POS_BITS = 20;
const HEIGHT_BITS = 18;
const pos = (v: number): number => Math.max(0, Math.min((1 << POS_BITS) - 1, Math.round(v * 32)));
const height = (v: number): number => Math.max(-(1 << (HEIGHT_BITS - 1)), Math.min((1 << (HEIGHT_BITS - 1)) - 1, Math.round(v * 32)));

/**
 * The drops that are live or leaving, whole, after the message's type (S_SUPPLY): what each tier and class among them
 * shows, then a row a drop. A drop keeps the tier and class it was called with, so these are theirs and not the book's
 * as it stands. What is written here is what readSupply takes: a list of SUPPLY_ROWS rows at the most (the server
 * chooses which, server/supply.ts list), and a name no longer than SUPPLY_NAME_BYTES, cut at a whole character.
 */
export function writeSupply(w: BitWriter, list: SupplyList): void {
  // Reserved for the day a change is sent as a difference: 1 says the list that follows replaces the one held.
  w.bool(true);
  w.bits(Math.min(SUPPLY_ROWS, list.tiers.length), COUNT_BITS);
  for (const t of list.tiers.slice(0, SUPPLY_ROWS)) {
    w.string(fitBytes(t.name, SUPPLY_NAME_BYTES));
    w.bits(t.rgb & 0xffffff, 24);
    w.bits(Math.min(1023, t.level), 10);
    w.bits(Math.min(31, t.count), 5);
  }
  w.bits(Math.min(SUPPLY_ROWS, list.classes.length), COUNT_BITS);
  for (const c of list.classes.slice(0, SUPPLY_ROWS)) {
    w.string(fitBytes(c.name, SUPPLY_NAME_BYTES));
    w.u8(c.mark);
  }
  w.bits(Math.min(SUPPLY_ROWS, list.rows.length), COUNT_BITS);
  for (const d of list.rows.slice(0, SUPPLY_ROWS)) {
    w.u16(d.id);
    w.bits(d.tier, COUNT_BITS);
    w.bits(d.cls, COUNT_BITS);
    w.bool(d.ringed);
    w.bool(d.landed);
    w.bool(d.opened);
    w.bits(d.announce, 2);
    w.u8(d.sender);
    w.u8(d.eye);
    w.u8(d.look);
    w.bits(pos(d.ox), POS_BITS);
    w.sbits(height(d.oy), HEIGHT_BITS);
    w.bits(pos(d.oz), POS_BITS);
    w.bits(pos(d.x), POS_BITS);
    w.sbits(height(d.y), HEIGHT_BITS);
    w.bits(pos(d.z), POS_BITS);
    w.uint53(d.called);
    w.varint(d.release - d.called);
    w.varint(d.land - d.release);
    w.varint(d.brake);
    w.varint(d.end - d.land);
    w.bool(d.left > 0);
    if (d.left > 0) w.varint(d.left - d.land);
  }
}

/** Null for a message that is cut short or says what cannot be. */
export function readSupply(r: BitReader): SupplyList | null {
  if (!r.bool()) return null;
  const list: SupplyList = { tiers: [], classes: [], rows: [] };
  for (let n = r.bits(COUNT_BITS); n > 0; n--) list.tiers.push({ name: r.string(SUPPLY_NAME_BYTES), rgb: r.bits(24), level: r.bits(10), count: r.bits(5) });
  for (let n = r.bits(COUNT_BITS); n > 0; n--) list.classes.push({ name: r.string(SUPPLY_NAME_BYTES), mark: r.u8() });
  for (let n = r.bits(COUNT_BITS); n > 0; n--) {
    const id = r.u16();
    const tier = r.bits(COUNT_BITS);
    const cls = r.bits(COUNT_BITS);
    const ringed = r.bool();
    const landed = r.bool();
    const opened = r.bool();
    const announce = r.bits(2);
    const sender = r.u8();
    const eye = r.u8();
    const look = r.u8();
    const ox = r.bits(POS_BITS) / 32;
    const oy = r.sbits(HEIGHT_BITS) / 32;
    const oz = r.bits(POS_BITS) / 32;
    const x = r.bits(POS_BITS) / 32;
    const y = r.sbits(HEIGHT_BITS) / 32;
    const z = r.bits(POS_BITS) / 32;
    const called = r.uint53();
    const release = called + r.varint();
    const land = release + r.varint();
    const brake = r.varint();
    const end = land + r.varint();
    const left = r.bool() ? land + r.varint() : 0;
    if (r.overflow || tier >= list.tiers.length || cls >= list.classes.length || brake < 1 || brake >= land - release) return null;
    list.rows.push({ id, tier, cls, ringed, landed, opened, announce, sender, eye, look, ox, oy, oz, x, y, z, called, release, land, brake, end, left });
  }
  return r.overflow ? null : list;
}
