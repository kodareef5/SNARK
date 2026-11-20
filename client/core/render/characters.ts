import { IMPALE_SLOT, MAX_SEATS } from "../../../shared/sim/seats.ts";
// A body is one skeleton and several meshes, one per body slot, so a worn piece can replace the part under it.
// Its bones go into the packet once, and each of its meshes is one instance that names the body's first bone.

import type { SpeciesDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { Pose } from "../../../shared/anim/clip.ts";
import { createMountMotion, mountOrigin, mountPose, type MountMotionRole } from "../../../shared/anim/mount.ts";
import { occupantPose, type OccupantSeat } from "../../../shared/anim/occupant.ts";
import { fitSeatControls } from "../../../shared/anim/seat-controls.ts";
import { vehicleRotation, type VehicleFrame } from "../../../shared/sim/vehicle-frame.ts";
import { vehicleDoor } from "../../../shared/sim/vehicle-body.ts";
import type { Seat } from "../../../shared/sim/seats.ts";
import { isBoatVehicle, isWheelVehicle, type VehicleDefinition } from "../../../shared/sim/vehicle.ts";
import { quatAxis, quatMul, quatRotate } from "../../../shared/math/quat.ts";
import { SOCKET_EYE, HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_HEAD, SLOT_FEET, SLOT_HANDS, SLOT_NAMES } from "../../../shared/anim/human.ts";
import { RiderSoles, soleOffsets } from "../../../shared/anim/rider-soles.ts";
import { RiderGrips } from "../../../shared/anim/rider-grips.ts";
import { BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_HAIR, LOOK_SEX, REGION_MAIN, REGION_SECOND, REGION_TRIM, SEX_IDS, defaultLook, lookColors, lookLift, lookScales } from "../../../shared/anim/look.ts";
import { EMOTES, EMOTE_GROUP, emoteClipId, emoteOf } from "../../../shared/anim/emotes.ts";
import { AnimState, HumanAnim, advanceHuman, humanPose } from "../../../shared/anim/pose.ts";
import { handsAt } from "../../../shared/anim/hold.ts";
import { ACT_NONE, HOLD_CARRY } from "../../../shared/sim/weapon.ts";
import { MODE_FLYER, MODE_SWIM, STANCE_CROUCH, STANCE_STAND } from "../../../shared/sim/character.ts";
import { Solved, boneToModel, solve } from "../../../shared/anim/skeleton.ts";
import { CreatureAnim, advanceCreature, creaturePose, creatureFootfallDomain, FOOTFALL_NONE, type FootfallGait } from "../../../shared/anim/creature.ts";
import { Gait } from "../../../shared/anim/gait.ts";
import { buildRig, buildRigs } from "../../../shared/anim/rigs.ts";
import { BODY_REACH } from "../../../shared/anim/zones.ts";
import type { Pack, PackRig, PackGrip } from "../../../shared/pack/pack.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { groundSpeedScale } from "../../../shared/anim/ground-conform.ts";
import { poseCreatureOn } from "../../../shared/anim/creature.ts";
import type { Assets } from "../assets/assets.ts";
import { Corpses, type Corpse } from "../ragdoll.ts";
import type { CorpseMotion } from "../../../shared/net/corpse.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { nearestColour, REGION_BASE } from "../../../shared/pack/palette.ts";
import { RIDER_TARGET_FLOATS, RIDER_SOLES, RIDER_GRIPS, RIDER_GRIP_RADIUS, RIDER_GRIP_LOW, RIDER_GRIP_HIGH, RIDER_FOREARM_ALIGNMENT, fitRiderControls } from "../../../shared/anim/rider-controls.ts";
import { anchorFrame, riderTargets, saddleSeat, seatFrame } from "../../../shared/anim/seat.ts";
import { GEAR_HELD, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { BONE_FLOATS, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_SKINNED, type FramePacket, type InstanceWriter } from "./packet.ts";
import { Layers, corpseWanted, layerWanted } from "./layers.ts";
import { MARINE_STORIES, ROAD_STORIES, WEAR_KEY, wearOf } from "./wear.ts";
import { TireContacts } from "./tire-contact.ts";
import { Windscreens } from "./windscreens.ts";
import { RotorBlur } from "./rotor-blur.ts";
import { CameraBody } from "../camera-body.ts";
import { PatrolLights } from "./patrol-lights.ts";

/** A body is culled when its origin is farther than this outside the view. No pose reaches farther from its origin. */
export const BODY_RADIUS = BODY_REACH;
/**
 * An outfit is heavy where its pieces' coarsest levels hold more than this many times the triangles of the body parts
 * they stand in for: a tailored suit of plates over a liner, not a shirt cut from the body's own mesh. The Meridian
 * suit is 2,243 triangles there on a body of about 420.
 */
const HEAVY_OUTFIT = 2;
/**
 * How much sooner a heavy outfit goes to its next level than the body would: its levels are chosen as if it stood this
 * many times as far off. A body's levels change where a quarter of a pixel of error would show (Tier.threshold on
 * medium), a figure for a body of 4,400 triangles; a suit of 21,000 on it gives up three times that, still under a
 * pixel, and is drawn at its finest only within about 8 m where the body is to 25. At the body's last level the outfit
 * is not drawn at all: the body's own part stands in for it in the outfit's colours.
 */
const HEAVY_RELAX = 3;
/** The most meshes one body queues: its slots, hair, a beard, a piece worn on its head, deployed vents and a held item. */
const PARTS = SLOT_COUNT + 6;
const PLAIN = defaultLook();

/** Warm a small area of the living hide while keeping its inherited colour visible.
 * Bright dyes deepen towards russet and dark dyes flush towards copper. */
function rivalryColor(palette: Uint8Array, base: number): number {
  // An unset region leaves the material undyed. Use neutral grey as its starting tint.
  const i = (base > 0 && base < REGION_BASE ? base : 15) * 4;
  const r = palette[i]!, g = palette[i + 1]!, b = palette[i + 2]!;
  const bright = .2126 * r + .7152 * g + .0722 * b > 123;
  const flush = nearestColour(palette, .48 * r + .52 * (bright ? 174 : 234),
    .48 * g + .52 * (bright ? 51 : 97), .48 * b + .52 * (bright ? 36 : 53));
  // An already copper-red dye can round back to itself in the fixed palette.
  return flush === base ? nearestColour(palette, r * .78, g * .64, b * .64) : flush;
}

/** The meshes on one rig: one sex of a species, or the whole of a species modelled without sexes. */
interface Creature {
  /** What it plays on its rig. */
  anim: CreatureAnim;
  /** The manifest's skeleton whose clips it waits for, standing at rest until they come; -1 once it has its clips. */
  clips: number;
  mesh: number;
  color: number;
  /** An unset gene on a palette-only draw takes its region's first colour. Null regions have no dye. */
  flatColors: Uint8Array | null;
  /** How far each level of its mesh lies from the finest, in metres. */
  error: readonly number[];
  /**
   * Its whole model as it is saddled, made on its rig, drawn in place of `mesh` while it wears any saddle, and how far
   * each of its levels lies from its finest; -1 where it has none (D491).
   */
  saddled: number;
  saddledError: readonly number[];
  /** Each saddle that fits it and has a mesh made on its rig: that mesh, by the saddle's content index, drawn on its bones. */
  worn: ReadonlyMap<number, number>;
  /** A vehicle poses its rig from its definition, not from a gait; null for a creature. */
  vehicle: VehicleRig | null;
  /** A road vehicle or a vessel wears its layer as the story its colours give it among its kind's: their first (wear.ts), 0 for none. */
  wear: number;
  wreck: number;
  wreckError: readonly number[];
  oriented: Solved;
}

/** A vehicle's definition bound to its rig once: the bone each wheel, door and the steering wheel turns, -1 where the rig lacks it. */
interface VehicleRig {
  def: VehicleDefinition;
  wheels: Int16Array;
  rotors: Int16Array;
  doors: Int16Array;
  slideOffsets?: Float32Array;
  steer: number;
  drives: { bone: number; axis: readonly [number, number, number]; ratio: number; spin: boolean }[];
}

export interface VehicleRenderPose {
  pitch: number; roll: number; steering: number; wheelAngle: number;
  qx?: number; qy?: number; qz?: number; qw?: number;
  rotorRpm?: number; rotorPhase?: number; engineCondition?: number; rotorCondition?: number;
  engineRpm?: number; engineOn?: boolean; hullCondition?: number; flooding?: number;
  groundPitch?: number; groundRoll?: number; rideOffset?: number; grounded?: boolean;
  /** Each door's open share, 8 bits a door (shared/sim/vehicle-body.ts vehicleDoor). */
  doors?: number;
  lightMode?: number;
}
/** The pelvis target in camera-relative world space; the character's own rest proportions determine its origin. */
export interface VehicleSeatPose extends VehicleRenderPose, OccupantSeat {
  x: number; y: number; z: number; yaw: number; driver: boolean; aimYaw?: number;
  /** The road wheels' steering as a share of the vehicle's most, -1 to 1, for the driver's arms. */
  steer: number;
  role?: Seat["pose"];
  weapons?: boolean;
  definition?: Seat;
}

/** A seat's pose for Characters.seatPose to fill, made once by whoever keeps it. */
export function seatScratch(): VehicleSeatPose {
  return { pitch: 0, roll: 0, steering: 0, wheelAngle: 0, x: 0, y: 0, z: 0, yaw: 0, driver: false, steer: 0 };
}

interface BodySet {
  soles: Map<number, readonly number[]>;
  neutralSoles: Map<number, Float64Array>;
  grips: Map<number, PackGrip>;
  /** Pack mesh per body slot, -1 where there is none. */
  slots: Int32Array;
  /** How far each level of the body lies from the finest, in metres. */
  error: readonly number[];
  /** Pack mesh per hair style and per beard style, -1 for none. */
  hair: Int32Array;
  beard: Int32Array;
  /** Rest positions of the joints of the body these meshes were made on. */
  rest: Float32Array;
  /** Per armor set, indexed as Worn.set. The pack mesh worn in each body slot, -1 where the set has none. */
  armor: Int32Array[];
  vents: Int32Array;
  /** Per armor set, 1 where the set is heavy (HEAVY_OUTFIT). */
  heavy: Uint8Array;
}

interface Worn {
  sealed: boolean;
  vented: boolean;
  slot: number;
  set: number;
  colors: readonly [number, number, number];
}

interface Held {
  mesh: number;
  bone: number;
}

interface BodyKind {
  /** Indexed by sex, or a single set. */
  sets: BodySet[];
  color: number;
}

/**
 * `layer` is the level of the bodies' hurt and decay layer (layers.ts), 0 for none, and their wear story with it
 * (wear.ts WEAR_KEY). `standIn`, on a DRAW_ONE_BONE draw, is the first bone of the pose its bodies stand in.
 */
export type DrawFn = (mesh: number, lod: number, first: number, count: number, flags: number, layer: number, standIn: number) => void;
/** Puts instances into the shadow caster list for `cascades`, a bit each. `lod` is the level the view would draw them at. */
export type CastFn = (mesh: number, lod: number, first: number, count: number, flags: number, cascades: number, standIn: number) => void;

/** What a body's shadow takes, while the sun casts: the cascades a body within `radius` of a camera-relative point can shade, and those a mesh is large enough for. */
export interface BodyShadows {
  body(x: number, y: number, z: number, radius: number): number;
  mesh(mesh: number): number;
}

/** An instance drawn in the view, one of the viewer's own body drawn over everything, and one that only casts a shadow. */
const SEEN = 0;
const OWN = 1;
const CASTS = 2;
/** One the frame had no draw left for, counted dropped. */
const NONE = 3;
/** Cascade masks an instance may have: a bit each for up to four. */
const MASKS = 16;

/**
 * A body's gait, the frame it was last drawn in and the frame its gait last moved, a survivor's look with the bone scales
 * it gives, kept while it is the same, and its pose as last worked out, in frame `posedAt` as `form`, drawn until it is due.
 */
class Stride extends Gait {
  generation = -1;
  seen = 0;
  moved = -1;
  look: Uint8Array | null = null;
  scales: Float32Array | null = null;
  solved: Solved | null = null;
  posedAt = -1;
  form = -1;
  kind = 0;
  riderProfile = 0;
  readonly soles = new RiderSoles();
  readonly posedGait = { phase: 0, speed: 0, domain: FOOTFALL_NONE };
  shown: Solved | null = null;
  shownFrame = -1;
  shownTick = Number.NaN;
  shownRigid = false;
  readonly grips = new RiderGrips();
}

const STILL_GAIT = { phase: 0, speed: 0, domain: FOOTFALL_NONE } as const;

/** A pose a body stands in while the frame has no bones to pose it: its rows about its origin, and its bones this frame. */
/** One allocation per observed rider, reused across frames; profile identifies a saddle seat's rigid fallback. */
export interface RiderFit { profile: number; readonly targets: Float64Array }
export function riderFitScratch(): RiderFit { return { profile: 0, targets: new Float64Array(RIDER_TARGET_FLOATS) }; }

interface StandIn {
  rows: Float32Array;
  solved: Solved;
  counted: number;
  written: number;
  first: number;
}

/** Frames a body may go undrawn before its gait is forgotten. */
const FORGET_GAIT = 600;
/** Numbers kept for each held creature posed in a frame (Characters.inArms). */
const HELD_FIELDS = 10;
/** Draws a frame may have of bodies whose layer shows or that stand in a pose, each a mesh, level, layer and pose of its own. */
const EXTRA_KEYS = 1024;
/**
 * A body is posed every frame while a metre of it covers FULL_RATE_PIXELS, then every 2nd, 4th or 8th frame as that halves,
 * and no less often than a planted foot slides SLIDE_PIXELS between poses at 60 frames a second.
 */
const FULL_RATE_PIXELS = 32;
const SLIDE_PIXELS = 2;
const POSE_EVERY = 8;

export class Characters {
  readonly tireContacts = new TireContacts();
  readonly windscreens = new Windscreens();
  readonly rotorBlur = new RotorBlur();
  readonly patrolLights = new PatrolLights();
  readonly anim: HumanAnim;
  /** Bodies drawn on bones of their own this frame, and those of them whose pose was worked out anew. */
  posed = 0;
  fresh = 0;
  /** Set while the sun casts. Null leaves every body out of the shadows. */
  shadows: BodyShadows | null = null;
  private readonly kinds: (BodyKind | null)[];
  /** Per content index. Set for a species with a non-human skeleton whose rig and mesh are in the pack. */
  private readonly creatures: (Creature | null)[];
  private groundWorld: CollisionWorld | null = null;
  /** What each kind of creature plays, by content index, which its dead are posed by too; and the kinds whose clips have not come. */
  private readonly anims: (CreatureAnim | null)[];
  private readonly waiting: number[];
  private readonly rigs: readonly PackRig[];
  /** Per content index. */
  private readonly worn: (Worn | null)[];
  private readonly held: (Held | null)[];
  /** 1 for each content index that is a saddle. */
  private readonly saddle: Uint8Array;
  private readonly wornColor = new Uint8Array(6);
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);
  private readonly mounted = new Solved(HUMAN_BONES);
  private readonly mount = createMountMotion();
  private readonly rotation = new Float64Array(4);
  private readonly groundRotation = new Float64Array(4);
  private readonly wheel = new Float64Array(4);
  private readonly steer = new Float64Array(4);
  private readonly seatState = new AnimState();
  private readonly origin = new Float64Array(3);
  private readonly lookColor = new Uint8Array(6);
  /** Scratch: a body's look, a vehicle's frame for its turn, a seat's place and what a seated body is posed from. */
  private readonly lookView = new Uint8Array(LOOK_BYTES);
  private readonly turnFrame: VehicleFrame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: undefined, qy: undefined, qz: undefined, qw: undefined };
  private readonly seatPlace = new Float64Array(3);
  private readonly seating: { role: MountMotionRole; tick: number; startTick: number; durationTicks: number; steering: number | undefined; upper: Pose | undefined } = { role: "ride", tick: 0, startTick: 0, durationTicks: 1, steering: undefined, upper: undefined };
  /** What the meshes of the survivor being added share (queuePart). `stand` is its stand-in's first bone, or -1 posed. */
  private readonly part = { lod: 0, far: 0, stand: -1, first: 0, color: 0, id: 0, own: false, casts: 0, rest: null as Float32Array | null };

  // Instances queued this frame, one per mesh of each body.
  private count = 0;
  /**
   * Pack mesh * levels + level of detail. A body whose layer shows or that stands in a pose takes a key from `plain` on,
   * for that key, its layer level and its stand-in's first bone (-1 for none), which `extra` holds.
   */
  private readonly key = new Uint32Array(MAX_SKINNED);
  private readonly plain: number;
  private readonly extra = new Int32Array(EXTRA_KEYS * 3);
  private extraKeys = 0;
  /** An open hash of those keys: one more than each one's place in `extra`, and 0 where there is none. */
  private readonly extraAt = new Int32Array(EXTRA_KEYS * 4);
  /** Stand-ins made so far, by body set and then by what they do (standIn). */
  private readonly standIns: (StandIn | undefined)[][] = [];
  /** Stand-ins of survivors in whole-body emotes, by body kind and set and the emote. */
  private readonly emoteStandIns = new Map<number, StandIn>();
  /** The manifest's slot of the emotes' clips while they are still to come, else -1; and whether they are wanted. */
  private emoteSlot = -1;
  private emotesWanted = false;
  private readonly riderStandIns = new Map<number, Map<number, Map<number, StandIn>>>();
  private readonly riderCounted = new Map<number, Map<number, Set<number>>>();
  private readonly neutralGrip = new RiderGrips();
  private readonly layers = new Layers();
  /** The most levels of detail any mesh of the pack has, so that a body can be drawn at every level its mesh has. */
  private readonly levels: number;
  private readonly firstBone = new Uint16Array(MAX_SKINNED);
  private readonly region0 = new Uint8Array(MAX_SKINNED);
  private readonly colors = new Uint8Array(MAX_SKINNED * 6);
  private readonly rivalryColors = new Uint8Array(256);
  private readonly palette: Uint8Array;
  private readonly id = new Uint32Array(MAX_SKINNED);
  /** SEEN, OWN or CASTS. */
  private readonly near = new Uint8Array(MAX_SKINNED);
  /** The shadow cascades each instance casts into, a bit each. */
  private readonly mask = new Uint8Array(MAX_SKINNED);
  /** Added to each vertex before its bone is applied. The rest position of the bone a held item hangs on, or zero for a body mesh. */
  private readonly offset = new Float32Array(MAX_SKINNED * 3);
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  /** Per key and cascade mask, while casting: how many instances, and where the next goes. A key's instances are ordered by mask. */
  private readonly maskCounts: Uint32Array;
  private readonly maskCursor: Uint32Array;
  private readonly assets: Assets;
  /** The level each body was last drawn at, by its id. */
  private readonly last = new Map<number, number>();
  /** The level each body's heavy outfit was last drawn at, as `last` is the body's. */
  private readonly lastHeavy = new Map<number, number>();
  /** Each body's gait, by its id, so its legs go by the ground it covers (shared/anim/gait.ts). */
  private readonly gaits = new Map<number, Stride>();
  private frame = 0;
  /** The packet is the same one every frame, and holds the camera by the time seat() is asked. */
  private packet: FramePacket | null = null;
  /** Bodies that died, as their death clips and ragdolls pose them. */
  private readonly dead: Corpses;
  /**
   * This frame: whose arms each held creature is in, by id; the point between the palms of each survivor posed holding one,
   * camera-relative, by id; and the held creatures posed, each its first bone, its bones, its place, facing, size, carrier,
   * kind and id.
   */
  private readonly carriedBy = new Map<number, number>();
  private readonly palms = new Map<number, Float64Array>();
  private readonly palmPool: Float64Array[] = [];
  private readonly inArms: number[] = [];
  private placed = false;
  /** The point between the palms of a survivor standing and crouched, from its clips, for a held creature not yet put right. */
  private readonly cradled: Float64Array[] = [];
  /**
   * Where each creature posed this frame shows its overhead marks, by its id: a slot of three world coordinates in `headAt`,
   * whose id `headIds` holds. Kept from frame to frame, as clearing it would make it grow again each frame.
   */
  private readonly heads = new Map<number, number>();
  private headAt = new Float32Array(3 * 256);
  private headIds = new Uint32Array(256);
  private headCount = 0;
  private readonly socketAt = [0, 0, 0];

  private readonly reg: Registry;

  constructor(reg: Registry, pack: Pack, assets: Assets) {
    const { table, bind } = assets;
    this.reg = reg;
    this.palette = pack.palette;
    this.assets = assets;
    this.anim = new HumanAnim(pack.clips);
    this.emoteSlot = assets.table.skeletons.get(EMOTE_GROUP) ?? -1;
    this.levels = table.error.reduce((most, e) => Math.max(most, e.length), 1);
    this.plain = table.count * this.levels;
    this.counts = new Uint32Array(this.plain + EXTRA_KEYS);
    this.cursor = new Uint32Array(this.plain + EXTRA_KEYS);
    this.maskCounts = new Uint32Array(this.counts.length * MASKS);
    this.maskCursor = new Uint32Array(this.counts.length * MASKS);
    /** Only a mesh on the human skeleton is drawn as part of a body. */
    const human = (mesh: number): number => (mesh >= 0 && table.skeleton[mesh] === HUMAN.id ? mesh : -1);
    const sets: string[] = [];
    this.worn = reg.defs.map((d) => {
      if (d?.type !== "item" || !d.wear) return null;
      if (!sets.includes(d.wear.set)) sets.push(d.wear.set);
      return { sealed: d.wear.sealed === true, vented: !!d.wear.vents, slot: SLOT_NAMES.indexOf(d.wear.slot), set: sets.indexOf(d.wear.set), colors: d.wear.colors };
    });
    // Any item whose class gives it a held slot (shared/content/classes.ts) is drawn in the hand by its mesh there: a
    // weapon's code-made box, or a piece converted onto a prop bone (tools/art/build.ts, heldOn).
    this.held = reg.defs.map((d) => {
      const mesh = d?.type === "item" ? human(bind.own(d.id, "held")) : -1;
      return mesh < 0 ? null : { mesh, bone: table.bone[mesh]! };
    });
    /** One piece of each armor set for each part. Its `worn` slot says where the set's mesh for a body is. */
    const piece = (set: string, part: string): string => reg.defs.find((d) => d?.type === "item" && d.wear?.set === set && d.wear.slot === part)?.id ?? "";
    const bodyOf = (d: SpeciesDef, sex: string): BodySet | null => {
      const slots = Int32Array.from(SLOT_NAMES, (part) => human(bind.mesh(d.id, "body", `${sex}/${part}`)));
      const first = slots.find((m) => m >= 0);
      if (first === undefined) return null;
      const rig = table.rig[first]!;
      // A body is drawn at one level, so that its parts meet. Its error at a level is the average of its parts'.
      const parts = [...slots].filter((m) => m >= 0).map((m) => table.error[m]!);
      const error = Array.from({ length: Math.min(...parts.map((e) => e.length)) }, (_, level) => parts.reduce((sum, e) => sum + e[level]!, 0) / parts.length);
      // Armor is cut for a body, and keyed by the body's name without its pack.
      const body = `${d.mesh}_${sex}`.replace(/^[^:]*:/, "");
      const rest = rig < 0 ? HUMAN.rest : Float32Array.from(pack.header.rigs[rig]!.rest);
      const soles = new Map<number, readonly number[]>(), neutralSoles = new Map<number, Float64Array>();
      for (const support of pack.header.rigs[rig]?.soles ?? []) {
        const mesh = table.find(support.mesh), offsets = new Float64Array(6);
        if (mesh >= 0 && soleOffsets(support.points, rest, null, offsets)) { soles.set(mesh, support.points); neutralSoles.set(mesh, offsets); }
      }
      const grips = new Map<number, PackGrip>();
      for (const grip of pack.header.rigs[rig]?.grips ?? []) { const mesh = table.find(grip.mesh); if (mesh >= 0) grips.set(mesh, grip); }
      return {
        soles, neutralSoles, grips,
        slots,
        error,
        hair: Int32Array.from(HAIR_STYLES, (s) => human(bind.own(d.id, "hair", `${sex}/${s.id}`))),
        beard: Int32Array.from(BEARD_STYLES, (s) => human(bind.own(d.id, "beard", `${sex}/${s.id}`))),
        rest,
        // A missing piece is -1 here, and the body's own part is drawn in the piece's colours.
        vents: Int32Array.from(sets.flatMap(set => SLOT_NAMES.map(part => human(bind.own(piece(set, part), "vents", body))))),
        armor: sets.map((set) => Int32Array.from(SLOT_NAMES, (part) => human(bind.own(piece(set, part), "worn", body)))),
        heavy: Uint8Array.from(sets, (set) => {
          const coarsest = (m: number): number => assets.manifest.meshes[m]!.levels.at(-1)!.tris;
          let worn = 0, bare = 0;
          SLOT_NAMES.forEach((part, k) => {
            const m = human(bind.own(piece(set, part), "worn", body));
            if (m < 0 || slots[k]! < 0) return;
            worn += coarsest(m);
            bare += coarsest(slots[k]!);
          });
          return worn > HEAVY_OUTFIT * bare ? 1 : 0;
        }),
      };
    };
    this.rigs = pack.header.rigs;
    const rigs = buildRigs(pack.header.rigs, pack.clips);
    this.saddle = Uint8Array.from(reg.saddleFits, (fits) => (fits !== 0 ? 1 : 0));
    this.creatures = reg.defs.map((d, i) => {
      if (d?.type !== "species" || d.skeleton === undefined || d.skeleton === HUMAN.id) return null;
      const id = bind.id(d.id, "rig");
      const rig = rigs.get(id);
      const mesh = bind.own(d.id, "body");
      if (!rig || mesh < 0) return null;
      // A worn saddle must share the body’s specific rig and its rest pose.
      const on = (m: number): number => (m >= 0 && pack.header.rigs[table.rig[m]!]?.id === id ? m : -1);
      const saddled = on(bind.own(d.id, "saddled"));
      const worn = new Map<number, number>();
      reg.saddleFits.forEach((fits, item) => {
        const m = fits === i ? on(bind.own(reg.ids[item]!, "worn")) : -1;
        if (m >= 0) worn.set(item, m);
      });
      const wreck = bind.own(d.id, "wreck");
      const flatColors = d.class === "creature" && d.regions ? Uint8Array.from(d.regions, (r) => r?.colors[0]?.[0] ?? 0) : null;
      return { flatColors, wreck, wreckError: wreck >= 0 ? table.error[wreck]! : [], anim: new CreatureAnim(rig, reg.runAt[i]!, reg.move[i]?.swimSpeed ?? 0, reg.combat[i]), clips: table.skeletons.get(id) ?? -1, mesh, color: d.color, error: table.error[mesh]!, saddled, saddledError: saddled >= 0 ? table.error[saddled]! : [], worn, vehicle: vehicleRig(reg.vehicle[i] ?? null, rig.names), wear: storiesOf(reg.vehicle[i] ?? null), oriented: new Solved(rig.bones) };
    });
    this.kinds = reg.defs.map((d) => {
      if (d?.type !== "species" || d.skeleton !== HUMAN.id) return null;
      // A body for each sex. Where both are the same stand-in (a species with no art of its own) there is one body.
      const bodies: BodySet[] = [];
      for (const sex of SEX_IDS) {
        const body = bodyOf(d, sex);
        if (body && !bodies.some((b) => b.slots.every((m, k) => m === body.slots[k]))) bodies.push(body);
      }
      return bodies.length > 0 ? { sets: bodies, color: d.color } : null;
    });
    this.anims = this.creatures.map((c) => c?.anim ?? null);
    this.waiting = this.creatures.flatMap((c, kind) => (c && c.clips >= 0 ? [kind] : []));
    this.dead = new Corpses(this.anims, reg.birthScale);
    const st = new AnimState();
    for (const stance of [STANCE_STAND, STANCE_CROUCH]) {
      st.stance = stance;
      st.setAction(ACT_NONE, HOLD_CARRY, 0);
      humanPose(this.anim, st, 0, this.pose);
      solve(HUMAN, this.pose, this.solved);
      const at = new Float64Array(3);
      handsAt(this.solved, at);
      this.cradled.push(at);
    }
  }

  /** The gait of the body with this id, kept from frame to frame. */
  private gaitOf(id: number): Stride {
    let g = this.gaits.get(id);
    if (!g) this.gaits.set(id, (g = new Stride()));
    g.seen = this.frame;
    return g;
  }

  private readonly cameraBody = new CameraBody();

  /** After begin(), before the camera: reserve the driven mount's current pose in world coordinates. */
  prepareCameraBody(kind: number, id: number, generation: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number): CameraBody | null {
    const c = this.creatures[kind], body = this.cameraBody;
    if (!c || c.vehicle) return null;
    if (body.frame === this.frame && body.id === id && body.generation === generation && body.kind === kind) return body;
    // An entity slot reused by another generation must not inherit its predecessor's gait.
    const previous = this.gaits.get(id);
    if (previous && (previous.generation !== generation || previous.kind !== kind)) this.gaits.delete(id);
    this.gaitOf(id).generation = generation;
    const solved = this.solveCreature(kind, c, id, x, y, z, yaw, st, tick, 1, false, 0, true);
    return body.set(c.anim.rig, solved, id, generation, kind, this.frame, x, y, z, yaw, 1, this.reg.move[kind]?.height ?? 0);
  }

  /** Whether content of this kind is drawn here rather than as a rigid mesh. */
  has(kind: number): boolean {
    return this.kinds[kind] != null || this.creatures[kind] != null;
  }

  /** What a creature of this kind plays, or null for a kind not drawn on a rig of its own. */
  creature(kind: number): CreatureAnim | null {
    return this.creatures[kind]?.anim ?? null;
  }

  /** The current visible pose's gait, for effects to keep their origins and footfalls on the drawn body. */
  drawnGait(id: number, kind: number, tick: number): FootfallGait | null {
    const g = this.gaits.get(id);
    return g && g.kind === kind && g.shownFrame === this.frame && g.shownTick === tick ? g.shownRigid ? STILL_GAIT : g.posedGait : null;
  }

  /** The exact submitted creature pose, including cached low-rate and rigid budget poses. */
  drawnPose(id: number, kind: number, tick: number): Solved | null {
    const g = this.gaits.get(id);
    return g && g.kind === kind && g.shownFrame === this.frame && g.shownTick === tick ? g.shown : null;
  }

  /** Bodies that died and lie or fall where they died, as they are drawn. */
  get fallen(): readonly Corpse[] {
    return this.dead.list;
  }
  corpseMotions: ReadonlyMap<number, CorpseMotion> | undefined;
  get corpseCheckpointRequests(): ReadonlySet<number> { return this.dead.needsCheckpoint; }

  /** Whether this kind is on the humanoid skeleton. */
  human(kind: number): boolean {
    return this.kinds[kind] != null;
  }

  vehicle(kind: number): boolean { return this.creatures[kind]?.vehicle != null; }

  /** Fills `out` with the pose of seat `slot` (1 for a vehicle's first seat) of a vehicle at `at`, for drawing who sits in it. */
  seatPose(kind: number, slot: number, vehicle: VehicleRenderPose, at: ArrayLike<number>, yaw: number, aimYaw: number | undefined, out: VehicleSeatPose): VehicleSeatPose | undefined {
    const def = this.creatures[kind]?.vehicle?.def, seat = def?.seats[slot - 1];
    if (!def || !seat) return undefined;
    out.pitch = vehicle.pitch; out.roll = vehicle.roll; out.steering = vehicle.steering; out.wheelAngle = vehicle.wheelAngle;
    out.qx = vehicle.qx; out.qy = vehicle.qy; out.qz = vehicle.qz; out.qw = vehicle.qw;
    out.rotorRpm = vehicle.rotorRpm; out.rotorPhase = vehicle.rotorPhase; out.engineCondition = vehicle.engineCondition; out.rotorCondition = vehicle.rotorCondition;
    out.engineRpm = vehicle.engineRpm; out.engineOn = vehicle.engineOn; out.hullCondition = vehicle.hullCondition; out.flooding = vehicle.flooding;
    out.groundPitch = vehicle.groundPitch; out.groundRoll = vehicle.groundRoll; out.rideOffset = vehicle.rideOffset; out.grounded = vehicle.grounded; out.doors = vehicle.doors;
    out.definition = seat; out.x = at[0]!; out.y = at[1]!; out.z = at[2]!; out.yaw = yaw; out.driver = seat.driver === true;
    out.steer = def.movement === "rotor" ? 0 : vehicle.steering / def.spec.maxSteer;
    out.role = seat.pose; out.weapons = seat.weapons; out.aimYaw = aimYaw;
    return out;
  }

  /** Root on a seat, using the canonical proportions for the camera (D54). Does not emit a draw. */
  seatedOrigin(kind: number, seat: VehicleSeatPose, out: Float64Array | number[], st = this.seatState, tick = 0): boolean {
    const k = this.kinds[kind];
    if (!k) return false;
    const set = k.sets[0]!;
    occupantPose(this.anim, st, tick, this.pose, seat, null, 0, seat.aimYaw ?? seat.yaw, seat.driver);
    solve(HUMAN, this.pose, this.solved, set.rest);
    if (seat.definition) fitSeatControls(this.pose, this.solved, set.rest, null, seat.definition, seat.steering);
    vehicleRotation(seat, this.rotation);
    this.seatPlace[0] = seat.x;
    this.seatPlace[1] = seat.y;
    this.seatPlace[2] = seat.z;
    mountOrigin(this.solved, this.seatPlace, this.rotation, out);
    return true;
  }

  /** Eye in the posed head, for enclosed seats where weapons are stowed. */
  seatedEye(kind: number, seat: VehicleSeatPose, out: Float64Array, st = this.seatState, tick = 0): boolean {
    if (!this.seatedOrigin(kind, seat, out, st, tick)) return false;
    const x = out[0]!, y = out[1]!, z = out[2]!;
    boneToModel(this.solved, SOCKET_EYE.bone, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, out);
    quatRotate(this.rotation, 0, out[0]!, out[1]!, out[2]!, out, 0);
    out[0] += x; out[1] += y; out[2] += z;
    return true;
  }

  /** The farthest any part of a body of this kind gets from its origin, for culling. */
  reach(kind: number): number {
    const c = this.creatures[kind];
    if (!c) return BODY_RADIUS;
    // Wheel and door pivots sit inside the bodywork. Include the mesh when framing a vehicle with long overhangs.
    const radius = this.assets.table.radius[c.mesh]!;
    return c.vehicle ? Math.max(c.anim.rig.reach, radius, c.vehicle.def.spec.halfLength) : c.anim.rig.reach || radius;
  }

  /** The bones a body of this kind takes when it is posed. */
  bones(kind: number): number {
    return this.creatures[kind]?.anim.rig.bones ?? HUMAN_BONES;
  }

  /**
   * Writes where a rider sits in seat `seatSlot` (1 for its first) of the saddle item `saddle` on a creature of this kind
   * at (x, y, z) facing `yaw` radians, posed as it is drawn: the rider's origin and the rows of its turn, in the seat
   * socket's whole frame (shared/anim/seat.ts), or at the seat's anchor where the rig has no such socket. False for a kind
   * without that seat. A vehicle's seat is its anchor alone, at out[0..2]; its turn is the car's. Given the mount's `id`, it
   * is posed once this frame for its seat and its own draw, or `rigid`, stands in the pose it is drawn in.
   */
  impaleDrop(kind: number, size = 1): number { return this.reg.bodyHeight[kind]! * size * .5; }

  seat(kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, out: Float64Array, seatSlot = 0, vehicle?: VehicleRenderPose, saddle = 0, id = -1, rigid = false, size = 1, rider?: RiderFit): boolean {
    if (rider) rider.profile = 0;
    const c = this.creatures[kind];
    const rig = c?.anim.rig;
    if (c?.vehicle) {
      // The seat's anchor in the sprung chassis frame, where the server pins its occupant (server/urban.ts pin).
      const anchor = c.vehicle.def.seats[seatSlot - 1]?.anchor;
      if (!anchor) return false;
      this.turn(vehicle, yaw, vehicle?.pitch ?? 0, vehicle?.roll ?? 0, this.rotation);
      quatRotate(this.rotation, 0, anchor[0], anchor[1], anchor[2], out, 0);
      out[0]! += x; out[1]! += y; out[2]! += z;
      return true;
    }
    // A body seated with no saddle seat to name (a picture's) sits on the rig's `seat`.
    const def = saddleSeat(this.reg, saddle, seatSlot);
    const name = seatSlot === IMPALE_SLOT ? this.reg.combat[kind]?.secondary?.impale?.socket : def ? def.socket : "seat";
    const socket = name !== undefined ? rig?.sockets.get(name) : undefined;
    if (!c || !rig || !socket) {
      if (!def) return false;
      anchorFrame(def.anchor, x, y, z, yaw, out);
      return true;
    }
    let solved = rig.solved;
    if (rigid) solved = this.standIn(kind, 0, st, false).solved;
    else if (id >= 0) solved = this.creatureSolved(kind, c, id, x, y, z, yaw, st, tick, size, false);
    else {
      poseCreatureOn(c.anim, st, tick, this.groundWorld, x + (this.packet?.camX ?? 0), y + (this.packet?.camY ?? 0), z + (this.packet?.camZ ?? 0), yaw, size);
    }
    seatFrame(solved, socket, x, y, z, yaw, out, seatSlot === IMPALE_SLOT ? 0 : undefined);
    if (rider && def && riderTargets(rig, solved, def, rider.targets)) rider.profile = saddle * (MAX_SEATS + 1) + seatSlot;
    if (size !== 1) { out[0] = x + (out[0]! - x) * size; out[1] = y + (out[1]! - y) * size; out[2] = z + (out[2]! - z) * size; }
    return true;
  }

  /**
   * The pose creature `id` is drawn in this frame: worked out anew when it is due, and otherwise as it last was. Its gait
   * moves once a frame, whether it is posed for its seat or for itself.
   */
  private creatureSolved(kind: number, c: Creature, id: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, size: number, unseen: boolean): Solved {
    return this.solveCreature(kind, c, id, x + (this.packet?.camX ?? 0), y + (this.packet?.camY ?? 0), z + (this.packet?.camZ ?? 0), yaw, st, tick, size, unseen, Math.sqrt(x * x + y * y + z * z) / size);
  }

  private solveCreature(kind: number, c: Creature, id: number, worldX: number, worldY: number, worldZ: number, yaw: number, st: AnimState, tick: number, size: number, unseen: boolean, distance: number, always = false): Solved {
    const rig = c.anim.rig;
    const g = this.gaitOf(id);
    if (g.moved !== this.frame) {
      g.moved = this.frame;
      advanceCreature(c.anim, g, st, tick, worldX, worldZ, yaw, size, groundSpeedScale(rig, st, this.groundWorld, worldX, worldY, worldZ, yaw, size));
    }
    const solved = this.kept(g, rig.bones);
    const aloft = st.mode === MODE_FLYER && !st.grounded;
    g.kind = kind;
    if (this.due(g, kind * 4, id, distance, unseen, aloft ? 0 : g.speed, always)) {
      poseCreatureOn(c.anim, st, tick, this.groundWorld, worldX, worldY, worldZ, yaw, size, g, solved);
      g.posedGait.phase = g.phase; g.posedGait.speed = g.speed; g.posedGait.domain = creatureFootfallDomain(c.anim, st, tick);
    }
    return solved;
  }

  /** The body's kept pose, made for `bones` bones. */
  private kept(g: Stride, bones: number): Solved {
    if (g.solved === null || g.solved.pos.length !== bones * 3) {
      g.solved = new Solved(bones);
      g.form = -1;
    }
    return g.solved;
  }

  /**
   * Whether a body is posed anew this frame (and counted so), `distance` metres off as it is drawn and walking at `speed`
   * metres a second: when it is first posed as `form`, and then as often as its size on screen and its feet ask, staggered by
   * its `id`; and every frame `always`. One `unseen`, posed for its shadow alone, is posed half as often.
   */
  private due(g: Stride, form: number, id: number, distance: number, unseen: boolean, speed: number, always = false): boolean {
    if (!always && g.form === form && this.frame - g.posedAt < POSE_EVERY) {
      if (g.posedAt === this.frame) return false;
      // A metre's pixels there.
      const pixels = this.assets.scale / (distance > 1 ? distance : 1);
      let every = (2 * FULL_RATE_PIXELS) / pixels;
      if (speed > 0) every = Math.min(every, 1 + (SLIDE_PIXELS * 60) / (speed * pixels));
      if (unseen) every *= 2;
      every = every >= POSE_EVERY ? POSE_EVERY : every >= 4 ? 4 : every >= 2 ? 2 : 1;
      if (((this.frame + id) & (every - 1)) !== 0) return false;
    }
    g.form = form;
    g.posedAt = this.frame;
    this.fresh++;
    return true;
  }

  /**
   * The pose a body of `kind`, a survivor of body set `set`, stands in while the frame has no bones to pose it, for what
   * `st` says it is doing and whether it is `seated` astride: as it is posed doing that, standing still, at tick 0. Made
   * once, the first time it is asked for. A vehicle stands in its rest pose.
   */
  private standIn(kind: number, set: number, st: AnimState, seated: boolean, impaled = false, rider?: RiderFit, foot = -1, hand = -1): StandIn {
    const c = this.creatures[kind];
    // A survivor in a whole-body emote (sitting, lying, dancing) stands in at the middle of it.
    const emote = !c && !seated && !impaled ? emoteOf(st.emote) : null;
    if (st.emote !== 0 && !this.anim.emotes[st.emote]) this.wantEmotes();
    if (emote?.mask === "full") {
      const key = (kind * 2 + set) * 1024 + st.emote;
      let e = this.emoteStandIns.get(key);
      if (e) return e;
      const like = new AnimState();
      like.emote = st.emote;
      like.emoteStart = 0;
      const frames = this.anim.emotes[st.emote]?.frames ?? 2;
      humanPose(this.anim, like, Math.floor(frames / 2), this.pose, null);
      const body = this.kinds[kind]!.sets[set]!;
      const solved = new Solved(HUMAN_BONES);
      solve(HUMAN, this.pose, solved, body.rest, null);
      const rows = new Float32Array(HUMAN_BONES * BONE_FLOATS);
      writeBones(rows, 0, solved, body.rest, null, 0, 0, 0, 0);
      this.emoteStandIns.set(key, (e = { rows, solved, counted: -1, written: -1, first: 0 }));
      return e;
    }
    const doing = c?.vehicle ? 0 : this.standState(st, seated, impaled);
    const of = (this.standIns[kind * 2 + set] ??= []);
    // Content indices are 16-bit and seats at most 16: this numeric key stays exactly representable and bounded by content.
    const fitKey = this.standKey(kind, set, rider?.profile ?? 0, doing);
    let feet = this.riderStandIns.get(foot), variants = feet?.get(hand);
    let s = rider?.profile ? variants?.get(fitKey) : of[doing];
    if (s) return s;
    const like = new AnimState();
    like.mode = st.mode;
    like.grounded = st.grounded;
    like.stance = st.stance;
    like.out = st.out;
    like.held = st.held;
    let solved: Solved;
    let rest: Float32Array;
    if (c) {
      const rig = c.anim.rig;
      if (c.vehicle) rig.a.rest();
      else creaturePose(c.anim, like, 0, rig.a, null);
      solve(rig, rig.a, (solved = new Solved(rig.bones)));
      rest = rig.rest;
    } else {
      const body = this.kinds[kind]!.sets[set]!;
      if (impaled) this.seatedPose("impaled", 0, undefined, undefined);
      else if (seated) this.seatedPose("ride", 0, undefined, undefined);
      else humanPose(this.anim, like, 0, this.pose, null);
      solve(HUMAN, this.pose, (solved = new Solved(HUMAN_BONES)), body.rest, null);
      if (rider?.profile) {
        const t = rider.targets, grip = hand < 0 ? null : this.neutralGrip.update(body.grips.get(hand) ?? null, null, t[RIDER_GRIP_RADIUS]!, t[RIDER_GRIP_LOW]!, t[RIDER_GRIP_HIGH]!, 0, t[RIDER_FOREARM_ALIGNMENT] ?? 0);
        fitRiderControls(this.pose, solved, body.rest, null, t, true, undefined, body.neutralSoles.get(foot) ?? null, grip);
      }
      rest = body.rest;
    }
    const rows = new Float32Array((solved.pos.length / 3) * BONE_FLOATS);
    writeBones(rows, 0, solved, rest, null, 0, 0, 0, 0);
    s = { rows, solved, counted: -1, written: -1, first: 0 };
    if (rider?.profile) {
      if (!feet) this.riderStandIns.set(foot, feet = new Map());
      if (!variants) feet.set(hand, variants = new Map());
      variants.set(fitKey, s);
    }
    else of[doing] = s;
    return s;
  }

  /** The body set a survivor of this kind with `look` at `lookAt` (null for none) is drawn as. */
  private setOf(k: BodyKind, look: Uint8Array | null, lookAt: number): number {
    if (k.sets.length < 2) return 0;
    const sex = look ? look[lookAt + LOOK_SEX]! : PLAIN[LOOK_SEX]!;
    return sex < k.sets.length ? sex : 0;
  }

  /**
   * The bones the pose a body would stand in takes, the first time this frame it is asked for, and 0 after: what a frame
   * short of bones keeps for those it leaves unposed (Scene). `seated` as add() is given a saddle seat.
   */
  standInBones(kind: number, look: Uint8Array | null, lookAt: number, st: AnimState, seated: boolean, impaled = false, profile = 0, gear: Uint16Array | null = null, gearAt = 0): number {
    const k = this.kinds[kind];
    if (!k && !this.creatures[kind]) return 0;
    const set = k ? this.setOf(k, look, lookAt) : 0;
    if (profile && k) {
      // Thinning precedes the host's final pose. Reserve the exact profile key without caching an unfitted pose.
      const key = this.standKey(kind, set, profile, this.standState(st, seated, impaled));
      const controls = this.reg.saddleSeats[Math.floor(profile / (MAX_SEATS + 1))]?.[profile % (MAX_SEATS + 1) - 1]?.rider;
      const foot = controls?.soles ? this.partOf(k.sets[set]!, gear, gearAt, SLOT_FEET) : -1;
      const hand = controls?.grips ? this.partOf(k.sets[set]!, gear, gearAt, SLOT_HANDS) : -1;
      let feet = this.riderCounted.get(foot), counted = feet?.get(hand);
      if (counted?.has(key) || this.riderStandIns.get(foot)?.get(hand)?.get(key)?.written === this.frame) return 0;
      if (!feet) this.riderCounted.set(foot, feet = new Map());
      if (!counted) feet.set(hand, counted = new Set());
      counted.add(key);
      return HUMAN_BONES;
    }
    const s = this.standIn(kind, set, st, seated && k !== null, impaled);
    if (s.counted === this.frame || s.written === this.frame) return 0;
    s.counted = this.frame;
    return s.rows.length / BONE_FLOATS;
  }

  private standState(st: AnimState, seated: boolean, impaled: boolean): number {
    return (st.mode & 7) | (st.grounded ? 8 : 0) | ((st.stance & 3) << 4) | (st.out ? 64 : 0) | (st.held ? 128 : 0) | (seated ? 256 : 0) | (impaled ? 512 : 0);
  }

  private standKey(kind: number, set: number, profile: number, doing: number): number {
    return ((kind * 2 + set) * (65536 * (MAX_SEATS + 1)) + profile) * 1024 + doing;
  }

  /** Match the actually displayed footwear/glove mesh, including the bare fallback while a worn mesh is unavailable. */
  private partOf(set: BodySet, gear: Uint16Array | null, at: number, slot: number): number {
    const worn = gear ? this.worn[gear[at + GEAR_WORN + slot]!] : null;
    const mesh = worn?.slot === slot ? (set.armor[worn.set]?.[slot] ?? -1) : -1;
    return mesh >= 0 && this.assets.known(mesh) ? mesh : set.slots[slot]!;
  }

  /** The first bone of stand-in `s` this frame, put in the packet the first time it is asked for, or -1 without room. */
  private standInAt(p: FramePacket, s: StandIn): number {
    if (s.written === this.frame) return s.first;
    const first = this.room(p, s.rows.length / BONE_FLOATS, 0, false);
    if (first < 0) return -1;
    p.bones.set(s.rows, first * BONE_FLOATS);
    s.written = this.frame;
    s.first = first;
    return first;
  }

  /**
   * Writes to `out` where the creature `id`, of `kind`, goes in the arms of the survivor `carrier`, of `carrierKind`, at
   * (x, y, z) facing `yaw` radians: as near as a survivor of its stance holds one. Once its carrier is posed this frame it
   * is put right, to where the palms are drawn. False for a pair that is not drawn so.
   */
  heldAt(id: number, kind: number, carrier: number, carrierKind: number, x: number, y: number, z: number, yaw: number, st: AnimState, out: Float64Array): boolean {
    const at = this.creatures[kind]?.anim.holdAt;
    if (!at || !this.kinds[carrierKind]) return false;
    this.carriedBy.set(id, carrier);
    const palms = this.cradled[st.stance === STANCE_CROUCH ? 1 : 0]!;
    const mx = palms[0]! - at[0]!;
    const mz = palms[2]! - at[2]!;
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    out[0] = x + co * mx + s * mz;
    out[1] = y + palms[1]! - at[1]!;
    out[2] = z + co * mz - s * mx;
    return true;
  }

  /**
   * Moves each held creature posed this frame from where it was placed to where its carrier's palms are drawn, if its
   * carrier was posed. Once a frame, before the bones are used.
   */
  private placeHeld(p: FramePacket): void {
    if (this.placed) return;
    this.placed = true;
    const list = this.inArms;
    for (let k = 0; k < list.length; k += HELD_FIELDS) {
      const palms = this.palms.get(list[k + 7]!);
      const at = this.creatures[list[k + 8]!]?.anim.holdAt;
      if (!palms || !at) continue;
      const yaw = list[k + 5]!;
      const size = list[k + 6]!;
      const s = Math.sin(yaw);
      const co = Math.cos(yaw);
      const dx = palms[0]! - (co * at[0]! + s * at[2]!) * size - list[k + 2]!;
      const dy = palms[1]! - at[1]! * size - list[k + 3]!;
      const dz = palms[2]! - (co * at[2]! - s * at[0]!) * size - list[k + 4]!;
      for (let b = 0, o = list[k]! * BONE_FLOATS; b < list[k + 1]!; b++, o += BONE_FLOATS) {
        p.bones[o + 3]! += dx;
        p.bones[o + 7]! += dy;
        p.bones[o + 11]! += dz;
      }
      // Its overhead marks go with it.
      const head = this.headOf(list[k + 9]!);
      if (head >= 0) {
        this.headAt[head * 3]! += dx;
        this.headAt[head * 3 + 1]! += dy;
        this.headAt[head * 3 + 2]! += dz;
      }
    }
  }

  private addCreature(p: FramePacket, kind: number, c: Creature, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, colors: Uint8Array, colorAt: number, gear: Uint16Array | null, gearAt: number, id: number, size: number, rigid: boolean, unseen: boolean, vehicle?: VehicleRenderPose): boolean {
    const rig = c.anim.rig;
    // A saddle is drawn as the saddled model in place of the body, or else as its own mesh on the body's bones (D491).
    const saddle = gear ? gear[gearAt + GEAR_WORN]! : 0;
    const saddled = saddle !== 0 && this.saddle[saddle] === 1 && c.saddled >= 0;
    const worn = saddle === 0 || saddled ? -1 : (c.worn.get(saddle) ?? -1);
    this.packet = p;
    const standing = rigid ? this.standIn(kind, 0, st, false) : null;
    const stand = standing ? this.standInAt(p, standing) : -1;
    const first = rigid && stand < 0 ? -1 : this.room(p, rigid ? 1 : rig.bones, worn >= 0 ? 2 : 1, !unseen);
    if (first < 0) {
      if (rigid && stand < 0 && !unseen) p.dropped++;
      return false;
    }
    let solved = standing?.solved ?? rig.solved;
    if (rigid) {
      if (c.vehicle && vehicle?.qw !== undefined) {
        this.turn(vehicle, yaw, vehicle.pitch, vehicle.roll, this.rotation);
        writeRigid(p.bones, first * BONE_FLOATS, x, y, z, yaw, size, this.rotation);
      } else writeRigid(p.bones, first * BONE_FLOATS, x, y, z, yaw, size);
    }
    else {
      const v = c.vehicle;
      if (v) {
        rig.a.rest();
        const steering = vehicle?.steering ?? 0, s = v.def.steeringWheel;
        if (s && v.steer >= 0) quatAxis(rig.a.rot, v.steer * 4, s.axis[0], s.axis[1], s.axis[2], steering * s.ratio);
        for (let d = 0; d < v.def.doors.length; d++) {
          const door = v.def.doors[d]!, b = v.doors[d]!;
          if (b < 0) continue;
          const fraction = vehicleDoor(vehicle?.doors ?? 0, d);
          if (door.slide) {
            const offsets = v.slideOffsets!;
            offsets[b * 3] = door.slide.outward * Math.min(1, fraction * 5);
            offsets[b * 3 + 2] = door.slide.along * Math.max(0, (fraction - .2) / .8);
          } else quatAxis(rig.a.rot, b * 4, door.axis[0], door.axis[1], door.axis[2], fraction * door.open);
        }
        if (v.def.movement === "rotor") {
          for (let r = 0; r < v.def.rotors.length; r++) {
            const rotor = v.def.rotors[r]!, b = v.rotors[r]!;
            if (b >= 0) quatAxis(rig.a.rot, b * 4, rotor.axis[0], rotor.axis[1], rotor.axis[2], (vehicle?.rotorPhase ?? 0) * rotor.ratio);
          }
        }
        for (const part of v.drives) {
          const angle = part.spin ? vehicle?.wheelAngle ?? 0 : steering;
          quatAxis(rig.a.rot, part.bone * 4, part.axis[0], part.axis[1], part.axis[2], angle * part.ratio);
        }
        quatAxis(this.wheel, 0, 1, 0, 0, vehicle?.wheelAngle ?? 0);
        for (let w = 0; w < v.def.wheels.length; w++) {
          const b = v.wheels[w]!;
          if (b < 0) continue;
          quatAxis(this.steer, 0, 0, 1, 0, v.def.wheels[w]!.steers ? steering : 0);
          quatMul(rig.a.rot, b * 4, this.steer, 0, this.wheel, 0);
        }
        solve(rig, rig.a, rig.solved, rig.rest, null, v.slideOffsets);
        this.fresh++;
      } else solved = this.creatureSolved(kind, c, id, x, y, z, yaw, st, tick, size, unseen);
      if (v) {
        this.turn(vehicle, yaw, vehicle?.pitch ?? 0, vehicle?.roll ?? 0, this.rotation);
        orientSolved(rig.solved, this.rotation, c.oriented);
        // Wheel contact follows the support plane while the sprung body and its occupants roll, pitch and heave.
        this.turn(undefined, yaw, vehicle?.groundPitch ?? vehicle?.pitch ?? 0, vehicle?.groundRoll ?? vehicle?.roll ?? 0, this.groundRotation);
        // Without a full attitude, a wheel in the air hangs a quarter of its travel below the body.
        const droop = v.def.movement !== "rotor" && v.def.movement !== "boat" ? (v.def.spec.suspensionTravel ?? 0.18) / 4 : 0;
        for (const b of v.wheels) {
          if (b < 0) continue;
          if (vehicle?.qw !== undefined && v.def.movement !== "rotor" && v.def.movement !== "boat") {
            // A rigid car's wheels travel along its local spring axes, also when it rolls onto its roof. The ride offset is
            // that travel, all of it where no wheel has ground. The grounded bit is the hull's contact too, and a rolled car
            // rocking on its side or roof touches and leaves the ground from tick to tick, so it does not move the wheels.
            quatRotate(this.rotation, 0, 0, -(vehicle.rideOffset ?? 0), 0, this.seatPlace, 0);
            for (let axis = 0; axis < 3; axis++) c.oriented.pos[b * 3 + axis]! += this.seatPlace[axis]!;
          } else if (vehicle?.grounded !== false) {
            quatRotate(this.groundRotation, 0, rig.solved.pos[b * 3]!, rig.solved.pos[b * 3 + 1]!, rig.solved.pos[b * 3 + 2]!, c.oriented.pos, b * 3);
            c.oriented.pos[b * 3 + 1]! -= vehicle?.rideOffset ?? 0;
            quatMul(c.oriented.rot, b * 4, this.groundRotation, 0, rig.solved.rot, b * 4);
          } else c.oriented.pos[b * 3 + 1]! -= droop;
        }
        writeBones(p.bones, first * BONE_FLOATS, c.oriented, rig.rest, null, x, y, z, 0, size);
        if (!unseen && p.tier.contact && isWheelVehicle(v.def) && Math.hypot(x,y,z) < 16 + v.def.spec.halfLength * size) {
          this.tireContacts.consider(p, first, v.wheels, rig.rest, v.def.spec.wheelRadius * size);
        }
        if (!unseen && v.def.movement === "rotor") {
          for (let r = 0; r < v.def.rotors.length; r++) {
            const b = v.rotors[r]!;
            if (b >= 0) this.rotorBlur.add(p, first + b, id * 4 + r, v.def.rotors[r]!, vehicle?.rotorRpm ?? 0, this.rotation, x, y, z, size);
          }
        }
      } else writeBones(p.bones, first * BONE_FLOATS, solved, rig.rest, null, x, y, z, yaw, size);
      this.posed++;
      if (!unseen) this.keepHead(c, solved, id, p.camX + x, p.camY + y, p.camZ + z, yaw, size);
    }
    const def = c.vehicle?.def;
    if (def && !unseen && !st.dead) this.windscreens.add(p, first, def.id, id, st.hurt);
    if (!unseen && vehicle?.lightMode && def && isWheelVehicle(def) && def.emergencyLights) {
      this.patrolLights.add(p, first, def.emergencyLights, vehicle.lightMode, tick, id, size);
    }
    if (!c.vehicle) {
      const g = this.gaitOf(id);
      g.kind = kind; g.shown = solved; g.shownFrame = this.frame; g.shownTick = tick; g.shownRigid = rigid;
    }
    const carrier = st.held ? this.carriedBy.get(id) : undefined;
    if (carrier !== undefined) this.inArms.push(first, rigid ? 1 : rig.bones, x, y, z, yaw, size, carrier, kind, id);
    const layer = unseen || !this.assets.tier.lit ? 0 : this.layers.level(id, layerWanted(st), tick, this.last.has(id));
    const body = this.count;
    const lod = saddled ? this.queueCreature(c, c.saddled, c.saddledError, first, x, y, z, colors, colorAt, id, size, stand, unseen, layer) : this.queueCreature(c, c.mesh, c.error, first, x, y, z, colors, colorAt, id, size, stand, unseen, layer);
    if (worn >= 0) this.queueWorn(c, worn, lod, x, y, z, size, stand, colors, colorAt);
    if (st.rivalry && !st.out) {
      const region = c.anim.combat?.rivalry?.signalRegion;
      if (region !== undefined) {
        const at = body * 6 + region, base = this.colors[at]!;
        this.colors[at] = this.rivalryColors[base] || (this.rivalryColors[base] = rivalryColor(this.palette, base));
      }
    }
    return true;
  }

  /**
   * Keeps where the pose just solved puts its `overhead` socket, or a little above its highest joint on a rig without one.
   * A head turned over, as on a body lying on its back, takes the socket below it, so the socket is held at its bone's height.
   */
  private keepHead(c: Creature, solved: Solved, id: number, x: number, y: number, z: number, yaw: number, size: number): void {
    const rig = c.anim.rig;
    const out = this.socketAt;
    const socket = rig.sockets.get("overhead");
    const pos = solved.pos;
    if (socket) {
      boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, out);
      out[1] = Math.max(out[1]!, pos[socket.bone * 3 + 1]!);
    } else {
      let top = 0;
      for (let b = 1; b < rig.bones; b++) if (pos[b * 3 + 1]! > pos[top * 3 + 1]!) top = b;
      out[0] = pos[top * 3]!;
      out[1] = pos[top * 3 + 1]! + 0.2;
      out[2] = pos[top * 3 + 2]!;
    }
    const n = this.headCount++;
    if (n * 3 + 3 > this.headAt.length) {
      const wider = new Float32Array(this.headAt.length * 2);
      wider.set(this.headAt);
      this.headAt = wider;
      const ids = new Uint32Array(this.headIds.length * 2);
      ids.set(this.headIds);
      this.headIds = ids;
    }
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    this.headAt[n * 3] = x + (co * out[0]! + s * out[2]!) * size;
    this.headAt[n * 3 + 1] = y + out[1]! * size;
    this.headAt[n * 3 + 2] = z + (co * out[2]! - s * out[0]!) * size;
    this.headIds[n] = id;
    this.heads.set(id, n);
  }

  /** The slot in `headAt` of creature `id` posed this frame, or -1. */
  private headOf(id: number): number {
    const n = this.heads.get(id);
    return n !== undefined && n < this.headCount && this.headIds[n] === id ? n : -1;
  }

  /** Writes to `out` where creature `id` shows its overhead marks as drawn this frame, in world coordinates. False if it was not posed. */
  overhead(id: number, out: number[]): boolean {
    const n = this.headOf(id);
    if (n < 0) return false;
    out[0] = this.headAt[n * 3]!;
    out[1] = this.headAt[n * 3 + 1]!;
    out[2] = this.headAt[n * 3 + 2]!;
    return true;
  }

  /**
   * Queues a creature's `mesh`, whose levels lie `error` from its finest, on the bones from `first`, at the level its
   * distance and size call for, and with its layer at `layer` where that level is drawn with materials, worn as its
   * colours say where it is a road vehicle. One `unseen`
   * only casts, and asks for nothing. `stand` is the first bone of the pose it stands in on one bone, or -1. Returns the level.
   */
  private queueCreature(c: Creature, mesh: number, error: readonly number[], first: number, x: number, y: number, z: number, colors: Uint8Array, colorAt: number, id: number, size: number, stand: number, unseen: boolean, layer = 0): number {
    const n = this.count++;
    // A young one is the same mesh drawn smaller, and so are its errors.
    const far = Math.sqrt(x * x + y * y + z * z) / size;
    const lod = this.levelOf(id, error, far);
    if (!unseen) this.assets.wantTextured(mesh, lod, far);
    if (!unseen && c.clips >= 0) this.assets.wantClips(c.clips);
    const shown = layer > 0 && this.assets.wantLayers(mesh, lod, far) ? layer + (c.wear ? wearOf(colors, colorAt, c.wear) * WEAR_KEY : 0) : 0;
    const key = this.keyOf(mesh * this.levels + lod, shown, stand);
    this.key[n] = key < 0 ? 0 : key;
    this.firstBone[n] = first;
    this.region0[n] = c.flatColors?.[0] ? 0 : c.color;
    this.bodyColors(n, c, mesh, lod, colors, colorAt, !unseen);
    this.id[n] = id;
    this.near[n] = key < 0 ? NONE : unseen ? CASTS : SEEN;
    const s = this.shadows;
    this.mask[n] = s ? s.body(x, y, z, c.anim.rig.reach * size) & s.mesh(mesh) : 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
    return lod;
  }

  /** Zero is undyed in the surface shader. A flat region vertex needs a real palette index for the same gene. */
  private bodyColors(n: number, c: Creature, mesh: number, lod: number, genome: Uint8Array, at: number, visible: boolean): void {
    const defaults = c.flatColors;
    let missing = false;
    for (let q = 0; q < 6; q++) {
      const colour = genome[at + q]!;
      this.colors[n * 6 + q] = colour;
      if (colour === 0 && defaults?.[q]) missing = true;
    }
    if (visible && missing && this.assets.texturedLevel(mesh, lod, this.assets.heldLevel(mesh, lod)) < 0) {
      for (let q = 0; q < 6; q++) this.colors[n * 6 + q] ||= defaults![q]!;
    }
  }

  /**
   * Queues the saddle `mesh` on the creature queued last, on its bones, in its colours and at its level `lod`, or the
   * saddle's coarsest where it has fewer. Nothing in ARK dyes a saddle, so the saddle is drawn in its own colours, but
   * where it names a colour region it takes the creature's.
   */
  private queueWorn(c: Creature, mesh: number, lod: number, x: number, y: number, z: number, size: number, stand: number, colors: Uint8Array, colorAt: number): void {
    const body = this.count - 1;
    const n = this.count++;
    const level = Math.min(lod, this.assets.table.error[mesh]!.length - 1);
    if (this.near[body] !== CASTS) this.assets.wantTextured(mesh, level, Math.sqrt(x * x + y * y + z * z) / size);
    const key = this.keyOf(mesh * this.levels + level, 0, stand);
    this.key[n] = key < 0 ? 0 : key;
    this.firstBone[n] = this.firstBone[body]!;
    this.region0[n] = this.region0[body]!;
    this.bodyColors(n, c, mesh, level, colors, colorAt, this.near[body] === SEEN);
    this.id[n] = this.id[body]!;
    this.near[n] = key < 0 ? NONE : this.near[body]!;
    const s = this.shadows;
    this.mask[n] = s ? s.body(x, y, z, c.anim.rig.reach * size) & s.mesh(mesh) : 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
  }

  /**
   * Finds the creatures that have died among the remote entities, moves the dead on through their death clips and
   * ragdolls, and draws those in view where they lie. `world` is what a ragdoll falls on.
   */
  corpses(p: FramePacket, cam: Camera, remote: RemoteSample, world: CollisionWorld): void {
    this.dead.update(remote, world, cam.x, cam.z, this.gaits, this.corpseMotions);
    const lit = this.assets.tier.lit;
    for (const d of this.dead.list) {
      const c = this.creatures[d.kind]!;
      const x = d.x - cam.x;
      const y = d.y - cam.y;
      const z = d.z - cam.z;
      // A ragdoll may roll from where it died: its root bone says how far.
      const r = (c.anim.rig.reach + Math.abs(d.solved.pos[0]!) + Math.abs(d.solved.pos[2]!)) * d.size;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      const first = this.room(p, c.anim.rig.bones, 1);
      if (first < 0) return;
      if (d.rigid) {
        this.rotation[0] = d.qx; this.rotation[1] = d.qy; this.rotation[2] = d.qz; this.rotation[3] = d.qw;
        orientSolved(d.solved, this.rotation, c.oriented);
        writeBones(p.bones, first * BONE_FLOATS, c.oriented, c.anim.rig.rest, null, x, y, z, 0, d.size);
      } else writeBones(p.bones, first * BONE_FLOATS, d.solved, c.anim.rig.rest, null, x, y, z, d.yaw, d.size);
      this.queueCreature(c, c.wreck >= 0 ? c.wreck : c.mesh, c.wreck >= 0 ? c.wreckError : c.error, first, x, y, z, d.colors, 0, d.id, d.size, -1, false, lit ? this.layers.level(d.id, corpseWanted(d.decay), remote.tick, this.last.has(d.id)) : 0);
    }
  }

  /**
   * The key of `key`'s bodies whose layer is at `layer`, with its wear story, and that stand in the pose at bone `stand` (-1 for none). With no
   * key left those with a layer are drawn as `key`'s, without it, and those standing in a pose not at all: -1, counted dropped.
   */
  private keyOf(key: number, layer: number, stand: number): number {
    if (layer === 0 && stand < 0) return key;
    const l = this.extra;
    const at = this.extraAt;
    let h = (Math.imul(key, 0x9e3779b1) ^ Math.imul(stand + 1, 0x85ebca6b) ^ layer) & (at.length - 1);
    for (; at[h] !== 0; h = (h + 1) & (at.length - 1)) {
      const k = at[h]! - 1;
      if (l[k * 3] === key && l[k * 3 + 1] === layer && l[k * 3 + 2] === stand) return this.plain + k;
    }
    if (this.extraKeys === EXTRA_KEYS) {
      if (stand < 0) return key;
      if (this.packet) this.packet.dropped++;
      return -1;
    }
    l[this.extraKeys * 3] = key;
    l[this.extraKeys * 3 + 1] = layer;
    l[this.extraKeys * 3 + 2] = stand;
    at[h] = this.extraKeys + 1;
    return this.plain + this.extraKeys++;
  }

  /**
   * Takes `bones` bones for a body of `parts` meshes and returns the first, or returns -1, counting the body as dropped if
   * `counted`. A frame has the bones its tier has, and the texture holds no more.
   */
  private room(p: FramePacket, bones: number, parts: number, counted = true): number {
    const first = p.boneCount;
    if (first + bones > Math.min(p.tier.bones, MAX_BONES) || this.count + parts > MAX_SKINNED) {
      if (counted) p.dropped++;
      return -1;
    }
    p.boneCount = first + bones;
    return first;
  }

  /** Begins a frame, in `p` where one is drawn. */
  begin(p: FramePacket | null = null, world: CollisionWorld | null = null): void {
    this.cameraBody.clear();
    this.groundWorld = world;
    this.packet = p ?? this.packet;
    this.count = 0;
    this.tireContacts.begin();
    this.windscreens.begin();
    this.rotorBlur.begin();
    this.patrolLights.begin();
    this.posed = 0;
    this.fresh = 0;
    for (const at of this.palms.values()) this.palmPool.push(at);
    this.palms.clear();
    this.carriedBy.clear();
    for (const feet of this.riderCounted.values()) for (const counted of feet.values()) counted.clear();
    this.inArms.length = 0;
    this.placed = false;
    this.headCount = 0;
    if (this.heads.size > 4096) this.heads.clear();
    if (this.extraKeys > 0) this.extraAt.fill(0);
    this.extraKeys = 0;
    this.layers.begin();
    // Ids of bodies long gone would otherwise be kept for good.
    if (this.last.size > 4096) this.last.clear();
    if (this.lastHeavy.size > 4096) this.lastHeavy.clear();
    if (++this.frame % FORGET_GAIT === 0) for (const id of this.gaits.keys()) if (this.frame - this.gaits.get(id)!.seen > FORGET_GAIT) this.gaits.delete(id);
    if (this.waiting.length > 0) this.takeClips();
    if (this.emoteSlot >= 0 && this.emotesWanted) this.takeEmotes();
  }

  /** Whether the game has emote `n` here: its clip is in the boot pack, or in the group that streams. */
  emoteKnown(n: number): boolean {
    const e = EMOTES[n - 1];
    return !!e && (!!this.anim.emotes[n] || this.assets.table.has("clip", emoteClipId(e.id)));
  }

  /** Asks for the emotes' clips, as a body plays one or the emote menu opens. */
  wantEmotes(): void {
    if (this.emoteSlot < 0) return;
    this.emotesWanted = true;
    this.assets.wantClips(this.emoteSlot);
  }

  /** The emotes' clips, once come: every body plays them from then, and its whole-body stand-ins are made again. */
  private takeEmotes(): void {
    this.assets.wantClips(this.emoteSlot);
    const set = this.assets.clips(this.emoteSlot);
    if (!set) return;
    this.anim.addEmotes(set);
    this.emoteStandIns.clear();
    this.emoteSlot = -1;
  }

  /**
   * Gives each creature waiting for its skeleton's clips those that have come. From then it plays them as it would have
   * from the first: its stand-ins are made again, and each of its bodies is posed anew, its gait taken up where the server
   * has it, as a body first seen then is.
   */
  private takeClips(): void {
    let kept = 0;
    for (const kind of this.waiting) {
      const c = this.creatures[kind]!;
      const set = this.assets.clips(c.clips);
      if (!set) {
        this.waiting[kept++] = kind;
        continue;
      }
      const rig = buildRig(this.rigs.find((r) => r.id === c.anim.rig.id)!, set)!;
      c.anim = this.anims[kind] = new CreatureAnim(rig, this.reg.runAt[kind]!, this.reg.move[kind]?.swimSpeed ?? 0, this.reg.combat[kind]);
      c.clips = -1;
      this.standIns[kind * 2] = [];
      this.riderStandIns.clear();
      for (const id of this.gaits.keys()) {
        const gait = this.gaits.get(id)!;
        if (gait.kind === kind) this.gaits.delete(id);
        else if (this.reg.saddleFits[Math.floor(gait.riderProfile / (MAX_SEATS + 1))] === kind) gait.form = -1;
      }
    }
    this.waiting.length = kept;
  }

  /** The level a body `distance` off is drawn at: as the tier asks, and coarser at the governor's bodies step (Tier.bodyError). */
  private levelOf(id: number, errors: readonly number[], distance: number): number {
    const level = this.assets.choose(errors, distance * this.assets.tier.bodyError, this.last.get(id) ?? -1);
    this.last.set(id, level);
    return level;
  }

  /**
   * `x, y, z` is the origin relative to the camera, `yaw` is in radians, and `tick` may fall between ticks. `look` holds a
   * 28-byte look at `lookAt`, or is null for a body drawn in the six colour regions of `colors` at `colorAt`. `gear` is
   * laid out as EntityStore.gear, at `gearAt`, or is null. `own` draws it in the near pass. `headless` leaves out the head
   * and what is on it. `size` scales a creature, below 1 for a young one. `rigid` draws it on one bone, standing in a pose
   * for what it is doing (standIn), for a frame without the bones to pose it. `unseen` poses it as a body in view is posed, for its shadow alone: none of it is
   * drawn in the view and it asks for nothing. Returns false when the frame has no room left even for that, and counts a
   * body in view dropped. While the sun casts, what `headless` leaves out still casts. `seat` holds, at `seatAt`, the rows
   * of the turn of the saddle seat a survivor rides in (seat()), which turns it in place of `yaw`; it sits astride, its hands
   * on the grips where it `steers`, else its upper body its own, to look and aim.
   */
  add(p: FramePacket, kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, look: Uint8Array | null, lookAt: number, colors: Uint8Array, colorAt: number, gear: Uint16Array | null, gearAt: number, id: number, own: boolean, headless: boolean, size = 1, rigid = false, unseen = false, seat: Float64Array | null = null, seatAt = 0, vehicle?: VehicleRenderPose, vehicleSeat?: VehicleSeatPose, steers = true, impaled = false, rider?: RiderFit): boolean {
    const creature = this.creatures[kind];
    if (creature) return this.addCreature(p, kind, creature, x, y, z, yaw, st, tick, colors, colorAt, gear, gearAt, id, size, rigid, unseen, vehicle);
    const k = this.kinds[kind];
    if (!k) return false;
    // An enclosed passenger must retain a seated pose even under the distant-body budget.
    if (vehicleSeat) rigid = false;
    this.packet = p;
    const at = this.setOf(k, look, lookAt);
    const set = k.sets[at]!;
    const foot = rider?.profile && (rider.targets[0]! & RIDER_SOLES) !== 0 ? this.partOf(set, gear, gearAt, SLOT_FEET) : -1;
    const hand = rider?.profile && (rider.targets[0]! & RIDER_GRIPS) !== 0 ? this.partOf(set, gear, gearAt, SLOT_HANDS) : -1;
    const stand = rigid ? this.standInAt(p, this.standIn(kind, at, st, seat !== null, impaled, rider, foot, hand)) : -1;
    const first = rigid && stand < 0 ? -1 : this.room(p, rigid ? 1 : HUMAN_BONES, PARTS, !unseen);
    if (first < 0) {
      if (rigid && stand < 0 && !unseen) p.dropped++;
      return false;
    }
    // A modelled body without a look gets the plain one, so its regions have colours.
    let view: Uint8Array | null = k.sets.length > 1 ? PLAIN : null;
    if (look) {
      for (let q = 0; q < LOOK_BYTES; q++) this.lookView[q] = look[lookAt + q]!;
      view = this.lookView;
    }
    if (view) lookColors(view, this.lookColor);
    if (rigid) {
      if (seat) {
        writeRigid(p.bones, first * BONE_FLOATS, 0, 0, 0, 0, 1);
        inFrame(p.bones, first * BONE_FLOATS, 1, seat, seatAt, x, y, z);
      } else writeRigid(p.bones, first * BONE_FLOATS, x, y, z, yaw, 1);
    } else {
      const g = this.gaitOf(id);
      advanceHuman(this.anim, g, st, tick, x + p.camX, z + p.camZ, yaw);
      const solved = this.kept(g, HUMAN_BONES);
      const scales = view ? scalesOf(g, view) : null;
      const revision = g.soles.revision;
      const soles = rider?.profile ? g.soles.update(set.soles.get(foot) ?? null, set.rest, view) : null;
      if (revision !== g.soles.revision) g.form = -1;
      const gripRevision = g.grips.revision, targets = rider?.targets;
      const grips = hand >= 0 && targets ? g.grips.update(set.grips.get(hand) ?? null, view, targets[RIDER_GRIP_RADIUS]!, targets[RIDER_GRIP_LOW]!, targets[RIDER_GRIP_HIGH]!, 0, targets[RIDER_FOREARM_ALIGNMENT] ?? 0) : null;
      if (gripRevision !== g.grips.revision) g.form = -1;
      g.kind = kind;
      if (g.riderProfile !== (rider?.profile ?? 0)) { g.form = -1; g.riderProfile = rider?.profile ?? 0; }
      const form = kind * 8 + at * 4 + (seat ? 1 : 0) + (impaled ? 2 : 0);
      if (this.due(g, form, id, Math.sqrt(x * x + y * y + z * z), unseen, seat || !st.grounded ? 0 : g.speed, own || vehicleSeat !== undefined)) this.posing(st, tick, g, seat, seatAt, yaw, vehicleSeat, steers, scales, set, solved, impaled, rider, soles, grips);
      if (seat) {
        // A rider sits in its seat's whole frame, and leans, pitches and banks as the seat does.
        writeBones(p.bones, first * BONE_FLOATS, solved, set.rest, scales, 0, 0, 0, 0);
        inFrame(p.bones, first * BONE_FLOATS, HUMAN_BONES, seat, seatAt, x, y, z);
      } else if (vehicleSeat) {
        vehicleRotation(vehicleSeat, this.rotation);
        this.seatPlace[0] = vehicleSeat.x;
        this.seatPlace[1] = vehicleSeat.y;
        this.seatPlace[2] = vehicleSeat.z;
        mountOrigin(solved, this.seatPlace, this.rotation, this.origin);
        orientSolved(solved, this.rotation, this.mounted);
        x = this.origin[0]!; y = this.origin[1]!; z = this.origin[2]!; yaw = 0;
        writeBones(p.bones, first * BONE_FLOATS, this.mounted, set.rest, scales, x, y, z, 0);
      } else writeBones(p.bones, first * BONE_FLOATS, solved, set.rest, scales, x, y, z, yaw);
      this.posed++;
      if (st.action >>> 3 === HOLD_CARRY) {
        // Where the palms are drawn, for the creature in them.
        const at = this.palmPool.pop() ?? new Float64Array(3);
        handsAt(seat ? this.mounted : solved, at);
        const s = Math.sin(yaw);
        const co = Math.cos(yaw);
        const mx = at[0]!, my = at[1]!, mz = at[2]!;
        at[0] = x + co * mx + s * mz;
        at[1] = y + my;
        at[2] = z + co * mz - s * mx;
        const was = this.palms.get(id);
        if (was) this.palmPool.push(was);
        this.palms.set(id, at);
      }
    }
    // The viewer's own body is as fine as the tier draws anything.
    const far = own ? 0 : Math.sqrt(x * x + y * y + z * z);
    const lod = own ? this.assets.choose(set.error, 0, -1) : this.levelOf(id, set.error, far);
    const s = this.shadows;
    const casts = s ? s.body(x, y, z, BODY_RADIUS) : 0;
    const part = this.part;
    part.lod = lod;
    part.far = far;
    part.stand = stand;
    part.first = first;
    part.color = k.color;
    part.id = id;
    part.own = own;
    part.casts = casts;
    part.rest = set.rest;
    const tint = view ? this.lookColor : colors;
    const tintAt = view ? 0 : colorAt;
    let covered = false, sealed = false;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const worn = gear ? this.worn[gear[gearAt + GEAR_WORN + slot]!] : null;
      // A piece whose page has not come is asked for, and the body's own part stands in until it does.
      const cut = worn && worn.slot === slot ? (set.armor[worn.set]?.[slot] ?? -1) : -1;
      const piece = cut >= 0 && this.assets.known(cut) ? cut : -1;
      const hidden = headless && slot === SLOT_HEAD;
      if (hidden && casts === 0) continue;
      const heavy = piece >= 0 && !own && set.heavy[worn!.set] === 1;
      if (heavy && lod === set.error.length - 1 && set.slots[slot]! >= 0) {
        // Too far to tell plates from paint: the body's own part in the outfit's colours, a fifth of the triangles.
        const c = this.wornColor;
        c.fill(worn!.colors[0]);
        c[REGION_SECOND - REGION_BASE] = worn!.colors[1];
        c[REGION_TRIM - REGION_BASE] = worn!.colors[2];
        this.queuePart(set.slots[slot]!, c, 0, -1, unseen || hidden);
        if (slot === SLOT_HEAD) { covered = true; sealed = worn!.sealed; }
        continue;
      }
      if (piece >= 0) {
        // The piece uses its own three colours, and the body's colours for the other regions.
        const c = this.wornColor;
        for (let q = 0; q < 6; q++) c[q] = view ? this.lookColor[q]! : colors[colorAt + q]!;
        c[REGION_MAIN - REGION_BASE] = worn!.colors[0];
        c[REGION_SECOND - REGION_BASE] = worn!.colors[1];
        c[REGION_TRIM - REGION_BASE] = worn!.colors[2];
        if (heavy) {
          // Never finer than the body beside it, and coarser sooner (HEAVY_RELAX).
          const level = Math.max(lod, this.assets.choose(set.error, far * this.assets.tier.bodyError * HEAVY_RELAX, this.lastHeavy.get(id) ?? -1));
          this.lastHeavy.set(id, level);
          part.lod = level;
        }
        this.queuePart(piece, c, 0, -1, unseen || hidden);
        part.lod = lod;
        if (worn!.vented && (slot !== SLOT_FEET || st.bootJets) && st.jet && !st.grounded && st.mode !== MODE_SWIM && !seat && !vehicleSeat && !st.dead && !st.out) {
          const vents = set.vents[worn!.set * SLOT_COUNT + slot]!;
          if (vents >= 0 && !unseen && !hidden && this.assets.known(vents)) {
            // The fixed housings already cast with the cuirass. Exhaust never enters a shadow cascade.
            part.casts = 0;
            this.queuePart(vents, c, 0, -1, false);
            part.casts = casts;
          }
        }
        if (slot === SLOT_HEAD) { covered = true; sealed = worn!.sealed; }
      }
      // Open headgear keeps the underlying face visible.
      const body = set.slots[slot]!;
      if (body >= 0 && (piece < 0 || (slot === SLOT_HEAD && !sealed))) this.queuePart(body, tint, tintAt, -1, unseen || hidden);
    }
    if (view && (!headless || casts !== 0)) {
      // Open headgear still shows the beard.
      const hair = covered ? -1 : (set.hair[view[LOOK_HAIR]!] ?? -1);
      if (hair >= 0) this.queuePart(hair, tint, tintAt, -1, unseen || headless);
      const beard = sealed ? -1 : (set.beard[view[LOOK_BEARD]!] ?? -1);
      if (beard >= 0) this.queuePart(beard, tint, tintAt, -1, unseen || headless);
    }
    const inHand = gear && !impaled && vehicleSeat?.weapons !== false ? this.held[gear[gearAt + GEAR_HELD]!] : null;
    if (inHand) this.queuePart(inHand.mesh, tint, tintAt, inHand.bone, unseen);
    return true;
  }

  /**
   * Works out a survivor's pose into `solved`: from its state at `tick` and its gait, seated in a saddle `seat` or a
   * vehicle's, aiming from there, and stretched by its look's `scales`.
   */
  private posing(st: AnimState, tick: number, g: Stride, seat: Float64Array | null, seatAt: number, yaw: number, vehicleSeat: VehicleSeatPose | undefined, steers: boolean, scales: Float32Array | null, set: BodySet, solved: Solved, impaled = false, rider?: RiderFit, soles: Float64Array | null = null, grips: Float64Array | null = null): void {
    if (impaled) {
      humanPose(this.anim, st, tick, this.pose, g);
      this.seatedPose("impaled", 0, undefined, undefined);
    } else if (vehicleSeat || seat) occupantPose(this.anim, st, tick, this.pose, vehicleSeat, seat, seatAt, yaw, steers, this.mount);
    else {
      if (st.emote !== 0 && !this.anim.emotes[st.emote]) this.wantEmotes();
      humanPose(this.anim, st, tick, this.pose, g);
    }
    // Longer legs lift the hips, so the feet stay on the ground.
    if (scales && !seat && !vehicleSeat && !impaled) this.pose.root[1]! += lookLift(scales, set.rest);
    solve(HUMAN, this.pose, solved, set.rest, scales);
    if (rider?.profile && seat) fitRiderControls(this.pose, solved, set.rest, scales, rider.targets, steers, undefined, soles, grips);
    if (vehicleSeat?.definition) fitSeatControls(this.pose, solved, set.rest, scales, vehicleSeat.definition, vehicleSeat.steering);
  }

  /** Queues mesh `m` of the survivor `add` is adding, tinted from `tint` at `tintAt`, hung on `bone` for a held item, and for its shadow `only`. */
  private queuePart(m: number, tint: Uint8Array | null, tintAt: number, bone: number, only: boolean): void {
    const part = this.part;
    const n = this.count++;
    if (!only) this.assets.wantTextured(m, part.lod, part.far);
    const key = this.keyOf(m * this.levels + part.lod, 0, part.stand);
    this.key[n] = key < 0 ? 0 : key;
    this.firstBone[n] = part.first;
    this.region0[n] = part.color;
    for (let q = 0; q < 6; q++) this.colors[n * 6 + q] = tint ? tint[tintAt + q]! : 0;
    this.id[n] = part.id;
    this.near[n] = key < 0 ? NONE : only ? CASTS : part.own ? OWN : SEEN;
    this.mask[n] = part.casts === 0 ? 0 : part.casts & this.shadows!.mesh(m);
    // A held item is modelled around its grip, so it is offset to where its bone rests on this body.
    for (let a = 0; a < 3; a++) this.offset[n * 3 + a] = bone < 0 ? 0 : part.rest![bone * 3 + a]!;
  }

  /** Poses `this.pose` seated as `role`, its arms on a wheel turned `steering`, its upper body from `upper` where given. */
  private seatedPose(role: MountMotionRole, tick: number, steering: number | undefined, upper: Pose | undefined): void {
    const input = this.seating;
    input.role = role;
    input.tick = tick;
    input.steering = steering;
    input.upper = upper;
    mountPose(this.mount, input, this.pose);
  }

  /** `vehicleRotation` of a vehicle turned `yaw`, `pitch` and `roll`, or as its pose's quaternion says where it has one. */
  private turn(vehicle: VehicleRenderPose | undefined, yaw: number, pitch: number, roll: number, out: Float64Array): void {
    const f = this.turnFrame;
    f.yaw = yaw;
    f.pitch = pitch;
    f.roll = roll;
    f.qx = vehicle?.qx;
    f.qy = vehicle?.qy;
    f.qz = vehicle?.qz;
    f.qw = vehicle?.qw;
    vehicleRotation(f, out);
  }

  /**
   * Queues a rigid mesh that has its own position and direction, such as an arrow in the air. Its origin goes to (x, y, z)
   * relative to the camera and its +Z along the unit direction (dx, dy, dz), stretched `length` times along it and `wide`
   * times across. It is drawn through the bone path with one bone, which gives it a tilt and a size as well as a facing.
   * False when the frame has no room left, and then it is counted dropped.
   */
  loose(p: FramePacket, mesh: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, wide = 1): boolean {
    const first = this.room(p, 1, 1);
    if (first < 0) return false;
    // Right is level and square to the direction. Up is the direction crossed with right, so the basis keeps its handedness.
    let rx = dz;
    let rz = -dx;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    const ux = dy * rz;
    const uy = dz * rx - dx * rz;
    const uz = -dy * rx;
    const o = first * BONE_FLOATS;
    const b = p.bones;
    b[o] = rx * wide;
    b[o + 1] = ux * wide;
    b[o + 2] = dx * length;
    b[o + 3] = x;
    b[o + 4] = 0;
    b[o + 5] = uy * wide;
    b[o + 6] = dy * length;
    b[o + 7] = y;
    b[o + 8] = rz * wide;
    b[o + 9] = uz * wide;
    b[o + 10] = dz * length;
    b[o + 11] = z;
    showMaterials(this.assets, mesh, Math.sqrt(x * x + y * y + z * z), wide);
    const n = this.count++;
    this.key[n] = mesh * this.levels;
    this.firstBone[n] = first;
    this.region0[n] = 0;
    this.colors.fill(0, n * 6, n * 6 + 6);
    this.id[n] = 0;
    this.near[n] = SEEN;
    this.mask[n] = 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
    return true;
  }

  /**
   * Writes the viewer's own body when `own`, and every other body otherwise. With `cast`, the instances of a draw are
   * ordered by the cascades they cast into, each run of them a caster; and after the viewer's own body come the
   * instances that only cast, which no draw takes.
   */
  flush(p: FramePacket, writer: InstanceWriter, own: boolean, draw: DrawFn, cast: CastFn | null = null): void {
    this.placeHeld(p);
    this.group(p, writer, own ? OWN : SEEN, draw, cast, DRAW_SKINNED | DRAW_PLAIN | (own ? DRAW_NEAR : 0));
    if (own && cast) this.group(p, writer, CASTS, null, cast, DRAW_SKINNED | DRAW_PLAIN);
  }

  /** Writes the instances queued as `want`, a draw for each key unless `draw` is null. */
  private group(p: FramePacket, writer: InstanceWriter, want: number, draw: DrawFn | null, cast: CastFn | null, flags: number): void {
    const counts = this.counts.fill(0);
    const byMask = cast ? this.maskCounts : null;
    let any = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      counts[this.key[i]!]!++;
      if (byMask) byMask[this.key[i]! * MASKS + this.mask[i]!]!++;
      any++;
    }
    if (any === 0) return;
    let total = p.transientCount;
    for (let k = 0; k < counts.length; k++) {
      this.cursor[k] = total;
      if (counts[k] === 0) continue;
      const x = (k - this.plain) * 3;
      const key = x < 0 ? k : this.extra[x]!;
      const stand = x < 0 ? -1 : this.extra[x + 2]!;
      const mesh = Math.floor(key / this.levels), lod = key % this.levels;
      // Bodies standing in a pose on one bone are a draw of their own.
      const f = stand >= 0 ? flags | DRAW_ONE_BONE : flags;
      draw?.(mesh, lod, total, counts[k]!, f, x < 0 ? 0 : this.extra[x + 1]!, stand < 0 ? 0 : stand);
      if (byMask) {
        for (let m = 0, at = total; m < MASKS; m++) {
          const n = byMask[k * MASKS + m]!;
          this.maskCursor[k * MASKS + m] = at;
          if (n > 0 && m > 0) cast!(mesh, lod, at, n, f, m, stand < 0 ? 0 : stand);
          byMask[k * MASKS + m] = 0;
          at += n;
        }
      }
      total += counts[k]!;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      const at = byMask ? this.maskCursor[this.key[i]! * MASKS + this.mask[i]!]!++ : this.cursor[this.key[i]!]!++;
      writer.setSkinned(at, this.firstBone[i]!, this.region0[i]!, this.offset[i * 3]!, this.offset[i * 3 + 1]!, this.offset[i * 3 + 2]!);
      writer.regions(at, this.colors, i * 6);
      p.transientIds[at] = this.id[i]!;
    }
    p.transientCount = total;
  }
}

