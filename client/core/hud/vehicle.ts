// A vehicle's instruments, under the minimap: a car's dash, a helicopter's and a boat's panels. They are read from the
// predicted body by a part of the app's frame (Dash), before the view needs the speed.

import { boostCooling, flipCooling, thrustAxis, thrustBoostLeft } from "../../../shared/sim/vehicle-thrusters.ts";
import { BTN_JUMP, BTN_PRONE, BTN_SPRINT, type Body } from "../../../shared/sim/character.ts";
import { SKATE_MOVES } from "../../../shared/sim/skate-state.ts";
import { PATROL_LIGHT_MODES, isSkateboard, isWheelVehicle, type BoatSpec, type HelicopterSpec, type VehicleSpec } from "../../../shared/sim/vehicle.ts";
import { HIT_NONE, castWorld, rayHit } from "../../../shared/world/ray.ts";
import type { AppFrame, FramePart } from "../frame.ts";
import { DEFAULT_DRIVETRAIN } from "../../../shared/sim/vehicle-drivetrain.ts";
import { K_BAR } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_MENU_FOCUS, S_MENU_MAIN, S_MENU_NOTE, S_OXYGEN, S_WARNING } from "../ui/style.ts";
import { BOAT_W, DASH_W, HELI_W } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

/** Small driving instruments below the minimap, outside the chat and survivor's vitals. */
export const KEY_VEHICLE = 3500;

/** What the dash shows, read from the predicted mechanical state. */
export class VehicleTelemetry {
  active = false;
  /** A skateboard's: the move under way, the links of its run, the run's points and what the last run landed. */
  board = false;
  trick = 0;
  chain = 0;
  points = 0;
  bank = 0;
  rotor = false;
  boat = false;
  flooding = 0;
  hullCondition = 1;
  precision = false;
  capsized = false;
  direct = false;
  recovery = false;
  altitude = 0;
  vertical = 0;
  collective = 0;
  engineCondition = 1;
  rotorCondition = 1;
  engineOn = false;
  id = -1;
  speed = 0;
  brake = 0;
  handbrake = false;
  lightMode = -1;
  grounded = true;
  fuel = 0;
  gear = 1;
  rpm = 0;
  redline = DEFAULT_DRIVETRAIN.redlineRpm;
  /** A thruster car's: how ready each move is, 0 just used to 1 ready, -1 where its cooldown is none; and what fired. */
  thrusters = false;
  boostReady = -1;
  flipReady = -1;
  boosting = false;
  bursting = false;

  stop(): void { this.active = false; this.id = -1; this.rpm = 0; }

  update(id: number, body: Body, throttle: number, handbrake: boolean, spec: VehicleSpec, _dt: number): void {
    this.board = false; this.active = true; this.id = id; this.rotor = false; this.boat = false;
    this.engineCondition = body.vehicleEngineCondition; this.engineOn = body.vehicleEngineOn;
    this.hullCondition = body.vehicleHullCondition; this.flooding = body.vehicleFlooding;
    const forward = body.vx * Math.sin(body.vehicleYaw) + body.vz * Math.cos(body.vehicleYaw), pedal = Math.max(-1, Math.min(1, throttle));
    this.speed = Math.hypot(body.vx, body.vz);
    this.handbrake = handbrake;
    this.brake = handbrake ? 1 : forward * pedal < -.2 ? Math.abs(pedal) : 0;
    this.grounded = body.grounded;
    this.fuel = Math.max(0, Math.min(1, body.fuel / spec.fuelCapacity));
    this.gear = body.vehicleGear;
    this.rpm = body.vehicleRpm;
    this.redline = (spec.drivetrain ?? DEFAULT_DRIVETRAIN).redlineRpm;
    const t = spec.thrusters;
    this.thrusters = t !== undefined;
    this.boostReady = t && t.boostCooldownTicks > 0 ? (thrustBoostLeft(body.vehicleThrust) > 0 ? 0 : 1 - boostCooling(body.vehicleThrustCool) / t.boostCooldownTicks) : -1;
    this.flipReady = t && t.flipCooldownTicks > 0 ? 1 - flipCooling(body.vehicleThrustCool) / t.flipCooldownTicks : -1;
    this.boosting = t !== undefined && thrustBoostLeft(body.vehicleThrust) > 0;
    this.bursting = t !== undefined && thrustAxis(body.vehicleThrust) !== 0;
  }
  updateSkate(id: number, body: Body): void {
    this.active = this.board = true; this.boat = this.rotor = false; this.id = id;
    this.thrusters = this.boosting = this.bursting = false;
    this.speed = Math.hypot(body.vx, body.vz);
    this.trick = body.skate?.move ?? 0; this.chain = body.skate?.chain ?? 0;
    this.points = body.skate?.score ?? 0; this.bank = body.skate?.bank ?? 0;
  }
  updateBoat(id: number, body: Body, spec: BoatSpec, precision: boolean): void {
    this.board = false; this.active = true; this.boat = true; this.rotor = false; this.id = id; this.precision = precision;
    this.speed = Math.hypot(body.vx, body.vz); this.vertical = body.vy; this.thrusters = this.boosting = this.bursting = false;
    this.fuel = Math.max(0, Math.min(1, body.fuel / spec.fuelCapacity));
    this.gear = body.vehicleGear; this.rpm = body.vehicleRpm; this.redline = spec.maxRpm;
    this.engineOn = body.vehicleEngineOn; this.engineCondition = body.vehicleEngineCondition;
    this.hullCondition = body.vehicleHullCondition; this.flooding = body.vehicleFlooding;
    this.capsized = 1 - 2 * (body.vehicleQx * body.vehicleQx + body.vehicleQz * body.vehicleQz) < .15;
    this.grounded = body.grounded; this.handbrake = false; this.brake = 0;
  }
  updateRotor(id: number, body: Body, spec: HelicopterSpec, altitude: number, direct: boolean, recovery: boolean): void {
    this.board = false; this.active = true; this.rotor = true; this.boat = false; this.id = id; this.direct = direct; this.recovery = recovery;
    this.thrusters = this.boosting = this.bursting = false;
    this.speed = Math.hypot(body.vx, body.vz); this.vertical = body.vy; this.altitude = Math.max(0, altitude);
    this.grounded = body.grounded; this.fuel = Math.max(0, Math.min(1, body.fuel / spec.fuelCapacity));
    this.rpm = body.vehicleRotorRpm; this.redline = spec.rotorRpm; this.collective = body.vehicleCollective;
    this.engineCondition = body.vehicleEngineCondition; this.rotorCondition = body.vehicleRotorCondition; this.engineOn = body.vehicleEngineOn;
    this.gear = 0; this.handbrake = false; this.brake = 0;
  }

}

