// What a page that measures or takes pictures asks of the app's frame: a bench's effects off and its turning view, the
// stress meshes, a self-check's held body, a tool's look at a place. The game's own frame carries none of it. The app
// makes these hooks the first time a tool, or the page's address, asks for one (App.tooled), and from then on they are
// rows of its frame (`rows` in app.ts).

import { TICK_RATE } from "../../shared/coords.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { SESSION_ALIVE } from "../../shared/net/protocol.ts";
import { SURFACE_GROUND } from "../../shared/net/rockets.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { tierOf, type Tier } from "./assets/tiers.ts";
import type { Controls } from "./controls.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import type { Governor } from "./governor.ts";
import { BENCH_TURN_MS, effectsOff, packetWithout, sceneWithout, tierWithout, type Effect } from "./passes.ts";
import type { Scene } from "./render/scene.ts";
import { VOLUME_MAX, type Settings } from "./settings.ts";
import { stressThings, type Mark } from "./stress.ts";
import type { SupplyView } from "./supply.ts";

/** The master volume of a page that measures itself (a probe, a bench, the device page), of 1 for full: `?volume=` gives another. */
export const MEASURED_VOLUME = 0.02;

/** A bench page's `?blast=`: a rocket's blast is set off on the ground that many metres ahead of the view this often, in ms, once its run has begun. */
const BLAST_EVERY_MS = 1500;
const BLAST_REACH = 7.5;
const BLAST_LOOK = 2;

/** What a tool's own server tells a page that is the tool's look at a place (`ToolHooks.address`). */
export interface ToolOrders {
  readonly run?: readonly unknown[];
  readonly look?: readonly unknown[];
  readonly eyeSeconds?: number;
  readonly playEye?: boolean;
  readonly holdLook?: boolean;
}

/**
 * Steers for a measurement run, `ms` into its measured frames: the body stands and the view turns once round in
 * BENCH_TURN_MS, a little up and down, so that every run of a scene sees the same views; below 0 the view is held
 * (`?still`). Call it each frame instead of forwarding input.
 */
export function autopilot(controls: Controls, ms: number): void {
  if (ms < 0) return;
  controls.yaw = (ms / BENCH_TURN_MS) * TAU;
  controls.pitch = Math.sin(ms / 2300) * 0.2 - 0.05;
}

export class ToolHooks {
  /** Draw the stress meshes, if the pack has them. `marks` are the rocks whose colour says which level is on the screen. */
  stress = false;
  marks: Mark[] = [];
  /** False while the self-check holds the body still. */
  steer = true;
  /** The dome drawn as the sky table alone and nothing hazed, as the rasterizer draws, so the self-check's colours are the twins'. */
  plainSky = false;
  /**
   * A page that measures or takes pictures (the self-check, a bench, the device page, a tool's look, a trip): the survivor
   * rises looking from the eye, whatever Settings.thirdPerson says, so these pages keep measuring the view they always did.
   */
  fromEye = false;
  /** A bench page's `?farpalm=fronds`: far palms drawn as their frond level (render/farnodes.ts farLevelOf). */
  farPalms = false;
  /** Effects the page's address turned off (passes.ts). */
  off: ReadonlySet<Effect> = new Set();
  /** What every other frame draws with off instead (`?ab=`, passes.ts), or null; the frames drawn; and what this frame draws with off. */
  private other: ReadonlySet<Effect> | null = null;
  private drawnFrames = 0;
  private offNow: ReadonlySet<Effect> = this.off;
  /** A tool's look at a place (`address`): the commands still to send, when the next may go, and the facing held. */
  private script: string[] = [];
  private lineAt = 0;
  private held: [number, number] | null = null;
  private releaseLook = false;
  /** The scene's share a page that measures asks (`?scale=`, render/post.ts sceneShare), in place of the setting's; 0 for none. */
  shareAsked = 0;
  /** The obelisks' clock a picture tool holds, in seconds, or null; whether it runs once the lines are sent, and from when. */
  private artEyeTime: number | null = null;
  private playEye = false;
  private artEyeAt: number | null = null;
  /** A measurement run's clock (bench-run.ts BenchRun.clock): ms since its scene was still, -1 before or outside a run; and the page's clock then. */
  private runMs = -1;
  private runFrom = 0;
  /** Metres ahead a bench page sets blasts off (`?blast=`), 0 for none; the run's clock at the next; and how many went. */
  private blastAhead = 0;
  private blastNext = 0;
  private blasts = 0;
  private readonly supply: SupplyView;

