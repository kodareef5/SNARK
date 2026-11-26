// The touch equipment lens and thumb wheels, in CSS pixels inside the device's safe area.
import { KEY_TOUCH_BUTTON, T_COUNT } from "../touch.ts";
import { HOTBAR_SLOTS } from "../../../shared/sim/items.ts";
import { KEY_HOTBAR, KEY_HOTBAR_LIT, KEY_HOTBAR_RAIL, type HotbarModel } from "../hud/hotbar.ts";
import { line } from "./dock-visual.ts";
import { K_BUTTON, K_PANEL, fitText, textWidth, type UiFrame } from "./nodes.ts";
import { S_HUD_HIT, S_HUD_KEY, S_LABEL } from "./style.ts";

const wrapSlot = (i: number): number => (i % HOTBAR_SLOTS + HOTBAR_SLOTS) % HOTBAR_SLOTS;
const distance = (phase: number, i: number): number => wrapSlot(i - phase + HOTBAR_SLOTS / 2) - HOTBAR_SLOTS / 2;

function belt(f: UiFrame) {
  const u = 1 / f.unit, width = f.width - f.left - f.right;
  const w = Math.min(800 * u, width * (width > f.height && f.height < 540 * u ? .63 : .71));
  const pitch = Math.max(44 * u, Math.min(50 * u, w * .066));
  const half = Math.min(w / 2, (w < 390 * u ? 2.55 : 3.55) * pitch);
  return { u, pitch, half, cx: f.left + width / 2, foot: f.height - f.bottom, travel: Math.min(80 * u, Math.max(49 * u, w / 9.3)) };
}

/** The item under a sliding thumb, and the space the shelf moves with it. */
export function slide(f: UiFrame, start: number, x: number, dx: number, center: number) {
  const b = belt(f), reach = b.half - 21 * b.u;
  const shift = Math.max(b.cx - reach, Math.min(b.cx + reach, x + dx)) - x;
  return { phase: center - dx / b.travel + shift / b.pitch, preview: wrapSlot(start - Math.round(dx / b.travel)) };
}

/** The hit boxes follow the item pictures and the labels follow the real inventory. */
export function drawBelt(f: UiFrame, m: HotbarModel): void {
  const { u, pitch, half, cx, foot } = belt(f);
  const phase = m.dockPhase ?? Math.max(0, m.held);
  const browsing = m.dockPreview >= 0, rise = browsing ? 1 : 0;
  const railY = foot - (11 + 10 * rise) * u, left = cx - half, width = 2 * half;
  line(f, KEY_HOTBAR_RAIL, left, railY, width, (8 + 10 * rise) * u, 0x183b53, .62);
  line(f, KEY_HOTBAR_RAIL + 1, left, railY, width, u, 0xb7e4ef, .76);
  line(f, KEY_HOTBAR_RAIL + 2, left, foot - 4 * u, width, u, 0x91c5d2, .58);
  for (let i = 0; i < m.hotbar.length; i++) {
    const slot = m.hotbar[i]!, chosen = i === m.held;
    const rel = distance(phase, i), mag = m.dockSizes[i] ?? 0;
    const offset = Math.sign(distance(m.dockPreview, i)) * Math.max(0, 1 - Math.abs(distance(m.dockPreview, i)) / 4) * 9 * rise * u;
    const baseX = cx + rel * pitch, x = baseX + offset, edge = half - Math.abs(baseX - cx);
    if (edge < 4 * u) continue;
    const size = ((chosen ? 23 : 17) + 4 * rise + 29 * mag) * u;
    const y = foot - (7 + Number(chosen) + 3 * rise + 10 * mag) * u - size;
    const key = KEY_HOTBAR + i * 3, hitW = Math.min(44 * u, pitch - u, edge * 2);
    f.add(key, K_PANEL, baseX - hitW / 2, foot - Math.max(44 * u, foot - y), hitW, Math.max(44 * u, foot - y), S_HUD_HIT);
    const alpha = Math.min(1, edge / (21 * u));
    if (chosen) line(f, KEY_HOTBAR_LIT + i, x - 4.5 * u, foot - 7 * u, 9 * u, 3 * u, 0x90e8ff, alpha);
    if (slot.tint >= 0) {
      const pic = f.picture(key + 1, x - size / 2, y, size, size, S_LABEL, slot.id ?? "");
      if (pic) pic.alpha = alpha * (chosen ? 1 : .84 + .16 * mag);
      else f.text(key + 1, x - hitW / 2, y, hitW, S_HUD_KEY, fitText(slot.label, hitW, S_HUD_KEY));
    } else {
      line(f, key + 1, x - 2 * u, foot - 8 * u, 4 * u, u, 0xa8c5d5, .5 * alpha);
    }
    if (i === m.dockPreview && mag > .45) {
      const label = slot.name || slot.label || "Empty slot";
      const capW = Math.min(width, textWidth(label, S_HUD_KEY) + 14 * u);
      const capX = Math.max(left, Math.min(cx + half - capW, x - capW / 2));
      line(f, KEY_HOTBAR_RAIL + 3, capX, y - 23 * u, capW, 20 * u, 0x071f31, .82 * mag);
      f.text(key + 2, capX, y - 22 * u, capW, S_HUD_KEY, fitText(label, capW, S_HUD_KEY)).alpha = mag;
    }
  }
}

