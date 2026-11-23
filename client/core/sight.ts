// The aim, and any sight raised over it: a weapon's scope, the spyglass, a helmet's visor. A part of the app's frame, after
// the view's subject is known and before the camera is placed. It says where the view looks (the look the input carries,
// turned by a kick, a sway or a shaking hand), how wide the view is and through what window, what the server is told the
// eye is on, and what the HUD shows of the sight (hud/sight.ts SightShown). The keys' rows are beside it: optics.ts,
// glass.ts, visor.ts.

import type { ItemDef, OpticFacet } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_GAZE, GAZE_FARTHEST, GAZE_REACH } from "../../shared/net/protocol.ts";
import { KICK_UNIT, breathShare, scopeFitted, shotCone, sway, swayOut } from "../../shared/sim/aim.ts";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_VISOR, GLIDE_DIVE } from "../../shared/sim/character.ts";
import { FLAG_ON, type Inventory } from "../../shared/sim/items.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import type { Controls } from "./controls.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import { Glass, MARKED_MS } from "./glass.ts";
import { easeFov, eyeOff, forcesEye, FOV_EASE_MS, lookScale, magnification, opticMost, opticZoom, shapeOf, windowBox, windowShare, zoomed } from "./optics.ts";
import { daylight } from "./render/laser.ts";
import { Visor } from "./visor.ts";

/** Radians the view opens by at a glider's dive speed. */
const GLIDE_FOV = (6 * Math.PI) / 180;
/** A thruster car's boost: how much wider the view opens, and how far it shakes, radians. */
const BOOST_FOV = 10 * Math.PI / 180, BOOST_SHAKE = .0035;
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
/** Milliseconds the eye takes to settle most of the way to where it is off a scope's axis. */
const EYE_EASE_MS = 120;

/** Radians in a unit of yaw or pitch on the wire (65536 to a turn). */
const UNIT_RADIANS = TAU / 65536;

/** The attachment (ItemDef) on the weapon in `slot` of `inv`, or null. */
function attachmentOf(reg: Registry, inv: Inventory | null, slot: number): ItemDef | null {
  const fitted = inv && slot >= 0 ? inv.attach[slot]! : 0;
  return fitted === 0 ? null : (reg.defs[fitted] as ItemDef | null);
}

/** The worn helmet's optic where the helmet is not worn out (its visor), or null. */
function wornOptic(reg: Registry, inv: Inventory | null): OpticFacet | null {
  const at = inv && inv.armor >= 0 ? inv.armor : -1;
  const item = at >= 0 ? inv!.item[at]! : 0;
  const def = item !== 0 ? (reg.defs[item] as ItemDef | null) : null;
  return def?.optic && def.wear?.slot === "head" && (inv!.dur[at]! > 0 || !(def.wear.uses > 0)) ? def.optic : null;
}

export class Sight implements FramePart {
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
  visorOptic: OpticFacet | null = null;
  /** The zoom the server was last told of (gaze), and when. */
  private gazeSent = 0;
  private gazeAt = -Infinity;
  /** When N went down with a visor to raise (-1 when it is up), whether it has been held long, and a tap's press to send (visor.ts VISOR_KEYS). */
  nDownAt = -1;
  nLong = false;
  nPulse = 0;
  /** When what the sight is on was last found (gaze). */
  private focusAt = -Infinity;
  /** Scratch: a look's direction, and the eye of a body posed in a seat. */
  private readonly dir = [0, 0, 0];
  private readonly posed = new Float64Array(3);
  /** What a glass's range is found along (`range`), and what the server is told (`tell`): kept, so no frame makes a function. */
  private f!: AppFrame;
  private lookYaw = 0;
  private lookPitch = 0;
  private toldZoom = 0;
  private toldFocus = 0;

