import { quatUnrotate, type Numbers } from "../math/quat.ts";
import { PI, detCos, detSin } from "../math/scalar.ts";
import { ACT_SWING } from "../sim/weapon.ts";
import { PITCH_AUTHORED, PITCH_STEPS, type AnimState } from "./pose.ts";

/** A ridden neck can aim at most 45 degrees from its supported body's forward direction. */
export const BITE_AIM = PI / 4;
const direction = new Float64Array(3);
const limit = detCos(BITE_AIM), spread = detSin(BITE_AIM);

/** Camera pitch is world-space. Derive one bounded local aim for both the visible neck and the attack rays. */
export function prepareBiteAim(st: AnimState, ground?: Numbers): void {
  st.biteX = 0; st.biteY = 0; st.biteZ = 1;
  if ((st.action & 7) !== ACT_SWING || st.pitch === PITCH_AUTHORED) return;
  const pitch = st.pitch * (PI / 2) / PITCH_STEPS;
  direction[0] = 0; direction[1] = detSin(pitch); direction[2] = detCos(pitch);
  if (ground) quatUnrotate(ground, 0, 0, direction[1]!, direction[2]!, direction, 0);
  let x = direction[0]!, y = direction[1]!, z = direction[2]!;
  if (z < limit) {
    const scale = spread / Math.sqrt(x * x + y * y);
    x *= scale; y *= scale; z = limit;
  }
  st.biteX = x; st.biteY = y; st.biteZ = z;
}

/** Rotation from local +Z toward the prepared aim, eased in and out with the authored clip. */
export function biteAimRotation(st: AnimState, weight: number, out: Numbers): void {
  if (Number.isNaN(st.biteX)) prepareBiteAim(st);
  const length = Math.sqrt(2 + 2 * st.biteZ);
  const x = -st.biteY / length * weight, y = st.biteX / length * weight;
  const w = 1 + ((1 + st.biteZ) / length - 1) * weight;
  const norm = Math.sqrt(x * x + y * y + w * w);
  out[0] = x / norm; out[1] = y / norm; out[2] = 0; out[3] = w / norm;
}
