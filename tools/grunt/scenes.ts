// A mock world described as data, so a scenario (grunt/scenarios/*.json) can say what it starts from.

import type { EntityKind } from "../../grunt/protocol.ts";
import { Terrain, type TerrainSpec } from "./terrain.ts";
import { type CharacterSetup, World } from "./world.ts";

export interface SceneThing {
  type: "tree" | "rock" | "bush" | "chest" | "raptor" | "player";
  x: number;
  z: number;
  name?: string;
  /** A chest's contents. */
  items?: Record<string, number>;
  /** A player who is an enemy. */
  hostile?: boolean;
}

export interface Scene {
  seed?: number;
  me?: CharacterSetup;
  things?: SceneThing[];
  /** Ground with cliffs, water, roads and bridges; open flat ground without it. */
  terrain?: TerrainSpec;
}

const KIND: Record<SceneThing["type"], EntityKind> = {
  tree: "resource", rock: "resource", bush: "resource", chest: "container", raptor: "creature", player: "player",
};

export function makeWorld(scene: Scene = {}): World {
  const w = new World(scene.seed ?? 1);
  if (scene.terrain) {
    w.terrain = new Terrain(scene.terrain);
    w.changes = (scene.terrain.changes ?? []).map((c) => ({ at: c.at_s * 1000, feature: c.feature })).sort((a, b) => a.at - b.at);
  }
  for (const t of scene.things ?? []) {
    const slots = t.items ? Object.entries(t.items).map(([item, count], slot) => ({ slot, item, count })) : t.type === "chest" ? [] : undefined;
    w.place(KIND[t.type], t.type, t.x, t.z, { ...(t.name ? { name: t.name } : {}), ...(slots ? { slots } : {}), ...(t.hostile ? { hostile: true } : {}) });
  }
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
