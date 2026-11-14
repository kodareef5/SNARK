// Turns the session's combat events into marks, numbers and notices that fade. Nothing is predicted.
// A hit shows only when the server reports it. client/core/ui/combat.ts lays out the CombatModel.

import { ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL } from "../../shared/net/protocol.ts";
import type { Camera } from "./render/camera.ts";
import type { ClientSession } from "./session.ts";

export const MARK_MS = 260;
export const NUMBER_MS = 1100;
export const HURT_MS = 1400;
export const BLOOD_MS = 1600;
export const NOTICE_MS = 5000;
/** Metres a number rises over its life. */
const NUMBER_RISE = 0.7;
const MAX_NUMBERS = 24;
const MAX_HURTS = 8;
/** Damage that reddens the screen fully. */
const BLOOD_FULL = 50;

export const NUMBER_BODY = 0;
export const NUMBER_HEAD = 1;
export const NUMBER_KILL = 2;

/** Positions are fractions of the screen, origin top left. */
export class CombatModel {
  /** Opacity of the hit mark at the crosshair, 0 for none. */
  mark = 0;
  markKill = false;
  markHead = false;
  /** Only the first `numberCount` are current. */
  readonly numbers: { u: number; v: number; text: string; kind: number; alpha: number }[] = [];
  numberCount = 0;
  /** `angle` is to the left of straight ahead, in radians. Only the first `hurtCount` are current. */
  readonly hurts: { angle: number; alpha: number }[] = [];
  hurtCount = 0;
  /** Red at the edges, 0 to 1. */
  blood = 0;
  /** A line under the crosshair. */
  notice = "";
  noticeAlpha = 0;
}

interface FloatingNumber {
  x: number;
  y: number;
  z: number;
  text: string;
  kind: number;
  born: number;
}

export class Feedback {
  private readonly numbers: FloatingNumber[] = [];
  private readonly hurts: { bearing: number; born: number }[] = [];
  private markAt = -Infinity;
  private markKill = false;
  private markHead = false;
  private blood = 0;
  private bloodAt = -Infinity;
  private notice = "";
  private noticeAt = -Infinity;
  /** The notice is a death recap, which stays until the body is alive again. */
  private recap = false;
  private readonly screen = [0, 0, 0];

  /** Empties session.events. */
  absorb(session: ClientSession, reg: Registry, nowMs: number): void {
    const events = session.events;
    for (const ev of events) {
      if (ev.kind === EVENT_HIT) {
        this.markAt = nowMs;
        this.markKill = ev.kill;
        this.markHead = ev.zone === ZONE_HEAD;
        if (this.numbers.length >= MAX_NUMBERS) this.numbers.shift();
        this.numbers.push({ x: ev.x, y: ev.y, z: ev.z, text: String(ev.damage), kind: ev.kill ? NUMBER_KILL : ev.zone === ZONE_HEAD ? NUMBER_HEAD : NUMBER_BODY, born: nowMs });
      } else if (ev.kind === EVENT_HURT || ev.kind === EVENT_DEATH) {
        if (this.hurts.length >= MAX_HURTS) this.hurts.shift();
        this.hurts.push({ bearing: (ev.bearing / 256) * TAU, born: nowMs });
        const left = this.blood * Math.max(0, 1 - (nowMs - this.bloodAt) / BLOOD_MS);
        this.blood = Math.min(1, left + ev.damage / BLOOD_FULL);
        this.bloodAt = nowMs;
        if (ev.kind === EVENT_DEATH) {
          const def = ev.item !== 0 ? (reg.defs[ev.item] as ItemDef | null) : null;
          const weapon = def ? (def.label ?? def.id.slice(def.id.indexOf(":") + 1)) : "bare hands";
          this.notice = `Killed by ${ev.name} with ${weapon}: ${ev.damage} to the ${ZONE_NAMES[ev.zone] ?? "body"} from ${ev.far.toFixed(1)} m`;
          this.noticeAt = nowMs;
          this.recap = true;
        }
      } else if (ev.kind === EVENT_KILL) {
        this.notice = `Killed ${ev.name} (level ${ev.level})${ev.xp > 0 ? `  +${ev.xp} xp` : ""}`;
        this.noticeAt = nowMs;
        this.recap = false;
      }
    }
    events.length = 0;
  }

  /** `yaw` is the camera's facing in radians. `numbers` and `marks` say whether damage numbers and hit marks may show. */
  fill(m: CombatModel, cam: Camera, yaw: number, alive: boolean, nowMs: number, numbers = true, marks = true): void {
    const markAge = nowMs - this.markAt;
    m.mark = marks && markAge < MARK_MS ? 1 - markAge / MARK_MS : 0;
    m.markKill = this.markKill;
    m.markHead = this.markHead;

    while (this.numbers.length > 0 && nowMs - this.numbers[0]!.born >= NUMBER_MS) this.numbers.shift();
    let n = 0;
    const s = this.screen;
    for (const f of this.numbers) {
      if (!numbers) break;
      const age = (nowMs - f.born) / NUMBER_MS;
      if (!cam.project(f.x, f.y + age * NUMBER_RISE, f.z, s)) continue;
      if (s[0]! < 0 || s[0]! > 1 || s[1]! < 0 || s[1]! > 1) continue;
      const out = (m.numbers[n++] ??= { u: 0, v: 0, text: "", kind: 0, alpha: 0 });
      out.u = s[0]!;
      out.v = s[1]!;
      out.text = f.text;
      out.kind = f.kind;
      out.alpha = age < 0.5 ? 1 : 2 - age * 2;
    }
    m.numberCount = n;

    while (this.hurts.length > 0 && nowMs - this.hurts[0]!.born >= HURT_MS) this.hurts.shift();
    n = 0;
    for (const h of this.hurts) {
      const out = (m.hurts[n++] ??= { angle: 0, alpha: 0 });
      out.angle = h.bearing - yaw;
      out.alpha = 1 - (nowMs - h.born) / HURT_MS;
    }
    m.hurtCount = n;

    const bloodAge = nowMs - this.bloodAt;
    m.blood = bloodAge < BLOOD_MS ? this.blood * (1 - bloodAge / BLOOD_MS) : 0;

    if (this.recap && alive && nowMs - this.noticeAt > 500) this.recap = false;
    const noticeAge = nowMs - this.noticeAt;
    m.notice = this.notice;
    m.noticeAlpha = this.recap && !alive ? 1 : noticeAge < NOTICE_MS ? Math.min(1, (NOTICE_MS - noticeAge) / 1000) : 0;
  }
}
