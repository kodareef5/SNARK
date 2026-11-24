// The app's frame is a list of parts (`rows` in app.ts). A part is one file: the state it keeps from frame to frame and
// what it does in its turn. The app walks the list once a frame, after the session's turn, so a part's place in the list
// is its place in the frame: it reads what the parts before it left in the frame's values (AppFrame) and leaves its own.

import { AnimState } from "../../shared/anim/pose.ts";
import { handleIndex } from "../../shared/ids.ts";
import type { MoveParams } from "../../shared/sim/character.ts";
import { FISTS } from "../../shared/sim/weapon.ts";
import type { VehicleDefinition } from "../../shared/sim/vehicle.ts";
import type { VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Controls } from "./controls.ts";
import type { HudModel, VehicleTelemetry } from "./hud.ts";
import { sightShown, type SightAt, type SightShown } from "./hud/sight.ts";
import { fallenShown, type FallenShown } from "./view/fallen.ts";
import type { HudFrame } from "./hud/widget.ts";
import type { FeedShown } from "./air-feed.ts";
import type { Lasers } from "./render/laser.ts";
import type { SeatedAim } from "./seated-aim.ts";
import type { VoicePort } from "./voice/port.ts";
import type { Camera } from "./render/camera.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { FramePacket } from "./render/packet.ts";
import { bodySeed, type OwnBody, type Scene } from "./render/scene.ts";
import type { SkyClock } from "./sky.ts";
import type { Viewpoint } from "./viewpoint.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import type { Settings } from "./settings.ts";
import type { Ui } from "./ui/ui.ts";

export interface FramePart {
  /** Its turn in the frame. It must not allocate. */
  step(f: AppFrame): void;
}

/** A row of the frame's list: the name the debug bar shows the part's time by, and the part. */
export type PartRow = readonly [name: string, part: FramePart];

/**
 * What the parts read of the frame and hand on. The app keeps one and refills it each frame; none is made in a frame.
 * A value is good from the part that sets it to the frame's end.
 */
export class AppFrame implements HudFrame {
  readonly session: ClientSession;
  readonly controls: Controls;
  readonly ui: Ui;
  readonly hud: HudModel;
  readonly cam: Camera;
  /** The bodies the session sampled for this frame. */
  readonly remote: RemoteSample;
  readonly pack: Pack;
  readonly palette: Uint8Array;
  /** The hour the sky shows, and the view of the own body: its choice of the eye or behind, and where it puts the camera. */
  readonly sky: SkyClock;
  readonly view: Viewpoint;
  /** Casts the lasers' beams. */
  readonly lasers: Lasers;
  /** Poses a seated body's aim. The app makes another when the registry changes. */
  seatedAim: SeatedAim;
  /** The voice port, or null; whether the talk key is down, and in which MODE_. */
  voice: VoicePort | null = null;
  talking = false;
  talkMode = 0;

  /** The frame's time, the milliseconds since the last (16 for the first), and the window in pixels. */
  nowMs = 0;
  dt = 16;
  /** The time what is drawn is timed by: the frame's, or in a measurement run the run's clock (tool-hooks.ts). */
  sceneMs = 0;
  width = 0;
  height = 0;
  aspect = 1;
  /** False while a tool holds the body still; and a page that measures, whose survivor rises looking from the eye. */
  steer = true;
  fromEye = false;
  /** Entity index of the creature in the arms of the own body, or -1. */
  holding = -1;
  /** The tick the predicted body was last on the ground, in water or in a seat. */
  airFrom = 0;
  world!: CollisionWorld;
  scene!: Scene;

