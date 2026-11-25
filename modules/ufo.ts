// The UFO (planning/workstreams/map-events.md): the first kind of map event, and a module like any other, written against
// the contract alone (server/api). It is heard coming, crosses the map high and fast, dips low with its beam on over
// where survivors are, and is hard to bring down: a shield that stops nearly all of a hit unless its beam is on or a
// blast has just broken it, and a great deal of health. Brought down, it falls, comes to rest in a blast, and leaves its
// core, which holds rolls of the drop book's best tables for anyone to take.

import type { ModuleDef } from "../server/api/module.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { flag, keys, number, range, share, text, whole, wholeRange } from "../shared/mapevent/fields.ts";
import type { CraftLook } from "../shared/mapevent/parts.ts";
import { planCrossing } from "./ufo/plan.ts";

const TOUGH = "Toughness";
const FLIGHT = "Flight";
const CORE = "Its core";

export const UFO_TUNING = {
  health: number(30000, { min: 1, max: 1e7, group: TOUGH, label: "health", help: "With two survivors in the world or fewer; up to three times this with six or more. One jet's full load is about 30,000 against it." }),
  shieldSoak: share(0.97, { group: TOUGH, label: "shield stops", help: "The share of a hit its shield stops while it is shut." }),
  breakSeconds: number(4, { min: 0, max: 120, unit: "s", group: TOUGH, label: "a blast opens it for", help: "Seconds a heavy blow (a rocket, C4, a grenade, a missile) opens its shield." }),
  rearmSeconds: number(12, { min: 0, max: 600, unit: "s", group: TOUGH, label: "then it holds for", help: "Seconds after that before another heavy blow can open it." }),
  noticeSeconds: number(45, { min: 0, max: 600, unit: "s", group: FLIGHT, label: "heard coming for", help: "Seconds from its call to its coming." }),
  cruiseSpeed: number(140, { min: 10, max: 250, unit: "m/s", group: FLIGHT, label: "cruise speed", help: "High and fast, most of its way." }),
  cruiseHeight: range([750, 1100], { min: 50, max: 2500, unit: "m", group: FLIGHT, label: "cruise height", help: "Metres over the highest thing under it. At 750 it is past a rifle's reach." }),
  scanSpeed: number(45, { min: 5, max: 250, unit: "m/s", group: FLIGHT, label: "low pass speed", help: "Low and slow, its beam on." }),
  scanHeight: range([120, 160], { min: 30, max: 600, unit: "m", group: FLIGHT, label: "low pass height", help: "Metres over the ground where it dips." }),
  points: wholeRange([9, 14], { min: 4, max: 22, group: FLIGHT, label: "points of its path", help: "Control points of its path, its ends and low passes among them." }),
  scans: wholeRange([1, 3], { min: 0, max: 6, group: FLIGHT, label: "low passes", help: "Each takes two points of its path." }),
  scanNear: number(1000, { min: 0, max: 20000, unit: "m", group: FLIGHT, label: "low passes within", help: "Metres from a survivor its low passes are put." }),
  lootTier: text("meridian", { group: CORE, label: "tier", help: "A tier of the drop book; its highest where it has no such tier.", most: 48 }),
  lootClasses: keys(["arms", "armour", "works", "voyage"], { most: 7, group: CORE, label: "classes", help: "Classes of the drop book, one drawn for each roll." }),
  lootRolls: whole(2, { min: 1, max: 4, group: CORE, label: "rolls", help: "Tables rolled into its core." }),
  lootRinged: flag(true, { group: CORE, label: "ringed", help: "Rolled as a ringed drop's are: the better entries." }),
  wreckSeconds: number(1800, { min: 30, max: 6 * 3600, unit: "s", group: CORE, label: "its wreck and core stay", help: "Seconds after it comes to rest, unless its core is emptied first." }),
};

