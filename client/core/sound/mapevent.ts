// What a map event is heard by (planning/workstreams/map-events.md). Nothing is sent for its sounds: each client hears
// it from the feed it is told (S_MAPEVENT) and the poses every party works out from its parts' ticks, at the tick its
// parts are drawn at, so what is heard keeps time with what is seen and a client that joins late hears only the rest.
//
// It is heard over the whole map when it is called. A craft in the sky hums from its way, louder as it is nearer, out
// to kilometres off; its beam sounds along it nearest the ear; its shield cracks when a heavy blow breaks it; brought
// down, it whines as it falls, and its coming to rest is heard as late as its distance makes it. An event that ends
// with nothing of it brought down is heard going. A look's owner's own takes play where the build has them.

import { TICK_RATE } from "../../../shared/coords.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { CRAFT_FALLING, CRAFT_FLYING, CRAFT_REST, poseOf } from "../mapevent/craft.ts";
import type { ShownCraft, ShownSite } from "../mapevent/shown.ts";
import type { Hear } from "./bodies.ts";
import type { Ear } from "./mixer.ts";
import type { OwnedLoop } from "./sounds.ts";

export const K = {
  notice: cueKey("event/notice"),
  gone: cueKey("event/gone"),
  hum: cueKey("craft/hum"),
  beam: cueKey("craft/beam"),
  shield: cueKey("craft/shield"),
  fall: cueKey("craft/fall"),
  impact: cueKey("craft/impact"),
};

/** Who an event's sounds are asked of where its look names none: an owner with no takes, so each cue's fallback plays. */
export const EVENT_OWNER = "core:event";
/** The first of the loops' numbers that are the events': four a part, its hum's, its beam's and its fall's. */
export const MAPEVENT_LOOPS = 50_000_000;
/** Metres a second sound travels: how late a coming to rest is heard. */
export const SOUND_SPEED = 343;
/** Seconds at the most a coming to rest is held back, however far it is; and how long after it a client told of it still hears it. */
export const IMPACT_LATEST = 12;
const IMPACT_FRESH = 2;
/** Seconds an event may have been called for its notice still to be heard by a client that has just been told of it. */
export const NOTICE_FRESH = 5;
/** Metres beyond which a hum or a fall is not heard, fading to nothing there from full within NEAR. */
export const HUM_REACH = 5000;
const NEAR = 250;
/** Metres the beam is heard along under its craft at the most. */
const BEAM_LONGEST = 2000;

/** How loud a hum `far` metres off is: full near and nothing at HUM_REACH. */
export const loudness = (far: number): number => (far <= NEAR ? 1 : far >= HUM_REACH ? 0 : ((HUM_REACH - far) / (HUM_REACH - NEAR)) ** 2);

/** What a part was last heard doing. */
interface PartHeard {
  state: number;
  shield: number;
  landed: boolean;
  owner: number;
}

/** What a part's hearing is given each frame, and what is kept of each part between frames. */
export class EventEars {
  ear: Readonly<Ear> = { x: 0, y: 0, z: 0 };
  owner: (id: string) => number = () => -1;
  hear: Hear = () => {};
  loop: OwnedLoop = () => {};
  /** By part key. */
  readonly heard = new Map<number, PartHeard>();
}

export function hearCraft(h: EventEars, c: ShownCraft, tick: number): void {
  const state = poseOf(c, tick), pose = c.at, row = c.row, ear = h.ear;
  let was = h.heard.get(c.key);
  if (!was) {
    // Just told of it: nothing it did before is heard, but a coming to rest a moment ago is.
    was = { state, shield: row.shieldUntil, landed: state === CRAFT_REST && tick - row.impact >= IMPACT_FRESH * TICK_RATE, owner: h.owner(c.look.sound || c.event.sound || EVENT_OWNER) };
    h.heard.set(c.key, was);
  }
  const dx = pose.x - ear.x, dy = pose.y - ear.y, dz = pose.z - ear.z;
  const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let hum = 0, fall = 0, beam = 0;
  if (state === CRAFT_FLYING) {
    hum = loudness(far);
    beam = c.look.beam ? pose.low : 0;
    if (row.shieldUntil > was.shield && tick < row.shieldUntil) h.hear(was.owner, K.shield, -1, pose.x, pose.y, pose.z, 0, 1, false);
  } else if (state === CRAFT_FALLING) fall = loudness(far);
  else if (state === CRAFT_REST && !was.landed) {
    was.landed = true;
    h.hear(was.owner, K.impact, -1, 0, 0, 0, 0, Math.max(0.15, loudness(far * 0.5)), true, Math.min(IMPACT_LATEST, far / SOUND_SPEED));
  }
  was.shield = row.shieldUntil;
  was.state = state;
  const base = MAPEVENT_LOOPS + c.key * 4;
  // The hum and the fall are heard from its way, a metre off, as loud as its distance makes them, however far.
  const k = far > 1 ? 1 / far : 0;
  const nx = ear.x + dx * k, ny = ear.y + dy * k, nz = ear.z + dz * k;
  h.loop(base, was.owner, K.hum, nx, ny, nz, hum, hum > 0.01, false);
  h.loop(base + 2, was.owner, K.fall, nx, ny, nz, fall, fall > 0.01, false);
  const top = pose.y - (c.look.beam?.drop ?? 0);
  h.loop(base + 1, was.owner, K.beam, pose.x, Math.max(top - BEAM_LONGEST, Math.min(top, ear.y)), pose.z, beam, beam > 0.02, false);
}

/** A column makes no sound of its own yet. */
export function hearSite(_h: EventEars, _s: ShownSite, _tick: number): void {}
