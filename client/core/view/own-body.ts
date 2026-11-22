// The own body as the scene draws it: the survivor as its prediction has it, or the mount or vehicle it steers. A row of
// the app's frame, after the sight has said whether the view is at the eye and before the camera is placed
// (director.ts).

import { creatureHold } from "../../../shared/sim/creature-actions.ts";
import { handleGen, handleIndex } from "../../../shared/ids.ts";
import { PI, TAU } from "../../../shared/math/scalar.ts";
import { glidePhase } from "../../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../../../shared/sim/items.ts";
import { FISTS, HOLD_CARRY } from "../../../shared/sim/weapon.ts";
import type { AppFrame } from "../frame.ts";
import { bodySeed } from "../render/scene.ts";
import type { Director } from "./director.ts";

export function ownBody(d: Director, f: AppFrame): void {
  const session = f.session, c = f.controls, r = f.remote, reg = f.reg, alive = f.alive, car = f.car, passenger = f.passenger;
  const body = (f.body = d.own);
  body.kind = session.ownKind;
  body.x = f.bx;
  body.y = f.by;
  body.z = f.bz;
  body.yaw = c.yaw;
  body.tick = session.tickClock;
  body.firstPerson = !(f.third && !d.view.atEye) && !f.chase;
  body.id = handleIndex(session.ownHandle);
  body.generation = handleGen(session.ownHandle);
  body.vehicle = undefined;
  body.cockpitActor = car && !f.third ? handleIndex(session.ownHandle) : undefined;
  if (passenger) {
    const at = (body.attachment = d.attachment);
    at.host = session.own.seat - 1; at.slot = session.own.seatSlot; at.generation = session.own.seatGen;
  } else body.attachment = undefined;
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
  body.state.setJet(session.own.jetThrust, session.own.jetGear);
  body.state.setGlide(session.own.glide !== 0, glidePhase(session.own.vx, session.own.vy, session.own.vz));
  // The action comes from the prediction, so a swing shows the moment it is asked for. Arms full hold what is in them.
  body.state.setAction(session.own.act, f.holding >= 0 ? HOLD_CARRY : (reg.weapon[session.own.held] ?? FISTS).hold, session.simTick - session.own.actTicks);
  body.state.seed = bodySeed(body.id);
  // An emote is the server's to say: the one it plays for this body, as the view has it.
  body.state.unpackEmote(0);
  for (let i = 0; i < r.count; i++) if (r.id[i] === body.id) body.state.unpackEmote(r.emote[i]!);
  // While riding, the mount is the body it predicts, drawn from the prediction and always from outside.
  // Its own body is then one more remote body, where the server has it on the seat.
  const riding = (f.riding = alive && session.driving >= 0);
  if (riding) {
    body.kind = session.bodyKind;
    body.yaw = car ? f.carYaw : (session.own.yaw / 65536) * TAU;
    if (car) body.vehicle = f.vehiclePose;
    body.firstPerson = false;
    body.id = session.driving;
    body.generation = 0;
    body.look = null;
    body.gear.fill(0);
    body.state.stance = 0;
    // Posed from what the server poses it from: the look as the input carries it, and a flyer's climb.
    body.state.setMotion(session.own.vx, session.own.vz, body.yaw, (Math.round((c.pitch / (PI / 2)) * 16384) * (PI / 2)) / 16384, session.own.vy);
    body.state.setAction(session.own.act, reg.combat[session.bodyKind] ? creatureHold(session.own) : 0, session.simTick - session.own.actTicks);
    body.state.seed = bodySeed(body.id);
    // The mount's colours, its saddle and its cues come from its remote copy.
    body.colors.fill(0);
    body.state.unpackCue(0);
    for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== session.driving) continue;
      if (body.vehicle) {
        body.vehicle.doors = r.vehicleDoors[i]!;
        body.vehicle.lightMode = r.vehicleLightMode[i]!;
      }
      body.generation = r.gen[i]!;
      for (let k = 0; k < 6; k++) body.colors[k] = r.colors[i * 6 + k]!;
      for (let k = 0; k < GEAR_COUNT; k++) body.gear[k] = r.gear[i * GEAR_COUNT + k]!;
      body.state.unpackCue(r.cue[i]!);
    }
  }
  f.scene.skip = riding ? session.driving : -1;
  f.scene.own = (alive && session.ownHandle !== 0 && session.driving < 0) || riding ? body : null;
}
