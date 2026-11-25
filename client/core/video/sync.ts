// What every screen's clips share: how a clip is kept in step with the world's clock, and the manifest's colour tracks
// read from base64. The orb's player (player.ts) and the screens on props (faces.ts) both use them.

/** Seconds of drift left alone, and past which the element seeks; between, the rate is nudged by NUDGE. Sync is best effort: a seek costs a fetch. */
export const DRIFT_LEAVE = 0.5;
export const DRIFT_SEEK = 3;
export const NUDGE = 0.05;

/** The playback rate for a clip `drift` seconds behind where it should be (ahead when negative). */
export function syncRate(drift: number): number {
  const a = Math.abs(drift);
  return a < DRIFT_LEAVE || a > DRIFT_SEEK ? 1 : 1 + Math.sign(drift) * NUDGE;
}
/** Whether a clip that far off seeks instead. */
export const mustSeek = (drift: number): boolean => Math.abs(drift) > DRIFT_SEEK;

/** Bytes from base64, as a manifest's colour track is written. */
export function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, count = 0, at = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i), v = c >= 97 ? c - 71 : c >= 65 ? c - 65 : c >= 48 ? c + 4 : c === 43 ? 62 : 63;
    bits = (bits << 6) | v;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[at++] = (bits >> count) & 255;
    }
  }
  return out.subarray(0, at);
}
