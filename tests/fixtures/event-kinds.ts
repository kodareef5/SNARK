// Kinds of map event written against the module contract alone (server/api/event.ts), for the tests: one with no part at
// all, and one that falls. Between them and the UFO (modules/ufo.ts) the contract is shown not to be the UFO's shape.

import type { ModuleDef } from "../../server/api/module.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { number, whole } from "../../shared/mapevent/fields.ts";
import type { ColumnLook, CraftLook } from "../../shared/mapevent/parts.ts";

/**
 * A double-experience hour. It has no part: while it is live a flag is up, and experience is scaled on the bus. The
 * flag lives outside the bag, so `resume` puts it back after a restart; `start` does nothing but say, so a preview of it
 * changes nothing.
 */
export function xpHour(): ModuleDef {
  let factor = 0;
  return {
    name: "xp_hour",
    api: 1,
    setup(m) {
      m.on("xp.gain", (e) => {
        if (factor > 0) e.data.amount = (e.data.amount as number) * factor;
      });
      m.mapEvent({
        id: "xp_hour",
        label: "Double experience",
        about: "Every survivor gains more experience for a while.",
        tuning: {
          factor: number(2, { min: 1, max: 10, label: "experience times", help: "What each gain is multiplied by.", group: "Experience" }),
          minutes: whole(60, { min: 1, max: 600, unit: "min", label: "lasts", help: "Minutes from its coming.", group: "Experience" }),
        },
        notice: 10,
        schedules: [{ key: "xp.weekend", on: false, firstDelay: [3600, 7200], interval: [86400, 172800], maxLive: 1, hours: [18, 23], chance: 1 }],
        on: {
          start(run) {
            run.notice(`Double experience for ${run.tuned.minutes} minutes, in ${Math.round((run.start - run.called) / TICK_RATE)} seconds.`);
          },
          live(run) {
            factor = run.tuned.factor;
            run.phase("over", run.tuned.minutes * 60 * TICK_RATE);
          },
          phase: (run) => run.end("over"),
          end() {
            factor = 0;
          },
          resume(run) {
            if (run.state === "live") factor = run.tuned.factor;
          },
        },
      });
    },
  };
}

const ROCK: CraftLook = {
  pieces: [{ mesh: "core:event_disc", spin: 3 }],
  fallback: "core:event_disc",
  wreck: "",
  glow: 0xff7a20,
  broken: 0xffffff,
  ember: 0x401808,
  beam: null,
  smoke: { rgb: 0x3a3530, height: 180, wide: 8 },
  lean: 0,
  sound: "",
};
const WARNING: ColumnLook = { kind: "light", rgb: 0xff3020, height: 300, wide: 3, sound: "" };

/**
 * A meteor: a light marks where it will fall, it comes in fast and is brought down at once by its kind, and where it
 * comes to rest it leaves a crate of the drop book's tables.
 */
export function meteor(): ModuleDef {
  return {
    name: "meteor",
    api: 1,
    setup(m) {
      m.mapEvent({
        id: "meteor",
        label: "Meteor",
        about: "A rock falls from the sky where survivors are and leaves something worth digging out.",
        notice: 5,
        tuning: {
          damage: number(200, { min: 0, max: 2000, label: "impact damage", help: "At its middle.", group: "Impact" }),
          rolls: whole(1, { min: 1, max: 4, label: "rolls", help: "Tables rolled into its crate.", group: "Loot" }),
        },
        on: {
          start(run) {
            const at = run.near()[0] ?? { x: run.map.sizeX / 2, z: run.map.sizeZ / 2 };
            const x = Math.max(400, Math.min(run.map.sizeX - 400, at.x + run.rng.range(-30, 30)));
            const z = Math.max(400, Math.min(run.map.sizeZ - 400, at.z + run.rng.range(-30, 30)));
            const ground = run.map.ground(x, z);
            run.site({ x, z, column: WARNING });
            run.craft({
              name: "Meteor",
              points: [{ x: x - 230, y: ground + 500, z, speed: 150, low: false }, { x: x - 80, y: ground + 260, z, speed: 150, low: false }],
              hull: { radius: 2, half: 2 },
              health: 1,
              look: ROCK,
              fall: { gravity: 30, bleed: 0 },
              crash: { radius: 10, damage: run.tuned.damage },
            });
          },
          live(run) {
            const rock = run.parts().find((p) => p.type === "craft");
            if (rock) run.down(rock.id);
          },
          craftRest(run, _craft, at) {
            for (const p of run.parts()) if (p.type === "site") run.remove(p.id);
            const crate = run.crate({ name: "Meteorite", x: at.x + 4, z: at.z, seconds: 600, loot: { tier: "red", classes: ["works", "arms"], rolls: run.tuned.rolls, ringed: false } });
            if (crate === 0) run.end("dust");
          },
          crateEmptied: (run) => run.end("looted"),
          crateGone: (run, _crate, why) => run.end(why),
        },
      });
    },
  };
}

export interface TargetOptions {
  /** Where it hangs: the middle of its slow pass, and how high. */
  x: number;
  z: number;
  y: number;
  /** Metres a second it drifts east, and seconds its pass takes. */
  speed?: number;
  seconds?: number;
  health?: number;
  shield?: boolean;
  /** Its crash's damage; 0 for no blast. */
  crash?: number;
  /** Seconds its crate stays. */
  crateSeconds?: number;
}

/**
 * A shielded craft that drifts slowly over a place, low enough to shoot from the ground, for the tests of rounds,
 * blasts and missiles. Brought down, it leaves a crate; flown out, it ends.
 */
export function target(o: TargetOptions): ModuleDef {
  const speed = o.speed ?? 1;
  const half = (speed * (o.seconds ?? 120)) / 2;
  return {
    name: "target",
    api: 1,
    setup(m) {
      m.mapEvent({
        id: "target",
        label: "Target",
        about: "A craft that hangs over a place.",
        notice: 1,
        tuning: {},
        on: {
          start(run) {
            run.craft({
              name: "Target",
              points: [{ x: o.x - half, y: o.y, z: o.z, speed, low: false }, { x: o.x, y: o.y, z: o.z, speed, low: false }, { x: o.x + half, y: o.y, z: o.z, speed, low: false }],
              hull: { radius: 5, half: 2 },
              health: o.health ?? 3000,
              lockable: true,
              takes: { melee: 0 },
              ...(o.shield === false ? {} : { shield: { soak: 0.97, openWhenLow: false, breakSeconds: 4, rearmSeconds: 12 } }),
              ...((o.crash ?? 300) > 0 ? { crash: { radius: 10, damage: o.crash ?? 300 } } : {}),
              look: ROCK,
            });
          },
          craftOut: (run) => run.end("left"),
          craftRest(run, _craft, at) {
            run.crate({ name: "Wreckage", x: at.x - at.hx * 8, z: at.z - at.hz * 8, seconds: o.crateSeconds ?? 600, loot: { tier: "white", classes: ["arms"], rolls: 1, ringed: false } });
          },
          crateEmptied: (run) => run.end("looted"),
          crateGone: (run, _crate, why) => run.end(why),
        },
      });
    },
  };
}