interface TouchWheel {
  cx: number; cy: number; radius: number; station: number; cell: number; angle(i: number): number;
}

/** The left disc pulls fully into view; the right fan opens about a hub at the safe edge. */
function wheel(f: UiFrame, left: boolean, expanded: number, nested: boolean, count: number, focus: number): TouchWheel {
  const u = 1 / f.unit, w = f.width - f.left - f.right, h = f.height - f.top - f.bottom;
  if (left) {
    const radius = Math.min(185 * u, h * .38, w * (w > h ? .21 : .369));
    const resting = Math.max(-radius * .50, 22 * u - radius * .745);
    const cx = f.left + resting + (radius + Math.max(14 * u, w * .017) - resting) * expanded;
    const cy = f.top + Math.max(radius + 8 * u, Math.min(h * .556, h - radius - 8 * u));
    const station = radius * .753;
    return { cx, cy, radius, station, cell: Math.min(radius * .45, 1.92 * station * Math.sin(Math.PI / Math.max(3, count))), angle: i => (i - focus) * 2 * Math.PI / count };
  }
  const radius = Math.max(70 * u, Math.min(116 * u, h * .22, w * .273));
  const cx = f.width - f.right + radius * .80 * (1 - expanded) - 26 * u * expanded;
  const cy = f.top + h * .51;
  const station = radius * (nested ? 1.45 : 1);
  return { cx, cy, radius, station, cell: Math.min(50 * u, station * 2.4 / Math.max(3, count)), angle: i => Math.PI - (((i - focus + Math.floor(count / 2) + count) % count) - Math.floor(count / 2)) * 2.08 / Math.max(1, count - 1) };
}

/** Crop the glass at the safe edge so a cutout never occludes a touch target. */
function face(f: UiFrame, key: number, art: string, cx: number, cy: number, side: number, alpha: number): boolean {
  const fullX = cx - side / 2, x = Math.max(f.left, fullX), end = Math.min(f.width - f.right, fullX + side);
  if (end <= x) return false;
  const pic = f.picture(key, x, cy - side / 2, end - x, side, S_LABEL, art);
  if (!pic) return false;
  const sw = pic.sw;
  pic.sx += sw * (x - fullX) / side;
  pic.sw = sw * (end - x) / side;
  pic.alpha = alpha;
  return true;
}

interface WheelLeaf { id: string; label: string; art: string }
interface Wheels {
  page: string | null;
  focus: number;
  expanded: number;
  menu: readonly WheelLeaf[];
  actions: readonly WheelLeaf[];
  entries: readonly WheelLeaf[];
  hubs: number;
  leaves: number;
  rims: number;
  tile(key: number, leaf: WheelLeaf, x: number, y: number, size: number, active: boolean): void;
  hub(key: number, label: string, x: number, y: number, width: number, height: number): void;
}

