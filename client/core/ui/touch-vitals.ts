// The upper-left status sheet uses the same live reserves as its compact strip.
import { xpText } from "../hud/level.ts";
import { KEY_VITAL } from "../hud/vitals.ts";
import type { TouchPlan } from "./touch.ts";
import { K_BUTTON, K_PANEL, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { glass } from "./skin.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_ICE, S_LABEL, S_MENU_NOTE, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_STATUS_STRIP = 18500;
export const KEY_STATUS_CLOSE = 18501;
const PANEL = 18502;
const ROW = 18510;

export class TouchVitals implements Screen {
  readonly name = "vitals";
  readonly layer = "modal";
  readonly keepsField = true;
  readonly bands = [{ from: KEY_STATUS_STRIP, count: 48 }];
  private open = false;

  private readonly plan: TouchPlan;
  constructor(plan: TouchPlan) { this.plan = plan; }

  isOpen(): boolean { return this.open; }
  close(): void { this.open = false; }

  absorb(c: ScreenCtx): void {
    if (this.open && (c.inputDevice !== 2 || c.covered || c.screens.some(s => s !== this && s.isOpen()))) this.close();
  }

  pressWorld(): boolean { this.close(); return true; }

  key(code: string, down: boolean): boolean {
    if (code !== "Escape") return false;
    if (down) this.close();
    return true;
  }

  pointer(kind: number, key: number, _x: number, _y: number, button: number): boolean {
    if (kind === 0 && button === 0) {
      if (key === KEY_STATUS_STRIP) this.open = !this.open;
      if (key === KEY_STATUS_CLOSE) this.close();
    }
    return true;
  }

  play(f: UiFrame, c: ScreenCtx): void {
    if (c.inputDevice !== 2 || !c.hud || c.hud.bare || c.covered || c.screens.some(s => s !== this && s.isOpen())) return;
    const first = f.find(KEY_VITAL + 1);
    if (!first) return;
    let end = first.x + first.w;
    for (let i = 1; i < c.hud.vitals.length; i++) {
      const hit = f.find(KEY_VITAL + 2 * i + 1);
      if (hit) end = hit.x + hit.w;
    }
    const { toolsX: x, toolsY: bottom, toolSize } = this.plan;
    const y = Math.max(f.top, bottom - toolSize);
    const hit = f.add(KEY_STATUS_STRIP, K_BUTTON, x, y, end - x, bottom - y, S_HUD_HIT);
    hit.interactive = true;
    hit.label = this.open ? "Close vitals" : "Inspect vitals";
  }

  build(f: UiFrame, c: ScreenCtx): void {
    const hud = c.hud, strip = f.find(KEY_STATUS_STRIP);
    if (!hud || !strip) return;
    const px = 1 / f.unit, x = strip.x, y = strip.y + strip.h + 3 * px;
    const w = Math.min(257 * px, f.width - f.right - x - 8 * px), header = 44 * px;
    const gap = 12 * px, row = (f.width > f.height ? 27 : 32) * px;
    const shown = hud.vitals.filter((_v, i) => f.find(KEY_VITAL + i * 2 + 1));
    const level = hud.levelBar;
    const h = header + shown.length * row + (level.shown ? 28 : 8) * px;
    const surface = f.add(PANEL, K_PANEL, x, y, w, h, S_PANEL);
    surface.interactive = true; surface.label = "Survivor status";
    glass(f, PANEL, x, y, w, h, .74);
    f.text(PANEL + 1, x + gap, y + 9 * px, w - header - gap, S_TITLE, "Vitals");
    const close = f.add(KEY_STATUS_CLOSE, K_BUTTON, x + w - header, y, header, header, S_HUD_HIT);
    close.text = "×"; close.label = "Close vitals"; close.interactive = true;
    for (let i = 0; i < shown.length; i++) {
      const vital = shown[i]!, key = ROW + i * 6, top = y + header + i * row;
      const value = Math.min(1, Math.max(0, vital.fraction));
      const risk = vital.id === "torpor" ? value : 1 - value;
      const rising = (vital.recoveringUntil ?? 0) > hud.vitalTick;
      let warning = "";
      if (risk >= 1) warning = vital.id === "torpor" ? "Unconscious" : "Depleted";
      else if (rising) warning = "Recovering";
      else if (risk > .8) warning = vital.id === "torpor" ? "High" : "Low";
      const ink = risk >= 1 ? 0xff91a2 : rising ? 0x91edcc : risk > .8 ? 0xffd28c : 0xa2dbed;
      f.picture(key, x + gap, top + 2 * px, 19 * px, 19 * px, S_LABEL, "ui:glass-" + vital.id);
      const left = x + gap + 27 * px, line = w - (left - x) - gap;
      f.text(key + 1, left, top, line - 55 * px, S_LABEL, vital.label);
      if (warning) f.text(key + 2, left + 55 * px, top, line - 94 * px, S_MENU_NOTE, warning);
      f.text(key + 3, x + w - gap - 38 * px, top, 38 * px, S_HUD_COUNT, Math.round(100 * value) + "%");
      const track = top + row - 7 * px;
      f.add(key + 4, K_PANEL, left, track, line, 2 * px, S_ICE).alpha = .22;
      if (value) f.add(key + 5, K_PANEL, left, track, line * value, 2 * px, S_ICE).tint = ink;
    }
    if (level.shown) {
      const points = level.points === 1 ? "1 point" : level.points + " points";
      f.text(PANEL + 2, x + gap, y + h - 24 * px, w - gap * 2, S_MENU_NOTE,
        "Level " + level.level + " · " + xpText(level.xp) + " XP" + (level.points > 0 ? " · " + points + " to spend" : ""));
    }
  }
}
