// What an asset says of itself. One folder is one asset: assets/source/<pack>/<group>/<name>/ is "<pack>:<name>", and its
// asset.ts exports one of these as its default. `bun run art -- <pack>:<name>` builds the folder's <name>.snpk from it.
// See assets/source/README.md.

import { ZONE_ARM_L, ZONE_ARM_R, ZONE_FOOT_L, ZONE_FOOT_R, ZONE_HAND_L, ZONE_HAND_R, ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import type { ClipSpec } from "../pack/anim.ts";

export type AssetSpec = CreatureAsset | PiecesAsset | HumanClipsAsset | HumanBodiesAsset;

/** The zones a hit can land in. Content multiplies damage by zone (SpeciesDef.zones). */
export const ZONES = { head: ZONE_HEAD, torso: ZONE_TORSO, armL: ZONE_ARM_L, armR: ZONE_ARM_R, handL: ZONE_HAND_L, handR: ZONE_HAND_R, legL: ZONE_LEG_L, legR: ZONE_LEG_R, footL: ZONE_FOOT_L, footR: ZONE_FOOT_R } as const;
export type ZoneName = keyof typeof ZONES;

/** Metres, x, y, z. +Y is up and the creature faces +Z, so its left is +X. */
export type Vec3 = readonly [number, number, number];

/**
 * What builds the model.
 * `raw` is a file under assets/raw, converted as it is by tools/blender/convert.py.
 * `scripts` are Blender scripts in the asset's folder, run in order in one session that starts empty
 * (tools/blender/build.py). When the last has run the scene holds one armature, the meshes skinned to it, and one action
 * for each clip. A mesh object named "<anything>_LOD<n>" is level n. With no such names there is one level and the rest
 * are made from it.
 */
export type ModelSource = { readonly raw: string } | { readonly scripts: readonly string[] };

/** A hit capsule on a bone. Fitted to the mesh, or given outright. */
export type ZoneSpec =
  | {
      readonly zone: ZoneName;
      /** The bone that carries the capsule. A bone carries one. */
      readonly on: string;
      /** The capsule runs along the line between these two joints of the model, kept or dropped. */
      readonly from: string;
      readonly to: string;
      /** The bones whose vertices it is fitted to. */
      readonly covers: readonly string[];
    }
  | {
      readonly zone: ZoneName;
      readonly on: string;
      /** The two ends, measured from the bone's joint at rest. */
      readonly a: Vec3;
      readonly b: Vec3;
      readonly radius: number;
    };

/** A named place on a bone: where a rider sits, where it bites. Found on the mesh, or given outright. */
export type SocketSpec =
  | {
      readonly name: string;
      readonly bone: string;
      /** The top or the front of the vertices of these bones. */
      readonly of: readonly string[];
      readonly at: "top" | "front";
    }
  | {
      readonly name: string;
      readonly bone: string;
      /** Measured from the bone's joint at rest. */
      readonly offset: Vec3;
    };

export interface RegionSpec {
  /** What a player sees it called. */
  readonly name: string;
  /** The Blender material whose faces take this region's colour. */
  readonly material: string;
  /** A palette index to draw it in on the review sheet. Content gives the colours a wild one rolls. */
  readonly sample: number;
}

export interface CreatureClip {
  /** The clip's id in the pack is "<asset id>/<name>". */
  readonly name: string;
  /** The Blender action it is made from. */
  readonly source: string;
  /** A loop's last key repeats its first and is left out. */
  readonly loop: boolean;
  /** The frames of the action to keep, counted from 0 at one frame a tick, both ends included. All of them where not given. */
  readonly from?: number;
  readonly to?: number;
}

export interface GaitSpec {
  /** Metres the body travels in one turn of the clip. The clip is played by distance over this, so planted feet hold. */
  readonly stride: number;
}

/** One rigid body of the ragdoll: a bone, with the hit capsule that bone carries. A bone that is not listed stays rigid with its nearest listed parent. */
export interface RagdollBody {
  readonly bone: string;
  /** Its share of the creature's mass. The shares need not sum to 1. */
  readonly mass: number;
  /** Degrees it may bend away from its rest direction against its parent body, and turn about its own length. The first body has no parent and no limit. */
  readonly swing?: number;
  readonly twist?: number;
}

export interface CreatureAsset {
  readonly kind: "creature";
  readonly source: ModelSource;
  /** Metres to one of the model's units. */
  readonly scale: number;

  readonly skeleton: {
    /** Shared by every rig on the same bones. Content names it (SpeciesDef.skeleton). */
    readonly id: string;
    /** The joint that becomes the root bone, whose travel the clips keep. */
    readonly root: string;
    /** Joints left out. Their vertices follow the nearest kept joint above. */
    readonly drop?: RegExp;
    /** Bone to parent, for a bone that hangs on a different parent than in the model. */
    readonly reparent?: Readonly<Record<string, string>>;
    /** The most bones the rig may have. The engine takes 127. */
    readonly bones?: number;
  };
  readonly zones: readonly ZoneSpec[];
  readonly sockets: readonly SocketSpec[];
  /** At most six, in the order of the six region colours an instance carries. */
  readonly regions: readonly RegionSpec[];
  readonly clips: readonly CreatureClip[];

  /** The bones that stand on the ground. `--check` watches them in each gait. */
  readonly feet: readonly string[];
  /** By clip name. A clip with a stride is a gait. */
  readonly gaits: Readonly<Record<string, GaitSpec>>;

  readonly budgets: {
    /** The most triangles at each level, finest first. A model may have fewer levels than this lists. */
    readonly triangles: readonly number[];
    /**
     * The side in pixels of the largest base colour and normal map, and the most megabytes all its maps may take in one
     * variant. Nothing reads it yet: the converter that reads textures will.
     */
    readonly texture?: { readonly top: number; readonly megabytes: number };
  };
  /**
   * The first level drawn flat: palette colours, one bone a vertex, one draw, no textures. Set it to the level drawn when
   * the creature stands under about 48 pixels tall on medium, which `--check` prints for every level. Nothing reads it
   * yet: the converter that reads textures will.
   */
  readonly flat?: number;
  /** Nothing reads it yet: the ragdoll will. */
  readonly ragdoll?: readonly RagdollBody[];
}

/**
 * Rigid meshes made by one set of scripts: the pieces of a structure tier, say. A piece whose id is a structure's takes
 * the place of that structure's grey box. Collision stays the content's.
 */
export interface PiecesAsset {
  readonly kind: "pieces";
  readonly source: { readonly scripts: readonly string[] };
  /**
   * `object` is the Blender mesh object the scripts leave for the piece, modelled about the origin as the structure
   * stands: +Y up, metres. "<object>_LOD<n>" is its level n. A material named region0 to region5 is a colour region,
   * and any other takes the nearest palette colour (tools/pack/glb.ts).
   */
  readonly pieces: readonly { readonly id: string; readonly object: string }[];
  readonly budgets: {
    /** The most triangles any one piece may have at each level, finest first. */
    readonly triangles: readonly number[];
    /** As a creature's. */
    readonly texture?: { readonly top: number; readonly megabytes: number };
  };
}

/** The humanoid's clips, converted from animation libraries under assets/raw (tools/art/human.ts). */
export interface HumanClipsAsset {
  readonly kind: "human-clips";
  readonly libraries: readonly { readonly raw: string; readonly clips: readonly ClipSpec[] }[];
}

/** The modelled bodies cut by body slot, with hair, beards and armor sets fitted to each (tools/art/human.ts). */
export interface HumanBodiesAsset {
  readonly kind: "human-bodies";
  /** A folder under assets/raw that the paths below are in. */
  readonly raw: string;
  /** Triangles at each level, for a whole body, a hair or beard, and one part of an outfit. */
  readonly triangles: { readonly body: readonly number[]; readonly hair: readonly number[]; readonly armor: readonly number[] };
  /** In the order of SEX_IDS. `outfits` is how its outfit files and textures are named. */
  readonly bodies: readonly { readonly file: string; readonly material: string; readonly texture: string; readonly outfits: string }[];
  readonly eyes: string;
  readonly hair: string;
  readonly outfits: {
    readonly folder: string;
    readonly files: readonly string[];
    /** An armor set is an outfit's parts together. `texture` is its base colour. */
    readonly sets: readonly { readonly id: string; readonly parts: readonly string[]; readonly texture: string }[];
  };
}
