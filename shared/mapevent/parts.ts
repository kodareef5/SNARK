// The parts a map event is made of (planning/workstreams/map-events.md), as data: what a module asks the engine for,
// what the server saves, and the look every client draws them by. The engine simulates each kind of part and every
// client knows how to draw each, so a kind a module adds needs no code in a browser.

import { DMG_BULLET, DMG_ENERGY, DMG_EXPLOSIVE, DMG_FIRE, DMG_MELEE, DMG_PIERCE } from "../sim/damage.ts";
import { CRAFT_MOST_POINTS, type PathPoint } from "../sim/craft.ts";

/** A content id or a mesh's name: "core:ufo_craft". */
export const ASSET_ID = /^[a-z0-9_]+:[a-z0-9_./-]{1,64}$/;
/** Metres from the map's edge to its far side that a part's place may be: the wire's 20 bits of 32nds. */
export const PLACE_MOST = (1 << 20) / 32 - 1;
/** Metres up or down a part's height may be: the wire's 18 signed bits of 32nds. */
export const HEIGHT_MOST = (1 << 17) / 32 - 1;
/** Parts of an event on the feed at once (craft and sites), and crates of one event at once. */
export const PARTS_MOST = 7;

/** How a craft is drawn: its pieces, turning about its own up, each glowing in the colour its state gives. */
export interface CraftLook {
  /** 1 to 4 meshes drawn at its middle, each turning `spin` radians a second about its up. */
  readonly pieces: readonly { readonly mesh: string; readonly spin: number }[];
  /** A mesh drawn where the pack has not the first piece, and the wreck it leaves at rest ("" for none). */
  readonly fallback: string;
  readonly wreck: string;
  /** Colours, 0xRRGGBB: its glow; its glow while its shield is broken; what still glows in its wreck. */
  readonly glow: number;
  readonly broken: number;
  readonly ember: number;
  /** A beam down to the ground while it flies low: its colour, its width at the foot, and how far under its middle it starts. */
  readonly beam: { readonly rgb: number; readonly wide: number; readonly drop: number } | null;
  /** Smoke standing over its wreck. */
  readonly smoke: { readonly rgb: number; readonly height: number; readonly wide: number } | null;
  /** Radians it leans into its way for each metre a second it goes along the ground. */
  readonly lean: number;
  /** The owner its sounds are found under ("core:ufo"), or "" for the cues' own. */
  readonly sound: string;
}

/** A column over a site: smoke rising, or light. */
export interface ColumnLook {
  readonly kind: "smoke" | "light";
  readonly rgb: number;
  readonly height: number;
  readonly wide: number;
  readonly sound: string;
}

/** Damage kinds by name, as a craft's `takes` names them. */
export const DAMAGE_KINDS = { melee: DMG_MELEE, pierce: DMG_PIERCE, bullet: DMG_BULLET, fire: DMG_FIRE, explosive: DMG_EXPLOSIVE, energy: DMG_ENERGY } as const;
export type DamageKind = keyof typeof DAMAGE_KINDS;

/** A thing in the sky on a path, which can be struck, brought down, and comes to rest as a wreck. */
export interface CraftSpec {
  /** What it is called on a lock and in a line: "Unidentified craft". */
  readonly name: string;
  /** 2 to 24 control points of its path. */
  readonly points: readonly PathPoint[];
  /** Ticks after its event comes that it enters at its first point. */
  readonly after?: number;
  /** Its hull, an oblate spheroid: metres round its rim, and from its middle to its top. */
  readonly hull: { readonly radius: number; readonly half: number };
  readonly health: number;
  /** The share of each kind of damage it takes, by name; 1 where not given. */
  readonly takes?: Readonly<Partial<Record<DamageKind, number>>>;
  /**
   * Its shield stops `soak` of each hit, unless it flies low with `openWhenLow`, or a heavy blow (a blast) has broken it
   * for `breakSeconds`; it cannot be broken again for `rearmSeconds` after.
   */
  readonly shield?: { readonly soak: number; readonly openWhenLow: boolean; readonly breakSeconds: number; readonly rearmSeconds: number };
  /** Whether a missile may lock it. */
  readonly lockable?: boolean;
  /** Its fall: metres a second squared, and the share of its speed along the ground it loses each second. */
  readonly fall?: { readonly gravity: number; readonly bleed: number };
  /** The blast it comes to rest in, credited to whoever brought it down. */
  readonly crash?: { readonly radius: number; readonly damage: number };
  readonly look: CraftLook;
}

