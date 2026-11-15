// One vocabulary for what is not built yet, shared by the settings catalogue, the class table and the event table.

/** Features this engine does not have yet. A planned setting, a stub class and a planned event each wait for one. */
export const FEATURES = {
  imprinting: "Imprinting and baby care",
  tameBonus: "Taming bonuses in a tame's stats, passive taming, mate boost, unfertilised eggs",
  defences: "Defences: turrets, spikes, and explosives that are set",
  limits: "Structure limits, platforms, caves, and where building is prevented",
  decay: "Decay in finer grain, and of tamed creatures; unclaiming",
  offline: "Offline protection, PvP timers, and hardcore",
  tribes: "Tribes in depth: alliances, the log, wars, merges, cooldowns",
  dinoHarvest: "Creatures that harvest, and raid creatures",
  farming: "Farming, irrigation, and upkeep of the body",
  loot: "Loot: supply crates, fishing, quality, item stat clamps, custom recipes",
  passiveXp: "Experience over time, from notes and events, and by what was killed",
  flyers: "Flyers",
  weather: "Weather, temperature, and disease",
  transfers: "Transfers between servers",
  ops: "Operations: RCON, ban and admin lists, exclusive join, logs, filters, the live file by URL",
  polish: "Small behaviours of things already built",
  maps: "Maps as content: a map, its zones and what lives in them",
  stations: "Crafting stations: what is made where, and how fast",
  cosmetics: "Skins, dyes, costumes and shields",
  bosses: "Bosses, artifacts and what a boss unlocks",
  eggs: "Eggs as items that are carried, kept and eaten",
  points: "A points ledger: a shop, kits and rewards",
} as const;
export type Feature = keyof typeof FEATURES;