/** The craft's look: its hull, its rim turning slowly and the ring under its belly fast, a cold cyan glow. */
export const UFO_LOOK: CraftLook = {
  pieces: [
    { mesh: "core:ufo_craft", spin: 0 },
    { mesh: "core:ufo_rim", spin: 0.3 },
    { mesh: "core:ufo_ring", spin: -5 },
  ],
  fallback: "core:event_disc",
  wreck: "core:ufo_wreck",
  glow: 0x40e8ff,
  broken: 0xf4f8ff,
  ember: 0x1a5a66,
  beam: { rgb: 0x40e8ff, wide: 14, drop: 2.4 },
  smoke: { rgb: 0x6a6660, height: 320, wide: 12 },
  lean: 1 / 900,
  sound: "core:ufo",
};

/** Its hull: an oblate spheroid 22 m across and 6.4 m through. */
export const UFO_HULL = { radius: 11, half: 3.2 };
/** Metres beyond its rim its core is thrown, back along the way it came. */
const CORE_THROW = 4;

export default {
  name: "ufo",
  api: 1,
  setup(m) {
    m.mapEvent({
      id: "ufo",
      label: "UFO",
      about: "An unidentified craft crosses the map, dips low over survivors with its beam on, and leaves its core when brought down. Its shield opens while its beam is on, or for a while after a blast.",
      tuning: UFO_TUNING,
      notice: (t) => t.noticeSeconds,
      maxSeconds: 24 * 3600,
      sound: "core:ufo",
      check: (t) => (t.scans[1] * 2 > t.points[0] - 2 ? [{ key: "scans", message: "each low pass takes two points of its path besides its ends: the most passes are half the least points less two" }] : []),
      schedules: [
        { key: "ufo.night", on: true, firstDelay: [900, 2400], interval: [2400, 4800], maxLive: 1, hours: [20, 5], chance: 0.8 },
        { key: "ufo.day", on: true, firstDelay: [1800, 3600], interval: [5400, 10800], maxLive: 1, hours: null, chance: 0.5 },
      ],
      on: {
        start(run) {
          const t = run.tuned;
          run.craft({
            name: "Unidentified craft",
            points: planCrossing(run.rng, t, run.map, run.near()),
            hull: UFO_HULL,
            // More health where more survivors are in the world to bring it down: up to three times, at six or more.
            health: Math.round(t.health * Math.min(3, Math.max(1, run.survivors() / 2))),
            takes: { melee: 0, pierce: 0.6, bullet: 1, fire: 0.5, explosive: 1.5 },
            shield: { soak: t.shieldSoak, openWhenLow: true, breakSeconds: t.breakSeconds, rearmSeconds: t.rearmSeconds },
            lockable: true,
            crash: { radius: 24, damage: 400 },
            look: UFO_LOOK,
          });
          run.notice("Radar contact: an unidentified craft is inbound.");
        },
        craftOut: (run) => run.end("left"),
        craftDown(run, _craft, by) {
          run.notice(by ? `The unidentified craft is going down! ${by.name} brought it down.` : "The unidentified craft is going down!");
        },
        craftRest(run, _craft, at) {
          const t = run.tuned;
          const far = UFO_HULL.radius + CORE_THROW;
          const x = at.hx === 0 && at.hz === 0 ? at.x + far : at.x - at.hx * far;
          const z = at.z - at.hz * far;
          const core = run.crate({ prop: "core:ufo_core", name: "Crashed craft's core", x, z, seconds: t.wreckSeconds, loot: { tier: t.lootTier, classes: t.lootClasses, rolls: t.lootRolls, ringed: t.lootRinged } });
          // Nothing rolled for its core: its wreck still lies there its time.
          if (core === 0) run.phase("cleared", Math.round(t.wreckSeconds * TICK_RATE));
        },
        phase: (run) => run.end("expired"),
        crateEmptied: (run) => run.end("looted"),
        crateGone: (run, _crate, why) => run.end(why),
      },
    });
  },
} satisfies ModuleDef;
