// The dock owns a single browsing contact. The other thumb keeps its world action or movement.
import { EMOTE_NUMBER } from "../../../shared/anim/emotes.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../../shared/sim/items.ts";
import { KEY_HOTBAR } from "../hud/hotbar.ts";
import { hotbarCell, hotbarLeft } from "../hud/layout.ts";
import type { ClientSession } from "../session.ts";
import { DOCK_LABELS, DOCK_PAGES, dockEmote, dockSupply, supplySlot, type DockAction, type DockItem, type DockPage } from "./dock-actions.ts";
import { line, rim } from "./dock-visual.ts";
import { K_BUTTON, K_HOLD, type UiFrame } from "./nodes.ts";
import { S_HUD_HIT, S_HUD_KEY, S_LABEL } from "./style.ts";

export { runDockAction, type DockAction } from "./dock-actions.ts";
export const KEY_FIELD_HUB = 17600;
export const KEY_FIELD_LEAF = 17620;
const KEY_RIM = 17660;
const LEFT: readonly DockItem[] = ["emblem", "bag", "craft"];
const RIGHT: readonly DockItem[] = ["whistles", "kit", "gestures"];
type Dispatch = (action: DockAction) => void;
const art: Partial<Record<DockItem, string>> = { menu: "emblem", actions: "gestures", controls: "settings" };
const isPage = (id: DockItem): id is DockPage => Object.hasOwn(DOCK_PAGES, id);
const idAt = (key: number, from: number, count: number) => key >= from && key < from + count;
const slotAt = (key: number) => (key - KEY_HOTBAR) / 3;

export class FieldDock {
  page: DockPage | null = null;
  private focus = 0;
  private familyParent = false;
  private finger = -1;
  private mouseKey = -1;
  private originKey = -1;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  private startPage: DockPage | null = null;
  private expanded = 0;
  private readonly sizes = new Float32Array(HOTBAR_SLOTS);
  scaleAt(slot: number): number { return this.sizes[slot] ?? 0; }
  private clock = -1;
  private session: ClientSession | null = null;
  private reg: Registry | null = null;
  private supplyInv: Inventory | null = null;
  private supplyVersion = -1;
  private readonly supplies = new Set<DockItem>();
  private hasTarget = false;
  private hasEmote: ((id: number) => boolean) | undefined;
  private enabled = false;
  touch = false;
  private width = 0;
  private height = 0;
  preview = -1;
  get open(): boolean { return this.page !== null; }

  prepare(session: ClientSession | null, reg: Registry | null, hasTarget: boolean, touch: boolean, enabled: boolean, hasEmote?: (id: number) => boolean): void {
    if (this.enabled && !enabled || this.session !== session || this.touch !== touch) this.reset();
    if (reg !== this.reg) this.supplyVersion = -1;
    this.session = session; this.reg = reg; this.hasTarget = hasTarget;
    this.touch = touch; this.enabled = enabled && !!session; this.hasEmote = hasEmote;
  }
  reset(): void {
    this.page = null; this.focus = 0; this.familyParent = false; this.mouseKey = -1; this.release();
    this.expanded = 0; this.clock = -1; this.sizes.fill(0);
  }
  private release(): void { this.finger = this.originKey = this.preview = -1; this.dragged = false; }
  tick(now: number | undefined): void {
    if (now === undefined) return;
    const step = this.clock < 0 ? 1 : Math.min(1, Math.max(0, now - this.clock) / 170);
    this.clock = now;
    if (this.touch) for (let i = 0; i < this.sizes.length; i++) {
      const target = this.preview < 0 ? 0 : Math.max(0, 1 - Math.abs(i - this.preview) * .58);
      const size = this.sizes[i]!;
      if (size !== target) this.sizes[i] = Math.abs(target-size) < .012 ? target : size+(target-size)*Math.min(1,step*2.5);
    }
    this.expanded = this.page ? Math.min(1, this.expanded + step) : 0;
  }
  available(id: DockItem): boolean {
    if (id === "menu" || id === "controls") return this.touch;
    if (id === "attack-target") return this.hasTarget;
    if (dockEmote(id)) return this.hasEmote?.(EMOTE_NUMBER.get(id)!) ?? true;
    if (!dockSupply(id)) return true;
    const inv = this.session?.inventory ?? null;
    if (this.supplyInv !== inv || this.supplyVersion !== (inv?.version ?? -1)) {
      this.supplyInv = inv; this.supplyVersion = inv?.version ?? -1;
      this.supplies.clear();
      for (const item of DOCK_PAGES.kit) if (supplySlot(item, inv, this.reg) >= 0) this.supplies.add(item);
    }
    return this.supplies.has(id);
  }