/** The bone scales of the look `view` (lookScales), worked out again only when the body's look is not the one it last had. */
function scalesOf(g: Stride, view: Uint8Array): Float32Array {
  let same = g.look !== null;
  for (let q = 0; q < LOOK_BYTES && same; q++) same = g.look![q] === view[q];
  if (same) return g.scales!;
  g.look ??= new Uint8Array(LOOK_BYTES);
  g.scales ??= new Float32Array(HUMAN_BONES * 3);
  for (let q = 0; q < LOOK_BYTES; q++) g.look[q] = view[q]!;
  lookScales(g.look, g.scales);
  return g.scales;
}

/**
 * Says the materials of a mesh's finest level are on screen, `distance` metres off and `size` times as large as modelled.
 * For a thing drawn at its finest however far off, which so never says what level it wants.
 */
export function showMaterials(assets: Assets, mesh: number, distance: number, size = 1): void {
  const runs = assets.table.sections[mesh]![0]!;
  for (let k = 0; k < runs.length; k += 3) assets.material(runs[k]!, distance, size);
}

/**
 * Turns the rows of `bones` bones at `at`, written about the origin facing +Z, by the turn whose rows are at `turnAt` in
 * `turn`, and moves them to (x, y, z).
 */
function inFrame(out: Float32Array, at: number, bones: number, turn: Float64Array, turnAt: number, x: number, y: number, z: number): void {
  const f00 = turn[turnAt]!, f01 = turn[turnAt + 1]!, f02 = turn[turnAt + 2]!;
  const f10 = turn[turnAt + 3]!, f11 = turn[turnAt + 4]!, f12 = turn[turnAt + 5]!;
  const f20 = turn[turnAt + 6]!, f21 = turn[turnAt + 7]!, f22 = turn[turnAt + 8]!;
  for (let b = 0; b < bones; b++) {
    const o = at + b * BONE_FLOATS;
    for (let col = 0; col < 4; col++) {
      const r0 = out[o + col]!, r1 = out[o + 4 + col]!, r2 = out[o + 8 + col]!;
      const last = col === 3 ? 1 : 0;
      out[o + col] = f00 * r0 + f01 * r1 + f02 * r2 + last * x;
      out[o + 4 + col] = f10 * r0 + f11 * r1 + f12 * r2 + last * y;
      out[o + 8 + col] = f20 * r0 + f21 * r1 + f22 * r2 + last * z;
    }
  }
}

