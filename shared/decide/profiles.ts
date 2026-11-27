// The first profiles. A ring's candidates are headings evenly round the mover in the world's own frame: candidate 0 looks
// along +Z (north), and they count clockwise from above. A ring is never in the mover's frame, so passes sampled at
// different moments line up however it has turned since; `held` says which way it now goes. Columns are 0 to 1 unless
// said, and 0 where a thing is absent. `span` and `soon` are in units.ts.

import { profile, type Profile } from "./profile.ts";

/** What the mover is about, one of them 1: wander, seek a place, flee a threat, chase prey, follow a leader. */
const MODE = ["wander", "seek", "flee", "chase", "follow"] as const;
/** How deep in trouble it is: 0 calm, a third wary, two thirds stuck, 1 a patient escape. */
const RUNG = "rung";

/**
 * The far pass: where the heading leads. Each column is the cosine between the heading and a bearing, -1 to 1, by how
 * much that bearing matters now (0 where there is none): the goal, the next point of its way, a threat (nearer is more),
 * the point to cut prey off at, the place it calls home, and the way back along its own trail. `pull` is what pins and
 * objectives add along the heading, -1 to 1.
 */
export const RING_FAR = profile("ring.far", "choice", true,
  [...MODE, RUNG, "goalSoon", "threatSoon"],
  ["goal", "way", "threat", "prey", "home", "trail", "pull", "held", "tried"],
  [["flee", "threat"], ["chase", "prey"], ["wander", "home"], [RUNG, "goal"], [RUNG, "trail"], [RUNG, "tried"]]);

/**
 * The mid pass: what the next few seconds along the heading hold. `run` and `runHigh` are the free run at knee and at
 * chest height, as a share of what it covers in `MID_SECONDS`. `drop` and `rise` are how far the ground falls and
 * climbs along it, in spans, a share of `MID_SPANS`. `wet` is how far along it lies under any water, and `swum` how far
 * under water deep enough that this body swims rather than wades, each in spans, a share of `MID_SPANS`, not the
 * water's depth. `hurt` is 1 where the run crosses ground that harms. `crowd` is other bodies along it, a share of four.
 * In the state, `swim` is how fast this body swims against its walk: a half where the two are alike, more for one that
 * swims faster.
 */
export const RING_MID = profile("ring.mid", "choice", true,
  [...MODE, RUNG, "pace", "stuck", "swim"],
  ["run", "runHigh", "drop", "rise", "wet", "swum", "hurt", "crowd", "held", "tried"],
  [[RUNG, "run"], [RUNG, "drop"], [RUNG, "wet"], [RUNG, "swum"], ["swim", "swum"], [RUNG, "hurt"], ["stuck", "tried"], ["flee", "run"], ["chase", "run"]]);

/**
 * The near pass: what is within `NEAR_SPANS` of the body. `open` is the free run along the heading, a share of that
 * reach. `pressed` is how squarely the heading faces what it is pressed against. `body` is 1 where another body stands
 * in it.
 */
export const RING_NEAR = profile("ring.near", "choice", true,
  [RUNG, "pace", "stuck", "pinned"],
  ["open", "pressed", "body", "held", "tried"],
  [["pinned", "pressed"], ["stuck", "open"], [RUNG, "body"]]);

/** Seconds the mid pass looks along a heading, and the spans its drops, rises and water are measured against. */
export const MID_SECONDS = 3;
export const MID_SPANS = 4;
/** Spans the near pass looks. */
export const NEAR_SPANS = 2;

/**
 * Will this mover make no real progress over the next `SNAG_SECONDS`? Read from cheap numbers only: its pace against
 * what it asked for, its gain toward the goal over the last one, two and four thinks as a share of what its pace would
 * give, how long it has been stuck or pinned, whether it follows a found way or was told there is none, and how soon
 * it would arrive.
 */
export const SNAG = profile("nav.snag", "yes", false, [],
  [...MODE, "pace", "gain1", "gain2", "gain4", "stuck", "pinned", "onWay", "noWay", "goalSoon"]);
export const SNAG_SECONDS = 2;

