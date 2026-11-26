import { GameUi } from "./game-ui.ts";
import { SCREENS } from "./screens-list.ts";

/** The interface with every screen available synchronously for tools and tests. */
export class Ui extends GameUi {
  constructor() { super(SCREENS); }
}