  private choose(id: DockItem, run: Dispatch): void {
    if (!this.available(id)) return;
    if (isPage(id)) { this.show(id); return; }
    this.reset(); run(id);
  }
  private show(page: DockPage): void {
    if (!this.page) this.expanded = 0;
    this.familyParent = this.page === "actions";
    this.page = page; this.focus = 0;
    const entries = DOCK_PAGES[page];
    while (this.focus < entries.length && !this.available(entries[this.focus]!)) this.focus++;
  }
  private back(): void {
    if ((this.touch || this.familyParent) && this.page && this.page !== "actions" && this.page !== "emblem") this.show("actions");
    else this.reset();
  }
  private count(): number {
    if (!this.page) return 0;
    const entries = DOCK_PAGES[this.page];
    return entries.length - (!this.touch && (this.page === "emblem" || this.page === "kit") ? 1 : 0);
  }
  key(code: string, down: boolean, repeat: boolean, run: Dispatch): boolean {
    if (!this.enabled) return false;
    if (!this.page) {
      if (this.touch || (code !== "F2" && code !== "F4")) return false;
      if (down && !repeat) this.show(code === "F2" ? "emblem" : "actions");
      return true;
    }
    if (code === "Escape" || code === "Backspace") { if (down && !repeat) this.back(); return true; }
    if (code === "Enter" || code === "Space" || code === "NumpadEnter") {
      if (down && !repeat && this.focus < this.count()) this.choose(DOCK_PAGES[this.page][this.focus]!, run);
      return true;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(code)) {
      if (down && !repeat && /^(Digit[0-9]|Key[IMPO]|Tab|Slash|Insert)$/.test(code)) this.reset();
      return false;
    }
    if (down) {
      const count = this.count(), step = code === "ArrowLeft" || code === "ArrowUp" || code === "End" ? -1 : 1;
      if (code === "Home") this.focus = -1;
      if (code === "End") this.focus = count;
      for (let i = 0; i < count; i++) {
        this.focus = (this.focus + step + count) % count;
        if (this.available(DOCK_PAGES[this.page][this.focus]!)) break;
      }
    }
    return true;
  }