/**
 * Will the heading just picked free a stuck mover within `SURE_SECONDS`? Read from the pick itself: its free run near
 * and further, what it would cost in pain, whether it was tried, how long the mover has been stuck, and `ways`, the
 * share of headings that were open to it at all. Its probability among the headings (`top`) and its lead over the next
 * are given too, but they say little alone: the only way out of a sealed pen has all the probability and frees no one.
 */
export const SURE = profile("nav.sure", "yes", false, [],
  [RUNG, "ways", "top", "lead", "open", "run", "price", "tried", "stuckSoon"]);
export const SURE_SECONDS = 4;

/**
 * Will this mover arrive within the time its goal was given? Read when the goal is set and at each think: how soon in a
 * straight line and along its way, whether the line is blocked, whether a way is known or was refused, how many times
 * it has been stuck on this leg (a share of four), and how much of its time is gone.
 */
export const REACH = profile("nav.reach", "yes", false, [],
  [...MODE, "lineSoon", "waySoon", "blocked", "onWay", "noWay", "stucks", "spent"]);

/**
 * A calm wanderer's look before it walks: the heading it drew and one either side of it, which are not neighbours in a
 * ring. `run` and `runHigh` are the free run at knee and at chest height as a share of what it walks in `PROBE_SECONDS`.
 * `drawn` is 1 for the heading it drew, and `facing` the cosine between a heading and the way it faces now.
 */
export const PROBE = profile("nav.probe", "choice", false, [], ["run", "runHigh", "drawn", "facing"]);
export const PROBE_SECONDS = 2;

/** What kind of place a candidate is, one of them 1, in the order of WAYPOINT_KINDS (shared/world/course.ts). */
const PLACE = ["isGo", "isDanger", "isEnemy", "isResource", "isMeet"] as const;

/**
 * Which of an objective's choices to make for next. `priority` is its author's, a share of the highest allowed. `pull` is
 * -1 to 1: its own and that of the mover's tribe's pins it lies in. `travelSoon` is the seconds there at the mover's pace;
 * `byWay` is 1 where they were measured along a way found, 0 where they are the straight line's. `noWay` is 1 where a
 * search found that no way leads there. `danger` is how much of the way lies in a pin that repels, by its pull. A detour
 * (`detour` 1) stands for the way to its aim through it: its priority, seconds and `noWay` are the aim's, `extraSoon` is
 * the seconds it adds and `worth` the seconds it is worth, both pressed by the same half, so a detour that adds less
 * than it is worth scores more. `current` is 1 for the aim kept from before a detour.
 */
export const PICK = profile("nav.pick", "choice", false, [],
  [...PLACE, "priority", "pull", "travelSoon", "byWay", "noWay", "danger", "worth", "detour", "extraSoon", "current"]);
/** Seconds at which a trip's `travelSoon` is a half, and a detour's `worth` and `extraSoon`. */
export const PICK_HALF = 20;
export const DETOUR_HALF = 10;

/** What an action changes, one of them 1. `none` is to do nothing but keep moving. */
const EFFECT = ["over", "through", "removes", "opens", "medium", "harms", "calls", "waits", "none"] as const;

/**
 * Which of the things it can do would help most now. A row describes an action and never names it: what it changes; its
 * price in seconds, stamina, health, wear on an item and noise; its reach in spans, a share of `MID_SPANS`; how soon it
 * is ready and in hand; and `fits`, how well it meets what is in the way. The state says what is in the way: how tall in
 * spans, whether it can be harmed, whether it is water, and how near a threat is.
 */
export const DO = profile("do", "choice", false,
  [...MODE, RUNG, "stuckSoon", "tall", "soft", "water", "threatSoon"],
  [...EFFECT, "seconds", "stamina", "health", "wear", "noise", "reach", "readySoon", "handSoon", "fits"],
  [[RUNG, "fits"], ["stuckSoon", "fits"], ["tall", "over"], ["soft", "removes"], ["soft", "through"], ["water", "medium"], ["threatSoon", "harms"], ["threatSoon", "waits"]]);

export const PROFILES: readonly Profile[] = [RING_FAR, RING_MID, RING_NEAR, SNAG, SURE, REACH, PROBE, PICK, DO];

/** Where each mode's 1 goes in a profile's state or columns. */
export const MODES = MODE;
