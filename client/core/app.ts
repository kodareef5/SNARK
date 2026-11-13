// One client, start to finish, without a browser: input, session, camera,
// scene and interface. The shell creates the renderer, the socket and the DOM
// binder, forwards events here, and each frame draws what `frame` returns.
// Tests drive this class directly.

import type { Registry } from "../../shared/content/registry.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { CMD_SELECT, MARKER_DEATH, RESULT_OK, SESSION_ALIVE, SESSION_CREATING } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { Controls } from "./controls.ts";
import { HudModel, fillAction, fillBuffs, fillHotbar, minimapImage, updateHud } from "./hud.ts";
import { Camera } from "./render/camera.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene, bodySeed, type OwnBody } from "./render/scene.ts";
import { Feedback } from "./feedback.ts";
import { Shots } from "./shots.ts";
import { BTN_SECONDARY } from "../../shared/sim/character.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { FISTS } from "../../shared/sim/weapon.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { handleIndex } from "../../shared/ids.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../../shared/sim/items.ts";
import { Viewpoint } from "./viewpoint.ts";
import { RemoteSample, type ClientSession } from "./session.ts";
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "./ui/hud.ts";
import { Ui } from "./ui/ui.ts";

/** How far a body can reach to use something; the server's REACH. */
const REACH = 3.5;
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
    session.onResult = (seq, code) => this.ui.creator.result(seq, code === RESULT_OK);
  }

  /** A key went down, repeated, or went up. Returns true if the page should not also act on it. */
  key(code: string, down: boolean, repeat = false): boolean {
    if (this.ui.key(code, down, repeat, this.session)) {
      // A screen that takes the keyboard also takes it from the body.
      if (this.ui.captureKeyboard) this.controls.release();
      return true;
    }
    if (this.ui.captureKeyboard) return false;
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
    if (this.ui.wantsPointerLock) this.controls.mouseButton(button, down);
  }

  /** Mouse movement while the pointer is locked. */
  look(dx: number, dy: number): void {
    if (this.ui.wantsPointerLock) this.controls.look(dx, dy);
  }

  /** The window lost focus. */
  blur(): void {
    this.controls.release();
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
      const rad = this.reg.bodyRadius[r.kind[i]!]!;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + this.reg.bodyHeight[r.kind[i]!]!, r.z[i]! + rad);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    if (hit < 0 || r.name[hit] === "" || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0) return "";
    const mine = s.tribe.team !== 0 && r.team[hit] === s.tribe.team;
    return `${r.name[hit]}${mine ? " (tribe)" : ""}  level ${r.level[hit]}`;
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
      const rad = this.reg.bodyRadius[r.kind[i]!]!;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + this.reg.bodyHeight[r.kind[i]!]!, r.z[i]! + rad);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    if (hit >= 0) return (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 ? `E  ${s.open ? "close" : "open"} ${r.name[hit]}` : "";
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

    if (session.state === "closed") {
      hud.status = `disconnected (reason ${session.closeReason})`;
      this.ui.build(aspect, hud, session);
      return null;
    }
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
    // Driving something else, its own body is one more body in view, where the server has it.
    this.scene.own = alive && session.ownHandle !== 0 && session.driving < 0 ? body : null;
    if (session.sessionState === SESSION_CREATING) this.preview(nowMs, aspect);
    session.sampleRemote(this.remote);
    // Shots in the air: this client's own as its prediction has them, others' as the server told of them.
    this.shots.absorb(session, world, nowMs);
    this.shots.step(world, this.remote, session.tickClock, nowMs);
    this.scene.shotTick = session.tickClock;
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
    hud.prompt = session.sessionState === SESSION_ALIVE ? this.prompt(world, eyeNow) || this.who(world, eyeNow) : "";
    this.ui.build(aspect, hud, session);
    return packet;
  }
}
