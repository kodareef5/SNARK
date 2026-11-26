import { CharacterScreen } from "./character.ts";
import { InventoryScreen } from "./inventory.ts";
import { screenRows } from "./screen-rows.ts";

export const SCREENS = screenRows(() => new CharacterScreen(), () => new InventoryScreen());