  /** Whether a raised sight takes zoom steps: a scope that zooms, a glass, a visor. */
  get zooming(): boolean {
    return this.sightOptic !== null || (this.glass.up && this.glassOptic !== null) || (this.visor.up && this.visorOptic !== null);
  }

  /** `notches` of zoom to the raised sight, down (positive) to widen: the wheel's, a pad's d-pad's, a finger's. True when one took them. */
  zoomBy(notches: number, alt: boolean): boolean {
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

  /** Before the input is sent: N held long raises or lowers the visor; a tap's press goes as it is let go (visor.ts). */
  hold(nowMs: number, c: Controls): void {
    if (this.nDownAt >= 0 && !this.nLong && nowMs - this.nDownAt >= VISOR_HOLD_MS) {
      this.nLong = true;
      this.visor.held = !this.visor.held;
    }
    if (this.nPulse > 0) c.key("KeyN", --this.nPulse > 0);
  }

  /**
   * The buttons the input sends, of `buttons`. A glass raised takes the primary for its range: the hand holding it does
   * not strike. A visor held up is told the server as a button: the proof its gaze needs (D1084).
   */
  buttons(buttons: number): number {
    return (buttons & (this.glass.up ? ~BTN_PRIMARY : ~0)) | (this.visor.held ? BTN_VISOR : 0);
  }

  step(f: AppFrame): void {
    this.f = f;
    const session = f.session, hud = f.hud, shown = f.sight, c = f.controls, cam = f.cam, reg = f.reg, view = f.view, world = f.world, nowMs = f.nowMs, dt = f.dt;
    const alive = f.alive, a = session.alpha, passenger = f.passenger, move = f.move;
    // The view turns with the kick and, through a scope, with the sway, as a shot does (shared/sim/aim.ts), so the middle of
    // the view is where the next shot is pointed. The look the input sends stays the player's own.
    const gun = alive && session.weaponsAllowed ? (reg.weapon[session.own.held] ?? null) : null;
    const aiming = alive && f.steer && (c.buttons & BTN_SECONDARY) !== 0 && gun !== null && gun.clip > 0;
    // The orbit's view does not look along the aim: it neither narrows to it nor shows a sight, and the centre of the
    // screen is not where a shot goes, so the crosshair is hidden while it is in use. The aim itself is the body's.
    const orbiting = f.orbiting, sighting = aiming && !orbiting;
    shown.orbit = orbiting;
    const held = session.inventory && session.inventory.hotbar >= 0 && session.held >= 0 ? session.inventory.hotbar + session.held : -1;
    const scoped = aiming && scopeFitted(reg, session.inventory, held);
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
    cam.aspect = f.aspect;
    // Aiming narrows the view in proportion to the player's setting; through a sight, by its optic's zoom. The mouse slows
    // to match on the tangent of the view's half (optics.ts lookScale). A sight that magnifies is seen from the eye, as
    // over the shoulder the middle of a narrow view is not where the shot goes; the player's choice of view is kept.
    const settings = f.settings;
    const base = (settings.fov * Math.PI) / 180;
    const fitted = gun && session.driving < 0 ? attachmentOf(reg, session.inventory, held) : null;
    // A weapon's own scope (the fabricated sniper rifle's, D1083), or the one fitted to it.
    const ownOptic = gun && session.driving < 0 ? (reg.defs[session.own.held] as ItemDef | null)?.optic : undefined;
    const sightOptic = ownOptic ?? fitted?.optic;
    const sight = ownOptic ? "scope" : (fitted?.attachment ?? "");
    this.sightOptic = sighting && sightOptic && opticMost(sightOptic) > sightOptic.min ? sightOptic : null;
    if (this.sightOptic) this.sightZoom = Math.min(opticMost(this.sightOptic), Math.max(this.sightOptic.min, this.sightZoom || this.sightOptic.min));
    // A held glass, raised with the secondary on foot (glass.ts, D1082).
    const heldDef = alive && session.driving < 0 && !passenger ? (reg.defs[session.own.held] as ItemDef | null) : null;
    this.glassOptic = heldDef?.class === "instrument" ? (heldDef.optic ?? null) : null;
    const glassUp = this.glassOptic !== null && f.steer && (c.buttons & BTN_SECONDARY) !== 0 && !orbiting && hud.banner === "";
    this.glass.raise(glassUp);
    // A helmet's visor, held up, on foot, the helmet working and no sight aimed through (visor.ts, D1080).
    const visorUp = this.visor.step((this.visorOptic = wornOptic(reg, session.inventory)), alive && session.driving < 0 && !passenger && !sighting && !glassUp && !orbiting && hud.banner === "");
    const zoom = glassUp ? this.glass.zoom(this.glassOptic!) : visorUp ? this.visor.zoom : this.sightOptic ? this.sightZoom : sightOptic ? opticZoom(sightOptic) : 0;
    let want = glassUp || visorUp ? zoomed(base, zoom) : sighting ? (zoom > 0 ? zoomed(base, zoom) : base * AIM_FOV) : base;
    view.atEye = ((sighting && forcesEye(zoom)) || visorUp || glassUp) && !passenger;
    if (glassUp) {
      // The hand shakes it, less crouched, least lying down; the view turns with it, the look sent does not.
      this.glass.shake(nowMs, session.own.stance, this.shook);
      lookYaw += this.shook[0]!;
      lookPitch += this.shook[1]!;
      const press = (c.buttons & BTN_PRIMARY) !== 0;
      if (press && !this.glassPressed) this.glass.lase(nowMs);
      this.glassPressed = press;
    } else this.glassPressed = false;
    shown.behind = alive && f.third && !view.atEye && session.driving < 0 && !passenger;
    // A board opens the view by its own top speed's measure, a car by a car's.
    if (f.dash && !aiming) want += f.dash.board ? Math.min(8, f.dash.speed / 9 * 8) * Math.PI / 180 : Math.min(7 * Math.PI / 180, f.dash.speed / 30 * 7 * Math.PI / 180);
    if (f.dash?.active && f.dash.boosting && !aiming) {
      // A thruster car's boost opens the view further and shakes it a little while the nozzles fire; the look sent does not.
      want += BOOST_FOV;
      lookYaw += Math.sin(nowMs * .071) * BOOST_SHAKE; lookPitch += Math.sin(nowMs * .093 + 1) * BOOST_SHAKE;
    }
    // Under a glider the view opens with its speed, a dive's most, and third person stands back to hold the wings.
    const gliding = alive && session.driving < 0 && session.own.glide !== 0;
    if (gliding) want += Math.min(GLIDE_FOV, (Math.hypot(session.own.vx, session.own.vy, session.own.vz) / GLIDE_DIVE) * GLIDE_FOV);
    view.gliding += ((gliding ? 1 : 0) - view.gliding) * (1 - Math.exp(-Math.max(0, dt) / 280));
    // A glass's lenses are drawn as a scope's are (ui/hud.ts buildReticle), two and no posts.
    shown.scope = (sighting && sight === "scope") || glassUp;
    // The scope's window spans less of the screen the more it magnifies; the eye off its axis, as the body moves, a shot
    // kicks or the sway leads, casts its shadow across the lens. Outside the window nothing is drawn (D1077).
    const optic = glassUp ? this.glassOptic! : visorUp ? this.visorOptic! : sightOptic;
    shown.sightMil = shown.scope && optic?.reticle === "mil";
    shown.sightFov = this.fov;
    shown.sightZoom = zoom;
    // The magnification ladder: any sight raised that magnifies, its zoom now within its least and most.
    shown.magnify = (shown.scope || visorUp) && optic && zoom > 1 ? zoom : 0;
    shown.magnifyMin = optic ? optic.min : 0;
    shown.magnifyMax = optic ? opticMost(optic) : 0;
    shown.sightZero = shown.sightMil ? this.sightZero : 0;
    session.sightZero = sighting && shown.sightMil ? this.sightZero : 0;
    shown.sightShare = optic ? windowShare(optic, zoom) : 1;
    shown.sightShape = shapeOf(optic);
    shown.visor = visorUp;
    shown.visorZoom = zoom;
    shown.visorMode = this.visor.mode;
    shown.visorDigital = visorUp && this.visor.digital;
    shown.visorRange = this.visor.range;
    this.visor.frame(f.scene.optic, daylight(f.sky.hour));
    if (shown.scope && gun) {
      const pace = Math.hypot(session.own.vx, session.own.vz) / Math.max(1, move?.walkSpeed ?? 1);
      const kick = gun.recoilKick ? (session.own.kick * KICK_UNIT * UNIT_RADIANS) / ((gun.recoilKick * PI) / 180) : 0;
      eyeOff(pace, kick, swayOut.yaw, -swayOut.pitch, this.eyeAt);
      const ease = 1 - Math.exp(-Math.max(0, dt) / EYE_EASE_MS);
      shown.sightOffX += (this.eyeAt[0]! - shown.sightOffX) * ease;
      shown.sightOffY += (this.eyeAt[1]! - shown.sightOffY) * ease;
    } else shown.sightOffX = shown.sightOffY = 0;
    const win = cam.window;
    if ((shown.scope || visorUp) && hud.banner === "") {
      windowBox(shown.sightShape, shown.sightShare, f.aspect, this.windowAt);
      win[0] = this.windowAt[0]! * 2 - 1; win[1] = 1 - this.windowAt[3]! * 2; win[2] = this.windowAt[2]! * 2 - 1; win[3] = 1 - this.windowAt[1]! * 2;
    } else { win[0] = win[1] = -1; win[2] = win[3] = 1; }
    shown.holo = alive && sight === "holo" && !orbiting;
    shown.tint = shown.holo && sighting ? HOLO_TINT : 0;
    f.sightAt.yaw = lookYaw;
    f.sightAt.pitch = lookPitch;
    f.sightAt.laser = alive && sight === "laser" && (session.inventory!.flags[held]! & FLAG_ON) !== 0;
    f.sightAt.x = f.bx;
    f.sightAt.y = f.by + f.eye;
    f.sightAt.z = f.bz;
    if (alive && f.seatEye(world, f.remote, session.tickClock, c.yaw, c.pitch, this.posed)) {
      f.sightAt.x = this.posed[0]!; f.sightAt.y = this.posed[1]!; f.sightAt.z = this.posed[2]!;
    }
    this.fov = easeFov(this.fov, want, f.dash || gliding || view.gliding > 0.02 ? 1 - Math.exp(-Math.max(0, dt) / 260) : Math.min(1, dt / FOV_EASE_MS));
    cam.fovY = this.fov;
    cam.zoom = magnification(base, this.fov);
    // Through a sight the server is told how far it magnifies and what it is on, so its cone widens the view (D1079).
    this.gaze(f, (sighting || visorUp || glassUp) && zoom > 1 ? zoom : 0, lookYaw, lookPitch);
    f.lookReach = (sighting || visorUp || glassUp) && zoom > 1 ? Math.max(30, Math.min(GAZE_FARTHEST, GAZE_REACH * zoom)) : 30;
    shown.glass = glassUp;
    shown.zooming = this.zooming;
    shown.glassHeld = this.glassOptic !== null;
    shown.visorReady = this.visorOptic !== null && alive && session.driving < 0;
    shown.glassZoom = zoom;
    if (glassUp) {
      this.lookYaw = lookYaw;
      this.lookPitch = lookPitch;
      this.glass.ranged(nowMs, this.range, hud.heading);
    }
    shown.glassRange = this.glass.lasing >= 0 ? -1 : this.glass.range;
    shown.glassBearing = this.glass.bearing;
    shown.glassMarked = nowMs - this.glass.markedAt < MARKED_MS;
    c.zoom = lookScale(base, this.fov, settings.sensitivity, settings.zoomSensitivity);
    // The crosshair opens with the cone the next shot would leave within.
    shown.cone = gun && gun.coneHip !== undefined && session.driving < 0 ? Math.tan((shotCone(session.own, c.buttons, gun, reg.tamedMove[session.own.kind] ?? move!, false) * PI) / 180) / Math.tan(this.fov / 2) : -1;
    f.lookYaw = lookYaw;
    f.lookPitch = lookPitch;
  }

  /** How far off what a raised glass is on is, metres, or 0 for nothing. */
  private readonly range = (): number => {
    const f = this.f, eye = f.sightAt, d = this.dir;
    lookDirection((this.lookYaw / TAU) * 65536, (this.lookPitch / (PI / 2)) * 16384, d);
    return castWorld(f.world, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, GAZE_FARTHEST) !== HIT_NONE ? rayHit.t : 0;
  };

  /**
   * Tells the server the sight's zoom (0 for none) as it changes by a tenth or more, and again each GAZE_RESEND_MS while it
   * lasts, with how far off what the middle of the view is on (0 for nothing within the cone's reach); once more as it ends.
   */
  private gaze(f: AppFrame, zoom: number, yaw: number, pitch: number): void {
    const nowMs = f.nowMs, world = f.world, session = f.session, scene = f.scene;
    // What the middle of the view is on, found each FOCUS_MS while a sight magnifies: its range, and the point the scene
    // brings its fine ground and far trees to (D1087).
    if (zoom > 0 && nowMs - this.focusAt >= FOCUS_MS) {
      const d = this.dir, eye = f.sightAt;
      lookDirection((yaw / TAU) * 65536, (pitch / (PI / 2)) * 16384, d);
      const reach = Math.min(GAZE_FARTHEST, GAZE_REACH * zoom);
      const t = castWorld(world, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, reach) !== HIT_NONE ? rayHit.t : 0;
      this.focusAt = nowMs;
      this.visor.range = t;
      scene.focusX = t > 0 ? eye.x + d[0]! * t : NaN;
      scene.focusZ = t > 0 ? eye.z + d[2]! * t : NaN;
      // Its near trees, from NODE_FOCUS times (D1090).
      const dims = session.world?.dims;
      session.focusNodes(dims && t > 0 && zoom >= NODE_FOCUS ? chunkAt(dims, eye.x + d[0]! * t, eye.z + d[2]! * t) : -1);
    } else if (zoom === 0) {
      this.focusAt = -Infinity;
      scene.focusX = scene.focusZ = NaN;
      session.focusNodes(-1);
    }
    if (zoom === 0 && this.gazeSent === 0) return;
    const moved = zoom === 0 || this.gazeSent === 0 || Math.abs(zoom - this.gazeSent) > 0.1 * Math.max(zoom, this.gazeSent) || this.zeroSent !== this.sightZero;
    if (!moved && nowMs - this.gazeAt < GAZE_RESEND_MS) return;
    // The server finds what the look is on for itself (D1084): the range sent is the page's, for its own word.
    this.toldZoom = zoom;
    this.toldFocus = zoom > 0 ? this.visor.range : 0;
    session.command(CMD_GAZE, this.tell);
    this.gazeSent = zoom;
    this.gazeAt = nowMs;
    this.zeroSent = this.sightZero;
  }

  /** The gaze as CMD_GAZE carries it: the zoom in sixteenths, the page's range, and the zero. */
  private readonly tell = (w: BitWriter): void => {
    w.u16(Math.min(65535, Math.round(this.toldZoom * 16)));
    w.u16(Math.min(65535, Math.round(this.toldFocus)));
    w.u16(this.toldZoom > 0 ? this.sightZero : 0);
  };
}