/** Writes at `at` the one bone of a body left in its rest pose: it turns the body about +Y, sizes it and puts it in its place. */
function writeRigid(out: Float32Array, at: number, x: number, y: number, z: number, yaw: number, size: number, q?: Float64Array): void {
  if (q) {
    const qx = q[0]!, qy = q[1]!, qz = q[2]!, qw = q[3]!;
    out[at] = (1 - 2 * (qy * qy + qz * qz)) * size; out[at + 1] = 2 * (qx * qy - qz * qw) * size; out[at + 2] = 2 * (qx * qz + qy * qw) * size; out[at + 3] = x;
    out[at + 4] = 2 * (qx * qy + qz * qw) * size; out[at + 5] = (1 - 2 * (qx * qx + qz * qz)) * size; out[at + 6] = 2 * (qy * qz - qx * qw) * size; out[at + 7] = y;
    out[at + 8] = 2 * (qx * qz - qy * qw) * size; out[at + 9] = 2 * (qy * qz + qx * qw) * size; out[at + 10] = (1 - 2 * (qx * qx + qy * qy)) * size; out[at + 11] = z;
    return;
  }
  const s = Math.sin(yaw) * size;
  const c = Math.cos(yaw) * size;
  out.fill(0, at, at + BONE_FLOATS);
  out[at] = c;
  out[at + 2] = s;
  out[at + 3] = x;
  out[at + 5] = size;
  out[at + 7] = y;
  out[at + 8] = -s;
  out[at + 10] = c;
  out[at + 11] = z;
}

