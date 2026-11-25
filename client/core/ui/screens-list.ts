// The screens, in the order they are asked: the first open modal screen is the one built, and a key goes to the open
// screens in this order. A new screen is a file of its own (screen.ts) and one line here.

import type { ScreenRow } from "./screen.ts";
import { AirRadio } from "./air-support.ts";
import { CharacterScreen } from "./character.ts";
import { ChoosingScreen } from "./choosing.ts";
import { CreatorScreen } from "./creator.ts";
import { EmoteMenu } from "./emotes.ts";
import { FieldDock } from "./field-dock.ts";
import { HammerPanel } from "./hammer.ts";
import { InventoryScreen } from "./inventory.ts";
import { MapScreen } from "./screens.ts";
import { MenuScreen } from "./menu-screen.ts";
import { NamePrompt } from "./tame.ts";
import { StructMenu } from "./structure.ts";
import { TravelScreen } from "./travel.ts";

export const SCREENS: readonly ScreenRow[] = [
  () => new NamePrompt(),
  () => new MenuScreen(),
  () => new CreatorScreen(),
  () => new ChoosingScreen(),
  () => new CharacterScreen(),
  () => new EmoteMenu(),
  () => new MapScreen(),
  () => new TravelScreen(),
  () => new InventoryScreen(),
  () => new StructMenu(),
  () => new HammerPanel(),
  () => new AirRadio(),
  () => new FieldDock(),
];
