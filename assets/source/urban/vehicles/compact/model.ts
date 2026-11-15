// Original compact hatchback, built in metres. Every vertex follows one of seven rigid bones.
// No imported commercial car, procedural noise, Blender or global asset build is required.

import type { PackMaterial, PackRig } from "../../../../../shared/pack/pack.ts";
import { MATERIAL_TWO_SIDED } from "../../../../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import { spanOf } from "../../../../../tools/pack/surface.ts";
import type { SourceLod, SourceMesh } from "../../../../../tools/pack/write.ts";
import { COMPACT } from "./asset.ts";

type V = readonly [number, number, number];
const PAINT = 0, RUBBER = 1, GLASS = 2, TRIM = 3, LIGHT = 4, TAIL = 5, INTERIOR = 6;
export const DETAIL_COLORS = [[76, 135, 126], [22, 25, 28], [37, 62, 70], [164, 171, 168], [233, 222, 177], [177, 39, 31], [58, 57, 51]] as const;
const PALETTE = defaultPalette();
const COLORS = DETAIL_COLORS.map(([r, g, b]) => nearestColour(PALETTE, r, g, b));

class Mesh {
  positions: number[] = []; normals: number[] = []; uvs: number[] = [];
  colors: number[] = []; bones: number[] = []; indices: number[] = []; sections: number[] = [];

  /** Faces choose their outward side explicitly; side panes are double-sided in their material. */
  face(points: readonly V[], outward: V, material: number, bone = 0): void {
    let p = [...points];
    const normalOf = (): number[] => {
      const [a, b, c] = p as [V, V, V];
      const u = b.map((x, k) => x - a[k]!); const v = c.map((x, k) => x - a[k]!);
      return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    };
    let normal = normalOf();
    if (normal.reduce((sum, n, k) => sum + n * outward[k]!, 0) < 0) { p.reverse(); normal = normalOf(); }
    const length = Math.hypot(...normal);
    if (length < 1e-8) throw new Error("compact: degenerate face");
    const first = this.positions.length / 3;
    const dominant = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    // Metre-based planar UVs, in a repeatable panel tile. All maps are opaque and repeat safely.
    for (const v of p) {
      this.positions.push(...v); this.normals.push(...normal.map((x) => x / length));
      if (material === PAINT) this.uvs.push(dominant === 0 ? v[2] / 2 : v[0] / 2, dominant === 1 ? v[2] / 2 : -v[1] / 2);
      else this.uvs.push((material + .5) / 8, .5);
      this.colors.push(COLORS[material]!); this.bones.push(bone);
    }
    for (let i = 1; i < p.length - 1; i++) { this.indices.push(first, first + i, first + i + 1); this.sections.push(material === PAINT ? 0 : 1); }
  }

  box(lo: V, hi: V, material: number, bone = 0): void {
    const [x, y, z] = lo, [X, Y, Z] = hi;
    this.face([[x,y,z],[x,Y,z],[x,Y,Z],[x,y,Z]], [-1,0,0], material, bone);
    this.face([[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]], [1,0,0], material, bone);
    this.face([[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]], [0,-1,0], material, bone);
    this.face([[x,Y,z],[X,Y,z],[X,Y,Z],[x,Y,Z]], [0,1,0], material, bone);
    this.face([[x,y,z],[X,y,z],[X,Y,z],[x,Y,z]], [0,0,-1], material, bone);
    this.face([[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]], [0,0,1], material, bone);
  }

  cylinder(center: V, radius: number, halfWidth: number, segments: number, material: number, bone: number): void {
    const [x,y,z] = center;
    const ring = (side: number): V[] => Array.from({length:segments}, (_, i) => [x + side * halfWidth, y + Math.cos(i * 2 * Math.PI / segments) * radius, z + Math.sin(i * 2 * Math.PI / segments) * radius]);
    const a = ring(-1), b = ring(1);
    this.face(a, [-1,0,0], material, bone); this.face(b, [1,0,0], material, bone);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments, angle = (i + 0.5) * 2 * Math.PI / segments;
      this.face([a[i]!, b[i]!, b[next]!, a[next]!], [0, Math.cos(angle), Math.sin(angle)], material, bone);
    }
  }

  lod(error: number): SourceLod {
    return { positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals), uvs: Float32Array.from(this.uvs), colors: Uint8Array.from(this.colors), bones: Uint8Array.from(this.bones), indices: Uint32Array.from(this.indices), sections: Uint8Array.from(this.sections), error };
  }
}

