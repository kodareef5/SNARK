// The screens, in the order they are asked: the first open modal screen is the one built, and a key goes to the open
// screens in this order. A new screen is a file of its own (screen.ts) and one line here.

import type { ScreenRow } from "./screen.ts";
import { CharacterScreen } from "./character.ts";
import { EmoteMenu } from "./emotes.ts";
import { TravelScreen } from "./travel.ts";

export const SCREENS: readonly ScreenRow[] = [
  () => new CharacterScreen(),
  () => new EmoteMenu(),
  () => new TravelScreen(),
];
