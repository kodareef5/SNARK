import { skinPart, ICON_SIZE } from "./skin.ts";
import { K_BUTTON, type UiFrame } from "./nodes.ts";
import { S_HUD_HIT, S_WARNING } from "./style.ts";

/** Three shared sprites per vital; only the foreground's source and destination rectangles change. */
export function filledVital(f: UiFrame, key: number, kind: number, x: number, y: number, size: number, value: number, label: string, interactive: boolean, showWarning = true): void {
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const warning = kind === 5 || kind === 6 ? fraction > .8 : fraction < .2;
  const k = 3000000 + key * 4;
  skinPart(f, k, x, y, size, size, kind * ICON_SIZE, 0, ICON_SIZE, ICON_SIZE);
  const rows = Math.round(fraction * ICON_SIZE);
  if (rows > 0) skinPart(f, k + 1, x, y + size * (1 - rows / ICON_SIZE), size, size * rows / ICON_SIZE, kind * ICON_SIZE, (warning ? 128 : 64) + ICON_SIZE - rows, ICON_SIZE, rows);
  skinPart(f, k + 2, x, y, size, size, kind * ICON_SIZE, 192, ICON_SIZE, ICON_SIZE);
  if (warning && showWarning) f.text(k + 3, x + size - 6, y + size - 15, 8, S_WARNING, "!");
  const hit = f.add(key, K_BUTTON, x - 4, y - 4, size + 8, size + 8, S_HUD_HIT);
  hit.label = `${label} ${Math.round(fraction * 100)}%`;
  hit.value = fraction;
  hit.interactive = interactive;
}
