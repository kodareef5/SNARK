// A frame is a list of passes (`passes` in scene.ts). A pass is one file: the state it keeps from frame to frame, what it
// brings up to date, and what it draws. The scene walks the list once for each hook, so a pass's place in the list is its
// place in the frame: what is earlier is put in the packet first, and takes of the budget first.

import type { Assets } from "../assets/assets.ts";
import type { Tier } from "../assets/tiers.ts";
import type { RemoteSample } from "../session.ts";
import type { FrameBudget } from "./budget.ts";
import type { Camera } from "./camera.ts";
import type { Casting } from "./casting.ts";
import type { Draws } from "./draws.ts";
import type { Hiding } from "./hide.ts";
import type { FramePacket, InstanceWriter } from "./packet.ts";
import type { OwnBody, RenderWorld } from "./scene.ts";

export interface Pass {
  /** Before anything of the frame is drawn: what it holds for the frame is brought up to date, and what it needs put on the card. */
  update?(f: Frame): void;
  /** Puts its draws and casters in the packet. It must not allocate. */
  draw?(f: Frame): void;
}

/** What a pass reads of the frame. The scene keeps one and fills it each frame (Scene.begin); none is made in a frame. */
export class Frame {
  cam!: Camera;
  /** The bodies the session sampled for this frame, or null. */
  remote: RemoteSample | null = null;
  /** The viewer's own body, or null. */
  own: OwnBody | null = null;
  tier!: Tier;
  /** The frame's time, in milliseconds. */
  now = 0;
  /** Metres to the end of the view (Scene.viewDistance). */
  view = 0;
  /** The height of the view in pixels (Scene.viewHeight). */
  viewHeight = 720;
  /** The camera's height over the ground under it. */
  lift = 0;
  /** Whether the dome is drawn as the table alone and nothing is hazed (Scene.plainSky). */
  plainSky = false;
  /** Whether the eye is under water. */
  under = false;
  /** What hides what, from the pass that finds it on: undefined before it, and on a frame that hides nothing. */
  hider: Hiding | undefined = undefined;

  readonly packet: FramePacket;
  readonly world: RenderWorld;
  readonly assets: Assets;
  readonly budget: FrameBudget;
  /** The packet's writer, which every draw goes through. */
  readonly put: Draws;
  /** The frame's shadows: whether anything casts, into which cascades a box does, and the caster list's writer. */
  readonly casting: Casting;
  /** The writer of the packet's instances made for one frame (TRANSIENT_BUFFER). */
  readonly transient: InstanceWriter;

  constructor(packet: FramePacket, world: RenderWorld, assets: Assets, budget: FrameBudget, put: Draws, casting: Casting, transient: InstanceWriter) {
    this.packet = packet;
    this.world = world;
    this.assets = assets;
    this.budget = budget;
    this.put = put;
    this.casting = casting;
    this.transient = transient;
  }

  /** The distance from the camera that reaches `metres` along the ground below it (Scene.alongGround). */
  alongGround(metres: number): number {
    return Math.hypot(metres, this.lift);
  }
}

/** One function for each hook, which calls the passes that have it in the list's order. */
export function walk(passes: readonly Pass[]): Required<Pass> {
  const updates = passes.filter((s) => s.update !== undefined);
  const draws = passes.filter((s) => s.draw !== undefined);
  return {
    update: (f) => {
      for (let i = 0; i < updates.length; i++) updates[i]!.update!(f);
    },
    draw: (f) => {
      for (let i = 0; i < draws.length; i++) draws[i]!.draw!(f);
    },
  };
}
