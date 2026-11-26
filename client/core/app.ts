import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { GameApp, type ClientAssets } from "./game-app.ts";
import type { ClientSession } from "./session.ts";
import { Ui } from "./ui/ui.ts";

export { MEASURED_VOLUME, type ToolOrders } from "./tool-hooks.ts";

/** An app whose panels are already present, for tools and tests. */
export class App extends GameApp {
  constructor(session: ClientSession, reg: Registry, pack: Pack, stream?: ClientAssets) {
    super(session, reg, pack, new Ui(), stream);
  }
}