/** The first wear story of a vehicle's kind (wear.ts): a road vehicle's or a vessel's, and 0 for anything else. */
function storiesOf(def: VehicleDefinition | null): number {
  return !def ? 0 : isWheelVehicle(def) ? ROAD_STORIES : isBoatVehicle(def) ? MARINE_STORIES : 0;
}

function vehicleRig(def: VehicleDefinition | null, names: readonly string[]): VehicleRig | null {
  if (!def) return null;
  const bone = (name: string): number => names.indexOf(name);
  const drives: VehicleRig["drives"] = [];
  if (def.movement === "boat") for (const drive of [def, def.secondDrive]) {
    for (const kind of ["outboard", "propeller"] as const) {
      const joint = drive?.[kind];
      if (joint && bone(joint.bone) >= 0) drives.push({ ...joint, bone: bone(joint.bone), spin: kind === "propeller" });
    }
  }
  return { def, drives, ...(def.doors.some(d => d.slide) ? { slideOffsets: new Float32Array(names.length * 3) } : {}), rotors: Int16Array.from(def.movement === "rotor" ? def.rotors : [], (r) => bone(r.bone)), wheels: Int16Array.from(def.wheels, (w) => bone(w.bone)), doors: Int16Array.from(def.doors, (d) => bone(d.bone)), steer: def.steeringWheel ? bone(def.steeringWheel.bone) : -1 };
}

