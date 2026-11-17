// What an asset says of itself. One folder is one asset: assets/source/<pack>/<group>/<name>/ is "<pack>:<name>", and its
// asset.ts exports one of these as its default. `bun run art -- <pack>:<name>` builds the folder's <name>.snpk from it.
// See assets/source/README.md.

import { ZONE_ARM_L, ZONE_ARM_R, ZONE_FOOT_L, ZONE_FOOT_R, ZONE_HAND_L, ZONE_HAND_R, ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import type { TextureRole } from "../../shared/pack/texture.ts";
import type { ClipSpec } from "../pack/anim.ts";

export type AssetSpec = CreatureAsset | PiecesAsset | HumanClipsAsset | HumanBodiesAsset | SkyAsset | WaterAsset | DetailsAsset;

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
      /**
       * The capsule runs along the line between these two joints of the model, kept or dropped. Without them it runs
       * along the longest axis of the vertices it covers, through their middle: for a body no two joints lie along.
       */
      readonly from?: string;
      readonly to?: string;
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
  /** The Blender material whose faces take this region's colour, in a model with no `materials`. One with pictures marks its regions in them. */
  readonly material?: string;
  /** A palette index to draw it in on the review sheet. Content gives the colours a wild one rolls. */
  readonly sample: number;
}

/**
 * A material's pictures, and how it is drawn. A path is within the folder of the asset that names the material. Every
 * picture is square, and one that is not a power of two across is resized to the nearest. Base colour and normal are
 * stored at the size they come in, up to the asset's `budgets.texture.top`, and the packed map and the masks one size
 * under the base colour.
 */
export interface MaterialSpec {
  /** Base colour, unlit. Its alpha is how much shows, where the material is cut out. */
  readonly base?: string;
  /** x in red, y in green and pointing up the picture, z in blue. */
  readonly normal?: string;
  /** Occlusion in red, roughness in green and metalness in blue, as one picture or as grey layers of one size. */
  readonly packed?: string | { readonly occlusion: string; readonly roughness: string; readonly metal?: string };
  /**
   * The colour regions: one map painted in flat colours (red, green, blue, cyan, magenta and yellow for regions 0 to
   * 5, black for what is never dyed), or the two masks made by hand (tools/pack/mask.ts).
   */
  readonly regions?: string | { readonly mask: string; readonly mask2?: string };
  /** Kept for the record. `--check` holds the normal map against it. */
  readonly height?: string;
  /**
   * What the surface turns to, on the same layout, sRGB with alpha: `hurt` as the living creature loses health, `decay`
   * as its corpse rots. The colour takes the place of the dyed colour where it shows and is never dyed. Alpha is how
   * soon a texel shows over that picture's three steps: 255 from the first, falling through each third to the next
   * step, 0 never. A corpse shows the whole hurt picture from the start; where the hurt picture has alpha, the decay
   * picture is passed over. Both make one texture (tools/pack/image.ts `layerPicture`), stored no wider than
   * `TextureBudget.layer`.
   */
  readonly hurt?: string;
  readonly decay?: string;
  /** The same pictures at a smaller size, where the set was made small first. `--check` holds each large one, shrunk, against its small one. */
  readonly small?: { readonly base?: string; readonly normal?: string };
  /** The widest a map is stored, where its content needs less than its picture: `--check` notes the side each needs. */
  readonly tops?: Readonly<Partial<Record<TextureRole, number>>>;
  readonly twoSided?: boolean;
  /** Nothing is drawn where the base colour's alpha is under this. `true` is 0.5. */
  readonly cutout?: boolean | number;
  /** Metres one whole picture spans, for a material that tiles. Measured on the meshes where not given. */
  readonly tiles?: number;
  /** A thin sheet's: how much of the light on one face its other face shows, 0 to 1 (shared/pack/finish.ts). */
  readonly sheet?: number;
  /** Multiplied over the base colour: linear, 0 to 1. Nothing is, where not given. */
  readonly tint?: readonly [number, number, number];
  /**
   * The colour it is drawn flat in, red, green and blue of 255, where that is not to be read off its pictures. The
   * palette colour nearest it is used.
   */
  readonly flat?: readonly [number, number, number];
  /** For a material several assets name: its id in the pack, and the folder its paths are in. Set by `shared`. */
  readonly id?: string;
  readonly dir?: string;
  /**
   * Pictures that are data and not a surface, as the sky's are: each is stored as large as it is, the masks' mips are
   * the plain means of their bytes, and no colour is read off them.
   */
  readonly data?: boolean;
}

