// The app's frame is a list of parts (`rows` in app.ts). A part is one file: the state it keeps from frame to frame and
// what it does in its turn. The app walks the list once a frame, after the session's turn, so a part's place in the list
// is its place in the frame: it reads what the parts before it left in the frame's values (AppFrame) and leaves its own.

import type { MoveParams } from "../../shared/sim/character.ts";
import type { VehicleDefinition } from "../../shared/sim/vehicle.ts";
import type { VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Controls } from "./controls.ts";
import type { HudModel, VehicleTelemetry } from "./hud.ts";
import type { HudFrame } from "./hud/widget.ts";
import type { Camera } from "./render/camera.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { FramePacket } from "./render/packet.ts";
import type { OwnBody, Scene } from "./render/scene.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import type { Settings } from "./settings.ts";
import type { Ui } from "./ui/ui.ts";

export interface FramePart {
  /** Its turn in the frame. It must not allocate. */
  step(f: AppFrame): void;
}

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

  /** The frame's time, the milliseconds since the last (16 for the first), and the window in pixels. */
  nowMs = 0;
  dt = 16;
  width = 0;
  height = 0;
  aspect = 1;
  /** False while a tool holds the body still. */
  steer = true;
  /** Entity index of the creature in the arms of the own body, or -1. */
  holding = -1;
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
  /** The vehicle the predicted body is, if it is one, whether it is a helicopter or a boat, its pose and its heading. */
  car: VehicleDefinition | null | undefined = null;
  rotor = false;
  boat = false;
  vehiclePose: VehicleRenderPose | undefined = undefined;
  carYaw = 0;
  /** It sits in a seat it does not steer from: on a vehicle, on one with a cabin to look round from, and that host's frame. */
  passenger = false;
  passengerVehicle = false;
  passengerCockpit = false;
  cockpitFrame: VehicleFrame | undefined = undefined;
  /** A passenger is shown from behind its host; the view is from outside the body. */
  chase = false;
  third = false;
  /** The driven vehicle's instruments, or null. */
  dash: VehicleTelemetry | null = null;
  /** Where the view looks: the look the input carries, turned by a shot's kick, a scope's sway and a hand's shake. */
  lookYaw = 0;
  lookPitch = 0;
  /** Metres a look reaches what it tells of a creature: through a sight, its gaze's. */
  lookReach = 30;
  /** The own body as the scene draws it, and whether it is a mount or a vehicle the body steers. */
  body!: OwnBody;
  riding = false;
  /** What the scene built. */
  packet!: FramePacket;

  /** For the HUD's fills (hud/widget.ts HudFrame): the pause menu is open, a vehicle is driven, a mount's rivalry shows, what the governor did. */
  menu = false;
  inCar = false;
  rivalry = false;
  steady = "";

  constructor(session: ClientSession, controls: Controls, ui: Ui, hud: HudModel, cam: Camera, remote: RemoteSample, pack: Pack) {
    this.session = session;
    this.controls = controls;
    this.ui = ui;
    this.hud = hud;
    this.cam = cam;
    this.remote = remote;
    this.pack = pack;
    this.palette = pack.palette;
  }

  /** The session's registry: content as written until the welcome, then as the server tuned it. */
  get reg(): Registry {
    return this.session.registry;
  }

  get settings(): Settings {
    return this.ui.settings;
  }
}
