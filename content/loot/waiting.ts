// Items with no way into the world (planning/workstreams/loot.md). tests/items/obtainable.test.ts holds every other
// item to having one, and each name here to still having none, so the lists only shrink.

/** What a survivor is not meant to come by, and why. */
export const NEVER_FOUND: Readonly<Record<string, string>> = {
  "core:jet_cannon": "fitted to the hidden jet",
  "core:cannon_round": "fitted to the hidden jet",
  "core:jet_missile_rack": "fitted to the hidden jet",
  "core:jet_missile": "fitted to the hidden jet",
};

/** What should be found and is not yet, and where ARK has it. */
export const WAITING: Readonly<Record<string, string>> = {
  "core:pelt": "ARK's mammoth and direwolf",
  "core:organic_polymer": "ARK's Kairuku and mantis",
  "core:angler_gel": "ARK's anglerfish",
  "core:feces_massive": "ARK's titanosaur",
};

/**
 * What is found in drops and has a recipe nobody can follow, with the item its recipe lacks. Each leaves when that item
 * has a source.
 */
export const FOUND_NOT_MADE: Readonly<Record<string, string>> = {
  "core:prod": "core:angler_gel",
  "core:fur_hat": "core:pelt",
  "core:fur_shirt": "core:pelt",
  "core:fur_gloves": "core:pelt",
  "core:fur_pants": "core:pelt",
  "core:fur_boots": "core:pelt",
  "core:ghillie_hat": "core:organic_polymer",
  "core:ghillie_shirt": "core:organic_polymer",
  "core:ghillie_gloves": "core:organic_polymer",
  "core:ghillie_pants": "core:organic_polymer",
  "core:ghillie_boots": "core:organic_polymer",
};
