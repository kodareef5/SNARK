// Reads a MakeHuman Wavefront mesh (base.obj, a proxy's or a garment's .obj): positions, UVs, faces and their groups.
// MakeHuman's units are decimetres with Y up. Indices here count from 0.

import { readFileSync } from "node:fs";

export interface ObjMesh {
  /** x, y, z a vertex. */
  readonly positions: Float32Array;
  /** u, v a texture vertex. */
  readonly uvs: Float32Array;
  /** Where each face's corners start in `corners` and `cornerUvs`; one more entry than there are faces. */
  readonly faceStart: Uint32Array;
  readonly corners: Uint32Array;
  /** The texture vertex of each corner, or NO_UV. */
  readonly cornerUvs: Uint32Array;
  /** Face indices by group name. A group named twice in the file holds the faces of both runs. */
  readonly groups: ReadonlyMap<string, Uint32Array>;
}

export const NO_UV = 0xffffffff;

export function parseObj(text: string, path = "obj"): ObjMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const faceStart: number[] = [0];
  const corners: number[] = [];
  const cornerUvs: number[] = [];
  const groups = new Map<string, number[]>();
  let group: number[] | null = null;
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim();
    if (line === "" || line[0] === "#") continue;
    const w = line.split(/\s+/);
    switch (w[0]) {
      case "v":
        positions.push(Number(w[1]), Number(w[2]), Number(w[3]));
        break;
      case "vt":
        uvs.push(Number(w[1]), Number(w[2]));
        break;
      case "g": {
        const name = w.slice(1).join(" ");
        group = groups.get(name) ?? [];
        groups.set(name, group);
        break;
      }
      case "f": {
        if (w.length < 4) throw new Error(`${path}:${n + 1}: a face needs three corners`);
        for (let i = 1; i < w.length; i++) {
          const [v, t] = w[i]!.split("/");
          corners.push(Number(v) - 1);
          cornerUvs.push(t ? Number(t) - 1 : NO_UV);
        }
        group?.push(faceStart.length - 1);
        faceStart.push(corners.length);
        break;
      }
    }
  }
  const vertexCount = positions.length / 3;
  for (const c of corners) if (!(c >= 0 && c < vertexCount)) throw new Error(`${path}: a face names vertex ${c + 1} of ${vertexCount}`);
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    faceStart: new Uint32Array(faceStart),
    corners: new Uint32Array(corners),
    cornerUvs: new Uint32Array(cornerUvs),
    groups: new Map([...groups].map(([k, v]) => [k, new Uint32Array(v)])),
  };
}

export function readObj(path: string): ObjMesh {
  return parseObj(readFileSync(path, "utf8"), path);
}

export const vertexCount = (m: ObjMesh): number => m.positions.length / 3;
export const faceCount = (m: ObjMesh): number => m.faceStart.length - 1;

/** Triangles the faces make when each n-gon is a fan. */
export function triangleCount(m: ObjMesh, faces?: ArrayLike<number>): number {
  let t = 0;
  const count = faces ? faces.length : faceCount(m);
  for (let i = 0; i < count; i++) {
    const f = faces ? faces[i]! : i;
    t += m.faceStart[f + 1]! - m.faceStart[f]! - 2;
  }
  return t;
}

/** The vertices the faces of a group use, in increasing order. */
export function groupVertices(m: ObjMesh, name: string): Uint32Array {
  const faces = m.groups.get(name);
  if (!faces) throw new Error(`no group ${name}`);
  const seen = new Set<number>();
  for (const f of faces) for (let c = m.faceStart[f]!; c < m.faceStart[f + 1]!; c++) seen.add(m.corners[c]!);
  return new Uint32Array([...seen].sort((a, b) => a - b));
}

/**
 * How many vertices the body has: hm08 lists the body's vertices first, then the helpers' (tights, skirt, hair, eyes,
 * teeth, lashes, tongue) and the joint cubes. Throws where the body's vertices are not the first, unbroken run.
 */
export function bodyVertexCount(m: ObjMesh, group = "body"): number {
  const used = groupVertices(m, group);
  const n = used.length;
  if (n === 0 || used[n - 1] !== n - 1) throw new Error(`group ${group} does not use vertices 0 to ${n - 1} alone`);
  return n;
}