/**
 * A material that several assets name, said once: `export const POLE = shared(import.meta.dir, "core:pole", { ... })`
 * beside its pictures, with paths within that folder, and `materials: { Pole: POLE }` in each asset that uses it. A
 * shared material says how far it tiles, so that it is one material whichever mesh it is on.
 */
export function shared(dir: string, id: string, spec: MaterialSpec): MaterialSpec {
  return { ...spec, id, dir };
}

/**
 * The side in pixels of the largest base colour and normal map, and the most megabytes all of an asset's maps may take
 * in one variant. `layer` is the widest a material's hurt and decay layer is stored, the base colour's side where not given.
 */
export interface TextureBudget {
  readonly top: number;
  readonly megabytes: number;
  readonly layer?: number;
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
  /**
   * Metres the body travels in one turn of the clip. The clip is played by distance over this, so planted feet hold, and
   * plays at its own rate at this over its length. Measured where the clip allows: `--check` prints the stride its feet
   * hold best at.
   */
  readonly stride: number;
  /**
   * Why the stride is stated and not measured, for a clip whose feet slide however it is played or that has no feet on
   * the ground (a swim). `--check` then notes how far they slide and does not count it a fault.
   */
  readonly stated?: string;
}

/** One rigid body of the ragdoll: a bone, with the hit capsule that bone carries. A bone that is not listed stays rigid with its nearest listed parent. */
export interface RagdollBody {
  readonly bone: string;
  /** Its share of the creature's mass. The shares need not sum to 1. */
  readonly mass: number;
  /**
   * Degrees it may bend away from its rest direction against its parent body, and turn about its own length. The first
   * body has no parent and no limit. At least as far as the clips bend it, which `--check` prints.
   */
  readonly swing?: number;
  readonly twist?: number;
}

export interface RagdollSpec {
  /** The frame of the death clip at which the body goes limp: as it begins to fall. Its last frame, where not given. */
  readonly limp?: number;
  /** The first is the root of the rest: every other body has a listed body above it. */
  readonly bodies: readonly RagdollBody[];
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
    /**
     * Every bone, in the order the rig lists them, where something depends on that order (a vehicle's measured
     * contract). The exporter lists a joint's children by name; without this the rig takes that order. The root is
     * first and every bone comes after its parent.
     */
    readonly order?: readonly string[];
  };
  readonly zones: readonly ZoneSpec[];
  readonly sockets: readonly SocketSpec[];
  /** At most six, in the order of the six region colours an instance carries. */
  readonly regions: readonly RegionSpec[];
  /**
   * The pictures of each Blender material, by its name: three materials at most. With these the creature is drawn
   * with materials. Its finest level is the model's, with its texture coordinates, normals and four bone weights a
   * vertex, and its other levels are made from that one to the triangle budgets (tools/pack/simplify.ts).
   */
  readonly materials?: Readonly<Record<string, MaterialSpec>>;
  readonly clips: readonly CreatureClip[];

  /** The bones that stand on the ground. `--check` watches them in each gait. */
  readonly feet: readonly string[];
  /** By clip name. A clip with a stride is a gait. */
  readonly gaits: Readonly<Record<string, GaitSpec>>;

  readonly budgets: {
    /** The most triangles at each level, finest first. A model may have fewer levels than this lists. */
    readonly triangles: readonly number[];
    readonly texture?: TextureBudget;
  };
  /**
   * The first level drawn flat: palette colours, one bone a vertex, one draw, no textures. Set it to the level drawn when
   * the creature stands under about 48 pixels tall on medium, which `--check` prints for every level. The last level
   * with a budget, where not given. Read only with `materials`.
   */
  readonly flat?: number;
  /** Rigid bones whose thin parts define the silhouette, such as rotors. Their axis extremes survive every LOD. */
  readonly preserveBones?: readonly string[];
  /** What goes limp when it dies. Without it the death clip plays and its last frame stays. */
  readonly ragdoll?: RagdollSpec;
  /**
   * How a saddle is drawn on it, by one of two ways or both (D491). Either way the creature's gear names the saddle it
   * wears, and riding asks only that it wears one, never how it looks. The mesh objects either names are not the bare
   * body's; every other skinned mesh object is. Both are read as the body is, on the same armature, so their vertices
   * follow its bones; the hit zones and sockets are fitted to the bare body alone, and serve both.
   * - `worn`: a mesh made in the same session on the same armature, weighted to the body's bones, written as its item's
   *   "<item>/worn" mesh and drawn on the body's bones, at the body's level, while that item is worn.
   * - `saddled`: the whole creature as it is saddled, written as "<asset id>/saddled" and drawn in place of the bare body
   *   while any saddle is worn, on the same skeleton, clips, sockets and hit zones.
   * Where it has both, the saddled model wins and no worn mesh is drawn over it. A material of either that is named as one
   * of the `regions` is dyed as the body is; any other with no pictures is drawn in the palette colour nearest its base
   * colour, as nothing in ARK dyes a saddle.
   */
  readonly worn?: readonly WornSpec[];
  readonly saddled?: SaddledSpec;
}