function shape(level: number): SourceLod {
  const m = new Mesh();
  const fine = level === 0;
  // Floor, bumpers and continuous sill: the open door reveals an actual empty cabin volume.
  m.box([-.71,.12,-1.72],[.71,.14,1.7], RUBBER);
  m.box([-.82,.14,-1.78],[.82,.15,1.72], PAINT);
  m.box([-.87,.39,1.82],[.87,.61,1.98], RUBBER);
  m.box([-.87,.39,-2],[.87,.61,-1.82], RUBBER);
  m.box([-.81,.58,.72],[.81,.78,1.85], PAINT);
  m.box([-.81,.58,-1.85],[.81,.9,-.78], PAINT);
  // Hood and rear deck have a deliberate taper; roof sits exactly at the declared 1.5 m ceiling.
  m.face([[-.82,.91,.71],[.82,.91,.71],[.79,.81,1.85],[-.79,.81,1.85]], [0,1,0], PAINT);
  m.box([-.71,1.44,-.77],[.71,1.5,.28], PAINT);
  m.face([[-.71,1.44,.29],[.71,1.44,.29],[.81,.93,.76],[-.81,.93,.76]], [0,1,1], GLASS);
  m.face([[-.71,1.44,-.78],[.71,1.44,-.78],[.81,.94,-1.28],[-.81,.94,-1.28]], [0,1,-1], GLASS);

  for (const side of [-1, 1]) {
    const x = side * .84, bone = side === 1 ? 5 : 6;
    // Solid end panels beside the wheels leave a broad, readable arch above each tyre.
    for (const z of [-1.25, 1.25]) {
      const a = z - .37, b = z + .37;
      m.face([[x,.65,a],[x,.9,a],[x,.9,b],[x,.65,b]], [side,0,0], PAINT);
      const inner = z > 0 ? .66 : -1.85, outer = z > 0 ? 1.85 : -.78;
      m.face([[x,.48,inner],[x,.9,inner],[x,.9,a],[x,.65,a]], [side,0,0], PAINT);
      m.face([[x,.65,b],[x,.9,b],[x,.9,outer],[x,.48,outer]], [side,0,0], PAINT);
    }
    const lo = side > 0 ? .795 : -.84, hi = side > 0 ? .84 : -.795;
    m.box([side > 0 ? .76 : -.82,.15,-.76],[side > 0 ? .82 : -.76,.52,.64], PAINT);
    m.box([lo,.52,-.76],[hi,.92,.64], PAINT, bone);
    // Window belongs to its door. A small paint frame makes a later roll-down pane a local replacement.
    const pane: V[] = [[side*.837,.94,-.75],[side*.837,.94,.64],[side*.706,1.43,.27],[side*.706,1.43,-.73]];
    m.face(pane, [side,0,0], GLASS, bone);
    m.face([[side*.845,.92,-.76],[side*.845,.97,-.76],[side*.845,.97,.64],[side*.845,.92,.64]], [side,0,0], RUBBER, bone);
    m.face([[side*.84,.94,.64],[side*.71,1.45,.28],[side*.71,1.45,.34],[side*.84,.94,.72]], [side,0,0], PAINT);
    m.face([[side*.84,.94,-.76],[side*.71,1.45,-.77],[side*.71,1.45,-.84],[side*.84,.94,-.88]], [side,0,0], PAINT);
    if (level < 2) {
      m.box([side > 0 ? .842 : -.865,.81,-.55],[side > 0 ? .865 : -.842,.85,-.35], TRIM, bone);
      m.box([side > 0 ? .842 : -.865,.57,-.73],[side > 0 ? .865 : -.842,.60,.61], RUBBER, bone);
    }
    // A cushion's top supports the pelvis anchor. Backrests remain below the roof.
    const seat = side * .42;
    m.box([seat-.25,.42,-.2],[seat+.25,.57,.36], INTERIOR);
    m.box([seat-.25,.55,-.30],[seat+.25,1.04,-.18], INTERIOR);
    if (fine) m.box([seat-.15,1.01,-.28],[seat+.15,1.16,-.16], INTERIOR);
    m.box([side > 0 ? .50 : -.77,.66,1.856],[side > 0 ? .77 : -.50,.81,1.87], LIGHT);
    m.box([side > 0 ? .57 : -.79,.66,-1.872],[side > 0 ? .79 : -.57,.86,-1.853], TAIL);
  }
  m.box([-.63,.69,1.875],[.63,.75,1.9], RUBBER);
  m.box([-.25,.42,1.99],[.25,.55,2], TRIM);
  m.box([-.65,.63,.63],[.65,.80,.77], INTERIOR);
  if (fine) {
    // Steering wheel placeholder is a slim octagonal ring in the dash plane, not a gameplay bone.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, b = (i+1) * Math.PI / 4;
      m.face([[.42+Math.cos(a)*.16,.89+Math.sin(a)*.16,.55],[.42+Math.cos(b)*.16,.89+Math.sin(b)*.16,.55],[.42+Math.cos(b)*.13,.89+Math.sin(b)*.13,.55],[.42+Math.cos(a)*.13,.89+Math.sin(a)*.13,.55]], [0,0,-1], RUBBER);
    }
    m.box([-.21,.64,-1.89],[.21,.78,-1.873], TRIM);
  }
  for (let bone = 1; bone <= 4; bone++) {
    const center = COMPACT.pivots[bone]!;
    const segments = [16, 8, 6][level]!;
    m.cylinder(center, COMPACT.wheelRadius, COMPACT.wheelWidth / 2 - .008, segments, RUBBER, bone);
    if (level < 2) {
      const side = Math.sign(center[0]);
      m.cylinder([center[0]+side*.115,center[1],center[2]], .18, .002, segments, TRIM, bone);
      if (fine) m.cylinder([center[0]+side*.118,center[1],center[2]], .064, .002, 8, RUBBER, bone);
    }
  }
  return m.lod([0, .09, .2][level]!);
}

