import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_WAIT, SESSION_ALIVE, SESSION_CREATING, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import { AIR_ACTION, AIR_BAYS, type AirPose } from "../../../shared/sim/air-support.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayHit } from "../../../shared/world/ray.ts";
import type { Camera } from "../render/camera.ts";
import type { ClientSession, RemoteSample } from "../session.ts";
import { fitText, K_BUTTON, K_PANEL, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { feedButtons } from "../hud/air-feed.ts";
import { S_BUTTON, S_HUD_COUNT, S_LABEL, S_MENU_FOCUS, S_PANEL, S_TITLE, S_WARNING } from "./style.ts";

const BASE = 43100;
export const AIR_RADIO_KEY = BASE + 1;
const TRAILER = BASE + 2, GROUND = BASE + 3, CANCEL = BASE + 4, PANELS = BASE + 5;
const LAUNCH = BASE + 6, HITCH = BASE + 7, CLOSE = BASE + 8, BAY = BASE + 10;
const CONFIRM = BASE + 17, ROTATE = BASE + 18, PAYLOAD = BASE + 19, LEAVE = BASE + 20;
const REASONS: Record<number, string> = {
  [RESULT_BUSY]: "Equipment is busy.",
  [RESULT_WAIT]: "The carrier is on cooldown.",
  [RESULT_NOT_YOURS]: "Your tribe does not own this equipment.",
  [RESULT_OBSTRUCTED]: "The delivery needs more clearance.",
  [RESULT_NO_SUPPORT]: "Move to clear, level ground.",
  [RESULT_FAR]: "Move closer to the rack or landing spot.",
  [RESULT_DENIED]: "The equipment cannot take that order now.",
  [RESULT_INVALID]: "That order is no longer available.",
};

function button(f: UiFrame, key: number, x: number, y: number, w: number, label: string, active = true, selected = false): void {
  const node = f.add(key, K_BUTTON, x, y, w, 36, selected ? S_MENU_FOCUS : S_BUTTON);
  node.text = label;
  node.interactive = active;
  node.alpha = active ? 1 : 0.5;
}

export class AirRadio implements Screen {
  readonly name = "air";
  readonly layer = "modal";
  readonly holdsKeys = true;
  readonly focusNav = true;
  readonly bands = [{ from: BASE, count: 41 }];
  open = false;
  marking = false;
  cab = false;
  readonly spot: AirPose = { x: 0, y: 0, z: 0, yaw: 0 };
  private turn = 0;
  private altitude = 0;
  private pending = 0;
  private lastAction = -1;
  private refusal = "";
  private refusalUntil = 0;

  update(s: ClientSession, r: RemoteSample, world: CollisionWorld, cam: Camera): void {
    const semi = s.registry.index.get("core:semi");
    this.cab = semi !== undefined && s.driving >= 0 && s.bodyKind === semi;
    if (!this.cab && semi !== undefined && s.own.seat > 0) {
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] === s.own.seat - 1 && r.gen[i] === s.own.seatGen && r.kind[i] === semi) { this.cab = true; break; }
      }
    }
    if (!this.available(s)) this.open = false;
    if (!this.cab || s.airSupport.order || s.airSupport.flight) this.marking = false;
    if (s.airSupport.flight) {
      this.open = false;
      this.altitude = Math.max(0, Math.round(cam.y - world.hf.heightAt(cam.x, cam.z)));
    }
    if (!this.marking) return;
    const cp = Math.cos(cam.pitch);
    const dx = cp * Math.sin(cam.yaw), dy = Math.sin(cam.pitch), dz = cp * Math.cos(cam.yaw);
    const distance = castWorld(world, cam.x, cam.y, cam.z, dx, dy, dz, 25) === HIT_NONE ? 17 : rayHit.t;
    this.spot.x = cam.x + dx * distance;
    this.spot.z = cam.z + dz * distance;
    this.spot.y = world.hf.heightAt(this.spot.x, this.spot.z);
    this.spot.yaw = this.turn * Math.PI / 8;
  }

  isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.open = this.marking = false;
  }

  /** Death, the creator and a closed connection end any order being made. */
  absorb(c: ScreenCtx): void {
    const s = c.session;
    if (s && (s.sessionState === SESSION_DEAD || s.sessionState === SESSION_CREATING || s.state === "closed")) this.close();
  }

  build(f: UiFrame, c: ScreenCtx): void {
    if (c.session) this.draw(f, c.session, c.focus);
  }

  play(f: UiFrame, c: ScreenCtx): void {
    if (c.session) this.hud(f, c.session, c.inputDevice);
  }

  key(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    return c.session !== null && this.radioKey(code, down, repeat, c.session);
  }

  playKey(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    return c.session !== null && this.radioKey(code, down, repeat, c.session);
  }

  pointer(kind: number, key: number, _x: number, _y: number, button: number, c: ScreenCtx): boolean {
    return kind === 0 && button === 0 && c.session !== null && this.click(key, c.session);
  }

  result(seq: number, code: number, c: ScreenCtx): void {
    this.answer(seq, code, c.session?.tickClock ?? 0);
  }

  available(s: ClientSession): boolean {
    return s.state === "active" && s.sessionState === SESSION_ALIVE && !!(this.cab || s.airSupport.pod || s.airSupport.order || s.airSupport.flight);
  }

  radioKey(code: string, down: boolean, repeat: boolean, s: ClientSession): boolean {
    if (!this.available(s)) return false;
    const flight = s.airSupport.flight;
    let key = 0;
    if (flight) key = code === "KeyE" ? PAYLOAD : code === "KeyJ" ? LEAVE : 0;
    else if (this.marking) key = code === "KeyE" ? CONFIRM : code === "KeyQ" ? ROTATE : code === "Escape" || code === "KeyJ" ? CLOSE : 0;
    else if (this.open) {
      const digit = Number(code.replace(/^Digit/, ""));
      key = /^Digit[1-6]$/.test(code) ? BAY + digit - 1
        : code === "Escape" || code === "KeyJ" ? CLOSE : code === "Enter" ? LAUNCH : 0;
      if (!key) return true;
    } else if (code === "KeyJ") key = AIR_RADIO_KEY;
    if (!key) return false;
    if (down && !repeat) this.click(key, s);
    return true;
  }

  click(key: number, s: ClientSession): boolean {
    if (!this.available(s)) return false;
    if (key === CLOSE) { this.open = this.marking = false; return true; }
    if (key === AIR_RADIO_KEY) { this.open = true; return true; }
    if (key === ROTATE && this.marking) { this.turn = (this.turn + 1) % 16; return true; }
    const v = s.airSupport;
    const pod = v.pods.find(row => row.id === v.pod);
    if (key === GROUND && this.open && this.cab && !v.order && !this.pending) {
      this.open = false;
      this.marking = true;
      this.turn = Math.round(s.own.vehicleYaw * 8 / Math.PI);
      return true;
    }
    if (this.pending || (!this.open && !this.marking && !v.flight)) return false;
    let action: number, target = 0, bay = 0;
    if (key === CONFIRM && this.marking) action = AIR_ACTION.ground;
    else if (key === TRAILER && this.cab && !v.order) action = AIR_ACTION.trailer;
    else if (key === CANCEL && v.order) { action = AIR_ACTION.cancel; target = v.order; }
    else if (key === PAYLOAD && v.flight) { action = AIR_ACTION.payload; target = v.flight; }
    else if (key === LEAVE && v.flight) { action = AIR_ACTION.leave; target = v.flight; }
    else if (pod) {
      target = pod.id;
      bay = pod.selected;
      if (key === PANELS) action = AIR_ACTION.panels;
      else if (key === LAUNCH && pod.open === 1 && (pod.slots & (1 << bay))) action = AIR_ACTION.launch;
      else if (key >= BAY && key < BAY + AIR_BAYS && pod.open === 1 && (pod.slots & (1 << (key - BAY)))) { action = AIR_ACTION.select; bay = key - BAY; }
      else if (key === HITCH) action = pod.hitched ? AIR_ACTION.unhitch : AIR_ACTION.dismiss;
      else return false;
    } else return false;
    this.refusal = "";
    this.lastAction = action;
    this.pending = s.airCommand(action, target, bay, this.spot);
    if (action === AIR_ACTION.launch) this.open = false;
    return true;
  }

  answer(seq: number, code: number, tick: number): void {
    if (!seq || seq !== this.pending) return;
    this.pending = 0;
    if (code !== RESULT_OK) {
      if (this.lastAction === AIR_ACTION.launch) this.open = true;
      this.refusal = REASONS[code] ?? "The order was declined.";
      this.refusalUntil = tick + 150;
    } else if (this.lastAction === AIR_ACTION.ground || this.lastAction === AIR_ACTION.trailer || this.lastAction === AIR_ACTION.launch) {
      this.open = this.marking = false;
    }
  }

  hud(f: UiFrame, s: ClientSession, device: number): void {
    const touch = device === 2, pad = device === 1;
    if (!this.available(s) || this.open) return;
    const v = s.airSupport;
    const drone = v.flight && v.drones.find(row => row.id === v.flight);
    const w = Math.min(310, f.width - f.left - f.right - 24);
    const x = (f.width - w) / 2, y = f.top + (touch ? 66 : 49);
    if (drone) {
      // The feed's frame and readouts are the HUD's (hud/air-feed.ts). The radio adds its buttons by touch, and a warning low over the ground.
      if (touch) {
        const row = feedButtons(f);
        button(f, PAYLOAD, row.x, row.y, row.w, "Fire payload");
        button(f, LEAVE, row.x + row.w + 8, row.y, row.w, "Leave feed");
      }
      if (this.altitude < 2.5 && s.tickClock % 20 < 13) f.text(BASE + 40, x, f.height / 2 + 84, w, S_WARNING, "TERRAIN");
      return;
    }
    if (this.marking) {
      button(f, CONFIRM, x, y, w * 0.45, touch ? "Place here" : pad ? "Y  Place here" : "E  Place here");
      button(f, ROTATE, x + w * 0.45 + 3, y, w * 0.27, touch ? "Rotate" : pad ? "R3  Rotate" : "Q  Rotate");
      button(f, CLOSE, x + w * 0.72 + 6, y, w * 0.28 - 6, "Cancel");
    } else button(f, AIR_RADIO_KEY, x + (w - 160) / 2, y, 160, touch ? "Air support" : pad ? "R3   Air support" : "J   Air support");
    const message = this.message(s);
    if (message) f.text(BASE + 39, x, y + 41, w, S_HUD_COUNT, fitText(message, w, S_HUD_COUNT));
  }

  private message(s: ClientSession): string {
    return s.airSupport.notice || (this.refusal && s.tickClock < this.refusalUntil ? this.refusal : "");
  }

  ownsButton(key: number): boolean { return key > BASE && key <= LEAVE; }

  draw(f: UiFrame, s: ClientSession, focus: number): void {
    const v = s.airSupport, pod = v.pods.find(row => row.id === v.pod);
    const w = Math.min(430, f.width - f.left - f.right - 24);
    const h = pod ? 295 : 195;
    const x = (f.width - w) / 2, y = (f.height - h) / 2;
    const left = x + 16, wide = w - 32, half = (wide - 8) / 2;
    f.add(BASE + 30, K_PANEL, x, y, w, h, S_PANEL);
    f.text(BASE + 31, left, y + 15, wide - 70, S_TITLE, "Air support");
    button(f, CLOSE, x + w - 78, y + 10, 62, "Close");
    const message = this.message(s) || (pod ? "Drone rack connected" : "Freight dispatch");
    f.text(BASE + 32, left, y + 55, wide, S_LABEL, fitText(message, wide, S_LABEL));
    if (pod) {
      const step = (wide + 4) / AIR_BAYS;
      for (let i = 0; i < AIR_BAYS; i++) {
        const loaded = (pod.slots & (1 << i)) !== 0;
        button(f, BAY + i, left + i * step, y + 86, step - 4, loaded ? String(i + 1) : "—", loaded && pod.open === 1, i === pod.selected);
      }
      button(f, PANELS, left, y + 133, half, pod.open === 1 ? "Close rack" : pod.open === 0 ? "Open rack" : "Panels moving…", pod.open === 0 || pod.open === 1);
      button(f, LAUNCH, left + half + 8, y + 133, half, `Launch bay ${pod.selected + 1}`, pod.open === 1 && !!(pod.slots & (1 << pod.selected)));
      button(f, HITCH, left, y + 181, wide, pod.hitched ? "Unhitch trailer" : pod.slots ? "Recall trailer" : "Recall empty trailer");
    }
    const row = y + (pod ? 240 : 103);
    if (v.order) button(f, CANCEL, left, row, wide, "Cancel delivery");
    else if (this.cab) {
      button(f, TRAILER, left, row, half, "Request trailer");
      button(f, GROUND, left + half + 8, row, half, "Mark ground drop");
    }
    const focused = this.ownsButton(focus) ? f.find(focus) : null;
    if (focused?.interactive) focused.style = S_MENU_FOCUS;
  }
}
