import { supplyName } from "../../shared/sim/supply.ts";
import { IMPALE_SLOT } from "../../shared/sim/seats.ts";
import { creatureHold } from "../../shared/sim/creature-actions.ts";
// One whole client without a browser. The shell owns the renderer, socket and DOM, forwards events
// here, and draws what frame() returns. Tests drive this class directly.

import { Icons } from "./assets/icons.ts";
import { chunkAt } from "../../shared/coords.ts";
import { easeFov, eyeOff, forcesEye, FOV_EASE_MS, lookScale, magnification, opticMost, opticZoom, shapeOf, windowBox, windowShare, zoomed } from "./optics.ts";
import { Visor } from "./visor.ts";
import { Glass, MARKED_MS } from "./glass.ts";
import { MARK_SPOT } from "../../shared/world/tactical.ts";
import { CUE_DEAD, CUE_SCOPED } from "../../shared/anim/pose.ts";
import type { OpticFacet } from "../../shared/content/defs.ts";
import { GamepadInput, type PadSample, type PadTarget } from "./gamepad.ts";
import type { AssetPort } from "./assets/port.ts";
import { canvasRatio, forTouch, ownRatio, tierOf, type Tier } from "./assets/tiers.ts";
import { Governor, PHONE_MS, ladder, workMs } from "./governor.ts";
import type { FrameRing } from "./assets/frames.ts";
import { BENCH_TURN_MS, effectsOff, packetWithout, sceneWithout, tierWithout, type Effect } from "./passes.ts";
import { RESOLUTIONS, sceneShare } from "./render/post.ts";
import { VOLUME_MAX } from "./settings.ts";
import { toggleBudget, toggleMonitor, toggleNotes } from "./settings.ts";
import { MONITOR_KIT } from "./ui/monitor-kit.ts";
import { NOTES_KIT } from "./notes-kit.ts";
import type { NotePort } from "./notes/port.ts";
import { stressThings, type Mark } from "./stress.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { MountCameraPivot } from "./mount-camera.ts";
import { motionProgress, motionTicks } from "../../shared/sim/motion.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { GLIDE_DIVE, JET_CUIRASS, MF_WINDED, MODE_FLYER, MODE_SWIM, MODE_WALK, glidePhase, stanceEye } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CMD_GAZE, CMD_MARK, CMD_THROW, GAZE_FARTHEST, GAZE_REACH } from "../../shared/net/protocol.ts";
import { CARRY_THROW, CMD_VEHICLE, VEHICLE_INSPECT, VEHICLE_LIGHTS, CMD_CARRY, CMD_OPEN, CMD_ORDER, CMD_SELECT, CMD_TAKE, MARKER_DEATH, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_STAY, ORDER_YOURS, REJECT_FULL, REJECT_PASSWORD, REJECT_TRAVEL, REJECT_VERSION, RESULT_LOCKED, RESULT_OK, SESSION_ALIVE, SESSION_CREATING, RESULT_NO_SNAP, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { structName } from "./ui/structure.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { Controls, LOOK_SPEED } from "./controls.ts";
import { HudModel, VehicleTelemetry, fillAction, fillBuffs, fillHotbar, fillOverhead, updateHud } from "./hud.ts";
import { Chart } from "./tactical.ts";
import { Camera } from "./render/camera.ts";
import { seatScratch } from "./render/characters.ts";
import { SQUEEZE_MOST } from "./render/budget.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, bodySeed, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { SupplyView } from "./supply.ts";
import { Falling } from "./rubble.ts";
import { BTN_SPRINT, BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_VISOR } from "../../shared/sim/character.ts";
import { FISTS, HOLD_CARRY } from "../../shared/sim/weapon.ts";
import { KICK_UNIT, breathShare, scopeFitted, shotCone, sway, swayOut } from "../../shared/sim/aim.ts";
import { AnimState, CUE_HELD, CUE_OUT } from "../../shared/anim/pose.ts";
import { handleGen, handleIndex, makeHandle } from "../../shared/ids.ts";
import { VehiclePlacement } from "./vehicle-placement.ts";
import { SeatedAim } from "./seated-aim.ts";
import { predictedVehiclePose, remoteVehiclePose } from "./vehicle-view.ts";
import { vehiclePoint, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { loosePrompt } from "./balls.ts";
import { KEEP_REACH } from "../../shared/sim/balls.ts";
import { lookAt, riddenOf, vehiclePrompt } from "./vehicle-prompt.ts";
import { SeatNotice, type Ridden } from "./seat-notice.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ON, type Inventory } from "../../shared/sim/items.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { Lasers, daylight } from "./render/laser.ts";
import { CHASE_BOOM, CHASE_TILT, CockpitLook, ORBIT_BACK, Viewpoint, chasePitch } from "./viewpoint.ts";
import { Orbit, rig, type OrbitRig } from "./orbit.ts";
import { CLOSED_BAD_CONTENT, CLOSED_BAD_VERSION, RemoteSample, type ClientSession } from "./session.ts";
import { Builder, GHOST_BAD, GHOST_OK } from "./build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { itemLabel, waitWords } from "./ui/inventory.ts";
import { BAG } from "./render/dropped.ts";
import { voicePan } from "./voice/place.ts";
import { HEAR_FIELDS, type VoicePort } from "./voice/port.ts";
import { MODE_TALK, MODE_WHISPER, MODE_YELL } from "../../shared/voice/packet.ts";
import type { SoundSink } from "./sound/packet.ts";
import type { Sounds } from "./sound/sounds.ts";
import type { SoundDecoder } from "./sound/library.ts";
import type { MusicTrack } from "./sound/music.ts";
import { SkyClock } from "./sky.ts";
import type { SoundCode } from "./sound-late.ts";
import { SplitPort } from "./sound/split.ts";

/** Indexed by MODE_*. */
const TALK_LABEL: readonly string[] = ["WHISPERING", "TALKING", "YELLING"];
import { IMAGE_MAP, IMAGE_MINIMAP, KEY_HOTBAR, KEY_MINIMAP_TOGGLE, KEY_MINIMAP_OUT, KEY_MINIMAP_IN, KEY_VITAL } from "./ui/hud.ts";
import { canvasHeight, textWidth, wrapText } from "./ui/nodes.ts";
import { glass } from "./ui/skin.ts";
import { TouchPlay, type TouchTarget } from "./touch.ts";
import { mapPointer } from "./ui/screens.ts";
import { Ui } from "./ui/ui.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { TRAVEL_REFRESH_MS } from "./ui/travel.ts";
import { arrivalAddress, joinAddress, serverAddress, siteLinks, type ClusterList, type Page } from "./travel.ts";

/** The master volume of a page that measures itself (a probe, a bench, the device page), of 1 for full: `?volume=` gives another. */
export const MEASURED_VOLUME = 0.02;
/** Metres. Matches the server's REACH. */
const REACH = 3.5;
/** Holding the use key on a structure this long opens its menu. */
const STRUCT_HOLD_MS = 350;
/** Metres. */
const NAME_RANGE = 30;
/** Bits of the replicated entity flags. */
const VIEW_FLAG_PLAYER = 4;
const VIEW_FLAG_PROP = 8;
/** What hands round a creature cannot do, so a body holding one neither sends nor predicts them (server/carry.ts). */
const HANDS_FULL = BTN_PRIMARY | BTN_MELEE | BTN_RELOAD | BTN_PRONE;
/** Radians the view opens by at a glider's dive speed. */
const GLIDE_FOV = (6 * Math.PI) / 180;
/** Ticks in the air before C stops being the crouch and becomes the glider's key, so a step off a kerb does not stand a crouched body up. */
const GLIDER_KEY_TICKS = 6;
/** Metres the orbit's camera is behind the eye before the body is drawn whole; nearer than the near plane its head is not seen. */
const HEAD_CLEAR = .1;

/** Initial vertical field of view, in radians. AIM_FOV multiplies the player's setting while aiming. */
const BASE_FOV = 1.2217;
const AIM_FOV = 0.79;
/**
 * How many times a sight magnifies is its item's optic facet (optics.ts): the scope "zooms by about 3x" (Scope
 * Attachment), the holo-scope "a slight zoom (around 1.25x)" (Holo-Scope Attachment). The holo-scope tints the view
 * green, "similar to a nightvision mode", this much.
 */
const HOLO_TINT = 0.22;
/** Milliseconds between CMD_GAZEs while a sight's zoom holds: well inside GAZE_TICKS, after which the server lets it go. */
const GAZE_RESEND_MS = 1000;
/** Milliseconds N is held to raise or lower a helmet's visor. */
const VISOR_HOLD_MS = 400;
/** The zoom from which the near trees round what a sight is on are held (D1090). */
const NODE_FOCUS = 4;
/** Milliseconds between finds of what a sight is on. */
const FOCUS_MS = 250;
/** A zooming sight's step of the wheel, and a zero's, metres, as far as ZERO_MOST. */
const SIGHT_STEP = 1.25;
const ZERO_STEP = 50;
const ZERO_MOST = 1000;
/** A glint shows within this of straight at the viewer, radians, and past this many metres. */
const GLINT_HALF = 0.12;
const GLINT_NEAR = 20;
/** Metres over the ground a spotted creature's mark is drawn. */
const SPOT_RISE = 3;
/** Milliseconds the eye takes to settle most of the way to where it is off a scope's axis. */
const EYE_EASE_MS = 120;
/** Metres a holo-scope's crosshair finds what it is on, and its colours (Holo-Scope Attachment). */
const HOLO_REACH = 300;
const HOLO_FRIEND = 0x48e05a;
const HOLO_FOE = 0xff3a30;
const HOLO_OTHER = 0xf2d23a;

/** The attachment (ItemDef) on the weapon in `slot` of `inv`, or null. */
function attachmentOf(reg: Registry, inv: Inventory | null, slot: number): ItemDef | null {
  const fitted = inv && slot >= 0 ? inv.attach[slot]! : 0;
  return fitted === 0 ? null : (reg.defs[fitted] as ItemDef | null);
}
/** Radians in a unit of yaw or pitch on the wire (65536 to a turn). */
const UNIT_RADIANS = TAU / 65536;

/** What a tool's own server tells a page that is the tool's look at a place (`App.address`). */
export interface ToolOrders {
  readonly run?: readonly unknown[];
  readonly look?: readonly unknown[];
  readonly eyeSeconds?: number;
  readonly playEye?: boolean;
  readonly holdLook?: boolean;
}

export class App {
  readonly session: ClientSession;
  readonly controls = new Controls();
  readonly ui = new Ui();
  readonly cam = new Camera();
  private artEyeTime: number | null = null;
  private playEye = false;
  private artEyeAt: number | null = null;
  readonly hud = new HudModel();
  /** The hour the sky shows: the server's, swept when it is set, or the one in an admin's hand on the sundial. */
  readonly sky = new SkyClock();
  /** The dash's readings of the vehicle driven. */
  readonly vehicleTelemetry = new VehicleTelemetry();
  readonly feedback = new Feedback();
  /** Laser dots this frame (client/core/render/laser.ts). */
  readonly lasers = new Lasers();
  private seatedAim: SeatedAim;
  private readonly shotSample = new RemoteSample();
  private readonly shotState = new AnimState();
  private readonly posedEye = new Float64Array(3);
  /** The frame's view and eye, and whether its own laser is on, for the sights. */
  private readonly sightAt = { yaw: 0, pitch: 0, laser: false, x: 0, y: 0, z: 0 };
  private readonly spot = [0, 0, 0];
  /** Where a passenger sits, for its camera (Characters.seat), and the pose of the creature it sits on. */
  private readonly seatSpot = new Float64Array(12);
  private readonly seated = seatScratch();
  private readonly mountState = new AnimState();
  readonly shots: Shots;
  readonly supply: SupplyView;
  /** Null until the world arrives. */
  falling: Falling | null = null;
  /** Eased toward what the held weapon and the aim button ask for. */
  private fov = BASE_FOV;
  /** Scratch for the eye's offset off a sight's axis and the sight's window (optics.ts eyeOff, windowBox). */
  private readonly eyeAt = new Float64Array(2);
  private readonly windowAt = new Float64Array(4);
  /** The Meridian helmet's visor (visor.ts, D1080). */
  readonly visor = new Visor();
  /** A held glass, the spyglass (glass.ts, D1082), and its optic while one is held; whether its primary was down. */
  readonly glass = new Glass();
  private glassOptic: OpticFacet | null = null;
  private glassPressed = false;
  private readonly shook = new Float64Array(2);
  /**
   * A sight that zooms (the sniper's, D1083) while aimed through, its zoom, and its zero in metres (0 for none), dialled
   * with Alt and the wheel; and the zero the server was last told of.
   */
  private sightOptic: OpticFacet | null = null;
  sightZoom = 0;
  sightZero = 0;
  private zeroSent = 0;
  /** How far the look reaches what it tells of a creature this frame (fillOverhead): through a sight, its gaze's. */
  private lookReach = 30;
  private visorOptic: OpticFacet | null = null;
  /** The zoom the server was last told of (App.gaze), and when. */
  private gazeSent = 0;
  private gazeAt = -Infinity;
  /** When N went down with a visor to raise (-1 when it is up), whether it has been held long, and a tap's press to send. */
  private nDownAt = -1;
  private nLong = false;
  private nPulse = 0;
  /** When what the sight is on was last found (App.gaze). */
  private focusAt = -Infinity;
  readonly remote = new RemoteSample();
  readonly view = new Viewpoint();
  /** The orbit camera on K, and whether the last frame's view lets it start. */
  readonly orbit = new Orbit();
  private orbitFree = false;
  private readonly viewRig = rig();
  private readonly mountCamera = new MountCameraPivot();
  private readonly cockpit = new CockpitLook();
  scene: Scene | null = null;
  /** Draw the stress meshes, if the pack has them. `marks` are the rocks whose colour says which level is on the screen. */
  stress = false;
  marks: Mark[] = [];
  /** Show the asset library's state on the status line. */
  debug = false;
  /** The manifest and the asset port the scene is made with once the session has a world. */
  stream: { manifest: Manifest; port: AssetPort } | undefined;
  /** The asset port shared with the sounds, once there is a scene and a device to play on. */
  private split: SplitPort | null = null;
  /** Smoothed. */
  fps = 60;
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
  private farPalms = false;
  /** Keeps the frame steady under the tier chosen (governor.ts). The shell tells it what each frame took. */
  readonly governor = new Governor();
  /** What each frame took and what came in it, for the data utility's monitor (assets/frames.ts), once the shell has fetched it. */
  frames: FrameRing | null = null;
  private monitorAsked = false;
  /** The world's sounds' code (sound-late.ts), which comes after the first frame, as the sounds' rows do (D1107). */
  static late: SoundCode | null = null;
  private soundAsked = false;
  /**
   * Bug report mode (notes/notes.ts), fetched once Settings.notes is first on, as the monitor is; null until then. And
   * what fetches the browser's part of it, which the shell sets (client/notes/port.ts).
   */
  notes: import("./notes/notes.ts").Notes | null = null;
  notePort: (() => Promise<NotePort>) | null = null;
  private notesAsked = false;
  /**
   * Whether the card has linked every program a tier draws with, beginning those it has not (the shell's `ready`). A
   * tier chosen or stepped to is drawn once it has, and the one before until then; null draws it at once.
   */
  tierReady: ((tier: Tier) => boolean) | null = null;
  /** The tier chosen whose governor's steps are begun, those still to begin, a step a frame, and whether a tier was drawn yet. */
  private warmedBase: Tier | null = null;
  private readonly warming: Tier[] = [];
  private tierShown = false;
  /** The screen's device pixels a CSS pixel, and effects the page's address turned off (passes.ts). */
  dpr = 1;
  off: ReadonlySet<Effect> = new Set();
  /** What every other frame draws with off instead (`?ab=`, passes.ts), or null, and the frames drawn. */
  private other: ReadonlySet<Effect> | null = null;
  private drawnFrames = 0;
  private interval = 0;
  /** Whether the keys are a flyer's, and the last tick stepped before its wing was last wanted. */
  private flying = false;
  private wingFrom = 0;
  private wingWas = false;

  /** The registry last handed to the UI and shots. frame() swaps it when the session's changes. */
  private shown: Registry;
  private readonly pad = new GamepadInput();
  private readonly padTarget: PadTarget;
  /** Play by touch: its state, and what it drives. */
  readonly touch = new TouchPlay();
  private readonly touchTarget: TouchTarget = {
    key: (code, down) => { this.key(code, down, false, 2); }, mouse: (button, down) => this.mouseButton(button, down, 2),
    move: (x, z) => this.controls.touchMove(x, z), look: (dx, dy) => this.look(dx, dy),
  };
  /** What the screen's edges take from each side, in CSS pixels: left, top, right, bottom. The shell sets them. */
  readonly insets = [0, 0, 0, 0];
  /** CSS pixels to a canvas unit, this frame. */
  private unit = 1;
  private readonly pack: Pack;
  private last = -1;
  /** Adopt the welcome's authored/saved facing once, before the first input overwrites it. */
  private facing = false;
  /** A tool's look at a place (`address`): the commands still to send, and the facing held. */
  private script: string[] = [];
  private held: [number, number] | null = null;
  /** The scene's share a page that measures asks (`?scale=`, render/post.ts sceneShare), in place of the setting's; 0 for none. */
  private shareAsked = 0;
  private releaseLook = false;
  private lineAt = 0;
  /** Eased eye height above the feet, or -1 before the first frame and while there is no living body. */
  private eye = -1;
  private helicopterViewHost = -1;
  private readonly aim = [0, 0, 0];
  /** Whether the survivor was on its own feet last frame, to know the frame it rises or gets out of a vehicle, a seat or a saddle. */
  private wasOnFoot = false;
  private readonly body: OwnBody = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT), id: 0 };

  /** The session's registry. It is content as written until the welcome, then as the server tuned it. */
  private get reg(): Registry {
    return this.session.registry;
  }

  /** With `stream`, `pack` is the boot pack and other levels are fetched through the port as they are wanted. */
  constructor(session: ClientSession, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort }) {
    this.stream = stream;
    this.session = session;
    this.shown = reg;
    this.bagKind = reg.index.get(BAG) ?? -1;
    this.pack = pack;
    this.seatedAim = new SeatedAim(reg, pack);
    session.shotOrigin = (out, tick, yaw, pitch) => {
      if (!session.world || session.driving >= 0 || !session.own.seat) return false;
      session.sampleRemote(this.shotSample);
      return this.ownSeatEye(session.world, this.shotSample, tick, yaw, pitch, out, true, tick);
    };
    this.ui.registry = reg;
    this.ui.palette = pack.palette;
    this.ui.touchPlay = this.touch;
    const app = this;
    this.padTarget = {
      get inMenu() { return !app.ui.wantsPointerLock; },
      get inspecting() { return app.ui.inspect; },
      get flying() { return app.controls.onFlyer; },
      get patrol() { return app.session.driving >= 0 && app.vehicleTelemetry.lightMode >= 0; },
      get zooming() { return app.zooming; },
      zoom: (notches, alt) => void this.zoomBy(notches, alt),
      adjust: by => this.ui.adjustFocused(by),
      key: (code, down) => { this.key(code, down, false, 1); }, mouse: (button, down) => this.mouseButton(button, down, 1),
      move: (x, z) => this.controls.padMove(x, z), look: (x, y) => this.look(x,y), used: () => { this.ui.inputDevice = 1; },
      navigate: (direction, press) => {
        const key = this.ui.navigate(direction), n = this.ui.frame.find(key);
        if (press && n) this.pointer(press === 1 ? 0 : 1, key, n.x+n.w/2, n.y+n.h/2, 0);
      },
    };
    // Within the press that chose it, which is when a browser lets a page open another.
    this.ui.openLink = (url) => this.page?.open?.(url);
    this.ui.local = (line) => (line === "monitor" ? toggleMonitor(this.ui.settings) : this.notesWord(line) ?? (this.sounds ? App.late!.soundCommand(line, this.sounds, this.session.own, this.controls.yaw, this.nowMs) : null));
    this.ui.chat.local = (line) => this.notesWord(line);
    // The inventory pictures the build drew, fetched as they are first shown.
    if (stream?.manifest.icons) new Icons(stream.manifest, reg.defs).install(this.ui.frame);
    // The Storage tab's page comes as its own file, which the first frame does not wait for, and draws with these (D906).
    void import("./ui/storage.ts").then((m) => (this.ui.storage = new m.StoragePage({ textWidth, wrapText, glass })), () => {});
    this.shots = new Shots(reg, pack);
    this.supply = new SupplyView(reg, pack);
    const nodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
    session.onNode = (chunk, index, used, crushed, priorForm) => {
      const field = session.nodeField;
      if (!used || !crushed || !field || !this.scene) return;
      const ref = chunk * 65536 + index;
      if (session.predictedTrees?.hidden(ref)) return;
      field.source.at(chunk, index, nodeSpot);
      if (Math.hypot(nodeSpot.x - session.own.x, nodeSpot.y - session.own.y, nodeSpot.z - session.own.z) > 64) return;
      const form = priorForm || nodeSpot.form;
      this.scene.treeFalls.add({ action: "break", ref, kind: nodeSpot.kind, form, x: nodeSpot.x, y: nodeSpot.y, z: nodeSpot.z, yaw: nodeSpot.yaw, dx: nodeSpot.x - session.own.x, dz: nodeSpot.z - session.own.z, tick: session.serverTick }, this.nowMs);
      this.scene.details.nodeBreak(nodeSpot.kind, chunk * 256 + index, nodeSpot.x, nodeSpot.y, nodeSpot.z,
        session.renderClock - session.remoteDelay, field.forms.size[form]! / 64);
    };
    this.ui.inventory.onDeploy = slot => this.vehiclePlacement.begin(slot);
    session.onResult = (seq, code) => {
      this.ui.creator.result(seq, code === RESULT_OK);
      this.ui.inventory.result(seq, code, session.tickClock);
      this.builder.result(seq, code, this.nowMs);
      this.vehiclePlacement.result(seq, code, this.nowMs);
      // An unasked result answers the last press of the use key: on a seat it is the seat's, else the built piece's.
      if (!this.seatNotice.result(seq, code, this.nowMs)) this.ui.structure.result(seq, code, this.nowMs, this.session, this.aimed);
      this.ui.emotes.result(seq, code, this.nowMs);
      if (code === RESULT_LOCKED) this.ui.hear?.("door/locked");
    };
  }

  readonly builder = new Builder();
  readonly vehiclePlacement = new VehiclePlacement();
  /** Why the server refused the last press of the use key on a seat. */
  readonly seatNotice = new SeatNotice();
  /** What the prompt's look is on, as a seat would be ridden: a vehicle, a saddled creature, or null. */
  private promptRidden: Ridden | null = null;
  /** The page, for travel between the servers of a cluster. The shell sets it; without one nobody travels. */
  page: Page | null = null;
  /** The page is on its way to another server, or has said it arrived. */
  private leaving = false;
  private arrived = false;
  /** The travel list was opened for a survivor turned away. */
  private turnedAway = false;
  /** Time of the last frame. */
  private nowMs = 0;
  /** Entity index of the tribe's creature under the crosshair, or -1. */
  lookedAt = -1;
  /** Crosshair hit for boat service, including unclaimed hulls and salvage. */
  private aimedBoat = -1;
  /** Entity index of any body under the crosshair within NAME_RANGE, or -1: what the attack whistle names. */
  target = -1;
  /** Entity index of the creature in the arms of the viewer's own body, as the last frame's remote sample says, or -1. */
  holding = -1;
  /** useDownAt is when the use key went down, or -1. aimed is the ref of the player-built structure under the crosshair, or -1. */
  private useDownAt = -1;
  aimed = -1;
  /** The use key went down on a structure. The body does not get the press until it proves to be a tap. */
  private useKept = false;
  /** Frames left of the synthetic use press that follows a tap. */
  private usePulse = 0;
  /** Entity index of the egg under the crosshair, or -1. eggKept: the use key went down on one, and took it with CMD_TAKE. */
  private eggAimed = -1;
  /** The content index of a bag (client/core/render/dropped.ts), or -1. */
  private readonly bagKind: number;
  /** The obelisk terminal under the crosshair within reach, or -1. */
  private terminalAimed = -1;
  private eggKept = false;

  voice: VoicePort | null = null;
  /** Plays the world's sounds. Null in tests and wherever there is no audio: then no sound work is done at all. */
  sound: SoundSink | null = null;
  /** Made with the scene, where there is a sink and the assets stream. */
  sounds: Sounds | null = null;
  /** Decodes sounds off the main thread: the browser's worker, set before the first frame. Null decodes inline. */
  soundDecoder: SoundDecoder | null = null;
  /** The music tracks the build lists (assets/music/music.json), once fetched; null for none. */
  musicTracks: readonly MusicTrack[] | null = null;
  /** Tames already heard of the session's queue, which the naming prompt empties. */
  private tamedHeard = 0;
  talking = false;
  private talkMode = MODE_TALK;
  private volumeSet = -1;
  /** With the talk key, Alt whispers and Shift yells. */
  private alt = false;
  private shift = false;

  private talk(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.talkMode = this.alt ? MODE_WHISPER : this.shift ? MODE_YELL : MODE_TALK;
    this.voice?.talk(on, this.talkMode, this.ui.settings.toggleTalk);
  }

  /** Sends the voice port each speaker's distance and pan, and lists the talkers on the HUD. */
  private listen(hud: HudModel): void {
    hud.talkers.length = 0;
    hud.voice = "";
    const v = this.voice;
    if (!v) return;
    if (v.notice !== "") hud.voice = v.notice;
    else if (this.talking) hud.voice = this.ui.settings.toggleTalk && !v.sending ? "MIC OPEN" : TALK_LABEL[this.talkMode]!;
    hud.micLevel = v.level;
    const heard = this.ui.settings.muted ? 0 : this.ui.settings.voiceVolume;
    if (this.volumeSet !== heard) v.volume((this.volumeSet = heard));
    if (v.speakers.size === 0) return;
    const r = this.remote;
    const own = this.session.own;
    const at = this.heardAt;
    let n = 0;
    for (const [speaker, s] of v.speakers) {
      if ((n + 1) * HEAR_FIELDS > at.length) break;
      const index = handleIndex(s.handle);
      let far = -1;
      let side = 0;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== index) continue;
        far = Math.hypot(r.x[i]! - own.x, r.y[i]! - own.y, r.z[i]! - own.z);
        side = voicePan(r.x[i]! - own.x, r.z[i]! - own.z, this.controls.yaw);
        break;
      }
      at[n * HEAR_FIELDS] = speaker;
      at[n * HEAR_FIELDS + 1] = far;
      at[n * HEAR_FIELDS + 2] = side;
      n++;
      if (s.speaking && hud.talkers.length < 8) hud.talkers.push(s.name);
    }
    v.hear(at, n);
  }
  /** Scratch for hear(). */
  private readonly heardAt = new Float32Array(HEAR_FIELDS * 128);

  /** Returns true if the page should not also act on the key. */
  key(code: string, down: boolean, repeat = false, source = 0): boolean {
    if (down && !repeat) this.ui.inputDevice = source;
    // F8 takes a note in bug report mode, from any screen (notes/notes.ts).
    if (code === "F8" && this.notes) return this.notes.key(down, repeat);
    if (!this.ui.captureKeyboard && this.vehiclePlacement.key(code, down, repeat)) return true;
    if (this.ui.key(code, down, repeat, this.session)) {
      // A screen that captures the keyboard releases the body's keys and a push-to-talk microphone.
      if (this.ui.captureKeyboard) {
        this.blur();
      }
      return true;
    }
    if (this.ui.inspect && (code === "Minus" || code === "Equal")) { if (down && !repeat) this.zoomMini(code === "Equal" ? 1 : -1); return true; }
    if (this.ui.captureKeyboard) return false;
    // A raised sight that zooms takes the arrows up and down, as the wheel (and a finger's zoom buttons, which send them).
    if ((code === "ArrowUp" || code === "ArrowDown") && this.zooming && !this.ui.map) {
      if (down) this.zoomBy(code === "ArrowUp" ? -1 : 1);
      return true;
    }
    // With a glass raised, N marks what the look is on for the tribe (D1082).
    if (code === "KeyN" && this.glass.up) {
      const o = this.hud.overhead;
      if (down && !repeat && o.lookedId >= 0) {
        this.session.command(CMD_MARK, (w) => (w.u32(o.lookedId), w.u16(o.lookedGen)));
        this.glass.markedAt = this.nowMs;
      }
      return true;
    }
    // With a helmet's visor to raise, N held VISOR_HOLD_MS raises it or lowers it again, as ARK's Tek helmet takes a long
    // press, for a mouse with no middle button (which holds it up); a tap turns its view while it is up, and is what the
    // held weapon has fitted otherwise, sent as it is let go (D1089).
    if (code === "KeyN" && this.ui.wantsPointerLock && (this.visorOptic !== null || this.visor.held)) {
      if (down && !repeat) {
        this.nDownAt = this.nowMs;
        this.nLong = false;
      } else if (!down && this.nDownAt >= 0) {
        if (!this.nLong) {
          if (this.visor.up) this.visor.cycle();
          else this.nPulse = 2;
        }
        this.nDownAt = -1;
      }
      return true;
    }
    if (this.builder.key(code, down, repeat, this.nowMs, this.reg)) return true;
    // Minus and Equal zoom the minimap, or the map while it is open, where the arrows move it.
    if (this.hud.chart?.key(code, down && !repeat, this.ui.map)) {
      if (!this.ui.map && down && !repeat) { this.ui.settings.minimapZoom = this.hud.chart.miniZoom; this.ui.settings.changed(); }
      return true;
    }
    if (code === "AltLeft" || code === "AltRight") {
      // Returning true keeps the browser from opening its menu.
      this.alt = down;
      return true;
    }
    if (code === "ShiftLeft" || code === "ShiftRight") this.shift = down;
    // The use key on an egg takes it up with a command of its own, and the body does not get the press.
    if (code === "KeyE" && (this.eggKept || (down && !repeat && this.eggAimed >= 0))) {
      if (!this.eggKept) this.session.command(CMD_TAKE, (w) => w.u32(this.eggAimed >>> 0));
      this.eggKept = down;
      return true;
    }
    // The use key at an obelisk's terminal opens the list of servers to travel to.
    if (code === "KeyE" && down && !repeat && this.terminalAimed >= 0) {
      this.ui.travel.openAt(this.terminalAimed);
      return true;
    }
    // Holding the use key on a structure opens its menu, so there the body gets the press only on release, as a short pulse.
    if (code === "KeyE") {
      if (down && !repeat) {
        this.seatNotice.pressed(this.seatPress());
        this.useDownAt = this.nowMs;
        this.useKept = this.aimed >= 0;
      } else if (!down) {
        if (this.useKept && this.useDownAt >= 0) this.usePulse = 4;
        this.useDownAt = -1;
      }
      if (this.useKept) {
        if (!down) this.useKept = false;
        return true;
      }
    }
    if (code === "KeyK" && this.session.driving >= 0) {
      const def = this.reg.vehicle[this.session.bodyKind];
      if (def && isWheelVehicle(def) && def.emergencyLights) {
        const r = this.remote, i = r.id.subarray(0, r.count).indexOf(this.session.driving);
        if (down && !repeat && i >= 0) this.session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_LIGHTS); w.u32(makeHandle(this.session.driving, r.gen[i]!)); });
        return true;
      }
    }
    // Q on foot throws what is in hand along the look (server/loose.ts). Building and placing a car take Q first. The key
    // is not kept: nothing else on foot is bound to it.
    if (code === "KeyQ" && down && !repeat && this.session.driving < 0 && this.ui.wantsPointerLock) this.session.command(CMD_THROW, () => {});
    // Elsewhere K is the orbit camera, where the view lets it (frame()).
    if (code === "KeyK") {
      if (down && !repeat) this.orbit.set(!this.orbit.on && this.orbitFree);
      return true;
    }
    // F opens the occupied boat, the hull being aimed at, or a tribe creature's inventory.
    if (code === "KeyF") {
      if (down && !repeat) {
        const s = this.session, r = this.remote, ids = r.id.subarray(0, r.count);
        let which = s.driving;
        if (which < 0 && s.own.seatSlot && s.own.seat > 0) {
          const at = ids.indexOf(s.own.seat - 1);
          if (at >= 0 && r.gen[at] === s.own.seatGen && this.reg.vehicle[r.kind[at]!]?.movement === "boat") which = r.id[at]!;
        }
        if (which < 0) which = this.aimedBoat >= 0 ? this.aimedBoat : this.lookedAt;
        if (which >= 0) {
          const at = ids.indexOf(which);
          if (at >= 0 && this.reg.vehicle[r.kind[at]!]) this.session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_INSPECT); w.u32(makeHandle(which, r.gen[at]!)); });
          else this.session.command(CMD_OPEN, w => w.u32(which >>> 0));
        }
      }
      return true;
    }
    // Whistles. T and Y tell the creature looked at to follow or stay. J and U tell every tribe creature that hears.
    if (code === "KeyT" || code === "KeyY" || code === "KeyJ" || code === "KeyU") {
      if (down && !repeat) {
        const one = code === "KeyT" || code === "KeyY";
        const which = one ? this.lookedAt : ORDER_ALL;
        if (which >= 0) this.session.command(CMD_ORDER, (w) => (w.u32(which >>> 0), w.u8(code === "KeyT" || code === "KeyJ" ? ORDER_FOLLOW : ORDER_STAY)));
      }
      return true;
    }
    // Period, as in ARK, sends every tribe creature that hears at the body looked at. ARK's equals, the attack-my-target
    // whistle, zooms the minimap here, so it is the right bracket beside it.
    if (code === "Period" || code === "BracketRight") {
      if (down && !repeat) {
        const at = this.target;
        if (code === "BracketRight") this.session.command(CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_YOURS)));
        else if (at >= 0) this.session.command(CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_ATTACK), w.u32(at >>> 0)));
      }
      return true;
    }
    if (code === "KeyB") {
      if (repeat) return true;
      if (!this.ui.settings.toggleTalk) this.talk(down);
      else if (down) this.talk(!this.talking);
      return true;
    }
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) {
      // Keys 1 to 9 then 0 are slots 0 to 9. The key of the held slot puts it away (255).
      const slot = (Number(digit[1]) + 9) % 10;
      if (down && !repeat) this.session.command(CMD_SELECT, (w) => w.u8(this.session.held === slot ? 255 : slot));
      return true;
    }
    if (code === "KeyV") {
      // On foot the choice is kept (Settings.thirdPerson). In a helicopter or a boat V picks the cockpit or the chase view, for that ride only.
      if (down && !repeat && this.session.thirdPerson) {
        this.view.thirdPerson = !this.view.thirdPerson;
        if (this.wasOnFoot) { this.ui.settings.thirdPerson = this.view.thirdPerson; this.ui.settings.changed(); }
      }
      return true;
    }
    // Arms round a creature do not lie down with it.
    if (code === "KeyX" && down && this.holding >= 0) return true;
    return this.controls.key(code, down, source);
  }

  mouseButton(button: number, down: boolean, source = 0): void {
    if (down && source !== 1) this.ui.inputDevice = source;
    // The middle button holds a helmet's visor up (visor.ts).
    if (button === 1) {
      this.visor.held = down && this.ui.wantsPointerLock;
      return;
    }
    if (!this.ui.wantsPointerLock) { if (!down) this.controls.mouseButton(button, false, source); return; }
    if (button === 0 && this.vehiclePlacement.active) {
      if (down) this.vehiclePlacement.place(this.session);
      return;
    }
    if (button === 0 && this.builder.active) {
      if (down) this.builder.place(this.session, this.reg);
      return;
    }
    // The button that would strike throws what is in the arms, where the body looks.
    if (button === 0 && down && this.holding >= 0) {
      this.session.command(CMD_CARRY, (w) => w.u8(CARRY_THROW));
      return;
    }
    this.controls.mouseButton(button, down, source);
  }

  gamepads(pads: readonly (PadSample | null)[], now: number): void {
    if (this.steer) this.pad.update(pads, now, this.padTarget);
  }

  look(dx: number, dy: number): void {
    if (!this.ui.wantsPointerLock) return;
    this.refreshCockpitLook();
    if (this.cockpit.active) this.cockpit.look(-dx * LOOK_SPEED * this.controls.zoom, -dy * LOOK_SPEED * this.controls.zoom);
    else if (this.orbit.on) this.orbit.look(-dx * LOOK_SPEED * this.controls.zoom, -dy * LOOK_SPEED * this.controls.zoom);
    else this.controls.look(dx, dy);
  }

  /** Whether a raised sight takes zoom steps: a scope that zooms, a glass, a visor. */
  get zooming(): boolean {
    return this.sightOptic !== null || (this.glass.up && this.glassOptic !== null) || (this.visor.up && this.visorOptic !== null);
  }

  /** The mouse wheel's `deltaY` in pixels, lines or pages (`mode` 0, 1 or 2), as a browser gives it. True when it was used. */
  wheel(deltaY: number, mode = 0): boolean {
    if (!this.ui.wantsPointerLock) return false;
    const notches = mode === 1 ? deltaY / 3 : mode === 2 ? deltaY : deltaY / 100;
    return this.zoomBy(notches) || this.orbit.wheel(notches);
  }

  /** `notches` of zoom to the raised sight, down (positive) to widen: the wheel's, a pad's d-pad's, a finger's. True when one took them. */
  zoomBy(notches: number, alt = this.alt): boolean {
    // A sight that zooms takes the wheel: its zoom, or with Alt its zero (D1083).
    if (this.sightOptic) {
      if (alt) this.sightZero = Math.min(ZERO_MOST, Math.max(0, this.sightZero - Math.sign(notches) * ZERO_STEP));
      else this.sightZoom = Math.min(opticMost(this.sightOptic), Math.max(this.sightOptic.min, this.sightZoom * SIGHT_STEP ** -notches));
      return true;
    }
    // A glass raised, or a visor up, takes the wheel for its zoom.
    if (this.glass.up && this.glassOptic) {
      this.glass.wheel(this.glassOptic, notches);
      return true;
    }
    if (this.visor.up && this.visorOptic) {
      this.visor.wheel(this.visorOptic, notches);
      return true;
    }
    return false;
  }

  /** `out` as a chase camera shows a look of `yaw` and `pitch` on a boom of `boom` metres. */
  private chaseRig(yaw: number, pitch: number, boom: number): OrbitRig {
    const out = this.viewRig;
    out.yaw = yaw; out.pitch = chasePitch(pitch); out.back = boom; out.side = out.rise = 0;
    return out;
  }

  /** Refresh the world-space look sent with inputs; a passenger's head follows the same rotated view as the camera. */
  private refreshCockpitLook(): void {
    const s = this.session, r = this.remote;
    let host = -1, frame: VehicleFrame | undefined;
    if (s.sessionState === SESSION_ALIVE && s.driving >= 0 && (this.reg.vehicle[s.bodyKind]?.movement === "rotor" || this.reg.vehicle[s.bodyKind]?.movement === "boat")) {
      host = s.driving;
      const b = s.own;
      frame = { x: b.x, y: b.y, z: b.z, yaw: b.vehicleYaw, pitch: b.vehiclePitch, roll: b.vehicleRoll, qx: b.vehicleQx, qy: b.vehicleQy, qz: b.vehicleQz, qw: b.vehicleQw };
    } else if (s.sessionState === SESSION_ALIVE && s.own.seat > 0) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1 && r.gen[i] === s.own.seatGen && (r.vehicleRotorcraft[i] || r.vehicleBoat[i])) {
        host = r.id[i]!;
        frame = { ...remoteVehiclePose(r, i), x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]! };
        break;
      }
    }
    this.cockpitLook(host, frame);
  }

  private cockpitLook(host: number, frame?: VehicleFrame): void {
    if (host !== this.helicopterViewHost && host >= 0) this.view.thirdPerson = true;
    this.helicopterViewHost = host;
    if (!this.session.thirdPerson) this.view.thirdPerson = false;
    this.cockpit.sync(host, !this.view.thirdPerson, this.controls, frame);
  }

  blur(): void {
    this.controls.release();
    this.touch.reset();
    this.useDownAt = -1;
    this.useKept = this.eggKept = false;
    this.usePulse = 0;
    this.alt = this.shift = false;
    if (!this.ui.settings.toggleTalk) this.talk(false);
  }

  /**
   * Steers for a measurement run, `ms` into its measured frames: the body stands and the view turns once round in
   * BENCH_TURN_MS, a little up and down, so that every run of a scene sees the same views. Call it each frame instead
   * of forwarding input.
   */
  autopilot(ms: number): void {
    this.controls.yaw = (ms / BENCH_TURN_MS) * TAU;
    this.controls.pitch = Math.sin(ms / 2300) * 0.2 - 0.05;
  }

  textInput(key: number, value: string): void {
    this.ui.input(key, value);
  }

  /**
   * `kind` is 0 for down, 1 for up, 2 for move. The position is in canvas units. `finger` is 0 for a mouse, and a
   * touch's own number, 1 or more, for a finger.
   */
  pointer(kind: number, key: number, x: number, y: number, button: number, finger = 0): void {
    if (finger > 0) this.ui.inputDevice = 2;
    if (this.touch.pointer(kind, key, x, y, finger, this.nowMs, this.touchTarget, this.unit)) return;
    if (!this.ui.menu && this.ui.map && mapPointer(this.hud, kind, key, x, y, finger)) return;
    if ((this.ui.wantsPointerLock || this.ui.inspect) && kind === 0 && button === 0) {
      if (key >= KEY_VITAL && key < KEY_VITAL + this.hud.vitals.length * 2) { this.ui.settings.vitalLabels = !this.ui.settings.vitalLabels; this.ui.settings.changed(); }
      if (key === KEY_MINIMAP_TOGGLE) { this.ui.settings.minimap = !this.ui.settings.minimap; this.ui.settings.changed(); }
      if (key === KEY_MINIMAP_OUT || key === KEY_MINIMAP_IN) this.zoomMini(key === KEY_MINIMAP_OUT ? -1 : 1);
      const slot = (key - KEY_HOTBAR) / 3;
      if (Number.isInteger(slot) && slot >= 0 && slot < this.hud.hotbar.length) this.session.command(CMD_SELECT, (w) => w.u8(this.session.held === slot ? 255 : slot));
    }
    this.ui.pointer(kind, key, x, y, button, this.session);
    if (this.ui.menu) this.blur();
  }

  private zoomMini(turn: number): void {
    const chart = this.hud.chart;
    if (!chart) return;
    chart.key(turn > 0 ? "Equal" : "Minus", true, false);
    this.ui.settings.minimapZoom = chart.miniZoom;
    this.ui.settings.changed();
  }

  /** Scale of remote body `i` relative to its kind. Below 1 for a young one. */
  private sizeOf(i: number): number {
    const r = this.remote;
    return r.grown[i] !== 0 && (r.flags[i]! & VIEW_FLAG_PROP) === 0 ? youngScale(this.reg.birthScale[r.kind[i]!]!, r.span[i]!, r.grown[i]!, r.tick) : 1;
  }

  /** The entity index of the creature the server shows in the arms of the viewer's own body, or -1. */
  private heldInArms(): number {
    const r = this.remote;
    const seat = handleIndex(this.session.ownHandle) + 1;
    if (this.session.ownHandle === 0) return -1;
    for (let i = 0; i < r.count; i++) if (r.seat[i] === seat && (r.cue[i]! & CUE_HELD) !== 0) return r.id[i]!;
    return -1;
  }

  /**
   * Gives the keys a flyer's meaning while the predicted body is a mount that flies, and notes the tick its wing was asked
   * for. Returns whether they have it.
   */
  private flyerKeys(): boolean {
    const s = this.session;
    const c = this.controls;
    const flyer = s.sessionState === SESSION_ALIVE && s.driving >= 0 && this.reg.flies[s.own.kind] === 1;
    if (flyer !== this.flying) c.fly(flyer, flyer && s.own.mode === MODE_FLYER);
    this.flying = flyer;
    c.heli(s.sessionState === SESSION_ALIVE && s.driving >= 0 && this.reg.vehicle[s.own.kind]?.movement === "rotor");
    if (c.wing && !this.wingWas) this.wingFrom = s.simTick;
    this.wingWas = c.wing;
    // On foot and a fifth of a second into the air with a glider carried, C is the glider's (planning/workstreams/glider.md).
    const own = s.own;
    const falling = s.sessionState === SESSION_ALIVE && s.driving < 0 && !own.seat && own.mode === MODE_WALK && !own.grounded && own.glideGear !== 0;
    if (!falling) this.airFrom = s.simTick;
    c.glider(falling && (own.glide !== 0 || s.simTick - this.airFrom >= GLIDER_KEY_TICKS), s.simTick);
    return flyer;
  }
  /** The tick the predicted body was last on the ground, in water or in a seat. */
  private airFrom = 0;
  /** Whether the own glider was open at the last frame, and whether the view was stood back for it from the eye. */
  private gliderOpen = false;
  private gliderStoodBack = false;

  /** What the glider's keys do now, for a survivor in the air that carries one: the cuirass's jet has Space, so there it is C. */
  private gliderPrompt(): string {
    const s = this.session, own = s.own;
    if (s.driving >= 0 || own.seat || own.grounded || own.mode !== MODE_WALK || own.glideGear === 0) return "";
    const key = (own.jetGear & JET_CUIRASS) !== 0 ? "C" : "Space";
    if (own.glide !== 0) return `${key}  fold glider   Shift  dive   S  flare`;
    return s.simTick - this.airFrom >= GLIDER_KEY_TICKS && own.vy < -2 && (own.mflags & MF_WINDED) === 0 ? `${key}  open glider` : "";
  }

  /** With `use`, as the use key meets body `i`; else as a name tag does. */
  private lookHit(i: number, ox: number, oy: number, oz: number, use = false): number {
    return lookAt(this.reg, this.remote, i, ox, oy, oz, this.aim, this.sizeOf(i), use);
  }

  /** What a press of the use key now would get into or out of: the seat the session is in, or what the prompt is on. */
  private seatPress(): Ridden | null {
    const s = this.session, r = this.remote;
    if (s.driving >= 0) return riddenOf(this.reg, s.bodyKind, true);
    if (s.own.seat > 0 && s.own.seatSlot !== 0 && s.own.seatSlot !== IMPALE_SLOT) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1) return riddenOf(this.reg, r.kind[i]!, true);
      return "creature";
    }
    return this.promptRidden;
  }

  /** Names the entity under the crosshair within NAME_RANGE, and sets lookedAt. */
  private who(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    let best = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, NAME_RANGE) === HIT_NONE ? NAME_RANGE : rayHit.t;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      // What is in someone's arms is no mark for the use key, a blow or a whistle.
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(i, ox, oy, oz);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    const mine = hit >= 0 && s.tribe.team !== 0 && r.team[hit] === s.tribe.team;
    this.target = hit >= 0 && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 ? r.id[hit]! : -1;
    this.aimedBoat = hit >= 0 && this.reg.vehicle[r.kind[hit]!]?.movement === "boat" ? r.id[hit]! : -1;
    this.lookedAt = hit >= 0 && mine && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 && !this.scene!.characters.human(r.kind[hit]!) ? r.id[hit]! : -1;
    // A creature's name is in the mark over it (fillOverhead).
    if (hit < 0 || r.name[hit] === "" || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 || !this.scene!.characters.human(r.kind[hit]!)) return "";
    return `${r.name[hit]}${mine ? " (tribe)" : ""}  level ${r.level[hit]}`;
  }

  /** Current own aim/action pose on the remote carrier at its presentation clock. */
  private ownSeatEye(world: CollisionWorld, remote: RemoteSample, tick: number, yaw: number, pitch: number, out: Float64Array, clip = true, actionTick = this.session.simTick): boolean {
    const s = this.session, b = s.own, st = this.shotState;
    if (s.driving >= 0 || !b.seat || !b.seatSlot) return false;
    st.mode = b.mode; st.grounded = b.grounded; st.stance = b.stance;
    st.setMotion(b.vx, b.vz, yaw, pitch, b.vy);
    st.setAction(b.act, (this.reg.weapon[b.held] ?? FISTS).hold, actionTick - b.actTicks);
    st.seed = bodySeed(handleIndex(s.ownHandle));
    if (!this.seatedAim.pose(remote, s.ownKind, b.seat, b.seatGen, b.seatSlot, st, yaw, tick)) return false;
    this.seatedAim.eye(world, out, clip); return true;
  }

  /**
   * The laser dots on the screen, its own and those of bodies whose laser is on, each where the world or a body first meets
   * its beam and only where the camera sees that spot; and the holo-scope's crosshair colour (weapons-plan.md, M10).
   */
  private fillSights(world: CollisionWorld, alive: boolean): void {
    const { hud, cam, session, lasers, sightAt: at } = this;
    const r = this.remote;
    const d = this.aim;
    const day = daylight(this.sky.hour);
    lookDirection((at.yaw / TAU) * 65536, (at.pitch / (PI / 2)) * 16384, d);
    lasers.clear();
    if (at.laser) lasers.cast(this.reg, world, r, at.x, at.y, at.z, d[0]!, d[1]!, d[2]!, day, 0, handleIndex(session.ownHandle), this.seatedAim, session.own.seat - 1, session.own.seatGen);
    lasers.remotes(this.reg, world, r, day, this.seatedAim);
    const s = this.spot;
    let n = 0;
    for (let i = 0; i < lasers.count; i++) {
      const dot = lasers.dots[i]!;
      const dx = dot.x - cam.x;
      const dy = dot.y - cam.y;
      const dz = dot.z - cam.z;
      const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // A dot behind something the camera sees first is not drawn.
      if (far > 0.05 && castWorld(world, cam.x, cam.y, cam.z, dx / far, dy / far, dz / far, far - 0.05) !== HIT_NONE) continue;
      if (!cam.project(dot.x, dot.y, dot.z, s)) continue;
      const out = (hud.dots[n++] ??= { u: 0, v: 0, alpha: 0 });
      out.u = s[0]!;
      out.v = s[1]!;
      out.alpha = dot.alpha;
    }
    hud.dotCount = n;
    hud.crossTint = alive && hud.holo ? this.holoTint(world, d) : -1;
  }

  /**
   * What a holo-scope's crosshair is on, as its colour: "a yellow crosshair for wild animals or structures from another
   * tribe, a red crosshair for untamed animals or players from other tribes and a green one for tamed animals, structures
   * and players from the same tribe" (Holo-Scope Attachment). The page has wild animals both yellow and red; here wild
   * creatures and another tribe's structures are yellow, another tribe's survivors and tames red, and the tribe's own green.
   * -1 for nothing in reach. `d` is the view's way.
   */
  private holoTint(world: CollisionWorld, d: readonly number[]): number {
    const { sightAt: eye, session, reg } = this;
    const r = this.remote;
    const team = session.tribe.team;
    let t = castWorld(world, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, HOLO_REACH) === HIT_NONE ? Infinity : rayHit.t;
    let tint = -1;
    if (t < Infinity && rayHit.kind === HIT_STRUCTURE) {
      const ref = rayHit.ref;
      const owner = world.structs.chunks[Math.floor(ref / 65536)]!.owner[ref & 0xffff]!;
      if (owner !== 0) tint = team !== 0 && owner === team ? HOLO_FRIEND : HOLO_OTHER;
    }
    for (let i = 0; i < r.count; i++) {
      const kind = r.kind[i]!;
      const rad = reg.bodyRadius[kind]!;
      if (reg.move[kind] === null || !(rad > 0) || r.id[i] === session.driving || r.id[i] === handleIndex(session.ownHandle) || (r.id[i] === session.own.seat - 1 && r.gen[i] === session.own.seatGen)) continue;
      const posed = this.seatedAim.ray(r, i, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, t);
      const hit = posed ?? rayBox(eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + reg.bodyHeight[kind]!, r.z[i]! + rad);
      if (!(hit > 0 && hit < t)) continue;
      t = hit;
      const mine = team !== 0 && r.team[i] === team;
      tint = mine ? HOLO_FRIEND : r.team[i] === 0 ? HOLO_OTHER : HOLO_FOE;
    }
    return tint;
  }

  /**
   * Tells the server the sight's zoom (0 for none) as it changes by a tenth or more, and again each GAZE_RESEND_MS while it
   * lasts, with how far off what the middle of the view is on (0 for nothing within the cone's reach); once more as it ends.
   */
  private gaze(nowMs: number, world: CollisionWorld, zoom: number, yaw: number, pitch: number): void {
    // What the middle of the view is on, found each FOCUS_MS while a sight magnifies: its range, and the point the scene
    // brings its fine ground and far trees to (D1087).
    if (zoom > 0 && nowMs - this.focusAt >= FOCUS_MS) {
      const d = this.aim, eye = this.sightAt;
      lookDirection((yaw / TAU) * 65536, (pitch / (PI / 2)) * 16384, d);
      const reach = Math.min(GAZE_FARTHEST, GAZE_REACH * zoom);
      const t = castWorld(world, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, reach) !== HIT_NONE ? rayHit.t : 0;
      this.focusAt = nowMs;
      this.visor.range = t;
      if (this.scene) {
        this.scene.focusX = t > 0 ? eye.x + d[0]! * t : NaN;
        this.scene.focusZ = t > 0 ? eye.z + d[2]! * t : NaN;
      }
      // Its near trees, from NODE_FOCUS times (D1090).
      const dims = this.session.world?.dims;
      this.session.focusNodes(dims && t > 0 && zoom >= NODE_FOCUS ? chunkAt(dims, eye.x + d[0]! * t, eye.z + d[2]! * t) : -1);
    } else if (zoom === 0) {
      this.focusAt = -Infinity;
      if (this.scene) this.scene.focusX = this.scene.focusZ = NaN;
      this.session.focusNodes(-1);
    }
    if (zoom === 0 && this.gazeSent === 0) return;
    const moved = zoom === 0 || this.gazeSent === 0 || Math.abs(zoom - this.gazeSent) > 0.1 * Math.max(zoom, this.gazeSent) || this.zeroSent !== this.sightZero;
    if (!moved && nowMs - this.gazeAt < GAZE_RESEND_MS) return;
    // The server finds what the look is on for itself (D1084): the range sent is the page's, for its own word.
    const focus = zoom > 0 ? this.visor.range : 0;
    this.session.command(CMD_GAZE, (w) => (w.u16(Math.min(65535, Math.round(zoom * 16))), w.u16(Math.min(65535, Math.round(focus))), w.u16(zoom > 0 ? this.sightZero : 0)));
    this.gazeSent = zoom;
    this.gazeAt = nowMs;
    this.zeroSent = this.sightZero;
  }

  /** The worn helmet's optic where the helmet is not worn out (its visor), or null. */
  private wornOptic(inv: Inventory | null): OpticFacet | null {
    const at = inv && inv.armor >= 0 ? inv.armor : -1;
    const item = at >= 0 ? inv!.item[at]! : 0;
    const def = item !== 0 ? (this.reg.defs[item] as ItemDef | null) : null;
    return def?.optic && def.wear?.slot === "head" && (inv!.dur[at]! > 0 || !(def.wear.uses > 0)) ? def.optic : null;
  }

  /** Sets `aimed` to the player-built structure within ACT_REACH, and returns its name and health. */
  private builtAt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const d = this.aim;
    this.aimed = -1;
    this.terminalAimed = -1;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    if (castWorld(world, s.own.x, s.own.y + eye, s.own.z, d[0]!, d[1]!, d[2]!, ACT_REACH) !== HIT_STRUCTURE) return "";
    const ref = rayHit.ref;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    const motion = this.reg.motion[kind];
    if (motion && rayHit.t <= REACH) {
      const state = s.motions.get(ref);
      const p = state ? motionProgress(state, motionTicks(motion), s.tickClock) : 0;
      const word = `E ${motion.say[state?.to === 1 ? 1 : 0]}`;
      return p > 0 && p < 1 ? `${word}  ${Math.round(p * 100)}%` : word;
    }
    if (kind === this.reg.index.get(TRAVEL_TERMINAL)) {
      this.terminalAimed = ref;
      return "E travel to another server";
    }
    // Skip structures nobody built.
    if (this.reg.pieceItem[kind] === 0 || t.owner[ref & 0xffff] === 0) return "";
    this.aimed = ref;
    const mine = s.tribe.team !== 0 && t.owner[ref & 0xffff] === s.tribe.team;
    const usable = (this.reg.opens[kind] !== 0 || this.reg.structSlots[kind] !== 0) && rayHit.t <= REACH;
    return `${usable ? "E use  " : mine ? "hold E  " : ""}${structName(this.reg, kind)}  ${Math.ceil(t.hp[ref & 0xffff]!)}/${this.reg.maxHp[kind]}`;
  }

  /** Authored framing takes precedence over the default boom derived from the saddle and creature's size. */
  private mountView(kind: number, saddle: number): { up: number; boom: number; forward: number } {
    const def = this.reg.defs[kind];
    if (def?.type === "species" && def.camera) return { up: def.camera.height, boom: def.camera.distance, forward: def.camera.forward ?? 0 };
    const seat = this.reg.saddleSeats[saddle]?.find((s) => s.driver);
    const size = Math.max(this.scene?.characters.reach(kind) ?? 0, this.reg.bodyHeight[kind]!, 2 * this.reg.bodyRadius[kind]!);
    return { up: seat ? seat.anchor[1] + 0.75 : this.reg.bodyHeight[kind]! + 0.5, boom: 1.5 + 1.2 * size, forward: 0 };
  }

  /** The use button's prompt, and before it what a click of the soul ball in hand would do. */
  private handPrompt(world: CollisionWorld, eye: number): string {
    const use = this.prompt(world, eye);
    const ball = this.ballPrompt(world, eye);
    return ball && use ? `${ball}    ${use}` : ball || use;
  }

  /**
   * With a soul ball in hand, what a click would do (server/balls.ts): a full one looses the tame it holds, an empty one
   * keeps the tribe's creature looked at within KEEP_REACH. "" with anything else in hand, or nothing a click would keep.
   */
  private ballPrompt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const reg = this.reg;
    const inv = s.inventory;
    if (!inv || s.held < 0 || inv.hotbar < 0 || s.driving >= 0 || s.own.seat > 0 || this.holding >= 0) return "";
    const slot = inv.hotbar + s.held;
    const item = inv.item[slot]!;
    if (item === 0) return "";
    if (reg.ballEmpty[item] !== 0) return loosePrompt(reg, s.kept[0].get(slot));
    if (reg.ballFull[item] === 0) return "";
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, KEEP_REACH);
    let best = struck === HIT_NONE ? KEEP_REACH : rayHit.t;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(i, ox, oy, oz, true);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    // Only a creature of the tribe's: not a thing lying there, a vehicle, a survivor, or another tribe's.
    if (hit < 0 || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 || reg.vehicle[r.kind[hit]!] || r.kind[hit] === s.ownKind || reg.defs[r.kind[hit]!]?.type !== "species") return "";
    if (s.tribe.team === 0 || r.team[hit] !== s.tribe.team) return "";
    const id = reg.ids[r.kind[hit]!] ?? "";
    const name = r.name[hit] || `the ${id.slice(id.indexOf(":") + 1)}`;
    return (r.cue[hit]! & CUE_OUT) !== 0 ? `${name} must be awake to go into a soul ball` : `click  keep ${name}`;
  }

  /** Labels what the use button would act on, with the same ray the server casts. The server's answer is the one that counts. */
  private prompt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    this.promptRidden = null;
    if (s.own.seat > 0 && s.own.seatSlot === IMPALE_SLOT) return "Impaled: held by a Stegosaurus";
    if (s.driving >= 0) {
      const combat = this.reg.combat[s.bodyKind];
      if (combat) return `LMB attack   ${combat.charge ? "hold RMB charge" : combat.secondary ? "RMB impale" : ""}   E get off`;
      if (this.reg.vehicle[s.bodyKind]) return "E  exit vehicle";
      const mount = this.reg.defs[s.bodyKind];
      return mount?.type === "species" && mount.roar ? "RMB  roar    E  get off" : "E  get off";
    }
    // Seats in cars and saddles have a slot; a carried body has none. Who steers is handled above.
    if (s.own.seatSlot !== 0 && s.own.seat > 0) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1) return this.reg.vehicle[r.kind[i]!] ? "E  exit passenger seat" : "E  get off";
      return "E  get off";
    }
    if (this.holding >= 0) return "E  set down   click  throw";
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, REACH);
    let best = struck === HIT_NONE ? REACH : rayHit.t;
    const node = struck === HIT_NODE ? rayHit.ref : -1;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      // What is in someone's arms is no mark for the use key, a blow or a whistle.
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(i, ox, oy, oz, true);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    if (hit >= 0) {
      // The server also treats using an occupant as using its vehicle or creature, useful when a person fills the doorway.
      if (r.seatSlot[hit] !== 0) for (let j = 0; j < r.count; j++) {
        if (r.id[j] === r.seat[hit]! - 1 && r.gen[j] === r.seatGen[hit]) { hit = j; break; }
      }
      if (this.reg.vehicle[r.kind[hit]!]) {
        this.promptRidden = riddenOf(this.reg, r.kind[hit]!, false);
        return vehiclePrompt(this.reg, r, hit, ox, s.own.y, oz, world.hf.waterAt(ox, oz), s.own.mode === MODE_SWIM);
      }
      // A saddled creature of the tribe, grown and awake, is ridden: its steering seat if it is free, else a passenger's.
      const seats = this.reg.saddleSeats[r.gear[hit * GEAR_COUNT + GEAR_WORN]!];
      if (seats) this.promptRidden = "creature";
      if (seats && s.tribe.team !== 0 && r.team[hit] === s.tribe.team && r.grown[hit] === 0 && (r.cue[hit]! & CUE_OUT) === 0) {
        const taken = (k: number): boolean => {
          for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[hit]! + 1 && r.seatGen[j] === r.gen[hit] && r.seatSlot[j] === k + 1) return true;
          return false;
        };
        const id = this.reg.ids[r.kind[hit]!] ?? "";
        const name = r.name[hit] || `the ${id.slice(id.indexOf(":") + 1)}`;
        const steer = seats.findIndex((seat) => seat.driver);
        if (!taken(steer)) return `E  ride ${name}`;
        return seats.some((seat, k) => !seat.driver && !taken(k)) ? `E  ride ${name} as a passenger` : "Every seat is taken";
      }
      if ((r.flags[hit]! & VIEW_FLAG_PROP) !== 0) {
        // A bag of one stack, as a thing thrown or let fall lies, is taken up whole (server/loose.ts); F still opens it.
        const lying = r.kind[hit] === this.bagKind ? r.gear[hit * GEAR_COUNT + GEAR_HELD]! : 0;
        if (lying !== 0) {
          this.eggAimed = r.id[hit]!;
          return `E  take ${itemLabel(this.reg, lying)}`;
        }
        // On a prop, a nonzero grown tick marks a fertilised egg. An egg that is an item is taken up.
        const left = waitWords(Math.max(0, Math.ceil((r.grown[hit]! - s.serverTick) / TICK_RATE)));
        if (this.reg.propItem[r.kind[hit]!] !== 0) {
          this.eggAimed = r.id[hit]!;
          return `E  take ${r.name[hit]}${r.grown[hit] !== 0 ? `  ${left} to hatch` : ""}`;
        }
        if (r.grown[hit] !== 0) return `${r.name[hit]}  hatches in ${left}`;
        // A supply drop's capsule opens at its tier's level: below it the prompt says the level, and no key.
        const drop = this.reg.takeOnly[r.kind[hit]!] === 1 ? s.supply.rows.find((d) => d.landed && d.left === 0 && Math.abs(d.x - r.x[hit]!) < 0.5 && Math.abs(d.z - r.z[hit]!) < 0.5) : undefined;
        const level = drop ? (s.supply.tiers[drop.tier]?.level ?? 0) : 0;
        // Its name is said whole from the list: an entity's own is cut at twenty-four characters (EntityStore.setLook).
        const name = drop ? supplyName(s.supply.tiers[drop.tier]?.name ?? "", s.supply.classes[drop.cls]?.name ?? "", drop.ringed) : r.name[hit]!;
        if (!s.open && s.progress.level < level) return `${name}  opens at level ${level}`;
        return `E  ${s.open ? "close" : "open"} ${name}`;
      }
      if (r.team[hit] === 0 && r.grown[hit] !== 0) {
        const id = this.reg.ids[r.kind[hit]!] ?? "";
        return `E  take the young ${id.slice(id.indexOf(":") + 1)}`;
      }
      // A small creature, wild or the tribe's, awake, is picked up. F still opens it.
      if (this.reg.carriable[r.kind[hit]!] === 1 && (r.team[hit] === 0 || (s.tribe.team !== 0 && r.team[hit] === s.tribe.team)) && (r.cue[hit]! & CUE_OUT) === 0) {
        const id = this.reg.ids[r.kind[hit]!] ?? "";
        return `E  pick up ${r.name[hit] || `the ${id.slice(id.indexOf(":") + 1)}`}`;
      }
      return "";
    }
    if (node < 0 || !s.nodeField) return "";
    // A node without a material is a bush, picked with the use key. Trees and rocks are struck. What is left of a used-up one is neither.
    const def = this.reg.defs[s.nodeField.standing(Math.floor(node / 65536), node & 0xffff)];
    if (def?.type !== "node") return "";
    const what = def.id.slice(def.id.indexOf(":") + 1);
    return def.material === undefined ? `E  pick ${what}` : `hold click  gather from ${what}`;
  }

  /** The creator's view. The camera faces the new survivor from the front, off to one side so the panel does not cover it. */
  private preview(nowMs: number, aspect: number): void {
    const session = this.session;
    const cam = this.cam;
    const body = this.body;
    const creator = this.ui.creator;
    cam.nearLimit = Infinity;
    body.kind = session.ownKind;
    body.x = session.own.x;
    body.y = session.own.y;
    body.z = session.own.z;
    body.yaw = creator.turn;
    body.tick = nowMs / (1000 / 30);
    body.firstPerson = false;
    body.id = 0;
    body.look = creator.look;
    body.gear.fill(0);
    body.state.unpack(0);
    body.state.seed = 0;
    this.scene!.own = body;
    this.scene!.hour = 12;
    // The panel takes the right of a wide window, so the body stands in the middle of the rest.
    const back = 3.3;
    const side = aspect > 1 ? back * Math.tan(cam.fovY / 2) * aspect * Math.min(0.42, 190 / (360 * aspect)) : 0;
    cam.x = body.x + side;
    cam.y = body.y + 1.15;
    cam.z = body.z + back;
    cam.yaw = Math.PI;
    cam.roll = 0;
    cam.pitch = -0.06;
  }

  /**
   * What the page's address asks: `off`, effects turned off for a before and after (passes.ts). A page that pins pictures
   * or hashes, or measures, holds the governor at the tier, or at `level`, and may name the `tier` and the scene's
   * share of the canvas a side, `scale` (1 for the canvas's own). It plays at
   * MEASURED_VOLUME, or at `volume`. A tool's look at a place is such a page, and its `orders` are what the server the
   * tool started for it gave it, never the address's: `run`, lines sent as typed once the body is in the world, and
   * `look`, the way it faces held, yaw and pitch in radians. Any other page sends no line it was not typed and holds no view.
   */
  address(get: (name: string) => string | null, pinned: boolean, orders: ToolOrders | null = null): void {
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
    this.governor.held = Number(get("level") ?? 0);
    this.ui.settings.tier = tierOf(get("tier") ?? this.ui.settings.tier).name;
    const share = Number(get("scale"));
    this.shareAsked = share > 0 && share <= 1 ? share : 0;
    // Such a page runs unattended, often behind someone's other work, and its music would start at full volume. It is
    // not muted, since nobody is there to unmute it and the self-check listens for a sound.
    this.ui.settings.muted = false;
    const volume = Number(get("volume") ?? MEASURED_VOLUME);
    this.ui.settings.masterVolume = Number.isFinite(volume) ? Math.max(0, Math.min(VOLUME_MAX, volume)) : MEASURED_VOLUME;
  }

  /**
   * After the frame is handed to WebGL: our code took `ours` ms of it, `uploadMs` of them handing the assets' bytes to
   * the card and `buildMs` in frame(), on a canvas of `width` by `height` device pixels.
   */
  drawn(packet: FramePacket, ours: number, width = 0, height = 0, uploadMs = 0, buildMs = 0): void {
    this.frames?.record(this.nowMs, this.interval, ours, uploadMs, this.scene?.assets.residency ?? null, this.sounds?.library ?? null);
    // A note's picture is the canvas as just drawn, and its record takes the row above (notes/notes.ts).
    this.notes?.drawn(packet, ours, width, height, uploadMs, buildMs);
    const budget = this.scene?.budget;
    const crowns = budget && budget.squeeze < SQUEEZE_MOST ? budget.last.crowns : 0;
    const work = workMs(packet.triangles, packet.drawCount, packet.castTriangles, packet.castDraws, packet.tier.shadows.size);
    const city = (this.scene?.city?.drawn.reduce((n, t) => n + t, 0) ?? 0) + (this.scene?.blocks?.stats.triangles ?? 0);
    this.governor.frame(this.nowMs, this.interval, ours, packet.assetUploads.length + packet.texUploads.length > 0, work, crowns * PHONE_MS.triangle, city * PHONE_MS.triangle);
    this.session.prediction.page(ours, packet, this.scene?.assets.residency, this.governor, this.dpr, width, height);
  }

  /** The shell says the graphics card ran out of memory or lost everything. On every third time the graphics tier falls by one. */
  pressure(): void {
    // What follows is the uploads of all that was lost, or of what failed, which are no reason to step.
    this.governor.pause(this.nowMs);
    if (!this.scene?.assets.pressure()) return;
    [this.ui.settings.tier, this.ui.settings.chosen] = [this.scene.assets.tier.name, true];
    this.ui.chat.print(TEXT_NOTICE, `The graphics card keeps running out of memory, so the graphics setting is now ${this.ui.settings.tier}.`, this.session.serverTick);
  }

  /**
   * Asks for the cluster's servers while the travel list is open, and goes where a ticket or a choice says: with a ticket to
   * the server the survivor left for, without one to a server chosen once this one closed. A survivor turned away, or a
   * server full, shows the list, and the server it left is on it.
   */
  private travel(nowMs: number): void {
    const { page, session } = this;
    const t = this.ui.travel;
    if (!page || this.leaving) return;
    if (session.state === "active" && !this.arrived) {
      this.arrived = true;
      page.arrived();
      // Asked for once the world is in, so the first frame waits for nothing more.
      page.json("links.json").then((answer) => (this.ui.links = siteLinks(answer)), () => {});
    }
    if (session.state === "closed" && (session.closeReason === REJECT_TRAVEL || session.closeReason === REJECT_FULL) && !this.turnedAway) {
      this.turnedAway = t.open = true;
      t.askedAt = -Infinity;
    }
    const trip = session.travelled;
    if ((t.open || trip) && nowMs - t.askedAt >= TRAVEL_REFRESH_MS) {
      t.askedAt = nowMs;
      page.json("cluster.json").then(
        (list) => {
          t.list = list as ClusterList;
          t.note = "";
        },
        () => {
          t.note = "this server did not say which servers are in its cluster";
        },
      );
    }
    const list = t.list;
    if (!list) return;
    const to = trip ? list.servers.find((s) => s.world === trip.world) : t.goTo;
    if (!to) return;
    this.leaving = true;
    page.go(trip ? arrivalAddress(serverAddress(list, to, page), session.name, trip.ticket) : joinAddress(serverAddress(list, to, page), session.name));
  }

  /** Returns what to draw in the world, or null until the world has arrived. `ui.frame` is always ready. */
  frame(nowMs: number, width: number, height: number): FramePacket | null {
    const dt = this.last < 0 ? 16 : nowMs - this.last;
    this.interval = this.last < 0 ? 0 : dt;
    this.last = nowMs;
    this.fps += (1000 / Math.max(dt, 1) - this.fps) * 0.05;
    const aspect = width / Math.max(height, 1);
    // The interface's canvas for this window: shorter for a short one, with the screen's edges kept clear.
    const ui = this.ui, units = canvasHeight(width, height);
    this.unit = Math.max(height, 1) / units;
    ui.canvasHeight = units;
    ui.frame.unit = this.unit;
    ui.frame.left = this.insets[0]! / this.unit; ui.frame.top = this.insets[1]! / this.unit; ui.frame.right = this.insets[2]! / this.unit; ui.frame.bottom = this.insets[3]! / this.unit;
    ui.flyer = this.controls.onFlyer;
    ui.building = this.builder.active;
    ui.placing = this.vehiclePlacement.active;
    ui.canTalk = this.voice !== null && this.voice.notice === "";
    ui.creatureAhead = this.lookedAt >= 0;
    this.touch.frame(nowMs, ui.touch ? ui.touchShown : 0, this.touchTarget);
    ui.storage?.step(ui, forTouch(tierOf(ui.settings.tier), ui.settings.touchFirst), this.stream?.port ?? null, this.scene?.assets.residency ?? null, this.sounds?.library ?? null, nowMs);
    const session = this.session;
    const hud = this.hud;
    const c = this.controls;
    this.nowMs = nowMs;
    // The resource monitor is a file of its own, fetched once Diagnostics is first "monitor".
    if (ui.settings.monitor && !this.monitorAsked) {
      this.monitorAsked = true;
      void import("./ui/monitor.ts").then((m) => (ui.monitor = new m.Monitor(this, MONITOR_KIT)), () => (this.monitorAsked = false));
    }
    // Bug report mode likewise, once Settings.notes or the budget's panel is first on (D1091, D1095).
    if ((ui.settings.notes || ui.settings.budget) && !this.notesAsked) {
      this.notesAsked = true;
      void import("./notes/notes.ts").then((m) => (this.notes = new m.Notes(this, NOTES_KIT)), () => (this.notesAsked = false));
    }
    hud.vehicle = null;
    if (!this.facing && session.state === "active") {
      // Mouse movement while connecting is an offset from the arrival view, not a reason to face +Z.
      c.yaw += session.ownYaw;
      c.pitch += session.ownPitch;
      this.facing = true;
    }

    this.travel(nowMs);
    if (this.ui.leftWorld) { this.ui.leftWorld=false; this.page?.go("./?screen=roster"); }
    if (this.ui.reconnectRequested) { this.ui.reconnectRequested = false; this.page?.reload?.(); }
    if (session.state === "closed") {
      this.vehicleTelemetry.stop();
      // Only the reasons a player can act on are spelled out.
      hud.status = session.travelled ? "travelling to another server" : session.closeReason === REJECT_TRAVEL ? `turned away: ${session.closeText}` : session.closeReason === REJECT_FULL ? "turned away: this server is full" : session.closeReason === REJECT_PASSWORD ? "disconnected: this server asks a password, and that was not it" : session.closeReason === CLOSED_BAD_CONTENT ? "disconnected: this client's content is not this server's" : session.closeReason === REJECT_VERSION || session.closeReason === CLOSED_BAD_VERSION ? "disconnected: this page is not the server's version; reload it" : `disconnected (reason ${session.closeReason})`;
      this.ui.build(aspect, hud, session);
      if (this.sound) this.sounds?.hush(this.sound);
      return null;
    }
    if (this.ui.menu || this.ui.inspect) this.blur();
    if (this.usePulse > 0) c.key("KeyE", --this.usePulse > 0);
    // N held long raises or lowers the visor; a tap's press goes as it is let go (App.key).
    if (this.nDownAt >= 0 && !this.nLong && nowMs - this.nDownAt >= VISOR_HOLD_MS) {
      this.nLong = true;
      this.visor.held = !this.visor.held;
    }
    if (this.nPulse > 0) c.key("KeyN", --this.nPulse > 0);
    this.holding = this.heldInArms();
    const flyer = this.flyerKeys();
    this.refreshCockpitLook();
    // A glass raised takes the primary for its range: the hand holding it does not strike.
    // A visor held up is told the server as a button: the proof its gaze needs (D1084).
    if (this.steer) session.update(nowMs, c.moveX, c.moveZ, c.yaw, c.pitch, ((this.holding >= 0 ? c.buttons & ~HANDS_FULL : c.buttons) & (this.glass.up ? ~BTN_PRIMARY : ~0)) | (this.visor.held ? BTN_VISOR : 0));
    else session.update(nowMs, 0, 0, c.yaw, c.pitch, 0);
    // Once a tick has stepped with its jump held, a flyer not in the air came down or would not go up.
    if (flyer && c.wing && session.simTick > this.wingFrom && session.own.mode !== MODE_FLYER) c.land();
    const world = session.world;
    if (session.state !== "active" || !world) {
      this.vehicleTelemetry.stop();
      hud.status = "connecting";
      this.ui.build(aspect, hud, session);
      if (this.sound) this.sounds?.hush(this.sound);
      return null;
    }
    if (this.shown !== session.registry) {
      this.shown = session.registry;
      this.seatedAim = new SeatedAim(this.shown, this.pack);
      this.ui.registry = this.shown;
      this.shots.reg = this.shown;
    }
    if (!this.scene) {
      // Sounds share the asset port, each side taking only what it asked for.
      this.split = this.sound && this.stream ? new SplitPort(this.stream.port) : null;
      this.scene = new Scene(world, this.reg, this.pack, this.split ? { manifest: this.stream!.manifest, port: this.split.assets } : this.stream, { farPalms: this.farPalms });
      this.scene.shots = this.shots;
      this.scene.supply = this.supply;
      this.scene.plainSky = this.plainSky;
      if (this.stress) {
        const made = stressThings(this.scene.assets, world.hf, PROVING_SPAWN, world.hf.heightAt(PROVING_SPAWN.x, PROVING_SPAWN.z) + 1.62);
        this.scene.things = made.things;
        this.marks = made.marks;
      }
      this.falling = this.scene.falling = new Falling(this.reg.halfY, (x, z) => world.hf.heightAt(x, z));
      const chart = (hud.chart = new Chart(world.hf, this.pack.palette));
      this.ui.frame.images[IMAGE_MINIMAP] = chart.mini.image;
      this.ui.frame.images[IMAGE_MAP] = chart.full.image;
    }
    // The sound library starts once the sounds' rows and its code have come; the code is asked for once there is a device.
    if (this.split && !App.late && !this.soundAsked) {
      this.soundAsked = true;
      void import("./sound-late.ts").catch(() => (this.soundAsked = false));
    }
    const code = App.late;
    if (this.split && code && !this.sounds && this.stream!.manifest.sounds) {
      this.sounds = new code.Sounds(this.stream!.manifest, this.split.sounds, this.reg, (kind) => this.scene!.characters.creature(kind), this.soundDecoder ?? undefined, this.pack.header.details?.sheets ?? []);
      code.hearSession(session, this.sounds);
      this.ui.hear = (key) => this.sounds?.hearUi(code.cueKey(key));
    }
    for (const event of session.predictedTrees?.present() ?? []) {
      this.scene.hideNode(event.ref, event.action === "break");
      this.scene.treeFalls.add(event, nowMs);
      if (event.action === "break") {
        const size = session.nodeField!.forms.size[event.form]! / 64;
        this.scene.details.nodeBreak(event.kind, event.ref, event.x, event.y, event.z, session.renderClock - session.remoteDelay, size);
        this.sounds?.build.treeImpact(event.kind, event.x, event.y, event.z);
      }
    }
    hud.status = this.debug ? `${this.scene.assets.line()}${this.sounds ? `; ${this.sounds.line()}` : ""}` : "";
    // Sampled before the camera, which puts a passenger in its seat on the vehicle as it is drawn.
    session.sampleRemote(this.remote);

    // The eye interpolates between the last two predicted ticks, so motion is smooth at any frame rate.
    const cam = this.cam;
    const a = session.alpha;
    const alive = session.sessionState === SESSION_ALIVE;
    // A server takes a typed line a few ticks apart.
    if (alive && this.script.length > 0 && nowMs >= this.lineAt) {
      session.text(this.script.shift()!);
      this.lineAt = nowMs + 500;
    }
    if (this.held) {
      [c.yaw, c.pitch] = this.held;
      if (alive && this.releaseLook && this.script.length === 0) this.held = null;
    }
    const move = this.reg.move[session.bodyKind];
    // The eye eases toward the stance height, so crouching is a movement and not a cut.
    const eyeNow = alive && move ? stanceEye(move, session.own.stance) : 0;
    // A body that has just appeared starts at its eye height.
    if (!alive) this.eye = -1;
    else this.eye = this.eye < 0 ? eyeNow : this.eye + (eyeNow - this.eye) * Math.min(1, dt / 90);
    const eye = alive ? this.eye : 0;
    const bx = session.ownPrev.x + (session.own.x - session.ownPrev.x) * a + session.smoothX;
    const by = session.ownPrev.y + (session.own.y - session.ownPrev.y) * a + session.smoothY;
    const bz = session.ownPrev.z + (session.own.z - session.ownPrev.z) * a + session.smoothZ;
    const car = this.reg.vehicle[session.bodyKind];
    const rotor = car?.movement === "rotor", boat = car?.movement === "boat", fullAttitude = car !== undefined && car !== null;
    const vehiclePose = car ? predictedVehiclePose(session.ownPrev, session.own, a, rotor, boat, session.vehicleCorrection) : undefined;
    if (alive && car && session.driving >= 0) {
      if (car.movement === "rotor") {
        const altitude = castWorld(world, bx, by + .05, bz, 0, -1, 0, 2000) !== HIT_NONE ? Math.max(0, rayHit.t - .05) : by - world.hf.heightAt(bx, bz);
        this.vehicleTelemetry.updateRotor(session.driving, session.own, car.spec, altitude, c.directFlight, this.steer && (c.buttons & BTN_PRONE) !== 0);
      } else if (car.movement === "boat") this.vehicleTelemetry.updateBoat(session.driving, session.own, car.spec, this.steer && (c.buttons & BTN_SPRINT) !== 0);
      else this.vehicleTelemetry.update(session.driving, session.own, this.steer ? c.moveZ : 0, this.steer && (c.buttons & BTN_JUMP) !== 0, car.spec, dt);
      this.vehicleTelemetry.lightMode = isWheelVehicle(car) && car.emergencyLights ? 0 : -1;
      hud.vehicle = this.vehicleTelemetry;
    } else this.vehicleTelemetry.stop();
    const carYaw = vehiclePose?.qw !== undefined ? Math.atan2(2 * (vehiclePose.qw * vehiclePose.qy! + vehiclePose.qx! * vehiclePose.qz!), 1 - 2 * (vehiclePose.qx! ** 2 + vehiclePose.qy! ** 2))
      : session.ownPrev.vehicleYaw + Math.atan2(Math.sin(session.own.vehicleYaw - session.ownPrev.vehicleYaw), Math.cos(session.own.vehicleYaw - session.ownPrev.vehicleYaw)) * a;
    const passenger = alive && session.driving < 0 && session.own.seatSlot !== 0 && session.own.seat > 0;
    // A passenger's chase camera is third person, so it obeys the same server rule.
    let passengerFullAttitude = false, passengerCockpit = false;
    let cockpitFrame: VehicleFrame | undefined = fullAttitude ? { ...vehiclePose!, x: bx, y: by, z: bz, yaw: carYaw } : undefined;
    if (passenger) for (let i = 0; i < this.remote.count; i++) {
      const r = this.remote;
      if (r.id[i] !== session.own.seat - 1 || r.gen[i] !== session.own.seatGen) continue;
      passengerFullAttitude = !!this.reg.vehicle[r.kind[i]!];
      passengerCockpit = r.vehicleRotorcraft[i] !== 0 || r.vehicleBoat[i] !== 0;
      if (passengerFullAttitude) cockpitFrame = { ...remoteVehiclePose(r, i), x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]! };
    }
    const helicopterHost = (rotor || boat) && session.driving >= 0 ? session.driving : passengerCockpit ? session.own.seat - 1 : -1;
    this.cockpitLook(helicopterHost, cockpitFrame);
    const chase = passenger && session.thirdPerson && (!passengerCockpit || this.view.thirdPerson);
    // The orbit goes round the body, its mount or the host of a passenger's chase view (-1 for none). A driver's chase
    // camera and a cockpit look round freely already. A new subject is a view the game forces: the orbit gives way at
    // once, and the camera eases from where it was as between any two views. The rule turning off, or death, eases it out.
    const subject = car || this.cockpit.active || (passenger && !chase) ? -1 : session.driving >= 0 ? session.driving : passenger ? -3 - session.own.seat : -2;
    if (this.orbit.follow(subject)) this.view.turn();
    this.orbitFree = alive && session.thirdPerson && subject !== -1;
    if (!this.orbitFree) this.orbit.set(false);
    if (!alive || car || (session.driving < 0 && (!chase || passengerFullAttitude))) this.mountCamera.reset();
    // On foot the view is the one the player chose: from behind unless it chose the eye (Settings.thirdPerson). A survivor
    // rises in it, and comes back to it out of a vehicle, a seat or a saddle, whose views are their own. A page that
    // measures rises at the eye (fromEye).
    const onFoot = alive && session.driving < 0 && !passenger;
    if (onFoot && !this.wasOnFoot) this.view.thirdPerson = this.ui.settings.thirdPerson && !this.fromEye;
    this.wasOnFoot = onFoot;
    // A server rule can forbid third person. A rider still sees its mount from behind.
    // From the eye a glider's wings are overhead and out of sight, so the view stands back as one is thrown open, where the
    // server allows it, and returns to the eye as it folds. V still chooses between them in the air.
    const gliderOpen = alive && session.driving < 0 && session.own.glide !== 0;
    if (gliderOpen && !this.gliderOpen && !this.view.thirdPerson && session.thirdPerson) {
      this.view.thirdPerson = true;
      this.gliderStoodBack = true;
    } else if (!gliderOpen && this.gliderOpen && this.gliderStoodBack) {
      this.view.thirdPerson = false;
      this.gliderStoodBack = false;
    }
    this.gliderOpen = gliderOpen;
    if (!session.thirdPerson) this.view.thirdPerson = false;
    // A session without a living body looks from the eye.
    const third = this.view.thirdPerson || (alive && !!car && !rotor && !boat);
    if (!alive) this.view.thirdPerson = false;
    else if (session.driving >= 0 && !fullAttitude) this.view.thirdPerson = true;
    // The view turns with the kick and, through a scope, with the sway, as a shot does (shared/sim/aim.ts), so the middle of
    // the view is where the next shot is pointed. The look the input sends stays the player's own.
    const gun = alive && session.weaponsAllowed ? (this.reg.weapon[session.own.held] ?? null) : null;
    const aiming = alive && this.steer && (c.buttons & BTN_SECONDARY) !== 0 && gun !== null && gun.clip > 0;
    // The orbit's view does not look along the aim: it neither narrows to it nor shows a sight, and the centre of the
    // screen is not where a shot goes, so the crosshair is hidden while it is in use. The aim itself is the body's.
    const orbiting = this.orbit.inUse, sighting = aiming && !orbiting;
    hud.orbit = orbiting;
    const held = session.inventory && session.inventory.hotbar >= 0 && session.held >= 0 ? session.inventory.hotbar + session.held : -1;
    const scoped = aiming && scopeFitted(this.reg, session.inventory, held);
    let lookYaw = c.yaw;
    let lookPitch = c.pitch;
    if (gun && session.driving < 0) {
      lookPitch += (session.ownPrev.kick + (session.own.kick - session.ownPrev.kick) * a) * KICK_UNIT * UNIT_RADIANS;
      if (scoped) {
        // The breath held or the body winded as the shot will have it (D1085).
        sway(gun, session.own.stance, session.ownHandle, session.tickClock, breathShare(session.own, c.buttons));
        lookYaw += swayOut.yaw * UNIT_RADIANS;
        lookPitch += swayOut.pitch * UNIT_RADIANS;
      }
      lookPitch = lookPitch > PI / 2 ? PI / 2 : lookPitch;
    }
    cam.aspect = aspect;
    // Aiming narrows the view in proportion to the player's setting; through a sight, by its optic's zoom. The mouse slows
    // to match on the tangent of the view's half (optics.ts lookScale). A sight that magnifies is seen from the eye, as
    // over the shoulder the middle of a narrow view is not where the shot goes; the player's choice of view is kept.
    const settings = this.ui.settings;
    const base = (settings.fov * Math.PI) / 180;
    const fitted = gun && session.driving < 0 ? attachmentOf(this.reg, session.inventory, held) : null;
    // A weapon's own scope (the fabricated sniper rifle's, D1083), or the one fitted to it.
    const ownOptic = gun && session.driving < 0 ? (this.reg.defs[session.own.held] as ItemDef | null)?.optic : undefined;
    const sightOptic = ownOptic ?? fitted?.optic;
    const sight = ownOptic ? "scope" : (fitted?.attachment ?? "");
    this.sightOptic = sighting && sightOptic && opticMost(sightOptic) > sightOptic.min ? sightOptic : null;
    if (this.sightOptic) this.sightZoom = Math.min(opticMost(this.sightOptic), Math.max(this.sightOptic.min, this.sightZoom || this.sightOptic.min));
    // A held glass, raised with the secondary on foot (glass.ts, D1082).
    const heldDef = alive && session.driving < 0 && !passenger ? (this.reg.defs[session.own.held] as ItemDef | null) : null;
    this.glassOptic = heldDef?.class === "instrument" ? (heldDef.optic ?? null) : null;
    const glassUp = this.glassOptic !== null && this.steer && (c.buttons & BTN_SECONDARY) !== 0 && !orbiting && hud.banner === "";
    this.glass.raise(glassUp);
    // A helmet's visor, held up, on foot, the helmet working and no sight aimed through (visor.ts, D1080).
    const visorUp = this.visor.step((this.visorOptic = this.wornOptic(session.inventory)), alive && session.driving < 0 && !passenger && !sighting && !glassUp && !orbiting && hud.banner === "");
    const zoom = glassUp ? this.glass.zoom(this.glassOptic!) : visorUp ? this.visor.zoom : this.sightOptic ? this.sightZoom : sightOptic ? opticZoom(sightOptic) : 0;
    let want = glassUp || visorUp ? zoomed(base, zoom) : sighting ? (zoom > 0 ? zoomed(base, zoom) : base * AIM_FOV) : base;
    this.view.atEye = ((sighting && forcesEye(zoom)) || visorUp || glassUp) && !passenger;
    if (glassUp) {
      // The hand shakes it, less crouched, least lying down; the view turns with it, the look sent does not.
      this.glass.shake(nowMs, session.own.stance, this.shook);
      lookYaw += this.shook[0]!;
      lookPitch += this.shook[1]!;
      const press = (c.buttons & BTN_PRIMARY) !== 0;
      if (press && !this.glassPressed) this.glass.lase(nowMs);
      this.glassPressed = press;
    } else this.glassPressed = false;
    hud.behind = alive && third && !this.view.atEye && session.driving < 0 && !passenger;
    if (hud.vehicle && !aiming) want += Math.min(7 * Math.PI / 180, hud.vehicle.speed / 30 * 7 * Math.PI / 180);
    // Under a glider the view opens with its speed, a dive's most, and third person stands back to hold the wings.
    const gliding = alive && session.driving < 0 && session.own.glide !== 0;
    if (gliding) want += Math.min(GLIDE_FOV, (Math.hypot(session.own.vx, session.own.vy, session.own.vz) / GLIDE_DIVE) * GLIDE_FOV);
    this.view.gliding += ((gliding ? 1 : 0) - this.view.gliding) * (1 - Math.exp(-Math.max(0, dt) / 280));
    // A glass's lenses are drawn as a scope's are (ui/hud.ts buildReticle), two and no posts.
    hud.scope = (sighting && sight === "scope") || glassUp;
    // The scope's window spans less of the screen the more it magnifies; the eye off its axis, as the body moves, a shot
    // kicks or the sway leads, casts its shadow across the lens. Outside the window nothing is drawn (D1077).
    const optic = glassUp ? this.glassOptic! : visorUp ? this.visorOptic! : sightOptic;
    hud.sightMil = hud.scope && optic?.reticle === "mil";
    hud.sightFov = this.fov;
    hud.sightZoom = zoom;
    // The magnification ladder: any sight raised that magnifies, its zoom now within its least and most.
    hud.magnify = (hud.scope || visorUp) && optic && zoom > 1 ? zoom : 0;
    hud.magnifyMin = optic ? optic.min : 0;
    hud.magnifyMax = optic ? opticMost(optic) : 0;
    hud.sightZero = hud.sightMil ? this.sightZero : 0;
    session.sightZero = sighting && hud.sightMil ? this.sightZero : 0;
    hud.sightShare = optic ? windowShare(optic, zoom) : 1;
    hud.sightShape = shapeOf(optic);
    hud.visor = visorUp;
    hud.visorZoom = zoom;
    hud.visorMode = this.visor.mode;
    hud.visorDigital = visorUp && this.visor.digital;
    hud.visorRange = this.visor.range;
    this.visor.frame(this.scene.optic, daylight(this.sky.hour));
    if (hud.scope && gun) {
      const pace = Math.hypot(session.own.vx, session.own.vz) / Math.max(1, move?.walkSpeed ?? 1);
      const kick = gun.recoilKick ? (session.own.kick * KICK_UNIT * UNIT_RADIANS) / ((gun.recoilKick * PI) / 180) : 0;
      eyeOff(pace, kick, swayOut.yaw, -swayOut.pitch, this.eyeAt);
      const ease = 1 - Math.exp(-Math.max(0, dt) / EYE_EASE_MS);
      hud.sightOffX += (this.eyeAt[0]! - hud.sightOffX) * ease;
      hud.sightOffY += (this.eyeAt[1]! - hud.sightOffY) * ease;
    } else hud.sightOffX = hud.sightOffY = 0;
    const win = cam.window;
    if ((hud.scope || visorUp) && hud.banner === "") {
      windowBox(hud.sightShape, hud.sightShare, aspect, this.windowAt);
      win[0] = this.windowAt[0]! * 2 - 1; win[1] = 1 - this.windowAt[3]! * 2; win[2] = this.windowAt[2]! * 2 - 1; win[3] = 1 - this.windowAt[1]! * 2;
    } else { win[0] = win[1] = -1; win[2] = win[3] = 1; }
    hud.holo = alive && sight === "holo" && !orbiting;
    hud.tint = hud.holo && sighting ? HOLO_TINT : 0;
    this.sightAt.yaw = lookYaw;
    this.sightAt.pitch = lookPitch;
    this.sightAt.laser = alive && sight === "laser" && (session.inventory!.flags[held]! & FLAG_ON) !== 0;
    this.sightAt.x = bx;
    this.sightAt.y = by + eye;
    this.sightAt.z = bz;
    if (alive && this.ownSeatEye(world, this.remote, session.tickClock, c.yaw, c.pitch, this.posedEye)) {
      this.sightAt.x = this.posedEye[0]!; this.sightAt.y = this.posedEye[1]!; this.sightAt.z = this.posedEye[2]!;
    }
    this.fov = easeFov(this.fov, want, hud.vehicle || gliding || this.view.gliding > 0.02 ? 1 - Math.exp(-Math.max(0, dt) / 260) : Math.min(1, dt / FOV_EASE_MS));
    cam.fovY = this.fov;
    cam.zoom = magnification(base, this.fov);
    // Through a sight the server is told how far it magnifies and what it is on, so its cone widens the view (D1079).
    this.gaze(nowMs, world, (sighting || visorUp || glassUp) && zoom > 1 ? zoom : 0, lookYaw, lookPitch);
    this.lookReach = (sighting || visorUp || glassUp) && zoom > 1 ? Math.max(30, Math.min(GAZE_FARTHEST, GAZE_REACH * zoom)) : 30;
    hud.glass = glassUp;
    hud.zooming = this.zooming;
    hud.glassHeld = this.glassOptic !== null;
    hud.visorReady = this.visorOptic !== null && alive && session.driving < 0;
    hud.glassZoom = zoom;
    if (glassUp) {
      const eyeAt = this.sightAt, d = this.aim;
      this.glass.ranged(nowMs, () => {
        lookDirection((lookYaw / TAU) * 65536, (lookPitch / (PI / 2)) * 16384, d);
        return castWorld(world, eyeAt.x, eyeAt.y, eyeAt.z, d[0]!, d[1]!, d[2]!, GAZE_FARTHEST) !== HIT_NONE ? rayHit.t : 0;
      }, hud.heading);
    }
    hud.glassRange = this.glass.lasing >= 0 ? -1 : this.glass.range;
    hud.glassBearing = this.glass.bearing;
    hud.glassMarked = nowMs - this.glass.markedAt < MARKED_MS;
    c.zoom = lookScale(base, this.fov, settings.sensitivity, settings.zoomSensitivity);
    // The crosshair opens with the cone the next shot would leave within.
    hud.cone = gun && gun.coneHip !== undefined && session.driving < 0 ? Math.tan((shotCone(session.own, c.buttons, gun, this.reg.tamedMove[session.own.kind] ?? move!, false) * PI) / 180) / Math.tan(this.fov / 2) : -1;
    const body = this.body;
    body.kind = session.ownKind;
    body.x = bx;
    body.y = by;
    body.z = bz;
    body.yaw = c.yaw;
    body.tick = session.tickClock;
    body.firstPerson = !(third && !this.view.atEye) && !chase;
    body.id = handleIndex(session.ownHandle);
    body.generation = handleGen(session.ownHandle);
    body.vehicle = undefined;
    body.cockpitActor = fullAttitude && !third ? handleIndex(session.ownHandle) : undefined;
    body.attachment = passenger ? { host: session.own.seat - 1, slot: session.own.seatSlot, generation: session.own.seatGen } : undefined;
    body.look = session.ownLook;
    const inv = session.inventory;
    body.gear.fill(0);
    if (inv && inv.hotbar >= 0) {
      if (session.held >= 0 && session.weaponsAllowed) body.gear[GEAR_HELD] = inv.item[inv.hotbar + session.held]!;
      for (let k = 0; k < ARMOR_SLOTS; k++) body.gear[GEAR_WORN + k] = inv.item[inv.armor + k]!;
    }
    body.state.mode = session.own.mode;
    body.state.grounded = session.own.grounded;
    body.state.stance = session.own.stance;
    body.state.setMotion(session.own.vx, session.own.vz, c.yaw, c.pitch);
    body.state.setJet(session.own.jetThrust, session.own.jetGear);
    body.state.setGlide(session.own.glide !== 0, glidePhase(session.own.vx, session.own.vy, session.own.vz));
    // The action comes from the prediction, so a swing shows the moment it is asked for. Arms full hold what is in them.
    body.state.setAction(session.own.act, this.holding >= 0 ? HOLD_CARRY : (this.reg.weapon[session.own.held] ?? FISTS).hold, session.simTick - session.own.actTicks);
    body.state.seed = bodySeed(body.id);
    // An emote is the server's to say: the one it plays for this body, as the view has it.
    body.state.unpackEmote(0);
    for (let i = 0; i < this.remote.count; i++) if (this.remote.id[i] === body.id) body.state.unpackEmote(this.remote.emote[i]!);
    // While riding, the mount is the body it predicts, drawn from the prediction and always from outside.
    // Its own body is then one more remote body, where the server has it on the seat.
    const riding = alive && session.driving >= 0;
    if (riding) {
      body.kind = session.bodyKind;
      body.yaw = car ? carYaw : (session.own.yaw / 65536) * TAU;
      if (car) body.vehicle = vehiclePose;
      body.firstPerson = false;
      body.id = session.driving;
      body.generation = 0;
      body.look = null;
      body.gear.fill(0);
      body.state.stance = 0;
      // Posed from what the server poses it from: the look as the input carries it, and a flyer's climb.
      body.state.setMotion(session.own.vx, session.own.vz, body.yaw, (Math.round((c.pitch / (PI / 2)) * 16384) * (PI / 2)) / 16384, session.own.vy);
      body.state.setAction(session.own.act, this.reg.combat[session.bodyKind] ? creatureHold(session.own) : 0, session.simTick - session.own.actTicks);
      body.state.seed = bodySeed(body.id);
      // The mount's colours, its saddle and its cues come from its remote copy.
      body.colors.fill(0);
      body.state.unpackCue(0);
      const r = this.remote;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== session.driving) continue;
        if (body.vehicle) {
          body.vehicle.doors = r.vehicleDoors[i]!;
          body.vehicle.lightMode = r.vehicleLightMode[i]!;
          if (this.vehicleTelemetry.lightMode >= 0) this.vehicleTelemetry.lightMode = body.vehicle.lightMode;
        }
        body.generation = r.gen[i]!;
        body.colors.set(r.colors.subarray(i * 6, i * 6 + 6));
        for (let k = 0; k < GEAR_COUNT; k++) body.gear[k] = r.gear[i * GEAR_COUNT + k]!;
        body.state.unpackCue(r.cue[i]!);
      }
    }
    this.scene.skip = riding ? session.driving : -1;
    this.scene.own = (alive && session.ownHandle !== 0 && session.driving < 0) || riding ? body : null;
    // The chase camera looks at two thirds of the vehicle's height from a boom one and a half times its length.
    if (alive && car && fullAttitude) {
      const frame = { ...vehiclePose!, x: bx, y: by, z: bz, yaw: carYaw };
      if (third) {
        vehiclePoint(frame, [0, boat && !car.family ? 1.1 : rotor ? 1.65 : car.spec.height * 2 / 3, rotor || boat ? -.35 : 0], this.seatSpot);
        const heading = this.view.placeVehicle(cam, world, this.seatSpot[0]!, this.seatSpot[1]!, this.seatSpot[2]!, c.yaw, c.pitch, carYaw, Math.hypot(session.own.vx, session.own.vz), dt, !rotor && !boat, { vx: session.own.vx, vy: session.own.vy, vz: session.own.vz, id: session.driving, boom: rotor || boat ? Math.max(boat ? 8 : 10, car.spec.halfLength * 2) : car.spec.halfLength * 3 });
        if (!rotor && !boat) c.yaw = heading;
      } else {
        const slot = car.seats.findIndex(seat => seat.driver) + 1, ch = this.scene.characters;
        ch.seat(session.bodyKind, bx, by, bz, carYaw, this.body.state, session.tickClock, this.seatSpot, slot, vehiclePose);
        const seat = ch.seatPose(session.bodyKind, slot, vehiclePose!, this.seatSpot, carYaw, undefined, this.seated);
        if (!seat || !ch.seatedEye(session.ownKind, seat, this.seatSpot)) {
          const anchor = car.seats[slot - 1]!.anchor;
          vehiclePoint(frame, [anchor[0], anchor[1] + .76, anchor[2] + .05], this.seatSpot);
        }
        this.view.placeCockpit(cam, this.seatSpot[0]!, this.seatSpot[1]!, this.seatSpot[2]!, frame, this.cockpit.yaw, this.cockpit.pitch);
      }
    } else if (alive && car) c.yaw = this.view.placeVehicle(cam, world, bx, by + car.spec.height * 2 / 3, bz, c.yaw, c.pitch, carYaw, Math.hypot(session.own.vx, session.own.vz), dt, true, { vx: session.own.vx, vy: session.own.vy, vz: session.own.vz, id: session.driving, boom: car.spec.halfLength * 3 });
    else if (alive && session.driving >= 0) {
      // Riding, the camera is behind where the rider looks, which the mount turns to and flies along: at the rider's head,
      // on a boom as long as the mount is big, and drawn in by whatever is in the way.
      const o = session.own, def = this.reg.defs[session.bodyKind];
      const obstruction = def?.type === "species" && def.camera?.avoidBody ? this.scene.prepareCameraBody(body) : null;
      const view = this.mountView(body.kind, body.gear[GEAR_WORN]!);
      const identity = makeHandle(body.id, body.generation);
      const px = bx + Math.sin(body.yaw) * view.forward, pz = bz + Math.cos(body.yaw) * view.forward;
      // A posed dinosaur solves body clearance and roof height together. Other mounts anticipate the roof from inside their capsule.
      const pivot = obstruction ? by + view.up : this.mountCamera.height(world, identity, px, pz, by + (this.reg.move[body.kind]?.height ?? 1) * .5, by + view.up, o.vx, o.vz, dt);
      const orbit = this.orbit.place(this.chaseRig(lookYaw, lookPitch, view.boom), view.boom, dt);
      this.view.placeVehicle(cam, world, px, pivot, pz, orbit ? orbit.yaw : lookYaw, orbit ? orbit.pitch + CHASE_TILT : lookPitch, lookYaw, Math.hypot(o.vx, o.vy, o.vz), dt, false, { vx: o.vx, vy: o.vy, vz: o.vz, id: identity, boom: orbit ? orbit.back : view.boom, anticipate: !obstruction, safeY: this.mountCamera.safeY, wantedY: this.mountCamera.wantedY }, obstruction);
    } else if (passenger) {
      let px = bx, py = by + eye, pz = bz, heading = c.yaw, boom: number | undefined, chaseVx = 0, chaseVz = 0;
      if (!chase && passengerFullAttitude && cockpitFrame) {
        const host = this.remote.id.subarray(0, this.remote.count).indexOf(session.own.seat - 1);
        const anchor = this.reg.vehicle[this.remote.kind[host] ?? 0]?.seats[session.own.seatSlot - 1]?.anchor;
        if (anchor) {
          vehiclePoint(cockpitFrame, [anchor[0], anchor[1] + .76, anchor[2] + .05], this.seatSpot);
          px = this.seatSpot[0]!; py = this.seatSpot[1]!; pz = this.seatSpot[2]!;
        }
      }
      for (let i = 0; i < this.remote.count; i++) {
        const r = this.remote;
        const ch = this.scene.characters;
        if (r.id[i] !== session.own.seat - 1 || r.gen[i] !== session.own.seatGen) continue;
        heading = r.yaw[i]!;
        const vehicle = ch.vehicle(r.kind[i]!);
        if (chase) {
          const view = vehicle ? null : this.mountView(r.kind[i]!, r.gear[i * GEAR_COUNT + GEAR_WORN]!);
          px = r.x[i]! + Math.sin(heading) * (view?.forward ?? 0); py = r.y[i]! + (view?.up ?? 1); pz = r.z[i]! + Math.cos(heading) * (view?.forward ?? 0);
          if (view) {
            py = this.mountCamera.height(world, makeHandle(r.id[i]!, r.gen[i]!), px, pz, r.y[i]! + (this.reg.move[r.kind[i]!]?.height ?? 1) * .5, py, undefined, undefined, dt);
            chaseVx = this.mountCamera.vx; chaseVz = this.mountCamera.vz;
          }
          boom = vehicle ? Math.max(6, (this.reg.vehicle[r.kind[i]!]!.spec.halfLength) * (passengerFullAttitude ? 2 : 3)) : view?.boom;
        } else if (vehicle) {
          const pose = remoteVehiclePose(r, i);
          if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, this.body.state, r.tick, this.seatSpot, session.own.seatSlot, pose)) {
            const seat = ch.seatPose(r.kind[i]!, session.own.seatSlot, pose, this.seatSpot, heading, undefined, this.seated)!;
            const found = passengerFullAttitude ? ch.seatedEye(session.ownKind, seat, this.seatSpot) : ch.seatedOrigin(session.ownKind, seat, this.seatSpot);
            if (found) { px = this.seatSpot[0]!; py = this.seatSpot[1]! + (passengerFullAttitude ? 0 : eye); pz = this.seatSpot[2]!; }
          }
        } else {
          // On a saddle, the eye is over the seat's origin as the server has it, posed as its creature is drawn.
          const ms = this.mountState;
          ms.unpack(r.anim[i]!, r.cue[i]!);
          ms.seed = bodySeed(r.id[i]!);
          if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, ms, r.tick, this.seatSpot, session.own.seatSlot, undefined, r.gear[i * GEAR_COUNT + GEAR_WORN]!, -1, false, r.grown[i] ? youngScale(this.reg.birthScale[r.kind[i]!]!, r.span[i]!, r.grown[i]!, r.tick) : 1)) {
            if (session.own.seatSlot === IMPALE_SLOT) this.seatSpot[1]! -= ch.impaleDrop(session.ownKind);
            px = this.seatSpot[0]!; py = this.seatSpot[1]! + eye; pz = this.seatSpot[2]!;
          }
        }
        break;
      }
      if (!chase && this.ownSeatEye(world, this.remote, session.tickClock, c.yaw, c.pitch, this.posedEye, false)) { px = this.posedEye[0]!; py = this.posedEye[1]!; pz = this.posedEye[2]!; }
      if (chase) {
        const orbit = this.orbit.place(this.chaseRig(lookYaw, lookPitch, boom ?? CHASE_BOOM), boom ?? CHASE_BOOM, dt);
        const motion = boom === undefined ? orbit ? { vx: 0, vy: 0, vz: 0, boom: orbit.back } : undefined
          : { vx: chaseVx, vy: 0, vz: chaseVz, id: makeHandle(session.own.seat - 1, session.own.seatGen), boom: orbit ? orbit.back : boom, anticipate: !passengerFullAttitude, safeY: this.mountCamera.safeY, wantedY: this.mountCamera.wantedY };
        this.view.placeVehicle(cam, world, px, py, pz, orbit ? orbit.yaw : lookYaw, orbit ? orbit.pitch + CHASE_TILT : lookPitch, heading, 0, dt, false, motion);
      } else if (passengerCockpit && cockpitFrame) this.view.placeCockpit(cam, px, py, pz, cockpitFrame, this.cockpit.yaw, this.cockpit.pitch);
      else this.view.place(cam, world, px, py, pz, lookYaw, lookPitch, dt);
    } else {
      const orbit = this.orbit.place(this.view.own(this.viewRig, lookYaw, lookPitch), ORBIT_BACK, dt);
      if (orbit) this.view.placeRig(cam, world, bx, by + eye, bz, orbit, dt);
      else this.view.place(cam, world, bx, by + eye, bz, lookYaw, lookPitch, dt);
    }
    // The orbit shows the whole body once the camera is clear of the head.
    if (this.orbit.inUse && this.orbit.shown.back > HEAD_CLEAR) body.firstPerson = false;
    this.view.thirdPerson = third;
    if (session.sessionState === SESSION_CREATING) this.preview(nowMs, aspect);
    // Sound takes its copy of the shots, hits and tames before the tracers and hit marks use them up.
    this.sounds?.absorb(session.events, session.fired, Math.max(0, session.tamed.length - this.tamedHeard));
    this.tamedHeard = session.tamed.length;
    this.shots.absorb(session, world, nowMs);
    this.shots.step(world, this.remote, session.tickClock, nowMs);
    this.scene.shotTick = session.tickClock;
    // Blows that landed on bodies near: each is drawn snapping back where it was struck (render/impact-springs.ts).
    if (session.impacts.length > 0) {
      const r = this.remote, own = handleIndex(session.ownHandle), ch = this.scene.characters;
      for (const im of session.impacts) {
        if (im.id === own) ch.impact(session.ownKind, own, this.body.yaw, im.bone, im.dx, im.dy, im.dz, im.strength);
        else for (let j = 0; j < r.count; j++) if (r.id[j] === im.id) { ch.impact(r.kind[j]!, im.id, r.yaw[j]!, im.bone, im.dx, im.dy, im.dz, im.strength); break; }
      }
      session.impacts.length = 0;
    }
    this.supply.list = session.supply;
    this.supply.tick = session.tickClock;
    this.falling!.absorb(session.rubble, nowMs, cam.x, cam.y, cam.z);
    this.falling!.step(nowMs);
    const beams = this.scene.beams;
    beams.length = 0;
    if (session.corpseLocator) for (const m of session.markers) if (m.kind === MARKER_DEATH) beams.push(m.x, m.y, m.z);
    hud.dpr = this.dpr;
    this.scene.hour = this.hud.hour = this.sky.step(session.serverTick, session.dayOffset, session.clock, this.interval, this.ui.creativeScreen.sundial.held, session.creative);
    this.scene.viewHeight = height;
    this.scene.now = nowMs;
    if (this.playEye && this.artEyeAt === null && alive && this.script.length === 0) this.artEyeAt = nowMs;
    this.scene.eyeSeconds = this.artEyeTime === null ? session.renderClock / TICK_RATE
      : this.artEyeTime + (this.artEyeAt === null ? 0 : (nowMs - this.artEyeAt) / 1000);
    // A picture tool that holds the obelisks' clock holds the drops' with it: a cast leaves by that clock.
    if (this.artEyeTime !== null) this.supply.tick = this.scene.eyeSeconds * TICK_RATE;
    const alternate = this.other !== null && (++this.drawnFrames & 1) === 0, off = alternate ? this.other! : this.off;
    this.scene.alternate = alternate;
    this.scene.finishGloss = this.ui.settings.finishGloss;
    this.scene.roadFinish = this.ui.settings.roadFinish;
    this.scene.assets.residency.holdBack = this.session.behind;
    const chosen = forTouch(tierOf(this.ui.settings.tier), this.ui.settings.touchFirst);
    const governed = tierWithout(this.governor.tier(chosen, this.ui.settings.steady, this.dpr, nowMs), off);
    if (this.tierReady && chosen !== this.warmedBase) this.warming.splice(0, Infinity, ...ladder((this.warmedBase = chosen), this.dpr).map((l) => tierWithout(l.tier, off)));
    if (this.tierReady && this.warming.length > 0) this.tierReady(this.warming.shift()!);
    if (!this.tierShown || governed === this.scene.assets.tier || !this.tierReady || this.tierReady(governed)) {
      this.scene.assets.tier = governed;
      this.tierShown = true;
    }
    const ratio = canvasRatio(this.scene.assets.tier, this.dpr, width, height);
    [this.scene.canvasWidth, this.scene.canvasHeight] = [Math.floor(width * ratio), Math.floor(height * ratio)];
    this.scene.supersampled = ratio > ownRatio(this.scene.assets.tier, this.dpr);
    // The scene's share is of the canvas the chosen tier draws at the screen's own pixels; the governor's steps take
    // their shares of it (governor.ts).
    const own = width * height * ownRatio(chosen, this.dpr) ** 2;
    [this.scene.share, this.ui.settings.autoShare] = [sceneShare(chosen, this.shareAsked || (RESOLUTIONS[this.ui.settings.resolution]?.share ?? 0), own), sceneShare(chosen, 0, own)];
    session.view(this.scene.assets.tier.view, this.ui.settings.snapshotBytes);
    session.askFar(this.scene.assets.tier.reach.bases);
    session.holdNodes(this.scene.assets.tier.nodes.chunks);
    this.scene.characters.corpseMotions = session.corpseMotions;
    sceneWithout(this.scene, this.off);
    // The street lamps' light and the wires between the poles, which a bench turns off every other frame (`?ab=lamps`, `wires`).
    this.scene.streetLamps.on = !off.has("lamps");
    this.scene.streetWires.on = !off.has("wires");
    // The moon's shadows by night, the street lamp that lights as a light and the shadows in the lamps' pool cards, which a
    // bench turns off every other frame (`?ab=moon`, `lamp`, `pools`).
    this.scene.moonShadows = !off.has("moon");
    this.scene.streetLamps.light = !off.has("lamp");
    this.scene.streetLamps.shaded = !off.has("pools");
    // Damage numbers are drawn with the world, where the server's rule and the reader's setting let them.
    this.scene.damage.enabled = session.damageNumbers && this.ui.settings.damageNumbers;
    const packet = this.scene.build(cam, this.remote);
    session.requestCorpseMotions(this.scene.characters.corpseCheckpointRequests);
    packetWithout(packet, off);
    hud.minimapVisible = this.ui.settings.minimap && !this.ui.menu;
    if (hud.chart && this.ui.settings.minimapZoom >= 0) hud.chart.miniZoom = this.ui.settings.minimapZoom;
    updateHud(hud, session, this.remote, this.fps, this.unit, nowMs);
    hud.steady = this.governor.level > 0 ? ` (${this.governor.level} down: ${this.governor.name})` : "";
    this.feedback.absorb(session, this.reg, nowMs, this.scene.damage);
    this.feedback.fill(hud.combat, cam, c.yaw, alive, nowMs, session.hitMarkers);
    fillOverhead(hud.overhead, session, this.remote, cam, this.scene.characters, alive && !hud.out ? eyeNow : -1, c.yaw, c.pitch, this.lookReach);
    // Another survivor's glass glints to one it faces (CUE_SCOPED, D1083): brighter the straighter it looks.
    const r = this.remote, spot = this.spot;
    hud.glintCount = 0;
    for (let i = 0; i < r.count && hud.glintCount < 4; i++) {
      if ((r.cue[i]! & CUE_SCOPED) === 0 || (r.flags[i]! & VIEW_FLAG_PLAYER) === 0 || (r.cue[i]! & CUE_DEAD) !== 0) continue;
      const dx = cam.x - r.x[i]!, dz = cam.z - r.z[i]!, far = Math.hypot(dx, dz);
      let off = Math.abs(Math.atan2(dx, dz) - r.yaw[i]!) % TAU;
      if (off > PI) off = TAU - off;
      if (far < GLINT_NEAR || off > GLINT_HALF) continue;
      const y = r.y[i]! + this.reg.bodyHeight[r.kind[i]!]! * 0.9;
      if (!cam.project(r.x[i]!, y, r.z[i]!, spot) || spot[0]! < 0 || spot[0]! > 1 || spot[1]! < 0 || spot[1]! > 1) continue;
      const ey = y - cam.y, d = Math.hypot(dx, ey, dz);
      if (castWorld(world, cam.x, cam.y, cam.z, -dx / d, ey / d, -dz / d, d - 0.5) !== HIT_NONE) continue;
      const g = (hud.glints[hud.glintCount++] ??= { u: 0, v: 0, alpha: 0 });
      g.u = spot[0]!;
      g.v = spot[1]!;
      g.alpha = 1 - off / GLINT_HALF;
    }
    // What the tribe spotted, where it stands on the screen (D1082).
    const marks = session.tactical.marks;
    hud.spotCount = 0;
    for (let i = 0; i < marks.count && hud.spotCount < 8; i++) {
      if (marks.kind[i] !== MARK_SPOT) continue;
      const x = marks.x[i]!, z = marks.z[i]!;
      if (!cam.project(x, world.hf.heightAt(x, z) + SPOT_RISE, z, spot) || spot[0]! < 0 || spot[0]! > 1 || spot[1]! < 0 || spot[1]! > 1) continue;
      const out = (hud.spots[hud.spotCount++] ??= { u: 0, v: 0 });
      out.u = spot[0]!;
      out.v = spot[1]!;
    }
    this.fillSights(world, alive);
    fillHotbar(hud, alive ? session.inventory : null, session.held, this.reg, this.pack.palette);
    fillAction(hud, alive ? session : null, this.reg);
    fillBuffs(hud, alive ? session : null, this.reg, this.pack.palette, riding && body.state.rivalry && !body.state.out);
    if (alive && car) hud.ammo = "";
    this.listen(hud);
    const vol = this.ui.settings;
    if (this.sounds && this.musicTracks && !this.sounds.music) this.sounds.setMusic(this.musicTracks);
    if (this.sounds) this.sounds.assetsIdle = this.scene.assets.residency.flying === 0 && this.scene.assets.residency.waiting === 0;
    if (this.sound && this.sounds) this.sounds.frame(this.sound, nowMs, this.remote, world.hf, cam, { master: vol.muted ? 0 : vol.masterVolume, effects: vol.soundVolume, ambience: vol.ambienceVolume, music: vol.musicVolume, interface: vol.interfaceVolume }, App.late!.soundView(session, this.sky), this.scene.characters.fallen);
    const ghost = this.scene.ghost;
    ghost.kind = 0;
    const b = this.builder, v = this.vehiclePlacement;
    if (alive && session.driving < 0) {
      lookDirection(Math.round((c.yaw / TAU) * 65536) & 0xffff, Math.round((c.pitch / (PI / 2)) * 16384), this.aim);
      b.update(session, world, this.reg, session.own.x, session.own.y + eyeNow, session.own.z, this.aim[0]!, this.aim[1]!, this.aim[2]!, c.yaw, nowMs);
      v.update(session, world, this.reg, session.own.x, session.own.y + eyeNow, session.own.z, this.aim[0]!, this.aim[1]!, this.aim[2]!, c.yaw, nowMs);
    } else { b.active = false; v.active = false; }
    if (b.active && b.problem !== RESULT_NO_SNAP) {
      ghost.kind = b.kind;
      ghost.x = b.pose.x / STRUCT_UNITS;
      ghost.y = b.pose.y / STRUCT_UNITS;
      ghost.z = b.pose.z / STRUCT_UNITS;
      ghost.yaw = b.pose.yaw;
      ghost.color = b.problem === 0 ? GHOST_OK : GHOST_BAD;
    }
    if (v.active) {
      ghost.kind = v.kind; ghost.x = v.pose.x; ghost.y = v.pose.y; ghost.z = v.pose.z; ghost.yaw = v.pose.yaw;
      ghost.color = v.problem === RESULT_OK ? GHOST_OK : GHOST_BAD;
    }
    const menu = this.ui.structure;
    menu.tick(nowMs);
    this.seatNotice.tick(nowMs);
    const built = alive && !b.active && !v.active && session.driving < 0 ? this.builtAt(world, eyeNow) : ((this.aimed = this.terminalAimed = -1), "");
    if (this.aimed >= 0 && this.useDownAt >= 0 && nowMs - this.useDownAt >= STRUCT_HOLD_MS && !menu.open && this.ui.wantsPointerLock) {
      menu.begin(this.aimed);
      this.useDownAt = -1;
      this.useKept = false;
      c.release();
    }
    const whom = alive ? this.who(world, eyeNow) : ((this.aimedBoat = this.lookedAt = this.target = -1), "");
    this.eggAimed = -1;
    // A move for two goes to the survivor the crosshair is on.
    const emotes = this.ui.emotes;
    emotes.tick(nowMs);
    emotes.target = -1;
    emotes.targetName = "";
    for (let i = 0; i < this.remote.count; i++) {
      if (this.remote.id[i] !== this.target || !this.scene!.characters.human(this.remote.kind[i]!)) continue;
      emotes.target = this.target;
      emotes.targetName = this.remote.name[i]!;
    }
    emotes.has = (n) => this.scene!.characters.emoteKnown(n);
    if (emotes.open) this.scene!.characters.wantEmotes();
    hud.prompt = !alive ? "" : v.active ? v.notice : b.active ? b.notice : menu.notice || this.seatNotice.notice || emotes.notice || this.handPrompt(world, eyeNow) || whom || built || this.gliderPrompt();
    if (b.active) hud.ammo = "E turn   Q next place   R form";
    this.ui.build(aspect, hud, session);
    // Over the interface: an open note's line, its bar and a picture's flash (notes/notes.ts).
    this.notes?.frame(nowMs, width, height);
    return packet;
  }

  /** The console's and chat's words of bug report mode: `notes` turns it on and off, `perf [seconds]` keeps a record. Null for any other line. */
  private notesWord(line: string): string | null {
    if (line === "notes") return toggleNotes(this.ui.settings);
    if (line === "budget") return toggleBudget(this.ui.settings);
    if (!/^perf(\s|$)/.test(line)) return null;
    return this.notes ? this.notes.perf(line) : "a performance record is kept in bug report mode: /notes turns it on";
  }
}
