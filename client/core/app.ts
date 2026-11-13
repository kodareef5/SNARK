// One client, start to finish, without a browser: input, session, camera,
// scene and interface. The shell creates the renderer, the socket and the DOM
// binder, forwards events here, and each frame draws what `frame` returns.
// Tests drive this class directly.

import type { Registry } from "../../shared/content/registry.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CMD_OPEN, CMD_ORDER, CMD_SELECT, MARKER_DEATH, ORDER_ALL, ORDER_FOLLOW, ORDER_STAY, RESULT_OK, SESSION_ALIVE, SESSION_CREATING, RESULT_NO_SNAP } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { structName } from "./ui/structure.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { Controls } from "./controls.ts";
import { HudModel, fillAction, fillBuffs, fillHotbar, minimapImage, updateHud } from "./hud.ts";
import { Camera } from "./render/camera.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, bodySeed, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { Falling } from "./rubble.ts";
import { BTN_SECONDARY } from "../../shared/sim/character.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { FISTS } from "../../shared/sim/weapon.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { handleIndex } from "../../shared/ids.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../../shared/sim/items.ts";
import { Viewpoint } from "./viewpoint.ts";
import { RemoteSample, type ClientSession } from "./session.ts";
import { Builder, GHOST_BAD, GHOST_OK } from "./build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { waitWords } from "./ui/inventory.ts";
import { voicePan } from "./voice/place.ts";
import { HEAR_FIELDS, type VoicePort } from "./voice/port.ts";
import { MODE_TALK, MODE_WHISPER, MODE_YELL } from "../../shared/voice/packet.ts";

/** What the screen says while the microphone is live, by how loud it is meant. */
const TALK_LABEL: readonly string[] = ["WHISPERING", "TALKING", "YELLING"];
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "./ui/hud.ts";
import { Ui } from "./ui/ui.ts";

/** How far a body can reach to use something; the server's REACH. */
const REACH = 3.5;
/** How long the use key is held on something built before it means "what can I do to this", in milliseconds. */
const STRUCT_HOLD_MS = 350;
/** How far off a survivor's name can be read by looking at it, in metres. */
const NAME_RANGE = 30;
/** Bit in replicated entity flags marking a prop: a thing that can be opened. */
const VIEW_FLAG_PROP = 8;

