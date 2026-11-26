// A screen on a prop: the rectangle a structure def's picture is drawn on, in the structure's own frame (metres, +y up,
// the yaw turning it as it turns the mesh), and how it is drawn. The registry keeps it by kind (Registry.screenFace), and
// the client's screens pass draws one quad on it for each such structure near enough (client/core/render/screens.ts).
import type { ScreenType } from "./clip.ts";

export interface ScreenFace {
  /** The type of screen it is: which channel it shows (clip.ts SCREENS; never the ball). */
  readonly type: Exclude<ScreenType, "orb">;
  /** Its left and right x, bottom and top y, and the z of its plane; it faces +z. */
  readonly face: readonly [x0: number, x1: number, y0: number, y1: number, z: number];
  /** Drawn as LED pixels, as a billboard is. */
  readonly led?: boolean;
  /** Drawn as an old tube's, with scanlines. */
  readonly crt?: boolean;
}

/** What is wrong with a face, or "" where nothing is. */
export function faceFault(f: ScreenFace): string {
  const [x0, x1, y0, y1, z] = f.face;
  if (![x0, x1, y0, y1, z].every(Number.isFinite)) return "its face's numbers are not all finite";
  if (!(x1 > x0) || !(y1 > y0)) return "its face is empty: x1 must be past x0 and y1 past y0";
  if (x1 - x0 > 40 || y1 - y0 > 20) return "its face is larger than 40 by 20 m";
  if (f.led && f.crt) return "a face is LED or a tube, not both";
  return "";
}

/** A face's width over its height. */
export const faceAspect = (f: ScreenFace): number => (f.face[1] - f.face[0]) / (f.face[3] - f.face[2]);