  /** `supply` is the drops' view, whose clock a picture tool holds with the obelisks'. */
  constructor(supply: SupplyView) {
    this.supply = supply;
  }

  /**
   * What the page's address asks: `off`, effects turned off for a before and after (passes.ts). A page that pins pictures
   * or hashes, or measures, holds the governor at the tier, or at `level`, and may name the `tier` and the scene's
   * share of the canvas a side, `scale` (1 for the canvas's own). It plays at
   * MEASURED_VOLUME, or at `volume`. A tool's look at a place is such a page, and its `orders` are what the server the
   * tool started for it gave it, never the address's: `run`, lines sent as typed once the body is in the world, and
   * `look`, the way it faces held, yaw and pitch in radians. Any other page sends no line it was not typed and holds no view.
   */
  address(get: (name: string) => string | null, pinned: boolean, orders: ToolOrders | null, governor: Governor, settings: Settings): void {
    this.off = effectsOff(get("off"));
    this.other = get("ab") === null ? null : effectsOff(get("ab"));
    this.script = pinned && Array.isArray(orders?.run) ? orders.run.filter((line): line is string => typeof line === "string") : [];
    const look = pinned && Array.isArray(orders?.look) ? orders.look : [];
    this.releaseLook = orders?.holdLook === false;
    this.playEye = pinned && orders?.playEye === true;
    this.artEyeAt = null;
    this.artEyeTime = pinned && Number.isFinite(orders?.eyeSeconds) ? orders!.eyeSeconds! : null;
    this.held = look.length === 2 && look.every((v) => typeof v === "number" && Number.isFinite(v)) ? [look[0] as number, look[1] as number] : null;
    if (!pinned) return;
    this.farPalms = get("farpalm") === "fronds";
    const blast = Number(get("blast"));
    this.blastAhead = blast > 0 && blast <= 400 ? blast : 0;
    governor.held = Number(get("level") ?? 0);
    settings.tier = tierOf(get("tier") ?? settings.tier).name;
    const share = Number(get("scale"));
    this.shareAsked = share > 0 && share <= 1 ? share : 0;
    // Such a page runs unattended, often behind someone's other work, and its music would start at full volume. It is
    // not muted, since nobody is there to unmute it and the self-check listens for a sound.
    settings.muted = false;
    const volume = Number(get("volume") ?? MEASURED_VOLUME);
    settings.masterVolume = Number.isFinite(volume) ? Math.max(0, Math.min(VOLUME_MAX, volume)) : MEASURED_VOLUME;
  }

  /** As the scene is made: the sky drawn plain, and the stress meshes. */
  dress(scene: Scene, world: CollisionWorld): void {
    scene.plainSky = this.plainSky;
    if (!this.stress) return;
    const made = stressThings(scene.assets, world.hf, PROVING_SPAWN, world.hf.heightAt(PROVING_SPAWN.x, PROVING_SPAWN.z) + 1.62);
    scene.things = made.things;
    this.marks = made.marks;
  }

  /** The obelisks' clock a picture tool holds, in seconds, or null where it holds none. */
  get eyeHeld(): number | null {
    return this.artEyeTime;
  }

  /** Holds the obelisks' clock at `seconds` from the next frame, stopped: a film's frame (tools/mapworld/gpu-views.ts). */
  holdEye(seconds: number): void {
    this.artEyeTime = seconds;
    this.playEye = false;
    this.artEyeAt = null;
  }

