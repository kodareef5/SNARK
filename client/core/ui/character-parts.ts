// The character screen's tabs that other files add, after its own three. A tab is a ScreenPart (screen.ts) in a file of
// its own and one line here; the screen gives it its keys, so no part picks numbers.

import type { ScreenPart } from "./screen.ts";

export const CHARACTER_PARTS: readonly ScreenPart[] = [];
