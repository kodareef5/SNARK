// Device diagrams document the default bindings. Selecting a key shows its action.
import { K_BUTTON, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { glass, skinPart, PAD_X, PAD_Y, PAD_WIDTH, PAD_HEIGHT } from "./skin.ts";
import { KEY_CONTROLS_DEVICE, KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { S_HUD_HIT, S_MENU_HEADING, S_MENU_NOTE } from "./style.ts";

export const KEY_CONTROL_KEY = 5700;
export const KEY_CONTROL_DETAIL = 5800;
export const KEYBOARD_GUIDE: Readonly<Record<string, string>> = {
  W: "Forward", A: "Left", S: "Back", D: "Right", Shift: "Sprint", Space: "Jump / rise", E: "Use / ride", F: "Creature inventory", R: "Reload", G: "Melee / lower bow", C: "Crouch", X: "Prone", V: "View", I: "Inventory", P: "Character", M: "Map", H: "Inspect HUD", B: "Voice", Esc: "Menu", "−": "Map zoom out", "+": "Map zoom in", "1–0": "Hotbar",
};
const EXTRA_KEYS: Readonly<Record<string, string>> = { L: "Toggle minimap", O: "Settings", Q: "Next build snap", T: "Whistle follow", Y: "Whistle stay", J: "All follow", U: "All stay", N: "Movement modifier" };

export function buildControls(f: UiFrame, device: number, focus: number): void {
  menuBackdrop(f);
  const w = Math.min(740, f.width - 32), h = 480, x = Math.round((f.width - w) / 2), y = 120;
  glass(f, KEY_CONTROL_DETAIL, x, y, w, h);
  f.text(KEY_CONTROL_DETAIL, x + 24, y + 20, w - 140, S_MENU_HEADING, "Controls");
  smallButton(f, KEY_MENU_BACK, x + w - 80, y + 16, 56, 36, "Back", "Back", focus === KEY_MENU_BACK);
  smallButton(f, KEY_CONTROLS_DEVICE, x + 24, y + 62, 100, 34, "Keyboard", "Keyboard and mouse", device === 0);
  smallButton(f, KEY_CONTROLS_DEVICE + 1, x + 140, y + 62, 100, 34, "Controller", "Controller", device === 1);
  const scale = Math.min(1, (w - 48) / 450), cell = 38 * scale, gap = 5 * scale;
  if (device === 0) {
    const rows = [["Esc", "1–0", "−", "+"], ["Q","W","E","R","T","Y","U","I","O","P"], ["A","S","D","F","G","H","J","K","L"], ["Shift","Z","X","C","V","B","N","M"], ["Space"]];
    let id = KEY_CONTROL_KEY, detail = "W  ·  Forward";
    rows.forEach((row, r) => {
      let left = x + 24 + r * gap * 2;
      row.forEach((label) => {
        const width = label === "Space" ? cell * 5 : label === "Shift" || label === "1–0" ? cell * 1.8 : cell;
        const action = KEYBOARD_GUIDE[label] ?? EXTRA_KEYS[label];
        const active = action !== undefined;
        glass(f, id, left, y + 118 + r * (cell + gap), width, cell, active ? .85 : .3);
        const key = f.add(id++, K_BUTTON, left, y + 118 + r * (cell + gap), width, cell, S_HUD_HIT);
        key.text = label; key.label = `${label}: ${action ?? "Unbound"}`; key.interactive = active;
        if (key.key === focus) detail = `${label}  ·  ${action}`;
        left += width + gap;
      });
    });
    f.text(KEY_CONTROL_DETAIL + 1, x + 24, y + 118 + 5 * (cell + gap) + 16, w - 48, S_MENU_NOTE, "Mouse  Look  ·  Left  Attack  ·  Right  Aim");
    f.text(KEY_CONTROL_DETAIL + 5, x + 24, y + h - 96, w - 48, S_MENU_NOTE, fitText(detail,w-48,S_MENU_NOTE));
    f.text(KEY_CONTROL_DETAIL + 2, x + 24, y + h - 58, w - 48, S_MENU_NOTE, "Hold H to inspect the HUD and use map controls.");
    f.text(KEY_CONTROL_DETAIL + 3, x + 24, y + h - 34, w - 48, S_MENU_NOTE, "Esc closes one screen at a time.");
  } else {
    const dw = 320 * scale, dh = dw / 2, left = x + (w-dw)/2, top = y + 176;
    skinPart(f, KEY_CONTROL_KEY, left, top, dw, dh, PAD_X, PAD_Y, PAD_WIDTH, PAD_HEIGHT);
    const labels = [["L",.24,.36], ["R",.62,.64], ["Y",.78,.24], ["X",.71,.38], ["B",.85,.38], ["A",.78,.52], ["View",.43,.28], ["Menu",.56,.28]] as const;
    labels.forEach(([label, u, v], i) => {
      const n = f.add(KEY_CONTROL_KEY + i + 1, K_PANEL, left + u*dw-20, top + v*dh-10, 40, 20, S_HUD_HIT);
      n.text = label;
    });
    f.text(KEY_CONTROL_DETAIL + 1, x + 24, y + 108, w - 48, S_MENU_NOTE, "LT  Aim     RT  Attack     LB / RB  Hotbar");
    const notes = ["L  Move  ·  R  Look  ·  A  Jump  ·  X  Use", "B  Crouch / back  ·  Y  Reload  ·  Menu  Escape", "View  Inventory  ·  L press  Sprint  ·  R press  View", "D-pad  Navigate  ·  A  Select  ·  Up held  Inspect HUD"];
    notes.forEach((text,i)=>f.text(KEY_CONTROL_DETAIL+2+i,x+24,y+h-112+i*25,w-48,S_MENU_NOTE,fitText(text,w-48,S_MENU_NOTE)));
  }
}
