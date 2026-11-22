// Tells the voice port how loud to play, and where each speaker is: how far off and to which side. A part of the app's
// frame. The HUD lists who is heard (hud/voice.ts).

import { handleIndex } from "../../../shared/ids.ts";
import type { AppFrame, FramePart } from "../frame.ts";
import { voicePan } from "./place.ts";
import { HEAR_FIELDS, type VoiceSpeaker } from "./port.ts";

/** The most speakers a frame places. */
export const HEARD_MOST = 128;

export class Heard implements FramePart {
  private volumeSet = -1;
  /** Scratch for hear(). */
  private readonly heardAt = new Float32Array(HEAR_FIELDS * HEARD_MOST);

  private n = 0;
  private f!: AppFrame;

  step(f: AppFrame): void {
    const v = f.voice;
    if (!v) return;
    const heard = f.settings.muted ? 0 : f.settings.voiceVolume;
    if (this.volumeSet !== heard) v.volume((this.volumeSet = heard));
    if (v.speakers.size === 0) return;
    this.n = 0;
    this.f = f;
    v.speakers.forEach(this.place);
    v.hear(this.heardAt, this.n);
  }

  /** One speaker's place, into the scratch. */
  private readonly place = (s: VoiceSpeaker, speaker: number): void => {
    const n = this.n, f = this.f;
    if (n >= HEARD_MOST) return;
    const r = f.remote, own = f.session.own, at = this.heardAt;
    const index = handleIndex(s.handle);
    let far = -1;
    let side = 0;
    for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== index) continue;
      far = Math.hypot(r.x[i]! - own.x, r.y[i]! - own.y, r.z[i]! - own.z);
      side = voicePan(r.x[i]! - own.x, r.z[i]! - own.z, f.controls.yaw);
      break;
    }
    at[n * HEAR_FIELDS] = speaker;
    at[n * HEAR_FIELDS + 1] = far;
    at[n * HEAR_FIELDS + 2] = side;
    this.n = n + 1;
  };
}
