// Where the MakeHuman mirror is (assets/raw/makehuman, README there) and the files the conversions read from it.

import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const MAKEHUMAN = fileURLToPath(new URL("../../assets/raw/makehuman", import.meta.url));

/** The application's own data: base mesh, targets, default skeleton and weights, modifiers. */
export const CORE = join(MAKEHUMAN, "core");
export const BASE_OBJ = join(CORE, "3dobjs/base.obj");
export const TARGETS = join(CORE, "targets");
export const DEFAULT_SKELETON = join(CORE, "rigs/default.mhskel");
export const MODIFIERS = join(CORE, "modifiers");
export const SYSTEM = join(MAKEHUMAN, "system-assets");
export const PROXIES = join(SYSTEM, "proxymeshes");

/** A proxy's binding by its folder name, such as female1605. */
export const proxyPath = (name: string): string => join(PROXIES, name, `${name}.proxy`);

export { readObj, parseObj, bodyVertexCount, groupVertices, triangleCount, vertexCount, faceCount, type ObjMesh } from "./obj.ts";
export { readTarget, parseTarget, applyTarget, morph, targetFiles, type Target } from "./target.ts";
export { readBinding, parseBinding, fit, axisGrowth, boundCount, type Binding } from "./bind.ts";
export { readSkeleton, parseSkeleton, jointAt, bonePositions, boneIndex, type Skeleton } from "./skeleton.ts";
export { readWeights, parseWeights, influences, type Weights } from "./weights.ts";
