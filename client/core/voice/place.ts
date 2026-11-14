// Voice gain by distance. A voice is full near the speaker, falls in proportion to distance out to its range,
// and fades to nothing past the edge, where the server still sends it for a while. The range depends on the mode.

import { KEEP_RANGE, MODE_TALK, VOICE_RANGE } from "../../../shared/voice/packet.ts";

/** A voice is at full gain within this share of its range. */
const NEAR = 0.15;
/** Gain for a speaker whose body this client cannot see. */
const UNSEEN = 0.5;

/**
 * Returns -1 for fully left, 1 for fully right, 0 for ahead or behind. (dx, dz) is the speaker relative to the listener.
 * `yaw` is the listener's facing in radians: 0 looks along +Z, with -X on its right. Within a metre the pan shrinks to the middle.
 */
export function voicePan(dx: number, dz: number, yaw: number): number {
  const far = Math.hypot(dx, dz);
  if (far < 1e-6) return 0;
  const side = (-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / far;
  return far < 1 ? side * far : side;
}

/** Equal-power gains for the left and right ears. */
export function panLeft(pan: number): number {
  return Math.cos(((pan + 1) * Math.PI) / 4);
}

export function panRight(pan: number): number {
  return Math.sin(((pan + 1) * Math.PI) / 4);
}

/** `distance` is in metres. Below zero means it is not known. */
export function voiceGain(distance: number, mode: number): number {
  if (distance < 0) return UNSEEN;
  const range = VOICE_RANGE[mode] ?? VOICE_RANGE[MODE_TALK]!;
  const near = range * NEAR;
  if (distance <= near) return 1;
  if (distance <= range) return near / distance;
  const out = range * KEEP_RANGE;
  return distance >= out ? 0 : (NEAR * (out - distance)) / (out - range);
}
