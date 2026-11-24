// One whole client without a browser. The shell owns the renderer, socket and DOM, forwards events
// here, and draws what frame() returns. Tests drive this class directly.

import { Icons } from "./assets/icons.ts";
import { Visor } from "./visor.ts";
import { Glass } from "./glass.ts";
import type { OpticFacet } from "../../shared/content/defs.ts";
import { GamepadInput, type PadSample, type PadTarget } from "./gamepad.ts";
import type { AssetPort } from "./assets/port.ts";
import { canvasRatio, forTouch, ownRatio, tierOf, type Tier } from "./assets/tiers.ts";
import { Governor, PHONE_MS, ladder, workMs } from "./governor.ts";
import type { FrameRing } from "./assets/frames.ts";
import type { Effect } from "./passes.ts";
import { RESOLUTIONS, sceneShare } from "./render/post.ts";
import { toggleDebug } from "./settings.ts";
import type { DebugPort } from "./debug/port.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CARRY_THROW, CMD_CARRY, CMD_SELECT, MARKER_DEATH, REJECT_FULL, REJECT_PASSWORD, REJECT_TRAVEL, REJECT_VERSION, RESULT_LOCKED, RESULT_OK, SESSION_ALIVE, RESULT_NO_SNAP, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { BreakEffects, HEARD_RUMBLE, hearStructures } from "./break-effects.ts";
import { Controls } from "./controls.ts";
import { pressKey } from "./key-row.ts";
import { KEY_ROWS } from "./keys.ts";
import { HudModel, VehicleTelemetry, fillHud, fillOverhead } from "./hud.ts";
import { HudFill } from "./hud/widget.ts";
import { AppFrame, type FramePart, type PartRow } from "./frame.ts";
import type { Probe } from "./probe.ts";
import { GLIDER_KEY_TICKS, Prompts } from "./prompts.ts";
import { Sight } from "./sight.ts";
import { AirFeed } from "./air-feed.ts";
import { Director } from "./view/director.ts";
import { FallenView } from "./view/fallen.ts";
import { ToolHooks, autopilot, type ToolOrders } from "./tool-hooks.ts";
import type { Mark } from "./stress.ts";

export { MEASURED_VOLUME, type ToolOrders } from "./tool-hooks.ts";
import { Chart } from "./tactical.ts";
import { Camera } from "./render/camera.ts";
import { SQUEEZE_MOST } from "./render/budget.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { SupplyView } from "./supply.ts";
import { Falling } from "./rubble.ts";
import { isSkateboard } from "../../shared/sim/vehicle.ts";
import { thrustersOf } from "../../shared/sim/vehicle-thrusters.ts";
import { BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD } from "../../shared/sim/character.ts";
import { CUE_HELD } from "../../shared/anim/pose.ts";
import { FISTS, SWING_TICKS } from "../../shared/sim/weapon.ts";
import { handleIndex } from "../../shared/ids.ts";
import { VehiclePlacement } from "./vehicle-placement.ts";
import { SeatedAim } from "./seated-aim.ts";
import { SeatNotice, type Ridden } from "./seat-notice.ts";
import { Lasers } from "./render/laser.ts";
import { Viewpoint } from "./viewpoint.ts";
import { Orbit } from "./orbit.ts";
import { CLOSED_BAD_CONTENT, CLOSED_BAD_VERSION, RemoteSample, type ClientSession } from "./session.ts";
import { Builder, GHOST_BAD, GHOST_OK } from "./build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { VoicePort } from "./voice/port.ts";
import { Heard } from "./voice/heard.ts";
import { Dash } from "./hud/vehicle.ts";
import { MODE_TALK, MODE_WHISPER, MODE_YELL } from "../../shared/voice/packet.ts";
import type { SoundSink } from "./sound/packet.ts";
import type { Sounds } from "./sound/sounds.ts";
import type { SoundDecoder } from "./sound/library.ts";
import type { MusicTrack } from "./sound/music.ts";
import { SkyClock } from "./sky.ts";
import type { SoundCode } from "./sound-late.ts";
import { SplitPort } from "./sound/split.ts";

import { IMAGE_MAP, IMAGE_MINIMAP, KEY_HOTBAR, KEY_MINIMAP_TOGGLE, KEY_MINIMAP_OUT, KEY_MINIMAP_IN, KEY_VITAL } from "./ui/hud.ts";
import { canvasHeight, textWidth, wrapText } from "./ui/nodes.ts";
import { glass } from "./ui/skin.ts";
import { TouchPlay, type TouchTarget } from "./touch.ts";
import { mapPointer } from "./ui/screens.ts";
import { Ui } from "./ui/ui.ts";
import { TRAVEL_REFRESH_MS } from "./ui/travel.ts";
import { arrivalAddress, joinAddress, serverAddress, siteLinks, type ClusterList, type Page } from "./travel.ts";

/** What hands round a creature cannot do, so a body holding one neither sends nor predicts them (server/carry.ts). */
const HANDS_FULL = BTN_PRIMARY | BTN_MELEE | BTN_RELOAD | BTN_PRONE;

/** No effect turned off: the game's own frame. */
const NO_EFFECTS: ReadonlySet<Effect> = new Set();