export function compactRig(): PackRig {
  return { id: COMPACT.id, skeleton: COMPACT.id, names: [...COMPACT.bones], parent: [-1,0,0,0,0,0,0], rest: COMPACT.pivots.flatMap((v) => [...v]), sockets: Object.entries(COMPACT.anchors).map(([name, v]) => ({name, bone: 0, x: v[0], y: v[1], z: v[2]})) };
}

export interface CompactVisual {
  id: string;
  /** Linear-light multiplier of the same generated paint image. No effect on mechanics, rig or sockets. */
  paintTint: [number, number, number];
  /** sRGB color for flat LODs, selected by the presentation author. */
  flatPaint: [number, number, number];
}

export const COPPER_COMPACT: CompactVisual = {id:"urban:compact/copper",paintTint:[3.1,.62,.34],flatPaint:[132,108,75]};

/** Top two levels use materials, the last is a palette fallback. Texture bytes live in the sibling stream. */
export function compactMesh(visual?: CompactVisual): SourceMesh {
  const lods = [shape(0), shape(1), shape(2)];
  if (visual) {
    const color=nearestColour(PALETTE,...visual.flatPaint);
    for (const lod of lods) for (let t=0;t<lod.indices.length/3;t++) if (lod.sections![t]===0) for (let c=0;c<3;c++) lod.colors[lod.indices[t*3+c]!] = color;
  }
  const materials: PackMaterial[] = ["paint", "details"].map((name, i) => ({id: `${i===0 ? visual?.id ?? COMPACT.id : COMPACT.id}/${name}`, base:i*2, normal:-1, mro:i*2+1, mask:-1, mask2:-1, tint:i===0&&visual?visual.paintTint:[1,1,1], grey:1, emissive:0, flags:i===1?MATERIAL_TWO_SIDED:0, cutoff:0, span:spanOf(lods[0]!,i)}));
  return { id: visual?.id ?? COMPACT.id, skeleton: COMPACT.id, rig: COMPACT.id, collider: [.9,.75,2], lods, flat: 2, materials, textures: [
    {id:`${COMPACT.id}/paint-base`,role:"base",top:COMPACT.textures.runtimeTop},
    {id:`${COMPACT.id}/paint-packed`,role:"mro",top:COMPACT.textures.runtimeTop},
    {id:`${COMPACT.id}/details-base`,role:"base",top:64},
    {id:`${COMPACT.id}/details-packed`,role:"mro",top:64},
  ] };
}