/** The camera's field of view, top to bottom, radians, until the settings say; and what aiming a bow or a gun, and looking through a scope, leave of it. */
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
  /** Structures seen falling, once there is a world for them to fall in. */
  falling: Falling | null = null;
  /** The camera's field of view, eased toward what the weapon in hand and the aim button ask for. */
  private fov = BASE_FOV;
  readonly remote = new RemoteSample();
  readonly view = new Viewpoint();
  scene: Scene | null = null;
  /** Smoothed frames per second. */
  fps = 60;
  /** When false the body is not steered (the self-check holds still). */
  steer = true;

  private readonly reg: Registry;
  private readonly pack: Pack;
  private last = -1;
  /** Height of the camera's eye above the body's feet, or -1 before the first frame. */
  private eye = -1;
  private readonly aim = [0, 0, 0];
  private readonly body: OwnBody = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT), id: 0 };

  constructor(session: ClientSession, reg: Registry, pack: Pack) {
    this.session = session;
    this.reg = reg;
    this.pack = pack;
    this.ui.registry = reg;
    this.ui.palette = pack.palette;
    this.shots = new Shots(reg, pack);
    session.onResult = (seq, code) => {
      this.ui.creator.result(seq, code === RESULT_OK);
      this.builder.result(seq, code, this.nowMs);
      this.ui.structure.result(seq, code, this.nowMs, this.session, this.aimed);
    };
  }

  /** Where the building piece in hand would go, if one is. */
  readonly builder = new Builder();
  /** The time of the last frame, for keys that are timed. */
  private nowMs = 0;
  /** The creature of this survivor's tribe that the look is on, as its entity index, or -1. */
  lookedAt = -1;
  /** When the use key went down, or -1; and the thing built that the look is on, or -1. */
  private useDownAt = -1;
  aimed = -1;
  /** The use key went down with the look on something built: the press is kept from the body until it is known to be a tap. */
  private useKept = false;
  /** Frames left of a use button pressed on the key's behalf, once it was let go as a tap. */
  private usePulse = 0;

  /** Whatever carries voice here, if anything does; whether the microphone is wanted; and how loud it is meant. */
  voice: VoicePort | null = null;
  talking = false;
  private talkMode = MODE_TALK;
  private volumeSet = -1;
  /** Alt and Shift, as they are held: with the talk key, a whisper and a yell. */
  private alt = false;
  private shift = false;

  /** The microphone is wanted, or no longer: the talk key, or something that took the keyboard away. */
  private talk(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.talkMode = this.alt ? MODE_WHISPER : this.shift ? MODE_YELL : MODE_TALK;
    this.voice?.talk(on, this.talkMode, this.ui.settings.toggleTalk);
  }

  /**
   * Tell whatever plays voices how far off each speaker is, from where this
   * client sees their bodies, and the screen who is talking.
   */
  private listen(hud: HudModel): void {
    hud.talkers.length = 0;
    hud.voice = "";
    const v = this.voice;
    if (!v) return;
    // What the microphone is doing, or why it is not doing it.
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
  /** Scratch: for each speaker its number, how far off it is, and which side it is on. */
  private readonly heardAt = new Float32Array(HEAR_FIELDS * 128);

  /** A key went down, repeated, or went up. Returns true if the page should not also act on it. */
  key(code: string, down: boolean, repeat = false): boolean {
    if (this.ui.key(code, down, repeat, this.session)) {
      // A screen that takes the keyboard also takes it from the body, and from a microphone that is held open by a key.
      if (this.ui.captureKeyboard) {
        this.controls.release();
        if (!this.ui.settings.toggleTalk) this.talk(false);
      }
      return true;
    }
    if (this.ui.captureKeyboard) return false;
    // With a building piece in hand, some keys are building's.
    if (this.builder.key(code, down, repeat, this.nowMs, this.reg)) return true;
    if (code === "AltLeft" || code === "AltRight") {
      // Kept from the browser, which would open its menu.
      this.alt = down;
      return true;
    }
    if (code === "ShiftLeft" || code === "ShiftRight") this.shift = down;
    // The use key is the body's. On something built it may be a question instead (held, it asks what can be done to
    // that), so there the body is not told of it until it is let go, and then as a short press.
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
    // F looks into a creature of the tribe's: the one ridden, or the one looked at.
    if (code === "KeyF") {
      const which = this.session.driving >= 0 ? this.session.driving : this.lookedAt;
      if (down && !repeat && which >= 0) this.session.command(CMD_OPEN, (w) => w.u32(which >>> 0));
      return true;
    }
    // Whistles. T and Y to the creature looked at: follow me, stay. J and U to every one of the tribe's that hears.
    if (code === "KeyT" || code === "KeyY" || code === "KeyJ" || code === "KeyU") {
      if (down && !repeat) {
        const one = code === "KeyT" || code === "KeyY";
        const which = one ? this.lookedAt : ORDER_ALL;
        if (which >= 0) this.session.command(CMD_ORDER, (w) => (w.u32(which >>> 0), w.u8(code === "KeyT" || code === "KeyJ" ? ORDER_FOLLOW : ORDER_STAY)));
      }
      return true;
    }
    if (code === "KeyB") {
      // Held to talk; or, if the player has set it so, pressed to switch the microphone on and pressed again to switch it off.
      // With Alt it is a whisper, with Shift a yell.
      if (repeat) return true;
      if (!this.ui.settings.toggleTalk) this.talk(down);
      else if (down) this.talk(!this.talking);
      return true;
    }
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) {
      // 1 to 9 and then 0 take a hotbar slot in hand; the key of what is in hand puts it away.
      const slot = (Number(digit[1]) + 9) % 10;
      if (down && !repeat) this.session.command(CMD_SELECT, (w) => w.u8(this.session.held === slot ? 255 : slot));
      return true;
    }
    if (code === "KeyV") {
      // Out of the body's eyes, or over its shoulder.
      if (down && !repeat) this.view.thirdPerson = !this.view.thirdPerson;
      return true;
    }
    return this.controls.key(code, down);
  }

  mouseButton(button: number, down: boolean): void {
    if (!this.ui.wantsPointerLock) return;
    // With a building piece in hand the primary button sets it down; it is not a blow.
    if (button === 0 && this.builder.active) {
      if (down) this.builder.place(this.session, this.reg);
      return;
    }
    this.controls.mouseButton(button, down);
  }

  /** Mouse movement while the pointer is locked. */
  look(dx: number, dy: number): void {
    if (this.ui.wantsPointerLock) this.controls.look(dx, dy);
  }

  /** The window lost focus. */
  blur(): void {
    this.controls.release();
    this.alt = this.shift = false;
    if (!this.ui.settings.toggleTalk) this.talk(false);
  }

  /**
   * Fly the camera by itself for a measurement run: turn steadily, nod, and
   * walk forward, so every direction and distance is drawn in turn. Call each
   * frame instead of forwarding input.
   */
  autopilot(nowMs: number): void {
    this.controls.key("KeyW", true);
    this.controls.yaw = nowMs / 1600;
    this.controls.pitch = Math.sin(nowMs / 2300) * 0.35 - 0.1;
  }

  textInput(key: number, value: string): void {
    this.ui.input(key, value);
  }

  /** Pointer went down (0), up (1) or moved (2) over an interactive node; position in canvas units. */
  pointer(kind: number, key: number, x: number, y: number, button: number): void {
    this.ui.pointer(kind, key, x, y, button, this.session);
  }

  /** How big body `i` of those in view is, as a share of its kind's size: less than 1 for one that is young. */
  private sizeOf(i: number): number {
    const r = this.remote;
    return r.grown[i] !== 0 && (r.flags[i]! & VIEW_FLAG_PROP) === 0 ? youngScale(this.reg.birthScale[r.kind[i]!]!, r.born[i]!, r.grown[i]!, r.tick) : 1;
  }

  /**
   * Who the crosshair is on, out to where a name can be read: a survivor's
   * name and level, and whether it is of this survivor's tribe.
   */
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
      const size = this.sizeOf(i);
      const rad = this.reg.bodyRadius[r.kind[i]!]! * size;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + this.reg.bodyHeight[r.kind[i]!]! * size, r.z[i]! + rad);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    const mine = hit >= 0 && s.tribe.team !== 0 && r.team[hit] === s.tribe.team;
    // A creature of the tribe's, looked at: the one a whistle is for.
    this.lookedAt = hit >= 0 && mine && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 && !this.scene!.characters.human(r.kind[hit]!) ? r.id[hit]! : -1;
    if (hit < 0 || r.name[hit] === "" || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0) return "";
    return `${r.name[hit]}${mine ? " (tribe)" : ""}  level ${r.level[hit]}`;
  }

  /**
   * The thing built that the look is on, within reach of acting on it, or -1;
   * and what to say of it: its name and how whole it is.
   */
  private builtAt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const d = this.aim;
    this.aimed = -1;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    if (castWorld(world, s.own.x, s.own.y + eye, s.own.z, d[0]!, d[1]!, d[2]!, ACT_REACH) !== HIT_STRUCTURE) return "";
    const ref = rayHit.ref;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    // Only what somebody built: the world's own walls are not anyone's to take down.
    if (this.reg.pieceItem[kind] === 0 || t.owner[ref & 0xffff] === 0) return "";
    this.aimed = ref;
    const mine = s.tribe.team !== 0 && t.owner[ref & 0xffff] === s.tribe.team;
    // What can be used says so, when it is near enough for the use button; what is one's own, that there is more to be done with it.
    const usable = (this.reg.opens[kind] !== 0 || this.reg.structSlots[kind] !== 0) && rayHit.t <= REACH;
    return `${usable ? "E use  " : mine ? "hold E  " : ""}${structName(this.reg, kind)}  ${Math.ceil(t.hp[ref & 0xffff]!)}/${this.reg.maxHp[kind]}`;
  }

  /**
   * What the use button would act on: the same ray the server will cast from
   * the same eye, here only to say so on screen. The server's answer is the
   * one that counts.
   */
  private prompt(world: CollisionWorld, eye: number): string {
    const s = this.session;
    const r = this.remote;
    const d = this.aim;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    lookDirection(Math.round((this.controls.yaw / TAU) * 65536) & 0xffff, Math.round((this.controls.pitch / (PI / 2)) * 16384), d);
    const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, REACH);
    let best = struck === HIT_NONE ? REACH : rayHit.t;
    const node = struck === HIT_NODE ? rayHit.ref : -1;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
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
        // An egg says when it will hatch; anything else lying there is something to look into.
        if (r.grown[hit] !== 0) return `${r.name[hit]}  hatches in ${waitWords(Math.max(0, Math.ceil((r.grown[hit]! - s.serverTick) / TICK_RATE)))}`;
        return `E  ${s.open ? "close" : "open"} ${r.name[hit]}`;
      }
      // A young one that is nobody's is anybody's to take.
      if (r.team[hit] === 0 && r.grown[hit] !== 0) {
        const id = this.reg.ids[r.kind[hit]!] ?? "";
        return `E  take the young ${id.slice(id.indexOf(":") + 1)}`;
      }
      return "";
    }
    if (node < 0 || !world.nodes) return "";
    // A tree or rock is struck with the primary button; a bush is picked with the use key.
    const kind = world.nodes.chunks[Math.floor(node / 65536)]?.kind[node & 0xffff] ?? 0;
    const def = this.reg.defs[kind];
    if (def?.type !== "node") return "";
    const what = def.id.slice(def.id.indexOf(":") + 1);
    return def.material === undefined ? `E  pick ${what}` : `hold click  gather from ${what}`;
  }

  /**
   * The creator's view: the survivor being made stands at the spawn point in
   * daylight, as the creator has it, and the camera faces it from the front,
   * off to one side so the body is clear of the panel.
   */
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
    // The panel takes the right of a wide window: stand the body in the middle of what is left.
    const back = 3.3;
    const side = aspect > 1 ? back * Math.tan(cam.fovY / 2) * aspect * Math.min(0.42, 190 / (360 * aspect)) : 0;
    cam.x = body.x + side;
    cam.y = body.y + 1.15;
    cam.z = body.z + back;
    cam.yaw = Math.PI;
    cam.pitch = -0.06;
  }

  /**
   * Advance to `nowMs` and lay out a frame for a `width` by `height` window.
   * Returns what to draw in the world, or null until the world has arrived; the
   * interface (`ui.frame`) is always ready.
   */
  frame(nowMs: number, width: number, height: number): FramePacket | null {
    const dt = this.last < 0 ? 16 : nowMs - this.last;
    this.last = nowMs;
    this.fps += (1000 / Math.max(dt, 1) - this.fps) * 0.05;
    const aspect = width / Math.max(height, 1);
    const session = this.session;
    const hud = this.hud;
    const c = this.controls;
    this.nowMs = nowMs;

    if (session.state === "closed") {
      hud.status = `disconnected (reason ${session.closeReason})`;
      this.ui.build(aspect, hud, session);
      return null;
    }
    // A tap of the use key on something built, passed on now that it is known to be one.
    if (this.usePulse > 0) c.key("KeyE", --this.usePulse > 0);
    if (this.steer) session.update(nowMs, c.moveX, c.moveZ, c.yaw, c.pitch, c.buttons);
    else session.update(nowMs, 0, 0, c.yaw, c.pitch, 0);
    const world = session.world;
    if (session.state !== "active" || !world) {
      hud.status = "connecting";
      this.ui.build(aspect, hud, session);
      return null;
    }
    if (!this.scene) {
      this.scene = new Scene(world, this.reg, this.pack);
      this.scene.shots = this.shots;
      this.falling = this.scene.falling = new Falling(this.reg.halfY, (x, z) => world.hf.heightAt(x, z));
      this.ui.frame.images[IMAGE_MINIMAP] = { width: MINIMAP_SIZE, height: MINIMAP_SIZE, data: minimapImage(world.hf, this.pack.palette, MINIMAP_SIZE), version: 1 };
    }
    hud.status = "";

    // Eye position: between the last two predicted ticks, so motion is smooth at any frame rate.
    const cam = this.cam;
    const a = session.alpha;
    const alive = session.sessionState === SESSION_ALIVE;
    const move = this.reg.move[session.bodyKind];
    // The eye follows the stance, eased so that crouching is a movement and not a cut.
    const eyeNow = alive && move ? stanceEye(move, session.own.stance) : 0;
    // A body that has just appeared looks from its eye at once; only a change of stance is eased.
    if (!alive) this.eye = -1;
    else this.eye = this.eye < 0 ? eyeNow : this.eye + (eyeNow - this.eye) * Math.min(1, dt / 90);
    const eye = alive ? this.eye : 0;
    const bx = session.ownPrev.x + (session.own.x - session.ownPrev.x) * a + session.smoothX;
    const by = session.ownPrev.y + (session.own.y - session.ownPrev.y) * a + session.smoothY;
    const bz = session.ownPrev.z + (session.own.z - session.ownPrev.z) * a + session.smoothZ;
    // A spectator has no body to look past: always from the eye.
    const third = this.view.thirdPerson;
    if (!alive) this.view.thirdPerson = false;
    // A rider looks at its mount from behind.
    else if (session.driving >= 0) this.view.thirdPerson = true;
    this.view.place(cam, world, bx, by + eye, bz, c.yaw, c.pitch);
    this.view.thirdPerson = third;
    cam.aspect = aspect;
    // Aiming narrows the view: a little with a bow or a gun, a great deal through a scope. The mouse slows to match.
    // The player's own field of view is the widest it goes; aiming narrows it in proportion.
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
    // The body itself, posed from what the prediction says it is doing.
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
    // What it holds and wears, read off its own slots.
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
    // What it is doing with what it holds, as its own prediction has it: a swing is seen the moment it is asked for.
    body.state.setAction(session.own.act, (this.reg.weapon[session.own.held] ?? FISTS).hold, session.simTick - session.own.actTicks);
    body.state.seed = bodySeed(body.id);
    // Driving something else (riding), its own body is one more body in view, where the server has it: on the seat.
    // What it drives is the body it predicts: drawn from that, not from what the server last said, and always seen from outside.
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
      // Its colours are what the server shows of it.
      body.colors.fill(0);
      const r = this.remote;
      for (let i = 0; i < r.count; i++) if (r.id[i] === session.driving) body.colors.set(r.colors.subarray(i * 6, i * 6 + 6));
    }
    this.scene.skip = riding ? session.driving : -1;
    this.scene.own = (alive && session.ownHandle !== 0 && session.driving < 0) || riding ? body : null;
    if (session.sessionState === SESSION_CREATING) this.preview(nowMs, aspect);
    session.sampleRemote(this.remote);
    // Shots in the air: this client's own as its prediction has them, others' as the server told of them.
    this.shots.absorb(session, world, nowMs);
    this.shots.step(world, this.remote, session.tickClock, nowMs);
    this.scene.shotTick = session.tickClock;
    // What has just been destroyed or has fallen: seen to go, the nearest to the eye first.
    this.falling!.absorb(session.rubble, nowMs, cam.x, cam.y, cam.z);
    this.falling!.step(nowMs);
    // A beam over each place it died, so the place can be seen from far off.
    const beams = this.scene.beams;
    beams.length = 0;
    for (const m of session.markers) if (m.kind === MARKER_DEATH) beams.push(m.x, m.y, m.z);
    this.scene.hour = hourOfDay(session.serverTick, session.dayOffset);
    const packet = this.scene.build(cam, this.remote);
    updateHud(hud, session, this.remote, this.fps);
    this.feedback.absorb(session, this.reg, nowMs);
    this.feedback.fill(hud.combat, cam, c.yaw, alive, nowMs, session.damageNumbers && this.ui.settings.damageNumbers);
    fillHotbar(hud, alive ? session.inventory : null, session.held, this.reg, this.pack.palette);
    fillAction(hud, alive ? session : null, this.reg);
    fillBuffs(hud, alive ? session : null, this.reg, this.pack.palette);
    this.listen(hud);
    // A building piece in hand: shown where it would go, in green if it may and red if not, with the reason.
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
    // Something built, looked at: named, and with the use key held on it, asked about.
    const menu = this.ui.structure;
    menu.tick(nowMs);
    const built = alive && !b.active && session.driving < 0 ? this.builtAt(world, eyeNow) : ((this.aimed = -1), "");
    if (this.aimed >= 0 && this.useDownAt >= 0 && nowMs - this.useDownAt >= STRUCT_HOLD_MS && !menu.open && this.ui.wantsPointerLock) {
      menu.begin(this.aimed);
      this.useDownAt = -1;
      this.useKept = false;
      c.release();
    }
    const whom = alive ? this.who(world, eyeNow) : ((this.lookedAt = -1), "");
    hud.prompt = !alive ? "" : b.active ? b.notice : menu.notice || this.prompt(world, eyeNow) || whom || built;
    if (b.active) hud.ammo = "E turn   Q next place   R form";
    this.ui.build(aspect, hud, session);
    return packet;
  }
}