  /** Holds the view at `yaw` and `pitch`, radians, until told another: a picture tool's turn (tools/snap/lamp-play.ts). */
  holdLook(yaw: number, pitch: number): void {
    this.held = [yaw, pitch];
    this.releaseLook = false;
  }

  /** The run's clock for the frame to come, `run`, `last` the page's clock at the frame before. */
  run(run: number, last: number): void {
    if (run >= 0 && this.runMs < 0) this.runFrom = last;
    this.runMs = run;
  }

  /** What is drawn at the page's `nowMs` is timed by the run's clock in a run, so each run is at one point of every fade at each frame. */
  sceneMs(nowMs: number): number {
    return this.runMs >= 0 ? this.runFrom + this.runMs : nowMs;
  }

  /** `tier` with this frame's effects off. */
  tier(tier: Tier): Tier {
    return tierWithout(tier, this.offNow);
  }

  /** Once the others are sampled: the tool's next line is typed, and its look held. */
  readonly lines: FramePart = {
    step: (f) => {
      const alive = f.session.sessionState === SESSION_ALIVE, c = f.controls;
      // A server takes a typed line a few ticks apart.
      if (alive && this.script.length > 0 && f.nowMs >= this.lineAt) {
        f.session.text(this.script.shift()!);
        this.lineAt = f.nowMs + 500;
      }
      if (this.held) {
        c.yaw = this.held[0];
        c.pitch = this.held[1];
        if (alive && this.releaseLook && this.script.length === 0) this.held = null;
      }
    },
  };

  /** Before the frame is built: the clock a picture tool holds, and the effects this frame draws without. */
  readonly stage: FramePart = { step: (f) => this.staged(f) };

  private staged(f: AppFrame): void {
    const scene = f.scene;
    if (this.playEye && this.artEyeAt === null && f.alive && this.script.length === 0) this.artEyeAt = f.nowMs;
    if (this.artEyeTime !== null) {
      scene.eyeSeconds = this.artEyeTime + (this.artEyeAt === null ? 0 : (f.nowMs - this.artEyeAt) / 1000);
      // A picture tool that holds the obelisks' clock holds the drops' with it: a cast leaves by that clock.
      this.supply.tick = scene.eyeSeconds * TICK_RATE;
    } else if (this.runMs >= 0) {
      // The tide's eyes open and shut on the server's ticks; in a run, from the run's still frame, so every run sees each eye alike.
      scene.eyeSeconds = this.runMs / 1000;
    }
    if (this.blastAhead > 0 && this.runMs >= this.blastNext) {
      // Ahead of where the view looks now, which turns: each is in view while it burns.
      this.blastNext = this.runMs + BLAST_EVERY_MS;
      const x = f.cam.x + Math.sin(f.controls.yaw) * this.blastAhead, z = f.cam.z + Math.cos(f.controls.yaw) * this.blastAhead;
      scene.blasts.burst(BLAST_LOOK, x, f.world.hf.heightAt(x, z) + 0.05, z, 0, 1, 0, BLAST_REACH, SURFACE_GROUND, 0, ++this.blasts, f.sceneMs);
    }
    const alternate = this.other !== null && (++this.drawnFrames & 1) === 0, off = (this.offNow = alternate ? this.other! : this.off);
    scene.alternate = alternate;
    sceneWithout(scene, this.off);
    // The street lamps' light and the wires between the poles, which a bench turns off every other frame (`?ab=lamps`, `wires`).
    scene.streetLamps.on = !off.has("lamps");
    scene.streetWires.on = !off.has("wires");
    // The moon's shadows by night, the street lamp that lights as a light and the shadows in the lamps' pool cards, which a
    // bench turns off every other frame (`?ab=moon`, `lamp`, `pools`).
    scene.moonShadows = !off.has("moon");
    scene.streetLamps.light = !off.has("lamp");
    scene.streetLamps.shaded = !off.has("pools");
  }

  /** The frame built: the effects that live in its packet come off. */
  readonly finish: FramePart = { step: (f) => packetWithout(f.packet, this.offNow) };
}
