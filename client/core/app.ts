// One whole client without a browser. The shell owns the renderer, socket and DOM, forwards events
// here, and draws what frame() returns. Tests drive this class directly.

import { Icons } from "./assets/icons.ts";
import type { AssetPort } from "./assets/port.ts";
import { forTouch, tierOf } from "./assets/tiers.ts";
import { DRAW_TRIANGLES, Governor } from "./governor.ts";
import { BENCH_TURN_MS, effectsOff, packetWithout, tierWithout, type Effect } from "./passes.ts";
import { keptLine } from "./settings.ts";
import { stressThings, type Mark } from "./stress.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CARRY_THROW, CMD_CARRY, CMD_OPEN, CMD_ORDER, CMD_SELECT, CMD_TAKE, MARKER_DEATH, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_STAY, ORDER_YOURS, REJECT_PASSWORD, REJECT_VERSION, RESULT_OK, SESSION_ALIVE, SESSION_CREATING, RESULT_NO_SNAP, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { structName } from "./ui/structure.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { Controls } from "./controls.ts";
import { HudModel, fillAction, fillBuffs, fillHotbar, fillOverhead, updateHud } from "./hud.ts";
import { Chart } from "./tactical.ts";
import { Camera } from "./render/camera.ts";
import { SQUEEZE_MOST } from "./render/budget.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, bodySeed, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { Falling } from "./rubble.ts";
import { BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY } from "../../shared/sim/character.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { FISTS, HOLD_CARRY } from "../../shared/sim/weapon.ts";
import { AnimState, CUE_HELD, CUE_OUT } from "../../shared/anim/pose.ts";
import { handleIndex } from "../../shared/ids.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../../shared/sim/items.ts";
import { Viewpoint } from "./viewpoint.ts";
import { CLOSED_BAD_CONTENT, CLOSED_BAD_VERSION, RemoteSample, type ClientSession } from "./session.ts";
import { Builder, GHOST_BAD, GHOST_OK } from "./build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { waitWords } from "./ui/inventory.ts";
import { voicePan } from "./voice/place.ts";
import { HEAR_FIELDS, type VoicePort } from "./voice/port.ts";
import { MODE_TALK, MODE_WHISPER, MODE_YELL } from "../../shared/voice/packet.ts";

/** Indexed by MODE_*. */
const TALK_LABEL: readonly string[] = ["WHISPERING", "TALKING", "YELLING"];
import { IMAGE_MAP, IMAGE_MINIMAP } from "./ui/hud.ts";
import { CANVAS_HEIGHT } from "./ui/nodes.ts";
import { mapPointer } from "./ui/screens.ts";
import { Ui } from "./ui/ui.ts";

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

/** Initial vertical field of view, in radians. AIM_FOV and SCOPE_FOV multiply the player's setting while aiming. */
const BASE_FOV = 1.2217;
const AIM_FOV = 0.79;
const SCOPE_FOV = 0.25;

export class App {
  readonly session: ClientSession;
  readonly controls = new Controls();
  readonly ui = new Ui();
  readonly cam = new Camera();
  readonly hud = new HudModel();
  readonly feedback = new Feedback();
  readonly shots: Shots;
  /** Null until the world arrives. */
  falling: Falling | null = null;
  /** Eased toward what the held weapon and the aim button ask for. */
  private fov = BASE_FOV;
  readonly remote = new RemoteSample();
  readonly view = new Viewpoint();
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

