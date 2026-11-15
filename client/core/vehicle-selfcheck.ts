// An optional, bounded native-game exercise used by the existing browser self-check, never ordinary play.
import type { App } from "./app.ts";
import { KEY_VEHICLE } from "./ui/hud.ts";

export class VehicleSelfcheck {
  readonly data = { began: -1, aimTick: -1, useTick: -1, useServerTick: -1, marginAtUse: 0, attempts: 0, focused: false, startTick: -1, startedAt: -1, startServerTick: -1, correctionsAtTakeover: 0, correctionsAtFinish: 0, clockJumps: 0, target: -1, maxSpeed: 0, maxRide: 0, maxDoor: 0, maxGear: 0, hud: false, finished: false, timedOut: false };

  /** Uses only ordinary survivor controls, prediction, simulation and rendering. */
  step(app: App, now: number): void {
    const drive = this.data, session = app.session, reg = session.registry;
    if (session.state !== "active" || !session.ownHandle || drive.finished) return;
    if (drive.began < 0) drive.began = now;
    // Acquisition has its own budget; joining, asset warm-up and input-clock settling cannot consume the drive course.
    const entryExpired = drive.startTick < 0 && session.driving < 0 && now - drive.began > 12000;
    const driveExpired = drive.startedAt >= 0 && now - drive.startedAt > 6000;
    if (entryExpired || driveExpired) {
      app.controls.release(); drive.timedOut = drive.finished = true;
      drive.correctionsAtFinish = session.stats.corrections; drive.clockJumps = session.stats.clockJumps;
      return;
    }
    if (drive.target < 0) {
      let near = Infinity;
      for (let i = 0; i < app.remote.count; i++) {
        if (!reg.vehicle[app.remote.kind[i]!]) continue;
        const dx = app.remote.x[i]! - session.own.x, dz = app.remote.z[i]! - session.own.z, d = Math.hypot(dx, dz);
        if (d >= near) continue;
        near = d; drive.target = app.remote.id[i]!;
        app.controls.yaw = Math.atan2(dx, dz);
        app.controls.pitch = Math.atan2(app.remote.y[i]! + .8 - session.own.y - 1.62, d);
      }
      if (drive.target >= 0) drive.aimTick = session.simTick;
    }
    if (drive.useTick >= 0 && session.simTick - drive.useTick >= 4) app.controls.key("KeyE", false);
    if (session.driving < 0) {
      // Aim must already have reached the normal client focus/prompt and several accepted input ticks before use.
      for (let i = 0; i < app.remote.count; i++) if (app.remote.id[i] === drive.target) {
        const dx = app.remote.x[i]! - session.own.x, dz = app.remote.z[i]! - session.own.z;
        app.controls.yaw = Math.atan2(dx, dz);
        app.controls.pitch = Math.atan2(app.remote.y[i]! + .8 - session.own.y - 1.62, Math.hypot(dx, dz));
      }
      const focused = app.hud.prompt.startsWith("E  enter") || app.hud.prompt.startsWith("E  carjack");
      drive.focused ||= focused;
      const ready = drive.aimTick >= 0 && session.simTick - drive.aimTick >= 6 && focused;
      const retry = drive.useTick < 0 || session.simTick - drive.useTick >= 45;
      if (ready && retry && drive.attempts < 3) {
        app.controls.key("KeyE", true); drive.useTick = session.simTick; drive.attempts++;
        drive.useServerTick = session.latestSnapshot; drive.marginAtUse = session.stats.margin;
      }
      return;
    }
    app.controls.key("KeyE", false);
    if (drive.startTick < 0) {
      drive.startTick = session.simTick;
      drive.startedAt = now; drive.startServerTick = session.latestSnapshot;
      drive.correctionsAtTakeover = session.stats.corrections;
      app.controls.yaw = session.own.vehicleYaw; app.controls.pitch = -.08;
    }
    const age = session.simTick - drive.startTick;
    app.controls.key("KeyW", age < 120);
    app.controls.key("KeyD", age >= 40 && age < 70);
    app.controls.key("Space", age >= 100);
    drive.maxSpeed = Math.max(drive.maxSpeed, Math.hypot(session.own.vx, session.own.vz));
    drive.maxRide = Math.max(drive.maxRide, Math.abs(session.own.vehicleRideOffset), Math.abs(session.own.vehiclePitch - session.own.vehicleGroundPitch), Math.abs(session.own.vehicleRoll - session.own.vehicleGroundRoll));
    drive.maxGear = Math.max(drive.maxGear, app.vehicleTelemetry.gear);
    drive.hud ||= app.ui.frame.nodes.slice(0, app.ui.frame.count).some(n => n.key === KEY_VEHICLE);
    if (age >= 140) {
      drive.finished = true; drive.correctionsAtFinish = session.stats.corrections; drive.clockJumps = session.stats.clockJumps;
    }
  }

  observe(app: App): void {
    for (let i = 0; i < app.remote.count; i++) if (app.remote.id[i] === this.data.target) this.data.maxDoor = Math.max(this.data.maxDoor, app.remote.vehicleDoorLeft[i]!, app.remote.vehicleDoorRight[i]!);
  }
}
