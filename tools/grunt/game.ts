// The mock world's side of the grunt protocol: its capabilities and limits, on the shared endpoint (grunt/endpoint.ts).

import { Endpoint } from "../../grunt/endpoint.ts";
import type { Capabilities, GameInfo, Limits } from "../../grunt/protocol.ts";
import { BUILDING } from "./structures.ts";
import { EMOTE_SPECS, ASSIST, TICK_MS, VOICE_RANGE, type World } from "./world.ts";

export type { Connection } from "../../grunt/endpoint.ts";

export const LIMITS: Limits = { max_duration_ms: 2000, leash_ms: 1500, max_rate_hz: 20, act_per_s: 20, command_memory_s: 600 };
export const CAPABILITIES: Capabilities = {
  channels: ["self", "entities", "terrain", "inventory", "chat", "focus"],
  controls: ["move", "look", "jump", "crouch", "stop", "interact", "use", "select", "items", "craft", "chat", "plan", "assist", "emote"],
  events: ["hurt", "died", "chat", "item", "notice", "blocked", "heard", "crafted", "built", "mounted", "dismounted", "struck", "damaged", "repaired", "emoted", "invited"],
  verbs: ["harvest", "open", "close"],
  building: BUILDING,
  assists: { kinds: ["aim", "attack", "harvest", "follow", "repair"], ...ASSIST },
  voice: { range: VOICE_RANGE },
  emotes: EMOTE_SPECS,
};

/** The mock world on the protocol: a map channel where it has ground. */
export class GameEndpoint extends Endpoint {
  constructor(world: World, game: GameInfo = { name: "mock", version: "0", world: "beach", ...(world.about ? { about: world.about } : {}) }) {
    super(world, {
      capabilities: () => (world.terrain ? { ...CAPABILITIES, channels: [...CAPABILITIES.channels, "map"] } : CAPABILITIES),
      limits: LIMITS, game, tickMs: TICK_MS,
    });
  }
}
