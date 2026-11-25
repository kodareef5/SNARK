// The Screens page's preview: the ball at night showing a clip's poster as the game draws it, by the twin
// (render/orb-view.ts), from the street on two sides and from above. Nothing here touches the page.
import { tierOf } from "../assets/tiers.ts";
import { ORB_SCREEN, screenPicture, setScreenPicture, type OrbScreen } from "../render/orb.ts";
import { OrbView } from "../render/orb-view.ts";
import type { OrbSite } from "../../../shared/world/orb.ts";

/** The Sphere as Las Vegas has it. Where it stands does not change what it shows. */
const SITE: OrbSite = { name: "Sphere", x: 4000, y: 620, z: 4000, yaw: 0, radius: 78, centre: 34 };
/** The views across the preview: bearing (0 from the north), metres from the axis, metres up. */
export const PREVIEW_VIEWS = [
  { label: "from the south", from: Math.PI, distance: 400, lift: 2 },
  { label: "from the west", from: Math.PI / 2, distance: 400, lift: 2 },
  { label: "from above", from: Math.PI, distance: 1, lift: 520 },
] as const;

const screen: OrbScreen = { shows: 0, width: 0, height: 0, texWidth: 0, texHeight: 0, levels: 0, theatre: true, fill: false, track: null, seconds: 0, upX: 0, upY: 1, upZ: 0 };
const view = new OrbView(SITE, [], tierOf("medium"), screen);

/**
 * The preview into `pixels` (RGBA), the views side by side, each `size` square: `picture` (RGBA sRGB, `width` by
 * `height`) in theatre or band, fitted or filled, with the clip's colour track for the glow about it.
 */
export function drawPreview(pixels: Uint8ClampedArray, size: number, picture: ArrayLike<number>, width: number, height: number, track: Uint8Array, theatre: boolean, fill: boolean): void {
  setScreenPicture(screenPicture(width, height, picture));
  Object.assign(screen, { width, height, texWidth: width, texHeight: height, levels: Math.floor(Math.log2(Math.max(width, height))), theatre, fill, track, seconds: 0 });
  const stride = size * PREVIEW_VIEWS.length, moment = { seconds: 400, hour: 22, from: 0 };
  PREVIEW_VIEWS.forEach((v, k) => {
    const far = Math.hypot(v.distance, v.lift - SITE.centre);
    view.view(pixels, stride, k * size, 0, size, size, ORB_SCREEN, { ...moment, from: v.from }, v.distance, 2 * Math.asin(SITE.radius / far) * 1.15, v.lift);
  });
  setScreenPicture(null);
}