  /** There is a living body, and its kind's movement. */
  alive = false;
  move: MoveParams | null | undefined = null;
  /** The eye's height over the feet, eased, and as the stance has it now; 0 with no living body. */
  eye = 0;
  eyeNow = 0;
  /** Where the predicted body is drawn, between its last two ticks. */
  bx = 0;
  by = 0;
  bz = 0;
  /** The vehicle the predicted body is, if it is one, its pose and its heading. */
  car: VehicleDefinition | null | undefined = null;
  vehiclePose: VehicleRenderPose | undefined = undefined;
  carYaw = 0;
  /** It sits in a seat it does not steer from: on a vehicle, on one with a cabin to look round from, and that host's frame. */
  passenger = false;
  passengerVehicle = false;
  passengerCockpit = false;
  cockpitFrame: VehicleFrame | undefined = undefined;
  /** A passenger is shown from behind its host; the view is from outside the body; the orbit camera places it. */
  chase = false;
  third = false;
  orbiting = false;
  /** The driven vehicle's instruments, or null. */
  dash: VehicleTelemetry | null = null;
  /** Where the view looks: the look the input carries, turned by a shot's kick, a scope's sway and a hand's shake. */
  lookYaw = 0;
  lookPitch = 0;
  /** Metres a look reaches what it tells of a creature: through a sight, its gaze's. */
  lookReach = 30;
  /** Where the sight's look starts and how it points, and what the sight shows on the HUD (hud/sight.ts). */
  readonly sightAt: SightAt = { yaw: 0, pitch: 0, laser: false, x: 0, y: 0, z: 0 };
  readonly sight: SightShown = sightShown();
  /** The own survivor knocked down or dying: where the camera rides it, and the red and black over the view (view/fallen.ts). */
  readonly fallen: FallenShown = fallenShown();
  /** What a drone's feed shows (air-feed.ts), which the app sets once. */
  feed: FeedShown | undefined = undefined;
  /** The own body as the scene draws it, and whether it is a mount or a vehicle the body steers. */
  body!: OwnBody;
  riding = false;
  /** What the scene built. */
  packet!: FramePacket;
  /** The words under the crosshair, and whether a piece is in hand to build with. */
  prompt = "";
  building = false;

  /** For the HUD's fills (hud/widget.ts HudFrame): the pause menu is open, a vehicle is driven, a mount's rivalry shows, what the governor did. */
  menu = false;
  inCar = false;
  rivalry = false;
  steady = "";

  constructor(session: ClientSession, controls: Controls, ui: Ui, hud: HudModel, cam: Camera, remote: RemoteSample, pack: Pack, sky: SkyClock, view: Viewpoint, lasers: Lasers, seatedAim: SeatedAim) {
    this.session = session;
    this.controls = controls;
    this.ui = ui;
    this.hud = hud;
    this.cam = cam;
    this.remote = remote;
    this.pack = pack;
    this.palette = pack.palette;
    this.sky = sky;
    this.view = view;
    this.lasers = lasers;
    this.seatedAim = seatedAim;
  }

  /** The session's registry: content as written until the welcome, then as the server tuned it. */
  get reg(): Registry {
    return this.session.registry;
  }

  get settings(): Settings {
    return this.ui.settings;
  }

  private readonly seatState = new AnimState();

  /**
   * The eye of the own body where it sits in a seat it does not steer from, posed on its host as `remote` has it at `tick`
   * and aimed along `yaw` and `pitch`, into `out`. False where it has no such seat.
   */
  seatEye(world: CollisionWorld, remote: RemoteSample, tick: number, yaw: number, pitch: number, out: Float64Array, clip = true, actionTick = this.session.simTick): boolean {
    const s = this.session, b = s.own, st = this.seatState;
    if (s.driving >= 0 || !b.seat || !b.seatSlot) return false;
    st.mode = b.mode; st.grounded = b.grounded; st.stance = b.stance;
    st.setMotion(b.vx, b.vz, yaw, pitch, b.vy);
    st.setAction(b.act, (this.reg.weapon[b.held] ?? FISTS).hold, actionTick - b.actTicks);
    st.seed = bodySeed(handleIndex(s.ownHandle));
    if (!this.seatedAim.pose(remote, s.ownKind, b.seat, b.seatGen, b.seatSlot, st, yaw, tick)) return false;
    this.seatedAim.eye(world, out, clip);
    return true;
  }
}
