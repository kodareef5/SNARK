// Optional native control exercises share the browser boot probe; ordinary play never creates them.
import { AnimState } from "../../shared/anim/pose.ts";
import type { CreatureChargeDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { App } from "./app.ts";
import { VehicleSelfcheck } from "./vehicle-selfcheck.ts";
import { ACT_COOL, ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING } from "../../shared/sim/weapon.ts";

export class DinosaurSelfcheck {
  readonly data = { species: "", began: -1, startTick: -1, useTick: -1, attempts: 0, target: -1, mounted: false, lostMount: false, primary: false, secondary: false, chargeAttempts: 0, maxWindupTicks: 0, chargeRan: false, recovered: false, switched: false, maxSpeed: 0, distance: 0, correctionsAtMount: 0, correctionsAtFinish: 0, cameraFinite: true, finished: false, timedOut: false };
  private useReleasedAt = -1;
  private readonly mountPose = new AnimState();
  private chargeDown = false;
  private chargeEdgeTick = -1;
  private startX = 0;
  private startZ = 0;
  constructor(species: string) { this.data.species = species.includes(":") ? species : `core:${species}`; }

  step(app: App, now: number): void {
    const d = this.data, s = app.session, reg = s.registry, controls = app.controls;
    if (s.state !== "active" || !s.ownHandle || d.finished) return;
    if (d.began < 0) d.began = now;
    if (now - d.began > 18000) { controls.release(); d.timedOut = d.finished = true; d.correctionsAtFinish = s.stats.corrections; return; }
    if (s.driving < 0) {
      if (d.mounted) {
        controls.release(); d.lostMount = d.finished = true; return;
      }
      if (d.useTick >= 0 && this.useReleasedAt < d.useTick && s.simTick - d.useTick >= 4) {
        controls.key("KeyE", false);
        this.useReleasedAt = s.simTick;
      }
      for (let i = 0; i < app.remote.count; i++) {
        if (reg.ids[app.remote.kind[i]!] !== d.species) continue;
        const dx = app.remote.x[i]! - s.own.x, dz = app.remote.z[i]! - s.own.z, distance = Math.hypot(dx, dz);
        d.target = app.remote.id[i]!;
        controls.yaw = Math.atan2(dx, dz);
        controls.pitch = Math.atan2(app.remote.y[i]! + reg.bodyHeight[app.remote.kind[i]!]! * .55 - s.own.y - 1.62, distance);
        controls.key("KeyW", distance > 3.2);
        const focused = app.hud.prompt.includes("ride") || app.hud.prompt.includes("mount");
        // A cold frame can run many local ticks before a single new owner snapshot. Wait until
        // the server has passed the previous key release so a queued retry cannot dismount us.
        const previousUseSettled = this.useReleasedAt >= d.useTick && s.latestSnapshot > this.useReleasedAt;
        if (focused && (d.useTick < 0 || previousUseSettled && s.simTick - d.useTick > 30) && d.attempts < 5) {
          controls.key("KeyE", true); d.useTick = s.simTick; d.attempts++;
        }
        break;
      }
      return;
    }
    controls.key("KeyE", false);
    if (d.startTick < 0) {
      d.startTick = s.simTick; d.mounted = true; d.correctionsAtMount = s.stats.corrections;
      this.startX = s.own.x; this.startZ = s.own.z; controls.yaw = 0; controls.pitch = -.12;
    }
    const age = s.simTick - d.startTick, combat = reg.combat[s.own.kind];
    d.primary ||= s.own.act === ACT_SWING;
    d.secondary ||= s.own.act === ACT_RELOAD || s.own.act === ACT_DRAW || s.own.act === ACT_HOLD;
    d.switched ||= s.own.creatureMode > 0;
    controls.yaw = age >= 40 && age < 80 ? .25 : 0;
    controls.key("KeyW", age < 85 || age >= 150 && age < 205);
    controls.key("ShiftLeft", age >= 25 && age < 85);
    // Wait for the action to be observed. A software-rendered frame may span the entire old four-tick pulse.
    controls.mouseButton(0, age >= 90 && !d.primary);
    const secondaryAt = Math.max(125, 90 + (combat?.primary.ticks ?? 0) + 8);
    const secondaryReady = age >= secondaryAt && d.primary;
    if (combat?.charge) this.driveCharge(app, combat.charge, secondaryReady, age);
    else controls.mouseButton(2, secondaryReady && !d.secondary && s.own.act === ACT_NONE);
    controls.key("KeyR", !!combat?.modes && age >= 185 && d.secondary && !d.switched && s.own.act === ACT_NONE);
    d.maxSpeed = Math.max(d.maxSpeed, Math.hypot(s.own.vx, s.own.vz));
    d.distance = Math.max(d.distance, Math.hypot(s.own.x - this.startX, s.own.z - this.startZ));
    if (age >= 330 && (!combat?.charge || d.recovered)) { controls.release(); d.finished = true; d.correctionsAtFinish = s.stats.corrections; }
  }

  private driveCharge(app: App, charge: CreatureChargeDef, ready: boolean, age: number): void {
    const s = app.session, b = s.own, d = this.data;
    const windup = Math.ceil((charge.minWindup + charge.windup) / 2);
    // The driven mount also has an interpolated server pose. Use it to verify each charge phase after prediction settles.
    const r = app.remote, host = r.id.subarray(0, r.count).indexOf(s.driving);
    let serverAct = -1, windupTicks = 0;
    if (host >= 0) {
      this.mountPose.unpack(r.anim[host]!);
      serverAct = this.mountPose.action & 7;
      if (serverAct === ACT_DRAW) {
        windupTicks = (Math.floor(r.tick) - this.mountPose.actionStart) & 255;
        if (windupTicks > charge.windup) windupTicks = 0; // The interpolated moment can precede the nearest snapshot's action start.
        d.maxWindupTicks = Math.max(d.maxWindupTicks, windupTicks);
      }
      d.chargeRan ||= serverAct === ACT_HOLD;
      d.recovered ||= d.chargeRan && serverAct === ACT_COOL;
    }
    if (this.chargeDown) {
      // A rising edge can disappear on reconciliation. Release a missed press once both timelines have passed it.
      const missed = serverAct === ACT_NONE && b.act === ACT_NONE && r.tick >= this.chargeEdgeTick + windup;
      if (windupTicks >= windup || serverAct === ACT_HOLD || serverAct === ACT_COOL || missed) {
        this.chargeDown = false;
        this.chargeEdgeTick = s.simTick;
      }
    } else if (ready && !d.recovered && b.act === ACT_NONE && serverAct === ACT_NONE && b.creatureCooldown === 0 && s.latestSnapshot > this.chargeEdgeTick) {
      // An edge starts a charge. The previous release must have reached a server tick before another press.
      this.chargeDown = true;
      this.chargeEdgeTick = s.simTick;
      d.chargeAttempts++;
    }
    app.controls.mouseButton(2, this.chargeDown);
    // A late retry can still demonstrate the rider's normal brake and recovery within the original wall-clock deadline.
    app.controls.key("KeyG", age >= 330 && serverAct === ACT_HOLD && b.act === ACT_HOLD && b.actTicks >= TICK_RATE / 2);
  }

  observe(app: App): void {
    this.data.cameraFinite &&= Number.isFinite(app.cam.x + app.cam.y + app.cam.z + app.cam.yaw + app.cam.pitch);
  }
}

export class ActivitySelfcheck {
  readonly vehicle: VehicleSelfcheck | null;
  readonly dinosaur: DinosaurSelfcheck | null;
  constructor(params: { has(name: string): boolean; get(name: string): string | null }) {
    const enabled = params.has("selfcheck");
    this.vehicle = enabled && params.has("urbanDrive") ? new VehicleSelfcheck() : null;
    this.dinosaur = enabled && params.has("dinosaur") ? new DinosaurSelfcheck(params.get("dinosaur")!) : null;
  }
  get finished(): boolean { return (!this.vehicle || this.vehicle.data.finished) && (!this.dinosaur || this.dinosaur.data.finished); }
  step(app: App, now: number): void { this.vehicle?.step(app, now); this.dinosaur?.step(app, now); }
  observe(app: App): void { this.vehicle?.observe(app); this.dinosaur?.observe(app); }
}
