"""Convert Innerscene's CC0 model to a single draw material at its original scale."""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys

import numpy as np
from PIL import Image

output = Path(__file__).parent
source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == "7e0f56c48ddfda595ddd086efec6e57a0e4f9767799a1672e2b0647f79e5102a"
size = struct.unpack_from("<I", source, 12)[0]
doc = json.loads(source[20:20 + size])
binary = source[28 + size:]


def buffer_view(index):
    view = doc["bufferViews"][index]
    start = view.get("byteOffset", 0)
    return binary[start:start + view["byteLength"]]


def samples(index, columns):
    a = doc["accessors"][index]
    dtype = {5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]]
    return np.frombuffer(buffer_view(a["bufferView"]), dtype, a["count"] * columns,
                         a.get("byteOffset", 0)).reshape(-1, columns)


def picture(index):
    image = doc["images"][doc["textures"][index]["source"]]
    return Image.open(io.BytesIO(buffer_view(image["bufferView"]))).convert("RGB")


# Give the printed veneer and the grip most of the atlas. Sample the original
# wrapping UVs, with two pixels of gutter around each patch for mip filtering.
patches = [(0, 0, 1024, 256), (0, 512, 512, 96), (0, 256, 1024, 256),
           (512, 512, 128, 128), (0, 608, 512, 256), (512, 640, 256, 256),
           (640, 512, 128, 128), (768, 512, 256, 128), (768, 640, 256, 256)]
atlases = {name: Image.new("RGB", (1024, 1024), fill) for name, fill in
           [("base", "#222222"), ("normal", "#8080ff"), ("mro", "#ff8000")]}
vertices, normals, uvs, indices = [], [], [], []
vertex_offset = 0
for mesh in doc["meshes"]:
    for part in mesh["primitives"]:
        material = part["material"]
        attrs = part["attributes"]
        xyz = samples(attrs["POSITION"], 3)
        normal = samples(attrs["NORMAL"], 3)
        uv = samples(attrs["TEXCOORD_0"], 2)
        indices.append(samples(part["indices"], 1) + vertex_offset)
        vertex_offset += len(xyz)
        # A positive board Z points at its nose in the game.
        for dest, original in [(vertices, xyz), (normals, normal)]:
            dest.append(np.column_stack((-original[:, 2], original[:, 1], original[:, 0])))
        x, y, w, h = patches[material]
        low, high = uv.min(0), uv.max(0)
        span = np.maximum(high-low, 1e-6)
        uvs.append(((uv-low)/span * [w-5, h-5] + [x+2.5, y+2.5]) / 1024)
        mat = doc["materials"][material]
        pbr = mat["pbrMetallicRoughness"]
        for role, tex in [("base", pbr["baseColorTexture"]), ("normal", mat.get("normalTexture"))]:
            if not tex:
                continue
            original = picture(tex["index"])
            # Filter in source space before sampling small repeated texture details.
            width, height = np.maximum(1, np.minimum(original.size, [w, h]/span)).astype(int)
            pixels = np.asarray(original.resize((width, height), Image.Resampling.LANCZOS))
            u = ((low[0] + (np.arange(w)-2)/(w-5)*span[0]) % 1 * width).astype(int) % width
            v = ((low[1] + (np.arange(h)-2)/(h-5)*span[1]) % 1 * height).astype(int) % height
            patch = pixels[v[:, None], u].copy()
            if role == "normal":
                patch[:, :, :2] = np.clip(128 + (patch[:, :, :2].astype(float)-128) * tex.get("scale", 1), 0, 255)
            atlases[role].paste(Image.fromarray(patch), (x, y))
        atlases["mro"].paste((255, round(255*pbr["roughnessFactor"]), round(255*pbr.get("metallicFactor", 1))), (x,y,x+w,y+h))
for name, atlas in atlases.items():
    atlas.save(output / (name + ".png"), optimize=True)

gltf = {"asset": {"version": "2.0", "copyright": "Innerscene, CC0-1.0"}, "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}], "scene": 0, "accessors": [], "bufferViews": [], "materials": [{"name": "deck"}]}
data = bytearray()
for arrays, kind, form, dtype in [(vertices, 5126, "VEC3", "<f4"), (normals, 5126, "VEC3", "<f4"),
                                  (uvs, 5126, "VEC2", "<f4"), (indices, 5123, "SCALAR", "<u2")]:
    flat = np.concatenate(arrays).astype(dtype)
    gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]), "componentType": kind, "type": form,
                              "count": len(flat), "min": flat.min(0).tolist(), "max": flat.max(0).tolist()})
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(data), "byteLength": flat.nbytes})
    data.extend(flat.tobytes())
    data.extend(b"\0" * (-len(data) % 4))
gltf["buffers"] = [{"byteLength": len(data)}]
gltf["meshes"] = [{"primitives": [{"material": 0, "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3}]}]
header = json.dumps(gltf).encode()
header += b" " * (-len(header) % 4)
(output / "deck.glb").write_bytes(struct.pack("<4sIIII", b"glTF", 2, 28+len(header)+len(data), len(header), 0x4e4f534a)
                                  + header + struct.pack("<II", len(data), 0x004e4942) + data)
