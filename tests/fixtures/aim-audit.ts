// Draws one survivor in nine kinds of motion from five sides, casts a ray through every pixel, and counts how the zone
// drawn agrees with the zone hit. Shared by the drawn-equals-hit tests (tests/combat/render-aim*.test.ts).

import { bodySeed } from "../../client/core/render/scene.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, HUMAN_ZONE_COUNT, ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_BEARD, LOOK_BYTES, LOOK_HAIR, LOOK_SEX, randomLook, REGION_COUNT, REGIONS, setRegion } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { humanHitPose, rayBody, zoneOfBone } from "../../shared/anim/zones.ts";
import { Rng } from "../../shared/rng.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { PICK_ENTITY, PICK_STRUCTURE } from "../../tools/snap/raster.ts";

export const AIM_SIZE = 128;

/** speed, direction, pitch, mode, stance, grounded: standing, walking, running, strafing, backing, falling, crouched, prone, swimming. */
export const AIM_STATES: readonly (readonly [number, number, number, number, number, boolean])[] = [
  [0, 0, 0, 1, 0, true], [7, 0, 0, 1, 0, true], [12, 0, 10, 1, 0, true], [7, 5, -12, 1, 0, true], [7, 8, 0, 1, 0, true],
  [0, 0, 0, 1, 0, false], [2, 0, 0, 1, STANCE_CROUCH, true], [1, 0, 8, 1, STANCE_PRONE, true], [4, 0, 14, 2, 0, false],
];
/** From the front, a side, behind, above and below: the camera's turn about the body and its rise, in radians. */
export const AIM_SIDES: readonly (readonly [number, number])[] = [[0, 0.1], [1.4, 0.2], [3.3, 0.05], [4.6, 0.9], [0.7, -0.25]];

export interface AimCount {
  /** drawn[z] counts pixels showing zone z, and agreed[z] those where a ray through the pixel finds zone z too. */
  drawn: Uint32Array;
  agreed: Uint32Array;
  /** Body pixels whose ray meets no capsule. */
  missed: number;
  /** Hits on pixels where no body or structure is drawn. */
  phantom: number;
  /** Pixels with no body whose ray hits nothing. */
  empty: number;
  /** Sampled rays where the body posed once a shot is hit apart from the body rayBody poses itself. */
  unlike: number;
}

export interface AimShares {
  head: number;
  body: number;
  missed: number;
  spill: number;
  /** The zone that agrees least, and by how much. */
  worst: string;
  worstShare: number;
}

/** What a body is held to: shares of head and body pixels that agree, above; body pixels that miss and spill, below. */
export interface AimHeld {
  head: number;
  body: number;
  missed: number;
  spill: number;
  /** The least share any one zone may agree by. */
  zone: number;
}

/** The thresholds of planning/architecture/animation.md. */
export const AIM_MALE: AimHeld = { head: 0.965, body: 0.88, missed: 0.02, spill: 0.3, zone: 0.78 };
/** Her narrower shoulders and arms sit inside capsules sized for his: her shares on MakeHuman's body, with a little room. */
export const AIM_FEMALE: AimHeld = { head: 0.965, body: 0.875, missed: 0.02, spill: 0.365, zone: 0.7 };

export function aimShares(c: AimCount): AimShares {
  let all = 0, agreed = 0, worst = "", worstShare = 2;
  for (let z = 1; z < HUMAN_ZONE_COUNT; z++) {
    all += c.drawn[z]!;
    agreed += c.agreed[z]!;
    const share = c.drawn[z]! > 0 ? c.agreed[z]! / c.drawn[z]! : 0;
    if (share < worstShare) { worst = ZONE_NAMES[z]!; worstShare = share; }
  }
  return { head: c.agreed[ZONE_HEAD]! / c.drawn[ZONE_HEAD]!, body: agreed / all, missed: c.missed / all, spill: c.phantom / all, worst, worstShare };
}

/** The proving ground at the audit's size. A look takes a view of its own, so no gait carries over from another. */
export function aimView(): ProvingView {
  return provingView(AIM_SIZE, AIM_SIZE);
}