/** One saddle drawn on a creature (CreatureAsset.worn). */
export interface WornSpec {
  /** The saddle item it is drawn for. */
  readonly item: string;
  /** The Blender mesh object, "<object>_LOD<n>" for its levels as a body's are. */
  readonly object: string;
  /**
   * Its own materials, three at most, in the one list of names the body's are in: it may name one of the body's, and a
   * name is one material. Drawn flat without them.
   */
  readonly materials?: Readonly<Record<string, MaterialSpec>>;
  /** Its triangles at each level. Its maps are stored as the body's are and count in the body's `texture` budget, so its own `texture` is not read. */
  readonly budgets: { readonly triangles: readonly number[]; readonly texture?: TextureBudget };
  /** The first level drawn flat, as the body's `flat`. */
  readonly flat?: number;
}

/** The creature as it is saddled (CreatureAsset.saddled): the same rig, other meshes and maps. */
export interface SaddledSpec {
  /** The Blender mesh objects that make it, with their levels named as a body's are. */
  readonly objects: readonly string[];
  /** Its materials besides the body's, which it may name too; flat as the body is where neither has any. */
  readonly materials?: Readonly<Record<string, MaterialSpec>>;
  readonly budgets: { readonly triangles: readonly number[]; readonly texture?: TextureBudget };
  /** The first level drawn flat, the body's where not given. */
  readonly flat?: number;
}

/**
 * Rigid meshes made by one set of scripts: the pieces of a structure tier, say. A piece whose id is a structure's takes
 * the place of that structure's grey box. Collision stays the content's.
 */
/** One piece of a pieces asset: see `PiecesAsset.pieces`. */
export interface PieceSpec {
  readonly id: string;
  readonly object: string;
  readonly errors?: readonly number[];
  readonly triangles?: readonly number[];
  readonly hold?: "prop_r" | "prop_l";
  readonly dropped?: "auto" | string;
  readonly icon?: { readonly around: number; readonly above: number; readonly roll?: number; readonly zoom?: number; readonly shift?: readonly [number, number] };
  /**
   * Drawn see-through, its finishes showing their share (shared/pack/finish.ts): wires drawn wider than they are, so that
   * they hold whole on the screen, and as much paler. It is left out of a landmark's far mesh.
   */
  readonly seeThrough?: boolean;
  /** What it may draw from each distance on medium, as metres and triangles, in place of PIECE_TRIANGLES (tools/art/check.ts). */
  readonly budget?: readonly (readonly [number, number])[];
}

