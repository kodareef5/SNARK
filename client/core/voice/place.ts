// How loud a voice is to the one hearing it.
//
// A voice is at its fullest near the speaker and falls away as sound does,
// in proportion to the distance, until at the edge of its range it is faint;
// past the edge, where the server goes on sending it for a little while, it
// fades to nothing. How far that range is depends on how loud it was meant.

import { KEEP_RANGE, MODE_TALK, VOICE_RANGE } from "../../../shared/voice/packet.ts";

/** The share of its range within which a voice is at its fullest. */
const NEAR = 0.15;
/** How loud a speaker is played whose body this client has not been shown. */
const UNSEEN = 0.5;

/**
 * Which side a voice is on: -1 fully to the left, 1 fully to the right, 0
 * ahead or behind. `dx` and `dz` are where the speaker is from the listener;
 * `yaw` is the way the listener looks, in radians (0 looks along +Z, and its
 * right is then -X). A voice within arm's reach is in the middle.
 */
export function voicePan(dx: number, dz: number, yaw: number): number {
  const far = Math.hypot(dx, dz);
  if (far < 1e-6) return 0;
  const side = (-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / far;
  return far < 1 ? side * far : side;
}

/** How much of a voice at `pan` goes to the left ear and how much to the right, the two together as loud wherever it is. */
export function panLeft(pan: number): number {
  return Math.cos(((pan + 1) * Math.PI) / 4);
}

export function panRight(pan: number): number {
  return Math.sin(((pan + 1) * Math.PI) / 4);
}

/** The gain for a voice `distance` metres off, meant as loud as `mode`. A distance below zero means it is not known. */
export function voiceGain(distance: number, mode: number): number {
  if (distance < 0) return UNSEEN;
  const range = VOICE_RANGE[mode] ?? VOICE_RANGE[MODE_TALK]!;
  const near = range * NEAR;
  if (distance <= near) return 1;
  if (distance <= range) return near / distance;
  const out = range * KEEP_RANGE;
  return distance >= out ? 0 : (NEAR * (out - distance)) / (out - range);
}
