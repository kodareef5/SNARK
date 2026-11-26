// Keep the Inventory and Character entries live while their panels load on first use.

import { CMD_CLOSE } from "../../../shared/net/protocol.ts";
import { TAB_STATS, characterDock, inventoryDock } from "./bag-dock.ts";
import { K_BUTTON, K_PANEL, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { screenRows } from "./screen-rows.ts";
import { S_BUTTON, S_PANEL, S_TITLE } from "./style.ts";
import { GameUi } from "./game-ui.ts";

class WaitingPanel implements Screen {
  readonly layer = "modal";
  readonly group = "bag";
  readonly bands: readonly { from: number; count: number }[];
  readonly name: string;
  readonly hotkey: string;
  private readonly label: string;
  private readonly panelKey: number;
  private readonly load: () => void;
  open = false;
  failed = false;

  constructor(name: string, hotkey: string, label: string, panelKey: number, load: () => void) {
    this.name = name;
    this.hotkey = hotkey;
    this.label = label;
    this.panelKey = panelKey;
    this.load = load;
    this.bands = [{ from: panelKey, count: 3 }];
  }

  isOpen(): boolean { return this.open; }
  show(): void {
    this.open = true;
    this.load();
  }
  close(): void { this.open = false; }

  build(f: UiFrame): void {
    const width = Math.min(280, f.width - 24), x = (f.width - width) / 2, y = (f.height - 84) / 2;
    f.add(this.panelKey, K_PANEL, x, y, width, 84, S_PANEL);
    f.text(this.panelKey + 1, x + 12, y + 10, width - 24, S_TITLE, this.failed ? `Could not open ${this.label}` : `Opening ${this.label}…`);
    if (this.failed) {
      const retry = f.add(this.panelKey + 2, K_BUTTON, x + 12, y + 43, 80, 28, S_BUTTON);
      retry.text = "Retry";
      retry.interactive = true;
    }
  }

  pointer(kind: number, key: number, _x: number, _y: number, button: number): boolean {
    if (kind !== 0 || button !== 0 || key !== this.panelKey + 2 || !this.failed) return false;
    this.load();
    return true;
  }
}

class WaitingInventory extends WaitingPanel {
  readonly dock = inventoryDock;
  onDeploy: ((slot: number) => void) | null = null;
  containerOpen = false;

  constructor(load: () => void) { super("inventory", "KeyI", "inventory", 290, load); }

  override close(c?: ScreenCtx): void {
    super.close();
    if (c?.session?.open) c.session.command(CMD_CLOSE);
  }

  absorb(c: ScreenCtx): boolean {
    const open = !!c.session?.open, opened = open && !this.containerOpen;
    this.containerOpen = open;
    if (opened) this.show();
    return opened;
  }
}

class WaitingCharacter extends WaitingPanel {
  tab = TAB_STATS;
  readonly dock = characterDock;

  selectTab(tab: number): void { this.tab = tab; }

  constructor(load: () => void) { super("character", "KeyP", "survivor panel", 1100, load); }
}

export function playUi(load: () => Promise<typeof import("./bag-panels.ts")> = () => import("./bag-panels.ts")): GameUi {
  let pending = false;
  const request = (): void => {
    if (pending) return;
    pending = true;
    inventory.failed = character.failed = false;
    void load().then(({ InventoryScreen, CharacterScreen }) => {
      const bag = new InventoryScreen(inventory.open, inventory.containerOpen);
      bag.onDeploy = inventory.onDeploy;
      const survivor = new CharacterScreen();
      survivor.open = character.open;
      survivor.tab = character.tab;
      ui.replaceScreen(inventory, bag);
      ui.replaceScreen(character, survivor);
    }, () => {
      pending = false;
      inventory.failed = character.failed = true;
    });
  };
  const inventory = new WaitingInventory(request), character = new WaitingCharacter(request);
  const ui = new GameUi(screenRows(() => character, () => inventory));
  return ui;
}
