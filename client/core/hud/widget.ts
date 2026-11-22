// The HUD is a list of widgets (widgets.ts). A widget is one file: its slice of the HUD's model, how that is filled
// each frame, and how it is drawn into the interface's frame. The list's order is the order they are filled and drawn in.

import type { Registry } from "../../../shared/content/registry.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import type { HudModel, VehicleTelemetry } from "../hud.ts";
import type { Lasers } from "../render/laser.ts";
import type { SeatedAim } from "../seated-aim.ts";
import type { VoicePort } from "../voice/port.ts";
import type { SightAt, SightShown } from "./sight.ts";
import type { Camera } from "../render/camera.ts";
import type { Scene } from "../render/scene.ts";
import type { ClientSession, RemoteSample } from "../session.ts";
import type { Settings } from "../settings.ts";
import type { UiFrame } from "../ui/nodes.ts";
import type { TouchPlan } from "../ui/touch.ts";

/**
 * `M` is the widget's slice of the model. Its fields are made once, by `make`, and stand on the HUD's one model beside
 * every other widget's (HudModel), so `app.hud.field` reads them; two widgets may not use the same name. `fill` and
 * `build` are handed that model, and may read what another widget filled before them.
 */
export interface HudWidget<M extends object = object> {
  name: string;
  /** The slice as it starts. Called once for each model: arrays and objects in it are refilled, never made again. */
  make?(): M;
  /** Each frame, before anything is drawn. It must not allocate. */
  fill?(m: HudModel & M, c: HudFill): void;
  /** Draws into `f`. `at` is where the HUD's shared places are on this canvas. */
  build?(f: UiFrame, m: HudModel & M, at: HudLayout): void;
}

/** What a fill reads. The app keeps one and sets it each frame; `updateHud` alone fills from a session, with no `frame`. */
export class HudFill {
  session!: ClientSession;
  remote!: RemoteSample;
  fps = 0;
  /** Screen pixels to a unit of the interface. */
  scale = 1;
  /** Undefined for a model updated outside time. */
  nowMs: number | undefined = undefined;
  /** The app's frame, or null where the HUD is updated from a session alone (a test, a tool). */
  frame: HudFrame | null = null;
}

/** What only a running app knows of the frame. */
export interface HudFrame {
  settings: Settings;
  scene: Scene;
  cam: Camera;
  world: CollisionWorld;
  reg: Registry;
  palette: Uint8Array;
  /** The pause menu is open. */
  menu: boolean;
  /** There is a living body. */
  alive: boolean;
  /** It drives a vehicle. */
  inCar: boolean;
  /** Its mount's rivalry buff shows. */
  rivalry: boolean;
  /** What the governor has done, after the frame rate, or "". */
  steady: string;
  /** The driven vehicle's instruments (hud/vehicle.ts Dash), or null. */
  dash: VehicleTelemetry | null;
  /** What a sight looked through shows this frame, and where its look starts and how it points (hud/sight.ts). */
  sight: SightShown;
  sightAt: SightAt;
  /** What casts the lasers' beams, and what poses a seated body's aim. */
  lasers: Lasers;
  seatedAim: SeatedAim;
  /** The voice port, or null; whether the talk key is down, and in which MODE_. */
  voice: VoicePort | null;
  talking: boolean;
  talkMode: number;
  /** The words under the crosshair (prompts.ts), and whether a piece is in hand to build with. */
  prompt: string;
  building: boolean;
}

/** Where the HUD's shared places are on a canvas, worked out once a build (layout.ts) and read by every widget. */
export interface HudLayout {
  options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass">;
  controls: boolean;
  inspect: boolean;
  touch: TouchPlan | null;
  W: number;
  H: number;
  /** The corners anchored things keep to. */
  left: number;
  right: number;
  foot: number;
  /** The minimap's side, its place, and whether its buttons show. */
  MAP: number;
  mapX: number;
  mapY: number;
  mapTools: boolean;
  /** The column in the top left: its top, a line's height, whether the readout shows and how wide, and where it ends. */
  top: number;
  lh: number;
  readout: boolean;
  readW: number;
  columnFoot: number;
  voiceY: number;
  /** The panel under the minimap: the vehicle driven or null, whether any panel shows, and its box. */
  dash: VehicleTelemetry | null;
  panel: boolean;
  dashX: number;
  dashY: number;
  dashW: number;
  dashH: number;
  /** By touch a vehicle's panel loses its lines of keys (`lean`), and on a phone on its side stands under the bar (`aside`). */
  lean: boolean;
  aside: boolean;
}
