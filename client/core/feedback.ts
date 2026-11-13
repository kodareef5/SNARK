// What combat looks like to the one in it.
//
// The server says, once, what happened: a hit this client landed, harm it
// took, a death (S_EVENT; the session keeps them as they arrive). This file
// turns each into something that is seen for a moment and fades: a mark at the
// crosshair, a number over the place the hit landed, a mark on the side the
// harm came from, red at the edges of the screen, a line saying who killed
// what. Nothing here is predicted. A hit is shown when the server says it
// landed, and only then.
//
// The result is plain data (`CombatModel`); client/core/ui/combat.ts lays it out.

import { ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL } from "../../shared/net/protocol.ts";
import type { Camera } from "./render/camera.ts";
import type { ClientSession } from "./session.ts";

/** How long each thing is shown, milliseconds. */
export const MARK_MS = 260;
export const NUMBER_MS = 1100;
export const HURT_MS = 1400;
export const BLOOD_MS = 1600;
export const NOTICE_MS = 5000;
/** Metres a number rises over its life. */
const NUMBER_RISE = 0.7;
const MAX_NUMBERS = 24;
const MAX_HURTS = 8;
/** Harm that reddens the screen all the way. */
const BLOOD_FULL = 50;

export const NUMBER_BODY = 0;
export const NUMBER_HEAD = 1;
export const NUMBER_KILL = 2;

/** What the interface shows of combat this frame. Positions are fractions of the screen, origin top left. */
export class CombatModel {
  /** The mark at the crosshair that says a hit landed: how solid (0 for none), and whether that hit killed, or was to a head. */
  mark = 0;
  markKill = false;
  markHead = false;
  /** Numbers over where hits landed. Only the first `numberCount` are current. */
  readonly numbers: { u: number; v: number; text: string; kind: number; alpha: number }[] = [];
  numberCount = 0;
  /** The sides harm came from: an angle to the left of straight ahead, radians. Only the first `hurtCount` are current. */
  readonly hurts: { angle: number; alpha: number }[] = [];
  hurtCount = 0;
  /** Red at the edges, 0 to 1. */
  blood = 0;
  /** A line under the crosshair, and how solid. */
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
  /** The notice says how this body died: it stays until the body is alive again. */
  private recap = false;
  private readonly screen = [0, 0, 0];

  /** Take in what the server has reported since the last frame. */
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
        // What is left of the last reddening, and this on top of it.
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

  /** What to show at `nowMs`, seen by `cam`, whose facing is `yaw` radians. `alive` is whether this client has a living body. */
  fill(m: CombatModel, cam: Camera, yaw: number, alive: boolean, nowMs: number): void {
    const markAge = nowMs - this.markAt;
    m.mark = markAge < MARK_MS ? 1 - markAge / MARK_MS : 0;
    m.markKill = this.markKill;
    m.markHead = this.markHead;

    while (this.numbers.length > 0 && nowMs - this.numbers[0]!.born >= NUMBER_MS) this.numbers.shift();
    let n = 0;
    const s = this.screen;
    for (const f of this.numbers) {
      const age = (nowMs - f.born) / NUMBER_MS;
      if (!cam.project(f.x, f.y + age * NUMBER_RISE, f.z, s)) continue;
      if (s[0]! < 0 || s[0]! > 1 || s[1]! < 0 || s[1]! > 1) continue;
      const out = (m.numbers[n++] ??= { u: 0, v: 0, text: "", kind: 0, alpha: 0 });
      out.u = s[0]!;
      out.v = s[1]!;
      out.text = f.text;
      out.kind = f.kind;
      // Solid for the first half of its life, then gone by the end.
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

    // How it died stays up until it lives again; anything else fades.
    if (this.recap && alive && nowMs - this.noticeAt > 500) this.recap = false;
    const noticeAge = nowMs - this.noticeAt;
    m.notice = this.notice;
    m.noticeAlpha = this.recap && !alive ? 1 : noticeAge < NOTICE_MS ? Math.min(1, (NOTICE_MS - noticeAge) / 1000) : 0;
  }
}