export function drawWheels(f: UiFrame, view: Wheels): void {
  const u = 1 / f.unit;
  for (const left of [true, false]) {
    const open = left ? view.page === "emblem" : Boolean(view.page && view.page !== "emblem");
    const nested = open && !left && view.page !== "actions";
    const entries = open ? view.entries : left ? view.menu : view.actions;
    const focus = open ? Math.min(view.focus, entries.length - 1) : 0;
    const w = wheel(f, left, open ? 1 : 0, nested, entries.length, focus);
    const { cx, radius } = w;
    let cy = w.cy;
    const reach = Math.max(48 * u, left ? cx + radius - f.left : f.width - f.right - cx + radius * 1.3);
    const edge = left ? f.left : f.width - f.right - reach;
    const hitH = 64 * u;
    if (!open) {
      let top = f.top, bottom = f.height - f.bottom;
      // Vehicles and construction add held controls at the edge nearest the fan.
      for (let j = 0; j < f.count; j++) {
        const n = f.nodes[j]!;
        if (n.key < KEY_TOUCH_BUTTON || n.key >= KEY_TOUCH_BUTTON + T_COUNT || n.x + n.w <= edge || n.x >= edge + reach) continue;
        if (n.y + n.h / 2 < cy) top = Math.max(top, n.y + n.h);
        else bottom = Math.min(bottom, n.y);
      }
      cy = Math.max(top + hitH / 2, Math.min(bottom - hitH / 2, cy));
    }
    const base = view.rims + (left ? 0 : 1), alpha = open ? .76 + .24 * view.expanded : view.page ? .4 : 1;
    const painted = left
      ? face(f, base, "ui:mobile-wheel", cx, cy, radius / .49, alpha)
      : face(f, base, "ui:mobile-fan", cx, cy, radius * (nested ? .69 : 1) / .375, .72 * alpha);
    if (nested) {
      face(f, base + 2, "ui:mobile-fan", cx, cy, w.station / .375, alpha);
      const chosen = view.actions.findIndex(entry => entry.id === view.page);
      for (let i = 0; i < view.actions.length; i++) {
        const angle = (i - chosen + 4) % 3 - 1;
        const station = radius * .69;
        face(f, base + 8 + i, "ui:glass-" + view.actions[i]!.art, cx - Math.cos(angle) * station, cy + Math.sin(angle) * station, radius * .27, i === chosen ? .93 : .56);
      }
    }
    const hub = view.hubs + (left ? 0 : 3);
    if (open) {
      const d = Math.min(52 * u, radius * .49);
      face(f, hub + 300, "ui:glass-emblem", cx, cy, d, alpha);
      view.hub(hub, left ? "Field menus" : "Actions", cx - d / 2, cy - d / 2, d, d);
    } else {
      view.hub(hub, left ? "Field menus" : "Actions", edge, cy - hitH / 2, reach, hitH);
      if (!painted) f.text(base + 4, edge, cy - 9 * u, reach, S_HUD_KEY, left ? "Menus" : "Actions");
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!, angle = w.angle(i);
      const x = cx + Math.cos(angle) * w.station, y = cy + Math.sin(angle) * w.station;
      if (open && x >= f.left && x <= f.width - f.right) {
        const size = Math.min(w.cell, 2 * (x - f.left), 2 * (f.width - f.right - x));
        view.tile(view.leaves + i, entry, x - size / 2, y - size / 2, size, i === focus);
      } else if (!open && (i === focus || left)) {
        face(f, base + 200 + i * 2, "ui:glass-" + entry.art, x, y, w.cell * .73, (i === focus ? .88 : .58) * alpha);
      }
    }
    if (open && entries[focus]) {
      const text = entries[focus]!.label;
      const capW = Math.min(160 * u, textWidth(text, S_HUD_KEY) + 20 * u);
      const capX = Math.max(f.left, Math.min(f.width - f.right - capW, (left ? cx : cx - w.station * .69) - capW / 2));
      const capY = Math.max(f.top, cy - (left ? radius : w.station) - 23 * u);
      line(f, base + 4, capX, capY, capW, 20 * u, 0x072235, .8);
      f.text(base + 6, capX, capY, capW, S_HUD_KEY, fitText(text, capW, S_HUD_KEY));
    }
  }
}

/** The study's small question mark has a full thumb target beside the shelf. */
export function helpButton(f: UiFrame, key: number): void {
  const { cx, half, u } = belt(f);
  const size = 44 * u, d = 19 * u;
  const right = f.width - f.right;
  const x = Math.min(right - size, Math.max(cx + half + 2 * u, f.width - 20 * u - size));
  const y = f.height - Math.max(f.bottom, 12 * u) - size;
  const hit = f.add(key, K_BUTTON, x, y, size, size, S_HUD_HIT);
  hit.interactive = true;
  hit.label = "Touch controls";
  const pic = f.picture(key + 1, x + (size - d) / 2, y + (size - d) / 2, d, d, S_LABEL, "ui:mobile-help");
  if (pic) pic.alpha = .78;
  else f.text(key + 1, x, y + (size - 16 * u) / 2, size, S_HUD_KEY, "?");
}
