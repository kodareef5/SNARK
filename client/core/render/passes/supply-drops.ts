// The supply pass draws each beacon and animates capsules that have a model.
import type { Registry } from "../../../../shared/content/registry.ts";
import type { Assets } from "../../assets/assets.ts";
import type { Details } from "../../details/details.ts";
import type { Frame, Pass } from "../pass.ts";
import { TICK_RATE } from "../../../../shared/coords.ts";
import type { SupplyView } from "../../supply.ts";
import { JET_REACH, WASH_EVERY, WASH_HEIGHT, bellAt, jetLength, squash, TRAIL_MOST, TRAIL_REACH, alongBone, CAPSULE, CAPSULE_REACH, HOOP_RATE, PIECE, PIECES as CAPSULE_PIECES, SHAFTS_MOST, SLAT_REACH, collarBone, fixedBone, hatchBone, hoopBone, legBone, markBone, slatBone, uprightBone, type CapsuleStance } from "../supply.ts";
import { packEffect } from "../supply-light.ts";
import { TRAIL_SECONDS } from "../supply-sky.ts";
import { MARKS, POSE_COMING, POSE_FLYING, POSE_GONE, POSE_LANDED, newPose, supplyPose } from "../../../../shared/sim/supply.ts";
import { nearestColour } from "../../../../shared/pack/palette.ts";
import { SupplyBeacons } from "../supply-beacon.ts";
import { BONE_FLOATS, DRAW_EMISSIVE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";

export class SupplyDrops implements Pass {
  /** The supply drops live on the map, drawn from the list the server tells (client/core/supply.ts). The app sets it (Scene.supply). */
  view: SupplyView | null = null;
  /** The capsule's pieces' meshes in the order of supply.ts PIECES, and the kind of the server's prop, which the model stands in for (-1 with no model). */
  private readonly mesh: Int32Array;
  readonly kind: number;
  private readonly stance: CapsuleStance = { x: 0, y: 0, z: 0, yaw: 0, legs: 0, shutters: 0, hatch: 0, hoop: 0 };
  private readonly pose = newPose();
  private readonly rows = new Float32Array(BONE_FLOATS);
  private readonly tints = new Map<number, number>();
  readonly beacons = new SupplyBeacons();
  private readonly bell = new Float32Array(3);
  /** By drop: the tick its jets last raised dust, and the state it was last seen in, for the burst as it lands. */
  private readonly wash = new Map<number, number>();
  private readonly state = new Map<number, number>();
  /** The palette colour nearest the tier of the capsule being drawn: its glass's dye. */
  private dye = 0;
  private readonly radius: Float32Array;
  private readonly palette: Uint8Array;
  private readonly details: Details;
  /** The frame being drawn, for `piece`. */
  private f!: Frame;

  /** `palette` is the pack's colours, four bytes each, and `details` takes the dust its jets raise. */
  constructor(reg: Registry, assets: Assets, palette: Uint8Array, details: Details) {
    // The capsule's pieces (supply.ts), each -1 in a pack without its model, which draws the stand-in.
    this.mesh = Int32Array.from(CAPSULE_PIECES, (piece) => assets.table.find("core:supply_capsule/" + piece));
    this.kind = this.mesh[0]! >= 0 ? (reg.index.get("core:supply_capsule") ?? -1) : -1;
    this.radius = assets.table.radius;
    this.palette = palette;
    this.details = details;
  }

  /**
   * The supply capsules, each from its drop's pose (shared/sim/supply.ts) and in pieces, each piece a draw with one
   * bone (supply.ts): the hull, its legs folding out as it brakes, the louvres' slats opening one after another once it
   * stands, the hatch ajar once it has been opened, a collar for each step of its tier, its class's top-mark, the hoop
   * of a ringed one turning, and its own lit strips, which take the drop's effect. Past CAPSULE_REACH its shaft is all
   * there is of it.
   */
  draw(f: Frame): void {
    const view = this.view;
    if (!view) return;
    view.capsules = view.shafts = 0;
    view.modelled = this.kind >= 0;
    if (!view.list) return;
    this.f = f;
    const cam = f.cam;
    const list = view.list;
    const pose = this.pose, s = this.stance, rows = this.rows;
    const seconds = view.tick / TICK_RATE;
    // What is kept by drop is let go with its drop.
    if (this.state.size > list.rows.length + 8) {
      this.state.clear();
      this.wash.clear();
    }
    for (const row of list.rows) {
      supplyPose(row, view.tick, TICK_RATE, pose);
      if (pose.state === POSE_GONE) continue;
      const tier = list.tiers[row.tier];
      const rgb = tier?.rgb ?? 0xffffff;
      if (pose.shaft > 0 && view.shafts < SHAFTS_MOST) {
        const lamp = view.modelled ? CAPSULE.mast.lamp : 2.2;
        const sink = view.modelled && pose.state === POSE_LANDED ? squash(pose.since) : 0;
        if (this.beacons.add(f, row.x - cam.x, row.y + lamp - sink - cam.y, row.z - cam.z, pose.shaftHeight, pose.shaft, rgb, row.ringed)) view.shafts++;
      }
      if (!view.modelled || pose.state === POSE_COMING) continue;
      s.x = pose.x - cam.x;
      s.y = pose.y - cam.y;
      s.z = pose.z - cam.z;
      const far = Math.hypot(s.x, s.y, s.z);
      if (pose.state === POSE_FLYING && (far < TRAIL_REACH || s.y < -0.01 * far) && far < cam.far * 0.9) {
        // In flight it trails light. The sky's streak is this from afar (supply-sky.ts); near, and from above where
        // the sky is not behind it, it is a plume turned to lie along the way it came.
        const speed = pose.speed, along = pose.along;
        const hx = pose.x, hy = pose.y, hz = pose.z;
        supplyPose(row, Math.max(row.release, view.tick - TRAIL_SECONDS * TICK_RATE * 0.2), TICK_RATE, pose);
        const wx = hx - pose.x, wy = hy - pose.y, wz = hz - pose.z, went = Math.hypot(wx, wy, wz);
        if (went > 0.01) {
          const wide = Math.max(0.8, far * 0.0016) / 0.11;
          f.put.effect[0] = seconds;
          f.put.effect[1] = rgb;
          f.put.effect[2] = Math.min(1, (view.tick - row.release) / (0.5 * TICK_RATE)) * (1 - Math.max(0, (along - 0.93) / 0.07));
          f.put.effect[3] = packEffect(tier?.count ?? 1, row.ringed, row.look);
          const long = Math.min(TRAIL_MOST, speed * 0.3);
          alongBone(rows, 0, s.x, s.y, s.z, wx / went, wy / went, wz / went, wide, long);
          this.piece(PIECE.jet, true, long, 0);
          f.put.effect.fill(0);
        }
        supplyPose(row, view.tick, TICK_RATE, pose);
      }
      if (far > CAPSULE_REACH || !cam.boxVisible(s.x - 1.6, s.y - 0.2, s.z - 1.6, s.x + 1.6, s.y + 2.9, s.z + 1.6)) continue;
      // Its jets: a plume under each bell while it brakes, a moment after it stands, and as it goes; and the dust they
      // raise while they play on the ground, with a burst as it touches down.
      const over = pose.y - row.y;
      if (pose.thrust > 0.01 && far < JET_REACH) {
        s.yaw = (row.look / 256) * 2 * Math.PI;
        f.put.effect[0] = seconds;
        f.put.effect[1] = rgb;
        f.put.effect[3] = packEffect(tier?.count ?? 1, row.ringed, row.look);
        for (let k = 0; k < CAPSULE.legs; k++) {
          bellAt(this.bell, s, k);
          const long = jetLength(pose.thrust, seconds, k, over + CAPSULE.bells.exit);
          f.put.effect[2] = pose.thrust;
          uprightBone(rows, 0, this.bell[0]!, this.bell[1]!, this.bell[2]!, 1 + 0.5 * pose.thrust, long);
          this.piece(PIECE.jet, true, long + 1, 0);
        }
        f.put.effect.fill(0);
        if (over < WASH_HEIGHT && view.tick - (this.wash.get(row.id) ?? -Infinity) > WASH_EVERY * TICK_RATE) {
          this.wash.set(row.id, view.tick);
          this.details.groundDust(row.id, row.x, row.y, row.z, view.tick, 1.2 + 1.6 * (1 - over / WASH_HEIGHT), 3, 6);
        }
      }
      if (far < JET_REACH) {
        // The touchdown itself, once, as it is seen to land.
        const was = this.state.get(row.id);
        if (was !== undefined && was !== POSE_LANDED && pose.state === POSE_LANDED && pose.since < 0.5) this.details.groundDust(row.id + 65536, row.x, row.y, row.z, view.tick, 2.6, 22, 30);
        this.state.set(row.id, pose.state);
      }
      // It sinks on its legs as it takes its weight, and comes up again.
      if (pose.state === POSE_LANDED) s.y -= squash(pose.since);
      let dye = this.tints.get(rgb);
      if (dye === undefined) this.tints.set(rgb, (dye = nearestColour(this.palette, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)));
      this.dye = dye;
      s.yaw = (row.look / 256) * 2 * Math.PI;
      s.legs = pose.legs;
      s.shutters = pose.shutters;
      s.hatch = row.opened && pose.state === POSE_LANDED ? Math.min(1, Math.max(0, pose.since)) : 0;
      s.hoop = (view.tick / TICK_RATE) * HOOP_RATE + row.look;
      view.capsules++;
      fixedBone(rows, 0, s);
      this.piece(0);
      for (let k = 0; k < CAPSULE.legs; k++) {
        legBone(rows, 0, s, k);
        this.piece(1);
      }
      if (far < SLAT_REACH) {
        for (let k = 0; k < CAPSULE.legs; k++) for (let j = 0; j < CAPSULE.lantern.slats; j++) {
          slatBone(rows, 0, s, k, j);
          this.piece(2);
        }
      }
      hatchBone(rows, 0, s);
      this.piece(3);
      const count = Math.min(CAPSULE.collar.most, tier?.count ?? 1);
      for (let k = 0; k < count; k++) {
        collarBone(rows, 0, s, k);
        this.piece(4);
      }
      if (row.ringed) {
        hoopBone(rows, 0, s);
        this.piece(5);
      }
      const worn = list.classes[row.cls]?.mark ?? 0;
      markBone(rows, 0, s);
      this.piece(PIECE.mark + (worn < MARKS.length ? worn : 0));
      // Its lit strips: the seconds since it landed, its colour, how far its lantern is open, and its count.
      f.put.effect[0] = (view.tick - row.land) / TICK_RATE;
      f.put.effect[1] = rgb;
      f.put.effect[2] = pose.shutters;
      f.put.effect[3] = packEffect(tier?.count ?? 1, row.ringed, row.look);
      fixedBone(rows, 0, s);
      this.piece(6, true);
      f.put.effect.fill(0);
    }
  }

  /**
   * Draws piece `which` on the bone in `rows`, and says whether it is in the view and was drawn. `size` is how many times
   * its modelled size a piece of light is drawn, and `tall` how far up from its origin it reaches.
   */
  private piece(which: number, glow = false, size = 1, tall = 0): boolean {
    const f = this.f, p = f.packet, cam = f.cam, rows = this.rows;
    const m = this.mesh[which]!;
    if (m < 0 || p.transientCount >= p.transientIds.length || p.drawCount + f.put.doubled >= MAX_DRAWS || p.boneCount >= Math.min(p.tier.bones, MAX_BONES)) return false;
    const cx = rows[3]!, cy = rows[7]! + tall / 2, cz = rows[11]!;
    const r = (this.radius[m]! + 0.5) * size;
    const up = Math.max(r, tall / 2);
    if (!cam.boxVisible(cx - r, cy - up, cz - r, cx + r, cy + up, cz + r)) return false;
    const first = p.transientCount++;
    const distance = Math.max(1, Math.hypot(cx, rows[7]!, cz) - r) / size;
    const level = f.assets.choose(f.assets.table.error[m]!, distance, -1);
    f.assets.wantTextured(m, level, distance);
    const bone = p.boneCount++;
    p.bones.set(rows, bone * BONE_FLOATS);
    f.transient.setSkinned(first, bone, this.dye);
    p.transientIds[first] = 0;
    f.put.draw(m, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_PLAIN | DRAW_SKINNED | (glow ? DRAW_EMISSIVE : 0), cam.passes(cx - r, cy - up, cz - r, cx + r, cy + up, cz + r));
    return true;
  }
}