/**
 * Counts for the proving ground's survivor drawn with `look`, or with none. `states` and `sides` pick from AIM_STATES and
 * AIM_SIDES; each shot keeps the tick and facing it has in the full set, so a subset is the same pictures.
 */
export function aimAudit(view: ProvingView, look: Uint8Array | null, states: readonly number[] = AIM_STATES.map((_, i) => i), sides: readonly number[] = AIM_SIDES.map((_, i) => i)): AimCount {
  const { raster, remote, cam } = view, anim = view.scene.characters.anim;
  remote.count = 1;
  remote.hasLook[0] = look ? 1 : 0;
  if (look) remote.look.set(look.subarray(0, LOOK_BYTES), 0);
  const id = remote.id[0]!, bx = remote.x[0]!, by = remote.y[0]!, bz = remote.z[0]!;
  const out = emptyCount();
  const st = new AnimState(), dir = [0, 0, 0], pose = new Pose(HUMAN_BONES), posed = new Solved(HUMAN_BONES);
  for (const s of states) {
    const [speed, dirTo, pitch, mode, stance, grounded] = AIM_STATES[s]!;
    st.speed = speed; st.dir = dirTo; st.pitch = pitch; st.mode = mode; st.stance = stance; st.grounded = grounded;
    remote.anim[0] = st.pack();
    remote.flags[0] = grounded ? 1 : 0;
    st.seed = bodySeed(id);
    for (const v of sides) {
      const [around, up] = AIM_SIDES[v]!, shot = s * AIM_SIDES.length + v;
      const tick = shot * 7.3;
      const yawUnits = (shot * 9973) & 0xffc0; // a facing the 10-bit wire yaw can carry exactly
      remote.tick = tick;
      remote.yaw[0] = (yawUnits / 65536) * Math.PI * 2;
      const reach = 4;
      cam.x = bx + Math.sin(around) * Math.cos(up) * reach;
      cam.z = bz + Math.cos(around) * Math.cos(up) * reach;
      cam.y = by + 0.9 + Math.sin(up) * reach;
      cam.yaw = around + Math.PI;
      cam.pitch = -up;
      cam.fovY = 0.7;
      cam.aspect = 1;
      view.render();
      // Posed once for the shot as rayBody poses it for each ray, which every 61st ray checks.
      humanHitPose(anim, st, tick, bx, by, bz, yawUnits, null, pose);
      solve(HUMAN, pose, posed);
      for (let py = 0; py < AIM_SIZE; py++) {
        for (let px = 0; px < AIM_SIZE; px++) {
          const at = py * AIM_SIZE + px;
          const isBody = raster.pickKind[at] === PICK_ENTITY && raster.pickId[at] === id;
          cam.ray((px + 0.5) / AIM_SIZE, (py + 0.5) / AIM_SIZE, dir);
          const hit = rayBody(anim, st, tick, bx, by, bz, yawUnits, cam.x, cam.y, cam.z, dir[0]!, dir[1]!, dir[2]!, 50, 0, false, posed);
          if (at % 61 === 0 && rayBody(anim, st, tick, bx, by, bz, yawUnits, cam.x, cam.y, cam.z, dir[0]!, dir[1]!, dir[2]!, 50) !== hit) out.unlike++;
          if (!isBody) {
            // No part of the body is drawn here, so a hit lands on thin air unless a structure is in front.
            if (hit !== 0 && raster.pickKind[at] !== PICK_STRUCTURE) out.phantom++;
            else out.empty++;
            continue;
          }
          const zone = zoneOfBone(raster.pickBone[at]! - 1);
          out.drawn[zone]!++;
          if (hit === zone) out.agreed[zone]!++;
          else if (hit === 0) out.missed++;
        }
      }
    }
  }
  return out;
}

/**
 * What one look may cost against its sex's default, at worst: the region extremes and random looks measured on
 * 2026-11-25 with each limb held to LIMB_SLACK (shared/anim/look.ts). Missed stays at 3% for him and 4.5% for her.
 */