function orientSolved(source: Solved, rotation: Float64Array, out: Solved): void {
  for (let b = 0; b < source.rot.length / 4; b++) {
    quatMul(out.rot, b * 4, rotation, 0, source.rot, b * 4);
    quatRotate(rotation, 0, source.pos[b * 3]!, source.pos[b * 3 + 1]!, source.pos[b * 3 + 2]!, out.pos, b * 3);
  }
}

/**
 * Writes three rows per bone at `at`. They take a vertex of a mesh made on `rest` to its place on the posed, stretched,
 * turned and placed body. `scale` is each bone's stretch along its own axes, or null. `size` scales the whole body
 * about its origin.
 */
export function writeBones(out: Float32Array, at: number, solved: Solved, rest: Float32Array, scale: Float32Array | null, x: number, y: number, z: number, yaw: number, size = 1): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rot = solved.rot;
  const pos = solved.pos;
  const bones = rot.length >> 2;
  for (let b = 0; b < bones; b++) {
    const qx = rot[b * 4]!, qy = rot[b * 4 + 1]!, qz = rot[b * 4 + 2]!, qw = rot[b * 4 + 3]!;
    const sx = (scale ? scale[b * 3]! : 1) * size, sy = (scale ? scale[b * 3 + 1]! : 1) * size, sz = (scale ? scale[b * 3 + 2]! : 1) * size;
    // The bone's rotation matrix with its stretch applied first, so its columns are scaled. Rows r0, r1, r2.
    const r00 = (1 - 2 * (qy * qy + qz * qz)) * sx, r01 = 2 * (qx * qy - qz * qw) * sy, r02 = 2 * (qx * qz + qy * qw) * sz;
    const r10 = 2 * (qx * qy + qz * qw) * sx, r11 = (1 - 2 * (qx * qx + qz * qz)) * sy, r12 = 2 * (qy * qz - qx * qw) * sz;
    const r20 = 2 * (qx * qz - qy * qw) * sx, r21 = 2 * (qy * qz + qx * qw) * sy, r22 = (1 - 2 * (qx * qx + qy * qy)) * sz;
    // A vertex v goes to size * pos + R S (v - rest), so the translation is t = size * pos - R S rest. S already includes size.
    const bx = rest[b * 3]!, by = rest[b * 3 + 1]!, bz = rest[b * 3 + 2]!;
    const tx = pos[b * 3]! * size - (r00 * bx + r01 * by + r02 * bz);
    const ty = pos[b * 3 + 1]! * size - (r10 * bx + r11 * by + r12 * bz);
    const tz = pos[b * 3 + 2]! * size - (r20 * bx + r21 * by + r22 * bz);
    // Then the body's yaw about +Y and its place: x' = c x + s z, z' = c z - s x.
    const o = at + b * BONE_FLOATS;
    out[o] = c * r00 + s * r20;
    out[o + 1] = c * r01 + s * r21;
    out[o + 2] = c * r02 + s * r22;
    out[o + 3] = c * tx + s * tz + x;
    out[o + 4] = r10;
    out[o + 5] = r11;
    out[o + 6] = r12;
    out[o + 7] = ty + y;
    out[o + 8] = c * r20 - s * r00;
    out[o + 9] = c * r21 - s * r01;
    out[o + 10] = c * r22 - s * r02;
    out[o + 11] = c * tz - s * tx + z;
  }
}
