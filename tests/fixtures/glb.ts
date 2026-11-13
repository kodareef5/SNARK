// Writes a small .glb in code, standing in for a Blender export: a pyramid with
// a painted body and a colour-region base, a lower level of detail, and a
// collision box, using node transforms, three index types and two materials.

function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function sampleGlb(palette: Uint8Array, paintIndex: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const add = (data: Float32Array | Uint16Array | Uint32Array, type: string, componentType: number): number => {
    const bytes = new Uint8Array(data.buffer.slice(0));
    const padded = new Uint8Array((bytes.length + 3) & ~3);
    padded.set(bytes);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: data.length / (type === "VEC3" ? 3 : 1), type });
    offset += padded.length;
    return accessors.length - 1;
  };

  // Pyramid sides: apex + four base corners, wound outward.
  const sides = add(Float32Array.from([0, 1, 0, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), "VEC3", 5126);
  const sideIndex = add(Uint16Array.from([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4]), "SCALAR", 5123);
  const base = add(Float32Array.from([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), "VEC3", 5126);
  const baseIndex = add(Uint32Array.from([0, 1, 2, 0, 2, 3]), "SCALAR", 5125);
  const low = add(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), "VEC3", 5126); // not indexed
  const box: number[] = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) box.push(x, y, z);
  const col = add(Float32Array.from(box), "VEC3", 5126);
  const colIndex = add(Uint16Array.from([0, 1, 2, 5, 6, 7]), "SCALAR", 5123);

  const paint = [linear(palette[paintIndex * 4]!), linear(palette[paintIndex * 4 + 1]!), linear(palette[paintIndex * 4 + 2]!), 1];
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: "body", mesh: 0, translation: [0, 1, 0], scale: [2, 2, 2] },
      { name: "body_LOD1", mesh: 1, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
      { name: "COL", mesh: 2, scale: [2, 4, 2] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: sides }, indices: sideIndex, material: 0 }, { attributes: { POSITION: base }, indices: baseIndex, material: 1 }] },
      { primitives: [{ attributes: { POSITION: low }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: col }, indices: colIndex }] },
    ],
    materials: [{ name: "hide", pbrMetallicRoughness: { baseColorFactor: paint } }, { name: "region0" }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  let json = new TextEncoder().encode(JSON.stringify(gltf));
  if (json.length & 3) {
    const padded = new Uint8Array((json.length + 3) & ~3).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const out = new Uint8Array(12 + 8 + json.length + 8 + offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  let at = 20 + json.length;
  view.setUint32(at, offset, true);
  view.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
