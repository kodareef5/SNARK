// The screens on props (../screens.ts): the faces near enough found and what each shows decided before anything is
// drawn, then one draw of a quad on each. Screens are the lowest priority of a frame: last in the list but the viewer's
// own body, and the first thing the governor gives up (governor.ts).

import type { ScreenFace } from "../../../../shared/video/face.ts";
import type { ScreenState } from "../../../../shared/video/screen.ts";
import { SCREENS_DRAWN, SCREENS_MANY, SCREENS_NEAREST } from "../../governor.ts";
import type { FaceScreens, FaceView } from "../../video/faces.ts";
import { FACE, FACE_FLOATS, FACE_HIGH, FACE_LEVELS, FACE_WIDE, FRAME } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { orbLevel } from "../screen-level.ts";
import { FaceFinder, writeFace, type FaceWorld } from "../screens.ts";

/** Bytes a layer of the pictures' array takes with its levels. */
export const LAYER_BYTES = Math.round(FACE_WIDE * FACE_HIGH * 4 * (1 - 4 ** -FACE_LEVELS) * (4 / 3));

export class Screens implements Pass {
  readonly finder: FaceFinder;
  private faces: FaceScreens | null = null;
  private loading = false;
  private retryAt = 0;
  /** What the app tells it each frame: every type's state (session.screens), the render clock and the option. */
  states: readonly ScreenState[] = [];
  tick = 0;
  option = true;
  private readonly kinds: readonly (ScreenFace | null)[];
  private readonly world: { structs: FaceWorld["structs"]; statics: FaceWorld["statics"] } = { structs: null!, statics: null };
  private readonly view: { -readonly [K in keyof FaceView]: FaceView[K] } = { states: [], tick: 0, now: 0, option: true, pixel: 0, count: 0, layers: 0, video: 0, fps: 0, artIdle: false };

  constructor(faces: readonly (ScreenFace | null)[]) {
    this.kinds = faces;
    this.finder = new FaceFinder(faces);
  }

  /** Start the player after a drawn frame found a face in reach. */
  request(load: () => Promise<FaceScreens>, now: number): void {
    if (this.finder.list.count === 0 || this.faces || this.loading || now < this.retryAt) return;
    this.loading = true;
    this.retryAt = now + 5000;
    void load().then((faces) => {
      this.faces = faces;
      this.loading = false;
    }, () => { this.loading = false; });
  }

  /** What the screens drew this frame, for the governor (governor.ts SCREENS_). */
  get mask(): number {
    const { count, seen } = this.finder.list;
    return this.faces?.mask ?? ((count > 0 ? SCREENS_DRAWN : 0) | (seen > SCREENS_NEAREST ? SCREENS_MANY : 0));
  }

  update(f: Frame): void {
    const p = f.packet, tier = f.tier.screens;
    if (!this.finder.any) {
      p.faceLayers = 0;
      return;
    }
    this.world.structs = f.world.structs;
    this.world.statics = f.world.city?.statics ?? null;
    const list = this.finder.find(this.world, f.cam, tier);
    if (!this.faces) {
      p.faceLayers = 0;
      return;
    }
    const v = this.view;
    v.states = this.states;
    v.tick = this.tick;
    v.now = f.now;
    v.option = this.option;
    v.pixel = f.cam.fovY / Math.max(1, f.viewHeight);
    v.count = tier.count;
    v.layers = tier.layers;
    v.video = tier.video;
    v.fps = tier.fps;
    v.artIdle = f.assets.residency.flying + f.assets.residency.waiting === 0;
    this.faces.step(list, this.kinds, v, p);
    f.assets.residency.reserve("screens", p.faceLayers * LAYER_BYTES);
  }

  draw(f: Frame): void {
    const p = f.packet, list = this.finder.list, cam = f.cam, drawn = Math.min(list.count, f.tier.screens.count);
    const faces = this.faces;
    if (!faces || drawn === 0 || p.faceLayers === 0) return;
    const level = orbLevel(p.frame[FRAME.exposure]!);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < drawn; i++) {
      const show = faces.shows[i]!;
      // A face showing nothing is its mesh's dark panel.
      if (show.layer < 0 && show.mean === 0 && (show.wipe >= 1 || (show.before < 0 && show.meanBefore === 0))) continue;
      const at = p.faceCount * FACE_FLOATS;
      writeFace(p, list, i, this.kinds[list.kind[i]!]!, cam, show, level * list.fade[i]!);
      const fc = p.faces;
      for (let k = 0; k < 4; k++) {
        const x = fc[at + FACE.corner]! + (k & 1 ? fc[at + FACE.across]! : 0) + (k & 2 ? fc[at + FACE.up]! : 0);
        const y = fc[at + FACE.corner + 1]! + (k & 1 ? fc[at + FACE.across + 1]! : 0) + (k & 2 ? fc[at + FACE.up + 1]! : 0);
        const z = fc[at + FACE.corner + 2]! + (k & 1 ? fc[at + FACE.across + 2]! : 0) + (k & 2 ? fc[at + FACE.up + 2]! : 0);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
      }
    }
    if (p.faceCount > 0) f.put.drawFaces(p.faceCount, cam.passes(x0, y0, z0, x1, y1, z1));
  }
}
