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