/** Reads the instruments of the vehicle driven, and leaves them in the frame for the view and the HUD. */
export class Dash implements FramePart {
  readonly telemetry = new VehicleTelemetry();

  step(f: AppFrame): void {
    const session = f.session, c = f.controls, world = f.world, car = f.car, t = this.telemetry;
    if (f.alive && car && session.driving >= 0) {
      if (isSkateboard(car)) t.updateSkate(session.driving, session.own);
      else if (car.movement === "rotor") {
        const altitude = castWorld(world, f.bx, f.by + .05, f.bz, 0, -1, 0, 2000) !== HIT_NONE ? Math.max(0, rayHit.t - .05) : f.by - world.hf.heightAt(f.bx, f.bz);
        t.updateRotor(session.driving, session.own, car.spec, altitude, c.directFlight, f.steer && (c.buttons & BTN_PRONE) !== 0);
      } else if (car.movement === "boat") t.updateBoat(session.driving, session.own, car.spec, f.steer && (c.buttons & BTN_SPRINT) !== 0);
      else t.update(session.driving, session.own, f.steer ? c.moveZ : 0, f.steer && (c.buttons & BTN_JUMP) !== 0, car.spec, f.dt);
      t.lightMode = isWheelVehicle(car) && car.emergencyLights ? 0 : -1;
      f.dash = t;
    } else {
      t.stop();
      f.dash = null;
    }
  }

  /** With no world there is nothing to drive, and the HUD shows no panel. */
  none(m: VehicleModel): void {
    this.telemetry.stop();
    m.vehicle = null;
  }
}

export interface VehicleModel {
  vehicle: VehicleTelemetry | null;
}