  private hub(key: number): DockItem | undefined {
    const index = key - KEY_FIELD_HUB;
    if (this.touch) return index === 0 ? "emblem" : index === 3 ? "actions" : undefined;
    return index < 3 ? LEFT[index] : RIGHT[index - 3];
  }
  pointer(kind: number, key: number, x: number, y: number, button: number, finger: number, f: UiFrame, run: Dispatch): boolean {
    if (!finger && (kind === 0 || kind === 3)) this.mouseKey = -1;
    const slot = slotAt(key), equipment = Number.isInteger(slot) && slot >= 0 && slot < HOTBAR_SLOTS;
    const hub = this.hub(key);
    const leaf = idAt(key, KEY_FIELD_LEAF, this.count());
    if (!equipment && !hub && !leaf && this.originKey !== key) return false;
    if (!this.enabled || (kind === 0 && button !== 0) || !f.find(key)?.interactive) {
      if (finger === this.finger && kind !== 2) this.release();
      return true;
    }
    if (kind === 3) {
      if (finger === this.finger) { this.page = this.startPage; this.release(); }
      return true;
    }
    if (!finger) {
      if (kind === 2 && leaf) this.focus = key - KEY_FIELD_LEAF;
      if (kind === 0) this.mouseKey = key;
      // A native keyboard click arrives from the shell without mouse coordinates or a release.
      if (this.mouseKey === key && (kind === 1 || (kind === 0 && x === 0 && y === 0))) {
        this.mouseKey = -1;
        if (equipment) { this.reset(); run(slot); }
        else if (hub) { if (this.page === hub) this.reset(); else this.choose(hub, run); }
        else if (leaf && this.page) this.choose(DOCK_PAGES[this.page][key - KEY_FIELD_LEAF]!, run);
      } else if (kind === 1) this.mouseKey = -1;
      return true;
    }
    if (kind === 0) {
      if (this.finger >= 0) return true;
      this.finger = finger; this.originKey = key; this.downX = x; this.downY = y; this.startPage = this.page;
      if (equipment) { this.page = null; this.preview = slot; }
      return true;
    }
    if (this.finger !== finger || this.originKey !== key) return true;
    const dx = x - this.downX, dy = y - this.downY;
    this.dragged ||= Math.hypot(dx, dy) >= 12;
    if (equipment) {
      this.preview = Math.max(0, Math.min(HOTBAR_SLOTS-1, Math.floor((x-hotbarLeft(f,HOTBAR_SLOTS)+1.5)/(hotbarCell(f,HOTBAR_SLOTS)+3))));
      if (kind === 1) {
        const selected = this.dragged ? this.preview : slot;
        const hit = f.find(key)!;
        const inRow = y >= hit.y - 23 && y <= hit.y + hit.h + 18;
        const equip = inRow && (!this.dragged || selected !== this.session?.held);
        this.release(); if (equip) run(selected);
      }
      return true;
    }
    const left = hub === "emblem" || this.startPage === "emblem";
    const inward = left ? dx : -dx;
    const entry = this.page && leaf ? DOCK_PAGES[this.page][key - KEY_FIELD_LEAF] : undefined;
    if (kind === 2 && this.dragged && hub && isPage(hub) && !this.page && inward > 16) this.show(hub);
    if (kind === 1) {
      const dragged = this.dragged, previous = this.startPage;
      this.release();
      if (dragged) {
        if (inward < -25) this.back();
        else if (inward > 23 && entry && isPage(entry)) this.show(entry);
        else if (inward > 18 && hub && isPage(hub) && this.page !== hub) this.show(hub);
        else if (hub && this.page === "actions") {
          const near = this.nearest(f, x, y), node = f.find(KEY_FIELD_LEAF+near);
          const family = DOCK_PAGES.actions[near];
          if (family && isPage(family) && node && x >= node.x && x <= node.x+node.w && y >= node.y && y <= node.y+node.h) this.show(family);
        } else if (this.page && !hub) this.focus = this.nearest(f, x, y);
      } else if (hub) {
        if (hub === previous || (hub === "actions" && previous && previous !== "emblem")) this.back(); else this.choose(hub, run);
      } else if (entry) this.choose(entry, run);
    } else if (this.dragged && this.page) {
      this.focus = this.nearest(f, x, y);
    }
    return true;
  }
  private nearest(f: UiFrame, x: number, y: number): number {
    let chosen = this.focus, distance = Infinity;
    for (let i = 0; i < this.count(); i++) {
      const n = f.find(KEY_FIELD_LEAF+i);
      if (!n) continue;
      const d = Math.hypot(x-n.x-n.w/2,y-n.y-n.h/2);
      if (d < distance) { distance = d; chosen = i; }
    }
    return chosen;
  }

