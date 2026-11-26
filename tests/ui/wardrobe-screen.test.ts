// The inventory screen's wardrobe row: a cell per slot under its own label, a worn garment's dye as swatches, and a stack
// picked up that a slot would refuse kept in hand rather than sent.
import { expect, test } from "bun:test";
import { InventoryScreen, KEY_INV_DYE, KEY_INV_INFO, KEY_INV_ROW_LABEL, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { CMD_MOVE } from "../../shared/net/protocol.ts";
import { WARDROBE_NAMES, WARDROBE_SLOTS } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";
import { editionOf } from "../fixtures/editions.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
/** A palette whose colour `i` is red `i`, green 1 and blue 2, so a swatch's tint names the colour it shows. */
const palette = Uint8Array.from({ length: 256 * 4 }, (_, k) => (k % 4 === 0 ? k / 4 : k % 4));
const cell = (slot: number): number => KEY_INV_SLOT + slot * 3;

test("the wardrobe row shows each slot, a dyed garment's swatches, and refuses what does not fit", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const s = h.join("ada");
    h.run(500);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const items = h.host.items;
    const inv = items.inv(me);
    expect(items.mintAt(me, inv.wardrobe, id("plain_tee"), 1)).toBe(1);
    const edition = editionOf(h.host, "core:plain_tee");
    expect(items.restyle(me, inv.wardrobe, edition, 12 | (0 << 8) | (40 << 16))).toBe(true);
    expect(items.mint(me, id("plain_trousers"), 1)).toBe(1);
    h.run(300);
    const own = s.inventory!;
    const screen = new InventoryScreen();
    screen.open = true;
    const f = new UiFrame();
    const draw = (): void => {
      f.begin(16 / 9);
      screen.draw(f, s, reg, palette);
    };
    draw();
    expect(f.find(KEY_INV_ROW_LABEL + 2)?.text).toBe("Clothes");
    for (let k = 0; k < WARDROBE_SLOTS; k++) expect(f.find(cell(own.wardrobe + k))?.interactive).toBe(true);
    expect(f.find(cell(own.wardrobe + 2))?.label).toBe(`Empty ${WARDROBE_NAMES[2]} slot`);
    // Its first and third colours show; the second is the tee's own.
    expect(f.find(KEY_INV_DYE)?.tint).toBe((12 << 16) | (1 << 8) | 2);
    expect(f.find(KEY_INV_DYE + 1)).toBeNull();
    expect(f.find(KEY_INV_DYE + 2)?.tint).toBe((40 << 16) | (1 << 8) | 2);
    // A row ten wide holds the armor and the wardrobe side by side.
    expect(f.find(cell(own.wardrobe))!.y).toBe(f.find(cell(own.armor))!.y);
    expect(f.find(cell(own.wardrobe))!.x).toBeGreaterThan(f.find(cell(own.armor + 4))!.x);
    // Hovered, the tee says its edition and dye.
    screen.press(2, cell(own.wardrobe), 0, s);
    draw();
    expect(f.find(KEY_INV_INFO)?.text).toContain(`edition ${edition}`);
    // The trousers picked up: the top's cell is dimmed and a click on it sends nothing; the bottom's takes them.
    const sent: number[] = [];
    const command = s.command.bind(s);
    s.command = (op, args) => (sent.push(op), command(op, args));
    const trousers = own.item.indexOf(id("plain_trousers"));
    screen.press(0, cell(trousers), 0, s);
    draw();
    expect(f.find(cell(own.wardrobe))!.alpha).toBeLessThan(1);
    expect(f.find(cell(own.wardrobe + 1))!.alpha).toBeGreaterThan(f.find(cell(own.wardrobe + 2))!.alpha);
    screen.press(0, cell(own.wardrobe), 0, s);
    expect(sent).toEqual([]);
    expect(screen.held).toBe(trousers);
    screen.press(0, cell(own.armor + 3), 0, s);
    expect(sent).toEqual([]);
    screen.press(0, cell(own.wardrobe + 1), 0, s);
    expect(sent).toEqual([CMD_MOVE]);
    h.run(300);
    expect([own.item[own.wardrobe + 1], screen.held]).toEqual([id("plain_trousers"), -1]);
  } finally {
    h.host.shutdown();
  }
});