  /** The registry last handed to the UI and shots. frame() swaps it when the session's changes. */
  private shown: Registry;
  private readonly pack: Pack;
  private last = -1;
  /** Eased eye height above the feet, or -1 before the first frame and while there is no living body. */
  private eye = -1;
  private readonly aim = [0, 0, 0];
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
    // The inventory pictures the build drew, fetched as they are first shown.
    if (stream?.manifest.icons) new Icons(stream.manifest, reg.defs).install(this.ui.frame);
    this.shots = new Shots(reg, pack);
    session.onResult = (seq, code) => {
      this.ui.creator.result(seq, code === RESULT_OK);
      this.builder.result(seq, code, this.nowMs);
      this.ui.structure.result(seq, code, this.nowMs, this.session, this.aimed);
    };
  }

  readonly builder = new Builder();
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
  private eggKept = false;

  voice: VoicePort | null = null;
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
  key(code: string, down: boolean, repeat = false): boolean {
    if (this.ui.key(code, down, repeat, this.session)) {
      // A screen that captures the keyboard releases the body's keys and a push-to-talk microphone.
      if (this.ui.captureKeyboard) {
        this.controls.release();
        if (!this.ui.settings.toggleTalk) this.talk(false);
      }
      return true;
    }
    if (this.ui.captureKeyboard) return false;
    if (this.builder.key(code, down, repeat, this.nowMs, this.reg)) return true;
    // Minus and Equal zoom the minimap, or the map while it is open, where the arrows move it.
    if (this.hud.chart?.key(code, down, this.ui.map)) return true;
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
      if (down && !repeat && which >= 0) this.session.command(CMD_OPEN, (w) => w.u32(which >>> 0));
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
    return this.controls.key(code, down);
  }

  mouseButton(button: number, down: boolean): void {
    if (!this.ui.wantsPointerLock) return;
    if (button === 0 && this.builder.active) {
      if (down) this.builder.place(this.session, this.reg);
      return;
    }
    // The button that would strike throws what is in the arms, where the body looks.
    if (button === 0 && down && this.holding >= 0) {
      this.session.command(CMD_CARRY, (w) => w.u8(CARRY_THROW));
      return;
    }
    this.controls.mouseButton(button, down);
  }

  look(dx: number, dy: number): void {
    if (this.ui.wantsPointerLock) this.controls.look(dx, dy);
  }

  blur(): void {
    this.controls.release();
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
    if (mapPointer(this.hud, kind, key, x, y)) return;
    this.ui.pointer(kind, key, x, y, button, this.session);
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

  /** Sets `aimed` to the player-built structure within ACT_REACH, and returns its name and health. */
  private builtAt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const d = this.aim;
    this.aimed = -1;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    if (castWorld(world, s.own.x, s.own.y + eye, s.own.z, d[0]!, d[1]!, d[2]!, ACT_REACH) !== HIT_STRUCTURE) return "";
    const ref = rayHit.ref;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    // Skip structures nobody built.
    if (this.reg.pieceItem[kind] === 0 || t.owner[ref & 0xffff] === 0) return "";
    this.aimed = ref;
    const mine = s.tribe.team !== 0 && t.owner[ref & 0xffff] === s.tribe.team;
    const usable = (this.reg.opens[kind] !== 0 || this.reg.structSlots[kind] !== 0) && rayHit.t <= REACH;
    return `${usable ? "E use  " : mine ? "hold E  " : ""}${structName(this.reg, kind)}  ${Math.ceil(t.hp[ref & 0xffff]!)}/${this.reg.maxHp[kind]}`;
  }

  /** Labels what the use button would act on, with the same ray the server casts. The server's answer is the one that counts. */
  private prompt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
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

  /** After the frame is handed to WebGL: our code took `ours` ms of it, and `timed` are earlier frames' GPU ms by pass, as they came back. */
  drawn(packet: FramePacket, ours: number, timed: readonly number[][]): void {
    for (const ms of timed) this.governor.timed(ms.reduce((a, b) => a + b, 0));
    const budget = this.scene?.budget;
    this.governor.frame(this.nowMs, this.interval, ours, packet.assetUploads.length + packet.texUploads.length > 0, packet.triangles + DRAW_TRIANGLES * packet.drawCount, budget && budget.squeeze < SQUEEZE_MOST ? budget.last.crowns : 0);
  }

  /** The shell says the graphics card ran out of memory or lost everything. On every third time the graphics tier falls by one. */
  pressure(): void {
    // What follows is the uploads of all that was lost, or of what failed, which are no reason to step.
    this.governor.pause(this.nowMs);
    if (!this.scene?.assets.pressure()) return;
    this.ui.settings.tier = this.scene.assets.tier.name;
    this.ui.chat.print(TEXT_NOTICE, `The graphics card keeps running out of memory, so the graphics setting is now ${this.ui.settings.tier}.`, this.session.serverTick);
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

    if (session.state === "closed") {
      // Only the reasons a player can act on are spelled out.
      hud.status = session.closeReason === REJECT_PASSWORD ? "disconnected: this server asks a password, and that was not it" : session.closeReason === CLOSED_BAD_CONTENT ? "disconnected: this client's content is not this server's" : session.closeReason === REJECT_VERSION || session.closeReason === CLOSED_BAD_VERSION ? "disconnected: this page is not the server's version; reload it" : `disconnected (reason ${session.closeReason})`;
      this.ui.build(aspect, hud, session);
      return null;
    }
    if (this.usePulse > 0) c.key("KeyE", --this.usePulse > 0);
    this.holding = this.heldInArms();
    if (this.steer) session.update(nowMs, c.moveX, c.moveZ, c.yaw, c.pitch, this.holding >= 0 ? c.buttons & ~HANDS_FULL : c.buttons);
    else session.update(nowMs, 0, 0, c.yaw, c.pitch, 0);
    const world = session.world;
    if (session.state !== "active" || !world) {
      hud.status = "connecting";
      this.ui.build(aspect, hud, session);
      return null;
    }
    if (this.shown !== session.registry) {
      this.shown = session.registry;
      this.ui.registry = this.shown;
      this.shots.reg = this.shown;
    }
    if (!this.scene) {
      this.scene = new Scene(world, this.reg, this.pack, this.stream);
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
    hud.status = this.debug ? this.scene.assets.line() : "";

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
    // A server rule can forbid third person. A rider still sees its mount from behind.
    if (!session.thirdPerson) this.view.thirdPerson = false;
    // A session without a living body looks from the eye.
    const third = this.view.thirdPerson;
    if (!alive) this.view.thirdPerson = false;
    else if (session.driving >= 0) this.view.thirdPerson = true;
    this.view.place(cam, world, bx, by + eye, bz, c.yaw, c.pitch);
    this.view.thirdPerson = third;
    cam.aspect = aspect;
    // Aiming narrows the view in proportion to the player's setting, more through a scope. The mouse slows to match.
    const settings = this.ui.settings;
    const base = (settings.fov * Math.PI) / 180;
    let want = base;
    const aimed = this.reg.weapon[session.own.held];
    if (alive && this.steer && (c.buttons & BTN_SECONDARY) !== 0 && aimed && aimed.clip > 0) {
      const inv = session.inventory;
      const fitted = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.attach[inv.hotbar + session.held]! : 0;
      want = base * ((this.reg.defs[fitted] as ItemDef | null)?.attachment === "scope" ? SCOPE_FOV : AIM_FOV);
    }
    this.fov += (want - this.fov) * Math.min(1, dt / 70);
    cam.fovY = this.fov;
    c.zoom = (this.fov / base) * settings.sensitivity;
    const body = this.body;
    body.kind = session.ownKind;
    body.x = bx;
    body.y = by;
    body.z = bz;
    body.yaw = c.yaw;
    body.tick = session.tickClock;
    body.firstPerson = !third;
    body.id = handleIndex(session.ownHandle);
    body.look = session.ownLook;
    const inv = session.inventory;
    body.gear.fill(0);
    if (inv && inv.hotbar >= 0) {
      if (session.held >= 0) body.gear[GEAR_HELD] = inv.item[inv.hotbar + session.held]!;
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
      body.yaw = (session.own.yaw / 65536) * TAU;
      body.firstPerson = false;
      body.id = session.driving;
      body.look = null;
      body.gear.fill(0);
      body.state.stance = 0;
      body.state.setMotion(session.own.vx, session.own.vz, body.yaw, 0);
      body.state.setAction(session.own.act, 0, session.simTick - session.own.actTicks);
      body.state.seed = bodySeed(body.id);
      // The mount's colours and cues come from its remote copy.
      body.colors.fill(0);
      body.state.unpackCue(0);
      const r = this.remote;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== session.driving) continue;
        body.colors.set(r.colors.subarray(i * 6, i * 6 + 6));
        body.state.unpackCue(r.cue[i]!);
      }
    }
    this.scene.skip = riding ? session.driving : -1;
    this.scene.own = (alive && session.ownHandle !== 0 && session.driving < 0) || riding ? body : null;
    if (session.sessionState === SESSION_CREATING) this.preview(nowMs, aspect);
    session.sampleRemote(this.remote);
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
    if (this.ui.settings.download) this.scene.assets.residency.download();
    this.ui.settings.download = false;
    this.ui.settings.kept = keptLine(kept);
    this.scene.assets.tier = tierWithout(this.governor.tier(forTouch(tierOf(this.ui.settings.tier), this.ui.settings.touchFirst), this.ui.settings.steady, this.dpr, nowMs), this.off);
    session.view(this.scene.assets.tier.view, this.ui.settings.snapshotBytes);
    session.askFar(this.scene.assets.tier.reach.bases);
    session.holdNodes(this.scene.assets.tier.nodes.chunks);
    const packet = this.scene.build(cam, this.remote);
    packetWithout(packet, this.off);
    updateHud(hud, session, this.remote, this.fps, height / CANVAS_HEIGHT);
    hud.steady = this.governor.level > 0 ? ` (${this.governor.level} down: ${this.governor.name})` : "";
    this.feedback.absorb(session, this.reg, nowMs);
    this.feedback.fill(hud.combat, cam, c.yaw, alive, nowMs, session.damageNumbers && this.ui.settings.damageNumbers, session.hitMarkers);
    fillOverhead(hud.overhead, session, this.remote, cam, this.scene.characters, alive && !hud.out ? eyeNow : -1, c.yaw, c.pitch);
    fillHotbar(hud, alive ? session.inventory : null, session.held, this.reg, this.pack.palette);
    fillAction(hud, alive ? session : null, this.reg);
    fillBuffs(hud, alive ? session : null, this.reg, this.pack.palette);
    this.listen(hud);
    const ghost = this.scene.ghost;
    ghost.kind = 0;
    const b = this.builder;
    if (alive && session.driving < 0) {
      lookDirection(Math.round((c.yaw / TAU) * 65536) & 0xffff, Math.round((c.pitch / (PI / 2)) * 16384), this.aim);
      b.update(session, world, this.reg, session.own.x, session.own.y + eyeNow, session.own.z, this.aim[0]!, this.aim[1]!, this.aim[2]!, c.yaw, nowMs);
    } else b.active = false;
    if (b.active && b.problem !== RESULT_NO_SNAP) {
      ghost.kind = b.kind;
      ghost.x = b.pose.x / STRUCT_UNITS;
      ghost.y = b.pose.y / STRUCT_UNITS;
      ghost.z = b.pose.z / STRUCT_UNITS;
      ghost.yaw = b.pose.yaw;
      ghost.color = b.problem === 0 ? GHOST_OK : GHOST_BAD;
    }
    const menu = this.ui.structure;
    menu.tick(nowMs);
    const built = alive && !b.active && session.driving < 0 ? this.builtAt(world, eyeNow) : ((this.aimed = -1), "");
    if (this.aimed >= 0 && this.useDownAt >= 0 && nowMs - this.useDownAt >= STRUCT_HOLD_MS && !menu.open && this.ui.wantsPointerLock) {
      menu.begin(this.aimed);
      this.useDownAt = -1;
      this.useKept = false;
      c.release();
    }
    const whom = alive ? this.who(world, eyeNow) : ((this.lookedAt = this.target = -1), "");
    this.eggAimed = -1;
    hud.prompt = !alive ? "" : b.active ? b.notice : menu.notice || this.prompt(world, eyeNow) || whom || built;
    if (b.active) hud.ammo = "E turn   Q next place   R form";
    this.ui.build(aspect, hud, session);
    return packet;
  }
}
