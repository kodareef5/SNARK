// Turns the session's combat events into marks, numbers and notices that fade. Nothing is predicted.
// A hit shows only when the server reports it. client/core/ui/combat.ts lays out the CombatModel; a hit's number is drawn
// by the renderer (render/damage-numbers.ts), which absorb hands it to.

import { ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL } from "../../shared/net/protocol.ts";
import type { Camera } from "./render/camera.ts";
import { DAMAGE_BLOCKED, DAMAGE_BODY, DAMAGE_HEAD, DAMAGE_KILL, type DamageNumbers } from "./render/damage-numbers.ts";
import type { ClientSession } from "./session.ts";

export const MARK_MS = 260;
export const HURT_MS = 1400;
export const BLOOD_MS = 1600;
export const NOTICE_MS = 5000;
const MAX_HURTS = 8;
/** Damage that reddens the screen fully. */
const BLOOD_FULL = 50;

/** Positions are fractions of the screen, origin top left. */
export class CombatModel {
  /** Opacity of the hit mark at the crosshair, 0 for none. */
  mark = 0;
  markKill = false;
  markHead = false;
  /** `angle` is to the left of straight ahead, in radians. Only the first `hurtCount` are current. */
  readonly hurts: { angle: number; alpha: number }[] = [];
  hurtCount = 0;
  /** Red at the edges, 0 to 1. */
  blood = 0;
  /** A line under the crosshair. */
  notice = "";
  noticeAlpha = 0;
}

export class Feedback {
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

  /** Empties session.events. Each hit's number goes to `numbers`, the renderer's. */
  absorb(session: ClientSession, reg: Registry, nowMs: number, numbers: DamageNumbers | null = null): void {
    const events = session.events;
    for (const ev of events) {
      if (ev.kind === EVENT_HIT) {
        this.markAt = nowMs;
        this.markKill = ev.kill;
        this.markHead = ev.zone === ZONE_HEAD;
        numbers?.hit(ev.x, ev.y, ev.z, ev.damage, ev.kill ? DAMAGE_KILL : ev.blocked ? DAMAGE_BLOCKED : ev.zone === ZONE_HEAD ? DAMAGE_HEAD : DAMAGE_BODY, nowMs);
      } else if (ev.kind === EVENT_HURT || ev.kind === EVENT_DEATH) {
        // A silenced shot reddens the screen but shows no side (Silencer Attachment).
        if (ev.side) {
          if (this.hurts.length >= MAX_HURTS) this.hurts.shift();
          this.hurts.push({ bearing: (ev.bearing / 256) * TAU, born: nowMs });
        }
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

  /** `yaw` is the camera's facing in radians. `marks` says whether hit marks may show. */
  fill(m: CombatModel, _cam: Camera, yaw: number, alive: boolean, nowMs: number, marks = true): void {
    const markAge = nowMs - this.markAt;
    m.mark = marks && markAge < MARK_MS ? 1 - markAge / MARK_MS : 0;
    m.markKill = this.markKill;
    m.markHead = this.markHead;

    let n = 0;
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