export const AIM_MALE_LOOK: AimHeld = { head: 0.95, body: 0.875, missed: 0.03, spill: 0.31, zone: 0.74 };
export const AIM_FEMALE_LOOK: AimHeld = { head: 0.9, body: 0.835, missed: 0.045, spill: 0.46, zone: 0.58 };
/** Every region at one end: as one look, but a body thin all over leaves a wider rim of capsule around it. */
export const AIM_MALE_EXTREME: AimHeld = { ...AIM_MALE_LOOK, spill: 0.32 };
export const AIM_FEMALE_EXTREME: AimHeld = { ...AIM_FEMALE_LOOK, spill: 0.48 };

/** The ways a count falls short of `held`, as words; none where it holds. */
export function shortOf(c: AimCount, held: AimHeld): string[] {
  const s = aimShares(c), out: string[] = [];
  const pc = (v: number): string => `${(v * 100).toFixed(2)}%`;
  if (!(s.head > held.head)) out.push(`head ${pc(s.head)}`);
  if (!(s.body > held.body)) out.push(`body ${pc(s.body)}`);
  if (!(s.missed < held.missed)) out.push(`missed ${pc(s.missed)}`);
  if (!(s.spill < held.spill)) out.push(`spill ${pc(s.spill)}`);
  if (!(s.worstShare >= held.zone)) out.push(`${s.worst} ${pc(s.worstShare)}`);
  if (c.unlike !== 0) out.push(`${c.unlike} rays unlike rayBody's`);
  return out;
}

/** Adds `b` into `a`. */
export function addCount(a: AimCount, b: AimCount): void {
  for (let z = 0; z < HUMAN_ZONE_COUNT; z++) { a.drawn[z]! += b.drawn[z]!; a.agreed[z]! += b.agreed[z]!; }
  a.missed += b.missed; a.phantom += b.phantom; a.empty += b.empty; a.unlike += b.unlike;
}

export function emptyCount(): AimCount {
  return { drawn: new Uint32Array(HUMAN_ZONE_COUNT), agreed: new Uint32Array(HUMAN_ZONE_COUNT), missed: 0, phantom: 0, empty: 0, unlike: 0 };
}

/** The body regions in groups of about a minute and a half each: head to chest, the limbs, the trunk. */
export const REGION_GROUPS: readonly (readonly [name: string, from: number, to: number])[] = [["head, neck and chest", 0, 7], ["arms, hands, legs and feet", 7, 16], ["hips, torso and build", 16, REGION_COUNT]];

/** Each region from `from` up to `to` alone at -1 and then +1, on the default look of `sex`. */
export function regionLooks(sex: number, from: number, to: number): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (let r = from; r < to; r++) for (const v of [-1, 1]) {
    const look = defaultLook();
    look[LOOK_SEX] = sex;
    setRegion(look, r, v);
    out.push([`${REGIONS[r]!.label} ${v}`, look]);
  }
  return out;
}

/** Every region at -1, and every region at +1, on the default look of `sex`. */
export function extremeLooks(sex: number): [string, Uint8Array][] {
  return [-1, 1].map((v) => {
    const look = defaultLook();
    look[LOOK_SEX] = sex;
    for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, v);
    return [`every region ${v}`, look] as [string, Uint8Array];
  });
}

/** Seeded random looks of `sex`, in the default hair and no beard: hair is never hit, and its styles are audited apart. */
export function randomLooks(sex: number, count: number): [string, Uint8Array][] {
  return Array.from({ length: count }, (_, k) => {
    const look = randomLook(new Rng((k + 1) * 7919 + sex));
    look[LOOK_SEX] = sex;
    look[LOOK_HAIR] = defaultLook()[LOOK_HAIR]!;
    look[LOOK_BEARD] = 0;
    return [`random ${k + 1}`, look] as [string, Uint8Array];
  });
}

/** Each look drawn on a view of its own, held to `each`, and all of them pooled held to `pooled`. Returns what fell short. */
export function holdLooks(looks: readonly (readonly [string, Uint8Array])[], each: AimHeld, pooled: AimHeld): string[] {
  const all = emptyCount(), out: string[] = [];
  for (const [name, look] of looks) {
    const c = aimAudit(aimView(), look);
    addCount(all, c);
    const short = shortOf(c, each);
    if (short.length > 0) out.push(`${name}: ${short.join(", ")}`);
  }
  const short = shortOf(all, pooled);
  if (short.length > 0) out.push(`all ${looks.length} together: ${short.join(", ")}`);
  return out;
}