  draw(f: UiFrame, x: number, end: number, bottom: number, controls: boolean): void {
    if (this.width && (this.width !== f.width || this.height !== f.height)) this.reset();
    this.width = f.width; this.height = f.height;
    if (!controls || !this.enabled) return;
    const narrow = x < f.left + 120;
    const size = this.touch ? 35 : Math.max(24, Math.min(36, Math.floor((x-f.left-16)/3)));
    const left = this.touch ? f.left : narrow ? x : x - size*3-10;
    const right = this.touch ? f.width-f.right : narrow ? end-size*3 : end+10;
    const cy = this.touch ? f.top + (f.height-f.top-f.bottom)*.60 : bottom-(narrow ? hotbarCell(f,HOTBAR_SLOTS)+size/2+6 : size/2);
    if (this.touch) {
      this.edge(f,true,left,cy); this.edge(f,false,right,cy);
    } else {
      for (let i=0;i<3;i++) {
        this.tile(f,KEY_FIELD_HUB+i,LEFT[i]!,left+i*size,cy-size/2,size,size,false,false);
        this.tile(f,KEY_FIELD_HUB+3+i,RIGHT[i]!,right+i*size,cy-size/2,size,size,false,false);
      }
    }
    if (!this.page) return;
    const count = this.count(), entries = DOCK_PAGES[this.page], onLeft = this.page === "emblem";
    if (this.touch) {
      const edge = onLeft ? left : right;
      const radius = Math.min(152,(f.height-f.top-f.bottom)*.30,(f.width-f.left-f.right)*.39);
      const size = Math.min(46, 2.58*radius/(count+1));
      const spread = count > 4 ? 1.30 : .87;
      for (let i=0;i<count;i++) {
        const a = count === 1 ? 0 : -spread+2*spread*i/(count-1);
        const distance = radius*(.65+.13*this.expanded);
        const px = edge + (onLeft ? 1 : -1)*Math.cos(a)*distance;
        this.tile(f,KEY_FIELD_LEAF+i,entries[i]!,px-size/2,cy+Math.sin(a)*distance-size/2,size,size,i===this.focus,true);
      }
    } else {
      const w = Math.min(76, (f.width-f.left-f.right-12)/count), h=56;
      const x0 = Math.max(f.left+4, Math.min(f.width-f.right-count*w-4, onLeft ? left : right+size*3-count*w));
      const y = cy-size/2-h-7;
      for (let i=0;i<count;i++) this.tile(f,KEY_FIELD_LEAF+i,entries[i]!,x0+i*w,y,w,h,i===this.focus,true);
    }
  }

  private edge(f: UiFrame, left: boolean, edge: number, cy: number): void {
    const opened = left ? this.page==="emblem" : !!this.page && this.page!=="emblem";
    const radius = opened ? Math.min(152,(f.height-f.top-f.bottom)*.30,(f.width-f.left-f.right)*.39) : 30;
    const key = KEY_FIELD_HUB + (left ? 0 : 3);
    rim(f,KEY_RIM+(left?0:1),left,edge,cy,radius,opened?1:.71,opened ? .30 + .70*this.expanded : 1);
    const x = left ? edge : edge-35;
    this.tile(f,key,left?"emblem":"actions",x,cy-24,35,48,false,false);
  }
  private tile(f: UiFrame, key: number, id: DockItem, x: number, y: number, w: number, h: number, active: boolean, leaf: boolean): void {
    const enabled = this.available(id);
    if (!this.touch) {
      line(f,key+100,x+1,y+1,w-2,h-2,active?0x24526d:0x0b2438,active?.84:.61);
      line(f,key+160,x+1,y+h-2,w-2,active?2:1,active?0xa3e5ff:0x86acc2,active?1:.65);
    }
    const caption = leaf && (!this.touch || active);
    const icon = Math.min(w-4,h-(caption ? 14 : 4));
    const pic = f.picture(key+220,x+(w-icon)/2,y+(h-icon)/2-(caption?4:0),icon,icon,S_LABEL,"ui:glass-"+(art[id]??id));
    if (pic) pic.alpha = enabled ? 1 : .39;
    if (caption || !pic) {
      const n = f.text(key+280,x-(this.touch?8:0),y+h-15,w+(this.touch?16:0),S_HUD_KEY,DOCK_LABELS[id]);
      n.alpha = enabled ? .95 : .6;
    }
    const hit = f.add(key,this.touch?K_HOLD:K_BUTTON,x,y,w,h,S_HUD_HIT);
    hit.interactive = true; hit.label = DOCK_LABELS[id] + (enabled?"":" (unavailable)");
  }
}