export class App {
  readonly session: ClientSession;
  readonly controls = new Controls();
  readonly ui = new Ui();
  readonly cam = new Camera();
  readonly hud = new HudModel();
  /** What the HUD's widgets fill from (hud/widget.ts): made once, set each frame. */
  private readonly hudFill = new HudFill();
  /** The frame's values and its parts in their order (frame.ts): made once, the values set each frame. */
  private readonly f: AppFrame;
  private parts: readonly FramePart[];
  /** The hour the sky shows: the server's, swept when it is set, or the one in an admin's hand on the sundial. */
  readonly sky = new SkyClock();
  /** The dash's readings of the vehicle driven, which its part of the frame reads (hud/vehicle.ts). */
  private readonly dash = new Dash();
  /** Tells the voice port where each speaker is (voice/heard.ts). */
  private readonly heard = new Heard();
  get vehicleTelemetry(): VehicleTelemetry { return this.dash.telemetry; }
  readonly feedback = new Feedback();
  /** Laser dots this frame (client/core/render/laser.ts). */
  readonly lasers = new Lasers();
  private readonly shotSample = new RemoteSample();
  readonly shots: Shots;
  readonly supply: SupplyView;
  /** Dust, chips and sounds for what breaks, a cell of pieces at a time (break-effects.ts). */
  readonly breaks: BreakEffects;
  /** Null until the world arrives. */
  falling: Falling | null = null;
  private swapsHeard = false;
  /** The aim and any sight raised: a scope, the spyglass, a helmet's visor (sight.ts). What the keys' rows and the tests read of it is forwarded. */
  readonly sight = new Sight();
  /** A launched drone's camera feed while it is flown (air-feed.ts). */
  readonly feed = new AirFeed();
  get visor(): Visor { return this.sight.visor; }
  get glass(): Glass { return this.sight.glass; }
  get visorOptic(): OpticFacet | null { return this.sight.visorOptic; }
  set visorOptic(optic: OpticFacet | null) { this.sight.visorOptic = optic; }
  get sightZoom(): number { return this.sight.sightZoom; }
  set sightZoom(zoom: number) { this.sight.sightZoom = zoom; }
  get sightZero(): number { return this.sight.sightZero; }
  set sightZero(metres: number) { this.sight.sightZero = metres; }
  get nDownAt(): number { return this.sight.nDownAt; }
  set nDownAt(at: number) { this.sight.nDownAt = at; }
  get nLong(): boolean { return this.sight.nLong; }
  set nLong(on: boolean) { this.sight.nLong = on; }
  get nPulse(): number { return this.sight.nPulse; }
  set nPulse(frames: number) { this.sight.nPulse = frames; }
  readonly remote = new RemoteSample();
  /**
   * Who the camera follows and from where (view/director.ts). The view, the orbit camera on K and what the tests and
   * the debug bar read of them are forwarded.
   */
  readonly director = new Director();
  /** The view of the own survivor knocked down or dying, and the red and black over it. */
  readonly fallen = new FallenView();
  get view(): Viewpoint { return this.director.view; }
  get orbit(): Orbit { return this.director.orbit; }
  get orbitFree(): boolean { return this.director.orbitFree; }
  get wasOnFoot(): boolean { return this.director.wasOnFoot; }
  protected get eye(): number { return this.director.eye; }
  protected get body(): OwnBody { return this.director.own; }
  scene: Scene | null = null;
  /** Show the asset library's state on the status line. */
  debug = false;
  /** The manifest and the asset port the scene is made with once the session has a world. */
  stream: { manifest: Manifest; port: AssetPort } | undefined;
  /** The asset port shared with the sounds, once there is a scene and a device to play on. */
  private split: SplitPort | null = null;
  /** Smoothed. */
  fps = 60;
  /** What a page that measures asks of the frame (tool-hooks.ts): null in the game, made when a tool first asks. */
  private tools: ToolHooks | null = null;
  /** Keeps the frame steady under the tier chosen (governor.ts). The shell tells it what each frame took. */
  readonly governor = new Governor();
  /** What each frame took and what came in it (assets/frames.ts), once the shell has fetched it. */
  frames: FrameRing | null = null;
  /** The textures the card makes (texgen/engine.ts), once their file has come: how far they have come up, which the shell draws them by. */
  texgen: import("./texgen/engine.ts").Texgen | null = null;
  /** The world's sounds' code (sound-late.ts), which comes after the first frame, as the sounds' rows do (D1107). */
  static late: SoundCode | null = null;
  private soundAsked = false;
  /** What fetches the debug bar's part that needs the browser, which the shell sets (client/debug/debug-port.ts). */
  debugPort: (() => Promise<DebugPort>) | null = null;
  private debugAsked = false;
  /**
   * Whether the card has linked every program a tier draws with, beginning those it has not (the shell's `ready`). A
   * tier chosen or stepped to is drawn once it has, and the one before until then; null draws it at once.
   */
  tierReady: ((tier: Tier) => boolean) | null = null;
  /** The tier chosen whose governor's steps are begun, those still to begin, a step a frame, and whether a tier was drawn yet. */
  private warmedBase: Tier | null = null;
  private readonly warming: Tier[] = [];
  private tierShown = false;
  /** The screen's device pixels a CSS pixel. */
  dpr = 1;
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
  private readonly dir = [0, 0, 0];

  /** The session's registry. It is content as written until the welcome, then as the server tuned it. */
  get reg(): Registry {
    return this.session.registry;
  }

