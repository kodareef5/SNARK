// A mock world described as data, so a scenario (grunt/scenarios/*.json) can say what it starts from.

import { BLUEPRINTS } from "../../grunt/blueprints.ts";
import { compile } from "../../grunt/layout.ts";
import type { EntityKind, MapPlace } from "../../grunt/protocol.ts";
import { BUILDING } from "./structures.ts";
import { Terrain, type TerrainSpec } from "./terrain.ts";
import { type CharacterSetup, World } from "./world.ts";

export interface SceneThing {
  type: "tree" | "rock" | "bush" | "chest" | "vault" | "raptor" | "player" | "parasaur" | "pteranodon" | "car" | "heli" | "boat" | "ankylo";
  /** A creature that is the character's tribe's (rides, harvesters); raptors are wild unless this is set. */
  tame?: boolean;
  /** A player's walk: the points it goes through, in order, at `speed` m/s, from `at_s`. */
  path?: [number, number][];
  speed?: number;
  at_s?: number;
  x: number;
  z: number;
  name?: string;
  /** A chest's contents. */
  items?: Record<string, number>;
  /** A player who is an enemy. */
  hostile?: boolean;
  /** A player emoting from the start (a dance, a loop); and whether it accepts the character's invites to a pair. */
  emote?: string;
  accepts?: boolean;
}

export interface Scene {
  seed?: number;
  me?: CharacterSetup;
  things?: SceneThing[];
  /** Ground with cliffs, water, roads and bridges; open flat ground without it. */
  terrain?: TerrainSpec;
  /** Bases already standing: a library blueprint, its middle at x, z, its front facing a side, in a tier. */
  bases?: { blueprint: string; x: number; z: number; facing?: "n" | "e" | "s" | "w"; tier?: string }[];
  /** Named places on the map screen (it needs terrain to have a map). */
  places?: MapPlace[];
  /** What the game tells a new player of the world (welcome's game.about). */
  about?: string;
}

const KIND: Record<SceneThing["type"], EntityKind> = {
  tree: "resource", rock: "resource", bush: "resource", chest: "container", vault: "container", raptor: "creature", player: "player", ankylo: "creature",
  parasaur: "creature", pteranodon: "creature", car: "vehicle", heli: "vehicle", boat: "vehicle",
};
/** What a scene places tame and ready to ride. */
const RIDEABLE = new Set(["parasaur", "pteranodon", "car", "heli", "boat", "ankylo"]);

export function makeWorld(scene: Scene = {}): World {
  const w = new World(scene.seed ?? 1);
  if (scene.terrain) {
    w.terrain = new Terrain(scene.terrain);
    w.changes = (scene.terrain.changes ?? []).map((c) => ({ at: c.at_s * 1000, feature: c.feature })).sort((a, b) => a.at - b.at);
  }
  for (const t of scene.things ?? []) {
    const slots = t.items ? Object.entries(t.items).map(([item, count], slot) => ({ slot, item, count })) : t.type === "chest" || t.type === "vault" ? [] : undefined;
    w.place(KIND[t.type], t.type, t.x, t.z, {
      ...(t.name ? { name: t.name } : {}), ...(slots ? { slots } : {}), ...(t.hostile ? { hostile: true } : {}),
      ...(RIDEABLE.has(t.type) || t.tame ? { tame: true } : {}),
      ...(t.path ? { path: t.path.map((p) => [...p] as [number, number]), pace: t.speed ?? 3, departs: (t.at_s ?? 0) * 1000 } : {}),
      ...(t.emote ? { emote: t.emote, emoteUntil: Infinity } : {}), ...(t.accepts ? { accepts: true } : {}),
    });
  }
  for (const b of scene.bases ?? []) {
    const laid = compile(BLUEPRINTS[b.blueprint]!);
    const turns = { s: 0, w: 1, n: 2, e: 3 }[b.facing ?? "s"];
    const kit = BUILDING.tiers[b.tier ?? "wood"]!;
    const cx = ((laid.bounds[0] + laid.bounds[2]) / 2) * 3, cz = ((laid.bounds[1] + laid.bounds[3]) / 2) * 3;
    let [ox, oz] = [cx, cz];
    for (let t = 0; t < turns; t++) [ox, oz] = [-oz, ox];
    w.raise({ anchor: { at: [b.x - ox, b.z - oz], turns }, pieces: laid.pieces.map((p) => ({ ...p, item: kit[p.form]! })) });
  }
  w.places = scene.places ?? [];
  w.about = scene.about ?? "";
  w.setup(scene.me ?? {});
  return w;
}

/** The beach most scenarios start from: a grove to the north-east, rocks, bushes, a chest, and a raptor far off. */
export const BEACH: Scene = {
  seed: 7,
  me: { x: 0, z: 0, yaw: 0 },
  things: [
    { type: "tree", x: 8, z: -10 }, { type: "tree", x: 11, z: -13 }, { type: "tree", x: 6, z: -15 },
    { type: "tree", x: 13, z: -8 }, { type: "tree", x: 9, z: -18 },
    { type: "rock", x: -10, z: -6 }, { type: "rock", x: -14, z: -9 },
    { type: "bush", x: -4, z: 7 }, { type: "bush", x: -6, z: 9 }, { type: "bush", x: -3, z: 11 },
    { type: "chest", x: -6, z: 2, items: { stone_hatchet: 1 } },
    { type: "raptor", x: 45, z: -40 },
  ],
};