export interface PiecesAsset {
  readonly kind: "pieces";
  readonly source: { readonly scripts: readonly string[] };
  /**
   * `object` is the Blender mesh object the scripts leave for the piece, modelled about the origin as the structure
   * stands: +Y up, metres. "<object>_LOD<n>" is its level n. A material named region0 to region5 is a colour region,
   * and any other takes the nearest palette colour (tools/pack/glb.ts).
   *
   * `errors` states, for each level after the finest in turn, how far in metres at the size it is modelled its picture
   * lies from the finest's, in place of measuring how far its points moved. It is for levels a measure of points
   * cannot judge, such as a crown that is other leaves in the same outline. A level it leaves out is measured.
   * `--check` and the sheet print both, and where each level is then first drawn on each tier.
   *
   * `triangles` is the piece's own budget for each level, in place of the asset's, for pieces of one asset that differ
   * in size.
   *
   * An item's piece (planning/reference/items-plan.md) may also say, though nothing reads these until tasks A and B:
   * - `hold`: the piece is held, in the right or left hand, on that hand's prop bone of the human skeleton. Modelled
   *   with the grip at the origin, its length along +Z and its top along +Y, as tools/pack/weapons.ts draws the boxes.
   * - `dropped`: the piece as it lies on the ground, `<id>/dropped`. "auto" lays the held piece on its broadest side;
   *   the name of another Blender object gives a lying piece of its own.
   * - `icon`: the view its inventory picture is drawn from, where the usual three-quarter view does not suit it.
   *   Angles in radians round and above, `roll` about the view, `zoom` past the framing that fits it, and `shift` the
   *   middle of the picture moved right and up, as shares of the half side of that framing: with a zoom, it shows the
   *   part of a long thing that says what it is, as the spear's head.
   */
  readonly pieces: readonly PieceSpec[];
  /**
   * The pictures of each Blender material, by its name. A piece is drawn with them on its levels that have texture
   * coordinates, and flat in the palette colour nearest each material's mean colour.
   */
  readonly materials?: Readonly<Record<string, MaterialSpec>>;
  /**
   * A landmark's finishes, by the name its flat levels give each, whose faces are in the Blender material
   * "flat_<name>" (shared/pack/finish.ts). Each is a rectangle of a material's pictures, in pixels of its base colour,
   * and is read off them: its flat faces are drawn in a palette colour of their own and lit as the pictures are.
   */
  readonly finishes?: Readonly<Record<string, FinishSpec>>;
  /**
   * Where given, every piece's coarser levels are made from its finest to the triangle budgets, as a creature's are,
   * and this is the first flat one. Levels a piece's script brought ("<object>_LOD1" and on, flat) then follow those as
   * its last ones, taking the last budgets: a far level made by hand (farnodes.ts). Where not, a piece keeps the levels
   * its script made.
   */
  readonly flat?: number;
  readonly budgets: {
    /**
     * The most triangles any one piece may have at each level, finest first. With `flat`, a piece whose model has more
     * than the first is not drawn as modelled: its finest level is made from it to that budget, as a city's wrecks are.
     */
    readonly triangles: readonly number[];
    readonly texture?: TextureBudget;
    /**
     * A landmark's: the most triangles one of its cells may draw from each distance on, on medium, as metres and
     * triangles in the form of `LANDMARK_TRIANGLES` (tools/art/check.ts), which holds a landmark that does not say.
     */
    readonly cells?: readonly (readonly [number, number])[];
  };
}

/**
 * One finish of a landmark: the material it is part of, by its name in the model, where in its pictures, its sheet where
 * not the material's, and, for a line's, the share of a face of it that shows (shared/pack/finish.ts).
 */
export interface FinishSpec {
  readonly material: string;
  readonly rect: readonly [number, number, number, number];
  readonly sheet?: number;
  readonly share?: number;
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

/**
 * The pictures the sky's dome draws over its table (client/core/render/atmosphere.ts): the moon's face, and the low and
 * high cloud layers, whose red is how much of the sky a cloud hides and green how little sun gets through it, both
 * linear. They are one material, the moon its base colour and the layers its two masks, on a mesh of one triangle that
 * is never drawn, so that they stream, and are counted, as any material's pictures are.
 */
export interface SkyAsset {
  readonly kind: "sky";
  readonly moon: string;
  readonly low: string;
  readonly high: string;
}

/**
 * The sea's two pictures of wave slopes (client/core/render/water.ts), the long waves and the short, as a material's
 * two masks on a mesh that is never drawn, as the sky's are.
 */
export interface WaterAsset {
  readonly kind: "water";
  readonly long: string;
  readonly short: string;
}

/**
 * The small details' pack (shared/pack/details.ts): every asset's detail pictures in one atlas, the shared effects in
 * this folder's effects.json, and every creature's cues.json. No Blender. assets/source/DETAILS.md says how to write them.
 */
export interface DetailsAsset {
  readonly kind: "details";
}
