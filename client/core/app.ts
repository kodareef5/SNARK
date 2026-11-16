// One whole client without a browser. The shell owns the renderer, socket and DOM, forwards events
// here, and draws what frame() returns. Tests drive this class directly.

import { Icons } from "./assets/icons.ts";
import { GamepadInput, type PadSample, type PadTarget } from "./gamepad.ts";
import type { AssetPort } from "./assets/port.ts";
import { forTouch, tierOf } from "./assets/tiers.ts";
import { Governor, PHONE_MS, workMs } from "./governor.ts";
import { BENCH_TURN_MS, effectsOff, packetWithout, tierWithout, type Effect } from "./passes.ts";
import { keptLine } from "./settings.ts";
import { stressThings, type Mark } from "./stress.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { MODE_FLYER, stanceEye } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CARRY_THROW, CMD_VEHICLE, VEHICLE_INSPECT, CMD_CARRY, CMD_OPEN, CMD_ORDER, CMD_SELECT, CMD_TAKE, MARKER_DEATH, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_STAY, ORDER_YOURS, REJECT_FULL, REJECT_PASSWORD, REJECT_TRAVEL, REJECT_VERSION, RESULT_OK, SESSION_ALIVE, SESSION_CREATING, RESULT_NO_SNAP, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { structName } from "./ui/structure.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { Controls, LOOK_SPEED } from "./controls.ts";
import { HudModel, VehicleTelemetry, fillAction, fillBuffs, fillHotbar, fillOverhead, updateHud } from "./hud.ts";
import { Chart } from "./tactical.ts";
import { Camera } from "./render/camera.ts";
import { SQUEEZE_MOST } from "./render/budget.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, bodySeed, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { Falling } from "./rubble.ts";
import { BTN_SPRINT, BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { FISTS, HOLD_CARRY } from "../../shared/sim/weapon.ts";
import { KICK_UNIT, scopeFitted, shotCone, sway, swayOut } from "../../shared/sim/aim.ts";
import { AnimState, CUE_HELD, CUE_OUT } from "../../shared/anim/pose.ts";
import { handleGen, handleIndex, makeHandle } from "../../shared/ids.ts";
import { VehiclePlacement } from "./vehicle-placement.ts";
import { predictedVehiclePose, remoteVehiclePose } from "./vehicle-view.ts";
import { vehiclePoint, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ON, type Inventory } from "../../shared/sim/items.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { Lasers, daylight } from "./render/laser.ts";
import { CockpitLook, Viewpoint } from "./viewpoint.ts";
import { CLOSED_BAD_CONTENT, CLOSED_BAD_VERSION, RemoteSample, type ClientSession } from "./session.ts";
import { Builder, GHOST_BAD, GHOST_OK } from "./build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { waitWords } from "./ui/inventory.ts";
import { voicePan } from "./voice/place.ts";
import { HEAR_FIELDS, type VoicePort } from "./voice/port.ts";
import { MODE_TALK, MODE_WHISPER, MODE_YELL } from "../../shared/voice/packet.ts";
import type { SoundSink } from "./sound/packet.ts";
import { Sounds } from "./sound/sounds.ts";
import type { SoundDecoder } from "./sound/library.ts";
import type { MusicTrack } from "./sound/music.ts";
import { hearSession, soundView } from "./sound/view.ts";
import { cueKey } from "../../shared/sound/cues.ts";
import { soundCommand } from "./sound/command.ts";
import { SplitPort } from "./sound/split.ts";

/** Indexed by MODE_*. */
const TALK_LABEL: readonly string[] = ["WHISPERING", "TALKING", "YELLING"];
import { IMAGE_MAP, IMAGE_MINIMAP, KEY_HOTBAR, KEY_MINIMAP_TOGGLE, KEY_MINIMAP_OUT, KEY_MINIMAP_IN, KEY_VITAL } from "./ui/hud.ts";
import { CANVAS_HEIGHT } from "./ui/nodes.ts";
import { mapPointer } from "./ui/screens.ts";
import { Ui } from "./ui/ui.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { TRAVEL_REFRESH_MS } from "./ui/travel.ts";
import { arrivalAddress, joinAddress, serverAddress, type Page } from "./travel.ts";

/** Metres. Matches the server's REACH. */
const REACH = 3.5;
/** Holding the use key on a structure this long opens its menu. */
const STRUCT_HOLD_MS = 350;
/** Metres. */
const NAME_RANGE = 30;
/** A bit of the replicated entity flags. */
const VIEW_FLAG_PROP = 8;
/** What hands round a creature cannot do, so a body holding one neither sends nor predicts them (server/carry.ts). */
const HANDS_FULL = BTN_PRIMARY | BTN_MELEE | BTN_RELOAD | BTN_PRONE;

/** Initial vertical field of view, in radians. AIM_FOV multiplies the player's setting while aiming. */
const BASE_FOV = 1.2217;
const AIM_FOV = 0.79;
/**
 * How many times a sight magnifies, aimed through it: the scope "zooms by about 3x" (Scope Attachment), the holo-scope "a
 * slight zoom (around 1.25x)" (Holo-Scope Attachment). The holo-scope tints the view green, "similar to a nightvision mode",
 * this much.
 */
export const SCOPE_ZOOM = 3;
export const HOLO_ZOOM = 1.25;
const HOLO_TINT = 0.22;
/** Metres a holo-scope's crosshair finds what it is on, and its colours (Holo-Scope Attachment). */
const HOLO_REACH = 300;
const HOLO_FRIEND = 0x48e05a;
const HOLO_FOE = 0xff3a30;
const HOLO_OTHER = 0xf2d23a;

/** The vertical field of view that magnifies `base` (radians) `zoom` times: the tangent of its half is the zoom's share. */
export function zoomed(base: number, zoom: number): number {
  return 2 * Math.atan(Math.tan(base / 2) / zoom);
}

/** The kind of attachment (ItemDef.attachment) on the weapon in `slot` of `inv`, or "". */
function attachmentKind(reg: Registry, inv: Inventory | null, slot: number): string {
  const fitted = inv && slot >= 0 ? inv.attach[slot]! : 0;
  return fitted === 0 ? "" : ((reg.defs[fitted] as ItemDef | null)?.attachment ?? "");
}
/** Radians in a unit of yaw or pitch on the wire (65536 to a turn). */
const UNIT_RADIANS = TAU / 65536;

export class App {
  readonly session: ClientSession;
  readonly controls = new Controls();
  readonly ui = new Ui();
  readonly cam = new Camera();
  readonly hud = new HudModel();
  /** The dash's readings of the vehicle driven. */
  readonly vehicleTelemetry = new VehicleTelemetry();
  readonly feedback = new Feedback();
  /** Laser dots this frame (client/core/render/laser.ts). */
  readonly lasers = new Lasers();
  /** The frame's view and eye, and whether its own laser is on, for the sights. */
  private readonly sightAt = { yaw: 0, pitch: 0, laser: false, x: 0, y: 0, z: 0 };
  private readonly spot = [0, 0, 0];
  /** Where a passenger sits, for its camera (Characters.seat), and the pose of the creature it sits on. */
  private readonly seatSpot = new Float64Array(12);
  private readonly mountState = new AnimState();
  readonly shots: Shots;
  /** Null until the world arrives. */
  falling: Falling | null = null;
  /** Eased toward what the held weapon and the aim button ask for. */
  private fov = BASE_FOV;
  readonly remote = new RemoteSample();
  readonly view = new Viewpoint();
  private readonly cockpit = new CockpitLook();
  scene: Scene | null = null;
  /** Draw the stress meshes, if the pack has them. `marks` are the rocks whose colour says which level is on the screen. */
  stress = false;
  marks: Mark[] = [];
  /** Show the asset library's state on the status line. */
  debug = false;
  private readonly stream: { manifest: Manifest; port: AssetPort } | undefined;
  /** Smoothed. */
  fps = 60;
  /** False while the self-check holds the body still. */
  steer = true;
  /** The dome drawn as the sky table alone and nothing hazed, as the rasterizer draws, so the self-check's colours are the twins'. */
  plainSky = false;
  /** Keeps the frame steady under the tier chosen (governor.ts). The shell tells it what each frame took. */
  readonly governor = new Governor();
  /** The screen's device pixels a CSS pixel, and effects the page's address turned off (passes.ts). */
  dpr = 1;
  off: ReadonlySet<Effect> = new Set();
  private interval = 0;
  /** Whether the keys are a flyer's, and the last tick stepped before its wing was last wanted. */
  private flying = false;
  private wingFrom = 0;
  private wingWas = false;

  /** The registry last handed to the UI and shots. frame() swaps it when the session's changes. */
  private shown: Registry;
  private readonly pad = new GamepadInput();
  private readonly padTarget: PadTarget;
  private readonly pack: Pack;
  private last = -1;
  /** Eased eye height above the feet, or -1 before the first frame and while there is no living body. */
  private eye = -1;
  private helicopterViewHost = -1;
  private readonly aim = [0, 0, 0];
  private readonly seatAt = [0, 0, 0];
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
    this.pack = pack;
    this.ui.registry = reg;
    this.ui.palette = pack.palette;
    const app = this;
    this.padTarget = {
      get inMenu() { return !app.ui.wantsPointerLock; },
      get inspecting() { return app.ui.inspect; },
      get flying() { return app.controls.onFlyer; },
      adjust: by => this.ui.adjustFocused(by),
      key: (code, down) => { this.key(code, down, false, 1); }, mouse: (button, down) => this.mouseButton(button, down, 1),
      move: (x, z) => this.controls.padMove(x, z), look: (x, y) => this.look(x,y), used: () => { this.ui.inputDevice = 1; },
      navigate: (direction, press) => {
        const key = this.ui.navigate(direction), n = this.ui.frame.find(key);
        if (press && n) this.pointer(press === 1 ? 0 : 1, key, n.x+n.w/2, n.y+n.h/2, 0);
      },
    };
    this.ui.local = (line) => (this.sounds ? soundCommand(line, this.sounds, this.session.own, this.controls.yaw, this.nowMs) : null);
    // The inventory pictures the build drew, fetched as they are first shown.
    if (stream?.manifest.icons) new Icons(stream.manifest, reg.defs).install(this.ui.frame);
    this.shots = new Shots(reg, pack);
    this.ui.inventory.onDeploy = slot => this.vehiclePlacement.begin(slot);
    session.onResult = (seq, code) => {
      this.ui.creator.result(seq, code === RESULT_OK);
      this.builder.result(seq, code, this.nowMs);
      this.vehiclePlacement.result(seq, code, this.nowMs);
      this.ui.structure.result(seq, code, this.nowMs, this.session, this.aimed);
    };
  }

  readonly builder = new Builder();
  readonly vehiclePlacement = new VehiclePlacement();
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
    if (this.volumeSet !== this.ui.settings.voiceVolume) v.volume((this.volumeSet = this.ui.settings.voiceVolume));
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
    // F opens the tribe creature that is ridden or looked at.
    if (code === "KeyF") {
      const which = this.session.driving >= 0 ? this.session.driving : this.lookedAt;
      if (down && !repeat && which >= 0) {
        const r = this.remote, at = r.id.subarray(0, r.count).indexOf(which);
        if (at >= 0 && this.reg.vehicle[r.kind[at]!]) this.session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_INSPECT); w.u32(makeHandle(which, r.gen[at]!)); });
        else this.session.command(CMD_OPEN, (w) => w.u32(which >>> 0));
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
      if (down && !repeat && this.session.thirdPerson) this.view.thirdPerson = !this.view.thirdPerson;
      return true;
    }
    // Arms round a creature do not lie down with it.
    if (code === "KeyX" && down && this.holding >= 0) return true;
    return this.controls.key(code, down, source);
  }

  mouseButton(button: number, down: boolean, source = 0): void {
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
    else this.controls.look(dx, dy);
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

  /** `kind` is 0 for down, 1 for up, 2 for move. The position is in canvas units. */
  pointer(kind: number, key: number, x: number, y: number, button: number): void {
    if (!this.ui.menu && this.ui.map && mapPointer(this.hud, kind, key, x, y)) return;
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
    return flyer;
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
      const size = this.sizeOf(i);
      const rad = this.reg.bodyRadius[r.kind[i]!]! * size;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + this.reg.bodyHeight[r.kind[i]!]! * size, r.z[i]! + rad);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    const mine = hit >= 0 && s.tribe.team !== 0 && r.team[hit] === s.tribe.team;
    this.target = hit >= 0 && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 ? r.id[hit]! : -1;
    this.lookedAt = hit >= 0 && mine && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 && !this.scene!.characters.human(r.kind[hit]!) ? r.id[hit]! : -1;
    // A creature's name is in the mark over it (fillOverhead).
    if (hit < 0 || r.name[hit] === "" || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 || !this.scene!.characters.human(r.kind[hit]!)) return "";
    return `${r.name[hit]}${mine ? " (tribe)" : ""}  level ${r.level[hit]}`;
  }

  /**
   * The laser dots on the screen, its own and those of bodies whose laser is on, each where the world or a body first meets
   * its beam and only where the camera sees that spot; and the holo-scope's crosshair colour (weapons-plan.md, M10).
   */
  private fillSights(world: CollisionWorld, alive: boolean): void {
    const { hud, cam, session, lasers, sightAt: at } = this;
    const r = this.remote;
    const d = this.aim;
    const day = daylight(hourOfDay(session.serverTick, session.dayOffset, session.clock));
    lookDirection((at.yaw / TAU) * 65536, (at.pitch / (PI / 2)) * 16384, d);
    lasers.clear();
    if (at.laser) lasers.cast(this.reg, world, r, at.x, at.y, at.z, d[0]!, d[1]!, d[2]!, day, 0, session.driving);
    lasers.remotes(this.reg, world, r, day);
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
    const { cam, session, reg } = this;
    const r = this.remote;
    const team = session.tribe.team;
    let t = castWorld(world, cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, HOLO_REACH) === HIT_NONE ? Infinity : rayHit.t;
    let tint = -1;
    if (t < Infinity && rayHit.kind === HIT_STRUCTURE) {
      const ref = rayHit.ref;
      const owner = world.structs.chunks[Math.floor(ref / 65536)]!.owner[ref & 0xffff]!;
      if (owner !== 0) tint = team !== 0 && owner === team ? HOLO_FRIEND : HOLO_OTHER;
    }
    for (let i = 0; i < r.count; i++) {
      const kind = r.kind[i]!;
      const rad = reg.bodyRadius[kind]!;
      if (reg.move[kind] === null || !(rad > 0) || r.id[i] === session.driving) continue;
      const hit = rayBox(cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + reg.bodyHeight[kind]!, r.z[i]! + rad);
      if (!(hit > 0 && hit < t)) continue;
      t = hit;
      const mine = team !== 0 && r.team[i] === team;
      tint = mine ? HOLO_FRIEND : r.team[i] === 0 ? HOLO_OTHER : HOLO_FOE;
    }
    return tint;
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

  /**
   * The riding camera of a creature of `kind`, entity `id`: how far above its origin its rider's head is, from its saddle's
   * steering seat, and its boom: 1.5 m and 1.2 times as big as the creature is (its rig's reach, else its body).
   */
  private mountView(kind: number, id: number): { up: number; boom: number } {
    const r = this.remote;
    let saddle = 0;
    for (let i = 0; i < r.count; i++) if (r.id[i] === id) saddle = r.gear[i * GEAR_COUNT + GEAR_WORN]!;
    const seat = this.reg.saddleSeats[saddle]?.find((s) => s.driver);
    const size = Math.max(this.scene?.characters.reach(kind) ?? 0, this.reg.bodyHeight[kind]!, 2 * this.reg.bodyRadius[kind]!);
    return { up: seat ? seat.anchor[1] + 0.75 : this.reg.bodyHeight[kind]! + 0.5, boom: 1.5 + 1.2 * size };
  }

  /** Labels what the use button would act on, with the same ray the server casts. The server's answer is the one that counts. */
  private prompt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    if (s.driving >= 0) return this.reg.vehicle[s.bodyKind] ? "E  exit vehicle" : "E  get off";
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
      const size = this.sizeOf(i);
      const rad = this.reg.bodyRadius[r.kind[i]!]! * size;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + this.reg.bodyHeight[r.kind[i]!]! * size, r.z[i]! + rad);
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
      const car = this.reg.vehicle[r.kind[hit]!];
      if (car) {
        const frame = { ...remoteVehiclePose(r, hit), x: r.x[hit]!, y: r.y[hit]!, z: r.z[hit]!, yaw: r.yaw[hit]! };
        let slot = 0, near = Infinity;
        for (let j = 0; j < car.seats.length; j++) {
          vehiclePoint(frame, car.seats[j]!.entry, this.seatAt);
          const d = Math.hypot(ox - this.seatAt[0]!, oz - this.seatAt[2]!);
          if (d < near) { near = d; slot = j; }
        }
        let occupied = false;
        for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[hit]! + 1 && r.seatGen[j] === r.gen[hit] && r.seatSlot[j] === slot + 1) occupied = true;
        return occupied ? car.seats[slot]!.driver ? "E  carjack driver" : "Passenger seat occupied" : car.seats[slot]!.driver ? "E  enter driver seat" : "E  enter passenger seat";
      }
      // A saddled creature of the tribe, grown and awake, is ridden: its steering seat if it is free, else a passenger's.
      const seats = this.reg.saddleSeats[r.gear[hit * GEAR_COUNT + GEAR_WORN]!];
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
        // On a prop, a nonzero grown tick marks a fertilised egg. An egg that is an item is taken up.
        const left = waitWords(Math.max(0, Math.ceil((r.grown[hit]! - s.serverTick) / TICK_RATE)));
        if (this.reg.propItem[r.kind[hit]!] !== 0) {
          this.eggAimed = r.id[hit]!;
          return `E  take ${r.name[hit]}${r.grown[hit] !== 0 ? `  ${left} to hatch` : ""}`;
        }
        if (r.grown[hit] !== 0) return `${r.name[hit]}  hatches in ${left}`;
        return `E  ${s.open ? "close" : "open"} ${r.name[hit]}`;
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
   * or hashes, or measures, holds the governor at the tier, or at `level`, and may name the `tier`.
   */
  address(get: (name: string) => string | null, pinned: boolean): void {
    this.off = effectsOff(get("off"));
    if (!pinned) return;
    this.governor.held = Number(get("level") ?? 0);
    this.ui.settings.tier = tierOf(get("tier") ?? this.ui.settings.tier).name;
  }

  /** After the frame is handed to WebGL: our code took `ours` ms of it. */
  drawn(packet: FramePacket, ours: number): void {
    const budget = this.scene?.budget;
    const crowns = budget && budget.squeeze < SQUEEZE_MOST ? budget.last.crowns : 0;
    const work = workMs(packet.triangles, packet.drawCount, packet.castTriangles, packet.castDraws, packet.tier.shadows.size);
    this.governor.frame(this.nowMs, this.interval, ours, packet.assetUploads.length + packet.texUploads.length > 0, work, crowns * PHONE_MS.triangle);
  }

  /** The shell says the graphics card ran out of memory or lost everything. On every third time the graphics tier falls by one. */
  pressure(): void {
    // What follows is the uploads of all that was lost, or of what failed, which are no reason to step.
    this.governor.pause(this.nowMs);
    if (!this.scene?.assets.pressure()) return;
    this.ui.settings.tier = this.scene.assets.tier.name;
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
    }
    if (session.state === "closed" && (session.closeReason === REJECT_TRAVEL || session.closeReason === REJECT_FULL) && !this.turnedAway) {
      this.turnedAway = t.open = true;
      t.askedAt = -Infinity;
    }
    const trip = session.travelled;
    if ((t.open || trip) && nowMs - t.askedAt >= TRAVEL_REFRESH_MS) {
      t.askedAt = nowMs;
      page.cluster().then(
        (list) => {
          t.list = list;
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
    const session = this.session;
    const hud = this.hud;
    const c = this.controls;
    this.nowMs = nowMs;
    hud.vehicle = null;

    this.travel(nowMs);
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
    this.holding = this.heldInArms();
    const flyer = this.flyerKeys();
    this.refreshCockpitLook();
    if (this.steer) session.update(nowMs, c.moveX, c.moveZ, c.yaw, c.pitch, this.holding >= 0 ? c.buttons & ~HANDS_FULL : c.buttons);
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
      this.ui.registry = this.shown;
      this.shots.reg = this.shown;
    }
    if (!this.scene) {
      // Sounds share the asset port, each side taking only what it asked for.
      const split = this.sound && this.stream ? new SplitPort(this.stream.port) : null;
      this.scene = new Scene(world, this.reg, this.pack, split ? { manifest: this.stream!.manifest, port: split.assets } : this.stream);
      if (split) {
        this.sounds = new Sounds(this.stream!.manifest, split.sounds, this.reg, (kind) => this.scene!.characters.creature(kind), this.soundDecoder ?? undefined, this.pack.header.details?.sheets ?? []);
        hearSession(session, this.sounds);
        this.ui.hear = (key) => this.sounds?.hearUi(cueKey(key));
      }
      this.scene.shots = this.shots;
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
    hud.status = this.debug ? `${this.scene.assets.line()}${this.sounds ? `; ${this.sounds.line()}` : ""}` : "";
    // Sampled before the camera, which puts a passenger in its seat on the vehicle as it is drawn.
    session.sampleRemote(this.remote);

    // The eye interpolates between the last two predicted ticks, so motion is smooth at any frame rate.
    const cam = this.cam;
    const a = session.alpha;
    const alive = session.sessionState === SESSION_ALIVE;
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
    const rotor = car?.movement === "rotor", boat = car?.movement === "boat", fullAttitude = rotor || boat;
    const vehiclePose = car ? predictedVehiclePose(session.ownPrev, session.own, a, rotor, boat) : undefined;
    if (alive && car && session.driving >= 0) {
      if (car.movement === "rotor") {
        const altitude = castWorld(world, bx, by + .05, bz, 0, -1, 0, 2000) !== HIT_NONE ? Math.max(0, rayHit.t - .05) : by - world.hf.heightAt(bx, bz);
        this.vehicleTelemetry.updateRotor(session.driving, session.own, car.spec, altitude, c.directFlight, this.steer && (c.buttons & BTN_PRONE) !== 0);
      } else if (car.movement === "boat") this.vehicleTelemetry.updateBoat(session.driving, session.own, car.spec, this.steer && (c.buttons & BTN_SPRINT) !== 0);
      else this.vehicleTelemetry.update(session.driving, session.own, this.steer ? c.moveZ : 0, this.steer && (c.buttons & BTN_JUMP) !== 0, car.spec, dt);
      hud.vehicle = this.vehicleTelemetry;
    } else this.vehicleTelemetry.stop();
    const carYaw = session.ownPrev.vehicleYaw + Math.atan2(Math.sin(session.own.vehicleYaw - session.ownPrev.vehicleYaw), Math.cos(session.own.vehicleYaw - session.ownPrev.vehicleYaw)) * a;
    const passenger = alive && session.driving < 0 && session.own.seatSlot !== 0 && session.own.seat > 0;
    // A passenger's chase camera is third person, so it obeys the same server rule.
    let passengerFullAttitude = false;
    let cockpitFrame: VehicleFrame | undefined = fullAttitude ? { ...vehiclePose!, x: bx, y: by, z: bz, yaw: carYaw } : undefined;
    if (passenger) for (let i = 0; i < this.remote.count; i++) {
      const r = this.remote;
      if (r.id[i] !== session.own.seat - 1 || r.gen[i] !== session.own.seatGen) continue;
      passengerFullAttitude = r.vehicleRotorcraft[i] !== 0 || r.vehicleBoat[i] !== 0;
      if (passengerFullAttitude) cockpitFrame = { ...remoteVehiclePose(r, i), x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]! };
    }
    const helicopterHost = fullAttitude && session.driving >= 0 ? session.driving : passengerFullAttitude ? session.own.seat - 1 : -1;
    this.cockpitLook(helicopterHost, cockpitFrame);
    const chase = passenger && session.thirdPerson && (!passengerFullAttitude || this.view.thirdPerson);
    // A server rule can forbid third person. A rider still sees its mount from behind.
    if (!session.thirdPerson) this.view.thirdPerson = false;
    // A session without a living body looks from the eye.
    const third = this.view.thirdPerson;
    if (!alive) this.view.thirdPerson = false;
    else if (session.driving >= 0 && !fullAttitude) this.view.thirdPerson = true;
    // The view turns with the kick and, through a scope, with the sway, as a shot does (shared/sim/aim.ts), so the middle of
    // the view is where the next shot is pointed. The look the input sends stays the player's own.
    const gun = alive && session.weaponsAllowed ? (this.reg.weapon[session.own.held] ?? null) : null;
    const aiming = alive && this.steer && (c.buttons & BTN_SECONDARY) !== 0 && gun !== null && gun.clip > 0;
    const held = session.inventory && session.inventory.hotbar >= 0 && session.held >= 0 ? session.inventory.hotbar + session.held : -1;
    const scoped = aiming && scopeFitted(this.reg, session.inventory, held);
    let lookYaw = c.yaw;
    let lookPitch = c.pitch;
    if (gun && session.driving < 0) {
      lookPitch += (session.ownPrev.kick + (session.own.kick - session.ownPrev.kick) * a) * KICK_UNIT * UNIT_RADIANS;
      if (scoped) {
        sway(gun, session.own.stance, session.ownHandle, session.tickClock);
        lookYaw += swayOut.yaw * UNIT_RADIANS;
        lookPitch += swayOut.pitch * UNIT_RADIANS;
      }
      lookPitch = lookPitch > PI / 2 ? PI / 2 : lookPitch;
    }
    // The chase camera looks at two thirds of the vehicle's height from a boom one and a half times its length.
    if (alive && car && fullAttitude) {
      const frame = { ...vehiclePose!, x: bx, y: by, z: bz, yaw: carYaw };
      if (third) {
        vehiclePoint(frame, [0, boat ? 1.1 : 1.65, -.35], this.seatSpot);
        this.view.placeVehicle(cam, world, this.seatSpot[0]!, this.seatSpot[1]!, this.seatSpot[2]!, c.yaw, c.pitch, carYaw, Math.hypot(session.own.vx, session.own.vz), dt, false, { vx: session.own.vx, vy: session.own.vy, vz: session.own.vz, id: session.driving, boom: Math.max(boat ? 8 : 10, car.spec.halfLength * 2) });
      } else {
        const slot = car.seats.findIndex(seat => seat.driver) + 1, ch = this.scene.characters;
        ch.seat(session.bodyKind, bx, by, bz, carYaw, this.body.state, session.tickClock, this.seatSpot, slot, vehiclePose);
        const seat = ch.seatPose(session.bodyKind, slot, vehiclePose!, this.seatSpot, carYaw);
        if (!seat || !ch.seatedEye(session.ownKind, session.ownLook, seat, this.seatSpot)) vehiclePoint(frame, [.48, 1.86, .70], this.seatSpot);
        this.view.placeCockpit(cam, this.seatSpot[0]!, this.seatSpot[1]!, this.seatSpot[2]!, frame, this.cockpit.yaw, this.cockpit.pitch);
      }
    } else if (alive && car) c.yaw = this.view.placeVehicle(cam, world, bx, by + car.spec.height * 2 / 3, bz, c.yaw, c.pitch, carYaw, Math.hypot(session.own.vx, session.own.vz), dt, true, { vx: session.own.vx, vy: session.own.vy, vz: session.own.vz, id: session.driving, boom: car.spec.halfLength * 3 });
    else if (alive && session.driving >= 0) {
      // Riding, the camera is behind where the rider looks, which the mount turns to and flies along: at the rider's head,
      // on a boom as long as the mount is big, and drawn in by whatever is in the way.
      const view = this.mountView(session.bodyKind, session.driving);
      const o = session.own;
      this.view.placeVehicle(cam, world, bx, by + view.up, bz, lookYaw, lookPitch, lookYaw, Math.hypot(o.vx, o.vy, o.vz), dt, false, { vx: o.vx, vy: o.vy, vz: o.vz, id: session.driving, boom: view.boom });
    } else if (passenger) {
      let px = bx, py = by + eye, pz = bz, heading = c.yaw, boom: number | undefined;
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
          const view = vehicle ? null : this.mountView(r.kind[i]!, r.id[i]!);
          px = r.x[i]!; py = r.y[i]! + (view?.up ?? 1); pz = r.z[i]!;
          boom = vehicle ? Math.max(6, (this.reg.vehicle[r.kind[i]!]!.spec.halfLength) * (passengerFullAttitude ? 2 : 3)) : view?.boom;
        } else if (vehicle) {
          const pose = remoteVehiclePose(r, i);
          if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, this.body.state, r.tick, this.seatSpot, session.own.seatSlot, pose)) {
            const seat = ch.seatPose(r.kind[i]!, session.own.seatSlot, pose, this.seatSpot, heading)!;
            const found = passengerFullAttitude ? ch.seatedEye(session.ownKind, session.ownLook, seat, this.seatSpot) : ch.seatedOrigin(session.ownKind, session.ownLook, seat, this.seatSpot);
            if (found) { px = this.seatSpot[0]!; py = this.seatSpot[1]! + (passengerFullAttitude ? 0 : eye); pz = this.seatSpot[2]!; }
          }
        } else {
          // On a saddle, the eye is over the seat's origin as the server has it, posed as its creature is drawn.
          const ms = this.mountState;
          ms.unpack(r.anim[i]!, r.cue[i]!);
          ms.seed = bodySeed(r.id[i]!);
          if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, ms, r.tick, this.seatSpot, session.own.seatSlot, undefined, r.gear[i * GEAR_COUNT + GEAR_WORN]!)) {
            px = this.seatSpot[0]!; py = this.seatSpot[1]! + eye; pz = this.seatSpot[2]!;
          }
        }
        break;
      }
      if (chase) this.view.placeVehicle(cam, world, px, py, pz, lookYaw, lookPitch, heading, 0, dt, false, boom === undefined ? undefined : { vx: 0, vy: 0, vz: 0, id: session.own.seat - 1, boom });
      else if (passengerFullAttitude && cockpitFrame) this.view.placeCockpit(cam, px, py, pz, cockpitFrame, this.cockpit.yaw, this.cockpit.pitch);
      else this.view.place(cam, world, px, py, pz, lookYaw, lookPitch, dt);
    } else this.view.place(cam, world, bx, by + eye, bz, lookYaw, lookPitch, dt);
    this.view.thirdPerson = third;
    cam.aspect = aspect;
    // Aiming narrows the view in proportion to the player's setting; through a sight, by its zoom. The mouse slows to match.
    const settings = this.ui.settings;
    const base = (settings.fov * Math.PI) / 180;
    const sight = gun && session.driving < 0 ? attachmentKind(this.reg, session.inventory, held) : "";
    const zoom = sight === "scope" ? SCOPE_ZOOM : sight === "holo" ? HOLO_ZOOM : 0;
    let want = aiming ? (zoom > 0 ? zoomed(base, zoom) : base * AIM_FOV) : base;
    if (hud.vehicle && !aiming) want += Math.min(7 * Math.PI / 180, hud.vehicle.speed / 30 * 7 * Math.PI / 180);
    hud.scope = aiming && sight === "scope";
    hud.holo = alive && sight === "holo";
    hud.tint = hud.holo && aiming ? HOLO_TINT : 0;
    this.sightAt.yaw = lookYaw;
    this.sightAt.pitch = lookPitch;
    this.sightAt.laser = alive && sight === "laser" && (session.inventory!.flags[held]! & FLAG_ON) !== 0;
    this.sightAt.x = bx;
    this.sightAt.y = by + eye;
    this.sightAt.z = bz;
    this.fov += (want - this.fov) * (hud.vehicle ? 1 - Math.exp(-Math.max(0, dt) / 260) : Math.min(1, dt / 70));
    cam.fovY = this.fov;
    c.zoom = (this.fov / base) * settings.sensitivity;
    // The crosshair opens with the cone the next shot would leave within.
    hud.cone = gun && gun.coneHip !== undefined && session.driving < 0 ? Math.tan((shotCone(session.own, c.buttons, gun, this.reg.tamedMove[session.own.kind] ?? move!, false) * PI) / 180) / Math.tan(this.fov / 2) : -1;
    const body = this.body;
    body.kind = session.ownKind;
    body.x = bx;
    body.y = by;
    body.z = bz;
    body.yaw = c.yaw;
    body.tick = session.tickClock;
    body.firstPerson = !third && !chase;
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
    // The action comes from the prediction, so a swing shows the moment it is asked for. Arms full hold what is in them.
    body.state.setAction(session.own.act, this.holding >= 0 ? HOLD_CARRY : (this.reg.weapon[session.own.held] ?? FISTS).hold, session.simTick - session.own.actTicks);
    body.state.seed = bodySeed(body.id);
    // While riding, the mount is the body it predicts, drawn from the prediction and always from outside.
    // Its own body is then one more remote body, where the server has it on the seat.
    const riding = alive && session.driving >= 0;
    if (riding) {
      body.kind = session.bodyKind;
      body.yaw = car ? carYaw : (session.own.yaw / 65536) * TAU;
      if (car) body.vehicle = vehiclePose;
      body.firstPerson = false;
      body.id = session.driving;
      body.look = null;
      body.gear.fill(0);
      body.state.stance = 0;
      // Posed from what the server poses it from: the look as the input carries it, and a flyer's climb.
      body.state.setMotion(session.own.vx, session.own.vz, body.yaw, (Math.round((c.pitch / (PI / 2)) * 16384) * (PI / 2)) / 16384, session.own.vy);
      body.state.setAction(session.own.act, 0, session.simTick - session.own.actTicks);
      body.state.seed = bodySeed(body.id);
      // The mount's colours, its saddle and its cues come from its remote copy.
      body.colors.fill(0);
      body.state.unpackCue(0);
      const r = this.remote;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== session.driving) continue;
        if (body.vehicle) body.vehicle.doors = r.vehicleDoors[i]!;
        body.generation = r.gen[i]!;
        body.colors.set(r.colors.subarray(i * 6, i * 6 + 6));
        for (let k = 0; k < GEAR_COUNT; k++) body.gear[k] = r.gear[i * GEAR_COUNT + k]!;
        body.state.unpackCue(r.cue[i]!);
      }
    }
    this.scene.skip = riding ? session.driving : -1;
    this.scene.own = (alive && session.ownHandle !== 0 && session.driving < 0) || riding ? body : null;
    if (session.sessionState === SESSION_CREATING) this.preview(nowMs, aspect);
    // Sound takes its copy of the shots, hits and tames before the tracers and hit marks use them up.
    this.sounds?.absorb(session.events, session.fired, Math.max(0, session.tamed.length - this.tamedHeard));
    this.tamedHeard = session.tamed.length;
    this.shots.absorb(session, world, nowMs);
    this.shots.step(world, this.remote, session.tickClock, nowMs);
    this.scene.shotTick = session.tickClock;
    this.falling!.absorb(session.rubble, nowMs, cam.x, cam.y, cam.z);
    this.falling!.step(nowMs);
    const beams = this.scene.beams;
    beams.length = 0;
    if (session.corpseLocator) for (const m of session.markers) if (m.kind === MARKER_DEATH) beams.push(m.x, m.y, m.z);
    this.scene.hour = hourOfDay(session.serverTick, session.dayOffset, session.clock);
    this.scene.viewHeight = height;
    this.scene.now = nowMs;
    const kept = this.scene.assets.residency.cache;
    if (this.ui.settings.download) {
      this.scene.assets.residency.download();
      this.sounds?.library.download();
    }
    this.ui.settings.download = false;
    this.ui.settings.kept = keptLine(kept);
    this.scene.assets.tier = tierWithout(this.governor.tier(forTouch(tierOf(this.ui.settings.tier), this.ui.settings.touchFirst), this.ui.settings.steady, this.dpr, nowMs), this.off);
    session.view(this.scene.assets.tier.view, this.ui.settings.snapshotBytes);
    session.askFar(this.scene.assets.tier.reach.bases);
    session.holdNodes(this.scene.assets.tier.nodes.chunks);
    const packet = this.scene.build(cam, this.remote);
    packetWithout(packet, this.off);
    hud.minimapVisible = this.ui.settings.minimap && !this.ui.menu;
    if (hud.chart && this.ui.settings.minimapZoom >= 0) hud.chart.miniZoom = this.ui.settings.minimapZoom;
    updateHud(hud, session, this.remote, this.fps, height / CANVAS_HEIGHT);
    hud.steady = this.governor.level > 0 ? ` (${this.governor.level} down: ${this.governor.name})` : "";
    this.feedback.absorb(session, this.reg, nowMs);
    this.feedback.fill(hud.combat, cam, c.yaw, alive, nowMs, session.damageNumbers && this.ui.settings.damageNumbers, session.hitMarkers);
    fillOverhead(hud.overhead, session, this.remote, cam, this.scene.characters, alive && !hud.out ? eyeNow : -1, c.yaw, c.pitch);
    this.fillSights(world, alive);
    fillHotbar(hud, alive ? session.inventory : null, session.held, this.reg, this.pack.palette);
    fillAction(hud, alive ? session : null, this.reg);
    fillBuffs(hud, alive ? session : null, this.reg, this.pack.palette);
    if (alive && car) hud.ammo = "";
    this.listen(hud);
    const vol = this.ui.settings;
    if (this.sounds && this.musicTracks && !this.sounds.music) this.sounds.setMusic(this.musicTracks);
    if (this.sounds) this.sounds.assetsIdle = this.scene.assets.residency.flying === 0 && this.scene.assets.residency.waiting === 0;
    if (this.sound && this.sounds) this.sounds.frame(this.sound, nowMs, this.remote, world.hf, cam, { master: vol.masterVolume, effects: vol.soundVolume, ambience: vol.ambienceVolume, music: vol.musicVolume, interface: vol.interfaceVolume }, soundView(session));
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
    const built = alive && !b.active && !v.active && session.driving < 0 ? this.builtAt(world, eyeNow) : ((this.aimed = this.terminalAimed = -1), "");
    if (this.aimed >= 0 && this.useDownAt >= 0 && nowMs - this.useDownAt >= STRUCT_HOLD_MS && !menu.open && this.ui.wantsPointerLock) {
      menu.begin(this.aimed);
      this.useDownAt = -1;
      this.useKept = false;
      c.release();
    }
    const whom = alive ? this.who(world, eyeNow) : ((this.lookedAt = this.target = -1), "");
    this.eggAimed = -1;
    hud.prompt = !alive ? "" : v.active ? v.notice : b.active ? b.notice : menu.notice || this.prompt(world, eyeNow) || whom || built;
    if (b.active) hud.ammo = "E turn   Q next place   R form";
    this.ui.build(aspect, hud, session);
    return packet;
  }
}
