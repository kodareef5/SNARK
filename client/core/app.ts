// One client, start to finish, without a browser: input, session, camera,
// scene and interface. The shell creates the renderer, the socket and the DOM
// binder, forwards events here, and each frame draws what `frame` returns.
// Tests drive this class directly.

import type { Registry } from "../../shared/content/registry.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { MARKER_DEATH, SESSION_ALIVE } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { Controls } from "./controls.ts";
import { HudModel, minimapImage, updateHud } from "./hud.ts";
import { Camera } from "./render/camera.ts";
import type { FramePacket } from "./render/packet.ts";
import { Scene } from "./render/scene.ts";
import { RemoteSample, type ClientSession } from "./session.ts";
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "./ui/hud.ts";
import { Ui } from "./ui/ui.ts";

/** How far a body can reach to use something; the server's REACH. */
const REACH = 3.5;
/** Bit in replicated entity flags marking a prop: a thing that can be opened. */
const VIEW_FLAG_PROP = 8;

export class App {
  readonly session: ClientSession;
  readonly controls = new Controls();
  readonly ui = new Ui();
  readonly cam = new Camera();
  readonly hud = new HudModel();
  readonly remote = new RemoteSample();
  scene: Scene | null = null;
  /** Smoothed frames per second. */
  fps = 60;
  /** When false the body is not steered (the self-check holds still). */
  steer = true;

  private readonly reg: Registry;
  private readonly pack: Pack;
  private last = -1;
  private readonly aim = [0, 0, 0];

  constructor(session: ClientSession, reg: Registry, pack: Pack) {
    this.session = session;
    this.reg = reg;
    this.pack = pack;
    this.ui.registry = reg;
    this.ui.palette = pack.palette;
  }

  /** A key went down, repeated, or went up. Returns true if the page should not also act on it. */
  key(code: string, down: boolean, repeat = false): boolean {
    if (this.ui.key(code, down, repeat, this.session)) {
      // A screen that takes the keyboard also takes it from the body.
      if (this.ui.captureKeyboard) this.controls.release();
      return true;
    }
    if (this.ui.captureKeyboard) return false;
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

  textInput(key: number, value: string): void {
    this.ui.input(key, value);
  }

  /** Pointer went down (0), up (1) or moved (2) over an interactive node; position in canvas units. */
  pointer(kind: number, key: number, x: number, y: number, button: number): void {
    this.ui.pointer(kind, key, x, y, button, this.session);
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
      this.ui.frame.images[IMAGE_MINIMAP] = { width: MINIMAP_SIZE, height: MINIMAP_SIZE, data: minimapImage(world.hf, this.pack.palette, MINIMAP_SIZE), version: 1 };
    }
    hud.status = "";

    // Eye position: between the last two predicted ticks, so motion is smooth at any frame rate.
    const cam = this.cam;
    const a = session.alpha;
    const eye = session.sessionState === SESSION_ALIVE ? ((this.reg.defs[session.ownKind] as SpeciesDef | null)?.eyeHeight ?? 1.6) : 0;
    cam.x = session.ownPrev.x + (session.own.x - session.ownPrev.x) * a + session.smoothX;
    cam.y = session.ownPrev.y + (session.own.y - session.ownPrev.y) * a + session.smoothY + eye;
    cam.z = session.ownPrev.z + (session.own.z - session.ownPrev.z) * a + session.smoothZ;
    cam.yaw = c.yaw;
    cam.pitch = c.pitch;
    cam.aspect = aspect;
    session.sampleRemote(this.remote);
    // A beam over each place it died, so the place can be seen from far off.
    const beams = this.scene.beams;
    beams.length = 0;
    for (const m of session.markers) if (m.kind === MARKER_DEATH) beams.push(m.x, m.y, m.z);
    const packet = this.scene.build(cam, this.remote);
    updateHud(hud, session, this.remote, this.fps);
    hud.prompt = session.sessionState === SESSION_ALIVE ? this.prompt(world, eye) : "";
    this.ui.build(aspect, hud, session);
    return packet;
  }
}