  /** With `stream`, `pack` is the boot pack and other levels are fetched through the port as they are wanted. */
  constructor(session: ClientSession, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort }) {
    this.stream = stream;
    this.session = session;
    this.shown = reg;
    this.pack = pack;
    this.f = new AppFrame(session, this.controls, this.ui, this.hud, this.cam, this.remote, pack, this.sky, this.director.view, this.lasers, new SeatedAim(reg, pack));
    this.f.feed = this.feed.shown;
    this.prompts = new Prompts(reg, this.builder, this.vehiclePlacement);
    session.shotOrigin = (out, tick, yaw, pitch) => {
      if (!session.world || session.driving >= 0 || !session.own.seat) return false;
      session.sampleRemote(this.shotSample);
      return this.f.seatEye(session.world, this.shotSample, tick, yaw, pitch, out, true, tick);
    };
    this.ui.registry = reg;
    this.ui.palette = pack.palette;
    this.ui.touchPlay = this.touch;
    const app = this;
    this.padTarget = {
      get inMenu() { return !app.ui.wantsPointerLock; },
      get inspecting() { return app.ui.inspect; },
      get flying() { return app.controls.onFlyer; },
      get skating() { return app.controls.onBoard; },
      get airRadio() { return app.ui.air.available(app.session); },
      get airMarking() { return app.ui.air.marking; },
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
    this.ui.local = (line) => this.debugWord(line) ?? (this.sounds ? App.late!.soundCommand(line, this.sounds, this.session.own, this.controls.yaw, this.nowMs) : null);
    this.ui.chat.local = (line) => this.debugWord(line);
    // The inventory pictures the build drew, fetched as they are first shown.
    if (stream?.manifest.icons) new Icons(stream.manifest, reg.defs).install(this.ui.frame);
    // The Storage tab's page comes as its own file, which the first frame does not wait for, and draws with these (D906).
    void import("./ui/storage.ts").then((m) => (this.ui.storage = new m.StoragePage({ textWidth, wrapText, glass })), () => {});
    this.shots = new Shots(reg, pack);
    this.supply = new SupplyView(reg, pack);
    this.breaks = new BreakEffects(reg, pack.palette);
    // Whoever else follows structure rows adds itself the same way; each is told in the order it was added.
    hearStructures(session, (was, kind, x, y, z, hpWas, hp) => this.breaks.row(this.reg, session.serverTick, was, kind, x, y, z, hpWas, hp));
    const nodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
    session.onNode = (chunk, index, used, crushed, priorForm) => {
      const field = session.nodeField;
      if (!used || !crushed || !field || !this.scene) return;
      const ref = chunk * 65536 + index;
      if (session.predictedTrees?.hidden(ref)) return;
      field.source.at(chunk, index, nodeSpot);
      if (Math.hypot(nodeSpot.x - session.own.x, nodeSpot.y - session.own.y, nodeSpot.z - session.own.z) > 64) return;
      const form = priorForm || nodeSpot.form;
      this.scene.treeFalls.add({ action: "break", ref, kind: nodeSpot.kind, form, x: nodeSpot.x, y: nodeSpot.y, z: nodeSpot.z, yaw: nodeSpot.yaw, dx: nodeSpot.x - session.own.x, dz: nodeSpot.z - session.own.z, tick: session.serverTick }, this.scene.now);
      this.scene.details.nodeBreak(nodeSpot.kind, chunk * 256 + index, nodeSpot.x, nodeSpot.y, nodeSpot.z,
        session.renderClock - session.remoteDelay, field.forms.size[form]! / 64);
    };
    this.ui.inventory.onDeploy = slot => this.vehiclePlacement.begin(slot);
    session.onResult = (seq, code) => {
      this.ui.air.result(seq, code, session.tickClock);
      this.ui.creator.result(seq, code === RESULT_OK);
      this.ui.inventory.result(seq, code, session.tickClock);
      this.builder.result(seq, code, this.nowMs);
      this.vehiclePlacement.result(seq, code, this.nowMs);
      // An unasked result answers the last press of the use key: on a seat it is the seat's, else the built piece's.
      if (!this.seatNotice.result(seq, code, this.nowMs)) this.ui.structure.result(seq, code, this.nowMs, this.session, this.aimed);
      this.ui.emotes.result(seq, code, this.nowMs);
      if (code === RESULT_LOCKED) this.ui.hear?.("door/locked");
    };
    this.parts = this.listed();
  }

  readonly builder = new Builder();
  readonly vehiclePlacement = new VehiclePlacement();
  /** What the use key would act on, and the words that say so (prompts.ts). */
  readonly prompts: Prompts;
  /** The page, for travel between the servers of a cluster. The shell sets it; without one nobody travels. */
  page: Page | null = null;
  /** The page is on its way to another server, or has said it arrived. */
  private leaving = false;
  private arrived = false;
  /** The travel list was opened for a survivor turned away. */
  private turnedAway = false;
  /** Time of the last frame. */
  nowMs = 0;
  /** Entity index of the creature in the arms of the viewer's own body, as the last frame's remote sample says, or -1. */
  holding = -1;

  /** What the prompts keep of the use key and of what the look is on, for the keys' rows and the tests (prompts.ts). */
  get lookedAt(): number { return this.prompts.lookedAt; }
  get aimedBoat(): number { return this.prompts.aimedBoat; }
  get target(): number { return this.prompts.target; }
  get aimed(): number { return this.prompts.aimed; }
  set aimed(at: number) { this.prompts.aimed = at; }
  get eggAimed(): number { return this.prompts.eggAimed; }
  set eggAimed(at: number) { this.prompts.eggAimed = at; }
  get terminalAimed(): number { return this.prompts.terminalAimed; }
  set terminalAimed(at: number) { this.prompts.terminalAimed = at; }
  get seatNotice(): SeatNotice { return this.prompts.seatNotice; }
  get useDownAt(): number { return this.prompts.useDownAt; }
  set useDownAt(at: number) { this.prompts.useDownAt = at; }
  get useKept(): boolean { return this.prompts.useKept; }
  set useKept(on: boolean) { this.prompts.useKept = on; }
  get usePulse(): number { return this.prompts.usePulse; }
  set usePulse(frames: number) { this.prompts.usePulse = frames; }
  get eggKept(): boolean { return this.prompts.eggKept; }
  set eggKept(on: boolean) { this.prompts.eggKept = on; }
  /** What a press of the use key now would get into or out of: the seat the session is in, or what the prompt is on. */
  seatPress(): Ridden | null { return this.prompts.seatPress(this.session, this.remote); }
  /** The look as the prompts last cast it, and how far along it body `i` is met: the debug bar's (assets/look.ts). */
  protected get aim(): readonly number[] { return this.prompts.aim; }
  protected lookHit(i: number, ox: number, oy: number, oz: number, use = false): number { return this.prompts.lookHit(this.f, i, ox, oy, oz, use); }

  voice: VoicePort | null = null;
  /** Plays the world's sounds. Null in tests and wherever there is no audio: then no sound work is done at all. */
  sound: SoundSink | null = null;
  /** Made with the scene, where there is a sink and the assets stream. */
  sounds: Sounds | null = null;
  /** Decodes sounds off the main thread: the browser's worker, set before the first frame. Null decodes inline. */
  soundDecoder: SoundDecoder | null = null;
  /** The music tracks the build lists (assets/music/music.json), once fetched; null for none. */
  musicTracks: readonly MusicTrack[] | null = null;
  /** The volumes the sounds play at, as the settings have them this frame. */
  private readonly volumes = { master: 0, effects: 0, ambience: 0, music: 0, interface: 0 };
  /** Tames already heard of the session's queue, which the naming prompt empties. */
  private tamedHeard = 0;
  talking = false;
  private talkMode = MODE_TALK;
  /** With the talk key, Alt whispers and Shift yells. */
  alt = false;
  shift = false;

  talk(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.talkMode = this.alt ? MODE_WHISPER : this.shift ? MODE_YELL : MODE_TALK;
    this.voice?.talk(on, this.talkMode, this.ui.settings.toggleTalk);
  }

  /** Returns true if the page should not also act on the key. The rows of keys.ts say what each key does, first row first. */
  key(code: string, down: boolean, repeat = false, source = 0): boolean {
    if (down && !repeat) this.ui.inputDevice = source;
    return pressKey(KEY_ROWS, this, code, down, repeat, source);
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
    if (this.ui.wantsPointerLock) this.director.look(this.f, dx, dy);
  }

  /** Whether a raised sight takes zoom steps: a scope that zooms, a glass, a visor. */
  get zooming(): boolean {
    return this.sight.zooming || this.session.airFeed.active;
  }

  /** The mouse wheel's `deltaY` in pixels, lines or pages (`mode` 0, 1 or 2), as a browser gives it. True when it was used. */
  wheel(deltaY: number, mode = 0): boolean {
    if (!this.ui.wantsPointerLock) return false;
    const notches = mode === 1 ? deltaY / 3 : mode === 2 ? deltaY : deltaY / 100;
    return this.zoomBy(notches) || this.orbit.wheel(notches);
  }

  /** `notches` of zoom to the raised sight, down (positive) to widen: the wheel's, a pad's d-pad's, a finger's. True when one took them. */
  zoomBy(notches: number, alt = this.alt): boolean {
    if (this.session.airFeed.active) {
      this.feed.wheel(notches);
      return true;
    }
    return this.sight.zoomBy(notches, alt);
  }

  blur(): void {
    this.controls.release();
    this.touch.reset();
    this.prompts.release();
    this.alt = this.shift = false;
    if (!this.ui.settings.toggleTalk) this.talk(false);
  }

  /**
   * A measurement run's steering, `ms` into its measured frames, the view held below 0; and the run's clock `run`, which
   * the scene's timers follow from the frame before it begins, in place of the page's (tool-hooks.ts).
   */
  autopilot(ms: number, run = -1): void {
    if (run >= 0 || this.tools) this.tooled().run(run, this.last);
    autopilot(this.controls, ms);
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
    if (this.ui.menu || this.ui.air.open) this.blur();
  }

  zoomMini(turn: number): void {
    const chart = this.hud.chart;
    if (!chart) return;
    chart.key(turn > 0 ? "Equal" : "Minus", true, false);
    this.ui.settings.minimapZoom = chart.miniZoom;
    this.ui.settings.changed();
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
    c.skate(s.sessionState === SESSION_ALIVE && s.driving >= 0 && isSkateboard(this.reg.vehicle[s.own.kind]));
    c.thrusterCar(s.sessionState === SESSION_ALIVE && s.driving >= 0 && thrustersOf(this.reg.vehicle[s.own.kind]) !== undefined);
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

  /**
   * What the page's address asks of the frame (ToolHooks.address): effects off, and for a page that measures or is a
   * tool's look, its tier, volume, lines and view. An ordinary page's address asks nothing, and no hook is made for it.
   */
  address(get: (name: string) => string | null, pinned: boolean, orders: ToolOrders | null = null): void {
    if (pinned || get("off") !== null || get("ab") !== null || this.tools) this.tooled().address(get, pinned, orders, this.governor, this.ui.settings);
  }

  /** The tools' hooks, made and given their rows in the frame the first time one is asked for. */
  private tooled(): ToolHooks {
    if (!this.tools) {
      this.tools = new ToolHooks(this.supply);
      this.parts = this.listed();
    }
    return this.tools;
  }

  /** A tool's settings, which stand on its hooks (tool-hooks.ts). One left as the game has it makes no hooks. */
  get stress(): boolean { return this.tools?.stress ?? false; }
  set stress(on: boolean) { if (on || this.tools) this.tooled().stress = on; }
  get marks(): Mark[] { return this.tools?.marks ?? []; }
  get steer(): boolean { return this.tools?.steer ?? true; }
  set steer(on: boolean) { if (!on || this.tools) this.tooled().steer = on; }
  get plainSky(): boolean { return this.tools?.plainSky ?? false; }
  set plainSky(on: boolean) { if (on || this.tools) this.tooled().plainSky = on; }
  get fromEye(): boolean { return this.tools?.fromEye ?? false; }
  set fromEye(on: boolean) { if (on || this.tools) this.tooled().fromEye = on; }
  get off(): ReadonlySet<Effect> { return this.tools?.off ?? NO_EFFECTS; }
  set off(off: ReadonlySet<Effect>) { if (off.size > 0 || this.tools) this.tooled().off = off; }
  /** The obelisks' clock a picture tool holds, null for none; and a film's frame holding it at `seconds` (tool-hooks.ts). */
  get eyeHeld(): number | null { return this.tools?.eyeHeld ?? null; }
  holdEye(seconds: number): void { this.tooled().holdEye(seconds); }
  /** A picture tool's view held at `yaw` and `pitch` (tool-hooks.ts). */
  holdLook(yaw: number, pitch: number): void { this.tooled().holdLook(yaw, pitch); }

  /**
   * After the frame is handed to WebGL: our code took `ours` ms of it, `uploadMs` of them handing the assets' bytes to
   * the card and `buildMs` in frame(), on a canvas of `width` by `height` device pixels.
   */
  drawn(packet: FramePacket, ours: number, width = 0, height = 0, uploadMs = 0, buildMs = 0): void {
    this.frames?.record(this.nowMs, this.interval, ours, uploadMs, this.scene?.assets.residency ?? null, this.sounds?.library ?? null);
    // The debug bar's picture is the canvas as just drawn, and its record takes the row above (debug/debug.ts).
    this.ui.debug?.drawn(packet, ours, width, height, uploadMs, buildMs);
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

  /**
   * Where the shell's frame was on the page's clock, which the shell writes each frame for the debug bar (debug/spans.ts
   * SpanRing.close): its start, just before frame(), just after it, once the interface is applied, and once it is drawn.
   */
  readonly shellMarks = new Float64Array(5);
  /** What times the frame while the debug bar is on, and the slots of the app's own spans. */
  private timer: Probe | null = null;
  private readonly spans = { app: -1, measure: -1, turn: -1, update: -1, sample: -1, build: -1 };

  /**
   * What times the frame while the debug bar is on (debug/spans.ts): measure, turn and each part under "app", and the
   * scene's build under the part "build". Null, as in the game, runs the parts as rows() has them, with no wrappers.
   */
  get probe(): Probe | null {
    return this.timer;
  }
  set probe(probe: Probe | null) {
    this.timer = probe;
    const s = this.spans;
    if (probe) {
      s.app = probe.slot("app", probe.slot("frame", -1));
      s.measure = probe.slot("measure", s.app);
      s.turn = probe.slot("turn", s.app);
      s.update = probe.slot("update", s.turn);
      s.sample = probe.slot("sample", s.turn);
      s.build = probe.slot("build", s.app);
    }
    this.parts = this.listed();
    this.scene?.time(probe, s.build);
  }

  /** While the frame is timed: `slot` ran from `from` until now. Returns now, or 0 untimed. */
  private lap(slot: number, from: number): number {
    const probe = this.timer;
    if (!probe) return 0;
    const now = probe.now();
    probe.add(slot, from, now);
    return now;
  }

  /** Returns what to draw in the world, or null until the world has arrived. `ui.frame` is always ready. */
  frame(nowMs: number, width: number, height: number): FramePacket | null {
    const f = this.f, probe = this.timer, from = probe ? probe.now() : 0;
    probe?.begin(this.shellMarks[0] || from);
    this.measure(f, nowMs, width, height);
    const measured = this.lap(this.spans.measure, from), turned = this.turn(f);
    this.lap(this.spans.turn, measured);
    const parts = this.parts;
    if (turned) for (let i = 0; i < parts.length; i++) parts[i]!.step(f);
    this.lap(this.spans.app, from);
    return turned ? f.packet : null;
  }

  /** The frame's parts in rows()'s order, each timed by its name while the debug bar's probe is on. */
  private listed(): FramePart[] {
    const rows = this.rows();
    return this.timer ? this.timer.parts(rows, this.spans.app) : rows.map((r) => r[1]);
  }

  /**
   * The frame's parts, once the session has had its turn and there is a world, each by the name the debug bar times it
   * by. A part's place here is its place in the frame. A new part is a file of its own and a line here. The rows written
   * out here are the app's own still.
   */
  private rows(): PartRow[] {
    const tools = this.tools;
    return [
      // A tool's lines are typed and its look held before anything reads the look.
      ...(tools ? [["tool lines", tools.lines] as const] : []),
      // The camera's subject and its view; the instruments of a vehicle driven, whose speed widens the view; the aim and any sight.
      ["director", this.director],
      ["dash", this.dash],
      ["sight", this.sight],
      // With the view decided: the own body as it is drawn, then the camera placed.
      ["body", this.director.body],
      ["fallen", this.fallen],
      ["place", this.director.place],
      // A drone flown: its feed's zoom, view and interference, over the camera placed at it.
      ["feed", this.feed],
      // What the session brought is handed to what draws it, and the frame is built at the tier chosen.
      ["absorb", { step: (f) => this.absorb(f) }],
      ...(tools ? [["tool stage", tools.stage] as const] : []),
      ["build", { step: (f) => this.build(f) }],
      ...(tools ? [["tool finish", tools.finish] as const] : []),
      ["sound", this.guarded("sound", { step: (f) => this.hear(f) })],
      ["ghost", { step: (f) => this.ghost(f) }],
      // What the use key is on, and the voice port told where speakers are. Then the HUD, which reads all of the above.
      ["prompts", this.guarded("prompts", this.prompts)],
      ["voice", this.guarded("voice", this.heard)],
      ["hud", this.guarded("hud", { step: (f) => this.fillHud(f) })],
      ["interface", { step: (f) => this.interface(f) }],
    ];
  }

  /** The frame's time and window, the interface's canvas for it, and the modules a setting first asks for. */
  private measure(f: AppFrame, nowMs: number, width: number, height: number): void {
    const dt = this.last < 0 ? 16 : nowMs - this.last;
    this.interval = this.last < 0 ? 0 : dt;
    this.last = nowMs;
    this.frames?.target.frame(this.interval);
    this.fps += (1000 / Math.max(dt, 1) - this.fps) * 0.05;
    f.nowMs = nowMs;
    f.sceneMs = this.tools ? this.tools.sceneMs(nowMs) : nowMs;
    f.dt = dt;
    f.width = width;
    f.height = height;
    f.aspect = width / Math.max(height, 1);
    f.steer = this.steer;
    f.fromEye = this.fromEye;
    f.voice = this.voice;
    f.talking = this.talking;
    f.talkMode = this.talkMode;
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
    this.nowMs = nowMs;
    // The debug bar is a file of its own, fetched once Settings.debug is first on.
    if (ui.settings.debug && !this.debugAsked) {
      this.debugAsked = true;
      void import("./debug/debug.ts").then((m) => (ui.debug = new m.DebugBar(this)), () => (this.debugAsked = false));
    }
  }

  /**
   * The session's turn: the keys' pulses and meanings, the input sent and the own body predicted, the others sampled.
   * False until there is a world, and once the session has closed: then the interface is built and nothing is drawn.
   */
  private turn(f: AppFrame): boolean {
    const session = this.session, hud = this.hud, c = this.controls, nowMs = f.nowMs;
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
      this.dash.none(hud);
      // Only the reasons a player can act on are spelled out.
      // A page the server sent to wait, or one that lost it, says so: it comes back by itself (waiting.ts).
      hud.status = session.waiting !== "" ? session.waiting : session.leaving ? "The server is restarting. One moment." : session.lost ? "The server went away. Waiting for it to come back." : session.travelled ? "travelling to another server" : session.closeReason === REJECT_TRAVEL ? `turned away: ${session.closeText}` : session.closeReason === REJECT_FULL ? "turned away: this server is full" : session.closeReason === REJECT_PASSWORD ? "disconnected: this server asks a password, and that was not it" : session.closeReason === CLOSED_BAD_CONTENT ? "disconnected: this client's content is not this server's" : session.closeReason === REJECT_VERSION || session.closeReason === CLOSED_BAD_VERSION ? "disconnected: this page is not the server's version; reload it" : `disconnected (reason ${session.closeReason})`;
      this.ui.build(f.aspect, hud, session);
      if (this.sound) this.sounds?.hush(this.sound);
      return false;
    }
    if (this.ui.menu || this.ui.inspect) this.blur();
    this.prompts.pulse(c);
    this.sight.hold(nowMs, c);
    f.holding = this.holding = this.heldInArms();
    const flyer = this.flyerKeys();
    f.airFrom = this.airFrom;
    this.director.airControls(f);
    if (!session.airCamera.id) this.director.cockpitNow(f);
    const updating = this.timer ? this.timer.now() : 0;
    if (f.steer) session.update(nowMs, c.moveX, c.moveZ, c.yaw, c.pitch, this.sight.buttons(this.holding >= 0 ? c.buttons & ~HANDS_FULL : c.buttons));
    else session.update(nowMs, 0, 0, c.yaw, c.pitch, 0);
    this.lap(this.spans.update, updating);
    // Once a tick has stepped with its jump held, a flyer not in the air came down or would not go up.
    if (flyer && c.wing && session.simTick > this.wingFrom && session.own.mode !== MODE_FLYER) c.land();
    const world = session.world;
    if (session.state !== "active" || !world) {
      this.dash.none(hud);
      hud.status = "connecting";
      this.ui.build(f.aspect, hud, session);
      if (this.sound) this.sounds?.hush(this.sound);
      return false;
    }
    f.world = world;
    this.arrive(f, world);
    return true;
  }

  /** With a world: the scene made for it once, the sounds once their code has come, and the others sampled for the frame. */
  private arrive(f: AppFrame, world: NonNullable<ClientSession["world"]>): void {
    const session = this.session, hud = this.hud;
    if (this.shown !== session.registry) {
      this.shown = session.registry;
      f.seatedAim = new SeatedAim(this.shown, this.pack);
      this.ui.registry = this.shown;
      this.shots.reg = this.shown;
    }
    if (!this.scene) {
      // Sounds share the asset port, each side taking only what it asked for.
      this.split = this.sound && this.stream ? new SplitPort(this.stream.port) : null;
      this.scene = new Scene(world, this.reg, this.pack, this.split ? { manifest: this.stream!.manifest, port: this.split.assets } : this.stream, { farPalms: this.tools?.farPalms ?? false });
      this.scene.shots = this.shots;
      this.scene.supply = this.supply;
      this.ui.emotes.has = (n) => this.scene!.characters.emoteKnown(n);
      this.tools?.dress(this.scene, world);
      if (this.timer) this.scene.time(this.timer, this.spans.build);
      this.falling = this.scene.falling = new Falling(this.reg.halfY, (x, z) => world.hf.heightAt(x, z), {
        reg: this.reg,
        floorUnder: (x, y, z) => (castWorld(world, x, y, z, 0, -1, 0, 512, true) === HIT_NONE ? world.hf.heightAt(x, z) : y - rayHit.t),
        structs: world.structs,
        mapKind: (chunk, slot) => session.mapKind(chunk, slot),
      });
      // A city piece taking a form in place throws what leaves it.
      if (!this.swapsHeard) hearStructures(session, (was, kind, x, y, z, _hpWas, _hp, cause) => this.falling?.swap(was, kind, x, y, z, cause));
      this.swapsHeard = true;
      const chart = (hud.chart = new Chart(world.hf, this.pack.palette));
      this.ui.frame.images[IMAGE_MINIMAP] = chart.mini.image;
      this.ui.frame.images[IMAGE_MAP] = chart.full.image;
    }
    const scene = (f.scene = this.scene);
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
    const strike = session.strike;
    session.strike = null;
    if (strike && session.sessionState === SESSION_ALIVE && !session.airCamera.id && session.driving < 0) {
      // After this swing's recovery an old hit would kick the next swing.
      if (session.tickClock - strike.tick < SWING_TICKS - FISTS.strikeTick && this.ui.settings.viewKick) this.sight.struck(f.nowMs);
      if (strike.node && session.serverTick - strike.tick < SWING_TICKS) {
        scene.details.nodeStrike(strike.node, strike.x, strike.y, strike.z, strike.tick, session.renderClock - session.remoteDelay);
        this.sounds?.build.nodeStrike(strike.node, strike.x, strike.y, strike.z);
      }
    }
    const trees = session.predictedTrees;
    if (trees) for (const event of trees.present()) {
      scene.hideNode(event.ref, event.action === "break");
      scene.treeFalls.add(event, f.sceneMs);
      if (event.action === "break") {
        const size = session.nodeField!.forms.size[event.form]! / 64;
        scene.details.nodeBreak(event.kind, event.ref, event.x, event.y, event.z, session.renderClock - session.remoteDelay, size);
        this.sounds?.build.treeImpact(event.kind, event.x, event.y, event.z);
      }
    }
    hud.status = this.debug ? `${scene.assets.line()}${this.sounds ? `; ${this.sounds.line()}` : ""}` : "";
    // Sampled before the camera, which puts a passenger in its seat on the vehicle as it is drawn.
    const sampling = this.timer ? this.timer.now() : 0;
    session.sampleRemote(this.remote);
    this.lap(this.spans.sample, sampling);
  }

  /** What the session brought this frame is handed to what draws it, and the scene is told the time. */
  private absorb(f: AppFrame): void {
    const session = this.session, hud = this.hud, cam = this.cam, world = f.world, scene = f.scene, sceneMs = f.sceneMs;
    // Sound takes its copy of the shots, hits and tames before the tracers and hit marks use them up.
    this.sounds?.absorb(session.events, session.fired, Math.max(0, session.tamed.length - this.tamedHeard));
    this.tamedHeard = session.tamed.length;
    this.shots.absorb(session, world, sceneMs);
    this.shots.step(world, this.remote, session.tickClock, sceneMs);
    scene.shotTick = session.tickClock;
    // Blows that landed on bodies near: each is drawn snapping back where it was struck (render/impact-springs.ts).
    if (session.impacts.length > 0) {
      const r = this.remote, own = handleIndex(session.ownHandle), ch = scene.characters;
      for (const im of session.impacts) {
        if (im.id === own) ch.impact(session.ownKind, own, f.body.yaw, im.bone, im.dx, im.dy, im.dz, im.strength);
        else for (let j = 0; j < r.count; j++) if (r.id[j] === im.id) { ch.impact(r.kind[j]!, im.id, r.yaw[j]!, im.bone, im.dx, im.dy, im.dz, im.strength); break; }
      }
      session.impacts.length = 0;
    }
    this.ui.air.update(session, this.remote, world, cam);
    scene.airSupport.preview = this.ui.air.marking ? this.ui.air.spot : null;
    scene.airSupport.view = session.airSupport;
    scene.airSupport.tick = session.tickClock;
    this.supply.list = session.supply;
    this.supply.tick = session.tickClock;
    this.breaks.take(session.rubble);
    // A building about to come down is heard where it gave, as a collapse's rumble is.
    for (const gave of session.groans) this.sounds?.build.breaking(HEARD_RUMBLE, 0, gave.x, gave.y, gave.z, 0.5);
    session.groans.length = 0;
    this.breaks.flush(scene.details, scene.assets.tier, session.renderClock - session.remoteDelay, cam.x, cam.y, cam.z, this.sounds?.build ?? null, this.sight);
    // Fragments count from their break's tick by the clock this client hears the server's ticks on.
    this.falling!.absorb(session.rubble, sceneMs, cam.x, cam.y, cam.z, session.renderClock);
    // Collapses told from afar: a column of dust over each (render/dust-columns.ts).
    for (const fell of session.collapses) scene.dust.add(fell, sceneMs);
    session.collapses.length = 0;
    this.falling!.step(sceneMs, session.renderClock);
    const beams = scene.beams;
    beams.length = 0;
    if (session.corpseLocator) for (const m of session.markers) if (m.kind === MARKER_DEATH) beams.push(m.x, m.y, m.z);
    hud.dpr = this.dpr;
    scene.hour = this.hud.hour = this.sky.step(session.serverTick, session.dayOffset, session.clock, this.interval, this.ui.creativeScreen.sundial.held, session.creative);
    scene.viewHeight = f.height;
    scene.now = sceneMs;
    scene.eyeSeconds = session.renderClock / TICK_RATE;
  }

  /** The tier the frame is drawn at and its canvas, what the session is asked to send for it, and the frame built. */
  private build(f: AppFrame): void {
    const session = this.session, scene = f.scene, nowMs = f.nowMs, width = f.width, height = f.height, tools = this.tools;
    scene.finishGloss = this.ui.settings.finishGloss;
    scene.roadFinish = this.ui.settings.roadFinish;
    scene.assets.residency.holdBack = this.session.behind;
    const chosen = forTouch(tierOf(this.ui.settings.tier), this.ui.settings.touchFirst);
    const governor = this.governor.tier(chosen, this.ui.settings.steady, this.dpr, nowMs), governed = tools ? tools.tier(governor) : governor;
    if (this.tierReady && chosen !== this.warmedBase) this.warming.splice(0, Infinity, ...ladder((this.warmedBase = chosen), this.dpr).map((l) => (tools ? tools.tier(l.tier) : l.tier)));
    if (this.tierReady && this.warming.length > 0) this.tierReady(this.warming.shift()!);
    if (!this.tierShown || governed === scene.assets.tier || !this.tierReady || this.tierReady(governed)) {
      scene.assets.tier = governed;
      this.tierShown = true;
    }
    const ratio = canvasRatio(scene.assets.tier, this.dpr, width, height);
    scene.canvasWidth = Math.floor(width * ratio);
    scene.canvasHeight = Math.floor(height * ratio);
    scene.supersampled = ratio > ownRatio(scene.assets.tier, this.dpr);
    // The scene's share is of the canvas the chosen tier draws at the screen's own pixels; the governor's steps take
    // their shares of it (governor.ts).
    const own = width * height * ownRatio(chosen, this.dpr) ** 2;
    scene.share = sceneShare(chosen, (tools ? tools.shareAsked : 0) || (RESOLUTIONS[this.ui.settings.resolution]?.share ?? 0), own);
    this.ui.settings.autoShare = sceneShare(chosen, 0, own);
    session.view(scene.assets.tier.view, this.ui.settings.snapshotBytes);
    // The map's own city is drawn to the end of the view, as blocks past the far city, so that is how far its pieces gone are asked for.
    session.askFar(scene.assets.tier.reach.bases, scene.assets.tier.reach.city > 0 ? scene.assets.tier.viewDistance : 0);
    session.holdNodes(scene.assets.tier.nodes.chunks);
    scene.characters.corpseMotions = session.corpseMotions;
    // Damage numbers are drawn with the world, where the server's rule and the reader's setting let them.
    scene.damage.enabled = session.damageNumbers && this.ui.settings.damageNumbers;
    scene.wants = this.texgen?.wants ?? null;
    f.packet = scene.build(this.cam, this.remote);
    session.requestCorpseMotions(scene.characters.corpseCheckpointRequests);
  }

  /**
   * The HUD, last before the interface is built: each widget fills its slice of the model from the session and from what
   * the parts before left in the frame (hud/widgets.ts). Hit marks and marks over creatures have fills of their own.
   */
  private fillHud(f: AppFrame): void {
    const session = this.session, hud = this.hud, cam = this.cam, c = this.controls, alive = f.alive, nowMs = f.nowMs;
    const fill = this.hudFill, body = f.body;
    f.menu = this.ui.menu; f.inCar = alive && !!f.car; f.rivalry = f.riding && body.state.rivalry && !body.state.out; f.building = this.builder.active;
    f.steady = this.governor.level > 0 ? ` (${this.governor.level} down: ${this.governor.name})` : "";
    fill.session = session; fill.remote = this.remote; fill.fps = this.fps; fill.scale = this.unit; fill.nowMs = nowMs; fill.frame = f;
    fillHud(hud, fill);
    this.feedback.absorb(session, this.reg, f.sceneMs, f.scene.damage);
    this.feedback.fill(hud.combat, cam, c.yaw, alive, f.sceneMs, session.hitMarkers);
    fillOverhead(hud.overhead, session, this.remote, cam, f.scene.characters, alive && !hud.out && !hud.feed ? f.eyeNow : -1, c.yaw, c.pitch, f.lookReach);
  }

  /** The sound device is told what to play. */
  private hear(f: AppFrame): void {
    const vol = this.ui.settings, scene = f.scene;
    if (this.sounds && this.musicTracks && !this.sounds.music) this.sounds.setMusic(this.musicTracks);
    if (this.sounds) this.sounds.assetsIdle = scene.assets.residency.flying === 0 && scene.assets.residency.waiting === 0;
    if (!this.sound || !this.sounds) return;
    const set = this.volumes;
    set.master = vol.muted ? 0 : vol.masterVolume; set.effects = vol.soundVolume; set.ambience = vol.ambienceVolume; set.music = vol.musicVolume; set.interface = vol.interfaceVolume;
    this.sounds.frame(this.sound, f.nowMs, this.remote, f.world.hf, this.cam, set, App.late!.soundView(this.session, this.sky), scene.characters.fallen);
  }

  /** The first fault each guarded part met, by its name. */
  readonly faults = new Map<string, string>();

  /**
   * A part that never changes what happens (sound, prompts, the HUD's fill): a fault in it is kept once by `name` and the
   * frame goes on without it, so it cannot stop the game being drawn.
   */
  private guarded(name: string, part: FramePart): FramePart & { readonly part: FramePart } {
    return {
      part,
      step: (f) => {
        try {
          part.step(f);
        } catch (e) {
          if (!this.faults.has(name)) this.faults.set(name, (e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)).slice(0, 2000));
        }
      },
    };
  }

  /** A piece in hand, or a vehicle to set down, is tried where the look is on, and drawn there from the next frame. */
  private ghost(f: AppFrame): void {
    const session = this.session, c = this.controls, world = f.world, nowMs = f.nowMs, eyeNow = f.eyeNow;
    const ghost = f.scene.ghost;
    ghost.kind = 0;
    const b = this.builder, v = this.vehiclePlacement;
    if (f.alive && session.driving < 0) {
      lookDirection(Math.round((c.yaw / TAU) * 65536) & 0xffff, Math.round((c.pitch / (PI / 2)) * 16384), this.dir);
      b.update(session, world, this.reg, session.own.x, session.own.y + eyeNow, session.own.z, this.dir[0]!, this.dir[1]!, this.dir[2]!, c.yaw, nowMs);
      v.update(session, world, this.reg, session.own.x, session.own.y + eyeNow, session.own.z, this.dir[0]!, this.dir[1]!, this.dir[2]!, c.yaw, nowMs);
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
  }

  /** The interface is built over the HUD. */
  private interface(f: AppFrame): void {
    this.ui.build(f.aspect, this.hud, this.session);
  }

  /** The console's and chat's `debug`: the bar on or off; `debug save [words]` saves what it holds. Null for any other line. */
  private debugWord(line: string): string | null {
    if (line === "debug") return toggleDebug(this.ui.settings);
    const save = /^debug\s+save(?:\s+(.*))?$/s.exec(line);
    if (!save) return null;
    if (!this.ui.debug || !this.ui.settings.debug) return "the debug bar is off: /debug turns it on";
    return this.ui.debug.save(save[1] ?? "");
  }

}