/** A container nothing can be put in, filled from the drop book's tables, gone when emptied or after its time. */
export interface CrateSpec {
  /** The container's content id: "core:event_crate" where not given. */
  readonly prop?: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly seconds: number;
  /** Rolls of the drop book's tables: its tier (the book's highest where it has none such), a class drawn for each. */
  readonly loot: { readonly tier: string; readonly classes: readonly string[]; readonly rolls: number; readonly ringed: boolean };
}

/** A place on the ground with a column over it: where something fell, a signal, a beacon. */
export interface SiteSpec {
  readonly x: number;
  readonly z: number;
  /** Ticks after its event comes that it shows, and for how many ticks; 0 until its event ends. */
  readonly after?: number;
  readonly ticks?: number;
  readonly column: ColumnLook;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const within = (v: unknown, lo: number, hi: number): boolean => finite(v) && v >= lo && v <= hi;
const rgb = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff;
const mesh = (v: unknown, empty = false): boolean => typeof v === "string" && ((empty && v === "") || ASSET_ID.test(v));
const owner = (v: unknown): boolean => typeof v === "string" && (v === "" || ASSET_ID.test(v));
const name = (v: unknown): boolean => typeof v === "string" && v.length >= 1 && v.length <= 48;

/** Why a craft's look cannot be drawn, or "". */
export function lookFault(l: CraftLook): string {
  if (!Array.isArray(l.pieces) || l.pieces.length < 1 || l.pieces.length > 4) return "a look has 1 to 4 pieces";
  for (const p of l.pieces) if (!mesh(p?.mesh) || !within(p.spin, -32, 32)) return "a piece is a mesh's name and a spin from -32 to 32 radians a second";
  if (!mesh(l.fallback, true) || !mesh(l.wreck, true)) return "a fallback and a wreck are meshes' names, or empty";
  if (!rgb(l.glow) || !rgb(l.broken) || !rgb(l.ember)) return "colours are 0xRRGGBB";
  if (l.beam !== null && !(typeof l.beam === "object" && rgb(l.beam.rgb) && within(l.beam.wide, 0.5, 64) && within(l.beam.drop, 0, 30))) return "a beam is a colour, 0.5 to 64 m wide, starting 0 to 30 m under its middle";
  if (l.smoke !== null && !(typeof l.smoke === "object" && rgb(l.smoke.rgb) && within(l.smoke.height, 1, 2000) && within(l.smoke.wide, 0.5, 200))) return "smoke is a colour, 1 to 2000 m high and 0.5 to 200 m wide";
  if (!within(l.lean, 0, 0.025)) return "a lean is 0 to 0.025 radians for each metre a second";
  if (!owner(l.sound)) return "a sound's owner is a content id, or empty";
  return "";
}

/** Why a column cannot be drawn, or "". */
export function columnFault(c: ColumnLook): string {
  if (typeof c !== "object" || c === null) return "a column is an object";
  if (c.kind !== "smoke" && c.kind !== "light") return `a column is "smoke" or "light"`;
  if (!rgb(c.rgb) || !within(c.height, 1, 2000) || !within(c.wide, 0.5, 200)) return "a column is a colour, 1 to 2000 m high and 0.5 to 200 m wide";
  if (!owner(c.sound)) return "a sound's owner is a content id, or empty";
  return "";
}

/** Why a craft cannot be made, or "". */
export function craftFault(c: CraftSpec): string {
  if (typeof c !== "object" || c === null) return "a craft is an object";
  if (!name(c.name)) return "a craft's name is 1 to 48 characters";
  if (!Array.isArray(c.points) || c.points.length < 2 || c.points.length > CRAFT_MOST_POINTS) return `a path has 2 to ${CRAFT_MOST_POINTS} points`;
  for (const p of c.points) {
    if (!within(p?.x, 0, PLACE_MOST) || !within(p.z, 0, PLACE_MOST) || !within(p.y, -HEIGHT_MOST, HEIGHT_MOST)) return "a point is on the map, and within 4,095 m up or down";
    if (!within(p.speed, 1, 255) || typeof p.low !== "boolean") return "a point's speed is 1 to 255 metres a second, and its low a switch";
  }
  if (c.after !== undefined && !(Number.isInteger(c.after) && c.after >= 0 && c.after <= 30 * 60 * 30)) return "a craft comes 0 to 30 minutes of ticks after its event";
  if (typeof c.hull !== "object" || c.hull === null || !within(c.hull.radius, 0.5, 63) || !within(c.hull.half, 0.25, 63)) return "a hull is 0.5 to 63 m round and 0.25 to 63 m from its middle to its top";
  if (!within(c.health, 1, 1e8)) return "health is 1 to 100,000,000";
  if (c.takes !== undefined) {
    if (typeof c.takes !== "object" || c.takes === null) return "what it takes is an object of damage kinds";
    for (const [k, v] of Object.entries(c.takes)) if (!(k in DAMAGE_KINDS) || !within(v, 0, 10)) return `what it takes: ${k} is no damage kind (${Object.keys(DAMAGE_KINDS).join(", ")}) or not 0 to 10`;
  }
  if (c.shield !== undefined) {
    const s = c.shield;
    if (typeof s !== "object" || s === null || !within(s.soak, 0, 1) || typeof s.openWhenLow !== "boolean" || !within(s.breakSeconds, 0, 120) || !within(s.rearmSeconds, 0, 600)) return "a shield stops 0 to 1 of a hit, opens when low or not, and is broken for 0 to 120 s, again after 0 to 600 s";
  }
  if (c.lockable !== undefined && typeof c.lockable !== "boolean") return "lockable is a switch";
  if (c.fall !== undefined && (typeof c.fall !== "object" || c.fall === null || !within(c.fall.gravity, 0.5, 63) || !within(c.fall.bleed, 0, 1))) return "a fall is 0.5 to 63 m/s² and loses 0 to 1 of its speed a second";
  if (c.crash !== undefined && (typeof c.crash !== "object" || c.crash === null || !within(c.crash.radius, 0, 64) || !within(c.crash.damage, 0, 10000))) return "a crash is 0 to 64 m and 0 to 10,000 damage";
  if (typeof c.look !== "object" || c.look === null) return "a craft has a look";
  return lookFault(c.look);
}

/** Why a crate cannot be made, or "". */
export function crateFault(c: CrateSpec): string {
  if (typeof c !== "object" || c === null) return "a crate is an object";
  if (c.prop !== undefined && !mesh(c.prop)) return "a crate's prop is a content id";
  if (!name(c.name)) return "a crate's name is 1 to 48 characters";
  if (!within(c.x, 0, PLACE_MOST) || !within(c.z, 0, PLACE_MOST)) return "a crate is on the map";
  if (!within(c.seconds, 30, 7 * 24 * 3600)) return "a crate stays 30 s to a week";
  const l = c.loot;
  if (typeof l !== "object" || l === null || typeof l.tier !== "string" || !Array.isArray(l.classes) || l.classes.length < 1 || l.classes.length > 16 || !l.classes.every((k) => typeof k === "string") || !(Number.isInteger(l.rolls) && l.rolls >= 1 && l.rolls <= 8) || typeof l.ringed !== "boolean") return "loot is a tier, 1 to 16 classes, 1 to 8 rolls and ringed or not";
  return "";
}

/** Why a site cannot be made, or "". */
export function siteFault(s: SiteSpec): string {
  if (typeof s !== "object" || s === null) return "a site is an object";
  if (!within(s.x, 0, PLACE_MOST) || !within(s.z, 0, PLACE_MOST)) return "a site is on the map";
  if (s.after !== undefined && !(Number.isInteger(s.after) && s.after >= 0)) return "a site shows a whole number of ticks after its event comes";
  if (s.ticks !== undefined && !(Number.isInteger(s.ticks) && s.ticks >= 0)) return "a site shows for a whole number of ticks, 0 for as long as its event";
  return columnFault(s.column);
}