export const VEHICLE: HudWidget<VehicleModel> = {
  name: "vehicle instruments",
  make: () => ({ vehicle: null }),
  fill(m, c) {
    const f = c.frame;
    if (!f) return;
    const dash = f.dash, shown = f.scene.own?.vehicle?.lightMode;
    // A patrol vehicle's lights are as its drawn body has them, which is as the server last said.
    if (dash && dash.lightMode >= 0 && shown !== undefined) dash.lightMode = shown;
    m.vehicle = dash;
  },
  build(f, _m, at) {
    const { dash, dashX, dashY, dashH, lean } = at;
    if (dash?.board) {
      const x = dashX, y = dashY, width = DASH_W - 24;
      glass(f, KEY_VEHICLE, x, y, DASH_W, dashH);
      f.text(KEY_VEHICLE + 1, x + 12, y + 6, width, S_MENU_MAIN, SKATE_MOVES[dash.trick] ?? "Coasting");
      const score = dash.chain ? `${dash.points} pts  x${dash.chain}` : dash.bank ? `Landed ${dash.bank}` : "";
      f.text(KEY_VEHICLE + 2, x + 12, y + 33, width, S_MENU_NOTE, `${Math.round(dash.speed * 3.6)} km/h   ${score}`);
      if (!lean) {
        f.text(KEY_VEHICLE + 3, x + 12, y + 53, width, S_MENU_NOTE, "W push · S brake · A/D carve");
        f.text(KEY_VEHICLE + 4, x + 12, y + 70, width, S_MENU_NOTE, "Space ollie · hold Shift to grind");
        f.text(KEY_VEHICLE + 5, x + 12, y + 87, width, S_MENU_NOTE, "Air  R kickflip · G 360 shove-it");
        f.text(KEY_VEHICLE + 6, x + 12, y + 104, width, S_MENU_NOTE, "Link on landing · E step off");
      }
    }
    if (dash && !dash.board && !dash.rotor && !dash.boat) {
      const x = dashX, y = dashY;
      glass(f, KEY_VEHICLE, x, y, DASH_W, dashH);
      f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(dash.speed * 3.6).toString().padStart(3, "0"));
      f.text(KEY_VEHICLE + 7, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
      f.text(KEY_VEHICLE + 1, x + DASH_W - 52, y + 6, 40, S_MENU_MAIN, dash.gear < 0 ? "R" : dash.gear === 0 ? "N" : `D${dash.gear}`);
      f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, DASH_W - 24, 3, S_MENU_FOCUS).value = Math.min(1, dash.rpm / dash.redline);
      f.text(KEY_VEHICLE + 3, x + 12, y + 47, 100, S_MENU_NOTE, `${Math.round(dash.rpm / 100) * 100} rpm`);
      f.text(KEY_VEHICLE + 4, x + 118, y + 47, DASH_W - 130, S_MENU_NOTE, `Fuel ${Math.round(dash.fuel * 100)}%`);
      const warn = dash.flooding > .04 ? `TAKING WATER ${Math.round(dash.flooding * 100)}%` : dash.engineCondition <= .08 ? "ENGINE DAMAGED" : dash.handbrake ? "HANDBRAKE" : dash.brake > 0 ? "BRAKING" : "";
      if (warn || !lean) f.text(KEY_VEHICLE + 5, x + 12, y + 65, DASH_W - 24, warn ? S_WARNING : S_MENU_NOTE, warn || "W/S drive · A/D steer");
      if (lean) { if (!warn && dash.lightMode >= 0) f.text(KEY_VEHICLE + 6, x + 12, y + 65, DASH_W - 24, S_MENU_NOTE, `Lights · ${PATROL_LIGHT_MODES[dash.lightMode]}`); }
      else f.text(KEY_VEHICLE + 6, x + 12, y + 83, DASH_W - 24, S_MENU_NOTE, dash.flooding > .04 && dash.engineCondition <= .08 ? "E exit · Push ashore to repair" : dash.engineCondition <= .08 ? "F service · Repair engine" : dash.lightMode >= 0 ? `K / R3 lights · ${PATROL_LIGHT_MODES[dash.lightMode]}` : dash.thrusters ? "Shift boost · Q flip (+WASD)" : "Space brake · E exit");
      if (dash.thrusters) {
        // Two gauges a thruster car adds under its keys: each fills as its cooldown runs out, and a move with none shows lit.
        const row = y + (lean ? 83 : 101), half = (DASH_W - 30) / 2;
        const gauge = (k: number, at: number, name: string, ready: number, firing: boolean): void => {
          const full = ready < 0 || ready >= 1;
          f.text(KEY_VEHICLE + k, at, row, half, firing ? S_WARNING : full ? S_MENU_FOCUS : S_MENU_NOTE, firing ? `${name} !` : name);
          f.add(KEY_VEHICLE + k + 1, K_BAR, at, row + 16, half, 4, firing ? S_WARNING : full ? S_OXYGEN : S_MENU_FOCUS).value = ready < 0 ? 1 : Math.max(0, Math.min(1, ready));
        };
        gauge(12, x + 12, lean ? "Boost" : "Boost · Shift", dash.boostReady, dash.boosting);
        gauge(14, x + 18 + half, lean ? "Flip" : "Flip · Q", dash.flipReady, dash.bursting);
      }
    }
    if (dash?.rotor) {
      const v = dash, x = dashX, y = dashY, line = HELI_W - 24;
      glass(f, KEY_VEHICLE, x, y, HELI_W, dashH);
      f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(v.speed * 3.6).toString().padStart(3, "0"));
      f.text(KEY_VEHICLE + 10, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
      f.text(KEY_VEHICLE + 1, x + HELI_W - 104, y + 15, 92, v.recovery ? S_WARNING : S_MENU_NOTE, v.recovery ? "RECOVERING" : v.direct ? "DIRECT" : "ASSISTED");
      f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, line, 3, S_MENU_FOCUS).value = Math.min(1, v.rpm / v.redline);
      f.text(KEY_VEHICLE + 3, x + 12, y + 47, line, S_MENU_NOTE, `Rotor ${Math.round(v.rpm)} rpm · Fuel ${Math.round(v.fuel * 100)}%`);
      f.text(KEY_VEHICLE + 4, x + 12, y + 65, line, S_MENU_NOTE, `${v.altitude.toFixed(1)} m AGL · ${v.vertical >= 0 ? "+" : ""}${v.vertical.toFixed(1)} m/s`);
      f.text(KEY_VEHICLE + 5, x + 12, y + 83, line, S_MENU_NOTE, `Collective ${Math.round(v.collective * 100)}% · ${v.engineOn ? "ENGINE ON" : "ENGINE OFF"}`);
      const worn = v.rotorCondition < .7 || v.engineCondition < .7;
      if (lean) f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, worn ? S_WARNING : S_MENU_NOTE, worn ? `Engine ${Math.round(v.engineCondition * 100)}% · Rotor ${Math.round(v.rotorCondition * 100)}%` : v.engineOn ? (v.grounded ? "On the ground" : "Land to get out") : "Hold the collective up to start");
      else {
        f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, worn ? S_WARNING : S_MENU_NOTE, worn ? `Engine ${Math.round(v.engineCondition * 100)}% · Rotor ${Math.round(v.rotorCondition * 100)}%` : "W/S pitch · A/D bank · Q/R yaw");
        f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, v.engineOn ? "Space/Ctrl collective · Shift agile" : "Hold Space to start and lift");
        f.text(KEY_VEHICLE + 8, x + 12, y + 137, line, S_MENU_NOTE, "C flight mode · Hold X recover");
        f.text(KEY_VEHICLE + 9, x + 12, y + 155, line, S_MENU_NOTE, v.grounded ? "V cockpit/chase · E exit" : "V cockpit/chase · Land to exit");
      }
    }
    if (dash?.boat) {
      const v = dash, x = dashX, y = dashY, line = BOAT_W - 24;
      glass(f, KEY_VEHICLE, x, y, BOAT_W, dashH);
      f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(v.speed * 1.94384).toString().padStart(2, "0"));
      f.text(KEY_VEHICLE + 10, x + 64, y + 15, 40, S_MENU_NOTE, "kn");
      f.text(KEY_VEHICLE + 1, x + BOAT_W - 104, y + 15, 92, S_MENU_NOTE, v.gear < 0 ? "REVERSE" : v.gear > 0 ? "AHEAD" : "NEUTRAL");
      f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, line, 3, S_MENU_FOCUS).value = Math.min(1, v.rpm / v.redline);
      f.text(KEY_VEHICLE + 3, x + 12, y + 47, line, S_MENU_NOTE, `${Math.round(v.rpm / 100) * 100} rpm · Fuel ${Math.round(v.fuel * 100)}%`);
      const alarm = v.capsized ? "CAPSIZED - E to escape" : v.flooding >= .5 ? `FLOODING ${Math.round(v.flooding * 100)}% - E to escape` : v.flooding > .04 ? `TAKING WATER ${Math.round(v.flooding * 100)}% - repair hull` : "";
      const escape = lean ? "get out" : "E to escape";
      const alarmed = alarm.replace("E to escape", escape);
      f.text(KEY_VEHICLE + 4, x + 12, y + 65, line, alarm ? S_WARNING : S_MENU_NOTE, alarmed || `Hull ${Math.round(v.hullCondition * 100)}% · Engine ${Math.round(v.engineCondition * 100)}%`);
      f.text(KEY_VEHICLE + 5, x + 12, y + 83, line, S_MENU_NOTE, v.precision ? "PRECISION THROTTLE" : v.engineOn ? "ENGINE ON" : lean ? "Push the stick to start the engine" : "W/S to start engine");
      if (!lean) {
        f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, S_MENU_NOTE, "W/S ahead/reverse · A/D steer");
        f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, "Space neutral · Shift precision");
        f.text(KEY_VEHICLE + 8, x + 12, y + 137, line, S_MENU_NOTE, "V helm/chase · Mouse look");
        f.text(KEY_VEHICLE + 9, x + 12, y + 155, line, S_MENU_NOTE, "E leave helm · F cargo/service");
      }
    }
  },
};
