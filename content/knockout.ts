import type { Def } from "../shared/content/defs.ts";
import { crafting } from "./craft.ts";

// Knocking out by hand and by club, the slingshot and its stones, and narcoberries. The numbers are the wiki's
// (ark.wiki.gg, Wooden Club, Slingshot, Narcoberry, Torpidity and Dodo, 2026-11-15) except where a line says chosen.

/** Real minutes, as the hours of 140 seconds that spoiling is written in. */
const minutes = (n: number): number => (n * 60) / 140;

export const KNOCKOUT: readonly Def[] = [
  // 5 damage, and torpor 3.75 times what it does, 18.75 a blow. The wiki gives a survivor 18.8 whatever is worn or hit, which
  // is not built. The Dodo page's table takes 10 a blow, so counts 3 at level 1 where this gives 2. The swing, its reach and
  // the crafting time are chosen.
  { type: "item", class: "weapon", id: "core:club", stack: 1, weight: 2, label: "wooden club", color: 3, weapon: { kind: "melee", damage: 5, type: "melee", torpor: 3.75, uses: 40, mesh: "core:club", hold: "tool" } },
  crafting("core:club", { needs: [{ item: "core:wood", count: 4 }, { item: "core:fiber", count: 15 }], seconds: 5, xp: 2.8 }),
  { type: "engram", id: "core:engram-club", label: "Wooden club", level: 8, cost: 4, item: "core:club" },

  // Fires the stone a survivor gathers. Drawn and loosed as a bow is; the draw and reload times are chosen.
  { type: "item", class: "weapon", id: "core:slingshot", stack: 1, weight: 3, color: 3, weapon: { kind: "bow", ammo: ["core:stone"], power: 1, reload: 0.5, draw: 1, uses: 40, mesh: "core:slingshot", hold: "bow" } },
  crafting("core:slingshot", { needs: [{ item: "core:hide", count: 1 }, { item: "core:wood", count: 5 }, { item: "core:fiber", count: 20 }], seconds: 5, xp: 3.8 }),
  { type: "engram", id: "core:engram-slingshot", label: "Slingshot", level: 5, cost: 6, item: "core:slingshot" },

  // Eaten, 4 food and 7.5 torpor over 3 seconds. Fed to an unconscious body, the torpor alone.
  { type: "item", class: "consumable", id: "core:narcoberry", stack: 100, weight: 0.1, spoilHours: minutes(10), eat: { food: 4 }, dose: { torpor: 7.5, seconds: 3 }, color: 11 },
];
