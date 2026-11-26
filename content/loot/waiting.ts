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
  "core:feces_massive": "ARK's titanosaur",
};

/** What is come by and has a recipe nobody can follow, with the item its recipe lacks. Each leaves when that item has a source. */
export const FOUND_NOT_MADE: Readonly<Record<string, string>> = {};
