import type { DockEntry, Screen, ScreenCtx } from "./screen.ts";

export const TAB_STATS = 0;
export const TAB_ENGRAMS = 1;
export const TAB_MAKE = 2;

export const inventoryDock: readonly DockEntry[] = [
  { id: "bag", label: "Inventory", art: "bag", rank: 10, open: (c) => c.pressKey("KeyI") },
];

function openAt(tab: number, c: ScreenCtx): void {
  c.pressKey("KeyP");
  const panel = c.screens.find((s) => s.name === "character") as (Screen & { selectTab(tab: number): void }) | undefined;
  if (panel?.isOpen() && c.session && c.registry) panel.selectTab(tab);
}

export const characterDock: readonly DockEntry[] = [
  { id: "craft", label: "Craft", art: "craft", rank: 20, open: (c) => openAt(TAB_MAKE, c) },
  { id: "survivor", label: "Survivor", art: "survivor", rank: 30, open: (c) => openAt(TAB_STATS, c) },
];
